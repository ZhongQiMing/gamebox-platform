/**
 * 机器人氛围注 · 按真实开奖号码结算（中奖核对）
 * 禁止随机点名「中奖」；口令解析覆盖 genRobotBet 产出的玩法。
 */
import type { LotteryBetPayload, LotteryGameDef, LotteryPayTable, DrawResult } from '../lottery/lottery.types';
import { lhcGame } from '../lottery/games/lhc.game';
import { lhcPayTableSeed, yearZodiacAt, zodiacOfNum, waveColorOf } from '../lottery/games/lhc-odds';
import { kuai3Game, kuai3PayTable } from '../lottery/games/kuai3.game';
import { bjscGame, bjscPayTable } from '../lottery/games/bjsc.game';
import { ffcGame, sscGame, sscFfcPayTable } from '../lottery/games/ffc.game';
import type { RoomChatPlayLine } from './room-chat.types';

const SIDE_MAP: Record<string, string> = { 大: 'big', 小: 'small', 单: 'odd', 双: 'even' };
const DIGIT5_POS: Record<string, number> = { 万: 0, 千: 1, 百: 2, 十: 3, 个: 4 };
const CN_NUM: Record<string, number> = { 二: 2, 三: 3, 四: 4, 五: 5 };
const RACING = new Set(['bjsc', 'speed-racing', 'speed-boat']);
const DIGIT5 = new Set(['ssc', 'ffc']);

function money2(n: number) {
  return Math.round(n * 100) / 100;
}

/** 斗牛（与 ffc.game 一致，仅氛围结算用） */
function niuValue(nums: number[]): number {
  const total = nums.reduce((a, b) => a + b, 0);
  for (let i = 0; i < 3; i++) {
    for (let j = i + 1; j < 4; j++) {
      for (let k = j + 1; k < 5; k++) {
        if ((nums[i]! + nums[j]! + nums[k]!) % 10 === 0) {
          const rest = total - nums[i]! - nums[j]! - nums[k]!;
          const t = rest % 10;
          return t === 0 ? 10 : t;
        }
      }
    }
  }
  return -1;
}

function shapeOf(seg: number[]): string {
  const s = seg.slice().sort((a, b) => a - b);
  if (s[0] === s[1] && s[1] === s[2]) return '豹子';
  const uniq = [...new Set(s)];
  if (uniq.length === 2) return '对子';
  const a = s[0]!, b = s[1]!, c = s[2]!;
  const straight =
    (b === a + 1 && c === b + 1) ||
    (a === 0 && b === 1 && c === 9) ||
    (a === 0 && b === 8 && c === 9);
  if (straight) return '顺子';
  const half =
    b === a + 1 || c === b + 1 || (a === 0 && c === 9);
  return half ? '半顺' : '杂六';
}

function seedPay(gameCode: string): LotteryPayTable | null {
  if (gameCode === 'lhc') return lhcPayTableSeed() as LotteryPayTable;
  if (gameCode === 'kuai3') return kuai3PayTable as unknown as LotteryPayTable;
  if (RACING.has(gameCode)) return bjscPayTable as unknown as LotteryPayTable;
  if (gameCode === 'ssc' || gameCode === 'ffc') return sscFfcPayTable as unknown as LotteryPayTable;
  return null;
}

function gameBundle(
  gameCode: string,
  payTable?: LotteryPayTable | null,
): { game: LotteryGameDef; pay: LotteryPayTable } | null {
  const seed = seedPay(gameCode);
  if (!seed) return null;
  const pay =
    payTable && typeof payTable === 'object' && Object.keys(payTable).length
      ? payTable
      : seed;
  if (gameCode === 'lhc') return { game: lhcGame, pay };
  if (gameCode === 'kuai3') return { game: kuai3Game, pay };
  if (RACING.has(gameCode)) return { game: { ...bjscGame, code: gameCode }, pay };
  if (gameCode === 'ssc') return { game: sscGame, pay };
  if (gameCode === 'ffc') return { game: ffcGame, pay };
  return null;
}

export function buildDrawFromNums(gameCode: string, nums: number[]): DrawResult | null {
  if (!Array.isArray(nums) || !nums.length) return null;
  const sum = nums.reduce((a, b) => a + b, 0);

  if (gameCode === 'lhc') {
    if (nums.length !== 7) return null;
    const special = nums[6]!;
    const mains = nums.slice(0, 6);
    const zhengSum = mains.reduce((a, b) => a + b, 0);
    const tie49 = special === 49;
    const yearZ = yearZodiacAt();
    return {
      numbers: nums.slice(),
      sum: zhengSum,
      extras: {
        special,
        zhengSum,
        totalSum: zhengSum + special,
        isBig: !tie49 && special >= 25,
        isOdd: !tie49 && special % 2 !== 0,
        isTie49: tie49,
        yearZodiac: yearZ,
        wave: waveColorOf(special),
        zodiac: zodiacOfNum(special, yearZ),
      },
    };
  }

  if (gameCode === 'kuai3') {
    if (nums.length !== 3) return null;
    const triplet = nums[0] === nums[1] && nums[1] === nums[2];
    return {
      numbers: nums.slice(),
      sum,
      extras: {
        isTriplet: triplet,
        isBig: !triplet && sum >= 11,
        isOdd: sum % 2 !== 0,
      },
    };
  }

  if (RACING.has(gameCode)) {
    if (nums.length !== 10) return null;
    return {
      numbers: nums.slice(),
      sum,
      extras: {
        champion: nums[0],
        runner: nums[1],
        top2sum: nums[0]! + nums[1]!,
      },
    };
  }

  if (DIGIT5.has(gameCode)) {
    if (nums.length !== 5) return null;
    const wan = nums[0]!;
    const ge = nums[4]!;
    const lhh = wan > ge ? '龙' : wan < ge ? '虎' : '和';
    return {
      numbers: nums.slice(),
      sum,
      extras: {
        last: ge,
        isBig: sum >= 23,
        isOdd: sum % 2 !== 0,
        lhh,
        niu: niuValue(nums),
        shape前三: shapeOf(nums.slice(0, 3)),
        shape中三: shapeOf(nums.slice(1, 4)),
        shape后三: shapeOf(nums.slice(2, 5)),
      },
    };
  }

  return null;
}

function parseNumList(s: string): number[] {
  return String(s || '')
    .split(/[,，]/)
    .map((x) => parseInt(x, 10))
    .filter((n) => Number.isInteger(n) && n >= 1 && n <= 49);
}

function parseZodiacList(s: string): string[] {
  return [...String(s || '').matchAll(/[鼠牛虎兔龙蛇马羊猴鸡狗猪]/g)].map((m) => m[0]!);
}

/** 机器人口令 → 服务端 bet（覆盖 genRobotBet 产出；解析失败视为不中） */
export function parseRobotPlay(gameCode: string, play: string): LotteryBetPayload | null {
  const t = String(play || '').replace(/\s+/g, '');
  if (!t) return null;

  if (gameCode === 'lhc') {
    let m: RegExpMatchArray | null;
    if ((m = t.match(/^(?:特码|特)(大单|大双|小单|小双)$/))) {
      return { betType: 'combo', value: m[1] };
    }
    if ((m = t.match(/^(?:特码|特)(大|小|单|双)$/) || t.match(/^(大|小|单|双)$/))) {
      /* 裸「大/小」兼容旧氛围生成；统一按特码两面结 */
      return { betType: SIDE_MAP[m[1]!]!, value: undefined };
    }
    if ((m = t.match(/^(?:特码|特)(0?[1-9]|[1-4][0-9])$/))) {
      return { betType: 'special', value: String(+m[1]!) };
    }
    if ((m = t.match(/^(?:正码|正)(0?[1-9]|[1-4][0-9])$/))) {
      return { betType: 'zhengma', value: String(+m[1]!) };
    }
    if ((m = t.match(/^(红|蓝|绿)波$/))) {
      return { betType: 'color', value: m[1] };
    }
    if ((m = t.match(/^总和(大|小|单|双)$/) || t.match(/^总(大|小|单|双)$/))) {
      return { betType: 'sumSide', value: m[1] };
    }
    if ((m = t.match(/^(?:一肖|平特)([鼠牛虎兔龙蛇马羊猴鸡狗猪])$/) || t.match(/^([鼠牛虎兔龙蛇马羊猴鸡狗猪])$/))) {
      return { betType: 'pingZodiac', value: m[1] };
    }
    if ((m = t.match(/^(?:平特)?([0-9])尾$/))) {
      return { betType: 'weiShu', value: m[1] };
    }
    if ((m = t.match(/^(复式|拖头)?([二三四五])肖(中|不中)([鼠牛虎兔龙蛇马羊猴鸡狗猪,，、]+)$/))) {
      const n = CN_NUM[m[2]!];
      const zodiacs = [...new Set(parseZodiacList(m[4]!))];
      if (!n || zodiacs.length !== n) return null;
      return {
        betType: 'sxLian',
        value: JSON.stringify({ n, hit: m[3] === '中', zodiacs, mode: m[1] || '复式' }),
      };
    }
    if ((m = t.match(/^(复式|拖头)?(四全中|三中二|三全中|二全中|二中特|特串)([\d,，、拖]+)$/))) {
      const nums = [...new Set(parseNumList(m[3]!))];
      const need = m[2] === '四全中' ? 4 : m[2] === '三全中' || m[2] === '三中二' ? 3 : 2;
      const mode = m[1] || (String(m[3]).includes('拖') ? '拖头' : '复式');
      if (mode === '拖头') {
        /* 拖头：前 need-1 胆 × 其余托 → 展开后取第一注语义不稳，改为要求恰好 need 个并按复式结 */
        if (nums.length < need) return null;
      } else if (nums.length !== need) {
        return null;
      }
      return {
        betType: 'lianma',
        value: JSON.stringify({ play: m[2], nums: nums.slice(0, need), mode: '复式' }),
      };
    }
    return null;
  }

  if (gameCode === 'kuai3') {
    let m: RegExpMatchArray | null;
    if (/^[大小单双]$/.test(t)) return { betType: SIDE_MAP[t]! };
    if ((m = t.match(/^和(?:值)?([3-9]|1[0-8])$/))) return { betType: 'sum', value: m[1] };
    if ((m = t.match(/^三军([1-6])$/))) return { betType: 'dice', value: m[1] };
    if ((m = t.match(/^二同(?:号)?([1-6])$/))) return { betType: 'pair', value: m[1] };
    if ((m = t.match(/^三同(?:号)?([1-6])$/))) return { betType: 'tripletN', value: m[1] };
    if (t === '三同' || t === '三同号' || t === '豹子' || t === '豹') return { betType: 'triplet' };
    if ((m = t.match(/^三连([1-6]{3})$/))) return { betType: 'straight', value: m[1] };
    if (t === '三连' || t === '三连号' || t === '顺子') return { betType: 'straight', value: 'any' };
    if ((m = t.match(/^三不同(?:号)?([1-6]{3})$/))) return { betType: 'alldiff', value: m[1] };
    if (t === '三不同' || t === '三不同号' || t === '杂六') return { betType: 'alldiff' };
    if ((m = t.match(/^长牌([1-6])([1-6])$/)) && m[1] !== m[2]) {
      const a = Math.min(+m[1]!, +m[2]!);
      const b = Math.max(+m[1]!, +m[2]!);
      return { betType: 'long', value: `${a}:${b}` };
    }
    return null;
  }

  if (RACING.has(gameCode)) {
    let m: RegExpMatchArray | null;
    if ((m = t.match(/^冠亚(大|小|单|双)$/))) {
      const map: Record<string, string> = { 大: 'top2big', 小: 'top2small', 单: 'top2odd', 双: 'top2even' };
      return { betType: map[m[1]!]! };
    }
    if ((m = t.match(/^冠亚和([3-9]|1[0-9])$/))) return { betType: 'gySum', value: m[1] };
    if (t === '龙' || t === '虎') return { betType: 'lhh', value: `0:9:${t}` };
    if ((m = t.match(/^([1-5])(龙|虎)$/))) {
      const pairs: Array<[number, number]> = [[0, 9], [1, 8], [2, 7], [3, 6], [4, 5]];
      const pair = pairs[+m[1]! - 1];
      if (!pair) return null;
      return { betType: 'lhh', value: `${pair[0]}:${pair[1]}:${m[2]}` };
    }
    if ((m = t.match(/^([0-9])(大|小|单|双)$/))) {
      const track = m[1]!;
      const pos = track === '0' ? 9 : +track - 1;
      const side = SIDE_MAP[m[2]!];
      if (pos < 0 || pos > 9 || !side) return null;
      return { betType: 'posSide', value: `${pos}:${side}` };
    }
    if ((m = t.match(/^([0-9])\/([0-9])$/))) {
      const track = m[1]!;
      const carTok = m[2]!;
      const pos = track === '0' ? 9 : +track - 1;
      const car = carTok === '0' ? 10 : +carTok;
      if (pos < 0 || pos > 9 || car < 1 || car > 10) return null;
      return { betType: 'position', value: `${pos}:${car}` };
    }
    return null;
  }

  if (DIGIT5.has(gameCode)) {
    let m: RegExpMatchArray | null;
    if (/^[大小单双]$/.test(t)) return { betType: SIDE_MAP[t]! };
    if (t === '龙' || t === '虎' || t === '和') return { betType: 'lhh', value: `0:4:${t}` };
    if ((m = t.match(/^([1-5])(?:vs|v)([1-5])(龙|虎|和)$/i))) {
      const a = +m[1]! - 1;
      const b = +m[2]! - 1;
      if (a < 0 || b > 4 || a >= b) return null;
      return { betType: 'lhh', value: `${a}:${b}:${m[3]}` };
    }
    if (t === '无牛') return { betType: 'niu', value: -1 };
    if (t === '牛牛') return { betType: 'niu', value: 10 };
    if ((m = t.match(/^牛([1-9])$/))) return { betType: 'niu', value: +m[1]! };
    if ((m = t.match(/^牛(大|小|单|双)$/))) return { betType: 'niuSide', value: m[1] };
    if ((m = t.match(/^([万千百十个])(大|小|单|双)$/))) {
      const pos = DIGIT5_POS[m[1]!];
      const side = SIDE_MAP[m[2]!];
      if (pos == null || !side) return null;
      return { betType: 'ballSide', value: `${pos}:${side}` };
    }
    if ((m = t.match(/^([万千百十个])([0-9])$/))) {
      const pos = DIGIT5_POS[m[1]!];
      if (pos == null) return null;
      return { betType: 'position', value: `${pos}:${m[2]}` };
    }
    if ((m = t.match(/^(前三|中三|后三)(豹子|顺子|对子|半顺|杂六)$/))) {
      return { betType: 'shape', value: `${m[1]}:${m[2]}` };
    }
    return null;
  }

  return null;
}

export function settleRobotPlay(
  gameCode: string,
  play: string,
  amount: number,
  nums: number[],
  payTable?: LotteryPayTable | null,
): { winAmount: number; profit: number } {
  const amt = Number(amount) || 0;
  const bundle = gameBundle(gameCode, payTable);
  const draw = buildDrawFromNums(gameCode, nums);
  const bet = parseRobotPlay(gameCode, play);
  if (!bundle || !draw || !bet || amt <= 0) {
    return { winAmount: 0, profit: -amt };
  }
  const hitKey = bundle.game.judge(bet, draw, bundle.pay);
  if (!hitKey) return { winAmount: 0, profit: -amt };
  /* 与 lottery.service 一致：和局退本即使库内无 refund 条目也按 1 倍 */
  const mult =
    hitKey === 'refund'
      ? Number(bundle.pay[hitKey]?.multiplier) || 1
      : Number(bundle.pay[hitKey]?.multiplier) || 0;
  if (!(mult > 0)) return { winAmount: 0, profit: -amt };
  const winAmount = money2(amt * mult);
  return { winAmount, profit: money2(winAmount - amt) };
}

export function pickRobotWinnersByDraw(
  gameCode: string,
  nums: number[],
  robotBets: Array<{ name: string; plays: RoomChatPlayLine[] }>,
  payTable?: LotteryPayTable | null,
): Array<{ name: string; tags: Array<{ play: string; amount: number }>; winAmount: number; profit: number }> {
  const out: Array<{
    name: string;
    tags: Array<{ play: string; amount: number }>;
    winAmount: number;
    profit: number;
  }> = [];

  for (const b of robotBets) {
    const winTags: Array<{ play: string; amount: number }> = [];
    let winAmount = 0;
    let profit = 0;
    for (const p of b.plays || []) {
      const r = settleRobotPlay(gameCode, p.play, p.amount, nums, payTable);
      profit = money2(profit + r.profit);
      if (r.winAmount > 0) {
        winTags.push({ play: p.play, amount: p.amount });
        winAmount = money2(winAmount + r.winAmount);
      }
    }
    if (!winTags.length) continue;
    out.push({ name: b.name, tags: winTags, winAmount, profit });
  }

  out.sort((a, b) => b.profit - a.profit);
  return out.slice(0, 12);
}
