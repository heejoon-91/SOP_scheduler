/**
 * 기한 규칙 표현 (설계 문서 "기한 규칙 표현 방식").
 * 저장 형태는 JSON이며, 필드 이름은 설계 문서의 예와 같게 둔다 (override_rule 등).
 */

/** 기준 시점은 정해진 이름만 쓴다. 새 기준 시점이 필요하면 ANCHORS에 추가한다. */
export const ANCHORS = {
  received_at: '접수일',
  event_at: '발생 시각',
  'study.start': '시험 개시일',
  'study.end': '시험 종료일',
  'study.report_sent_at': '결과보고서 송부일',
  'study.report_finalized_at': '결과보고서 확정일',
  'study.product_approved_at': '품목허가·신고일',
} as const;

export type AnchorId = keyof typeof ANCHORS;

export type Unit = 'minute' | 'hour' | 'day' | 'week' | 'month' | 'year' | 'business_day';

export interface Offset {
  value: number;
  unit: Unit;
}

export type FieldValue = string | number | boolean;

/**
 * 조건식. field는 이벤트 입력 항목이나 시험 속성 이름이다.
 * 예: 사망 또는 생명위협 → { "any": [{ "field": "death", "eq": true }, { "field": "life_threat", "eq": true }] }
 */
export type Condition =
  | 'else'
  | { field: string; eq: FieldValue }
  | { field: string; in: FieldValue[] }
  | { all: Condition[] }
  | { any: Condition[] }
  | { not: Condition };

export interface DeadlineCase {
  when: Condition;
  offset: Offset;
}

export type DeadlineRule =
  /** 기준 시점 + 오프셋. cases가 있으면 조건별 오프셋. 즉시·지체 없이는 offset 0, soft true */
  | {
      kind: 'relative';
      anchor: AnchorId;
      offset?: Offset;
      cases?: DeadlineCase[];
      soft?: boolean;
      /** 시험·계약별 재정의 값의 이름. 예: "study.protocol_sae_deadline" */
      override?: string;
      /** min: 더 이른 쪽, replace: 재정의 값이 있으면 그것 */
      override_rule?: 'min' | 'replace';
    }
  /** 만료일 1건 등록 (예: 보고서 확정일 + 1년) */
  | { kind: 'expiry'; anchor: AnchorId; offset: Offset }
  /** 날짜 없음. 단계 전환을 막는다 (예: 시험 개시 전) */
  | { kind: 'gate'; before: string }
  /** 캘린더 반복 일정. RFC 5545 RRULE */
  | { kind: 'recurring'; rrule: string; dtstart?: string }
  /** 날짜로 계산할 수 없는 문구. 사용자가 날짜를 정해야 확정 가능 */
  | { kind: 'undefined'; flag: 'vague' | 'none'; note?: string };

export interface DeadlineSettings {
  /**
   * 일·주·월·년 단위 기간의 첫날 처리.
   * civil: 민법 제157조처럼 기준일을 빼고 다음 날부터 센다 ("접수일부터 7일" → 접수일 + 7일).
   * inclusive: 기준일을 1일째로 센다 ("접수일부터 7일" → 접수일 + 6일). 더 이른 기한이 나온다.
   */
  dayCounting: 'civil' | 'inclusive';
  /** 일 단위 기한의 마감 시각 */
  dayEnd: { hour: number; minute: number };
  /** 마지막 날이 휴일이면 다음 근무일로 넘긴다 (민법 제161조). 기본은 넘기지 않음 (기한이 늦어지는 쪽의 오류를 피함) */
  rollForwardOnHoliday: boolean;
}

export const DEFAULT_DEADLINE_SETTINGS: DeadlineSettings = {
  dayCounting: 'civil',
  dayEnd: { hour: 23, minute: 59 },
  rollForwardOnHoliday: false,
};
