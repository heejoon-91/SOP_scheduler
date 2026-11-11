/**
 * 의무 매트릭스 + 근거 SOP로 기본 템플릿 초안(JSON)을 만든다.
 * 사용: npm run template:build -- <근거 SOP.hwpx> <매트릭스.xlsx> [출력.json]
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { basename, dirname } from 'node:path';
import { readMatrix } from '../src/core/eval/matrix';
import { describeRule } from '../src/core/extract/describe';
import { parseHwpx } from '../src/core/hwpx';
import { buildTemplate } from '../src/core/template/build';
import { readXlsx } from './lib/xlsx';

const [sopFile, matrixFile, out = 'src/templates/kulf-com.template.json'] = process.argv.slice(2);
if (!sopFile || !matrixFile) {
  console.error('사용: npm run template:build -- <근거 SOP.hwpx> <매트릭스.xlsx> [출력.json]');
  process.exit(1);
}

const parsed = await parseHwpx(await readFile(sopFile));
const sheets = await readXlsx(await readFile(matrixFile));
const matrix = readMatrix((sheets.find((s) => /매트릭스/.test(s.name)) ?? sheets[0]).rows);
const set = buildTemplate(matrix, parsed, {
  name: 'KULF 공통 SOP 기본 템플릿',
  version: '0.1-draft',
  idPrefix: 'KULF-COM-T',
  sources: [basename(matrixFile), basename(sopFile)],
});

await mkdir(dirname(out), { recursive: true });
await writeFile(out, JSON.stringify(set, null, 2) + '\n', 'utf-8');

const noSource = set.obligations.filter((o) => !o.source.length);
const noDeadline = set.obligations.filter((o) => !o.deadlineDraft.length);
console.log(`템플릿 ${set.obligations.length}건 → ${out}`);
console.log(`  근거 조항 원문을 못 찾은 항목: ${noSource.length}${noSource.length ? ' (' + noSource.map((o) => o.no).join(', ') + ')' : ''}`);
console.log(`  기한 규칙 초안을 못 만든 항목: ${noDeadline.length} (검수 때 직접 입력)`);
for (const o of set.obligations.slice(0, 3)) {
  console.log(`  예) ${o.id} [${o.type}] ${o.task.slice(0, 30)} | 기한 "${o.deadlineText}" → ${o.deadlineDraft.map((d) => describeRule(d.rule)).join(' / ') || '-'} | 키워드 ${o.match.keywords.slice(0, 6).join(', ')}`);
}
