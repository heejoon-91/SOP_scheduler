/**
 * 검수용 매트릭스(정답 데이터)와 그 근거 SOP로 기본 템플릿 초안을 만든다.
 * 결과의 status는 모두 'draft'다. 실무자 검수(기한 규칙, 서식, 근거 법령)를 거쳐 'reviewed'가 된다.
 */
import { MATRIX_TYPE_TO_TYPE, relate } from '../eval/compare';
import type { MatrixRow } from '../eval/matrix';
import { DEFAULT_EXTRACT_CONFIG } from '../extract/candidates';
import { compileDeadlines, findDeadlines } from '../extract/deadlines';
import type { Clause, ParsedSopSet } from '../model';
import { keywordsOf } from './text';
import type { TemplateObligation, TemplateSet } from './types';

/** 근거 조항 원문을 대표 문장에 넣을 때의 최대 길이 (장 단위 근거가 너무 길어지지 않게) */
const MAX_SOURCE_CHARS = 1200;
const KEYWORD_COUNT = 12;

export interface BuildOptions {
  name: string;
  version: string;
  idPrefix: string;
  sources: string[];
}

export function buildTemplate(matrix: MatrixRow[], parsed: ParsedSopSet, opts: BuildOptions): TemplateSet {
  const compiled = compileDeadlines(DEFAULT_EXTRACT_CONFIG.deadlines, DEFAULT_EXTRACT_CONFIG.anchors);
  const sops = new Map(parsed.sops.map((s) => [s.id, s]));
  const formName = new Map(parsed.forms.map((f) => [f.code, f.name]));

  // 키워드 고르기용 단어 문서빈도 (근거 SOP 전체 조항 기준)
  const df = new Map<string, number>();
  let nDocs = 0;
  for (const s of parsed.sops) {
    for (const c of s.clauses) {
      nDocs++;
      for (const w of new Set(keywordsOf(c.text))) df.set(w, (df.get(w) ?? 0) + 1);
    }
  }

  const obligations: TemplateObligation[] = matrix.map((row) => {
    const source: TemplateObligation['source'] = [];
    for (const ref of row.refs) {
      const sop = sops.get(ref.sop);
      if (!sop) continue;
      if (!ref.path) {
        source.push({ sop: ref.sop, path: '', text: sop.title });
        continue;
      }
      const subtree = sop.clauses.filter((c) => {
        const r = relate(ref.path, c.path);
        return r === 'exact' || r === 'child';
      });
      if (subtree.length) source.push({ sop: ref.sop, path: ref.path, text: clip(subtree.map(fullText).join(' '), MAX_SOURCE_CHARS) });
    }

    const forms = row.forms.map((code) => ({ code, name: formName.get(code) ?? '' }));
    const formNames = forms.map((f) => f.name).filter(Boolean);
    const profile = [row.task, row.trigger, row.stage, ...source.map((s) => s.text), ...formNames].filter(Boolean).join(' ');

    // 정기·만료 의무는 주기·기간이 "트리거/주기" 칸에, 나머지는 "기한" 칸에 있어 둘 다 읽는다.
    const deadlineDraft = findDeadlines(`${row.trigger} / ${row.deadline}`, compiled).map((d) => ({ phrase: d.phrase, rule: d.rule }));

    return {
      id: `${opts.idPrefix}${String(row.no).padStart(3, '0')}`,
      no: row.no,
      type: MATRIX_TYPE_TO_TYPE[row.type] ?? 'unknown',
      stage: row.stage,
      trigger: row.trigger,
      task: row.task,
      deadlineText: row.deadline,
      deadlineDraft,
      forms,
      formText: row.formText,
      actor: row.actor,
      recipients: row.recipients,
      source,
      legalBasis: [],
      match: { keywords: topKeywords(`${row.task} ${row.trigger} ${formNames.join(' ')}`, df, nDocs), formNames, profile },
      status: 'draft',
    };
  });

  return {
    name: opts.name,
    version: opts.version,
    createdAt: new Date().toISOString(),
    sources: opts.sources,
    notice:
      '이 템플릿의 근거 조항 원문(source, match.profile)은 원천 회사 SOP의 문장을 담고 있다. 외부 배포 전에 지정규정 기준 문구로 바꿔야 한다 (설계 문서 열린 질문).',
    obligations,
  };
}

function fullText(c: Clause): string {
  return [c.text, ...c.tables.map((t) => t.rows.map((r) => r.join(' ')).join(' '))].join(' ');
}

function clip(s: string, n: number): string {
  return s.length > n ? s.slice(0, n) : s;
}

/** 할 일·트리거·서식 이름에서, 근거 SOP 전체에서 드문 단어 순으로 키워드를 고른다 */
function topKeywords(text: string, df: Map<string, number>, nDocs: number): string[] {
  const seen = new Set<string>();
  return keywordsOf(text)
    .filter((w) => (seen.has(w) ? false : (seen.add(w), true)))
    .map((w) => ({ w, idf: Math.log((nDocs + 1) / ((df.get(w) ?? 0) + 1)) }))
    .sort((a, b) => b.idf - a.idf)
    .slice(0, KEYWORD_COUNT)
    .map((x) => x.w);
}
