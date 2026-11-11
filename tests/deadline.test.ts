import { describe, expect, it } from 'vitest';
import { addBusinessDays, isBusinessDay, koreanCalendar } from '../src/core/calendar/holidays';
import { computeDeadline, occurrences, type DeadlineContext, type DeadlineResult } from '../src/core/deadline/compute';
import type { DeadlineRule } from '../src/core/deadline/types';

const cal = koreanCalendar();
const at = (y: number, m: number, d: number, h = 0, min = 0) => new Date(y, m - 1, d, h, min);

function due(r: DeadlineResult): Date {
  if (r.status !== 'due') throw new Error(`expected due, got ${r.status}`);
  return r.dueAt;
}

/** COM/008 5.(1)2): 사망·생명위협 24시간, 그 외 48시간, 계획서 기한이 더 짧으면 그것 */
const saeToSponsor: DeadlineRule = {
  kind: 'relative',
  anchor: 'event_at',
  cases: [
    { when: { any: [{ field: 'death', eq: true }, { field: 'life_threat', eq: true }] }, offset: { value: 24, unit: 'hour' } },
    { when: 'else', offset: { value: 48, unit: 'hour' } },
  ],
  override: 'study.protocol_sae_deadline',
  override_rule: 'min',
};

describe('상대 기한 (일 단위)', () => {
  const rule: DeadlineRule = { kind: 'relative', anchor: 'received_at', offset: { value: 7, unit: 'day' } };
  const ctx: DeadlineContext = { anchors: { received_at: at(2026, 11, 10, 10) }, calendar: cal };

  it('기본(민법 157조): 접수일을 빼고 7일 → 접수일 + 7일 23:59', () => {
    expect(due(computeDeadline(rule, ctx))).toEqual(at(2026, 11, 17, 23, 59));
  });

  it('첫날 포함 설정: 접수일 + 6일', () => {
    expect(due(computeDeadline(rule, { ...ctx, settings: { dayCounting: 'inclusive' } }))).toEqual(at(2026, 11, 16, 23, 59));
  });

  it('마감 시각 설정을 따른다', () => {
    expect(due(computeDeadline(rule, { ...ctx, settings: { dayEnd: { hour: 18, minute: 0 } } }))).toEqual(at(2026, 11, 17, 18, 0));
  });

  it('기준 시점이 없으면 needs_input', () => {
    const r = computeDeadline(rule, { anchors: {}, calendar: cal });
    expect(r).toMatchObject({ status: 'needs_input', missingAnchors: ['received_at'] });
  });
});

describe('조건부 상대 기한 (중대한 이상반응 → 의뢰자 보고)', () => {
  const event = at(2026, 11, 10, 14, 30);

  it('사망이면 24시간', () => {
    const r = computeDeadline(saeToSponsor, { anchors: { event_at: event }, fields: { death: true }, calendar: cal });
    expect(due(r)).toEqual(at(2026, 11, 11, 14, 30));
    expect(r).toMatchObject({ caseIndex: 0, source: 'rule' });
  });

  it('생명위협이면 24시간 (사망 여부를 몰라도 판단 가능)', () => {
    const r = computeDeadline(saeToSponsor, { anchors: { event_at: event }, fields: { life_threat: true }, calendar: cal });
    expect(due(r)).toEqual(at(2026, 11, 11, 14, 30));
  });

  it('둘 다 아니면 48시간', () => {
    const r = computeDeadline(saeToSponsor, { anchors: { event_at: event }, fields: { death: false, life_threat: false }, calendar: cal });
    expect(due(r)).toEqual(at(2026, 11, 12, 14, 30));
    expect(r).toMatchObject({ caseIndex: 1 });
  });

  it('입력값이 없으면 else로 넘어가지 않고, 가장 이른 기한(24시간)을 임시로 보여준다', () => {
    const r = computeDeadline(saeToSponsor, { anchors: { event_at: event }, fields: { death: false }, calendar: cal });
    expect(r.status).toBe('needs_input');
    if (r.status !== 'needs_input') return;
    expect(r.missingFields).toEqual(['life_threat']);
    expect(r.provisional).toEqual(at(2026, 11, 11, 14, 30));
  });

  it('계획서 기한(36시간)이 더 짧으면 그것을 쓴다', () => {
    const r = computeDeadline(saeToSponsor, {
      anchors: { event_at: event },
      fields: { death: false, life_threat: false },
      overrides: { 'study.protocol_sae_deadline': { value: 36, unit: 'hour' } },
      calendar: cal,
    });
    expect(due(r)).toEqual(at(2026, 11, 12, 2, 30));
    expect(r).toMatchObject({ source: 'override' });
  });

  it('계획서 기한(36시간)이 더 길면 SOP 기한(24시간)을 유지한다', () => {
    const r = computeDeadline(saeToSponsor, {
      anchors: { event_at: event },
      fields: { death: true },
      overrides: { 'study.protocol_sae_deadline': { value: 36, unit: 'hour' } },
      calendar: cal,
    });
    expect(due(r)).toEqual(at(2026, 11, 11, 14, 30));
    expect(r).toMatchObject({ source: 'rule' });
  });
});

describe('계약서 값 우선 (replace)', () => {
  const rule: DeadlineRule = {
    kind: 'relative',
    anchor: 'study.end',
    offset: { value: 30, unit: 'day' },
    override: 'study.contract_report_deadline',
    override_rule: 'replace',
  };
  it('계약서 값이 더 길어도 계약서 값을 쓴다', () => {
    const r = computeDeadline(rule, {
      anchors: { 'study.end': at(2026, 11, 2) },
      overrides: { 'study.contract_report_deadline': { value: 45, unit: 'day' } },
      calendar: cal,
    });
    expect(due(r)).toEqual(at(2026, 12, 17, 23, 59));
  });
});

describe('즉시', () => {
  it('발생 시각 그대로, soft 표시', () => {
    const rule: DeadlineRule = { kind: 'relative', anchor: 'event_at', offset: { value: 0, unit: 'minute' }, soft: true };
    const r = computeDeadline(rule, { anchors: { event_at: at(2026, 11, 10, 9, 5) }, calendar: cal });
    expect(r).toMatchObject({ status: 'due', soft: true, dueAt: at(2026, 11, 10, 9, 5) });
  });
});

describe('근무일', () => {
  it('추석 연휴 전날 발생 → 다음 근무일은 연휴·주말 뒤 월요일', () => {
    const rule: DeadlineRule = { kind: 'relative', anchor: 'event_at', offset: { value: 1, unit: 'business_day' } };
    const r = computeDeadline(rule, { anchors: { event_at: at(2026, 9, 23, 15) }, calendar: cal });
    expect(due(r)).toEqual(at(2026, 9, 28, 23, 59));
  });

  it('대체공휴일을 건너뛴다', () => {
    expect(isBusinessDay(at(2026, 10, 5), cal)).toBe(false);
    expect(addBusinessDays(at(2026, 10, 2), 1, cal)).toEqual(at(2026, 10, 6));
  });

  it('회사 지정 휴일·근무일을 반영한다', () => {
    const c = koreanCalendar({ extraHolidays: { '2026-05-01': '근로자의 날' }, extraWorkdays: ['2026-10-05'] });
    expect(isBusinessDay(at(2026, 5, 1), c)).toBe(false);
    expect(isBusinessDay(at(2026, 10, 5), c)).toBe(true);
  });

  it('공휴일 표가 없는 연도는 경고한다', () => {
    const rule: DeadlineRule = { kind: 'relative', anchor: 'event_at', offset: { value: 1, unit: 'business_day' } };
    const r = computeDeadline(rule, { anchors: { event_at: at(2027, 3, 3) }, calendar: cal });
    expect(r.status === 'due' && r.warnings.some((w) => w.includes('2027년'))).toBe(true);
  });
});

describe('휴일 이월 설정', () => {
  // 2026-09-17 + 7일 = 09-24 (추석 연휴)
  const rule: DeadlineRule = { kind: 'relative', anchor: 'received_at', offset: { value: 7, unit: 'day' } };
  const anchors = { received_at: at(2026, 9, 17) };

  it('기본은 이월하지 않는다', () => {
    expect(due(computeDeadline(rule, { anchors, calendar: cal }))).toEqual(at(2026, 9, 24, 23, 59));
  });

  it('켜면 다음 근무일로 넘긴다', () => {
    expect(due(computeDeadline(rule, { anchors, calendar: cal, settings: { rollForwardOnHoliday: true } }))).toEqual(at(2026, 9, 28, 23, 59));
  });
});

describe('만료', () => {
  it('보고서 확정일 + 1년', () => {
    const rule: DeadlineRule = { kind: 'expiry', anchor: 'study.report_finalized_at', offset: { value: 1, unit: 'year' } };
    const r = computeDeadline(rule, { anchors: { 'study.report_finalized_at': at(2026, 11, 10) }, calendar: cal });
    expect(due(r)).toEqual(at(2027, 11, 10, 23, 59));
  });

  it('없는 날짜는 그달 말일 (2/29 + 1년 → 2/28)', () => {
    const rule: DeadlineRule = { kind: 'expiry', anchor: 'study.report_finalized_at', offset: { value: 1, unit: 'year' } };
    const r = computeDeadline(rule, { anchors: { 'study.report_finalized_at': at(2028, 2, 29) }, calendar: cal });
    expect(due(r)).toEqual(at(2029, 2, 28, 23, 59));
  });
});

describe('날짜가 없는 규칙', () => {
  it('선행 조건', () => {
    expect(computeDeadline({ kind: 'gate', before: 'study.start' }, { anchors: {}, calendar: cal })).toEqual({ status: 'gate', before: 'study.start' });
  });
  it('미정 (정기적으로)', () => {
    expect(computeDeadline({ kind: 'undefined', flag: 'vague', note: '정기적으로' }, { anchors: {}, calendar: cal })).toMatchObject({ status: 'undefined', flag: 'vague' });
  });
});

describe('반복', () => {
  it('매월 1·11·21일 (COM/017)', () => {
    const rule: DeadlineRule = { kind: 'recurring', rrule: 'FREQ=MONTHLY;BYMONTHDAY=1,11,21', dtstart: '2026-01-01' };
    expect(occurrences(rule, at(2026, 11, 1), at(2026, 11, 30, 23, 59))).toEqual([at(2026, 11, 1), at(2026, 11, 11), at(2026, 11, 21)]);
  });

  it('연 2회 (1월·7월 첫 근무일이 아니라 1일 기준)', () => {
    const rule: DeadlineRule = { kind: 'recurring', rrule: 'FREQ=YEARLY;BYMONTH=1,7;BYMONTHDAY=1', dtstart: '2026-01-01' };
    expect(occurrences(rule, at(2026, 1, 1), at(2027, 12, 31))).toEqual([at(2026, 1, 1), at(2026, 7, 1), at(2027, 1, 1), at(2027, 7, 1)]);
  });
});
