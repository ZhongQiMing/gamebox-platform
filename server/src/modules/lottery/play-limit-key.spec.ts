import { lotteryPlayLimitKey } from './play-limit-key';

const table = {
  big: { multiplier: 1.99 },
  sum_3: { multiplier: 168 },
  gySum_11: { multiplier: 8.5 },
  shape_豹子: { multiplier: 75 },
  dice1: { multiplier: 2.3 },
};

describe('lotteryPlayLimitKey', () => {
  it('maps compound keys for 和值 / 冠亚和', () => {
    expect(lotteryPlayLimitKey('sum', 3, table)).toBe('sum_3');
    expect(lotteryPlayLimitKey('gySum', 11, table)).toBe('gySum_11');
  });

  it('maps 形态 to shape_形态', () => {
    expect(lotteryPlayLimitKey('shape', '前三:豹子', table)).toBe('shape_豹子');
  });

  it('maps 三军 dice → dice1', () => {
    expect(lotteryPlayLimitKey('dice', 2, table)).toBe('dice1');
  });

  it('falls back to betType', () => {
    expect(lotteryPlayLimitKey('big', undefined, table)).toBe('big');
  });

  it('maps 连码 四全中 to siQuanZhong', () => {
    const lhc = { ...table, siQuanZhong: { multiplier: 9000 } };
    expect(lotteryPlayLimitKey('lianma', JSON.stringify({ play: '四全中', nums: [1, 2, 3, 4] }), lhc))
      .toBe('siQuanZhong');
  });
});
