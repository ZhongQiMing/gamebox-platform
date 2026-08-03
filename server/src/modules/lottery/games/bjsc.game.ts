/**
 * 北京赛车 / 极速赛车 / 幸运飞艇（10 车排列 1-10）
 *
 * betType + value：
 *   top2big|top2small|top2odd|top2even   冠亚和两面
 *   champion|runner                     冠/亚军号（兼容旧） value=1-10
 *   position                            定位车号 value="pos:num" pos=0-9 num=1-10
 *   posSide                             名次两面 value="pos:big|small|odd|even"（号≥6为大）
 *   lhh                                 龙虎 value="a:b:龙|虎"（a/b 为 0 起赛道下标）
 *   gySum                               冠亚和值 value=3-19 → 命中 key gySum_N
 */
import { createHash } from 'node:crypto';
import type { LotteryGameDef, LotteryBetPayload, DrawResult, LotteryPayTable } from '../lottery.types';

const SIDE_EN = new Set(['big', 'small', 'odd', 'even']);

function bjscDraw(serverSeed: string, clientSeed: string, nonce: number): number[] {
  const cars = Array.from({ length: 10 }, (_, i) => i + 1);
  const input = `${serverSeed}:${clientSeed}:${nonce}`;
  const hex = createHash('sha256').update(input).digest('hex');
  for (let i = cars.length - 1; i > 0; i--) {
    const slice = hex.slice((i * 4) % 60, (i * 4) % 60 + 4);
    const j = parseInt(slice, 16) % (i + 1);
    [cars[i], cars[j]] = [cars[j], cars[i]];
  }
  return cars;
}

function parsePosNum(value?: string | number): { pos: number; num: number } | null {
  const m = String(value ?? '').match(/^([0-9]):(10|[1-9])$/);
  if (!m) return null;
  const pos = +m[1];
  const num = +m[2];
  if (pos < 0 || pos > 9 || num < 1 || num > 10) return null;
  return { pos, num };
}

function parsePosSide(value?: string | number): { pos: number; side: string } | null {
  const m = String(value ?? '').match(/^([0-9]):(big|small|odd|even)$/);
  if (!m) return null;
  const pos = +m[1];
  if (pos < 0 || pos > 9) return null;
  return { pos, side: m[2] };
}

function parseLhh(value?: string | number): { a: number; b: number; pick: string } | null {
  const m = String(value ?? '').match(/^([0-9]):([0-9]):(龙|虎)$/);
  if (!m) return null;
  const a = +m[1];
  const b = +m[2];
  if (a < 0 || a > 9 || b < 0 || b > 9 || a >= b) return null;
  return { a, b, pick: m[3] };
}

function matchPosSide(n: number, side: string): boolean {
  const big = n >= 6;
  const odd = n % 2 === 1;
  if (side === 'big') return big;
  if (side === 'small') return !big;
  if (side === 'odd') return odd;
  if (side === 'even') return !odd;
  return false;
}

export const bjscGame: LotteryGameDef = {
  code: 'bjsc',

  validateBet(betType: string, value?: string | number): boolean {
    if (['top2big', 'top2small', 'top2odd', 'top2even'].includes(betType)) return true;
    if (betType === 'champion' || betType === 'runner') {
      const n = Number(value);
      return Number.isInteger(n) && n >= 1 && n <= 10;
    }
    if (betType === 'position') return !!parsePosNum(value);
    if (betType === 'posSide') return !!parsePosSide(value);
    if (betType === 'lhh') return !!parseLhh(value);
    if (betType === 'gySum') {
      const n = Number(value);
      return Number.isInteger(n) && n >= 3 && n <= 19;
    }
    return false;
  },

  draw(serverSeed: string, clientSeed: string, nonce: number): DrawResult {
    const numbers = bjscDraw(serverSeed, clientSeed, nonce);
    const top2sum = numbers[0] + numbers[1];
    return {
      numbers,
      sum: top2sum,
      extras: {
        champion: numbers[0],
        runner: numbers[1],
        top2sum,
      },
    };
  },

  judge(bet: LotteryBetPayload, draw: DrawResult, _pt: LotteryPayTable): string | null {
    const { numbers, extras } = draw;
    const top2sum = extras['top2sum'] as number;

    switch (bet.betType) {
      case 'champion':
        return Number(bet.value) === extras['champion'] ? 'champion' : null;
      case 'runner':
        return Number(bet.value) === extras['runner'] ? 'runner' : null;
      case 'top2big':
      case 'top2small':
      case 'top2odd':
      case 'top2even':
        /* 官方：冠亚和值 11 为和局，退还本金（大小单双均退） */
        if (top2sum === 11) return 'refund';
        if (bet.betType === 'top2big') return top2sum >= 12 ? 'top2big' : null;
        if (bet.betType === 'top2small') return top2sum <= 10 ? 'top2small' : null;
        if (bet.betType === 'top2odd') return top2sum % 2 !== 0 ? 'top2odd' : null;
        return top2sum % 2 === 0 ? 'top2even' : null;

      case 'position': {
        const p = parsePosNum(bet.value);
        if (!p) return null;
        return numbers[p.pos] === p.num ? 'position' : null;
      }

      case 'posSide': {
        const p = parsePosSide(bet.value);
        if (!p || !SIDE_EN.has(p.side)) return null;
        return matchPosSide(numbers[p.pos], p.side) ? 'posSide' : null;
      }

      case 'lhh': {
        const p = parseLhh(bet.value);
        if (!p) return null;
        const res = numbers[p.a] > numbers[p.b] ? '龙' : '虎';
        return res === p.pick ? 'lhh' : null;
      }

      case 'gySum': {
        const want = Number(bet.value);
        if (!Number.isInteger(want) || want < 3 || want > 19) return null;
        return top2sum === want ? `gySum_${want}` : null;
      }

      default:
        return null;
    }
  },
};

export const speedRacingGame: LotteryGameDef = { ...bjscGame, code: 'speed-racing' };
export const speedBoatGame: LotteryGameDef = { ...bjscGame, code: 'speed-boat' };

/**
 * 【赔率唯一来源】改赔率只改这里；seed 写入 DB；H5 经 /pay-table 覆盖展示。PK10 三兄弟共用。
 * multiplier = 含本金返还倍数。改动后跑 `pnpm audit:rtp bjsc` 校验。
 *
 * 冠亚两面：和值 11 和局退本；大小为 12-19 / 3-10。产品两边同赔 1.995。
 */
export const bjscPayTable = {
  refund: { multiplier: 1, desc: '和局退本' },
  champion: { multiplier: 9.95, desc: '猜赛道1/冠军号码（1-10）' },
  runner: { multiplier: 9.95, desc: '猜赛道2/亚军号码（1-10）' },
  top2big: { multiplier: 1.995, desc: '冠亚和大（12-19）' },
  top2small: { multiplier: 1.995, desc: '冠亚和小（3-10）；11 和局' },
  top2odd: { multiplier: 1.995, desc: '冠亚和奇（11 和局）' },
  top2even: { multiplier: 1.995, desc: '冠亚和偶（11 和局）' },
  position: { multiplier: 9.95, desc: '定位车号（1-10名）' },
  posSide: { multiplier: 1.995, desc: '名次两面' },
  lhh: { multiplier: 1.995, desc: '龙虎' },
  gySum_3: { multiplier: 42.5, desc: '冠亚和3' },
  gySum_4: { multiplier: 42.5, desc: '冠亚和4' },
  gySum_5: { multiplier: 21.5, desc: '冠亚和5' },
  gySum_6: { multiplier: 21.5, desc: '冠亚和6' },
  gySum_7: { multiplier: 14.5, desc: '冠亚和7' },
  gySum_8: { multiplier: 14.5, desc: '冠亚和8' },
  gySum_9: { multiplier: 10.5, desc: '冠亚和9' },
  gySum_10: { multiplier: 10.5, desc: '冠亚和10' },
  gySum_11: { multiplier: 8.5, desc: '冠亚和11' },
  gySum_12: { multiplier: 10.5, desc: '冠亚和12' },
  gySum_13: { multiplier: 10.5, desc: '冠亚和13' },
  gySum_14: { multiplier: 14.5, desc: '冠亚和14' },
  gySum_15: { multiplier: 14.5, desc: '冠亚和15' },
  gySum_16: { multiplier: 21.5, desc: '冠亚和16' },
  gySum_17: { multiplier: 21.5, desc: '冠亚和17' },
  gySum_18: { multiplier: 42.5, desc: '冠亚和18' },
  gySum_19: { multiplier: 42.5, desc: '冠亚和19' },
} as const;
