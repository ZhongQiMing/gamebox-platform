/**
 * 1分快三游戏定义（3 颗骰子 1-6）
 *
 * 玩法：
 *   big|small|odd|even     和值两面（豹子通杀）
 *   sum                    猜总和 4-17，value=点数
 *   triplet                任意豹子
 *   tripletN               指定豹子，value=1-6
 *   dice                   三军，value=1-6；命中键 dice1|dice2|dice3 按出现次数赔
 *   pair                   二同号，value=1-6（恰好 2 次）
 *   straight               三连号通选；value=123 等形式为单选
 *   alldiff                三不同号
 *   long                   长牌，value="a:b"（a<b，1-6）
 */
import { createHash } from 'node:crypto';
import type { LotteryGameDef, LotteryBetPayload, DrawResult, LotteryPayTable } from '../lottery.types';

function k3Draw(serverSeed: string, clientSeed: string, nonce: number): number[] {
  const input = `${serverSeed}:${clientSeed}:${nonce}`;
  const hex = createHash('sha256').update(input).digest('hex');
  return Array.from({ length: 3 }, (_, i) =>
    (parseInt(hex.slice(i * 8, i * 8 + 8), 16) % 6) + 1
  );
}

function parseDiceNum(value?: string | number): number | null {
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1 || n > 6) return null;
  return n;
}

function parseLongPair(value?: string | number): { a: number; b: number } | null {
  const s = String(value ?? '');
  const m = s.match(/^([1-6]):([1-6])$/);
  if (!m) return null;
  const a = +m[1];
  const b = +m[2];
  if (a === b) return null;
  return { a: Math.min(a, b), b: Math.max(a, b) };
}

function parseStraightSelect(value?: string | number): number[] | null {
  const s = String(value ?? '');
  if (!/^[1-6]{3}$/.test(s)) return null;
  const nums = s.split('').map(Number);
  if (nums[0] + 1 !== nums[1] || nums[1] + 1 !== nums[2]) return null;
  return nums;
}

function countOf(nums: number[], n: number): number {
  return nums.filter((x) => x === n).length;
}

function isTriplet(nums: number[]): boolean {
  return nums[0] === nums[1] && nums[1] === nums[2];
}

function isPairShape(nums: number[]): boolean {
  if (isTriplet(nums)) return false;
  return nums[0] === nums[1] || nums[1] === nums[2] || nums[0] === nums[2];
}

function isStraightShape(nums: number[]): boolean {
  if (isTriplet(nums)) return false;
  const s = nums.slice().sort((a, b) => a - b);
  return s[0] + 1 === s[1] && s[1] + 1 === s[2];
}

function isSanButong(nums: number[]): boolean {
  if (isTriplet(nums) || isPairShape(nums) || isStraightShape(nums)) return false;
  return true;
}

export const kuai3Game: LotteryGameDef = {
  code: 'kuai3',

  validateBet(betType: string, value?: string | number): boolean {
    if (['big', 'small', 'odd', 'even', 'triplet', 'alldiff'].includes(betType)) return true;
    if (betType === 'sum') {
      const n = Number(value);
      return Number.isInteger(n) && n >= 4 && n <= 17;
    }
    if (['dice', 'pair', 'tripletN'].includes(betType)) return parseDiceNum(value) != null;
    if (betType === 'straight') {
      if (value == null || value === '' || value === 'any') return true;
      return parseStraightSelect(value) != null;
    }
    if (betType === 'long') return parseLongPair(value) != null;
    return false;
  },

  draw(serverSeed: string, clientSeed: string, nonce: number): DrawResult {
    const numbers = k3Draw(serverSeed, clientSeed, nonce);
    const sum = numbers.reduce((a, b) => a + b, 0);
    const triplet = isTriplet(numbers);
    return {
      numbers,
      sum,
      extras: {
        isTriplet: triplet,
        isBig: !triplet && sum >= 11,
        isOdd: sum % 2 !== 0,
      },
    };
  },

  judge(bet: LotteryBetPayload, draw: DrawResult, _pt: LotteryPayTable): string | null {
    const { numbers, sum, extras } = draw;
    const triplet = extras['isTriplet'] as boolean;
    switch (bet.betType) {
      case 'big':
        return !triplet && sum >= 11 && sum <= 17 ? 'big' : null;
      case 'small':
        return !triplet && sum >= 4 && sum <= 10 ? 'small' : null;
      case 'odd':
        return !triplet && sum % 2 !== 0 ? 'odd' : null;
      case 'even':
        return !triplet && sum % 2 === 0 ? 'even' : null;
      case 'triplet':
        return triplet ? 'triplet' : null;
      case 'sum': {
        const want = Number(bet.value);
        if (!Number.isInteger(want) || want < 4 || want > 17) return null;
        return sum === want ? `sum_${want}` : null;
      }
      case 'dice': {
        const n = parseDiceNum(bet.value);
        if (n == null) return null;
        const c = countOf(numbers, n);
        if (c === 1) return 'dice1';
        if (c === 2) return 'dice2';
        if (c === 3) return 'dice3';
        return null;
      }
      case 'pair': {
        const n = parseDiceNum(bet.value);
        return n != null && countOf(numbers, n) === 2 ? 'pair' : null;
      }
      case 'tripletN': {
        const n = parseDiceNum(bet.value);
        return n != null && countOf(numbers, n) === 3 ? 'tripletN' : null;
      }
      case 'straight': {
        if (bet.value == null || bet.value === '' || bet.value === 'any') {
          return isStraightShape(numbers) ? 'straight' : null;
        }
        const want = parseStraightSelect(bet.value);
        if (!want) return null;
        const got = numbers.slice().sort((a, b) => a - b);
        /* 单选命中率是通选的 1/4，必须走独立赔率键 */
        return got[0] === want[0] && got[1] === want[1] && got[2] === want[2]
          ? 'straightN'
          : null;
      }
      case 'alldiff':
        return isSanButong(numbers) ? 'alldiff' : null;
      case 'long': {
        const pair = parseLongPair(bet.value);
        if (!pair) return null;
        return numbers.includes(pair.a) && numbers.includes(pair.b) ? 'long' : null;
      }
      default:
        return null;
    }
  },
};

/**
 * 【赔率唯一来源】改赔率只改这里；seed 写入 DB；H5 经 /pay-table 覆盖展示。
 * multiplier = 含本金返还倍数。改动后跑 `node scripts/rtp-audit.cjs kuai3` 校验。
 * 和值赔率按 216 种组合的精确出现次数标定（如和值 4 只有 3/216）。
 */
export const kuai3PayTable = {
  big: { multiplier: 1.98, desc: '总和 11-17（非豹子）' },
  small: { multiplier: 1.98, desc: '总和 4-10（非豹子）' },
  odd: { multiplier: 1.98, desc: '总和奇数（非豹子）' },
  even: { multiplier: 1.98, desc: '总和偶数（非豹子）' },
  triplet: { multiplier: 34.5, desc: '任意豹子' },
  tripletN: { multiplier: 207.0, desc: '指定豹子' },
  sum: { multiplier: 7.68, desc: '和值兜底' },
  sum_4: { multiplier: 69, desc: '和值4' },
  sum_5: { multiplier: 34.5, desc: '和值5' },
  sum_6: { multiplier: 20.7, desc: '和值6' },
  sum_7: { multiplier: 13.8, desc: '和值7' },
  sum_8: { multiplier: 9.85, desc: '和值8' },
  sum_9: { multiplier: 8.29, desc: '和值9' },
  sum_10: { multiplier: 7.68, desc: '和值10' },
  sum_11: { multiplier: 7.68, desc: '和值11' },
  sum_12: { multiplier: 8.29, desc: '和值12' },
  sum_13: { multiplier: 9.85, desc: '和值13' },
  sum_14: { multiplier: 13.8, desc: '和值14' },
  sum_15: { multiplier: 20.7, desc: '和值15' },
  sum_16: { multiplier: 34.5, desc: '和值16' },
  sum_17: { multiplier: 69, desc: '和值17' },
  dice1: { multiplier: 2.0, desc: '三军出现1次' },
  dice2: { multiplier: 3.0, desc: '三军出现2次' },
  dice3: { multiplier: 4.0, desc: '三军出现3次' },
  pair: { multiplier: 13.8, desc: '二同号' },
  straight: { multiplier: 8.64, desc: '三连号通选' },
  straightN: { multiplier: 34.5, desc: '三连号单选' },
  alldiff: { multiplier: 2.16, desc: '三不同号' },
  long: { multiplier: 6.9, desc: '长牌' },
};
