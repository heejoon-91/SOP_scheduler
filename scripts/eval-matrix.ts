/**
 * 규칙 추출 결과를 정답 매트릭스와 대조해 재현율 등을 내고, 검토용 표(CSV, 엑셀에서 열림)를 만든다.
 * 사용: npm run eval -- <SOP.hwpx> <매트릭스.xlsx>
 * 파이프라인을 바꿀 때마다 같은 명령으로 다시 돌려 지표를 비교한다.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { compareWithMatrix, type RowResult } from '../src/core/eval/compare';
import { readMatrix } from '../src/core/eval/matrix';
import { extractCandidates, FLAG_LABELS, TYPE_LABELS, type Candidate } from '../src/core/extract/candidates';
import { describeRule } from '../src/core/extract/describe';
import { parseHwpx } from '../src/core/hwpx';
import { readXlsx } from './lib/xlsx';

const [sopFile, matrixFile] = process.argv.slice(2);
if (!sopFile || !matrixFile) {
  console.error('사용: npm run eval -- <SOP.hwpx> <매트릭스.xlsx>');
  process.exit(1);
}

const parsed = await parseHwpx(await readFile(sopFile));
const candidates = extractCandidates(parsed);
const sheets = await readXlsx(await readFile(matrixFile));
const sheet = sheets.find((s) => /매트릭스/.test(s.name)) ?? sheets[0];
const matrix = readMatrix(sheet.rows);
const report = compareWithMatrix(matrix, candidates, parsed);

await mkdir('out/eval', { recursive: true });

// 1. 매트릭스 행별 대조
const STATUS = { found: '찾음', related: '관련만', missed: '못 찾음' } as const;
const RELATION = { exact: '같은 조항', child: '하위 조항', parent: '상위 조항', sop: '같은 SOP' } as const;
const rowsCsv = [
  ['No', '매트릭스 유형', '할 일', '근거 SOP', '서식', '트리거/주기', '기한', '결과', '규칙 후보 (최대 3)', '후보 유형', '유형 일치', '서식 일치', '후보 기한', '매트릭스 경로 확인', '후보가 되지 못한 근거 조항'],
  ...report.rows.map((r) => {
    const top = r.links.slice(0, 3);
    const best = top[0]?.candidate;
    return [
      r.row.no,
      r.row.type,
      r.row.task,
      r.row.refText,
      r.row.formText,
      r.row.trigger,
      r.row.deadline,
      STATUS[r.status],
      top.map((l) => `${short(l.candidate.sop)} ${l.candidate.path}${l.candidate.rowIndex ? ` 표${l.candidate.rowIndex}행` : ''} (${RELATION[l.relation]})`).join('\n'),
      best ? TYPE_LABELS[best.type] : '',
      yesNo(r.typeMatch),
      yesNo(r.formMatch),
      best ? best.deadlines.map((d) => `${d.phrase} → ${describeRule(d.rule)}`).join('\n') : '',
      r.unknownRefs.length ? `SOP에 없는 경로: ${r.unknownRefs.join(', ')}` : '',
      r.silentClauses.slice(0, 4).map((c) => `${short(c.sop)} ${c.path} ${c.text.slice(0, 80)}`).join('\n'),
    ];
  }),
];
await writeCsv(join('out/eval', 'matrix-vs-rules.csv'), rowsCsv);

// 2. 매트릭스에 없는 규칙 후보 (매트릭스 검수 때 빠진 의무인지 확인용)
const unlinked = [...report.unlinked].sort((a, b) => (a.strength === b.strength ? 0 : a.strength === 'strong' ? -1 : 1));
const unlinkedCsv = [
  ['SOP', '조항', '출처', '강도', '유형', '상위 조항', '본문', '서식', '기한', '담당', '플래그', '판정 (의무 맞음/아님)'],
  ...unlinked.map((c) => [
    short(c.sop),
    c.path,
    c.source === 'table_row' ? `표 ${c.rowIndex}행` : '조항',
    c.strength === 'strong' ? '강' : '중',
    TYPE_LABELS[c.type],
    c.context.join(' › '),
    c.text,
    c.forms.map((f) => f.split('/').pop()).join(', '),
    c.deadlines.map((d) => `${d.phrase} → ${describeRule(d.rule)}`).join('\n'),
    c.actor ?? '',
    c.flags.map((f) => FLAG_LABELS[f]).join(', '),
    '',
  ]),
];
await writeCsv(join('out/eval', 'rules-not-in-matrix.csv'), unlinkedCsv);
await writeFile(join('out/eval', 'report.json'), JSON.stringify(summaryJson(), null, 2), 'utf-8');

// 요약
const s = report.summary;
const pct = (a: number, b: number) => (b ? `${((100 * a) / b).toFixed(1)}%` : '-');
console.log(`매트릭스 ${s.total}건 대조 (SOP: ${sopFile})`);
console.log(`  재현율: ${pct(s.found, s.total)} (찾음 ${s.found}, 관련만 ${s.related}, 못 찾음 ${s.missed})`);
for (const [t, v] of Object.entries(s.byType)) console.log(`    ${t}: ${v.found}/${v.total} (${pct(v.found, v.total)})`);
console.log(`  유형 일치: ${pct(s.typeAgreement.agreed, s.typeAgreement.compared)} (${s.typeAgreement.agreed}/${s.typeAgreement.compared})`);
console.log(`  서식 일치: ${pct(s.formAgreement.agreed, s.formAgreement.compared)} (${s.formAgreement.agreed}/${s.formAgreement.compared})`);
console.log(`  규칙 후보 ${s.candidates}건 중 매트릭스와 이어진 것 ${s.linkedCandidates}건, 이어지지 않은 것 ${report.unlinked.length}건`);
const unknown = report.rows.filter((r) => r.unknownRefs.length);
if (unknown.length) console.log(`  매트릭스 근거 경로가 SOP에 없음: ${unknown.map((r) => `#${r.row.no} ${r.unknownRefs.join(', ')}`).join(' / ')}`);
console.log(`  못 찾음·관련만: ${report.rows.filter((r) => r.status !== 'found').map((r) => `#${r.row.no}`).join(' ')}`);
console.log('검토용 표: out/eval/matrix-vs-rules.csv, out/eval/rules-not-in-matrix.csv');

function summaryJson() {
  return {
    sopFile,
    matrixFile,
    summary: report.summary,
    notFound: report.rows.filter((r) => r.status !== 'found').map(rowBrief),
  };
}

function rowBrief(r: RowResult) {
  return {
    no: r.row.no,
    type: r.row.type,
    task: r.row.task,
    refs: r.row.refText,
    status: r.status,
    unknownRefs: r.unknownRefs,
    silentClauses: r.silentClauses.map((c) => ({ path: `${short(c.sop)} ${c.path}`, text: c.text })),
    related: r.links.slice(0, 3).map((l) => ({ path: `${short(l.candidate.sop)} ${l.candidate.path}`, relation: l.relation })),
  };
}

function short(sop: string): string {
  return sop.split('/').slice(1).join('/');
}

function yesNo(v: boolean | undefined): string {
  return v === undefined ? '' : v ? 'O' : 'X';
}

async function writeCsv(path: string, rows: unknown[][]) {
  const cell = (v: unknown) => {
    const s = String(v ?? '');
    return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  await writeFile(path, '﻿' + rows.map((r) => r.map(cell).join(',')).join('\r\n'), 'utf-8');
}

export type { Candidate };
