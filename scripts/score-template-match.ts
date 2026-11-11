/**
 * 템플릿 매칭 결과를 정답(조항 판정 파일)과 대조해 지표를 낸다.
 * 사용: npx tsx scripts/score-template-match.ts <정답.csv> <회사 SOP.hwpx> [템플릿.json]
 *
 * 정답 파일 형식 (CSV, 머리글 1줄): 템플릿 번호, 정답 조항, 확신, 근거
 *   정답 조항: "CTM/010 4." 처럼 SOP 번호(분류/번호)와 조항 경로. 여러 개는 ";"로. 회사 SOP에 의무가 없으면 "없음".
 *   후보가 정답 조항이거나 그 하위 조항이면 적중으로 본다.
 */
import { readFile } from 'node:fs/promises';
import { relate } from '../src/core/eval/compare';
import { parseHwpx } from '../src/core/hwpx';
import { matchTemplates, type TemplateMatch } from '../src/core/template/match';
import type { TemplateSet } from '../src/core/template/types';

const [answerFile, sopFile, templateFile = 'src/templates/kulf-com.template.json'] = process.argv.slice(2);
if (!answerFile || !sopFile) {
  console.error('사용: npx tsx scripts/score-template-match.ts <정답.csv> <회사 SOP.hwpx> [템플릿.json]');
  process.exit(1);
}

interface Answer {
  no: number;
  clauses: { sop: string; path: string }[];
  absent: boolean;
  confidence: string;
}

const answers = new Map<number, Answer>();
for (const line of (await readFile(answerFile, 'utf-8')).replace(/^﻿/, '').split(/\r?\n/).slice(1)) {
  if (!line.trim()) continue;
  const [no, answer, confidence] = line.split(',', 3);
  const absent = answer.trim() === '없음';
  const clauses = absent
    ? []
    : answer.split(';').map((a) => {
        const [sop, ...rest] = a.trim().split(' ');
        return { sop, path: rest.join(' ') };
      });
  answers.set(Number(no), { no: Number(no), clauses, absent, confidence: confidence.trim() });
}

const templates = JSON.parse(await readFile(templateFile, 'utf-8')) as TemplateSet;
const parsed = await parseHwpx(await readFile(sopFile));
const results = matchTemplates(templates, parsed);

const short = (id: string) => id.split('/').slice(1).join('/');
const isHit = (r: TemplateMatch, a: Answer, k: number) =>
  r.candidates.slice(0, k).some((c) => a.clauses.some((x) => x.sop === short(c.sop) && ['exact', 'child'].includes(relate(x.path, c.path) ?? '')));

const rows = results.map((r) => ({ r, a: answers.get(r.template.no) })).filter((x): x is { r: TemplateMatch; a: Answer } => !!x.a);
const present = rows.filter((x) => !x.a.absent);
const absent = rows.filter((x) => x.a.absent);
const pct = (a: number, b: number) => (b ? `${((100 * a) / b).toFixed(1)}%` : '-');

console.log(`정답 ${rows.length}건 (회사 SOP에 있음 ${present.length}, 없음 ${absent.length})`);
for (const [label, set] of [['전체', present], ['확신 높음·중간', present.filter((x) => x.a.confidence !== '낮음')]] as const) {
  const h1 = set.filter((x) => isHit(x.r, x.a, 1)).length;
  const h3 = set.filter((x) => isHit(x.r, x.a, 3)).length;
  console.log(`  [${label}] 정답 조항이 1순위: ${pct(h1, set.length)} (${h1}/${set.length}), 3순위 안: ${pct(h3, set.length)} (${h3}/${set.length})`);
}

// 있음 / 확인 필요 / 없음 판정 대조
const cell = (truth: 'present' | 'absent', status: string) => rows.filter((x) => (x.a.absent ? 'absent' : 'present') === truth && x.r.status === status).length;
console.log('  판정 대조 (행: 실제, 열: 도구 판정)        있음  확인필요  없음');
for (const [label, truth] of [['    회사 SOP에 의무 있음', 'present'], ['    회사 SOP에 의무 없음', 'absent']] as const) {
  console.log(`${label}               ${String(cell(truth, 'matched')).padStart(4)}  ${String(cell(truth, 'weak')).padStart(8)}  ${String(cell(truth, 'none')).padStart(4)}`);
}
const danger = rows.filter((x) => x.a.absent && x.r.status === 'matched');
const falseGap = rows.filter((x) => !x.a.absent && x.r.status === 'none');
const matchedWrong = rows.filter((x) => !x.a.absent && x.r.status === 'matched' && !isHit(x.r, x.a, 3));
console.log(`  위험한 오판 (없는 의무를 "있음"): ${danger.length}건 ${danger.map((x) => `#${x.r.template.no}`).join(' ')}`);
console.log(`  "있음"인데 정답 조항이 3순위 밖: ${matchedWrong.length}건 ${matchedWrong.map((x) => `#${x.r.template.no}`).join(' ')}`);
console.log(`  잘못된 빈틈 경고 (있는 의무를 "없음"): ${falseGap.length}건 ${falseGap.map((x) => `#${x.r.template.no}`).join(' ')}`);
console.log(`  사람이 볼 "확인 필요": ${rows.filter((x) => x.r.status === 'weak').length}건`);

const missed = present.filter((x) => !isHit(x.r, x.a, 3));
console.log(`  3순위 안에서 못 찾은 것 ${missed.length}건: ${missed.map((x) => `#${x.r.template.no}(${x.a.confidence})`).join(' ')}`);
