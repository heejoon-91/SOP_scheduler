/**
 * xlsx의 시트 구조를 빠르게 확인한다. 사용: npx tsx scripts/dump-xlsx.ts <파일.xlsx> [행 수]
 */
import { readFile } from 'node:fs/promises';
import { readXlsx } from './lib/xlsx';

const [file, n = '8'] = process.argv.slice(2);
const sheets = await readXlsx(await readFile(file));
for (const s of sheets) {
  console.log(`=== ${s.name} rows=${s.rows.length} cols=${s.rows[0]?.length ?? 0}`);
  for (const r of s.rows.slice(0, Number(n))) console.log(JSON.stringify(r.map((v) => v.slice(0, 50))));
}
