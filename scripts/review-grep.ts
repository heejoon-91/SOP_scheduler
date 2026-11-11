/** 검수용: 파싱 결과 전체 조항에서 단어를 찾는다. 사용: npx tsx scripts/review-grep.ts <parsed.json> 단어1 단어2 ... */
import { readFile } from 'node:fs/promises';
import type { ParsedSopSet } from '../src/core/model';
const [pf, ...terms] = process.argv.slice(2);
const parsed = JSON.parse(await readFile(pf, 'utf-8')) as ParsedSopSet;
for (const term of terms) {
  const hits = parsed.sops.flatMap((s) => s.clauses.filter((c) => (c.text + c.tables.map((t) => t.rows.flat().join(' ')).join(' ')).includes(term)).map((c) => `${s.id.split('/').slice(1).join('/')} ${c.path} ${c.text.slice(0, 90)}`));
  console.log(`[${term}] ${hits.length}건`);
  hits.slice(0, 5).forEach((h) => console.log('   ' + h));
}
