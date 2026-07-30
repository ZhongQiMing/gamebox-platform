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
  '半夏微凉', '柠檬气泡', '旧巷猫', '白日梦游', '落日飞车',
  '山风入怀', '竹影摇', '听雨楼', '晚星沉', '潮汐邮局',
  '软糖骑士', '灰蓝笔记', '梧桐雨', '枕上书', '雾里看花',
  '掌心暖', '南风知意', '青柠汽水', '码头灯塔', '碎金时光',
  '月下独酌', '热巧克', '纸飞机', '麦田守望', '蓝调夜行',
];

/** 金额池加宽，少用整齐整数，更像真人随手输 */
const AMTS = [
  10, 15, 20, 25, 30, 38, 50, 58, 66, 80, 88, 100,
  120, 128, 150, 168, 188, 200, 258, 300, 388, 500, 666,
] as const;
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

export function robotRoster(roomId: string, gameCode: string, count = 14) {
  const rnd = mulberry32(hashSeed(`${roomId}:${gameCode}:roster:v2`));
  const pool = ROBOT_NAMES.slice();
  const out: Array<{ name: string; avatar: string }> = [];
  while (out.length < count && pool.length) {
    const i = Math.floor(rnd() * pool.length);
    const name = pool.splice(i, 1)[0]!;
    const av = 1 + (hashSeed(`${roomId}:${name}:avatar`) % 162);
    const ext = av === 22 || av === 78 || av === 86 ? 'png' : 'jpg';
    out.push({
      name,
      avatar: `/images/avatars/${String(av).padStart(3, '0')}.${ext}`,
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

/** 返回整段 chat 口令（可含复式），外层再挂金额。权重偏向真人常玩的基础盘。 */
function playRacing(rnd: () => number): string {
  const roll = rnd();
  const track = raceTrack(pickInt(rnd, 0, 9));
  /* ~72% 基础：冠亚两面 / 单名次两面 / 龙虎 */
  if (roll < 0.28) return '冠亚' + pick(rnd, SIDE);
  if (roll < 0.52) return track + pick(rnd, SIDE);
  if (roll < 0.64) return pick(rnd, ['龙', '虎'] as const);
  if (roll < 0.72) return String(pickInt(rnd, 1, 5)) + pick(rnd, ['龙', '虎'] as const);
  /* ~18% 轻复式两面 / 简单定位 */
  if (roll < 0.82) {
    const n = pickInt(rnd, 2, 3);
    const tracks = pickUnique(rnd, [0, 1, 2, 3, 4, 5, 6, 7, 8, 9], n).map(raceTrack).join('');
    return tracks + pick(rnd, SIDE);
  }
  if (roll < 0.9) return `${track}/${raceCar(pickInt(rnd, 1, 10))}`;
  /* ~10% 冠亚和（单点，少复选） */
  return '冠亚和' + String(pickInt(rnd, 3, 19));
}

/* ===================== 时时彩 ===================== */
const DIGIT5_POS = ['万', '千', '百', '十', '个'] as const;
/** 斗牛基础项（人多）；细牛几极少出 */
const DIGIT5_NIU_BASIC = ['无牛', '牛牛', '牛大', '牛小', '牛单', '牛双'] as const;
const DIGIT5_SHAPES = [
  '前三豹子', '中三顺子', '后三对子', '前三半顺', '后三杂六', '中三对子', '前三顺子',
] as const;

function playDigit5(rnd: () => number): string {
  const roll = rnd();
  /* ~78% 基础：总和两面 / 定位两面 / 龙虎和 / 简单定位胆 */
  if (roll < 0.34) return pick(rnd, SIDE);
  if (roll < 0.58) {
    /* 单位两面：万大、个单（少复式） */
    const pos = pick(rnd, DIGIT5_POS);
    return pos + pick(rnd, SIDE);
  }
  if (roll < 0.7) return pick(rnd, ['龙', '虎', '和'] as const);
  if (roll < 0.78) {
    /* 定位胆：万5 */
    const pos = pick(rnd, DIGIT5_POS);
    return pos + String(pickInt(rnd, 0, 9));
  }
  /* ~14% 次常玩：斗牛基础 / 双位两面 */
  if (roll < 0.86) return pick(rnd, DIGIT5_NIU_BASIC);
  if (roll < 0.92) {
    const pos = pickUnique(rnd, DIGIT5_POS, 2).join('');
    return pos + pick(rnd, SIDE);
  }
  /* ~8% 偏门：形态 / 组三 / 不定位 */
  if (roll < 0.96) return pick(rnd, DIGIT5_SHAPES);
  if (roll < 0.98) {
    const seg = pick(rnd, ['前三', '中三', '后三'] as const);
    let d1 = pickInt(rnd, 0, 9);
    let d2 = pickInt(rnd, 0, 9);
    while (d2 === d1) d2 = pickInt(rnd, 0, 9);
    return `${seg}组三${d1}${d2}`;
  }
  const seg = pick(rnd, ['前三', '中三', '后三'] as const);
  const digits = pickUnique(rnd, [0, 1, 2, 3, 4, 5, 6, 7, 8, 9], pickInt(rnd, 1, 2)).join('');
  return seg + digits;
}

/* ===================== 快三 ===================== */
function playKuai3(rnd: () => number): string {
  const roll = rnd();
  /* ~75% 基础：大小单双 / 和值单点 */
  if (roll < 0.4) return pick(rnd, SIDE);
  if (roll < 0.75) return '和' + String(pickInt(rnd, 4, 17));
  /* ~15% 次常玩：三军 / 和值两点 */
  if (roll < 0.85) {
    const digits = pickUnique(rnd, [1, 2, 3, 4, 5, 6], pickInt(rnd, 1, 2)).join('');
    return '三军' + digits;
  }
  if (roll < 0.9) {
    const sums = pickUnique(rnd, Array.from({ length: 14 }, (_, i) => i + 4), 2);
    return '和' + sums.join('/');
  }
  /* ~10% 偏门 */
  if (roll < 0.95) {
    const digits = pickUnique(rnd, [1, 2, 3, 4, 5, 6], 1).join('');
    return '二同' + digits;
  }
  return pick(rnd, ['三同号', '三连号', '三不同号'] as const);
}

/* ===================== 六合：无一肖特码项；总肖=一肖 ===================== */
const ZODIAC = ['鼠', '牛', '虎', '兔', '龙', '蛇', '马', '羊', '猴', '鸡', '狗', '猪'] as const;
const LHC_COMBO = ['大单', '大双', '小单', '小双'] as const;
const LHC_WAVE = ['红波', '蓝波', '绿波'] as const;
const LHC_SUM = ['总和大', '总和小', '总和单', '总和双'] as const;
const CN_LIAN: Record<number, string> = { 2: '二', 3: '三', 4: '四', 5: '五' };

function playLhc(rnd: () => number): string {
  const roll = rnd();
  /* ~80% 基础：特码两面 / 特码组合 / 特码号 / 正码 / 波色 / 总和 */
  if (roll < 0.28) return '特码' + pick(rnd, SIDE);
  if (roll < 0.4) return '特码' + pick(rnd, LHC_COMBO);
  if (roll < 0.55) {
    const no = String(pickInt(rnd, 1, 49)).padStart(2, '0');
    return rnd() < 0.7 ? `特码${no}` : `正码${no}`;
  }
  if (roll < 0.65) return pick(rnd, LHC_WAVE);
  if (roll < 0.72) return pick(rnd, LHC_SUM);
  if (roll < 0.8) return '一肖' + pick(rnd, ZODIAC);
  /* ~12% 次常玩：尾数 / 少量一肖 */
  if (roll < 0.88) return String(pickInt(rnd, 0, 9)) + '尾';
  if (roll < 0.92) {
    const zs = pickUnique(rnd, ZODIAC, 2);
    return zs.map((z) => '一肖' + z).join(' ');
  }
  /* ~8% 偏门连码 */
  if (roll < 0.96) {
    const n = pick(rnd, [2, 2, 3] as const);
    const hit = rnd() < 0.75 ? '中' : '不中';
    const zs = pickUnique(rnd, ZODIAC, n);
    return `复式${CN_LIAN[n]}肖${hit}${zs.join(',')}`;
  }
  const play = pick(rnd, ['二全中', '二中特', '特串'] as const);
  const pool = Array.from({ length: 49 }, (_, i) => String(i + 1).padStart(2, '0'));
  const nums = pickUnique(rnd, pool, 2 + pickInt(rnd, 0, 1));
  return `拖头${play}${nums.join(',')}`;
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
  opts?: { avoidNames?: string[] },
): { name: string; avatar: string; text: string; plays: RoomChatPlayLine[]; totalAmount: number } {
  const roster = robotRoster(roomId, gameCode);
  const rnd = mulberry32(hashSeed(`${roomId}:${gameCode}:${issueNo}:${tickKey}`));
  const avoid = new Set((opts?.avoidNames || []).map((n) => String(n || '').trim()).filter(Boolean));
  const candidates = roster.filter((r) => !avoid.has(r.name));
  const pool = candidates.length ? candidates : roster;
  const who = pool[Math.floor(rnd() * pool.length)]!;
  /* 多数一注基础玩法；少复式多注 */
  const n = rnd() < 0.72 ? 1 : rnd() < 0.92 ? 2 : 3;
  const plays: RoomChatPlayLine[] = [];
  const used = new Set<string>();

  for (let i = 0; i < n; i++) {
    let guard = 0;
    let chunk: RoomChatPlayLine[] = [];
    while (guard++ < 14) {
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
    const winAmount = use.reduce((s, p) => s + Math.round(p.amount * (1.8 + rnd() * 1.2) * 100) / 100, 0);
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
