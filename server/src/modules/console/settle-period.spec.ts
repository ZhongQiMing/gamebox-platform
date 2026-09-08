/**
 * 补结历史账期时的区间终点。
 *
 * 这里算错不会报任何错，只会让结算区间悄悄变短：半月结的房按 7 天结，
 * 后一半的流水既不进这期也不进下期，等于凭空少算一截钱，
 * 而且要等代理对账时才发现。四类边界（月末 31/30、2 月、跨年）都钉住。
 */
import {
  pickReplaySettledSheet,
  settlePeriodEndFor,
  shouldReplayLatestSettledAsLast,
} from './room-settle.service';

const SH_MS = 8 * 3600 * 1000;

/** 上海时区某天 00:00 对应的 UTC 时刻 */
function sh(y: number, m: number, d: number): Date {
  return new Date(Date.UTC(y, m - 1, d) - SH_MS);
}

function label(d: Date): string {
  const u = new Date(d.getTime() + SH_MS);
  return `${u.getUTCFullYear()}-${String(u.getUTCMonth() + 1).padStart(2, '0')}-${String(
    u.getUTCDate(),
  ).padStart(2, '0')}`;
}

describe('settlePeriodEndFor', () => {
  describe('WEEKLY_MON 周结', () => {
    it('固定 7 天', () => {
      expect(label(settlePeriodEndFor('WEEKLY_MON', sh(2026, 8, 3)))).toBe('2026-08-10');
    });

    it('跨月照样 7 天', () => {
      expect(label(settlePeriodEndFor('WEEKLY_MON', sh(2026, 7, 27)))).toBe('2026-08-03');
    });
  });

  describe('MONTHLY_15_30 半月结', () => {
    it('1 号起 → 15 号止，不是 8 号', () => {
      expect(label(settlePeriodEndFor('MONTHLY_15_30', sh(2026, 8, 1)))).toBe('2026-08-15');
    });

    it('15 号起 → 月末止（31 天的月）', () => {
      expect(label(settlePeriodEndFor('MONTHLY_15_30', sh(2026, 8, 15)))).toBe('2026-08-31');
    });

    it('15 号起 → 月末止（30 天的月）', () => {
      expect(label(settlePeriodEndFor('MONTHLY_15_30', sh(2026, 9, 15)))).toBe('2026-09-30');
    });

    it('月末起 → 次月 15 号止', () => {
      expect(label(settlePeriodEndFor('MONTHLY_15_30', sh(2026, 8, 31)))).toBe('2026-09-15');
    });

    it('2 月：15 号起 → 28 号止', () => {
      expect(label(settlePeriodEndFor('MONTHLY_15_30', sh(2026, 2, 15)))).toBe('2026-02-28');
    });

    it('跨年：12 月末起 → 次年 1 月 15 号止', () => {
      expect(label(settlePeriodEndFor('MONTHLY_15_30', sh(2026, 12, 31)))).toBe('2027-01-15');
    });
  });

  describe('MONTHLY_1 月结', () => {
    it('1 号起 → 次月 1 号止，不是 8 号', () => {
      expect(label(settlePeriodEndFor('MONTHLY_1', sh(2026, 8, 1)))).toBe('2026-09-01');
    });

    it('跨年：12 月 1 号起 → 次年 1 月 1 号止', () => {
      expect(label(settlePeriodEndFor('MONTHLY_1', sh(2026, 12, 1)))).toBe('2027-01-01');
    });
  });

  it('账期终点必定晚于起点，绝不返回反向区间', () => {
    const cycles = ['WEEKLY_MON', 'MONTHLY_15_30', 'MONTHLY_1'] as const;
    for (const cycle of cycles) {
      for (let m = 1; m <= 12; m++) {
        for (const d of [1, 15, 28]) {
          const start = sh(2026, m, d);
          expect(settlePeriodEndFor(cycle, start).getTime()).toBeGreaterThan(start.getTime());
        }
      }
    }
  });
});

describe('shouldReplayLatestSettledAsLast', () => {
  it('日历上周是 cron 全 0 关账单时，上期改指最近一张已结单', () => {
    expect(shouldReplayLatestSettledAsLast({
      calendarStatus: 'CLOSED',
      calendarBetFlow: 0,
      calendarHousePnl: 0,
      calendarSettlePay: 0,
    })).toBe(true);
  });

  it('日历上周没有账单时同样回放', () => {
    expect(shouldReplayLatestSettledAsLast({})).toBe(true);
  });

  it('日历上周已经结清则不回放，避免盖掉真正的上一期', () => {
    expect(shouldReplayLatestSettledAsLast({
      calendarStatus: 'SETTLED',
      calendarBetFlow: 0,
    })).toBe(false);
  });

  it('日历上周关账单上有流水则不回放', () => {
    expect(shouldReplayLatestSettledAsLast({
      calendarStatus: 'CLOSED',
      calendarBetFlow: 1000,
    })).toBe(false);
  });
});

describe('pickReplaySettledSheet', () => {
  const calendarStart = sh(2026, 8, 17);
  const calendarEnd = sh(2026, 8, 24);
  const settled = {
    weekStart: sh(2026, 8, 24),
    weekEnd: new Date(Date.UTC(2026, 7, 29, 14, 5, 0)),
  };
  const emptyClosed = {
    calendarStatus: 'CLOSED' as const,
    calendarBetFlow: 0,
    calendarHousePnl: 0,
    calendarSettlePay: 0,
  };

  it('前端钉死日历上周全 0 关账单时，改指最近已结单，不要求钉死时间戳等于 JS 日历午夜', () => {
    const pinned = new Date('2026-08-17T00:00:00.000Z');
    expect(pinned.getTime()).not.toBe(calendarStart.getTime());
    expect(pickReplaySettledSheet({
      ...emptyClosed,
      calendarWeekStart: pinned,
      latestSettled: settled,
    })).toEqual(settled);
  });

  it('已结单 weekEnd 不晚于日历上周终点时仍回放（旧逻辑要求 weekEnd > periodEnd，时区对齐时会打不着）', () => {
    const settledEqCalendarEnd = {
      weekStart: sh(2026, 8, 24),
      weekEnd: calendarEnd,
    };
    expect(settledEqCalendarEnd.weekEnd.getTime()).not.toBeGreaterThan(calendarEnd.getTime());
    expect(pickReplaySettledSheet({
      ...emptyClosed,
      calendarWeekStart: calendarStart,
      latestSettled: settledEqCalendarEnd,
    })).toEqual(settledEqCalendarEnd);
  });

  it('钉死的就是那张已结单时不改指', () => {
    expect(pickReplaySettledSheet({
      calendarStatus: 'SETTLED',
      calendarWeekStart: settled.weekStart,
      latestSettled: settled,
    })).toBeNull();
  });

  it('没有已结单时不改指', () => {
    expect(pickReplaySettledSheet({
      ...emptyClosed,
      calendarWeekStart: calendarStart,
      latestSettled: null,
    })).toBeNull();
  });
});
