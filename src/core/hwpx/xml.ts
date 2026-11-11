import { DOMParser } from '@xmldom/xmldom';

/**
 * xmldom과 브라우저 DOM이 공통으로 갖는 최소 노드 형태.
 * 브라우저와 Node(평가 스크립트)에서 같은 파서 코드를 쓰려고 xmldom만 사용한다.
 */
export interface XNode {
  nodeType: number;
  nodeName: string;
  localName?: string | null;
  nodeValue: string | null;
  firstChild: XNode | null;
  nextSibling: XNode | null;
  getAttribute?(name: string): string | null;
}

export const ELEMENT = 1;
export const TEXT = 3;

export function parseXml(xml: string): XNode {
  return new DOMParser().parseFromString(xml, 'text/xml') as unknown as XNode;
}

/** 네임스페이스 접두어를 뗀 태그 이름 */
export function nameOf(n: XNode): string {
  return n.localName ?? n.nodeName.split(':').pop() ?? n.nodeName;
}

export function elements(n: XNode): XNode[] {
  const out: XNode[] = [];
  for (let c = n.firstChild; c; c = c.nextSibling) if (c.nodeType === ELEMENT) out.push(c);
  return out;
}

export function child(n: XNode, name: string): XNode | undefined {
  return elements(n).find((c) => nameOf(c) === name);
}

export function attr(n: XNode | undefined, name: string): string | null {
  return n?.getAttribute?.(name) ?? null;
}

export function intAttr(n: XNode | undefined, name: string, fallback: number): number {
  const v = Number.parseInt(attr(n, name) ?? '', 10);
  return Number.isFinite(v) ? v : fallback;
}
