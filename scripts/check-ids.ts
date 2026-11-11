/** 파싱·추출 결과의 ID 중복을 점검한다. 사용: npx tsx scripts/check-ids.ts <파일.hwpx> */
import { readFile } from 'node:fs/promises';
import { extractCandidates } from '../src/core/extract/candidates';
import { parseHwpx } from '../src/core/hwpx';
const parsed = await parseHwpx(await readFile(process.argv[2]));
const cands = extractCandidates(parsed);
const dups = (ids: string[]) => { const m = new Map<string, number>(); ids.forEach((i) => m.set(i, (m.get(i) ?? 0) + 1)); return [...m].filter(([, n]) => n > 1); };
const clauses = parsed.sops.reduce((n, s) => n + s.clauses.length, 0);
console.log(`SOP ${parsed.sops.length}, 조항 ${clauses}, 서식 ${parsed.forms.length}, 후보 ${cands.length}, 경고 ${parsed.warnings.length}`);
const dc = dups(parsed.sops.flatMap((s) => s.clauses.map((c) => c.id)));
const dk = dups(cands.map((c) => c.id));
console.log(`중복 조항 ID ${dc.length}개, 중복 후보 ID ${dk.length}개`);
console.log(dk.slice(0, 8).map(([id, n]) => `  ${id} ×${n}`).join('\n'));
