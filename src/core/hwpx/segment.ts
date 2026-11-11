import defaultConfig from '../../config/parser.default.json';
import type { Clause, FormDef, ParsedSopSet, ParsedTable, Sop } from '../model';
import { textHash } from '../hash';
import type { Block } from './blocks';

export interface LevelRule {
  level: number;
  pattern: string;
  /** {1}, {2}… 는 패턴의 캡처 그룹 */
  label: string;
}

export interface ParserConfig {
  sopCode: string;
  formSuffix: string;
  sopHeaderLabel: string;
  titleLabel: string;
  ignoreParas: string[];
  levels: LevelRule[];
}

export const DEFAULT_PARSER_CONFIG: ParserConfig = defaultConfig;

const KOREAN_SEQ = '가나다라마바사아자차카타파하';
const CIRCLED_SEQ = '①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮⑯⑰⑱⑲⑳';

interface CompiledLevel {
  level: number;
  re: RegExp;
  label: string;
}

interface Numbered {
  level: number;
  label: string;
  /** 같은 단계 안에서의 순번 (번호 건너뜀 검사용) */
  seq: number;
  text: string;
}

/** 블록 열을 SOP·조항·서식으로 나눈다. */
export function segment(blocks: Block[], config: ParserConfig = DEFAULT_PARSER_CONFIG): ParsedSopSet {
  const sopRe = new RegExp(`^${config.sopCode}$`);
  const formRe = new RegExp(`^${config.sopCode}${config.formSuffix}$`);
  const formRefRe = new RegExp(`${config.sopCode}${config.formSuffix}`, 'g');
  const sopRefRe = new RegExp(`${config.sopCode}(?!${config.formSuffix})`, 'g');
  const headerLabelRe = new RegExp(config.sopHeaderLabel, 'i');
  const titleLabelRe = new RegExp(config.titleLabel, 'i');
  const ignoreRes = config.ignoreParas.map((p) => new RegExp(p));
  const levels: CompiledLevel[] = config.levels.map((l) => ({ level: l.level, re: new RegExp(l.pattern), label: l.label }));

  const toc = new Map<string, string>();
  const forms = new Map<string, FormDef>();
  const sops: Sop[] = [];
  const warnings: string[] = [];

  type Mode = 'front' | 'cover' | 'body' | 'form';
  let mode: Mode = 'front';
  let sop: Sop | null = null;
  /** 현재 열린 번호 조항들. stack[i]는 바깥에서 안쪽 순서 */
  let stack: Clause[] = [];
  const paraCount = new Map<string, number>();
  const usedIds = new Set<string>();
  const seqSeen = new Map<string, number>();

  const parseNumbered = (text: string): Numbered | null => {
    for (const l of levels) {
      const m = l.re.exec(text);
      if (!m) continue;
      const groups = m.slice(1);
      const label = l.label.replace(/\{(\d)\}/g, (_, i: string) => groups[Number(i) - 1] ?? '');
      const last = groups[groups.length - 2] ?? groups[0];
      return { level: l.level, label, seq: seqOf(last), text: (groups[groups.length - 1] ?? '').trim() };
    }
    return null;
  };

  /** sopId: 문서 안에서 고유한 SOP ID (조항 ID에 씀), sopCode: 문서에 적힌 번호 (자기 참조 제외에 씀) */
  const addClause = (sopId: string, sopCode: string, n: Numbered | null, text: string, sourceText: string): Clause => {
    let parent: Clause | null;
    let path: string;
    if (n) {
      while (stack.length && stack[stack.length - 1].level >= n.level) stack.pop();
      parent = stack[stack.length - 1] ?? null;
      // "4-1"처럼 상위 번호를 이미 담은 2단계 번호는 상위 경로를 덧붙이지 않는다.
      path = n.level === 2 ? n.label : (parent?.path ?? '') + n.label;
      checkSequence(sopId, parent, n);
    } else {
      parent = stack[stack.length - 1] ?? null;
      const key = `${sopId}#${parent?.path ?? ''}`;
      const k = (paraCount.get(key) ?? 0) + 1;
      paraCount.set(key, k);
      path = `${parent?.path ?? ''}¶${k}`;
    }
    // 문서에 같은 번호가 두 번 나오면(번호 오류, 편집 메모 등) 경로는 그대로 두고 ID만 구분한다.
    // ID가 겹치면 화면 목록과 연쇄·근거 연결이 엉뚱한 조항을 가리킨다.
    const baseId = `${sopId}#${path}`;
    let id = baseId;
    for (let n = 2; usedIds.has(id); n++) id = `${baseId}~${n}`;
    usedIds.add(id);
    const clause: Clause = {
      id,
      sop: sopId,
      path,
      label: n?.label ?? '',
      level: n?.level ?? 0,
      parentId: parent?.id ?? null,
      text,
      hash: textHash(sourceText),
      tables: [],
      formRefs: unique(sourceText.match(formRefRe) ?? []),
      sopRefs: unique((sourceText.match(sopRefRe) ?? []).filter((c) => c !== sopCode)),
    };
    if (n) stack.push(clause);
    return clause;
  };

  const checkSequence = (sopId: string, parent: Clause | null, n: Numbered) => {
    const key = `${sopId}#${parent?.path ?? ''}#L${n.level}`;
    const prev = seqSeen.get(key) ?? 0;
    if (n.seq !== prev + 1) {
      const where = parent ? `${parent.path} 아래` : '최상위';
      warnings.push(`${sopId} ${where}: 번호 ${n.label} 앞 번호가 ${prev === 0 ? '없음' : `${prev}번`} (빠졌거나 순서가 다를 수 있음)`);
    }
    seqSeen.set(key, n.seq);
  };

  /**
   * 현재 SOP 본문에 더한 것의 기록. 서식 코드가 서식 내용 "뒤"에 오는 문서에서는,
   * 코드를 만난 뒤에야 직전 블록들이 서식이었음을 알 수 있으므로 이 기록으로 되돌린다.
   */
  type JournalEntry = { kind: 'clause'; clause: Clause; warnLen: number; stack: Clause[] } | { kind: 'table'; target: Clause; warnLen: number; stack: Clause[] };
  let journal: JournalEntry[] = [];

  const attachTable = (table: ParsedTable) => {
    const target = stack[stack.length - 1] ?? sop?.clauses[sop.clauses.length - 1];
    if (!target) return;
    journal.push({ kind: 'table', target, warnLen: warnings.length, stack: [...stack] });
    target.tables.push(table);
  };

  const pushClause = (n: Numbered | null, text: string, sourceText: string) => {
    const entry = { kind: 'clause' as const, warnLen: warnings.length, stack: [...stack] };
    const clause = addClause(sop!.id, sop!.code, n, n ? n.text : text, sourceText);
    sop!.clauses.push(clause);
    journal.push({ ...entry, clause });
  };

  /**
   * 서식 제목(서식 목록의 이름과 같은 문단)부터 지금까지 본문에 더한 것을 되돌린다.
   * 제목을 찾지 못하면 아무것도 되돌리지 않는다. 되돌린 제목 문단의 텍스트를 돌려준다.
   */
  const retractFormPage = (formName: string): string | null => {
    const key = squash(formName);
    if (!key || !sop) return null;
    const j = journal.findLastIndex((e) => e.kind === 'clause' && e.clause.level === 0 && squash(e.clause.text) === key);
    if (j < 0) return null;
    for (let i = journal.length - 1; i >= j; i--) {
      const e = journal[i];
      if (e.kind === 'clause') sop.clauses.splice(sop.clauses.lastIndexOf(e.clause), 1);
      else e.target.tables.pop();
    }
    const title = (journal[j] as Extract<JournalEntry, { kind: 'clause' }>).clause.text;
    warnings.length = journal[j].warnLen;
    stack = journal[j].stack;
    journal = journal.slice(0, j);
    return title;
  };

  const markFormPage = (formCode: string, name: string) => {
    const f = forms.get(formCode);
    if (f) {
      f.hasPage = true;
      if (!f.name) f.name = name;
    } else {
      forms.set(formCode, { code: formCode, name, sop: sopOfForm(formCode, config), inList: false, hasPage: true });
    }
  };

  const readFrontTable = (table: ParsedTable) => {
    for (const row of table.rows) {
      row.forEach((cell, i) => {
        const name = (row[i - 1] ?? '').trim();
        if (sopRe.test(cell) && name && !toc.has(cell)) toc.set(cell, name);
        if (formRe.test(cell)) {
          const f = forms.get(cell);
          if (f) f.inList = true;
          else forms.set(cell, { code: cell, name, sop: sopOfForm(cell, config), inList: true, hasPage: false });
        }
      });
    }
  };

  const sopHeader = (table: ParsedTable): { code: string; title: string } | null => {
    let code: string | null = null;
    let title = '';
    for (const row of table.rows) {
      row.forEach((cell, i) => {
        if (headerLabelRe.test(cell) && sopRe.test(row[i + 1] ?? '')) code = row[i + 1];
        if (titleLabelRe.test(cell)) title = row.slice(i + 1).find(Boolean) ?? '';
      });
    }
    return code ? { code, title } : null;
  };

  const formMarker = (table: ParsedTable): string | null => {
    if (table.rows.length !== 1 || table.rows[0].length !== 1) return null;
    const cell = table.rows[0][0].trim();
    return formRe.test(cell) ? cell : null;
  };

  let prevBlock: Block | null = null;
  for (const block of blocks) {
    if (block.type === 'table') {
      const header = sopHeader(block.table);
      const formCode = header ? null : formMarker(block.table);
      if (header) {
        const title = header.title || toc.get(header.code) || '';
        // 문서에 같은 SOP 번호가 두 번 나오면(번호 오기) 번호는 그대로 두고 ID만 구분한다.
        let id = header.code;
        for (let n = 2; sops.some((s) => s.id === id); n++) id = `${header.code}~${n}`;
        if (id !== header.code) {
          const first = sops.find((s) => s.id === header.code)!;
          warnings.push(`${header.code}: SOP 번호 중복 — "${first.title}"와 "${title}"가 같은 번호를 씀 (뒤의 것을 ${id}로 구분)`);
        }
        sop = { id, code: header.code, title, clauses: [] };
        sops.push(sop);
        stack = [];
        journal = [];
        mode = 'cover';
      } else if (formCode) {
        // 서식 코드 표가 서식 내용 "앞"에 오는 문서: 서식 제목 문단이 직전 조항의 번호 없는 문단으로 들어갔다면 서식 이름으로 옮긴다.
        let name = '';
        if (prevBlock?.type === 'para') {
          name = prevBlock.text;
          const last = sop?.clauses[sop.clauses.length - 1];
          if (mode === 'body' && last && last.level === 0 && last.text === name) sop!.clauses.pop();
        }
        markFormPage(formCode, name);
        mode = 'form';
      } else if (mode === 'front') {
        readFrontTable(block.table);
      } else if (mode === 'body') {
        attachTable(block.table);
      }
    } else if (sop && formRe.test(squash(block.text))) {
      // 서식 코드만 있는 문단: 서식 페이지 표시. 서식 내용 "뒤"에 오는 문서라면 앞서 본문으로 들어간 서식 내용을 되돌린다.
      const formCode = squash(block.text);
      const listed = forms.get(formCode)?.name ?? '';
      const title = mode === 'body' ? retractFormPage(listed) : null;
      markFormPage(formCode, listed || title || '');
      mode = 'form';
    } else if (mode === 'cover' || mode === 'body') {
      const text = block.text;
      if (!ignoreRes.some((re) => re.test(text))) {
        const n = parseNumbered(text);
        if (mode === 'cover' && n?.level === 1) mode = 'body';
        if (mode === 'body' && sop) pushClause(n, text, text);
      }
    }
    prevBlock = block;
  }

  for (const [code, title] of toc) {
    if (!sops.some((s) => s.code === code)) warnings.push(`${code} (${title}): 목차에는 있으나 본문을 찾지 못함`);
  }
  for (const s of sops) {
    if (toc.size && !toc.has(s.code)) warnings.push(`${s.code}: 본문은 있으나 목차에 없음`);
    if (!s.clauses.length) warnings.push(`${s.id}: 조항을 하나도 읽지 못함`);
  }
  for (const f of forms.values()) {
    if (!f.hasPage) warnings.push(`${f.code} (${f.name}): 서식 목록에는 있으나 서식 페이지를 찾지 못함`);
    if (!f.inList && toc.size) warnings.push(`${f.code} (${f.name}): 서식 페이지는 있으나 서식 목록에 없음`);
  }
  const known = new Set(forms.keys());
  for (const s of sops) {
    for (const c of s.clauses) {
      for (const ref of c.formRefs) {
        if (!known.has(ref)) warnings.push(`${s.id} ${c.path}: 정의되지 않은 서식 ${ref}를 언급함`);
      }
    }
  }

  return {
    toc: [...toc].map(([code, title]) => ({ code, title })),
    sops,
    forms: [...forms.values()],
    warnings,
  };
}

function seqOf(token: string): number {
  if (/^\d+$/.test(token)) return Number(token);
  const k = KOREAN_SEQ.indexOf(token);
  if (k >= 0) return k + 1;
  const c = CIRCLED_SEQ.indexOf(token);
  return c >= 0 ? c + 1 : 0;
}

function sopOfForm(formCode: string, config: ParserConfig): string {
  return formCode.replace(new RegExp(`${config.formSuffix}$`), '');
}

/** 공백을 모두 뺀 문자열 (서식 이름·코드 비교용: "SOP 검토기록지" = "SOP검토기록지") */
function squash(s: string): string {
  return s.replace(/\s+/g, '');
}

function unique<T>(xs: T[]): T[] {
  return [...new Set(xs)];
}
