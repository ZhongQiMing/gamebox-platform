import { shanghaiRangeBounds } from './shanghai-range';

describe('shanghaiRangeBounds', () => {
  it('上海凌晨 01:41 的「今日」从当天 00:00 起，不从 UTC 0 点起', () => {
    const now = Date.parse('2026-08-29T01:41:00+08:00');
    const [from, to] = shanghaiRangeBounds('today', now);
    expect(from.toISOString()).toBe('2026-08-28T16:00:00.000Z');
    expect(to.toISOString()).toBe('2026-08-29T16:00:00.000Z');
    const [yFrom, yTo] = shanghaiRangeBounds('yesterday', now);
    expect(yFrom.toISOString()).toBe('2026-08-27T16:00:00.000Z');
    expect(yTo.toISOString()).toBe('2026-08-28T16:00:00.000Z');
  });

  it('刚过 00:00 也算新的一天', () => {
    const now = Date.parse('2026-08-29T00:00:01+08:00');
    const [from] = shanghaiRangeBounds('today', now);
    expect(from.toISOString()).toBe('2026-08-28T16:00:00.000Z');
  });
});
