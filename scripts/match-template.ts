/**
 * 기본 템플릿의 각 의무를 회사 SOP 조항에 연결하고, 검수용 표(CSV, 엑셀에서 열림)를 만든다.
 * 사용: npm run template:match -- <회사 SOP.hwpx> [템플릿.json]
 * 검수자는 "판정" 열에 맞음 / 틀림(맞는 조항: …) / 없음 을 적는다. 이 판정이 두 번째 SOP 세트의 정답이 된다.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { TYPE_LABELS } from '../src/core/extract/candidates';
import { parseHwpx } from '../src/core/hwpx';
import { DEFAULT_MATCH_OPTIONS, matchTemplates, STATUS_LABELS } from '../src/core/template/match';
import type { TemplateSet } from '../src/core/template/types';

const [sopFile, templateFile = 'src/templates/kulf-com.template.json'] = process.argv.slice(2);
if (!sopFile) {
  console.error('사용: npm run template:match -- <회사 SOP.hwpx> [템플릿.json]');
  process.exit(1);
}

const templates = JSON.parse(await readFile(templateFile, 'utf-8')) as TemplateSet;
const parsed = await parseHwpx(await readFile(sopFile));
const results = matchTemplates(templates, parsed);

const name = basename(sopFile).replace(/\.hwpx$/i, '');
const short = (id: string) => id.split('/').slice(1).join('/');
const rows: unknown[][] = [
  ['템플릿', '유형', '할 일', '트리거/주기', '기한', '서식', '판정', '판정 이유', '1순위 조항', '1순위 점수', '1순위 본문', '2순위', '3순위', '서식 이름 일치', '공통 키워드', '판정 (맞음/틀림/없음)', '맞는 조항 (틀림일 때)'],
  ...results.map((r) => {
    const [a, b, c] = r.candidates;
    const label = (x?: (typeof r.candidates)[number]) => (x ? `${short(x.sop)} ${x.path} (${x.score}) ${x.text.slice(0, 60)}` : '');
    return [
      r.template.id,
      TYPE_LABELS[r.template.type],
      r.template.task,
      r.template.trigger,
      r.template.deadlineText,
      r.template.formText,
      STATUS_LABELS[r.status],
      r.reason,
      a ? `${short(a.sop)} ${a.path}` : '',
      a?.score ?? '',
      a?.text ?? '',
      label(b),
      label(c),
      a?.formHits.join(', ') ?? '',
      a?.sharedKeywords.join(', ') ?? '',
      '',
      '',
    ];
  }),
];
await mkdir('out/match', { recursive: true });
const csvPath = join('out/match', `${name}.template-match.csv`);
const cell = (v: unknown) => {
  const s = String(v ?? '');
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
await writeFile(csvPath, '﻿' + rows.map((r) => r.map(cell).join(',')).join('\r\n'), 'utf-8');
await writeFile(join('out/match', `${name}.template-match.json`), JSON.stringify(results, null, 2), 'utf-8');

const count = (s: string) => results.filter((r) => r.status === s).length;
console.log(`템플릿 ${results.length}건 → ${basename(sopFile)} (SOP ${parsed.sops.length}개, 조항 ${parsed.sops.reduce((n, s) => n + s.clauses.length, 0)}개)`);
console.log(`  있음 ${count('matched')}, 확인 필요 ${count('weak')}, 없음 ${count('none')}  (기준: 있음 ≥ ${DEFAULT_MATCH_OPTIONS.strong}, 확인 필요 ≥ ${DEFAULT_MATCH_OPTIONS.weak})`);
console.log(`검수용 표: ${csvPath}`);
