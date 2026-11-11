/** 공백 차이를 무시한 텍스트 해시 (FNV-1a 32bit). 개정 전후 조항 변경 감지용이며 보안 용도가 아니다. */
export function textHash(text: string): string {
  const s = text.replace(/\s+/g, ' ').trim();
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}
