import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { readXlsx } from '../scripts/lib/xlsx';
import { compareWithMatrix, relate } from '../src/core/eval/compare';
import { expandPath, parseForms, parseRefs, readMatrix } from '../src/core/eval/matrix';
import { extractCandidates } from '../src/core/extract/candidates';
import { parseHwpx } from '../src/core/hwpx';

describe('매트릭스 근거 SOP 표기 읽기', () => {
  it.each([
    ['COM/019 5.(1), COM/021 3.(1)', ['KULF/COM/019#5.(1)', 'KULF/COM/021#3.(1)']],
    ['COM/019 6, 9.(1)', ['KULF/COM/019#6.', 'KULF/COM/019#9.(1)']],
    ['COM/017 7.(2)(3)', ['KULF/COM/017#7.(2)', 'KULF/COM/017#7.(3)']],
    ['COM/012 6.(5)~(7)', ['KULF/COM/012#6.(5)', 'KULF/COM/012#6.(6)', 'KULF/COM/012#6.(7)']],
    ['COM/001 6~7, 9', ['KULF/COM/001#6.', 'KULF/COM/001#7.', 'KULF/COM/001#9.']],
    ['COM/003 5-2(5)', ['KULF/COM/003#5-2(5)']],
    ['COM/009', ['KULF/COM/009#']],
    ['COM/019 서식', ['KULF/COM/019#']],
  ])('%s', (text, expected) => {
    expect(parseRefs(text).map((r) => `${r.sop}#${r.path}`)).toEqual(expected);
  });

  it('범위가 거꾸로면 앞 번호만', () => {
    expect(expandPath('7~5')).toEqual(['7.']);
  });

  it('서식 칸에서 서식 코드를 읽는다', () => {
    expect(parseForms('019-1 사육관리 기록지 / 021-1(관찰)', 'COM/019 5.(1)')).toEqual(['KULF/COM/019-1', 'KULF/COM/021-1']);
    expect(parseForms('※ 기록 서식 없음 (검토 메모 2)', 'COM/012 6.(3)')).toEqual([]);
  });
});

describe('조항 관계', () => {
  it.each([
    ['5.', '5.(1)', 'child'],
    ['5.(1)', '5.(1)2)', 'child'],
    ['5.', '5.¶1', 'child'],
    ['5.(1)2)', '5.(1)', 'parent'],
    ['5.(1)', '5.(1)', 'exact'],
    ['1.', '10.(1)', null],
    ['6.(1)', '6.(10)', null],
    ['4-1', '4-1(2)', 'child'],
    ['4-1', '4-10', null],
    ['6.', '6-1(1)', 'child'],
    ['6.', '6-1', 'child'],
    ['1.', '10-1', null],
    ['', '3.(2)', 'sop'],
  ])('%s ↔ %s', (ref, path, expected) => {
    expect(relate(ref, path)).toBe(expected);
  });
});

describe('컬프 매트릭스 대조', () => {
  it('107건을 읽고, 모든 근거 경로가 SOP에 있다', async () => {
    const parsed = await parseHwpx(await readFile('reference_SOP/컬프_공통SOP_20261110_서식재작성.hwpx'));
    const sheets = await readXlsx(await readFile('reference_SOP/KULF_공통SOP_의무매트릭스.xlsx'));
    const matrix = readMatrix(sheets.find((s) => /매트릭스/.test(s.name))!.rows);
    expect(matrix).toHaveLength(107);
    expect(matrix.filter((r) => r.type === '수시 이벤트')).toHaveLength(42);

    const report = compareWithMatrix(matrix, extractCandidates(parsed), parsed);
    expect(report.rows.flatMap((r) => r.unknownRefs)).toEqual([]);
    // 기준선: 규칙을 바꾸다 재현율이 떨어지면 여기서 잡힌다 (컬프 SOP는 규칙을 맞춘 자료라 이 값은 상한에 가깝다)
    expect(report.summary.recall).toBeGreaterThanOrEqual(0.95);
  }, 60_000);
});
