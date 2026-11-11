/** 파싱 결과 모델. 설계 문서의 SopSet·Clause·Form에 대응한다. */

/** 병합 셀을 풀어 모든 칸을 채운 표. rows[r][c]는 해당 칸의 텍스트. */
export interface ParsedTable {
  rows: string[][];
}

export interface Clause {
  /** `${sop}#${path}`. 같은 경로가 문서에 두 번 나오면 뒤의 것은 `~2`, `~3`을 붙여 고유하게 한다 */
  id: string;
  /** 소속 SOP의 id (Sop.id) */
  sop: string;
  /** 조항 경로. 예: "5.(1)2)", "4-1(2)", 번호 없는 문단은 "6.¶1" */
  path: string;
  /** 이 조항 자신의 번호. 예: "(1)". 번호 없는 문단은 "" */
  label: string;
  /** 번호 단계 1~6. 번호 없는 문단은 0 */
  level: number;
  parentId: string | null;
  /** 번호를 뺀 본문 */
  text: string;
  /** 정규화한 본문의 해시. 개정 전후 변경 감지용 */
  hash: string;
  tables: ParsedTable[];
  /** 본문이 언급한 서식 코드 */
  formRefs: string[];
  /** 본문이 언급한 다른 SOP 코드 */
  sopRefs: string[];
}

export interface Sop {
  /** 문서 안에서 고유한 ID. 보통 code와 같고, 같은 SOP 번호가 두 번 나오면 뒤의 것은 `~2`를 붙인다 */
  id: string;
  /** 문서에 적힌 SOP 번호 */
  code: string;
  title: string;
  clauses: Clause[];
}

export interface FormDef {
  code: string;
  name: string;
  sop: string;
  /** 서식 목록 표에 있음 */
  inList: boolean;
  /** 서식 본문 페이지가 있음 */
  hasPage: boolean;
}

export interface ParsedSopSet {
  toc: { code: string; title: string }[];
  sops: Sop[];
  forms: FormDef[];
  /** 파싱 실패를 일찍 잡기 위한 경고 (번호 건너뜀, 서식 누락 등) */
  warnings: string[];
}
