import { readFile } from 'node:fs/promises';
import { beforeAll, describe, expect, it } from 'vitest';
import { parseHwpx } from '../src/core/hwpx';
import type { ParsedSopSet, Sop } from '../src/core/model';
import type { Block } from '../src/core/hwpx/blocks';
import { segment } from '../src/core/hwpx/segment';

const CULF = 'reference_SOP/컬프_공통SOP_20261110_서식재작성.hwpx';

let parsed: ParsedSopSet;
const sop = (code: string): Sop => parsed.sops.find((s) => s.code === `KULF/COM/${code}`)!;
const clause = (code: string, path: string) => sop(code).clauses.find((c) => c.path === path);

beforeAll(async () => {
  parsed = await parseHwpx(await readFile(CULF));
}, 60_000);

describe('컬프 공통 SOP 파싱', () => {
  it('목차의 SOP 23개를 모두 본문에서 찾는다', () => {
    expect(parsed.toc).toHaveLength(23);
    expect(parsed.sops.map((s) => s.code)).toEqual(parsed.toc.map((t) => t.code));
  });

  it('서식 목록과 서식 페이지가 모두 짝이 맞는다', () => {
    expect(parsed.forms.length).toBeGreaterThan(30);
    expect(parsed.forms.every((f) => f.inList && f.hasPage)).toBe(true);
    expect(parsed.forms.find((f) => f.code === 'KULF/COM/008-1')?.name).toBe('이상반응 보고서');
  });

  it('조항 경로를 재구성한다: COM/008 5.(1)2) 의뢰자 보고 기한', () => {
    const c = clause('008', '5.(1)2)');
    expect(c?.text).toContain('48시간');
    expect(c?.text).toContain('24시간');
    expect(c?.parentId).toBe('KULF/COM/008#5.(1)');
  });

  it('형광펜 문단도 빠짐없이 읽는다 (COM/001 8.)', () => {
    expect(clause('001', '8.')?.text).toBe('구판 및 사용중단 SOP의 처리');
    expect(clause('001', '8.(2)')?.text).toContain('SOP 관리대장(KULF/COM/001-1)');
  });

  it('서식 참조와 SOP 상호참조를 뽑는다', () => {
    expect(clause('008', '5.(2)')?.formRefs).toEqual(['KULF/COM/008-1']);
    expect(clause('008', '5.(5)')?.sopRefs).toEqual(['KULF/COM/006']);
    // "7. 폐사 동물"은 제목이고, 본문은 그 아래 번호 없는 문단(7.¶1)이다.
    expect(clause('008', '7.')?.text).toBe('폐사 동물');
    expect(clause('008', '7.¶1')?.sopRefs).toEqual(['KULF/COM/023']);
  });

  it('서식 제목이 직전 조항 본문으로 새지 않는다', () => {
    const last = sop('008').clauses.at(-1)!;
    expect(last.path).toBe('8.(1)');
    expect(sop('008').clauses.some((c) => c.level === 0 && c.text === '이상반응 보고서')).toBe(false);
  });

  it('주기 표의 병합 셀을 풀어 각 행에 채운다 (COM/019)', () => {
    const table = sop('019').clauses.flatMap((c) => c.tables).find((t) => t.rows[0].includes('주기'))!;
    expect(table.rows[1][0]).toBe('마우스, 랫드');
    expect(table.rows[2][0]).toBe('마우스, 랫드');
    expect(table.rows[2][2]).toBe('교환 주 1회 이상');
  });

  it('같은 번호가 두 번 나와도 조항 ID는 고유하다 (COM/003 3.(5) 두 번)', () => {
    const ids = parsed.sops.flatMap((s) => s.clauses.map((c) => c.id));
    expect(new Set(ids).size).toBe(ids.length);
    const dup = sop('003').clauses.filter((c) => c.path === '3.(5)');
    expect(dup.map((c) => c.id)).toEqual(['KULF/COM/003#3.(5)', 'KULF/COM/003#3.(5)~2']);
  });

  it('번호 건너뜀 경고로 SOP 원문의 편집 메모를 잡는다 (COM/003 3.)', () => {
    expect(parsed.warnings.some((w) => w.startsWith('KULF/COM/003 3. 아래'))).toBe(true);
  });
});

describe('번호가 겹치는 문서', () => {
  it('같은 SOP 번호가 두 번 나오면 ID를 구분하고 경고한다', () => {
    const header = (code: string, title: string): Block => ({ type: 'table', table: { rows: [['Title', title], ['SOP No.', code]] } });
    const para = (text: string): Block => ({ type: 'para', text });
    const set = segment([
      header('KULF/CTM/002', '조직 관리'), para('1. 목적'), para('(1) 조직도를 유지한다.'),
      header('KULF/CTM/002', '사육관리'), para('1. 목적'), para('(1) 사육실을 점검한다.'),
    ]);
    expect(set.sops.map((s) => [s.id, s.code])).toEqual([['KULF/CTM/002', 'KULF/CTM/002'], ['KULF/CTM/002~2', 'KULF/CTM/002']]);
    const ids = set.sops.flatMap((s) => s.clauses.map((c) => c.id));
    expect(new Set(ids).size).toBe(ids.length);
    expect(set.sops[1].clauses[1].id).toBe('KULF/CTM/002~2#1.(1)');
    expect(set.warnings.some((w) => w.includes('SOP 번호 중복'))).toBe(true);
    // 두 번째 SOP의 "1."은 첫 SOP와 별개로 센다 (번호 건너뜀 오경고 없음)
    expect(set.warnings.filter((w) => w.includes('앞 번호'))).toEqual([]);
  });
});

describe('서식 코드가 서식 내용 뒤에 오는 문서 (검본·컬프 2023 형식)', () => {
  const header = (code: string, title: string): Block => ({ type: 'table', table: { rows: [['Title', title], ['SOP No.', code]] } });
  const para = (text: string): Block => ({ type: 'para', text });
  const table = (...rows: string[][]): Block => ({ type: 'table', table: { rows } });

  it('서식 제목부터 코드까지를 본문에서 빼고 서식 페이지로 표시한다', () => {
    const set = segment([
      table(['SOP 및 서식의 작성 및 관리', 'KULF/CTM/001', 'SOP검토기록지', 'KULF/CTM/001-1'], ['', '', 'SOP관리기록지', 'KULF/CTM/001-2']),
      header('KULF/CTM/001', 'SOP 및 서식의 작성 및 관리'),
      para('1. 목적'),
      para('(1) SOP 검토기록지를 작성한다.'),
      para('2. 작업기록지'),
      para('(1) SOP 검토기록지(KULF/CTM/001-1)'),
      // 첫 서식: 제목 → 표 → 코드 (번호 매긴 문단이 섞여 있어도 본문으로 남지 않아야 함)
      para('SOP 검토기록지'),
      table(['SOP 번호', '', '검토의뢰개시일', '']),
      para('1. 검토 의견'),
      para('KULF/CTM/001-1'),
      // 둘째 서식
      para('SOP 관리기록지'),
      table(['SOP 번호', '효력발생일']),
      para('KULF/ CTM/001-2'),
    ]);
    const s = set.sops[0];
    expect(s.clauses.map((c) => c.path)).toEqual(['1.', '1.(1)', '2.', '2.(1)']);
    expect(s.clauses.every((c) => c.tables.length === 0)).toBe(true);
    expect(set.forms.map((f) => [f.code, f.hasPage])).toEqual([['KULF/CTM/001-1', true], ['KULF/CTM/001-2', true]]);
    // 서식 안의 "1. 검토 의견" 때문에 생겼던 번호 경고는 함께 되돌린다
    expect(set.warnings).toEqual([]);
  });

  it('본문이 서식 코드를 문장 속에서 언급하는 것은 서식 페이지로 보지 않는다', () => {
    const set = segment([header('KULF/CTM/001', 'X'), para('1. 목적'), para('(1) 기록지(KULF/CTM/001-1)에 기록한다.')]);
    expect(set.sops[0].clauses).toHaveLength(2);
    expect(set.forms).toEqual([]);
  });
});
