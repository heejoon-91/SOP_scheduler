import defaultConfig from '../../config/extract.default.json';
import type { Clause, ParsedSopSet, ParsedTable } from '../model';
import { compileDeadlines, findDeadlines, type AnchorHint, type CompiledDeadlines, type DeadlinePattern, type FoundDeadline } from './deadlines';

export interface ExtractConfig {
  excludeSections: string[];
  weakSections: string[];
  excludeSentences: string[];
  obligationVerbs: string;
  obligationEnding: string;
  roles: string[];
  anchors: AnchorHint[];
  deadlines: DeadlinePattern[];
  stageKeywords: string;
  /** 이 기준 시점에서 세는 기한은 시험 단계 의무로 본다 */
  stageAnchors: string[];
  /** 날짜는 없지만 주기를 뜻하는 기한 패턴 (정기로 분류) */
  periodicVagueIds: string[];
  eventKeywords: string;
  conditionPattern: string;
  periodHeaders: string;
}

export const DEFAULT_EXTRACT_CONFIG = defaultConfig as ExtractConfig;

/** 의무 유형 (설계 문서 "의무 유형 4가지") + 판단 불가 */
export type ObligationType = 'periodic' | 'stage' | 'event' | 'expiry' | 'unknown';

export const TYPE_LABELS: Record<ObligationType, string> = {
  periodic: '정기',
  stage: '시험 단계',
  event: '수시 이벤트',
  expiry: '만료 추적',
  unknown: '미분류',
};

export type CandidateFlag = 'no_deadline' | 'vague' | 'no_form' | 'no_actor' | 'multiple_deadlines' | 'anchor_guessed';

export const FLAG_LABELS: Record<CandidateFlag, string> = {
  no_deadline: '기한 없음',
  vague: '모호한 표현',
  no_form: '서식 없음',
  no_actor: '담당 없음',
  multiple_deadlines: '기한 여러 개',
  anchor_guessed: '기준 시점 추정',
};

export interface Candidate {
  id: string;
  sop: string;
  clauseId: string;
  path: string;
  source: 'clause' | 'table_row';
  /** 표 행에서 나온 후보의 행 번호 (머리글 = 0) */
  rowIndex?: number;
  /** 상위 조항 본문, 바깥쪽부터 */
  context: string[];
  text: string;
  type: ObligationType;
  typeReason: string;
  /** strong: 서식이나 기한 문구가 있음, medium: 의무형 동사로 끝남 */
  strength: 'strong' | 'medium';
  actor?: string;
  recipients: string[];
  roles: string[];
  /** 본문이 서식 코드나 서식 이름으로 언급한 서식 */
  forms: string[];
  /** 본문에는 없고 상위 조항이 언급한 서식 (검토 시 후보로 보여줌) */
  inheritedForms: string[];
  deadlines: FoundDeadline[];
  trigger?: string;
  flags: CandidateFlag[];
}

interface Compiled {
  excludeSections: RegExp[];
  weakSections: RegExp[];
  excludeSentences: RegExp[];
  verb: RegExp;
  ending: RegExp;
  role: string;
  actorRe: RegExp;
  bareRoleRe: RegExp;
  recipientRe: RegExp;
  listRecipientRe: RegExp;
  rolesRe: RegExp;
  stage: RegExp;
  event: RegExp;
  condition: RegExp;
  periodHeader: RegExp;
  formRe: RegExp;
  deadlines: CompiledDeadlines;
  stageAnchors: Set<string>;
  periodicVagueIds: Set<string>;
  /** 서식 사전: 공백을 뺀 서식 이름 → 코드 */
  formNames: { key: string; code: string }[];
}

/** 이보다 짧은 서식 이름은 일반 단어와 겹치기 쉬워 이름 매칭에 쓰지 않는다 */
const MIN_FORM_NAME = 4;

function compile(c: ExtractConfig, formPattern: string, parsed: ParsedSopSet): Compiled {
  const role = `(${c.roles.join('|')})`;
  return {
    stageAnchors: new Set(c.stageAnchors),
    periodicVagueIds: new Set(c.periodicVagueIds),
    formNames: parsed.forms
      .map((f) => ({ key: f.name.replace(/\s+/g, ''), code: f.code }))
      .filter((f) => f.key.length >= MIN_FORM_NAME)
      // 긴 이름부터: "장비 관리대장"보다 "전산저장매체 관리대장"을 먼저 본다
      .sort((a, b) => b.key.length - a.key.length),
    excludeSections: c.excludeSections.map((p) => new RegExp(p)),
    weakSections: c.weakSections.map((p) => new RegExp(p)),
    excludeSentences: c.excludeSentences.map((p) => new RegExp(p)),
    verb: new RegExp(c.obligationVerbs),
    ending: new RegExp(c.obligationEnding),
    role,
    actorRe: new RegExp(`${role}\\s*(은|는|이|가)\\s`),
    bareRoleRe: new RegExp(`^${role}$`),
    recipientRe: new RegExp(`${role}\\s*(에게|에)\\s*(?:[^.,]{0,15}?)(보고|통보|통지|제출|송부|알린|알려)`, 'g'),
    listRecipientRe: new RegExp(`^${role}(?:\\s*[,및]\\s*${role})*\\s*:`),
    rolesRe: new RegExp(role, 'g'),
    stage: new RegExp(c.stageKeywords),
    event: new RegExp(c.eventKeywords),
    condition: new RegExp(c.conditionPattern),
    periodHeader: new RegExp(c.periodHeaders),
    formRe: new RegExp(formPattern, 'g'),
    deadlines: compileDeadlines(c.deadlines, c.anchors),
  };
}

/**
 * 파싱된 SOP에서 의무 후보를 규칙으로 뽑는다. AI를 쓰지 않으며, 같은 입력에는 항상 같은 결과를 낸다.
 * 결과는 초안이다. 모든 후보는 근거 조항(clauseId)을 달고 사용자 검토를 거친다.
 */
export function extractCandidates(
  parsed: ParsedSopSet,
  config: ExtractConfig = DEFAULT_EXTRACT_CONFIG,
  formPattern = '[A-Z]+/[A-Z]+/\\d{3}-\\d+',
): Candidate[] {
  const k = compile(config, formPattern, parsed);
  const out: Candidate[] = [];
  for (const sop of parsed.sops) {
    const byId = new Map(sop.clauses.map((c) => [c.id, c]));
    const ancestors = (c: Clause): Clause[] => {
      const chain: Clause[] = [];
      for (let p = c.parentId ? byId.get(c.parentId) : undefined; p; p = p.parentId ? byId.get(p.parentId) : undefined) chain.unshift(p);
      return chain;
    };

    for (const clause of sop.clauses) {
      const chain = ancestors(clause);
      const section = (clause.level === 1 ? clause : chain.find((a) => a.level === 1))?.text ?? '';
      if (k.excludeSections.some((re) => re.test(section))) continue;
      const weak = k.weakSections.some((re) => re.test(section));
      const context = chain.map((a) => a.text);
      const inherited = unique(chain.flatMap((a) => formsIn(k, a.text)));

      const c = fromText(k, clause, clause.text, context, formsIn(k, clause.text), inherited, weak);
      if (c) out.push(c);

      clause.tables.forEach((table, ti) => {
        for (const row of periodRows(k, table)) {
          const rowInherited = unique([...inherited, ...formsIn(k, clause.text)]);
          const rc = fromText(k, clause, row.text, [...context, clause.text], formsIn(k, row.text), rowInherited, false, row.period);
          if (rc) out.push({ ...rc, id: `${clause.id}~t${ti + 1}r${row.index}`, source: 'table_row', rowIndex: row.index });
        }
      });
    }
  }
  return out;
}

function fromText(
  k: Compiled,
  clause: Clause,
  text: string,
  context: string[],
  forms: string[],
  inheritedForms: string[],
  weak: boolean,
  /** 표 행의 주기 칸. 있으면 기한은 이 칸에서만 찾는다 */
  periodCell?: string,
): Candidate | null {
  if (!text || k.excludeSentences.some((re) => re.test(text))) return null;
  const ctx = context.join(' ');
  const deadlines = findDeadlines(periodCell ?? text, k.deadlines, ctx + ' ' + (periodCell ? text : ''));
  const hasVerb = k.verb.test(text);
  const hasEnding = k.ending.test(text);

  let strength: Candidate['strength'];
  if ((forms.length || deadlines.length) && (hasVerb || hasEnding || deadlines.length)) strength = 'strong';
  else if (hasVerb && hasEnding && !weak) strength = 'medium';
  else return null;
  if (weak && strength !== 'strong') return null;

  const actor = findActor(k, text) ?? [...context].reverse().map((t) => findActor(k, t)).find(Boolean);
  const recipients = findRecipients(k, text, ctx);
  const roles = unique(text.match(k.rolesRe) ?? []).map(normalizeSpace);
  const trigger = k.condition.exec(text)?.[1]?.trim() ?? [...context].reverse().map((t) => k.condition.exec(t)?.[1]?.trim()).find(Boolean);
  const { type, reason } = classify(k, text, ctx, deadlines, trigger);

  const flags: CandidateFlag[] = [];
  const concrete = deadlines.filter((d) => !(d.rule.kind === 'undefined'));
  if (!deadlines.length && type !== 'stage') flags.push('no_deadline');
  if (deadlines.some((d) => d.rule.kind === 'undefined')) flags.push('vague');
  if (!forms.length && !inheritedForms.length) flags.push('no_form');
  if (!actor) flags.push('no_actor');
  if (concrete.length > 1) flags.push('multiple_deadlines');
  if (type !== 'event' && deadlines.some((d) => d.anchorGuessed && (d.rule.kind === 'relative' || d.rule.kind === 'expiry'))) flags.push('anchor_guessed');

  return {
    id: clause.id,
    sop: clause.sop,
    clauseId: clause.id,
    path: clause.path,
    source: 'clause',
    context,
    text,
    type,
    typeReason: reason,
    strength,
    actor: actor ? normalizeSpace(actor) : undefined,
    recipients,
    roles,
    forms: unique(forms),
    inheritedForms: inheritedForms.filter((f) => !forms.includes(f)),
    deadlines,
    trigger,
    flags,
  };
}

/**
 * 유형 판단 순서: 기한 문구(반복 → 보관기간 → 주기 표현 → 선행 조건 → 시험 기준 시점) → 본문 단어 → 상위 조항 단어.
 * 사건 단어와 시험 단계 단어가 함께 있으면, 사건 단어가 조건절("~경우")에 있을 때만 수시 이벤트로 본다.
 * ("이상반응 보고를 교육한다"는 이상반응이 일어났을 때의 의무가 아니다.)
 */
function classify(k: Compiled, text: string, ctx: string, deadlines: FoundDeadline[], trigger?: string): { type: ObligationType; reason: string } {
  const kinds = new Set(deadlines.map((d) => d.rule.kind));
  if (kinds.has('recurring')) return { type: 'periodic', reason: '반복 주기 문구' };
  if (kinds.has('expiry')) return { type: 'expiry', reason: '보관 기간 문구' };
  const vaguePeriod = deadlines.find((d) => k.periodicVagueIds.has(d.patternId));
  if (vaguePeriod) return { type: 'periodic', reason: `주기 표현 "${vaguePeriod.phrase}" (날짜 미정)` };
  if (kinds.has('gate')) return { type: 'stage', reason: '선행 조건 문구' };
  const studyAnchored = deadlines.find((d) => d.rule.kind === 'relative' && !d.anchorGuessed && k.stageAnchors.has(d.rule.anchor));
  if (studyAnchored) return { type: 'stage', reason: `시험 기준 시점 기한 "${studyAnchored.phrase}"` };

  const realTrigger = trigger && !/필요/.test(trigger) ? trigger : undefined;
  const evTrigger = realTrigger ? k.event.exec(realTrigger) : null;
  if (evTrigger) return { type: 'event', reason: `조건 "${realTrigger}"` };

  for (const [where, s] of [['본문', text], ['상위 조항', ctx]] as const) {
    const ev = k.event.exec(s);
    const st = k.stage.exec(s);
    if (ev && !st) return { type: 'event', reason: `${where} 사건 단어 "${ev[0]}"` };
    if (st) return { type: 'stage', reason: `${where} 시험 단계 단어 "${st[0]}"` };
    if (where === '본문' && realTrigger) return { type: 'event', reason: `조건 "${realTrigger}"` };
  }
  return { type: 'unknown', reason: '판단 단서 없음' };
}

/** 본문이 언급한 서식: 서식 코드, 또는 서식 사전에 있는 서식 이름 */
function formsIn(k: Compiled, text: string): string[] {
  k.formRe.lastIndex = 0;
  const byCode = text.match(k.formRe) ?? [];
  let squashed = text.replace(/\s+/g, '');
  const byName: string[] = [];
  for (const f of k.formNames) {
    if (squashed.includes(f.key)) {
      byName.push(f.code);
      // 같은 글자를 짧은 이름이 다시 잡지 않게 지운다
      squashed = squashed.split(f.key).join('■');
    }
  }
  return unique([...byCode, ...byName]);
}

function findActor(k: Compiled, text: string): string | undefined {
  // 책임 절에서는 "4-2 SOP 작성 책임자"처럼 직무 이름이 상위 조항 제목 그 자체다.
  if (k.bareRoleRe.test(text.trim())) return text.trim();
  return k.actorRe.exec(text)?.[1];
}

function findRecipients(k: Compiled, text: string, ctx: string): string[] {
  const out: string[] = [];
  k.recipientRe.lastIndex = 0;
  for (let m = k.recipientRe.exec(text); m; m = k.recipientRe.exec(text)) out.push(m[1]);
  // "시험의뢰자: 48시간 이내"처럼 보고 기한 목록의 항목이면 앞의 직무가 보고처다.
  const list = k.listRecipientRe.exec(text);
  if (list && /보고|통보|통지/.test(ctx)) {
    const head = text.slice(0, text.indexOf(':'));
    out.push(...(head.match(k.rolesRe) ?? []));
  }
  return unique(out.map(normalizeSpace));
}

/** 머리글에 "주기" 같은 칸이 있는 표의 각 행 */
function periodRows(k: Compiled, table: ParsedTable): { index: number; text: string; period: string }[] {
  const header = table.rows[0] ?? [];
  const col = header.findIndex((h) => k.periodHeader.test(h.trim()));
  if (col < 0) return [];
  return table.rows.slice(1).flatMap((row, i) => {
    const period = row[col]?.trim() ?? '';
    if (!period) return [];
    const text = row.map((cell, j) => (header[j] ? `${header[j]}: ${cell}` : cell)).join(' / ');
    return [{ index: i + 1, text, period }];
  });
}

function unique<T>(xs: T[]): T[] {
  return [...new Set(xs)];
}

function normalizeSpace(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}
