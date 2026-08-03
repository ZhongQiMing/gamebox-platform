/**
 * 幸运六合彩：开奖 7 个不重复号码（1-49），末位为特码。
 * 两面/色波半波/合肖等：特码 49 = 和局退本金。
 * 总和只计前六正码（大和150）；正肖同肖个数分档赔率。
 * 赔率键与 lhc-odds / H5 ODDS 对齐。
 */
import { createHmac } from 'node:crypto';
import type { LotteryGameDef, LotteryBetPayload, DrawResult, LotteryPayTable } from '../lottery.types';
import {
  yearZodiacAt,
  zodiacOfNum,
  waveColorOf,
  wuxingOf,
  wuxingPayKey,
  matchColorCombo,
  colorHalfPayKey,
  colorHalfHalfPayKey,
  LHC_COLOR_HALF_ODDS,
  LHC_COLOR_HALF_HALF_ODDS,
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

/** 解析 `pos:payload`，pos 为 1–6 */
function parsePosValue(v: string): { pos: number; rest: string } | null {
  const m = String(v).match(/^([1-6]):(.+)$/);
  if (!m) return null;
  return { pos: Number(m[1]), rest: m[2] };
}

type LianmaVal = { play: string; nums: number[]; mode?: string };
type SxLianVal = { n: number; hit: boolean; zodiacs: string[]; mode?: string };
type WsLianVal = { n: number; hit: boolean; tails: number[]; mode?: string };
type BuZhongVal = { n: number; nums: number[] };
type LiuxiaoVal = { hit: boolean; zodiacs: string[] };
type HeXiaoVal = { n: number; zodiacs: string[] };

const ZODIAC_RE = /^[鼠牛虎兔龙蛇马羊猴鸡狗猪]$/;
const WUXING_SET = new Set(['金', '木', '水', '火', '土']);
const LIANMA_PLAYS = new Set(['四全中', '三中二', '三全中', '二全中', '二中特', '特串']);

function lianmaNeed(play: string): number {
  if (play === '四全中') return 4;
  if (play === '三全中' || play === '三中二') return 3;
  return 2;
}

/** 恰好 exact 个、去重、落在 [min,max] 的整数；否则 null */
function distinctInts(arr: unknown, min: number, max: number, exact: number): number[] | null {
  if (!Array.isArray(arr) || arr.length !== exact) return null;
  const out: number[] = [];
  const seen = new Set<number>();
  for (const x of arr) {
    const n = Number(x);
    if (!Number.isInteger(n) || n < min || n > max || seen.has(n)) return null;
    seen.add(n);
    out.push(n);
  }
  return out;
}

function distinctZodiacs(arr: unknown, exact: number): string[] | null {
  if (!Array.isArray(arr) || arr.length !== exact) return null;
  const out: string[] = [];
  const seen = new Set<string>();
  for (const x of arr) {
    const z = String(x);
    if (!ZODIAC_RE.test(z) || seen.has(z)) return null;
    seen.add(z);
    out.push(z);
  }
  return out;
}

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
      case 'zhengTe': {
        const p = parsePosValue(v);
        if (!p) return false;
        const n = Number(p.rest);
        return Number.isInteger(n) && n >= 1 && n <= 49;
      }
      case 'combo':
        return ['大单', '大双', '小单', '小双'].includes(v);
      case 'zhengCombo': {
        const p = parsePosValue(v);
        return !!(p && ['大单', '大双', '小单', '小双'].includes(p.rest));
      }
      case 'zhengSide': {
        const p = parsePosValue(v);
        return !!(p && ['大', '小', '单', '双'].includes(p.rest));
      }
      case 'zhengHe': {
        const p = parsePosValue(v);
        return !!(p && ['大', '小', '单', '双'].includes(p.rest));
      }
      case 'zhengWei': {
        const p = parsePosValue(v);
        return !!(p && ['大', '小'].includes(p.rest));
      }
      case 'zhengColor': {
        const p = parsePosValue(v);
        return !!(p && ['红', '蓝', '绿'].includes(p.rest));
      }
      case 'color':
        return ['红', '蓝', '绿'].includes(v);
      case 'colorHalf':
        return Object.prototype.hasOwnProperty.call(LHC_COLOR_HALF_ODDS, v);
      case 'colorHalfHalf':
        return Object.prototype.hasOwnProperty.call(LHC_COLOR_HALF_HALF_ODDS, v);
      case 'temaZodiac':
      case 'pingZodiac':
      case 'zhengXiao':
        return ZODIAC_RE.test(v);
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
      case 'temaTou': {
        const t = Number(v);
        return Number.isInteger(t) && t >= 0 && t <= 4;
      }
      case 'temaWei': {
        const t = Number(v);
        return Number.isInteger(t) && t >= 0 && t <= 9;
      }
      case 'wuxing':
        return WUXING_SET.has(v);
      case 'heXiao': {
        const j = parseJsonValue<HeXiaoVal>(v);
        if (!j || j.n < 2 || j.n > 11) return false;
        return !!distinctZodiacs(j.zodiacs, j.n);
      }
      case 'lianma': {
        const j = parseJsonValue<LianmaVal>(v);
        if (!j || !LIANMA_PLAYS.has(j.play)) return false;
        return !!distinctInts(j.nums, 1, 49, lianmaNeed(j.play));
      }
      case 'sxLian': {
        const j = parseJsonValue<SxLianVal>(v);
        if (!j || j.n < 2 || j.n > 5 || typeof j.hit !== 'boolean') return false;
        return !!distinctZodiacs(j.zodiacs, j.n);
      }
      case 'wsLian': {
        const j = parseJsonValue<WsLianVal>(v);
        if (!j || j.n < 2 || j.n > 5 || typeof j.hit !== 'boolean') return false;
        return !!distinctInts(j.tails, 0, 9, j.n);
      }
      case 'buZhong': {
        const j = parseJsonValue<BuZhongVal>(v);
        if (!j || j.n < 5 || j.n > 12) return false;
        return !!distinctInts(j.nums, 1, 49, j.n);
      }
      case 'liuxiao': {
        const j = parseJsonValue<LiuxiaoVal>(v);
        if (!j || typeof j.hit !== 'boolean') return false;
        return !!distinctZodiacs(j.zodiacs, 6);
      }
      default:
        return false;
    }
  },

  draw(serverSeed: string, clientSeed: string, nonce: number): DrawResult {
    const numbers = drawUnique(serverSeed, clientSeed, nonce, 7, 49);
    const special = numbers[6];
    const mains = numbers.slice(0, 6);
    /* sum 与总和玩法一致：仅前六正码；七码总和放 totalSum */
    const zhengSum = mains.reduce((a, b) => a + b, 0);
    const totalSum = zhengSum + special;
    const yearZ = yearZodiacAt();
    const tie49 = special === 49;
    return {
      numbers,
      sum: zhengSum,
      extras: {
        special,
        zhengSum,
        totalSum,
        isBig: !tie49 && special >= 25,
        isOdd: !tie49 && special % 2 !== 0,
        isTie49: tie49,
        yearZodiac: yearZ,
        wave: waveColorOf(special),
        zodiac: zodiacOfNum(special, yearZ),
        wuxing: wuxingOf(special),
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
        if (sp === 49) return 'refund';
        return sp >= 25 ? 'big' : null;
      case 'small':
        if (sp === 49) return 'refund';
        return sp <= 24 ? 'small' : null;
      case 'odd':
        if (sp === 49) return 'refund';
        return sp % 2 !== 0 ? 'odd' : null;
      case 'even':
        if (sp === 49) return 'refund';
        return sp % 2 === 0 ? 'even' : null;
      case 'special':
        return Number(v) === sp ? 'special' : null;
      case 'zhengma':
        return zhengSet.has(Number(v)) ? 'zhengma' : null;
      case 'zhengTe': {
        const p = parsePosValue(v);
        if (!p) return null;
        return mains[p.pos - 1] === Number(p.rest) ? 'zhengTe' : null;
      }
      case 'combo': {
        if (sp === 49) return 'refund';
        const big = sp >= 25;
        const odd = sp % 2 !== 0;
        const hit =
          (v === '大单' && big && odd) ||
          (v === '大双' && big && !odd) ||
          (v === '小单' && !big && odd) ||
          (v === '小双' && !big && !odd);
        return hit ? 'combo' : null;
      }
      case 'zhengSide': {
        const p = parsePosValue(v);
        if (!p) return null;
        const n = mains[p.pos - 1];
        if (n === 49) return 'refund';
        const big = n >= 25;
        const odd = n % 2 !== 0;
        const hit =
          (p.rest === '大' && big) ||
          (p.rest === '小' && !big) ||
          (p.rest === '单' && odd) ||
          (p.rest === '双' && !odd);
        return hit ? 'zhengSide' : null;
      }
      case 'zhengCombo': {
        const p = parsePosValue(v);
        if (!p) return null;
        const n = mains[p.pos - 1];
        if (n === 49) return 'refund';
        const big = n >= 25;
        const odd = n % 2 !== 0;
        const hit =
          (p.rest === '大单' && big && odd) ||
          (p.rest === '大双' && big && !odd) ||
          (p.rest === '小单' && !big && odd) ||
          (p.rest === '小双' && !big && !odd);
        return hit ? 'zhengCombo' : null;
      }
      case 'zhengHe': {
        const p = parsePosValue(v);
        if (!p) return null;
        const n = mains[p.pos - 1];
        if (n === 49) return 'refund';
        const hs = digitSum(n);
        const meta = { big: hs >= 7, odd: hs % 2 === 1 };
        const hit =
          (p.rest === '大' && meta.big) ||
          (p.rest === '小' && !meta.big) ||
          (p.rest === '单' && meta.odd) ||
          (p.rest === '双' && !meta.odd);
        return hit ? 'zhengHe' : null;
      }
      case 'zhengWei': {
        const p = parsePosValue(v);
        if (!p) return null;
        const n = mains[p.pos - 1];
        if (n === 49) return 'refund';
        const w = n % 10;
        if (p.rest === '大') return w >= 5 ? 'zhengWei' : null;
        if (p.rest === '小') return w <= 4 ? 'zhengWeiSmall' : null;
        return null;
      }
      case 'zhengColor': {
        const p = parsePosValue(v);
        if (!p) return null;
        const w = waveColorOf(mains[p.pos - 1]);
        if (p.rest !== w) return null;
        if (w === '红') return 'colorRed';
        if (w === '蓝') return 'colorBlue';
        return 'colorGreen';
      }
      case 'color': {
        const w = waveColorOf(sp);
        if (v !== w) return null;
        if (w === '红') return 'colorRed';
        if (w === '蓝') return 'colorBlue';
        return 'colorGreen';
      }
      case 'colorHalf': {
        if (sp === 49) return 'refund';
        if (!matchColorCombo(sp, v)) return null;
        return colorHalfPayKey(v);
      }
      case 'colorHalfHalf': {
        if (sp === 49) return 'refund';
        if (!matchColorCombo(sp, v)) return null;
        return colorHalfHalfPayKey(v);
      }
      case 'temaZodiac': {
        if (zodiacOfNum(sp, yearZ) !== v) return null;
        return v === yearZ ? 'zodiacYear' : 'zodiac';
      }
      case 'pingZodiac': {
        if (!sxSet.has(v)) return null;
        return v === yearZ ? 'pingTeYear' : 'pingTe';
      }
      case 'zhengXiao': {
        const count = mains.filter((n) => zodiacOfNum(n, yearZ) === v).length;
        if (count <= 0) return null;
        const base = v === yearZ ? 'zhengXiaoYear' : 'zhengXiao';
        return base + Math.min(count, 5);
      }
      case 'heSide': {
        if (sp === 49) return 'refund';
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
        if (sp === 49) return 'refund';
        const w = sp % 10;
        if (v === '大') return w >= 5 ? 'weiSide' : null;
        if (v === '小') return w <= 4 ? 'weiSideSmall' : null;
        return null;
      }
      case 'sumSide': {
        const s = mains.reduce((a, b) => a + b, 0);
        const meta = { big: s >= 150, odd: s % 2 === 1 };
        const hit =
          (v === '大' && meta.big) ||
          (v === '小' && !meta.big) ||
          (v === '单' && meta.odd) ||
          (v === '双' && !meta.odd);
        return hit ? 'sumSide' : null;
      }
      case 'sumTail': {
        const t = mains.reduce((a, b) => a + b, 0) % 10;
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
      case 'temaTou': {
        const t = Number(v);
        const head = Math.floor(sp / 10);
        if (head !== t) return null;
        return t === 0 ? 'temaTou0' : 'temaTou';
      }
      case 'temaWei': {
        const t = Number(v);
        const tail = sp % 10;
        if (tail !== t) return null;
        return t === 0 ? 'temaWei0' : 'temaWei';
      }
      case 'wuxing': {
        const wx = wuxingOf(sp);
        if (v !== wx) return null;
        return wuxingPayKey(wx);
      }
      case 'heXiao': {
        if (sp === 49) return 'refund';
        const j = parseJsonValue<HeXiaoVal>(v);
        if (!j || j.n < 2 || j.n > 11) return null;
        const zs = distinctZodiacs(j.zodiacs, j.n);
        if (!zs) return null;
        const tz = zodiacOfNum(sp, yearZ);
        if (!zs.includes(tz)) return null;
        return `heXiao${j.n}`;
      }
      case 'lianma': {
        const j = parseJsonValue<LianmaVal>(v);
        if (!j || !LIANMA_PLAYS.has(j.play)) return null;
        const need = lianmaNeed(j.play);
        const unit = distinctInts(j.nums, 1, 49, need);
        if (!unit) return null;
        const hitZ = unit.filter((n) => zhengSet.has(n)).length;
        const hitT = unit.filter((n) => n === sp).length;
        if (j.play === '四全中') return hitZ >= 4 ? 'siQuanZhong' : null;
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
        if (!j || typeof j.hit !== 'boolean' || j.n < 2 || j.n > 5) return null;
        const zs = distinctZodiacs(j.zodiacs, j.n);
        if (!zs) return null;
        const hit = zs.filter((z) => sxSet.has(z)).length;
        const ok = j.hit ? hit >= zs.length : hit === 0;
        if (!ok) return null;
        if (!j.hit) return `sxLianBuZhong${j.n}`;
        const hasYear = zs.includes(yearZ);
        return hasYear ? `sxLianZhong${j.n}Year` : `sxLianZhong${j.n}`;
      }
      case 'wsLian': {
        const j = parseJsonValue<WsLianVal>(v);
        if (!j || typeof j.hit !== 'boolean' || j.n < 2 || j.n > 5) return null;
        const tails = distinctInts(j.tails, 0, 9, j.n);
        if (!tails) return null;
        const hit = tails.filter((t) => wsSet.has(t)).length;
        const ok = j.hit ? hit >= tails.length : hit === 0;
        if (!ok) return null;
        if (!j.hit) return `wsLianBuZhong${j.n}`;
        /* V66：五连尾含 0 尾赔率更高 */
        if (j.n === 5 && tails.includes(0)) return 'wsLianZhong5Zero';
        return `wsLianZhong${j.n}`;
      }
      case 'buZhong': {
        const j = parseJsonValue<BuZhongVal>(v);
        if (!j || j.n < 5 || j.n > 12) return null;
        const pick = distinctInts(j.nums, 1, 49, j.n);
        if (!pick) return null;
        const hit = pick.some((n) => nums.includes(n));
        if (hit) return null;
        return `buZhong${j.n}`;
      }
      case 'liuxiao': {
        const j = parseJsonValue<LiuxiaoVal>(v);
        if (!j || typeof j.hit !== 'boolean') return null;
        const zs = distinctZodiacs(j.zodiacs, 6);
        if (!zs) return null;
        /* 特码 49 按港彩惯例为和局，退本（payTable.refund 倍率 1） */
        if (sp === 49) return 'refund';
        const has = zs.includes(zodiacOfNum(sp, yearZ));
        const win = j.hit ? has : !has;
        return win ? 'liuxiao' : null;
      }
      default:
        return null;
    }
  },
};
