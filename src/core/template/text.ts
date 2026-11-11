/**
 * 매칭용 텍스트 처리. AI 없이 글자 2-gram 가중치(TF-IDF)와 코사인 유사도를 쓴다.
 * 한국어는 조사·어미가 붙어 단어 단위 비교가 잘 안 맞으므로 단어 안의 2글자 조각으로 비교한다.
 */

export type Vector = Map<string, number>;

/** 단어(한글·영문·숫자 연속)로 나눈다 */
export function words(text: string): string[] {
  return text.toLowerCase().match(/[가-힣a-z0-9]+/g) ?? [];
}

/** 단어 안의 2글자 조각. 한 글자 단어는 그대로 */
export function grams(text: string): string[] {
  const out: string[] = [];
  for (const w of words(text)) {
    if (w.length === 1) continue;
    for (let i = 0; i < w.length - 1; i++) out.push(w.slice(i, i + 2));
  }
  return out;
}

export function termFreq(text: string, weight = 1, into: Vector = new Map()): Vector {
  for (const g of grams(text)) into.set(g, (into.get(g) ?? 0) + weight);
  return into;
}

export class Idf {
  private df = new Map<string, number>();
  private n = 0;

  add(doc: Vector): void {
    this.n++;
    for (const g of doc.keys()) this.df.set(g, (this.df.get(g) ?? 0) + 1);
  }

  get(g: string): number {
    // 말뭉치에 없는 조각은 가장 드문 조각과 같은 가중치
    return Math.log((this.n + 1) / ((this.df.get(g) ?? 0) + 1)) + 1;
  }

  /** TF(로그 감쇠) × IDF, 길이 1로 정규화 */
  weigh(tf: Vector): Vector {
    const v: Vector = new Map();
    let norm = 0;
    for (const [g, f] of tf) {
      const w = (1 + Math.log(f)) * this.get(g);
      v.set(g, w);
      norm += w * w;
    }
    norm = Math.sqrt(norm) || 1;
    for (const [g, w] of v) v.set(g, w / norm);
    return v;
  }
}

export function cosine(a: Vector, b: Vector): number {
  const [small, large] = a.size < b.size ? [a, b] : [b, a];
  let s = 0;
  for (const [g, w] of small) s += w * (large.get(g) ?? 0);
  return s;
}

const PARTICLE = /(으로부터|에서는|에게는|으로는|에서|에게|으로|부터|까지|하고|하여|하며|한다|된다|이다|은|는|이|가|을|를|에|의|로|과|와|도|만|및|등)$/;

/** 표시용 키워드: 조사·어미를 떼고 2글자 이상인 단어 */
export function keywordsOf(text: string): string[] {
  const out: string[] = [];
  for (const w of words(text)) {
    const k = w.replace(PARTICLE, '');
    if (k.length >= 2 && !/^\d+$/.test(k)) out.push(k);
  }
  return out;
}

export function squash(s: string): string {
  return s.replace(/\s+/g, '');
}
