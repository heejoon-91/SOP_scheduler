import { readFile } from 'node:fs/promises';
import { beforeAll, describe, expect, it } from 'vitest';
import { readXlsx } from '../scripts/lib/xlsx';
import { relate } from '../src/core/eval/compare';
import { readMatrix } from '../src/core/eval/matrix';
import { parseHwpx } from '../src/core/hwpx';
import type { Clause, ParsedSopSet } from '../src/core/model';
import { buildTemplate } from '../src/core/template/build';
import { DEFAULT_MATCH_OPTIONS, matchTemplates, synonymNormalizer } from '../src/core/template/match';
import { cosine, grams, Idf, keywordsOf, termFreq } from '../src/core/template/text';
import type { TemplateSet } from '../src/core/template/types';

describe('매칭용 텍스트', () => {
  it('단어 안의 2글자 조각으로 나눈다 (조사가 붙어도 겹침)', () => {
    expect(grams('이상반응을 보고')).toEqual(['이상', '상반', '반응', '응을', '보고']);
  });

  it('키워드는 조사를 뗀다', () => {
    expect(keywordsOf('시험책임자는 이상반응 보고서를 작성한다')).toEqual(['시험책임자', '이상반응', '보고서', '작성']);
  });

  it('같은 글은 유사도 1, 겹치는 조각이 없으면 0', () => {
    const idf = new Idf();
    const a = termFreq('중대한 이상반응 보고');
    const b = termFreq('사육실 온도 기록');
    idf.add(a);
    idf.add(b);
    expect(cosine(idf.weigh(a), idf.weigh(a))).toBeCloseTo(1);
    expect(cosine(idf.weigh(a), idf.weigh(b))).toBe(0);
  });
});

describe('같은 뜻 말 바꾸기', () => {
  const norm = synonymNormalizer({ 업무분담: ['역할분담', '역할 분담'], 장비: ['기기'] });

  it('다른 표현을 대표어로 바꾼다 (띄어 쓴 표현 포함)', () => {
    expect(norm('임상시험부서내의 역할 분담표')).toBe('임상시험부서내의 업무분담표');
    expect(norm('관리기기의 점검')).toBe('관리장비의 점검');
  });

  it('표가 비면 글을 그대로 둔다', () => {
    expect(synonymNormalizer({})('관리기기')).toBe('관리기기');
  });

  it('기본 표에 뜻이 둘인 "보정"(교정 / 동물 보정)은 없다', () => {
    expect(Object.values(DEFAULT_MATCH_OPTIONS.synonyms).flat()).not.toContain('보정');
  });
});

describe('"있음" 판정의 트리거 단어 조건', () => {
  const clause = (path: string, text: string): Clause => ({
    id: `X/A/001#${path}`, sop: 'X/A/001', path, label: path, level: 1, parentId: null, text, hash: '', tables: [], formRefs: [], sopRefs: [],
  });
  const filler = Array.from({ length: 30 }, (_, i) => clause(`${i + 10}.`, `사육실 온도 ${i}도 확인 기록 및 청소 작업 ${i}회 실시`));
  const parsedOf = (text: string): ParsedSopSet => ({ toc: [], sops: [{ id: 'X/A/001', code: 'X/A/001', title: '기록 관리', clauses: [clause('1.', text), ...filler] }], forms: [], warnings: [] });
  const template = (trigger: string): TemplateSet => ({
    name: 't', version: '0', createdAt: '', sources: [], notice: '',
    obligations: [{
      id: 'T1', no: 1, type: 'event', stage: '', trigger, task: '시정 및 재발방지 조치 내용을 문서로 작성하여 회신',
      deadlineText: '', deadlineDraft: [], forms: [], formText: '', actor: '', recipients: '', source: [], legalBasis: [],
      match: { keywords: ['시정', '재발방지', '회신'], formNames: [], profile: '시정 및 재발방지 조치 내용을 문서로 작성하여 회신' },
      status: 'draft',
    }],
  });
  const text = '담당자는 감독자의 시정 요청을 받으면 시정 및 재발방지 조치 내용을 문서로 작성하여 회신한다.';

  it('조항에 트리거 단어가 없으면 점수가 높아도 "확인 필요"', () => {
    const [r] = matchTemplates(template('QA 점검 부적합'), parsedOf(text), { triggerExemptScore: 2 });
    expect(r.candidates[0].score).toBeGreaterThanOrEqual(DEFAULT_MATCH_OPTIONS.strong);
    expect(r.status).toBe('weak');
    expect(r.reason).toMatch(/트리거 단어/);
  });

  it('조항에 트리거 단어가 있으면 "있음"', () => {
    const [r] = matchTemplates(template('감독자 시정 요청'), parsedOf(text), { triggerExemptScore: 2 });
    expect(r.status).toBe('matched');
    expect(r.candidates[0].triggerHits).toContain('감독자');
  });

  it('점수가 면제 기준 이상이면 트리거 단어가 없어도 "있음"', () => {
    const [r] = matchTemplates(template('QA 점검 부적합'), parsedOf(text), { triggerExemptScore: 0.36 });
    expect(r.candidates[0].score).toBeGreaterThanOrEqual(0.36);
    expect(r.status).toBe('matched');
  });
});

describe('컬프 매트릭스 → 기본 템플릿', () => {
  let parsed: ParsedSopSet;
  let set: TemplateSet;

  beforeAll(async () => {
    parsed = await parseHwpx(await readFile('reference_SOP/컬프_공통SOP_20261110_서식재작성.hwpx'));
    const sheets = await readXlsx(await readFile('reference_SOP/KULF_공통SOP_의무매트릭스.xlsx'));
    const matrix = readMatrix(sheets.find((s) => /매트릭스/.test(s.name))!.rows);
    set = buildTemplate(matrix, parsed, { name: 't', version: '0', idPrefix: 'T', sources: [] });
  }, 60_000);

  it('107건 모두 근거 조항 원문과 매칭 키워드를 가진다', () => {
    expect(set.obligations).toHaveLength(107);
    expect(set.obligations.every((o) => o.source.length > 0 && o.match.keywords.length > 0 && o.status === 'draft')).toBe(true);
  });

  it('기한 문구를 규칙 초안으로 바꾼다 (중대한 이상반응: 즉시, 48h, 24h)', () => {
    const sae = set.obligations.find((o) => o.no === 64)!;
    expect(sae.type).toBe('event');
    expect(sae.deadlineDraft.map((d) => d.phrase)).toEqual(['즉시', '48h', '24h']);
    expect(sae.forms).toEqual([{ code: 'KULF/COM/008-1', name: '이상반응 보고서' }]);
  });

  it('만료 기간은 트리거 칸에서 읽는다 (검체 보관: 결과보고서 확정일 + 1년)', () => {
    const o = set.obligations.find((o) => o.no === 102)!;
    expect(o.deadlineDraft[0].rule).toEqual({ kind: 'expiry', anchor: 'study.report_finalized_at', offset: { value: 1, unit: 'year' } });
  });

  it('자기 점검: 템플릿을 만든 SOP에 다시 연결하면 근거 조항이 3순위 안에 든다 (95% 이상)', () => {
    const results = matchTemplates(set, parsed);
    const hit = results.filter((r) =>
      r.candidates.some((c) => r.template.source.some((s) => s.sop === c.sop && (!s.path || ['exact', 'child', 'parent'].includes(relate(s.path, c.path) ?? '')))),
    );
    expect(hit.length / results.length).toBeGreaterThanOrEqual(0.95);
  });

  it('서식 목록·목적·적용범위 장의 조항은 후보로 내놓지 않는다', () => {
    const chapter = new Map<string, string>();
    for (const sop of parsed.sops) {
      const byId = new Map(sop.clauses.map((c) => [c.id, c]));
      for (const c of sop.clauses) {
        let top = c;
        while (top.parentId) top = byId.get(top.parentId)!;
        chapter.set(c.id, top.text.replace(/\s+/g, ''));
      }
    }
    const skip = new Set(DEFAULT_MATCH_OPTIONS.skipSections);
    const offenders = matchTemplates(set, parsed).flatMap((r) => r.candidates.filter((c) => skip.has(chapter.get(c.clauseId)!)));
    expect(offenders).toEqual([]);
  });

  it('트리거 단어 조건을 끄면 "있음"이 줄지 않는다 (조건은 "있음"을 깎기만 한다)', () => {
    const on = matchTemplates(set, parsed).filter((r) => r.status === 'matched').length;
    const off = matchTemplates(set, parsed, { requireTriggerWord: false }).filter((r) => r.status === 'matched').length;
    expect(off).toBeGreaterThanOrEqual(on);
  });

  it('같은 입력에는 항상 같은 연결 결과', () => {
    const a = matchTemplates(set, parsed).map((r) => r.candidates.map((c) => c.clauseId));
    const b = matchTemplates(set, parsed).map((r) => r.candidates.map((c) => c.clauseId));
    expect(a).toEqual(b);
  });
});
