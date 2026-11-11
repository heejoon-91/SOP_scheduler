import type { ParsedTable } from '../model';
import { child, elements, ELEMENT, intAttr, nameOf, parseXml, TEXT, type XNode } from './xml';

/** 문서를 순서대로 펼친 단위: 문단 또는 표 */
export type Block = { type: 'para'; text: string } | { type: 'table'; table: ParsedTable };

/** 본문 텍스트가 아닌 영역 (머리말·꼬리말, 줄 배치 정보) */
const SKIP = new Set(['header', 'footer', 'linesegarray']);
/** <hp:t> 안에서 공백으로 바꿀 요소 */
const SPACE_LIKE = new Set(['tab', 'lineBreak', 'nbSpace', 'fwSpace']);

export function sectionToBlocks(xml: string): Block[] {
  const out: Block[] = [];
  walk(parseXml(xml), out);
  return out;
}

function walk(node: XNode, out: Block[]): void {
  for (const c of elements(node)) {
    const name = nameOf(c);
    if (name === 'p') emitParagraph(c, out);
    else if (name === 'tbl') out.push({ type: 'table', table: readTable(c) });
    else if (!SKIP.has(name)) walk(c, out);
  }
}

function emitParagraph(p: XNode, out: Block[]): void {
  let text = '';
  const embedded: XNode[] = [];
  for (const run of elements(p)) {
    if (nameOf(run) !== 'run') continue;
    for (const c of elements(run)) {
      if (nameOf(c) === 't') text += readT(c);
      else embedded.push(c);
    }
  }
  text = normalize(text);
  if (text) out.push({ type: 'para', text });
  for (const e of embedded) {
    const name = nameOf(e);
    if (name === 'tbl') out.push({ type: 'table', table: readTable(e) });
    else if (!SKIP.has(name)) walk(e, out);
  }
}

/**
 * <hp:t>의 텍스트. 형광펜(<hp:markpenBegin/>) 같은 자식 요소 뒤의 텍스트까지 모아야 한다.
 * 첫 텍스트 노드만 읽으면 형광펜이 칠해진 문단은 앞부분만 남는다.
 */
function readT(t: XNode): string {
  let s = '';
  for (let c = t.firstChild; c; c = c.nextSibling) {
    if (c.nodeType === TEXT) s += c.nodeValue ?? '';
    else if (c.nodeType === ELEMENT) s += SPACE_LIKE.has(nameOf(c)) ? ' ' : readT(c);
  }
  return s;
}

function normalize(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}

/** 병합 셀(rowSpan/colSpan)을 풀어, 병합된 모든 칸에 같은 텍스트를 채운다. */
function readTable(tbl: XNode): ParsedTable {
  const rowCnt = intAttr(tbl, 'rowCnt', 0);
  const colCnt = intAttr(tbl, 'colCnt', 0);
  const grid: (string | null)[][] = Array.from({ length: rowCnt }, () => Array<string | null>(colCnt).fill(null));
  let r = 0;
  for (const tr of elements(tbl)) {
    if (nameOf(tr) !== 'tr') continue;
    let c = 0;
    for (const tc of elements(tr)) {
      if (nameOf(tc) !== 'tc') continue;
      const addr = child(tc, 'cellAddr');
      const span = child(tc, 'cellSpan');
      const row = intAttr(addr, 'rowAddr', r);
      const col = intAttr(addr, 'colAddr', c);
      const rs = Math.max(1, intAttr(span, 'rowSpan', 1));
      const cs = Math.max(1, intAttr(span, 'colSpan', 1));
      const text = cellText(tc);
      for (let i = row; i < row + rs; i++) {
        for (let j = col; j < col + cs; j++) {
          if (i < rowCnt && j < colCnt) grid[i][j] = text;
        }
      }
      c = col + cs;
    }
    r++;
  }
  return { rows: grid.map((row) => row.map((v) => v ?? '')) };
}

/** 칸 안의 문단은 줄바꿈으로, 칸 안의 표는 행을 " | "로 이어 한 문자열로 만든다. */
function cellText(tc: XNode): string {
  const inner: Block[] = [];
  walk(tc, inner);
  return inner
    .map((b) => (b.type === 'para' ? b.text : b.table.rows.map((row) => row.filter(Boolean).join(' | ')).join('\n')))
    .filter(Boolean)
    .join('\n');
}
