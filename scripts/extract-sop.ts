/**
 * 화면 없이 HWPX SOP에서 의무 후보를 규칙으로 뽑아 검토용 표(CSV, 엑셀에서 열림)와 JSON으로 저장한다.
 * 사용: npm run extract -- <파일.hwpx>
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { extractCandidates, FLAG_LABELS, TYPE_LABELS, type Candidate } from '../src/core/extract/candidates';
import { describeRule } from '../src/core/extract/describe';
import { parseHwpx } from '../src/core/hwpx';

const [input] = process.argv.slice(2);
if (!input) {
  console.error('사용: npm run extract -- <파일.hwpx>');
  process.exit(1);
}

const parsed = await parseHwpx(await readFile(input));
const candidates = extractCandidates(parsed);
const name = basename(input).replace(/\.hwpx$/i, '');
await mkdir('out', { recursive: true });

const header = ['번호', 'SOP', '조항', '출처', '유형', '유형 근거', '강도', '상위 조항', '본문', '조건(트리거)', '담당', '보고처', '서식', '기한 문구', '기한 규칙 초안', '플래그'];
const rows = candidates.map((c, i) => [
  i + 1,
  c.sop,
  c.path,
  c.source === 'table_row' ? `표 ${c.rowIndex}행` : '조항',
  TYPE_LABELS[c.type],
  c.typeReason,
  c.strength === 'strong' ? '강' : '중',
  c.context.join(' › '),
  c.text,
  c.trigger ?? '',
  c.actor ?? '',
  c.recipients.join(', '),
  c.forms.join(', '),
  c.deadlines.map((d) => d.phrase).join(' / '),
  c.deadlines.map((d) => describeRule(d.rule)).join(' / '),
  c.flags.map((f) => FLAG_LABELS[f]).join(', '),
]);
const csv = '﻿' + [header, ...rows].map((r) => r.map(csvCell).join(',')).join('\r\n');
const csvPath = join('out', `${name}.candidates.csv`);
await writeFile(csvPath, csv, 'utf-8');
await writeFile(join('out', `${name}.candidates.json`), JSON.stringify(candidates, null, 2), 'utf-8');

printSummary(candidates);
console.log(`검토용 표: ${csvPath}`);

function csvCell(v: unknown): string {
  const s = String(v ?? '');
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function printSummary(cs: Candidate[]) {
  const count = <K extends string>(keys: K[]) => {
    const m = new Map<K, number>();
    for (const k of keys) m.set(k, (m.get(k) ?? 0) + 1);
    return [...m].map(([k, n]) => `${k} ${n}`).join(', ');
  };
  console.log(`의무 후보 ${cs.length}건 (강 ${cs.filter((c) => c.strength === 'strong').length}, 중 ${cs.filter((c) => c.strength === 'medium').length})`);
  console.log(`  유형: ${count(cs.map((c) => TYPE_LABELS[c.type]))}`);
  console.log(`  플래그: ${count(cs.flatMap((c) => c.flags.map((f) => FLAG_LABELS[f])))}`);
  console.log(`  SOP별: ${count(cs.map((c) => c.sop.split('/').pop()!))}`);
}
