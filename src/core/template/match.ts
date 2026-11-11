/**
 * 템플릿 의무를 회사 SOP 조항에 연결한다 (설계 문서 "추출 파이프라인" 3·6단계).
 * 점수 = 대표 문장과 조항 글의 유사도(2-gram TF-IDF 코사인) + 서식 이름 일치 가산점.
 * 결과는 후보 목록이다. 연결 확정은 사람이 근거 조항 원문을 보고 한다.
 */
import type { Clause, ParsedSopSet } from '../model';
import { cosine, Idf, keywordsOf, squash, termFreq, type Vector } from './text';
import type { TemplateObligation, TemplateSet } from './types';

export interface MatchOptions {
  topK: number;
  /** 이 점수 이상이면 "연결됨" */
  strong: number;
  /** 이 점수 이상이면 "약한 연결", 미만이면 "회사 SOP에 해당 조항 없음" */
  weak: number;
  /** 서식 이름이 조항에 나오면 더하는 점수 (서식 하나당) */
  formBonus: number;
  /** 상위 조항 글의 가중치 (조항 자신 = 1) */
  contextWeight: number;
  /**
   * 이보다 짧은(공백 제외 글자 수) 조항은 점수를 √(길이/기준)만큼 줄인다.
   * "기기 관리대장" 같은 제목 한 줄이 단어 하나 겹친다고 본문 조항을 앞서지 않게 한다.
   */
  shortClauseChars: number;
  /**
   * 템플릿 키워드 중 회사 SOP 전체에 한 번이라도 나오는 비율이 이보다 낮으면,
   * 유사도가 "있음" 기준에 못 미치는 한 "없음"으로 본다.
   * ("수질검사", "소독제"처럼 의무를 특정하는 단어가 SOP 어디에도 없으면 그 의무도 없을 가능성이 높다.)
   */
  coverageFloor: number;
  /** "있음"으로 보려면 1순위 조항과 겹쳐야 하는 템플릿 키워드 수 (서식 이름이 겹치면 1개로 침) */
  minSharedKeywords: number;
  /**
   * 의무를 정하지 않는 장(章)의 제목 (공백 제외). 이 장 아래 조항은 후보에서 뺀다.
   * "작업기록지", "관련서식" 장은 서식 이름만 나열해 서식 이름 가산점을 받고 본문 조항을 밀어낸다.
   */
  skipSections: string[];
  /**
   * 기관마다 다르게 쓰는 같은 뜻의 말. { 대표어: [다른 표현, ...] }. 템플릿과 회사 SOP 양쪽에서 다른 표현을 대표어로 바꾼 뒤 비교한다.
   * 뜻이 여럿인 말은 넣지 않는다 (예: "보정"은 교정과 동물 보정 두 뜻이라 뺐다).
   */
  synonyms: Record<string, string[]>;
  /**
   * 할 일·트리거 글에 더 주는 가중치 (대표 문장에 한 번 더 더함).
   * 대표 문장은 근거 조항 원문이 대부분이라, 같은 SOP의 이웃 조항과 구별해 주는 "사용중단", "외부 교육" 같은 트리거 말이 묻힌다.
   */
  taskWeight: number;
  /**
   * "있음"으로 보려면 1순위 조항(상위 조항·SOP 제목 포함)에 트리거 단어가 하나 이상 나와야 한다.
   * 비슷한 절차를 정한 다른 의무의 조항(예: "시정요구 회신"을 "QA 점검 부적합 회신"으로)을 "있음"으로 통과시키지 않게 한다.
   */
  requireTriggerWord: boolean;
  /** 회사 SOP 조항 중 이 비율 이상에 나오는 말("시험", "보고" 등)은 트리거 단어로 치지 않는다 */
  genericWordRatio: number;
  /**
   * 이 점수 이상이면 트리거 단어 조건을 보지 않는다. 정기 의무의 트리거는 "연 1회 이상" 같은 주기라
   * 조항이 같은 말을 안 쓰는 경우가 많은데, 점수가 이만큼 높으면 같은 의무로 봐도 된다.
   */
  triggerExemptScore: number;
}

export const DEFAULT_MATCH_OPTIONS: MatchOptions = {
  topK: 3,
  // 0.30 → 0.35: 컬프 2023(정답 107건, AI 판정)에서 없는 의무를 '있음'으로 본 오류 6 → 3, 확인 필요 37 → 53
  strong: 0.35,
  // 0.18 → 0.13 (2026-11-11, 사용자 결정): 있는 의무를 '없음'으로 경고하는 오류 5 → 0. 대신 진짜 빈틈 탐지 15 → 4, 확인 필요 49 → 65
  weak: 0.13,
  formBonus: 0.08,
  contextWeight: 0.5,
  shortClauseChars: 40,
  coverageFloor: 0.4,
  minSharedKeywords: 1,
  // 아래 세 설정 추가 (2026-11-11). 컬프 2023 정답 3순위 적중 83.8% → 88.2% (skipSections) → 92.6% (synonyms) → 95.6% (taskWeight).
  // 템플릿 원천 SOP 자기 점검은 106/107 그대로.
  taskWeight: 1,
  // 트리거 단어 조건 추가 (2026-11-11, "있음"을 더 깐깐하게). 컬프 2023에서 없는 의무를 "있음"으로 본 오류 3 → 0,
  // 대신 정답 조항이 있는 의무 중 "있음" 35 → 26 (나머지는 확인 필요). 원천 SOP에서는 107건 중 103건이 "있음".
  requireTriggerWord: true,
  genericWordRatio: 0.1,
  triggerExemptScore: 0.6,
  synonyms: {
    장비: ['기기'],
    폐기: ['불용'],
    업무분담: ['역할분담', '역할 분담'],
    기관장: ['기관의 장'],
    폐사: ['사망'],
  },
  skipSections: ['목적', '적용', '적용범위', '용어', '용어정의', '용어정의및약어', '서식', '관련서식', '작업기록지', '관련표준', '참고문헌', '참고자료'],
};

export interface MatchCandidate {
  clauseId: string;
  sop: string;
  sopTitle: string;
  path: string;
  text: string;
  score: number;
  similarity: number;
  formHits: string[];
  sharedKeywords: string[];
  /** 조항(상위 조항·SOP 제목 포함)에 나오는 트리거 단어 */
  triggerHits: string[];
}

/** matched: 있음, weak: 확인 필요, none: 회사 SOP에 해당 조항 없음 */
export type MatchStatus = 'matched' | 'weak' | 'none';

export const STATUS_LABELS: Record<MatchStatus, string> = { matched: '있음', weak: '확인 필요', none: '없음' };

export interface TemplateMatch {
  template: TemplateObligation;
  status: MatchStatus;
  /** 판정 이유 (검토자에게 보여줌) */
  reason: string;
  /** 템플릿 키워드 중 회사 SOP 어딘가에 나오는 비율 (0~1) */
  keywordCoverage: number;
  /** 회사 SOP 어디에도 나오지 않는 템플릿 키워드 */
  missingKeywords: string[];
  candidates: MatchCandidate[];
}

interface Doc {
  clause: Clause;
  sopTitle: string;
  vec: Vector;
  /** 짧은 조항 감점 계수 (0~1) */
  lengthFactor: number;
  /** 공백을 뺀 조항 글 + 조항이 언급한 서식 이름 (서식 이름 찾기용) */
  squashed: string;
  /** squashed + 상위 조항 글 + SOP 제목 (트리거 단어 찾기용) */
  contextSquashed: string;
  ancestors: Set<string>;
  /** 후보로 내놓을 수 있는 조항인가 (skipSections 아래가 아님) */
  eligible: boolean;
}

export function matchTemplates(templates: TemplateSet, parsed: ParsedSopSet, options: Partial<MatchOptions> = {}): TemplateMatch[] {
  const opt = { ...DEFAULT_MATCH_OPTIONS, ...options };
  const norm = synonymNormalizer(opt.synonyms);
  const formName = new Map(parsed.forms.map((f) => [f.code, f.name]));
  const idf = new Idf();
  const skip = new Set(opt.skipSections.map(squash));
  const raw: { clause: Clause; sopTitle: string; tf: Vector; squashed: string; ancestors: Set<string>; contextSquashed: string; eligible: boolean }[] = [];

  for (const sop of parsed.sops) {
    const byId = new Map(sop.clauses.map((c) => [c.id, c]));
    for (const clause of sop.clauses) {
      const own = norm(ownText(clause));
      const ancestors: Clause[] = [];
      for (let p = clause.parentId ? byId.get(clause.parentId) : undefined; p; p = p.parentId ? byId.get(p.parentId) : undefined) ancestors.push(p);
      const chapter = ancestors.length ? ancestors[ancestors.length - 1] : clause;
      const tf = termFreq(own);
      termFreq(norm(ancestors.map((a) => a.text).join(' ')), opt.contextWeight, tf);
      termFreq(norm(sop.title), opt.contextWeight, tf);
      idf.add(tf);
      const cited = norm(clause.formRefs.map((c) => formName.get(c) ?? '').join(' '));
      raw.push({
        clause,
        sopTitle: sop.title,
        tf,
        squashed: squash(own + cited),
        contextSquashed: squash(own + cited + norm(ancestors.map((a) => a.text).join(' ') + sop.title)).toLowerCase(),
        ancestors: new Set(ancestors.map((a) => a.id)),
        eligible: !skip.has(squash(chapter.text)),
      });
    }
  }
  const docs: Doc[] = raw.map((r) => {
    const chars = squash(r.clause.text).length + r.clause.tables.reduce((n, t) => n + squash(t.rows.flat().join('')).length, 0);
    return { ...r, vec: idf.weigh(r.tf), lengthFactor: Math.min(1, Math.sqrt(chars / opt.shortClauseChars)) };
  });
  // 키워드가 SOP 어디엔가 있는지 볼 때는 조사가 붙은 형태("수질검사는")도 잡도록 공백 없는 전체 글에서 찾는다.
  const corpus = docs.map((d) => d.squashed).join('\n');
  const lowerDocs = docs.map((d) => d.squashed.toLowerCase());
  const isGeneric = (w: string) => lowerDocs.filter((d) => d.includes(w)).length >= docs.length * opt.genericWordRatio;

  return templates.obligations.map((t) => {
    const tv = idf.weigh(termFreq(norm(`${t.task} ${t.trigger}`), opt.taskWeight, termFreq(norm(t.match.profile))));
    const formKeys = t.match.formNames.map((f) => squash(norm(f))).map((k) => (k.length >= 4 ? k : ''));
    const keywords = t.match.keywords.map((k) => squash(norm(k)));
    const triggerWords = [...new Set(keywordsOf(norm(t.trigger)))].filter((w) => !isGeneric(w));
    const scored = docs.filter((d) => d.eligible).map((d) => {
      const similarity = cosine(tv, d.vec) * d.lengthFactor;
      const formHits = t.match.formNames.filter((_, i) => formKeys[i] && d.squashed.includes(formKeys[i]));
      return { d, similarity, formHits, score: similarity + Math.min(2, formHits.length) * opt.formBonus };
    });
    scored.sort((a, b) => b.score - a.score);

    // 같은 조항의 상·하위가 후보를 다 차지하지 않게, 이미 고른 조항의 조상·자손은 건너뛴다.
    const picked: typeof scored = [];
    for (const s of scored) {
      if (picked.length >= opt.topK) break;
      const related = picked.some((p) => p.d.ancestors.has(s.d.clause.id) || s.d.ancestors.has(p.d.clause.id));
      if (!related) picked.push(s);
    }

    const candidates: MatchCandidate[] = picked.map(({ d, similarity, formHits, score }) => ({
      clauseId: d.clause.id,
      sop: d.clause.sop,
      sopTitle: d.sopTitle,
      path: d.clause.path,
      text: d.clause.text,
      score: round(score),
      similarity: round(similarity),
      formHits,
      sharedKeywords: t.match.keywords.filter((_, i) => d.squashed.includes(keywords[i])),
      triggerHits: triggerWords.filter((w) => d.contextSquashed.includes(w)),
    }));

    const missingKeywords = t.match.keywords.filter((_, i) => !corpus.includes(keywords[i]));
    const keywordCoverage = keywords.length ? 1 - missingKeywords.length / keywords.length : 1;
    const top = candidates[0];
    const { status, reason } = judge(top, keywordCoverage, missingKeywords, triggerWords, opt);
    return { template: t, status, reason, keywordCoverage: round(keywordCoverage), missingKeywords, candidates };
  });
}

/**
 * 있음 / 확인 필요 / 없음 판정.
 * "없는 의무를 있다고 판정"하는 오류가 가장 위험하므로(사용자가 빈틈을 놓친다), "있음"은 근거가 겹칠 때만 준다.
 */
function judge(
  top: MatchCandidate | undefined,
  coverage: number,
  missing: string[],
  triggerWords: string[],
  opt: MatchOptions,
): { status: MatchStatus; reason: string } {
  const score = top?.score ?? 0;
  if (score < opt.weak) return { status: 'none', reason: `가장 비슷한 조항도 점수 ${score.toFixed(2)} (기준 ${opt.weak} 미만)` };
  if (score < opt.strong && coverage < opt.coverageFloor) {
    return { status: 'none', reason: `핵심 단어가 SOP에 거의 없음 (${Math.round(coverage * 100)}%, 없는 단어: ${missing.slice(0, 5).join(', ')})` };
  }
  const triggerMissing = opt.requireTriggerWord && score < opt.triggerExemptScore && triggerWords.length > 0 && !top?.triggerHits.length;
  if (score >= opt.strong && top && triggerMissing) {
    return { status: 'weak', reason: `점수 ${score.toFixed(2)}이나 조항에 트리거 단어(${triggerWords.join(', ')})가 없음` };
  }
  if (score >= opt.strong && top && top.sharedKeywords.length + (top.formHits.length ? 1 : 0) >= opt.minSharedKeywords) {
    return { status: 'matched', reason: `점수 ${score.toFixed(2)}, 공통 키워드 ${top.sharedKeywords.slice(0, 4).join(', ') || '-'}${top.formHits.length ? `, 서식 ${top.formHits.join(', ')}` : ''}` };
  }
  return { status: 'weak', reason: score >= opt.strong ? `점수 ${score.toFixed(2)}이나 공통 키워드·서식이 없음` : `점수 ${score.toFixed(2)} (확인 필요 구간)` };
}

/** 같은 뜻의 다른 표현을 대표어로 바꾸는 함수 */
export function synonymNormalizer(synonyms: Record<string, string[]>): (text: string) => string {
  const pairs = Object.entries(synonyms)
    .flatMap(([canon, variants]) => variants.map((v) => [v, canon] as const))
    .sort((a, b) => b[0].length - a[0].length);
  if (!pairs.length) return (text) => text;
  const re = new RegExp(pairs.map(([v]) => v.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|'), 'g');
  const to = new Map(pairs);
  return (text) => text.replace(re, (m) => to.get(m) ?? m);
}

function ownText(c: Clause): string {
  return [c.text, ...c.tables.map((t) => t.rows.map((r) => r.join(' ')).join(' '))].join(' ');
}

function round(x: number): number {
  return Math.round(x * 1000) / 1000;
}
