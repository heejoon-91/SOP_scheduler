import { ANCHORS, type DeadlineRule, type Offset } from '../deadline/types';

const UNIT_LABELS: Record<Offset['unit'], string> = {
  minute: '분',
  hour: '시간',
  day: '일',
  week: '주',
  month: '개월',
  year: '년',
  business_day: '근무일',
};

const FREQ_LABELS: Record<string, string> = { DAILY: '매일', WEEKLY: '매주', MONTHLY: '매월', YEARLY: '매년' };

export function describeOffset(o: Offset): string {
  if (o.value === 0) return '즉시';
  return `${o.value < 0 ? '' : '+'}${o.value}${UNIT_LABELS[o.unit]}`;
}

/** 기한 규칙을 사람이 읽는 한 줄로 바꾼다. 예: "발생 시각 +48시간" */
export function describeRule(rule: DeadlineRule): string {
  switch (rule.kind) {
    case 'relative': {
      const anchor = ANCHORS[rule.anchor];
      if (rule.cases?.length) return `${anchor} 기준 조건별 (${rule.cases.map((c) => describeOffset(c.offset)).join(' / ')})`;
      if (rule.offset?.value === 0) return `${anchor} 즉시`;
      return `${anchor} ${rule.offset ? describeOffset(rule.offset) : ''}`;
    }
    case 'expiry':
      return `만료: ${ANCHORS[rule.anchor]} ${describeOffset(rule.offset)}`;
    case 'gate':
      return `선행 조건: ${rule.before} 전`;
    case 'recurring':
      return `반복: ${describeRrule(rule.rrule)}`;
    case 'undefined':
      return `미정 (${rule.note ?? rule.flag})`;
  }
}

function describeRrule(rrule: string): string {
  const parts = Object.fromEntries(rrule.split(';').map((p) => p.split('=') as [string, string]));
  const interval = Number(parts.INTERVAL ?? 1);
  const unit = { DAILY: '일', WEEKLY: '주', MONTHLY: '개월', YEARLY: '년' }[parts.FREQ] ?? parts.FREQ;
  let s = interval > 1 ? `${interval}${unit}마다` : (FREQ_LABELS[parts.FREQ] ?? parts.FREQ);
  if (parts.BYMONTHDAY) s += ` ${parts.BYMONTHDAY.split(',').join('·')}일`;
  if (parts.BYDAY === 'MO,TU,WE,TH,FR') s = '근무일마다';
  return s;
}
