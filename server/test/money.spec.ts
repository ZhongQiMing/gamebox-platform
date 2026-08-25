/**
 * 资金底座单测：金额取整与赔率口径。
 *
 * 这两块出错不会抛异常、不会有日志，只会让每一笔账都悄悄偏一点，
 * 等发现时已经赔穿了，所以边界值都要钉死。
 */
import {
  MAX_WIN_ABSOLUTE,
  MAX_WIN_MULTIPLIER,
  asMoney,
  capWin,
  formatMoney,
  formatSignedMoney,
  payoutForTableSide,
  payoutFromProfitOdds,
  payoutFromTotalOdds,
  roundMoney,
} from '@gamebox/shared';

describe('roundMoney', () => {
  it('四舍五入到分', () => {
    expect(roundMoney(1.005)).toBe(1.01);
    expect(roundMoney(1.004)).toBe(1);
    expect(roundMoney(-1.005)).toBe(-1);
    expect(roundMoney(2.675)).toBe(2.68);
  });

  it('浮点误差不外泄', () => {
    expect(roundMoney(0.1 + 0.2)).toBe(0.3);
    expect(roundMoney(1.1 * 3)).toBe(3.3);
  });

  it('非有限数按 0 处理', () => {
    /* 静默归零：调用方若把 NaN 当合法金额传进来，账面会凭空少一笔而不报错 */
    expect(roundMoney(NaN)).toBe(0);
    expect(roundMoney(Infinity)).toBe(0);
    expect(roundMoney(-Infinity)).toBe(0);
  });

  it('数字字符串按数值算，不能静默变 0', () => {
    /*
     * Prisma 的 Decimal 出接口就是字符串，类型标注是 number 也挡不住。
     * 早前这里用 Number.isFinite 直接判入参，Number.isFinite('10000') 为 false，
     * 于是一万块的上分申请在审核弹窗里显示成 0.00，审的人看不出金额。
     */
    expect(roundMoney('10000' as unknown as number)).toBe(10000);
    expect(roundMoney('12.345' as unknown as number)).toBe(12.35);
    expect(formatMoney('10000' as unknown as number)).toBe('10,000.00');
  });
});

describe('asMoney', () => {
  it('接受 number / 字符串 / Decimal 三种来源', () => {
    expect(asMoney(12.345)).toBe(12.35);
    expect(asMoney('12.345')).toBe(12.35);
    expect(asMoney({ toNumber: () => 12.345 })).toBe(12.35);
  });

  it('空值与脏数据归零，不抛异常', () => {
    expect(asMoney(null)).toBe(0);
    expect(asMoney(undefined)).toBe(0);
    expect(asMoney('')).toBe(0);
    expect(asMoney('  ')).toBe(0);
    expect(asMoney('abc')).toBe(0);
    expect(asMoney({})).toBe(0);
  });
});

describe('formatMoney', () => {
  it('千分位 + 固定两位', () => {
    expect(formatMoney(88888.5)).toBe('88,888.50');
    expect(formatMoney(0)).toBe('0.00');
    expect(formatMoney(-1234.567)).toBe('-1,234.57');
  });
});

describe('formatSignedMoney', () => {
  it('正数带加号，负数带减号，零不加号', () => {
    expect(formatSignedMoney(1234.5)).toBe('+1,234.50');
    expect(formatSignedMoney(-1234.5)).toBe('-1,234.50');
    expect(formatSignedMoney(0)).toBe('0.00');
  });
});

describe('赔率口径', () => {
  it('净赔率：返还 = 本金 + 本金×赔率', () => {
    expect(payoutFromProfitOdds(100, 0.95)).toBe(195);
    expect(payoutFromProfitOdds(100, 1)).toBe(200);
  });

  it('含本总赔率：返还 = 本金×赔率，不再补本金', () => {
    expect(payoutFromTotalOdds(100, 6.84)).toBe(684);
    expect(payoutFromTotalOdds(100, 1.82)).toBe(182);
  });

  it('payoutForTableSide 按赔率表自动选口径', () => {
    /* 斗牛庄闲是净赔率 */
    expect(payoutForTableSide('douniu', 'banker', 100)).toBe(195);
    expect(payoutForTableSide('douniu', 'player', 100)).toBe(200);
    /* 牛型三项是含本总赔率——照净赔率算会多送一份本金，RTP 直接破 100% */
    expect(payoutForTableSide('douniu', 'niuniu', 100)).toBe(684);
    expect(payoutForTableSide('douniu', 'niu79', 100)).toBe(298);
    expect(payoutForTableSide('douniu', 'niu06', 100)).toBe(182);
  });

  it('未知游戏或未知边返回 0，不会静默按 1 倍赔', () => {
    expect(payoutForTableSide('douniu', 'not-a-side', 100)).toBe(0);
    expect(payoutForTableSide('not-a-game', 'banker', 100)).toBe(0);
  });

  it('净赔率先把利润取整再加本金，不是整体取整', () => {
    /* 33.33×0.95=31.6635 → 利润 31.66 → 返还 64.99；整体取整会得到 65.00，差一分 */
    expect(payoutFromProfitOdds(33.33, 0.95)).toBe(64.99);
    expect(payoutFromTotalOdds(33.33, 1.82)).toBe(60.66);
  });
});

describe('派彩封顶', () => {
  it('没配过的天价仍被 5000 倍拦下', () => {
    expect(capWin(10, 9_000_000)).toEqual({ win: 50_000, capped: true });
    expect(capWin(10, 40_000)).toEqual({ win: 40_000, capped: false });
  });

  it('挂牌赔率高于 5000 倍时按赔率放行，页面与结算一致', () => {
    /* 六合彩四全中 9000 倍：不放行就只赔 5000 倍，等于页面写的赔率拿不到 */
    expect(capWin(10, 90_000, 9000)).toEqual({ win: 90_000, capped: false });
    expect(capWin(10, 90_001, 9000)).toEqual({ win: 90_000, capped: true });
  });

  it('赔率低于 5000 倍不会把上限压低', () => {
    expect(capWin(10, 60_000, 1.98)).toEqual({ win: 50_000, capped: true });
  });

  it('绝对额封顶不放开：大注仍然兜在 2000 万', () => {
    const stake = 100_000;
    expect(stake * 9000).toBeGreaterThan(MAX_WIN_ABSOLUTE);
    expect(capWin(stake, stake * 9000, 9000)).toEqual({
      win: MAX_WIN_ABSOLUTE,
      capped: true,
    });
    expect(MAX_WIN_MULTIPLIER).toBe(5000);
  });
});
