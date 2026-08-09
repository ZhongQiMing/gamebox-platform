/**
 * 高赔率玩法的单注上限。
 *
 * 六合彩连码一个 betType 能命中好几档赔率（四全中 9000 / 三全中 670 …），
 * 只看 betType 查表会漏掉最高那档，限红就形同虚设——这里把口径钉死。
 */
import { HIGH_ODDS_MAX_BET, HIGH_ODDS_THRESHOLD, highOddsBetCap } from '@gamebox/shared';
import { lhcGame } from './games/lhc.game';
import { lhcPayTableSeed } from './games/lhc-odds';
import type { LotteryPayTable } from './lottery.types';

const payTable = lhcPayTableSeed() as unknown as LotteryPayTable;

function lianma(play: string, nums: number[]) {
  return { betType: 'lianma', value: JSON.stringify({ play, nums }) };
}

describe('highOddsBetCap', () => {
  it('超过阈值才限，正好等于阈值不限', () => {
    expect(highOddsBetCap(HIGH_ODDS_THRESHOLD)).toBeNull();
    expect(highOddsBetCap(HIGH_ODDS_THRESHOLD + 1)).toBe(HIGH_ODDS_MAX_BET);
    expect(highOddsBetCap(1.98)).toBeNull();
  });

  it('赔率写坏成无穷大时按限住处理，不能反而放开', () => {
    expect(highOddsBetCap(Infinity)).toBe(HIGH_ODDS_MAX_BET);
    /* NaN 多来自「这个玩法没配赔率」，交给玩法校验去拒，不在这里误限 */
    expect(highOddsBetCap(NaN)).toBeNull();
  });
});

describe('六合彩连码取最高倍率', () => {
  it('四全中按 9000 算，会被限红', () => {
    const odds = lhcGame.maxOdds!(lianma('四全中', [1, 2, 3, 4]), payTable);
    expect(odds).toBe(9000);
    expect(highOddsBetCap(odds)).toBe(HIGH_ODDS_MAX_BET);
  });

  it('三全中按 670 算，同样超 500 要限', () => {
    const odds = lhcGame.maxOdds!(lianma('三全中', [1, 2, 3]), payTable);
    expect(odds).toBe(670);
    expect(highOddsBetCap(odds)).toBe(HIGH_ODDS_MAX_BET);
  });

  it('三中二取两档里高的那档，不是随手取一个', () => {
    const odds = lhcGame.maxOdds!(lianma('三中二', [1, 2, 3]), payTable);
    /* 中三 100 / 中二 20，必须取 100 */
    expect(odds).toBe(100);
    expect(highOddsBetCap(odds)).toBeNull();
  });

  it('二中特、二全中、特串都在 500 以内，不受限', () => {
    for (const [play, nums] of [
      ['二中特', [1, 2]],
      ['二全中', [1, 2]],
      ['特串', [1, 2]],
    ] as const) {
      const odds = lhcGame.maxOdds!(lianma(play, [...nums]), payTable);
      expect(odds).toBeGreaterThan(0);
      expect(highOddsBetCap(odds)).toBeNull();
    }
  });

  it('玩法名乱填返回 0，交给 validateBet 去拒', () => {
    expect(lhcGame.maxOdds!(lianma('十全中', [1, 2]), payTable)).toBe(0);
  });
});

/**
 * 看门测试：连码之外的赔率键一旦有人配到 500 倍以上，这条会红。
 *
 * 原因是六合彩的 betType 与赔率键不是一一对应（betType `lianma`
 * 能命中 siQuanZhong / sanQuanZhong 等多个键），maxOdds 只显式盖了连码。
 * 将来在别的玩法上挂出高赔率，必须同步扩 maxOdds，否则限红盖不住它。
 */
describe('高赔率玩法白名单', () => {
  const LIANMA_KEYS = new Set([
    'siQuanZhong', 'sanQuanZhong', 'sanZhongSan', 'sanZhongEr',
    'erQuanZhong', 'erZhongTe', 'erZhongTeTe', 'teChuan',
  ]);

  it('六合彩超过 500 倍的赔率键只有连码那几个', () => {
    const over = Object.entries(payTable)
      .filter(([, v]) => Number(v?.multiplier) > HIGH_ODDS_THRESHOLD)
      .map(([k]) => k);
    const uncovered = over.filter((k) => !LIANMA_KEYS.has(k));
    expect(uncovered).toEqual([]);
  });
});
