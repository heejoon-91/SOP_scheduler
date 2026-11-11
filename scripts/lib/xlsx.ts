/**
 * 최소한의 xlsx 읽기 (평가 스크립트용). 시트별로 셀 값을 2차원 배열로 돌려준다.
 * 병합 셀은 왼쪽 위 칸의 값으로 채운다. 수식은 저장된 결과값을 쓴다.
 */
import JSZip from 'jszip';
import { elements, nameOf, parseXml, TEXT, type XNode } from '../../src/core/hwpx/xml';

export interface Sheet {
  name: string;
  rows: string[][];
}

export async function readXlsx(data: Uint8Array | ArrayBuffer): Promise<Sheet[]> {
  const zip = await JSZip.loadAsync(data);
  const text = async (path: string) => (await zip.file(path)?.async('string')) ?? '';

  const shared: string[] = [];
  const sst = await text('xl/sharedStrings.xml');
  if (sst) for (const si of find(parseXml(sst), 'si')) shared.push(allText(si, 't'));

  const wb = parseXml(await text('xl/workbook.xml'));
  const rels = parseXml(await text('xl/_rels/workbook.xml.rels'));
  const target = new Map<string, string>();
  for (const r of find(rels, 'Relationship')) target.set(r.getAttribute!('Id')!, r.getAttribute!('Target')!);

  const sheets: Sheet[] = [];
  for (const s of find(wb, 'sheet')) {
    const rid = s.getAttribute!('r:id') ?? '';
    const t = target.get(rid) ?? '';
    const path = t.startsWith('/') ? t.slice(1) : `xl/${t.replace(/^\.\//, '')}`;
    const doc = parseXml(await text(path));
    const grid: string[][] = [];
    for (const c of find(doc, 'c')) {
      const ref = c.getAttribute!('r') ?? '';
      const [row, col] = cellIndex(ref);
      const type = c.getAttribute!('t');
      let v = '';
      if (type === 'inlineStr') v = allText(c, 't');
      else {
        const raw = find(c, 'v')[0];
        const val = raw ? allText(raw) : '';
        v = type === 's' ? (shared[Number(val)] ?? '') : val;
      }
      (grid[row] ??= [])[col] = v;
    }
    for (const m of find(doc, 'mergeCell')) {
      const [a, b] = (m.getAttribute!('ref') ?? '').split(':');
      if (!a || !b) continue;
      const [r1, c1] = cellIndex(a);
      const [r2, c2] = cellIndex(b);
      const v = grid[r1]?.[c1] ?? '';
      for (let r = r1; r <= r2; r++) for (let c = c1; c <= c2; c++) if (!(r === r1 && c === c1)) (grid[r] ??= [])[c] = v;
    }
    // grid는 빈 행이 구멍으로 남는 희소 배열이라 map 대신 직접 센다.
    let width = 0;
    for (let i = 0; i < grid.length; i++) width = Math.max(width, grid[i]?.length ?? 0);
    sheets.push({ name: s.getAttribute!('name') ?? '', rows: Array.from(grid, (r) => Array.from({ length: width }, (_, i) => (r?.[i] ?? '').trim())) });
  }
  return sheets;
}

function cellIndex(ref: string): [number, number] {
  const m = /^([A-Z]+)(\d+)$/.exec(ref)!;
  let col = 0;
  for (const ch of m[1]) col = col * 26 + (ch.charCodeAt(0) - 64);
  return [Number(m[2]) - 1, col - 1];
}

function find(n: XNode, name: string, out: XNode[] = []): XNode[] {
  for (const c of elements(n)) {
    if (nameOf(c) === name) out.push(c);
    find(c, name, out);
  }
  return out;
}

/** 하위 텍스트를 모두 이어 붙인다. tag가 있으면 그 요소 안의 텍스트만 (서식 있는 문자열의 <r><t>) */
function allText(n: XNode, tag?: string): string {
  let s = '';
  for (let c = n.firstChild; c; c = c.nextSibling) {
    if (c.nodeType === TEXT && !tag) s += c.nodeValue ?? '';
    else if (c.nodeType === 1) s += tag && nameOf(c) === tag ? allText(c) : allText(c, nameOf(c) === 'rPh' ? '__skip__' : tag);
  }
  return s;
}
