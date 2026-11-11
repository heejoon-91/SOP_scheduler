/**
 * SOP 빈틈 보고서: 기본 템플릿의 의무 중 회사 SOP에 없는(또는 확인이 필요한) 것을 정리한다.
 * 설계 문서 "추출 파이프라인 6. 누락 경고"의 결과물이다. 판정은 규칙(AI 없음)으로 하며 확정 전 사람이 검토한다.
 * 사용: npm run gap -- <회사 SOP.hwpx> [템플릿.json]
 * 출력: out/gap/<파일명>.gap-report.md (읽기용), .csv (엑셀 검토용)
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { TYPE_LABELS, type ObligationType } from '../src/core/extract/candidates';
import { describeRule } from '../src/core/extract/describe';
import { parseHwpx } from '../src/core/hwpx';
import { DEFAULT_MATCH_OPTIONS, matchTemplates, STATUS_LABELS, type TemplateMatch } from '../src/core/template/match';
import type { TemplateSet } from '../src/core/template/types';

const [sopFile, templateFile = 'src/templates/kulf-com.template.json'] = process.argv.slice(2);
if (!sopFile) {
  console.error('사용: npm run gap -- <회사 SOP.hwpx> [템플릿.json]');
  process.exit(1);
}

const templates = JSON.parse(await readFile(templateFile, 'utf-8')) as TemplateSet;
const parsed = await parseHwpx(await readFile(sopFile));
const results = matchTemplates(templates, parsed);
const name = basename(sopFile).replace(/\.hwpx$/i, '');
const short = (id: string) => id.split('/').slice(1).join('/');
const TYPES: ObligationType[] = ['periodic', 'stage', 'event', 'expiry', 'unknown'];

const by = (s: TemplateMatch['status']) => results.filter((r) => r.status === s);
const none = by('none');
const weak = by('weak');
const matched = by('matched');
const deadline = (r: TemplateMatch) => r.template.deadlineText || r.template.deadlineDraft.map((d) => describeRule(d.rule)).join(' / ');
const sourceRef = (r: TemplateMatch) => r.template.source.map((s) => `${short(s.sop)} ${s.path}`.trim()).join(', ');
const md = (s: string) => s.replace(/\|/g, '\\|').replace(/\n/g, ' ');

const lines: string[] = [];
lines.push(`# SOP 빈틈 보고서 — ${name}`, '');
lines.push(`- 대상 SOP: ${basename(sopFile)} (SOP ${parsed.sops.length}개, 조항 ${parsed.sops.reduce((n, s) => n + s.clauses.length, 0)}개)`);
lines.push(`- 기준 템플릿: ${templates.name} ${templates.version} (의무 ${templates.obligations.length}건, 근거: ${templates.sources.join(', ')})`);
lines.push(`- 작성: ${new Date().toISOString().slice(0, 10)}, 규칙 기반 자동 판정 (AI 미사용)`);
lines.push('');
lines.push('> 이 보고서는 참고용 초안이다. "없음"은 회사 SOP에서 해당 의무를 정한 조항을 찾지 못했다는 뜻이며, 표현이 달라 못 찾았을 수도 있다.');
lines.push('> "확인 필요"는 비슷한 조항은 있으나 같은 의무인지 사람이 판단해야 하는 항목이다. 모든 판정은 SOP 원문과 대조해 확정한다.');
lines.push('');
lines.push('## 요약', '');
lines.push('| 판정 | 건수 | 의미 |', '| --- | --- | --- |');
lines.push(`| 없음 | ${none.length} | 회사 SOP에 해당 조항을 찾지 못함 (빈틈 후보) |`);
lines.push(`| 확인 필요 | ${weak.length} | 비슷한 조항이 있으나 같은 의무인지 확인 필요 |`);
lines.push(`| 있음 | ${matched.length} | 해당 조항을 찾음 |`);
lines.push('');
lines.push('| 유형 | 없음 | 확인 필요 | 있음 |', '| --- | --- | --- | --- |');
for (const t of TYPES) {
  const c = (s: TemplateMatch['status']) => results.filter((r) => r.template.type === t && r.status === s).length;
  if (c('none') + c('weak') + c('matched')) lines.push(`| ${TYPE_LABELS[t]} | ${c('none')} | ${c('weak')} | ${c('matched')} |`);
}
lines.push('');

lines.push(`## 1. 없음 — 회사 SOP에 해당 조항을 찾지 못한 의무 (${none.length}건)`, '');
for (const t of TYPES) {
  const rows = none.filter((r) => r.template.type === t);
  if (!rows.length) continue;
  lines.push(`### ${TYPE_LABELS[t]} (${rows.length}건)`, '');
  lines.push('| 템플릿 | 할 일 | 트리거·주기 | 기한 | 서식 | 템플릿 근거 | 판정 이유 |', '| --- | --- | --- | --- | --- | --- | --- |');
  for (const r of rows) {
    lines.push(`| ${r.template.id} | ${md(r.template.task)} | ${md(r.template.trigger)} | ${md(deadline(r))} | ${md(r.template.formText)} | ${md(sourceRef(r))} | ${md(r.reason)} |`);
  }
  lines.push('');
}

lines.push(`## 2. 확인 필요 (${weak.length}건)`, '');
lines.push('가장 비슷한 조항을 함께 적었다. 같은 의무를 정한 조항이면 "있음", 아니면 "없음"으로 확정한다.', '');
lines.push('| 템플릿 | 유형 | 할 일 | 가장 비슷한 조항 | 조항 본문 | 판정 이유 |', '| --- | --- | --- | --- | --- | --- |');
for (const r of weak) {
  const c = r.candidates[0];
  lines.push(`| ${r.template.id} | ${TYPE_LABELS[r.template.type]} | ${md(r.template.task)} | ${c ? `${short(c.sop)} ${c.path}` : ''} | ${md(c?.text.slice(0, 120) ?? '')} | ${md(r.reason)} |`);
}
lines.push('');

lines.push(`## 3. 있음 (${matched.length}건)`, '');
lines.push('| 템플릿 | 유형 | 할 일 | 회사 SOP 조항 |', '| --- | --- | --- | --- |');
for (const r of matched) {
  const c = r.candidates[0];
  lines.push(`| ${r.template.id} | ${TYPE_LABELS[r.template.type]} | ${md(r.template.task)} | ${short(c.sop)} ${c.path} |`);
}
lines.push('');
lines.push(`판정 기준: 있음 = 유사도 ${DEFAULT_MATCH_OPTIONS.strong} 이상이고 키워드·서식이 겹치며 조항에 트리거 단어가 나옴 (유사도 ${DEFAULT_MATCH_OPTIONS.triggerExemptScore} 이상이면 트리거 단어 조건 면제), 없음 = 유사도 ${DEFAULT_MATCH_OPTIONS.weak} 미만 또는 핵심 단어 대부분이 SOP에 없음, 그 사이는 확인 필요.`);

await mkdir('out/gap', { recursive: true });
const mdPath = join('out/gap', `${name}.gap-report.md`);
await writeFile(mdPath, lines.join('\n') + '\n', 'utf-8');

const cell = (v: unknown) => {
  const s = String(v ?? '');
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
const order = { none: 0, weak: 1, matched: 2 } as const;
const csvRows = [
  ['판정', '템플릿', '유형', '할 일', '트리거·주기', '기한', '서식', '템플릿 근거', '회사 SOP 조항 (1순위)', '조항 본문', '판정 이유', '확정 (있음/없음)', '메모'],
  ...[...results]
    .sort((a, b) => order[a.status] - order[b.status] || a.template.no - b.template.no)
    .map((r) => {
      const c = r.candidates[0];
      return [STATUS_LABELS[r.status], r.template.id, TYPE_LABELS[r.template.type], r.template.task, r.template.trigger, deadline(r), r.template.formText, sourceRef(r), c ? `${short(c.sop)} ${c.path}` : '', c?.text ?? '', r.reason, '', ''];
    }),
];
const csvPath = join('out/gap', `${name}.gap-report.csv`);
await writeFile(csvPath, '﻿' + csvRows.map((r) => r.map(cell).join(',')).join('\r\n'), 'utf-8');

console.log(`SOP 빈틈 보고서: 없음 ${none.length}, 확인 필요 ${weak.length}, 있음 ${matched.length}`);
console.log(`  ${mdPath}`);
console.log(`  ${csvPath}`);
