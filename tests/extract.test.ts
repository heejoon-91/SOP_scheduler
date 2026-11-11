import { readFile } from 'node:fs/promises';
import { beforeAll, describe, expect, it } from 'vitest';
import { DEFAULT_EXTRACT_CONFIG, extractCandidates, type Candidate } from '../src/core/extract/candidates';
import { compileDeadlines, findDeadlines } from '../src/core/extract/deadlines';
import { describeRule } from '../src/core/extract/describe';
import { parseHwpx } from '../src/core/hwpx';

const compiled = compileDeadlines(DEFAULT_EXTRACT_CONFIG.deadlines, DEFAULT_EXTRACT_CONFIG.anchors);
const rules = (text: string, ctx = '') => findDeadlines(text, compiled, ctx).map((d) => describeRule(d.rule));

describe('기한 문구 → 규칙 초안', () => {
  it.each([
    ['접수일부터 7일 이내에 검토한다', ['접수일 +7일']],
    ['알게 된 즉시', ['발생 시각 즉시']],
    ['다음 근무일까지 보낸다', ['발생 시각 +1근무일']],
    ['48시간을 넘지 않는다. 사망 또는 생명을 위협하는 경우에는 24시간 이내에 보고한다', ['발생 시각 +48시간', '발생 시각 +24시간']],
    ['보관기간은 해당 시험의 결과보고서 확정일부터 1년으로 한다', ['만료: 결과보고서 확정일 +1년']],
    ['시험 종료일부터 3년간 보관하고', ['만료: 시험 종료일 +3년']],
    ['시험 개시 전에 점검한다', ['선행 조건: 시험 개시 전']],
    ['수질검사는 연 2회 실시하며', ['반복: 6개월마다']],
    ['매월 1·11·21일 교체한다', ['반복: 매월 1·11·21일']],
    ['2주 1회 멸균', ['반복: 2주마다']],
    ['작업일마다 확인하여', ['반복: 근무일마다']],
    ['정기적으로 검토하고', ['미정 (정기적으로)']],
    ['매년 초 계획을 세운다', ['미정 (매년 초)']],
  ])('%s', (text, expected) => {
    expect(rules(text)).toEqual(expected);
  });

  it('앞 패턴이 잡은 구간은 다시 잡지 않는다 ("7일 전까지"는 "7일 이내"로 읽지 않음)', () => {
    expect(rules('시험 개시 7일 전까지 통보한다')).toEqual(['시험 개시일 -7일']);
  });

  it('잘못된 날짜 목록은 규칙으로 만들지 않는다', () => {
    expect(rules('매월 40일')).toEqual(['반복: 매월']);
  });
});

describe('컬프 공통 SOP 의무 후보', () => {
  let cs: Candidate[];
  const at = (sop: string, path: string) => cs.filter((c) => c.sop === `KULF/COM/${sop}` && c.path === path);

  beforeAll(async () => {
    cs = extractCandidates(await parseHwpx(await readFile('reference_SOP/컬프_공통SOP_20261110_서식재작성.hwpx')));
  }, 60_000);

  it('모든 후보가 근거 조항을 달고 있다', () => {
    expect(cs.length).toBeGreaterThan(100);
    expect(cs.every((c) => c.clauseId.startsWith(c.sop + '#'))).toBe(true);
  });

  it('후보 ID는 고유하다 (화면 목록의 key로 쓰임)', () => {
    expect(new Set(cs.map((c) => c.id)).size).toBe(cs.length);
  });

  it('목적·용어 절에서는 후보를 만들지 않는다', () => {
    expect(cs.some((c) => /^[123]\./.test(c.path) && /말한다\.?$/.test(c.text))).toBe(false);
  });

  it('중대한 이상반응: 의뢰자 보고 (COM/008 5.(1)2))', () => {
    const [c] = at('008', '5.(1)2)');
    expect(c.type).toBe('event');
    expect(c.recipients).toEqual(['시험의뢰자']);
    expect(c.deadlines.map((d) => d.phrase)).toEqual(['48시간을 넘지', '24시간 이내']);
    expect(c.flags).toContain('multiple_deadlines');
  });

  it('중대한 이상반응: 기관장 등 즉시 보고 (COM/008 5.(1)1))', () => {
    const [c] = at('008', '5.(1)1)');
    expect(c.deadlines[0].rule).toMatchObject({ kind: 'relative', soft: true });
  });

  it('서식이 있는 의무 (COM/008 5.(2) 이상반응 보고서)', () => {
    const [c] = at('008', '5.(2)');
    expect(c.forms).toEqual(['KULF/COM/008-1']);
    expect(c.actor).toBe('시험책임자');
  });

  it('만료: 검체 보관 (COM/011 5.(5))', () => {
    const [c] = at('011', '5.(5)');
    expect(c.type).toBe('expiry');
    expect(c.deadlines[0].rule).toEqual({ kind: 'expiry', anchor: 'study.report_finalized_at', offset: { value: 1, unit: 'year' } });
  });

  it('정기: 수질검사 연 2회 (COM/019 8.(3))', () => {
    const [c] = at('019', '8.(3)');
    expect(c.type).toBe('periodic');
  });

  it('주기 표의 행마다 후보를 만든다 (COM/017 소독제 교대 사용)', () => {
    const rows = at('017', '7.(2)').filter((c) => c.source === 'table_row');
    const rrules = rows.flatMap((c) => c.deadlines.map((d) => (d.rule.kind === 'recurring' ? d.rule.rrule : '')));
    expect(rrules).toEqual(['FREQ=MONTHLY;BYMONTHDAY=1', 'FREQ=MONTHLY;BYMONTHDAY=11', 'FREQ=MONTHLY;BYMONTHDAY=21']);
  });

  it('책임 절은 제목의 직무를 담당으로 쓴다 (COM/001 4-4 자료관리 책임자)', () => {
    const [c] = at('001', '4-4(2)');
    expect(c.actor).toBe('자료관리 책임자');
    expect(c.forms).toEqual(['KULF/COM/001-1']);
  });

  it('같은 입력에는 항상 같은 결과', async () => {
    const again = extractCandidates(await parseHwpx(await readFile('reference_SOP/컬프_공통SOP_20261110_서식재작성.hwpx')));
    expect(again).toEqual(cs);
  });
});
