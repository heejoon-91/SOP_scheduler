/**
 * 템플릿을 만든 SOP 자신에 다시 연결해, 매칭 점수 방식이 근거 조항을 찾는지 확인한다 (자기 점검).
 * 근거 조항(또는 그 하위 조항)이 1순위 / 3순위 안에 드는 비율과 점수 분포를 낸다.
 * 사용: npx tsx scripts/selfcheck-template.ts <근거 SOP.hwpx> [템플릿.json]
 */
import { readFile } from 'node:fs/promises';
import { relate } from '../src/core/eval/compare';
import { parseHwpx } from '../src/core/hwpx';
import { matchTemplates } from '../src/core/template/match';
import type { TemplateSet } from '../src/core/template/types';

const [sopFile, templateFile = 'src/templates/kulf-com.template.json'] = process.argv.slice(2);
const templates = JSON.parse(await readFile(templateFile, 'utf-8')) as TemplateSet;
const results = matchTemplates(templates, await parseHwpx(await readFile(sopFile)));

const hitAt = (r: (typeof results)[number], k: number) =>
  r.candidates.slice(0, k).some((c) => r.template.source.some((s) => s.sop === c.sop && (!s.path || ['exact', 'child', 'parent'].includes(relate(s.path, c.path) ?? ''))));
const n = results.length;
const at1 = results.filter((r) => hitAt(r, 1)).length;
const at3 = results.filter((r) => hitAt(r, 3)).length;
console.log(`자기 점검: 근거 조항이 1순위 ${at1}/${n} (${((100 * at1) / n).toFixed(1)}%), 3순위 안 ${at3}/${n} (${((100 * at3) / n).toFixed(1)}%)`);

const hitScores = results.filter((r) => hitAt(r, 1)).map((r) => r.candidates[0].score).sort((a, b) => a - b);
const q = (xs: number[], p: number) => xs[Math.floor((xs.length - 1) * p)]?.toFixed(3);
console.log(`  1순위 적중 점수: 최소 ${q(hitScores, 0)}, 10% ${q(hitScores, 0.1)}, 중앙 ${q(hitScores, 0.5)}`);
for (const r of results.filter((r) => !hitAt(r, 3))) {
  const c = r.candidates[0];
  console.log(`  놓침 #${r.template.no} ${r.template.task.slice(0, 30)} | 근거 ${r.template.source.map((s) => s.sop.split('/').pop() + ' ' + s.path).join(', ')} | 1순위 ${c.sop.split('/').pop()} ${c.path} (${c.score})`);
}
