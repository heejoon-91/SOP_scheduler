/** 매칭 검수용: 템플릿별 후보와 키워드 검색 결과를 한눈에 출력한다. 사용: npx tsx scripts/review-dump.ts <parsed.json> <match.json> <from> <to> */
import { readFile } from 'node:fs/promises';
import { keywordsOf } from '../src/core/template/text';
import type { ParsedSopSet } from '../src/core/model';
import type { TemplateMatch } from '../src/core/template/match';
const [pf, mf, from, to] = process.argv.slice(2);
const parsed = JSON.parse(await readFile(pf, 'utf-8')) as ParsedSopSet;
const matches = JSON.parse(await readFile(mf, 'utf-8')) as TemplateMatch[];
const all = parsed.sops.flatMap((s) => s.clauses.map((c) => ({ c, key: `${s.id.split('/').slice(1).join('/')} ${c.path}`, text: c.text + ' ' + c.tables.map((t) => t.rows.map((r) => r.join(' ')).join(' ')).join(' ') })));
const sh = (id: string) => id.split('/').slice(1).join('/');
for (const m of matches.filter((m) => m.template.no >= +from && m.template.no <= +to)) {
  const t = m.template;
  console.log(`\n#${t.no} [${t.type}] ${t.task} | 트리거: ${t.trigger} | 기한: ${t.deadlineText} | 서식: ${t.formText}`);
  m.candidates.forEach((c, i) => console.log(`  ${i + 1}) ${sh(c.sop)} ${c.path} (${c.score}) ${c.text.slice(0, 130)}`));
  const kws = [...new Set([...t.match.keywords, ...keywordsOf(t.task)])].filter((k) => k.length >= 2);
  const shown = new Set(m.candidates.map((c) => c.clauseId));
  const hits = all.filter((x) => !shown.has(x.c.id)).map((x) => ({ ...x, n: kws.filter((k) => x.text.includes(k)).length })).filter((x) => x.n >= 2).sort((a, b) => b.n - a.n).slice(0, 4);
  hits.forEach((h) => console.log(`     ~ ${h.key} [${h.n}] ${h.c.text.slice(0, 110)}`));
}
