import type { AnchorId, DeadlineRule, Unit } from '../deadline/types';

export interface DeadlinePattern {
  id: string;
  pattern: string;
  kind: 'immediate' | 'relative' | 'gate' | 'business_day' | 'expiry' | 'recurring' | 'vague';
  value?: number;
  valueGroup?: number;
  unitGroup?: number;
  /** 단위가 패턴에 고정된 경우 (예: "48h" → hour) */
  unit?: Unit;
  negative?: boolean;
  /** {1}: 캡처 그룹, {1|3}: 1이 없으면 3, {list1}: "1·11·21" → "1,11,21" */
  rrule?: string;
}

export interface AnchorHint {
  pattern: string;
  anchor: AnchorId;
}

/** 본문에서 찾은 기한 문구와, 그것을 규칙으로 바꾼 초안 */
export interface FoundDeadline {
  patternId: string;
  /** 원문 문구 그대로 */
  phrase: string;
  rule: DeadlineRule;
  /** 기준 시점을 문맥에서 찾지 못해 기본값(event_at)을 쓴 경우 */
  anchorGuessed: boolean;
}

const UNITS: Record<string, Unit> = { 시간: 'hour', 일: 'day', 주: 'week', 개월: 'month', 월: 'month', 년: 'year' };

export interface CompiledDeadlines {
  patterns: (DeadlinePattern & { re: RegExp })[];
  anchors: (AnchorHint & { re: RegExp })[];
}

export function compileDeadlines(patterns: DeadlinePattern[], anchors: AnchorHint[]): CompiledDeadlines {
  return {
    patterns: patterns.map((p) => ({ ...p, re: new RegExp(p.pattern, 'g') })),
    anchors: anchors.map((a) => ({ ...a, re: new RegExp(a.pattern) })),
  };
}

/**
 * 문장에서 기한 문구를 모두 찾는다. 위 패턴이 잡은 구간은 아래 패턴이 다시 잡지 않는다.
 * context는 기준 시점을 정하는 데만 쓴다 (상위 조항 제목 등).
 */
export function findDeadlines(text: string, compiled: CompiledDeadlines, context = ''): FoundDeadline[] {
  const taken: [number, number][] = [];
  const found: (FoundDeadline & { at: number })[] = [];
  for (const p of compiled.patterns) {
    p.re.lastIndex = 0;
    for (let m = p.re.exec(text); m; m = p.re.exec(text)) {
      if (!m[0]) {
        p.re.lastIndex++;
        continue;
      }
      const start = m.index;
      const end = start + m[0].length;
      if (taken.some(([s, e]) => start < e && end > s)) continue;
      // 기준 시점 단서는 문구 앞이나 문구 안에 있다 ("확정일부터 1년").
      const before = context + ' ' + text.slice(0, end);
      const built = buildRule(p, m, before, compiled);
      if (!built) continue;
      taken.push([start, end]);
      found.push({ patternId: p.id, phrase: m[0].trim(), ...built, at: start });
    }
  }
  return found.sort((a, b) => a.at - b.at).map(({ at: _at, ...f }) => f);
}

function buildRule(
  p: DeadlinePattern,
  m: RegExpExecArray,
  before: string,
  compiled: CompiledDeadlines,
): { rule: DeadlineRule; anchorGuessed: boolean } | null {
  const num = (g?: number) => (g ? Number.parseInt(m[g] ?? '', 10) : Number.NaN);
  const unit = (g?: number) => (g ? UNITS[m[g] ?? ''] : p.unit);
  // 문구 바로 앞에서 가장 가까운 기준 시점 단서를 쓴다.
  let anchor: AnchorId = 'event_at';
  let anchorGuessed = true;
  let bestPos = -1;
  for (const a of compiled.anchors) {
    const re = new RegExp(a.re.source, 'g');
    for (let x = re.exec(before); x; x = re.exec(before)) {
      if (x.index > bestPos) {
        bestPos = x.index;
        anchor = a.anchor;
        anchorGuessed = false;
      }
    }
  }

  switch (p.kind) {
    case 'immediate':
      return { rule: { kind: 'relative', anchor, offset: { value: 0, unit: 'minute' }, soft: true }, anchorGuessed };
    case 'relative': {
      const value = num(p.valueGroup);
      const u = unit(p.unitGroup);
      if (!Number.isFinite(value) || !u) return null;
      return { rule: { kind: 'relative', anchor, offset: { value: p.negative ? -value : value, unit: u } }, anchorGuessed };
    }
    case 'business_day': {
      const value = p.value ?? num(p.valueGroup);
      if (!Number.isFinite(value)) return null;
      return { rule: { kind: 'relative', anchor, offset: { value, unit: 'business_day' } }, anchorGuessed };
    }
    case 'expiry': {
      const value = num(p.valueGroup);
      const u = unit(p.unitGroup);
      if (!Number.isFinite(value) || !u) return null;
      return { rule: { kind: 'expiry', anchor, offset: { value, unit: u } }, anchorGuessed };
    }
    case 'gate':
      return { rule: { kind: 'gate', before: m[0].replace(/\s*(전|이전)(에|까지)$/, '').trim() }, anchorGuessed: false };
    case 'recurring': {
      const rrule = fillRrule(p.rrule ?? '', m);
      if (!rrule) return null;
      return { rule: { kind: 'recurring', rrule }, anchorGuessed: false };
    }
    case 'vague':
      return { rule: { kind: 'undefined', flag: 'vague', note: m[0].trim() }, anchorGuessed: false };
  }
}

function fillRrule(template: string, m: RegExpExecArray): string | null {
  let ok = true;
  const out = template.replace(/\{(list)?(\d)(?:\|(\d))?\}/g, (_, list: string | undefined, a: string, b: string | undefined) => {
    const v = m[Number(a)] ?? (b ? m[Number(b)] : undefined);
    if (!v) {
      ok = false;
      return '';
    }
    if (!list) return v.trim();
    const days = v.split(/[·,\s]+/).filter(Boolean);
    if (!days.length || days.some((d) => !/^\d{1,2}$/.test(d) || +d < 1 || +d > 31)) ok = false;
    return days.join(',');
  });
  return ok ? out : null;
}
