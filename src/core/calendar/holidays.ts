/**
 * 한국 공휴일과 근무일 계산.
 *
 * 표는 연도별로 직접 관리한다. 등록되지 않은 연도에 근무일을 계산하면 결과에 경고가 붙는다.
 * 임시공휴일은 지정될 때마다 회사 설정(extraHolidays)으로 더한다.
 * 근로자의 날(5/1)은 회사마다 휴무가 달라 기본 표에 넣지 않았다. 휴무하는 회사는 회사 설정으로 더한다.
 */
export const KR_PUBLIC_HOLIDAYS: Record<number, Record<string, string>> = {
  2026: {
    '2026-01-01': '신정',
    '2026-02-16': '설날 연휴',
    '2026-02-17': '설날',
    '2026-02-18': '설날 연휴',
    '2026-03-01': '삼일절',
    '2026-03-02': '삼일절 대체공휴일',
    '2026-05-05': '어린이날',
    '2026-05-24': '부처님오신날',
    '2026-05-25': '부처님오신날 대체공휴일',
    '2026-06-03': '전국동시지방선거',
    '2026-06-06': '현충일',
    '2026-08-15': '광복절',
    '2026-08-17': '광복절 대체공휴일',
    '2026-09-24': '추석 연휴',
    '2026-09-25': '추석',
    '2026-09-26': '추석 연휴',
    '2026-10-03': '개천절',
    '2026-10-05': '개천절 대체공휴일',
    '2026-10-09': '한글날',
    '2026-12-25': '성탄절',
  },
};

export interface WorkCalendar {
  /** 'YYYY-MM-DD' → 이름 */
  holidays: Map<string, string>;
  /** 주말·공휴일이지만 근무하는 날 */
  extraWorkdays: Set<string>;
  /** 쉬는 요일 (0=일 … 6=토) */
  weekend: Set<number>;
  /** 공휴일 표가 있는 연도 */
  coveredYears: Set<number>;
}

export interface CalendarSettings {
  extraHolidays?: Record<string, string>;
  extraWorkdays?: string[];
  weekend?: number[];
}

export function koreanCalendar(settings: CalendarSettings = {}): WorkCalendar {
  const holidays = new Map<string, string>();
  for (const year of Object.values(KR_PUBLIC_HOLIDAYS)) for (const [d, n] of Object.entries(year)) holidays.set(d, n);
  for (const [d, n] of Object.entries(settings.extraHolidays ?? {})) holidays.set(d, n);
  return {
    holidays,
    extraWorkdays: new Set(settings.extraWorkdays ?? []),
    weekend: new Set(settings.weekend ?? [0, 6]),
    coveredYears: new Set(Object.keys(KR_PUBLIC_HOLIDAYS).map(Number)),
  };
}

export function ymd(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function isBusinessDay(d: Date, cal: WorkCalendar): boolean {
  const key = ymd(d);
  if (cal.extraWorkdays.has(key)) return true;
  return !cal.weekend.has(d.getDay()) && !cal.holidays.has(key);
}

/** 기준일 다음 날부터 세어 n번째 근무일 (n=0이면 기준일이 근무일일 때 그날, 아니면 다음 근무일). 시각은 유지한다. */
export function addBusinessDays(d: Date, n: number, cal: WorkCalendar): Date {
  const cur = new Date(d);
  if (n <= 0) {
    while (!isBusinessDay(cur, cal)) cur.setDate(cur.getDate() + 1);
    return cur;
  }
  let left = n;
  while (left > 0) {
    cur.setDate(cur.getDate() + 1);
    if (isBusinessDay(cur, cal)) left--;
  }
  return cur;
}
