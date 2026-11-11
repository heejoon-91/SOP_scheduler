/**
 * 화면 없이 HWPX SOP를 파싱해 결과를 JSON으로 저장하고 요약을 출력한다.
 * 사용: npm run parse -- <파일.hwpx> [출력.json]
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { parseHwpx } from '../src/core/hwpx';

const [input, outArg] = process.argv.slice(2);
if (!input) {
  console.error('사용: npm run parse -- <파일.hwpx> [출력.json]');
  process.exit(1);
}

const result = await parseHwpx(await readFile(input));
const out = outArg ?? join('out', basename(input).replace(/\.hwpx$/i, '') + '.parsed.json');
await mkdir(dirname(out), { recursive: true });
await writeFile(out, JSON.stringify(result, null, 2), 'utf-8');

const clauses = result.sops.reduce((n, s) => n + s.clauses.length, 0);
console.log(`SOP ${result.sops.length}개 (목차 ${result.toc.length}개), 조항 ${clauses}개, 서식 ${result.forms.length}개`);
for (const s of result.sops) {
  const tables = s.clauses.reduce((n, c) => n + c.tables.length, 0);
  console.log(`  ${s.code} ${s.title}: 조항 ${s.clauses.length}, 본문 표 ${tables}`);
}
console.log(`경고 ${result.warnings.length}건`);
for (const w of result.warnings) console.log(`  - ${w}`);
console.log(`저장: ${out}`);
