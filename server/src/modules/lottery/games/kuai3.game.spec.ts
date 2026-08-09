import type { DrawResult, LotteryPayTable } from '../lottery.types';
import { kuai3Game, kuai3PayTable } from './kuai3.game';

const payTable = kuai3PayTable as unknown as LotteryPayTable;

function result(numbers: [number, number, number]): DrawResult {
  return {
    numbers,
    sum: numbers.reduce((sum, n) => sum + n, 0),
    extras: { isTriplet: numbers[0] === numbers[1] && numbers[1] === numbers[2] },
  };
}

describe('快三三军派彩口径', () => {
  it('所选点数出现一次、两次或三次都只返回同一个赔率键', () => {
    const bet = { betType: 'dice', value: 1 };

    expect(kuai3Game.judge(bet, result([1, 2, 3]), payTable)).toBe('dice1');
    expect(kuai3Game.judge(bet, result([1, 1, 3]), payTable)).toBe('dice1');
    expect(kuai3Game.judge(bet, result([1, 1, 1]), payTable)).toBe('dice1');
    expect(kuai3Game.judge(bet, result([2, 3, 4]), payTable)).toBeNull();
  });

  it('三军只保留统一 2.3 倍，不存在隐藏翻倍档', () => {
    expect(kuai3PayTable.dice1.multiplier).toBe(2.3);
    expect('dice2' in kuai3PayTable).toBe(false);
    expect('dice3' in kuai3PayTable).toBe(false);
  });

  it('命中率 91/216，统一 2.3 倍 RTP 为 96.90%', () => {
    const bet = { betType: 'dice', value: 1 };
    let hits = 0;
    for (let a = 1; a <= 6; a++) {
      for (let b = 1; b <= 6; b++) {
        for (let c = 1; c <= 6; c++) {
          if (kuai3Game.judge(bet, result([a, b, c]), payTable)) hits++;
        }
      }
    }

    expect(hits).toBe(91);
    expect((hits / 216) * kuai3PayTable.dice1.multiplier).toBeCloseTo(0.968_981_481_5, 10);
  });
});
