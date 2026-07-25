/**
 * 房间机器人氛围注 —— 口令与各游戏 H5 parsePlay / expand 对齐。
 * 规则：可复式、金额随意；同条消息不对冲（大/小、单/双等）；不追求每期撞车。
 * 按房/按游戏机器人数由代理页配置（后续挂载）；此处生成器只负责「像真人的合法口令」。
 */
import { createHash } from 'node:crypto';
import type { ChatLotteryGame, RoomChatPlayLine } from './room-chat.types';

const ROBOT_NAMES = [
  '星河漫步', '夜色温柔', '金币猎人', '风过无痕', '一叶知秋',
  '赤焰少年', '静水深流', '北岸灯火', '南巷清风', '云端漫步',
  '琥珀时光', '青石小径', '银杏落', '海盐汽水', '暮色列车',
];

const AMTS = [20, 30, 50, 80, 100, 150, 200, 300, 500] as const;
const SIDE = ['大', '小', '单', '双'] as const;

function hashSeed(s: string): number {
  return createHash('sha256').update(s).digest().readUInt32BE(0);
}

function mulberry32(a: number) {
  return function () {
    let t = (a += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pick<T>(rnd: () => number, arr: readonly T[]): T {
  return arr[Math.floor(rnd() * arr.length)]!;
}

function pickInt(rnd: () => number, min: number, max: number): number {
  return min + Math.floor(rnd() * (max - min + 1));
}

function pickUnique<T>(rnd: () => number, pool: readonly T[], n: number): T[] {
  const arr = pool.slice();
  const out: T[] = [];
  while (out.length < n && arr.length) {
    const i = Math.floor(rnd() * arr.length);
    out.push(arr.splice(i, 1)[0]!);
  }
  return out;
}

/** 同条消息内对立面（机器人禁；真人不禁） */
const HEDGE_PAIRS: Array<[string, string]> = [
  ['大', '小'],
  ['单', '双'],
  ['龙', '虎'],
];

function sideToken(play: string): string | null {
  const t = play.replace(/\s+/g, '');
  if (/大$/.test(t) && !/大单|大双/.test(t)) return '大';
  if (/小$/.test(t) && !/小单|小双/.test(t)) return '小';
  if (/单$/.test(t) && !/大单|小单/.test(t)) return '单';
  if (/双$/.test(t) && !/大双|小双/.test(t)) return '双';
  if (t === '龙' || /(?:^|[0-9])龙$/.test(t)) return '龙';
  if (t === '虎' || /(?:^|[0-9])虎$/.test(t)) return '虎';
  return null;
}

function hedgesWith(a: string, b: string): boolean {
  const ta = sideToken(a);
  const tb = sideToken(b);
  if (!ta || !tb) return false;
  return HEDGE_PAIRS.some(([x, y]) => (ta === x && tb === y) || (ta === y && tb === x));
}

export function robotRoster(roomId: string, gameCode: string, count = 10) {
  const rnd = mulberry32(hashSeed(`${roomId}:${gameCode}:roster`));
  const pool = ROBOT_NAMES.slice();
  const out: Array<{ name: string; avatar: string }> = [];
  while (out.length < count && pool.length) {
    const i = Math.floor(rnd() * pool.length);
    const name = pool.splice(i, 1)[0]!;
    out.push({
      name,
      avatar: `/images/avatars/${String((out.length % 20) + 1).padStart(3, '0')}.jpg`,
    });
  }
  return out;
}

/* ===================== 赛车：仅赛道数字，无定、无名次中文 ===================== */
function raceTrack(pos0: number): string {
  return pos0 === 9 ? '0' : String(pos0 + 1);
}
function raceCar(n: number): string {
  return n === 10 ? '0' : String(n);
}

/** 返回整段 chat 口令（可含复式），外层再挂金额 */
function playRacing(rnd: () => number): string {
  const roll = rnd();
  const track = raceTrack(pickInt(rnd, 0, 9));
  if (roll < 0.2) {
    /* 复式名次两面：123单 */
    const n = pickInt(rnd, 2, 5);
    const tracks = pickUnique(rnd, [0, 1, 2, 3, 4, 5, 6, 7, 8, 9], n).map(raceTrack).join('');
    return tracks + pick(rnd, SIDE);
  }
  if (roll < 0.38) return track + pick(rnd, SIDE);
  if (roll < 0.5) return '冠亚' + pick(rnd, SIDE);
  if (roll < 0.62) {
    /* 冠亚和多选 */
    const k = pickInt(rnd, 2, 4);
    const sums = pickUnique(rnd, Array.from({ length: 17 }, (_, i) => i + 3), k);
    const sep = rnd() < 0.5 ? '/' : ' ';
    return '冠亚和' + sums.join(sep);
  }
  if (roll < 0.74) return String(pickInt(rnd, 1, 5)) + pick(rnd, ['龙', '虎'] as const);
  if (roll < 0.86) {
    /* 定位统一赛道/车号：1/5 或 1/35（一道多号），禁止旧「定」与裸号码 */
    if (rnd() < 0.55) return `${track}/${raceCar(pickInt(rnd, 1, 10))}`;
    const cars = pickUnique(rnd, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10], pickInt(rnd, 2, 4)).map(raceCar).join('');
    return `${track}/${cars}`;
  }
  return pick(rnd, ['龙', '虎'] as const);
}

/* ===================== 时时彩 ===================== */
const DIGIT5_POS = ['万', '千', '百', '十', '个'] as const;
const DIGIT5_NIU = [
  '无牛', '牛1', '牛2', '牛3', '牛4', '牛5', '牛6', '牛7', '牛8', '牛9', '牛牛',
  '牛大', '牛小', '牛单', '牛双',
] as const;
const DIGIT5_SHAPES = [
  '前三豹子', '中三顺子', '后三对子', '前三半顺', '后三杂六', '中三对子', '前三顺子',
] as const;

function playDigit5(rnd: () => number): string {
  const roll = rnd();
  if (roll < 0.18) return pick(rnd, SIDE);
  if (roll < 0.34) {
    /* 万千单 */
    const n = pickInt(rnd, 1, 3);
    const pos = pickUnique(rnd, DIGIT5_POS, n).join('');
    return pos + pick(rnd, SIDE);
  }
  if (roll < 0.48) {
    /* 万千135 */
    const n = pickInt(rnd, 1, 2);
    const pos = pickUnique(rnd, DIGIT5_POS, n).join('');
    const digits = pickUnique(rnd, [0, 1, 2, 3, 4, 5, 6, 7, 8, 9], pickInt(rnd, 1, 3)).join('');
    return pos + digits;
  }
  if (roll < 0.58) return pick(rnd, ['龙', '虎', '和'] as const);
  if (roll < 0.7) return pick(rnd, DIGIT5_NIU);
  if (roll < 0.8) return pick(rnd, DIGIT5_SHAPES);
  if (roll < 0.9) {
    const seg = pick(rnd, ['前三', '中三', '后三'] as const);
    let d1 = pickInt(rnd, 0, 9);
    let d2 = pickInt(rnd, 0, 9);
    while (d2 === d1) d2 = pickInt(rnd, 0, 9);
    return `${seg}组三${d1}${d2}`;
  }
  /* 不定位复式：前三012 */
  const seg = pick(rnd, ['前三', '中三', '后三'] as const);
  const digits = pickUnique(rnd, [0, 1, 2, 3, 4, 5, 6, 7, 8, 9], pickInt(rnd, 2, 4)).join('');
  return seg + digits;
}

/* ===================== 快三 ===================== */
function playKuai3(rnd: () => number): string {
  const roll = rnd();
  if (roll < 0.2) return pick(rnd, SIDE);
  if (roll < 0.4) {
    /* 和4/7/10 或 和4 7 10 */
    const k = pickInt(rnd, 1, 4);
    const sums = pickUnique(rnd, Array.from({ length: 14 }, (_, i) => i + 4), k);
    const sep = rnd() < 0.5 ? '/' : ' ';
    return '和' + sums.join(sep);
  }
  if (roll < 0.55) {
    const digits = pickUnique(rnd, [1, 2, 3, 4, 5, 6], pickInt(rnd, 1, 3)).join('');
    return '三军' + digits;
  }
  if (roll < 0.68) {
    const digits = pickUnique(rnd, [1, 2, 3, 4, 5, 6], pickInt(rnd, 1, 3)).join('');
    return '二同' + digits;
  }
  if (roll < 0.78) {
    const digits = pickUnique(rnd, [1, 2, 3, 4, 5, 6], pickInt(rnd, 1, 2)).join('');
    return rnd() < 0.5 ? '三同' + digits : '三同号';
  }
  if (roll < 0.88) {
    const digits = pickUnique(rnd, [1, 2, 3, 4, 5, 6], pickInt(rnd, 2, 4)).sort((a, b) => a - b).join('');
    return '长牌' + digits;
  }
  return pick(rnd, ['三连号', '三不同号'] as const);
}

/* ===================== 六合：无一肖特码项；总肖=一肖 ===================== */
const ZODIAC = ['鼠', '牛', '虎', '兔', '龙', '蛇', '马', '羊', '猴', '鸡', '狗', '猪'] as const;
const LHC_COMBO = ['大单', '大双', '小单', '小双'] as const;
const LHC_WAVE = ['红波', '蓝波', '绿波'] as const;
const LHC_SUM = ['总和大', '总和小', '总和单', '总和双'] as const;
const CN_LIAN: Record<number, string> = { 2: '二', 3: '三', 4: '四', 5: '五' };

function playLhc(rnd: () => number): string {
  const roll = rnd();
  /* 裸大 = 特码两面（聊天 expand）；机器人直接出标准口令 */
  if (roll < 0.16) return '特码' + pick(rnd, SIDE);
  if (roll < 0.26) return '特码' + pick(rnd, LHC_COMBO);
  if (roll < 0.4) {
    const no = String(pickInt(rnd, 1, 49)).padStart(2, '0');
    return rnd() < 0.65 ? `特码${no}` : `正码${no}`;
  }
  if (roll < 0.5) {
    /* 总肖项：一肖X（可多选胶连由外层金额挂；这里出一肖鼠 或 多肖展开成多注在 gen 层） */
    const zs = pickUnique(rnd, ZODIAC, pickInt(rnd, 1, 3));
    return zs.map((z) => '一肖' + z).join(' ');
  }
  if (roll < 0.58) {
    /* 总数项：N尾 */
    const tails = pickUnique(rnd, [0, 1, 2, 3, 4, 5, 6, 7, 8, 9], pickInt(rnd, 1, 3));
    return tails.map((t) => t + '尾').join(' ');
  }
  if (roll < 0.66) return pick(rnd, LHC_WAVE);
  if (roll < 0.74) {
    const n = pick(rnd, [2, 2, 3, 3, 4] as const);
    const hit = rnd() < 0.8 ? '中' : '不中';
    const zs = pickUnique(rnd, ZODIAC, n + (rnd() < 0.4 ? 1 : 0));
    while (zs.length < n) zs.push(pick(rnd, ZODIAC));
    return `复式${CN_LIAN[n]}肖${hit}${zs.slice(0, Math.max(n, zs.length)).join(',')}`;
  }
  if (roll < 0.82) {
    const n = pick(rnd, [2, 2, 3, 4] as const);
    const hit = rnd() < 0.8 ? '中' : '不中';
    const tails = pickUnique(rnd, [0, 1, 2, 3, 4, 5, 6, 7, 8, 9], Math.max(n, n + (rnd() < 0.35 ? 1 : 0)));
    return `复式${CN_LIAN[n]}尾${hit}${tails.map((t) => t + '尾').join(',')}`;
  }
  if (roll < 0.9) {
    /* 拖头连码 */
    const play = pick(rnd, ['二全中', '二全中', '二中特', '特串', '三中二'] as const);
    const need = play === '三中二' ? 3 : 2;
    const pool = Array.from({ length: 49 }, (_, i) => String(i + 1).padStart(2, '0'));
    const nums = pickUnique(rnd, pool, need + pickInt(rnd, 1, 3));
    return `拖头${play}${nums.join(',')}`;
  }
  if (roll < 0.95) {
    /* 拖头生肖连 */
    const n = pick(rnd, [2, 3] as const);
    const zs = pickUnique(rnd, ZODIAC, n + pickInt(rnd, 1, 2));
    return `拖头${CN_LIAN[n]}肖中${zs.join(',')}`;
  }
  return pick(rnd, LHC_SUM);
}

function genOnePlay(gameCode: ChatLotteryGame, rnd: () => number): string {
  if (gameCode === 'kuai3') return playKuai3(rnd);
  if (gameCode === 'lhc') return playLhc(rnd);
  if (gameCode === 'bjsc' || gameCode === 'speed-racing' || gameCode === 'speed-boat') {
    return playRacing(rnd);
  }
  return playDigit5(rnd);
}

/**
 * 将生成器产出拆成 plays[]。
 * - 多数为单段玩法
 * - 六合「一肖鼠 一肖牛」空格多玩法 → 同金额拆多注
 * - 快三/赛车复式段本身带 / 或空格数字，整段作为一条 play（H5 expand 再拆）
 */
function toPlayLines(raw: string, amount: number): RoomChatPlayLine[] {
  const t = String(raw || '').trim();
  if (!t) return [];
  /* 六合：仅当全部是「一肖X / N尾 / 特码..」这类空格多注时拆开 */
  if (/^(?:一肖[鼠牛虎兔龙蛇马羊猴鸡狗猪]|[0-9]尾)(?:\s+(?:一肖[鼠牛虎兔龙蛇马羊猴鸡狗猪]|[0-9]尾))+$/.test(t)) {
    return t.split(/\s+/).map((play) => ({ play, amount }));
  }
  return [{ play: t, amount }];
}

export function genRobotBet(
  roomId: string,
  gameCode: ChatLotteryGame,
  issueNo: string,
  tickKey: string,
): { name: string; avatar: string; text: string; plays: RoomChatPlayLine[]; totalAmount: number } {
  const roster = robotRoster(roomId, gameCode);
  const rnd = mulberry32(hashSeed(`${roomId}:${gameCode}:${issueNo}:${tickKey}`));
  const who = roster[Math.floor(rnd() * roster.length)]!;
  const n = rnd() < 0.45 ? 2 : 1;
  const plays: RoomChatPlayLine[] = [];
  const used = new Set<string>();

  for (let i = 0; i < n; i++) {
    let guard = 0;
    let chunk: RoomChatPlayLine[] = [];
    while (guard++ < 12) {
      const raw = genOnePlay(gameCode, rnd);
      const amt = pick(rnd, AMTS);
      chunk = toPlayLines(raw, amt);
      if (!chunk.length) continue;
      const clash = chunk.some((c) => plays.some((p) => hedgesWith(p.play, c.play) || used.has(c.play)));
      if (clash) continue;
      break;
    }
    for (const c of chunk) {
      used.add(c.play);
      plays.push(c);
    }
  }
  if (!plays.length) {
    plays.push({ play: pick(rnd, SIDE), amount: pick(rnd, AMTS) });
  }

  /* 文本：赛车/快三复式保持「玩法/金额」一条；已拆多注则空格连接 */
  const text = plays.map((p) => `${p.play}/${p.amount}`).join(' ');
  const totalAmount = plays.reduce((s, p) => s + p.amount, 0);
  return { name: who.name, avatar: who.avatar, text, plays, totalAmount };
}

export function pickRobotWinners(
  roomId: string,
  gameCode: string,
  issueNo: string,
  robotBets: Array<{ name: string; plays: RoomChatPlayLine[] }>,
): Array<{ name: string; tags: Array<{ play: string; amount: number }>; winAmount: number; profit: number }> {
  const rnd = mulberry32(hashSeed(`${roomId}:${gameCode}:${issueNo}:win`));
  const out: Array<{
    name: string;
    tags: Array<{ play: string; amount: number }>;
    winAmount: number;
    profit: number;
  }> = [];
  for (const b of robotBets) {
    if (rnd() > 0.42) continue;
    const tags = b.plays.filter(() => rnd() > 0.35);
    const use = tags.length ? tags : b.plays.slice(0, 1);
    const winAmount = use.reduce((s, p) => s + Math.floor(p.amount * (1.8 + rnd() * 1.2)), 0);
    const stake = use.reduce((s, p) => s + p.amount, 0);
    out.push({
      name: b.name,
      tags: use.map((p) => ({ play: p.play, amount: p.amount })),
      winAmount,
      profit: winAmount - stake,
    });
  }
  out.sort((a, b) => b.profit - a.profit);
  return out.slice(0, 8);
}
