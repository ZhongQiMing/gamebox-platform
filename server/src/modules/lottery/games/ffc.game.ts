/**
 * 1分时时彩 / 快乐时时彩 游戏定义（5 球 0-9）
 *
 * 共用本文件：ffc 与 ssc 仅 code / 开奖间隔不同。
 *
 * betType + value：
 *   big|small|odd|even          总和两面
 *   exact                       猜个位（兼容旧） value=0-9
 *   ballSide                    定位两面 value="pos:side" pos=0-4 side=big|small|odd|even
 *   position                    定位胆   value="pos:digit"
 *   anyDigit                    不定位   value="前三|中三|后三:digit"
 *   group3                      组三     value="段:a,b"
 *   group6                      组六     value="段:a,b,c"
 *   lhh                         龙虎和   value=龙|虎|和（万vs个）
 *   niu                         斗牛     value=-1|1-9|10（无牛/牛几/牛牛）
 *   niuSide                     牛两面   value=大|小|单|双（无牛判输）
 *   shape                       形态     value="段:豹子|顺子|对子|半顺|杂六"
 */
import { createHash } from 'node:crypto';
import type { LotteryGameDef, LotteryBetPayload, DrawResult, LotteryPayTable } from '../lottery.types';

const SEG: Record<string, [number, number]> = {
  前三: [0, 3],
  中三: [1, 4],
  后三: [2, 5],
};
const SHAPES = new Set(['豹子', '顺子', '对子', '半顺', '杂六']);

function provableDraw(serverSeed: string, clientSeed: string, nonce: number, count: number, max: number): number[] {
  const input = `${serverSeed}:${clientSeed}:${nonce}`;
  const hex = createHash('sha256').update(input).digest('hex');
  const result: number[] = [];
  for (let i = 0; i < count; i++) {
    const slice = hex.slice(i * 8, i * 8 + 8);
    result.push(parseInt(slice, 16) % max);
  }
  return result;
}

function segOf(nums: number[], seg: string): number[] {
  const r = SEG[seg];
  if (!r) return [];
  return nums.slice(r[0], r[1]);
}

/** 斗牛：-1 无牛，10 牛牛，1~9 牛几 */
function niuValue(nums: number[]): number {
  const total = nums.reduce((a, b) => a + b, 0);
  for (let i = 0; i < 3; i++) {
    for (let j = i + 1; j < 4; j++) {
      for (let k = j + 1; k < 5; k++) {
        if ((nums[i] + nums[j] + nums[k]) % 10 === 0) {
          const v = (total - nums[i] - nums[j] - nums[k]) % 10;
          return v === 0 ? 10 : v;
        }
      }
    }
  }
  return -1;
}

function shapeOf(arr3: number[]): string {
  const s = arr3.slice().sort((a, b) => a - b);
  if (s[0] === s[2]) return '豹子';
  if (s[0] === s[1] || s[1] === s[2]) return '对子';
  for (let a = 0; a < 10; a++) {
    const set = new Set([a, (a + 1) % 10, (a + 2) % 10]);
    if (set.has(s[0]) && set.has(s[1]) && set.has(s[2])) return '顺子';
  }
  const adjacent = (x: number, y: number) => {
    const d = Math.abs(x - y);
    return d === 1 || d === 9;
  };
  if (adjacent(s[0], s[1]) || adjacent(s[1], s[2]) || adjacent(s[0], s[2])) return '半顺';
  return '杂六';
}

function parsePosSide(value?: string | number): { pos: number; side: string } | null {
  const m = String(value ?? '').match(/^([0-4]):(big|small|odd|even)$/);
  if (!m) return null;
  return { pos: +m[1], side: m[2] };
}

function parsePosDigit(value?: string | number): { pos: number; digit: number } | null {
  const m = String(value ?? '').match(/^([0-4]):([0-9])$/);
  if (!m) return null;
  return { pos: +m[1], digit: +m[2] };
}

function parseSegDigit(value?: string | number): { seg: string; digit: number } | null {
  const m = String(value ?? '').match(/^(前三|中三|后三):([0-9])$/);
  if (!m) return null;
  return { seg: m[1], digit: +m[2] };
}

function parseGroup3(value?: string | number): { seg: string; a: number; b: number } | null {
  const m = String(value ?? '').match(/^(前三|中三|后三):([0-9]),([0-9])$/);
  if (!m || m[2] === m[3]) return null;
  return { seg: m[1], a: +m[2], b: +m[3] };
}

function parseGroup6(value?: string | number): { seg: string; digits: number[] } | null {
  const m = String(value ?? '').match(/^(前三|中三|后三):([0-9]),([0-9]),([0-9])$/);
  if (!m) return null;
  const digits = [+m[2], +m[3], +m[4]];
  if (new Set(digits).size !== 3) return null;
  return { seg: m[1], digits };
}

function parseShape(value?: string | number): { seg: string; shape: string } | null {
  const m = String(value ?? '').match(/^(前三|中三|后三):(豹子|顺子|对子|半顺|杂六)$/);
  if (!m) return null;
  return { seg: m[1], shape: m[2] };
}

function matchBallSide(n: number, side: string): boolean {
  const big = n >= 5;
  const odd = n % 2 === 1;
  if (side === 'big') return big;
  if (side === 'small') return !big;
  if (side === 'odd') return odd;
  if (side === 'even') return !odd;
  return false;
}

export const ffcGame: LotteryGameDef = {
  code: 'ffc',

  validateBet(betType: string, value?: string | number): boolean {
    if (['big', 'small', 'odd', 'even'].includes(betType)) return true;
    if (betType === 'exact') {
      const n = Number(value);
      return Number.isInteger(n) && n >= 0 && n <= 9;
    }
    if (betType === 'ballSide') return !!parsePosSide(value);
    if (betType === 'position') return !!parsePosDigit(value);
    if (betType === 'anyDigit') return !!parseSegDigit(value);
    if (betType === 'group3') return !!parseGroup3(value);
    if (betType === 'group6') return !!parseGroup6(value);
    if (betType === 'lhh') return ['龙', '虎', '和'].includes(String(value ?? ''));
    if (betType === 'niu') {
      const n = Number(value);
      return Number.isInteger(n) && ((n >= 1 && n <= 10) || n === -1);
    }
    if (betType === 'niuSide') return ['大', '小', '单', '双'].includes(String(value ?? ''));
    if (betType === 'shape') {
      const p = parseShape(value);
      return !!(p && SHAPES.has(p.shape));
    }
    return false;
  },

  draw(serverSeed: string, clientSeed: string, nonce: number): DrawResult {
    const numbers = provableDraw(serverSeed, clientSeed, nonce, 5, 10);
    const sum = numbers.reduce((a, b) => a + b, 0);
    const wan = numbers[0];
    const ge = numbers[4];
    const lhh = wan > ge ? '龙' : wan < ge ? '虎' : '和';
    return {
      numbers,
      sum,
      extras: {
        last: ge,
        isBig: sum >= 23,
        isOdd: sum % 2 !== 0,
        lhh,
        niu: niuValue(numbers),
        shape前三: shapeOf(segOf(numbers, '前三')),
        shape中三: shapeOf(segOf(numbers, '中三')),
        shape后三: shapeOf(segOf(numbers, '后三')),
      },
    };
  },

  judge(bet: LotteryBetPayload, draw: DrawResult, _payTable: LotteryPayTable): string | null {
    const { betType, value } = bet;
    const { numbers, sum, extras } = draw;

    switch (betType) {
      case 'big':
        return sum >= 23 ? 'big' : null;
      case 'small':
        return sum <= 22 ? 'small' : null;
      case 'odd':
        return sum % 2 !== 0 ? 'odd' : null;
      case 'even':
        return sum % 2 === 0 ? 'even' : null;
      case 'exact':
        return Number(value) === (extras['last'] as number) ? 'exact' : null;

      case 'ballSide': {
        const p = parsePosSide(value);
        if (!p) return null;
        return matchBallSide(numbers[p.pos], p.side) ? 'ballSide' : null;
      }

      case 'position': {
        const p = parsePosDigit(value);
        if (!p) return null;
        return numbers[p.pos] === p.digit ? 'position' : null;
      }

      case 'anyDigit': {
        const p = parseSegDigit(value);
        if (!p) return null;
        return segOf(numbers, p.seg).includes(p.digit) ? 'anyDigit' : null;
      }

      case 'group3': {
        const p = parseGroup3(value);
        if (!p) return null;
        const seg = segOf(numbers, p.seg).slice().sort((a, b) => a - b);
        const aab = [p.a, p.a, p.b].sort((a, b) => a - b);
        const abb = [p.a, p.b, p.b].sort((a, b) => a - b);
        const same = (x: number[], y: number[]) => x[0] === y[0] && x[1] === y[1] && x[2] === y[2];
        return same(seg, aab) || same(seg, abb) ? 'group3' : null;
      }

      case 'group6': {
        const p = parseGroup6(value);
        if (!p) return null;
        const seg = segOf(numbers, p.seg);
        const set = new Set(seg);
        return set.size === 3 && p.digits.every((d) => set.has(d)) ? 'group6' : null;
      }

      case 'lhh': {
        const pick = String(value ?? '');
        const res = extras['lhh'] as string;
        if (pick !== res) return null;
        if (pick === '和') return 'tie';
        if (pick === '龙') return 'dragon';
        if (pick === '虎') return 'tiger';
        return null;
      }

      case 'niu': {
        const want = Number(value);
        const got = extras['niu'] as number;
        if (want !== got) return null;
        return want === -1 ? 'noNiu' : 'niu';
      }

      case 'niuSide': {
        const side = String(value ?? '');
        const v = extras['niu'] as number;
        /* 无牛直接判输（与常见私彩盘一致，不退本） */
        if (v === -1) return null;
        let hit = false;
        if (side === '大') hit = v >= 6;
        else if (side === '小') hit = v <= 5;
        else if (side === '单') hit = v % 2 === 1;
        else if (side === '双') hit = v % 2 === 0;
        return hit ? 'niuSide' : null;
      }

      case 'shape': {
        const p = parseShape(value);
        if (!p) return null;
        const got = extras[`shape${p.seg}`] as string;
        if (got !== p.shape) return null;
        return `shape_${p.shape}`;
      }

      default:
        return null;
    }
  },
};

/** 时时彩（SSC）= 分分彩相同逻辑，只是期号间隔不同 */
export const sscGame: LotteryGameDef = { ...ffcGame, code: 'ssc' };

/**
 * 【赔率唯一来源】改赔率只改这里；seed 写入 DB；H5 经 /pay-table 覆盖展示。SSC/FFC 共用。
 * multiplier = 含本金返还倍数（payout = 下注 × multiplier）。
 *
 * 盘口对齐常见私彩门面（两面/定位高标；斗牛/形态偏杀；组三 260 / 组六 125）。
 * 注意：组三 260 在「选 2 码、命中约 0.6%」规则下理论 RTP>100%，属门面价。
 * 牛两面：开无牛判输（不退本）。
 * 改动后跑 `pnpm audit:rtp ffc`。
 */
export const sscFfcPayTable = {
  refund: { multiplier: 1, desc: '和局退本' },
  big: { multiplier: 1.995, desc: '总和 23-45' },
  small: { multiplier: 1.995, desc: '总和 0-22' },
  odd: { multiplier: 1.995, desc: '总和为奇数' },
  even: { multiplier: 1.995, desc: '总和为偶数' },
  ballSide: { multiplier: 1.995, desc: '定位两面' },
  exact: { multiplier: 9.95, desc: '猜中个位数字' },
  position: { multiplier: 9.95, desc: '定位胆' },
  anyDigit: { multiplier: 3.6, desc: '不定位' },
  group3: { multiplier: 260, desc: '三星组三' },
  group6: { multiplier: 125, desc: '三星组六' },
  dragon: { multiplier: 1.995, desc: '龙（万>个）' },
  tiger: { multiplier: 1.995, desc: '虎（万<个）' },
  tie: { multiplier: 9, desc: '和（万=个）' },
  noNiu: { multiplier: 2.02, desc: '无牛' },
  niu: { multiplier: 9.9, desc: '牛1~牛9、牛牛' },
  niuSide: { multiplier: 1.98, desc: '牛大/小/单/双（无牛判输）' },
  shape_豹子: { multiplier: 75, desc: '前中后·豹子' },
  shape_顺子: { multiplier: 14.5, desc: '前中后·顺子' },
  shape_对子: { multiplier: 3.3, desc: '前中后·对子' },
  shape_半顺: { multiplier: 2.51, desc: '前中后·半顺' },
  shape_杂六: { multiplier: 3.01, desc: '前中后·杂六' },
} as const;
