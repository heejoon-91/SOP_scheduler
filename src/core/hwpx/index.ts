import JSZip from 'jszip';
import type { ParsedSopSet } from '../model';
import { sectionToBlocks, type Block } from './blocks';
import { DEFAULT_PARSER_CONFIG, segment, type ParserConfig } from './segment';

export { DEFAULT_PARSER_CONFIG, type ParserConfig };

/** HWPX 파일(zip)에서 본문 section*.xml을 순서대로 읽는다. */
export async function readHwpxSections(data: ArrayBuffer | Uint8Array): Promise<string[]> {
  const zip = await JSZip.loadAsync(data);
  const sectionNo = (name: string) => Number(/section(\d+)\.xml$/.exec(name)?.[1] ?? -1);
  const names = Object.keys(zip.files)
    .filter((n) => /^Contents\/section\d+\.xml$/.test(n))
    .sort((a, b) => sectionNo(a) - sectionNo(b));
  if (!names.length) throw new Error('HWPX 본문(Contents/section*.xml)을 찾지 못했습니다. 한글 2014 이상에서 HWPX로 저장한 파일인지 확인하세요.');
  return Promise.all(names.map((n) => zip.file(n)!.async('string')));
}

export async function hwpxToBlocks(data: ArrayBuffer | Uint8Array): Promise<Block[]> {
  const sections = await readHwpxSections(data);
  return sections.flatMap(sectionToBlocks);
}

export async function parseHwpx(data: ArrayBuffer | Uint8Array, config: ParserConfig = DEFAULT_PARSER_CONFIG): Promise<ParsedSopSet> {
  return segment(await hwpxToBlocks(data), config);
}
