import { addDays, addMonths, addYears } from 'date-fns';
import { RRule } from 'rrule';
import { addBusinessDays, isBusinessDay, type WorkCalendar } from '../calendar/holidays';
import {
  DEFAULT_DEADLINE_SETTINGS,
  type AnchorId,
  type Condition,
  type DeadlineRule,
  type DeadlineSettings,
  type FieldValue,
  type Offset,
} from './types';

export interface DeadlineContext {
  anchors: Partial<Record<AnchorId, Date>>;
  /** 이벤트 입력값·시험 속성 */
  fields?: Record<string, FieldValue | undefined>;
  /** 시험·계약별 재정의 값 */
  overrides?: Record<string, Offset | undefined>;
  calendar: WorkCalendar;
  settings?: Partial<DeadlineSettings>;
}

export type DeadlineResult =
  | {
      status: 'due';
      dueAt: Date;
      /** 즉시·지체 없이: 정확한 마감이 아니라 최우선 표시 */
      soft: boolean;
      /** 적용된 조건 분기 (cases가 있을 때) */
      caseIndex?: number;
      source: 'rule' | 'override';
      warnings: string[];
    }
  /** 기준 시점이나 조건 입력값이 없음. provisional은 가능한 기한 중 가장 이른 값 */
  | { status: 'needs_input'; missingAnchors: AnchorId[]; missingFields: string[]; provisional?: Date }
  | { status: 'gate'; before: string }
  | { status: 'recurring'; rrule: string }
  | { status: 'undefined'; flag: 'vague' | 'none'; note?: string };

export function computeDeadline(rule: DeadlineRule, ctx: DeadlineContext): DeadlineResult {
  const settings = { ...DEFAULT_DEADLINE_SETTINGS, ...ctx.settings };
  switch (rule.kind) {
    case 'gate':
      return { status: 'gate', before: rule.before };
    case 'recurring':
      return { status: 'recurring', rrule: rule.rrule };
    case 'undefined':
      return { status: 'undefined', flag: rule.flag, note: rule.note };
    case 'expiry':
    case 'relative':
      break;
  }

  const anchor = ctx.anchors[rule.anchor];
  const offsets = rule.kind === 'expiry' ? [rule.offset] : candidateOffsets(rule);
  if (!offsets.length) throw new Error('relative 규칙에는 offset이나 cases가 있어야 합니다');

  let chosen: { offset: Offset; caseIndex?: number } | { missingFields: string[] };
  if (rule.kind === 'relative' && rule.cases?.length) chosen = chooseCase(rule.cases, ctx.fields ?? {});
  else chosen = { offset: offsets[0] };

  if (!anchor || 'missingFields' in chosen) {
    const missingFields = 'missingFields' in chosen ? chosen.missingFields : [];
    // 판단에 필요한 값이 없으면, 가능한 기한 중 가장 이른 값을 임시 기한으로 보여준다.
    const provisional = anchor
      ? offsets.map((o) => applyOffset(anchor, o, ctx.calendar, settings).date).sort((a, b) => +a - +b)[0]
      : undefined;
    return { status: 'needs_input', missingAnchors: anchor ? [] : [rule.anchor], missingFields, provisional };
  }

  const base = applyOffset(anchor, chosen.offset, ctx.calendar, settings);
  let dueAt = base.date;
  let source: 'rule' | 'override' = 'rule';
  const warnings = [...base.warnings];

  if (rule.kind === 'relative' && rule.override) {
    const ov = ctx.overrides?.[rule.override];
    if (ov) {
      const o = applyOffset(anchor, ov, ctx.calendar, settings);
      const useOverride = (rule.override_rule ?? 'min') === 'replace' || +o.date < +dueAt;
      if (useOverride) {
        dueAt = o.date;
        source = 'override';
        warnings.push(...o.warnings);
      }
    }
  }

  return {
    status: 'due',
    dueAt,
    soft: rule.kind === 'relative' && !!rule.soft,
    caseIndex: 'caseIndex' in chosen ? chosen.caseIndex : undefined,
    source,
    warnings,
  };
}

function candidateOffsets(rule: Extract<DeadlineRule, { kind: 'relative' }>): Offset[] {
  if (rule.cases?.length) return rule.cases.map((c) => c.offset);
  return rule.offset ? [rule.offset] : [];
}

function chooseCase(cases: { when: Condition; offset: Offset }[], fields: Record<string, FieldValue | undefined>) {
  const missing = new Set<string>();
  for (let i = 0; i < cases.length; i++) {
    const r = evalCondition(cases[i].when, fields, missing);
    if (r === true) return { offset: cases[i].offset, caseIndex: i };
    // 앞 분기의 참·거짓을 모르면 뒤 분기(특히 else)로 넘어가면 안 된다.
    if (r === undefined) return { missingFields: [...missing] };
  }
  throw new Error('어느 조건에도 해당하지 않습니다. 마지막 분기에 "else"를 두세요');
}

/** 참·거짓, 또는 입력값이 없어 판단할 수 없으면 undefined */
export function evalCondition(c: Condition, fields: Record<string, FieldValue | undefined>, missing: Set<string> = new Set()): boolean | undefined {
  if (c === 'else') return true;
  if ('field' in c) {
    const v = fields[c.field];
    if (v === undefined) {
      missing.add(c.field);
      return undefined;
    }
    return 'eq' in c ? v === c.eq : c.in.includes(v);
  }
  if ('not' in c) {
    const r = evalCondition(c.not, fields, missing);
    return r === undefined ? undefined : !r;
  }
  const results = ('all' in c ? c.all : c.any).map((x) => evalCondition(x, fields, missing));
  if ('all' in c) {
    if (results.includes(false)) return false;
    return results.includes(undefined) ? undefined : true;
  }
  if (results.includes(true)) return true;
  return results.includes(undefined) ? undefined : false;
}

export function applyOffset(anchor: Date, offset: Offset, cal: WorkCalendar, s: DeadlineSettings): { date: Date; warnings: string[] } {
  const warnings: string[] = [];
  const { value, unit } = offset;
  if (unit === 'minute') return { date: new Date(+anchor + value * 60_000), warnings };
  if (unit === 'hour') return { date: new Date(+anchor + value * 3_600_000), warnings };

  const day = new Date(anchor.getFullYear(), anchor.getMonth(), anchor.getDate());
  let d: Date;
  if (unit === 'business_day') {
    d = addBusinessDays(day, value, cal);
    checkCoverage(day, d, cal, warnings);
  } else {
    // 첫날을 기간에 넣으면(inclusive) 하루 앞당겨진다. 0일(당일)은 그대로 당일.
    const back = s.dayCounting === 'inclusive' && value > 0 ? 1 : 0;
    if (unit === 'day') d = addDays(day, value - back);
    else if (unit === 'week') d = addDays(day, value * 7 - back);
    else if (unit === 'month') d = addDays(addMonths(day, value), -back);
    else d = addDays(addYears(day, value), -back);
    if (s.rollForwardOnHoliday && !isBusinessDay(d, cal)) {
      checkCoverage(d, d, cal, warnings);
      d = addBusinessDays(d, 0, cal);
    }
  }
  d.setHours(s.dayEnd.hour, s.dayEnd.minute, 0, 0);
  return { date: d, warnings };
}

function checkCoverage(from: Date, to: Date, cal: WorkCalendar, warnings: string[]) {
  for (let y = from.getFullYear(); y <= to.getFullYear(); y++) {
    if (!cal.coveredYears.has(y)) warnings.push(`${y}년 공휴일 표가 없어 주말만 빼고 계산함. 회사 설정에서 공휴일을 확인하세요`);
  }
}

/**
 * 반복 규칙의 발생 시각 목록 [from, to].
 * rrule은 UTC로 계산하므로, 현지 시각을 같은 숫자의 UTC로 옮겨 계산하고 되돌린다 (일광절약시간 문제 회피).
 */
export function occurrences(rule: Extract<DeadlineRule, { kind: 'recurring' }>, from: Date, to: Date): Date[] {
  const toFloating = (d: Date) => new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate(), d.getHours(), d.getMinutes()));
  const fromFloating = (d: Date) => new Date(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), d.getUTCHours(), d.getUTCMinutes());
  const options = RRule.parseString(rule.rrule);
  const start = rule.dtstart ? new Date(`${rule.dtstart}T00:00:00`) : new Date(from.getFullYear(), from.getMonth(), from.getDate());
  options.dtstart = toFloating(start);
  return new RRule(options).between(toFloating(from), toFloating(to), true).map(fromFloating);
}
