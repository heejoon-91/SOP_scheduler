/**
 * 규칙 추출 결과를 정답 매트릭스와 대조한다 (설계 문서 "평가 방법").
 * 짝짓기 기준은 근거 조항 경로와 서식 코드다. 문장 유사도는 순위를 매길 때만 보조로 쓴다.
 */
import type { Candidate, ObligationType } from '../extract/candidates';
import type { Clause, ParsedSopSet } from '../model';
import type { MatrixRow } from './matrix';

/** 매트릭스 근거 조항과 후보 조항의 관계 */
export type Relation =
  /** 같은 조항 */
  | 'exact'
  /** 후보가 근거 조항의 하위 조항 (매트릭스가 "COM/004 5"처럼 장 단위로 적은 경우) */
  | 'child'
  /** 후보가 근거 조항의 상위 조항 */
  | 'parent'
  /** 매트릭스가 SOP 번호만 적은 경우, 같은 SOP의 후보 */
  | 'sop';

export interface Link {
  candidate: Candidate;
  relation: Relation;
  ref: { sop: string; path: string };
  formOverlap: boolean;
  similarity: number;
  score: number;
}

export type RowStatus =
  /** 근거 조항(또는 그 하위 조항)에서 후보를 찾음 */
  | 'found'
  /** 근거 조항 자체에는 후보가 없고, 상위 조항이나 같은 SOP에서만 관련 후보가 있음 */
  | 'related'
  | 'missed';

export interface RowResult {
  row: MatrixRow;
  status: RowStatus;
  links: Link[];
  /** 매트릭스가 가리키지만 파싱된 SOP에 없는 조항 경로 */
  unknownRefs: string[];
  /** 근거 조항이지만 후보가 되지 못한 조항 (규칙 누락 원인 분석용) */
  silentClauses: Clause[];
  /** 가장 잘 맞는 후보의 유형이 매트릭스 유형과 같은지 (found일 때만) */
  typeMatch?: boolean;
  /** 매트릭스 서식 중 하나라도 짝지은 후보에 있는지 (매트릭스에 서식이 있을 때만) */
  formMatch?: boolean;
}

export interface EvalReport {
  rows: RowResult[];
  /** 어느 매트릭스 행과도 조항으로 이어지지 않은 후보 */
  unlinked: Candidate[];
  summary: {
    total: number;
    found: number;
    related: number;
    missed: number;
    recall: number;
    byType: Record<string, { total: number; found: number }>;
    typeAgreement: { compared: number; agreed: number };
    formAgreement: { compared: number; agreed: number };
    candidates: number;
    linkedCandidates: number;
  };
}

export const MATRIX_TYPE_TO_TYPE: Record<string, ObligationType> = {
  정기: 'periodic',
  '시험 단계': 'stage',
  '수시 이벤트': 'event',
  '만료 추적': 'expiry',
};

const WEIGHT: Record<Relation, number> = { exact: 3, child: 2, parent: 1, sop: 0.5 };

export function compareWithMatrix(matrix: MatrixRow[], candidates: Candidate[], parsed: ParsedSopSet): EvalReport {
  const clausesBySop = new Map(parsed.sops.map((s) => [s.id, s.clauses]));
  const candidatesBySop = new Map<string, Candidate[]>();
  for (const c of candidates) (candidatesBySop.get(c.sop) ?? candidatesBySop.set(c.sop, []).get(c.sop)!).push(c);
  const linked = new Set<Candidate>();

  const rows: RowResult[] = matrix.map((row) => {
    const links: Link[] = [];
    const unknownRefs: string[] = [];
    const silentClauses: Clause[] = [];
    for (const ref of row.refs) {
      const clauses = clausesBySop.get(ref.sop) ?? [];
      const pool = candidatesBySop.get(ref.sop) ?? [];
      if (ref.path && !clauses.some((c) => c.path === ref.path)) unknownRefs.push(`${short(ref.sop)} ${ref.path}`);
      for (const cand of pool) {
        const relation = relate(ref.path, cand.path);
        if (!relation) continue;
        const formOverlap = row.forms.some((f) => cand.forms.includes(f));
        const similarity = dice(row.task, cand.text);
        links.push({ candidate: cand, relation, ref, formOverlap, similarity, score: WEIGHT[relation] + (formOverlap ? 1 : 0) + similarity });
      }
      // 근거 조항과 그 하위 조항 중 후보가 하나도 없는 것
      if (ref.path) {
        for (const cl of clauses) {
          if (relate(ref.path, cl.path) === 'exact' || relate(ref.path, cl.path) === 'child') {
            if (!pool.some((c) => c.clauseId === cl.id)) silentClauses.push(cl);
          }
        }
      }
    }
    links.sort((a, b) => b.score - a.score);
    for (const l of links) if (l.relation !== 'sop') linked.add(l.candidate);

    const strong = links.filter((l) => l.relation === 'exact' || l.relation === 'child' || (l.relation === 'sop' && l.formOverlap));
    const status: RowStatus = strong.length ? 'found' : links.length ? 'related' : 'missed';
    // 매트릭스 한 행은 여러 조항(후보)에 걸칠 수 있다. 짝지은 후보 중 하나라도 맞으면 검토자가 올바른 값을 볼 수 있으므로 일치로 센다.
    const expected = MATRIX_TYPE_TO_TYPE[row.type];
    const typeMatch = status === 'found' && expected ? strong.some((l) => l.candidate.type === expected) : undefined;
    const formMatch = row.forms.length
      ? strong.some((l) => [...l.candidate.forms, ...l.candidate.inheritedForms].some((f) => row.forms.includes(f)))
      : undefined;
    return { row, status, links, unknownRefs, silentClauses: uniqueBy(silentClauses, (c) => c.id), typeMatch, formMatch };
  });

  const byType: Record<string, { total: number; found: number }> = {};
  for (const r of rows) {
    const t = (byType[r.row.type] ??= { total: 0, found: 0 });
    t.total++;
    if (r.status === 'found') t.found++;
  }
  const found = rows.filter((r) => r.status === 'found').length;
  const typed = rows.filter((r) => r.typeMatch !== undefined);
  const formed = rows.filter((r) => r.formMatch !== undefined);
  return {
    rows,
    unlinked: candidates.filter((c) => !linked.has(c)),
    summary: {
      total: rows.length,
      found,
      related: rows.filter((r) => r.status === 'related').length,
      missed: rows.filter((r) => r.status === 'missed').length,
      recall: rows.length ? found / rows.length : 0,
      byType,
      typeAgreement: { compared: typed.length, agreed: typed.filter((r) => r.typeMatch).length },
      formAgreement: { compared: formed.length, agreed: formed.filter((r) => r.formMatch).length },
      candidates: candidates.length,
      linkedCandidates: linked.size,
    },
  };
}

/** 근거 조항 경로(ref)와 후보 조항 경로(path)의 관계 */
export function relate(ref: string, path: string): Relation | null {
  if (!ref) return 'sop';
  if (path === ref) return 'exact';
  if (isUnder(path, ref)) return 'child';
  if (isUnder(ref, path)) return 'parent';
  return null;
}

/** inner가 outer의 하위 경로인가. "5.(1)"은 "5."의 하위, "10.(1)"은 "1."의 하위가 아니다. */
function isUnder(inner: string, outer: string): boolean {
  // "6-1(1)"처럼 장-절 번호로 시작하는 경로는 "6." 장의 하위다 (경로가 "6."으로 시작하지 않아도).
  const chapter = /^(\d+)\.$/.exec(outer);
  if (chapter && inner.startsWith(`${chapter[1]}-`)) return true;
  if (!inner.startsWith(outer) || inner === outer) return false;
  // "4-1"(장-절)의 하위는 "4-1(2)"이고 "4-10"은 아니다.
  const next = inner[outer.length];
  return /[.)]$/.test(outer) || next === '(' || next === '¶';
}

/** 문자 2-gram Dice 유사도 (0~1). 순위 보조용 */
export function dice(a: string, b: string): number {
  const grams = (s: string) => {
    const t = s.replace(/\s+/g, '');
    const m = new Map<string, number>();
    for (let i = 0; i < t.length - 1; i++) m.set(t.slice(i, i + 2), (m.get(t.slice(i, i + 2)) ?? 0) + 1);
    return m;
  };
  const A = grams(a);
  const B = grams(b);
  let inter = 0;
  let total = 0;
  for (const [g, n] of A) {
    inter += Math.min(n, B.get(g) ?? 0);
    total += n;
  }
  for (const n of B.values()) total += n;
  return total ? (2 * inter) / total : 0;
}

function short(sop: string): string {
  return sop.split('/').slice(1).join('/');
}

function uniqueBy<T>(xs: T[], key: (x: T) => string): T[] {
  const seen = new Set<string>();
  return xs.filter((x) => (seen.has(key(x)) ? false : (seen.add(key(x)), true)));
}
