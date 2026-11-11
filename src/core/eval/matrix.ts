/**
 * 정답 데이터(의무 매트릭스) 표현과, 매트릭스의 "근거 SOP"·"서식" 칸을 읽는 규칙.
 * 매트릭스는 사람이 쓴 표라 표기가 제각각이다: "COM/019 6, 9.(1)", "7.(2)(3)", "6.(5)~(7)", "5~7", "COM/009".
 */

export type MatrixType = '정기' | '시험 단계' | '수시 이벤트' | '만료 추적';

export interface MatrixRow {
  no: number;
  type: MatrixType | string;
  stage: string;
  trigger: string;
  deadline: string;
  task: string;
  formText: string;
  refText: string;
  actor: string;
  recipients: string;
  /** 읽어낸 근거 조항. path가 ''이면 SOP 전체를 가리킴 */
  refs: { sop: string; path: string }[];
  /** 읽어낸 서식 코드 (KULF/COM/019-1 형태) */
  forms: string[];
}

export interface MatrixColumns {
  no: number;
  type: number;
  stage: number;
  trigger: number;
  deadline: number;
  task: number;
  forms: number;
  refs: number;
  actor: number;
  recipients: number;
}

/** 머리글 이름으로 열 위치를 찾는다. */
export function findColumns(header: string[]): MatrixColumns | null {
  const at = (re: RegExp) => header.findIndex((h) => re.test(h.replace(/\s+/g, '')));
  const cols = {
    no: at(/^(No|번호)$/i),
    type: at(/^유형$/),
    stage: at(/^단계/),
    trigger: at(/^트리거/),
    deadline: at(/^기한$/),
    task: at(/^할일$/),
    forms: at(/^서식/),
    refs: at(/^근거/),
    actor: at(/^담당/),
    recipients: at(/^(보고|통보)/),
  };
  return cols.no >= 0 && cols.type >= 0 && cols.refs >= 0 && cols.task >= 0 ? cols : null;
}

/** 시트 행에서 머리글을 찾아 매트릭스 행을 읽는다. */
export function readMatrix(rows: string[][], prefix = 'KULF'): MatrixRow[] {
  const headerIndex = rows.findIndex((r) => findColumns(r) !== null);
  if (headerIndex < 0) throw new Error('매트릭스 머리글(No, 유형, 할 일, 근거 SOP …)을 찾지 못했습니다');
  const c = findColumns(rows[headerIndex])!;
  const get = (r: string[], i: number) => (i >= 0 ? (r[i] ?? '').trim() : '');
  return rows
    .slice(headerIndex + 1)
    .filter((r) => /^\d+$/.test(get(r, c.no)))
    .map((r) => {
      const refText = get(r, c.refs);
      const formText = get(r, c.forms);
      return {
        no: Number(get(r, c.no)),
        type: get(r, c.type),
        stage: get(r, c.stage),
        trigger: get(r, c.trigger),
        deadline: get(r, c.deadline),
        task: get(r, c.task),
        formText,
        refText,
        actor: get(r, c.actor),
        recipients: get(r, c.recipients),
        refs: parseRefs(refText, prefix),
        forms: parseForms(formText, refText, prefix),
      };
    });
}

/**
 * "COM/019 6, 9.(1), COM/021 3.(1)" → [{KULF/COM/019, 6.}, {KULF/COM/019, 9.(1)}, {KULF/COM/021, 3.(1)}]
 * SOP 번호가 없는 조각은 앞의 SOP를 이어받는다.
 */
export function parseRefs(text: string, prefix = 'KULF'): { sop: string; path: string }[] {
  const out: { sop: string; path: string }[] = [];
  let sop = '';
  for (const raw of text.split(/[,，]/)) {
    let piece = raw.trim();
    const m = /^(?:[A-Z]+\/)?([A-Z]{2,})\/(\d{3})\s*(.*)$/.exec(piece);
    if (m) {
      sop = `${prefix}/${m[1]}/${m[2]}`;
      piece = m[3].trim();
    }
    if (!sop) continue;
    if (!piece || /^서식/.test(piece)) {
      out.push({ sop, path: '' });
      continue;
    }
    for (const path of expandPath(piece)) out.push({ sop, path });
  }
  return dedupe(out);
}

/** "7.(2)(3)" → 7.(2), 7.(3) / "6.(5)~(7)" → 6.(5)…6.(7) / "5~7" → 5., 6., 7. / "6" → 6. */
export function expandPath(piece: string): string[] {
  const p = piece.replace(/\s+/g, '');
  // 장 범위: "5~7", "6~7"
  let m = /^(\d+)\.?[~∼-](\d+)\.?$/.exec(p);
  if (m) return range(+m[1], +m[2]).map((n) => `${n}.`);
  // 항 범위: "6.(5)~(7)"
  m = /^(\d+)\.\((\d+)\)[~∼-]\((\d+)\)$/.exec(p);
  if (m) return range(+m[2], +m[3]).map((n) => `${m![1]}.(${n})`);
  // 항 나열: "7.(2)(3)", "6.(2)(4)"
  m = /^(\d+)\.((?:\(\d+\)){2,})$/.exec(p);
  if (m) return [...m[2].matchAll(/\((\d+)\)/g)].map((x) => `${m![1]}.(${x[1]})`);
  // 번호만: "6" → "6."
  if (/^\d+$/.test(p)) return [`${p}.`];
  return [p];
}

/** "019-1 사육관리 기록지 / 021-1(관찰)" → KULF/COM/019-1, KULF/COM/021-1. 분류코드는 근거 SOP에서 가져온다. */
export function parseForms(formText: string, refText: string, prefix = 'KULF'): string[] {
  const series = /([A-Z]{2,})\/\d{3}/.exec(refText)?.[1] ?? 'COM';
  const out: string[] = [];
  for (const m of formText.matchAll(/(?:([A-Z]{2,})\/)?(\d{3})-(\d+)/g)) out.push(`${prefix}/${m[1] ?? series}/${m[2]}-${m[3]}`);
  return [...new Set(out)];
}

function range(a: number, b: number): number[] {
  return a <= b ? Array.from({ length: b - a + 1 }, (_, i) => a + i) : [a];
}

function dedupe<T extends { sop: string; path: string }>(xs: T[]): T[] {
  const seen = new Set<string>();
  return xs.filter((x) => {
    const k = `${x.sop}#${x.path}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}
