/**
 * 幸运六合彩：开奖 7 个不重复号码（1-49），末位为特码。
 * 特码 49 = 大 + 单（不和）。
 * 赔率键与 lhc-odds / H5 ODDS 对齐。
 */
import { createHmac } from 'node:crypto';
import type { LotteryGameDef, LotteryBetPayload, DrawResult, LotteryPayTable } from '../lottery.types';
import {
  yearZodiacAt,
  zodiacOfNum,
  waveColorOf,
} from './lhc-odds';

/**
 * HMAC-SHA256 Fisher-Yates：每一步独立派生，避免单次 hash 切片复用导致熵不足。
 * 用取模选下标，杜绝 rnd=1 时越界。
 */
function drawUnique(serverSeed: string, clientSeed: string, nonce: number, count: number, max: number): number[] {
  const pool = Array.from({ length: max }, (_, i) => i + 1);
  const key = `${serverSeed}:${clientSeed}:${nonce}`;
  for (let i = pool.length - 1; i > 0; i--) {
    const hex = createHmac('sha256', key).update(String(i)).digest('hex').slice(0, 8);
    const j = parseInt(hex, 16) % (i + 1);
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return pool.slice(0, count);
}

function digitSum(n: number) {
  return Math.floor(n / 10) + (n % 10);
}

function parseJsonValue<T = unknown>(value?: string | number): T | null {
  if (value == null || value === '') return null;
  if (typeof value !== 'string') return null;
  try {
    return JSON.parse(value) as T;
  } catch {
    return null;
  }
}

type LianmaVal = { play: string; nums: number[]; mode?: string };
type SxLianVal = { n: number; hit: boolean; zodiacs: string[]; mode?: string };
type WsLianVal = { n: number; hit: boolean; tails: number[]; mode?: string };
type BuZhongVal = { n: number; nums: number[] };
type LiuxiaoVal = { hit: boolean; zodiacs: string[] };

export const lhcGame: LotteryGameDef = {
  code: 'lhc',

  validateBet(betType: string, value?: string | number): boolean {
    const v = value == null ? '' : String(value);
    switch (betType) {
      case 'big':
      case 'small':
      case 'odd':
      case 'even':
        return true;
      case 'special':
      case 'zhengma': {
        const n = Number(v);
        return Number.isInteger(n) && n >= 1 && n <= 49;
      }
      case 'combo':
        return ['大单', '大双', '小单', '小双'].includes(v);
      case 'color':
        return ['红', '蓝', '绿'].includes(v);
      case 'temaZodiac':
      case 'pingZodiac':
        return /^[鼠牛虎兔龙蛇马羊猴鸡狗猪]$/.test(v);
      case 'heSide':
      case 'sumSide':
        return ['大', '小', '单', '双'].includes(v);
      case 'weiSide':
      case 'sumTail':
        return ['大', '小'].includes(v);
      case 'weiShu':
      case 'weiShuMiss': {
        const t = Number(v);
        return Number.isInteger(t) && t >= 0 && t <= 9;
      }
      case 'lianma': {
        const j = parseJsonValue<LianmaVal>(v);
        return !!(j && j.play && Array.isArray(j.nums) && j.nums.length >= 2);
      }
      /* n 的上下界必须与 lhc-odds 的赔率键一一对应，
         否则 judge 会返回赔率表里不存在的键 → odds 取 0 → 中了也不赔 */
      case 'sxLian': {
        const j = parseJsonValue<SxLianVal>(v);
        return !!(
          j && j.n >= 2 && j.n <= 5 && Array.isArray(j.zodiacs) && j.zodiacs.length >= j.n
        );
      }
      case 'wsLian': {
        const j = parseJsonValue<WsLianVal>(v);
        return !!(j && j.n >= 2 && j.n <= 4 && Array.isArray(j.tails) && j.tails.length >= j.n);
      }
      case 'buZhong': {
        const j = parseJsonValue<BuZhongVal>(v);
        return !!(j && j.n >= 5 && j.n <= 12 && Array.isArray(j.nums) && j.nums.length >= j.n);
      }
      case 'liuxiao': {
        const j = parseJsonValue<LiuxiaoVal>(v);
        return !!(j && Array.isArray(j.zodiacs) && j.zodiacs.length === 6);
      }
      default:
        return false;
    }
  },

  draw(serverSeed: string, clientSeed: string, nonce: number): DrawResult {
    const numbers = drawUnique(serverSeed, clientSeed, nonce, 7, 49);
    const special = numbers[6];
    const sum = numbers.reduce((a, b) => a + b, 0);
    const yearZ = yearZodiacAt();
    return {
      numbers,
      sum,
      extras: {
        special,
        isBig: special >= 25,
        isOdd: special % 2 !== 0,
        yearZodiac: yearZ,
        wave: waveColorOf(special),
        zodiac: zodiacOfNum(special, yearZ),
      },
    };
  },

  judge(bet: LotteryBetPayload, draw: DrawResult, _payTable: LotteryPayTable): string | null {
    const nums = draw.numbers;
    if (!nums || nums.length !== 7) return null;
    const sp = nums[6];
    const mains = nums.slice(0, 6);
    const zhengSet = new Set(mains);
    const yearZ = String(draw.extras['yearZodiac'] || yearZodiacAt());
    const sxSet = new Set(nums.map((n) => zodiacOfNum(n, yearZ)));
    const wsSet = new Set(nums.map((n) => n % 10));
    const v = bet.value == null ? '' : String(bet.value);

    switch (bet.betType) {
      case 'big':
        return sp >= 25 ? 'big' : null;
      case 'small':
        return sp <= 24 ? 'small' : null;
      case 'odd':
        return sp % 2 !== 0 ? 'odd' : null;
      case 'even':
        return sp % 2 === 0 ? 'even' : null;
      case 'special':
        return Number(v) === sp ? 'special' : null;
      case 'zhengma':
        return zhengSet.has(Number(v)) ? 'zhengma' : null;
      case 'combo': {
        const big = sp >= 25;
        const odd = sp % 2 !== 0;
        const hit =
          (v === '大单' && big && odd) ||
          (v === '大双' && big && !odd) ||
          (v === '小单' && !big && odd) ||
          (v === '小双' && !big && !odd);
        return hit ? 'combo' : null;
      }
      case 'color': {
        const w = waveColorOf(sp);
        if (v !== w) return null;
        if (w === '红') return 'colorRed';
        if (w === '蓝') return 'colorBlue';
        return 'colorGreen';
      }
      case 'temaZodiac': {
        if (zodiacOfNum(sp, yearZ) !== v) return null;
        return v === yearZ ? 'zodiacYear' : 'zodiac';
      }
      case 'pingZodiac': {
        if (!sxSet.has(v)) return null;
        return v === yearZ ? 'pingTeYear' : 'pingTe';
      }
      case 'heSide': {
        const hs = digitSum(sp);
        const meta = { big: hs >= 7, odd: hs % 2 === 1 };
        const hit =
          (v === '大' && meta.big) ||
          (v === '小' && !meta.big) ||
          (v === '单' && meta.odd) ||
          (v === '双' && !meta.odd);
        return hit ? 'heSide' : null;
      }
      case 'weiSide': {
        const w = sp % 10;
        if (v === '大') return w >= 5 ? 'weiSide' : null;
        if (v === '小') return w <= 4 ? 'weiSideSmall' : null;
        return null;
      }
      case 'sumSide': {
        const s = draw.sum;
        const meta = { big: s >= 175, odd: s % 2 === 1 };
        const hit =
          (v === '大' && meta.big) ||
          (v === '小' && !meta.big) ||
          (v === '单' && meta.odd) ||
          (v === '双' && !meta.odd);
        return hit ? 'sumSide' : null;
      }
      case 'sumTail': {
        const t = draw.sum % 10;
        if (v === '大') return t >= 5 ? 'sumTail' : null;
        if (v === '小') return t <= 4 ? 'sumTail' : null;
        return null;
      }
      case 'weiShu': {
        const t = Number(v);
        if (!wsSet.has(t)) return null;
        return t === 0 ? 'weiShu0' : 'weiShu';
      }
      case 'weiShuMiss': {
        const t = Number(v);
        if (wsSet.has(t)) return null;
        return t === 0 ? 'weiShuMiss0' : 'weiShuMiss';
      }
      case 'lianma': {
        const j = parseJsonValue<LianmaVal>(v);
        if (!j) return null;
        const need = j.play === '三全中' || j.play === '三中二' ? 3 : 2;
        const balls = (j.nums || []).map(Number).filter((n) => n >= 1 && n <= 49);
        if (balls.length < need) return null;
        // 单注：取前 need 个（客户端已拆注）
        const unit = balls.slice(0, need);
        const hitZ = unit.filter((n) => zhengSet.has(n)).length;
        const hitT = unit.filter((n) => n === sp).length;
        if (j.play === '三全中') return hitZ > 2 ? 'sanQuanZhong' : null;
        if (j.play === '三中二') {
          if (hitZ === 3) return 'sanZhongSan';
          if (hitZ === 2) return 'sanZhongEr';
          return null;
        }
        if (j.play === '二全中') return hitZ > 1 ? 'erQuanZhong' : null;
        if (j.play === '二中特') {
          if (hitZ > 0 && hitT > 0) return 'erZhongTeTe';
          if (hitZ > 1 && hitT === 0) return 'erZhongTe';
          return null;
        }
        if (j.play === '特串') return hitZ > 0 && hitT === 1 ? 'teChuan' : null;
        return null;
      }
      case 'sxLian': {
        const j = parseJsonValue<SxLianVal>(v);
        if (!j) return null;
        const zs = (j.zodiacs || []).slice(0, j.n);
        if (zs.length < j.n) return null;
        const hit = zs.filter((z) => sxSet.has(z)).length;
        const ok = j.hit ? hit >= zs.length : hit === 0;
        if (!ok) return null;
        return `${j.hit ? 'sxLianZhong' : 'sxLianBuZhong'}${j.n}`;
      }
      case 'wsLian': {
        const j = parseJsonValue<WsLianVal>(v);
        if (!j) return null;
        const tails = (j.tails || []).slice(0, j.n);
        if (tails.length < j.n) return null;
        const hit = tails.filter((t) => wsSet.has(Number(t))).length;
        const ok = j.hit ? hit >= tails.length : hit === 0;
        if (!ok) return null;
        return `${j.hit ? 'wsLianZhong' : 'wsLianBuZhong'}${j.n}`;
      }
      case 'buZhong': {
        const j = parseJsonValue<BuZhongVal>(v);
        if (!j) return null;
        const pick = (j.nums || []).slice(0, j.n);
        if (pick.length < j.n) return null;
        const hit = pick.some((n) => nums.includes(Number(n)));
        if (hit) return null;
        return `buZhong${j.n}`;
      }
      case 'liuxiao': {
        const j = parseJsonValue<LiuxiaoVal>(v);
        if (!j || j.zodiacs.length !== 6) return null;
        /* 特码 49 按港彩惯例为和局，退本（payTable.refund 倍率 1） */
        if (sp === 49) return 'refund';
        const has = j.zodiacs.includes(zodiacOfNum(sp, yearZ));
        const win = j.hit ? has : !has;
        return win ? 'liuxiao' : null;
      }
      default:
        return null;
    }
  },
};
