import type { DrawResult, LotteryPayTable } from '../lottery.types';
import { ffcGame, sscFfcPayTable } from './ffc.game';

const payTable = sscFfcPayTable as unknown as LotteryPayTable;

function result(first3: [number, number, number]): DrawResult {
  const numbers = [...first3, 0, 0];
  return {
    numbers,
    sum: numbers.reduce((sum, n) => sum + n, 0),
    extras: {},
  };
}

describe('时时彩组三注数口径', () => {
  it('只允许一张注明确指定 AAB 或 ABB', () => {
    expect(ffcGame.validateBet('group3', '前三:1,1,2')).toBe(true);
    expect(ffcGame.validateBet('group3', '前三:1,2,2')).toBe(true);
    expect(ffcGame.validateBet('group3', '前三:1,2')).toBe(false);
    expect(ffcGame.validateBet('group3', '前三:1,1,1')).toBe(false);
    expect(ffcGame.validateBet('group3', '前三:1,2,3')).toBe(false);
  });

  it('112 与 122 分开判定，不能一张注同时包中', () => {
    const aab = { betType: 'group3', value: '前三:1,1,2' };
    const abb = { betType: 'group3', value: '前三:1,2,2' };

    expect(ffcGame.judge(aab, result([2, 1, 1]), payTable)).toBe('group3');
    expect(ffcGame.judge(abb, result([2, 1, 1]), payTable)).toBeNull();
    expect(ffcGame.judge(abb, result([2, 1, 2]), payTable)).toBe('group3');
    expect(ffcGame.judge(aab, result([2, 1, 2]), payTable)).toBeNull();
  });

  it('旧两码注不能再新下，但发布前待结算注仍按旧规则判定', () => {
    const legacy = { betType: 'group3', value: '前三:1,2' };

    expect(ffcGame.validateBet(legacy.betType, legacy.value)).toBe(false);
    expect(ffcGame.judge(legacy, result([1, 1, 2]), payTable)).toBe('group3');
    expect(ffcGame.judge(legacy, result([1, 2, 2]), payTable)).toBe('group3');
  });

  it('单张组三命中率 3/1000，260 倍 RTP 为 78%', () => {
    const bet = { betType: 'group3', value: '前三:1,1,2' };
    let hits = 0;
    for (let a = 0; a < 10; a++) {
      for (let b = 0; b < 10; b++) {
        for (let c = 0; c < 10; c++) {
          if (ffcGame.judge(bet, result([a, b, c]), payTable)) hits++;
        }
      }
    }

    expect(hits).toBe(3);
    expect((hits / 1000) * sscFfcPayTable.group3.multiplier).toBeCloseTo(0.78, 10);
  });
});
