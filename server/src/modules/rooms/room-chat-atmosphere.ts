/**
 * 房间机器人氛围注 —— 口令与各游戏 H5 parsePlay / expand 对齐。
 * 规则：可复式、金额随意；同条消息不对冲（大/小、单/双等）；不追求每期撞车。
 * 按房/按游戏机器人数由代理页配置（后续挂载）；此处生成器只负责「像真人的合法口令」。
 */
import { createHash } from 'node:crypto';
import type { ChatLotteryGame, RoomChatPlayLine } from './room-chat.types';

/** 大池：同一房间内按游戏分区独占，避免跨游戏重名 */
const ROBOT_NAMES = [
  '星河漫步', '夜色温柔', '金币猎人', '风过无痕', '一叶知秋',
  '赤焰少年', '静水深流', '北岸灯火', '南巷清风', '云端漫步',
  '琥珀时光', '青石小径', '银杏落', '海盐汽水', '暮色列车',
  '半夏微凉', '柠檬气泡', '旧巷猫', '白日梦游', '落日飞车',
  '山风入怀', '竹影摇', '听雨楼', '晚星沉', '潮汐邮局',
  '软糖骑士', '灰蓝笔记', '梧桐雨', '枕上书', '雾里看花',
  '掌心暖', '南风知意', '青柠汽水', '码头灯塔', '碎金时光',
  '月下独酌', '热巧克', '纸飞机', '麦田守望', '蓝调夜行',
  '青竹马', '红袖添香', '孤岛电台', '雪顶咖啡', '琥珀猫',
  '南岛季风', '北城夜车', '西岸潮声', '东篱把酒', '云深不知',
  '疏影横斜', '暗香浮动', '清风徐来', '水波不兴', '长河落日',
  '大漠孤烟', '烟雨江南', '杏花微雨', '竹马青梅', '白驹过隙',
  '流光溢彩', '金风玉露', '碧落黄泉', '沧海月明', '蓝田日暖',
  '橘生淮南', '梅子青时', '桃花依旧', '柳暗花明', '春江花月',
  '秋水长天', '夏虫语冰', '冬日暖阳', '晨曦微露', '暮鼓晨钟',
  '霓裳羽衣', '锦瑟无端', '玉壶冰心', '铁马冰河', '金戈铁马',
  '银瓶乍破', '紫气东来', '青云直上', '黑白无常', '朱颜辞镜',
  '绿蚁新醅', '黄粱一梦', '玄鸟归巢', '赤兔追风', '白鹤亮翅',
  '灰狼队长', '橙汁派对', '薄荷凉风', '奶茶不加糖', '薯条勇士',
  '爆米花君', '焦糖玛奇', '芝士焗薯', '番茄炒蛋', '土豆队长',
  '豆浆油条', '煎饼果子', '关东煮王', '麻辣烫侠', '烧烤摊主',
  '夜市灯笼', '街角吉他', '屋顶花园', '阳台猫窝', '电梯奇遇',
  '地铁末班', '公交站牌', '共享单车', '快递小哥', '外卖骑士',
  '便利店夜', '书店角落', '咖啡拉花', '奶盖星星', '布丁先生',
  '慕斯小姐', '提拉米苏', '马卡龙蓝', '可颂清晨', '贝果周末',
  '三明治侠', '热狗大王', '寿司忍者', '拉面武士', '饺子团长',
  '包子司令', '馄饨使者', '汤圆圆圆', '粽子兄弟', '月饼团圆',
  '冰糖葫芦', '糖炒栗子', '烤地瓜香', '棉花糖云', '棒棒糖梦',
  '风筝线断', '陀螺旋转', '弹珠开战', '跳房子王', '捉迷藏鬼',
  '积木城堡', '拼图边缘', '折纸飞机', '橡皮筋鸟', '粉笔涂鸦',
  '黑板擦灰', '课桌抽屉', '操场夕阳', '图书馆静', '实验室白',
  '天文台远', '显微镜下', '望远镜外', '指南针偏', '沙漏慢流',
  '闹钟懒响', '日历撕页', '信封未拆', '邮票旅行', '墨水瓶蓝',
  '钢笔尖细', '铅笔屑落', '水彩晕开', '油画厚涂', '素描淡影',
  '相机快门', '胶卷岁月', '唱片转盘', '耳机线缠', '麦克风热',
  '舞台追光', '幕后黑手', '观众席末', '检票口前', '安检门响',
  '登机口迟', '跑道尽头', '云层之上', '海平面线', '地平线远',
  '北极光舞', '南十字星', '赤道暖流', '回归线热', '子午线准',
  '时差旅客', '候鸟迁徙', '鲸落深海', '萤火虫夏', '蝉鸣知了',
  '蛙声一片', '犬吠月圆', '猫步无声', '鸽哨悠扬', '马蹄得得',
];

/** 与开通游戏列表对齐，用于房间内名字分区（顺序固定） */
const GAME_PARTITION_ORDER = [
  'ffc', 'ssc', 'kuai3', 'bjsc', 'speed-racing', 'speed-boat',
  'lhc', 'baccarat', 'dragon-tiger', 'douniu', 'zhajinhua',
  'bcbm', 'fruit-machine',
];
const NAMES_PER_GAME = 40;

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

/**
 * 同一房间内：各游戏从大池切互不重叠的名字段；头像种子含 gameCode，跨游戏必不同。
 */
export function robotRoster(roomId: string, gameCode: string, count = 14) {
  const n = Math.min(50, Math.max(0, Math.floor(count) || 0));
  if (n <= 0) return [];

  // 房间级洗牌，保证不同房间名字段不同，但同房跨游戏不重叠
  const shuffleRnd = mulberry32(hashSeed(`${roomId}:name-partition:v3`));
  const shuffled = ROBOT_NAMES.slice();
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(shuffleRnd() * (i + 1));
    const tmp = shuffled[i]!;
    shuffled[i] = shuffled[j]!;
    shuffled[j] = tmp;
  }

  let gIdx = GAME_PARTITION_ORDER.indexOf(gameCode);
  if (gIdx < 0) {
    gIdx = hashSeed(`game-part:${gameCode}`) % Math.max(1, Math.floor(shuffled.length / NAMES_PER_GAME));
  }
  const start = (gIdx * NAMES_PER_GAME) % shuffled.length;
  let slice = shuffled.slice(start, start + NAMES_PER_GAME);
  if (slice.length < NAMES_PER_GAME) {
    slice = slice.concat(shuffled.slice(0, NAMES_PER_GAME - slice.length));
  }

  const pickRnd = mulberry32(hashSeed(`${roomId}:${gameCode}:roster:v3`));
  const pool = slice.slice();
  const out: Array<{ name: string; avatar: string }> = [];
  while (out.length < n && pool.length) {
    const i = Math.floor(pickRnd() * pool.length);
    const name = pool.splice(i, 1)[0]!;
    const av = 1 + (hashSeed(`${roomId}:${gameCode}:${name}:avatar:v3`) % 162);
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
/* ===================== 时时彩 ===================== */
const DIGIT5_POS = ['万', '千', '百', '十', '个'] as const;

/* ===================== 六合：无一肖特码项；总肖=一肖 ===================== */
const ZODIAC = ['鼠', '牛', '虎', '兔', '龙', '蛇', '马', '羊', '猴', '鸡', '狗', '猪'] as const;

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

/** 金额：30～2000 内随机档位（气氛用） */
const ROBOT_AMTS = [
  30, 50, 80, 100, 120, 150, 180, 200, 250, 300, 380, 500,
  600, 800, 1000, 1200, 1500, 1800, 2000,
] as const;

/** 上分口令金额（偏中大额，更像补分） */
const FUND_UP_AMTS = [500, 800, 1000, 1500, 2000, 3000, 5000] as const;
/** 下分口令金额（偏中小额） */
const FUND_DOWN_AMTS = [300, 500, 800, 1000, 1500, 2000] as const;

export type RobotBetOpts = {
  avoidNames?: string[];
  robotCount?: number;
};

/** 基础玩法（可搭配多注，同条不对冲） */
function genBasicPlay(gameCode: ChatLotteryGame, rnd: () => number): string {
  if (gameCode === 'lhc') {
    const roll = rnd();
    if (roll < 0.45) return '特码' + pick(rnd, SIDE);
    if (roll < 0.7) return pick(rnd, ['总和大', '总和小', '总和单', '总和双'] as const);
    if (roll < 0.88) return pick(rnd, ['红波', '蓝波', '绿波'] as const);
    return '一肖' + pick(rnd, ZODIAC);
  }
  if (gameCode === 'bjsc' || gameCode === 'speed-racing' || gameCode === 'speed-boat') {
    const roll = rnd();
    if (roll < 0.4) return '冠亚' + pick(rnd, SIDE);
    if (roll < 0.75) return raceTrack(pickInt(rnd, 0, 9)) + pick(rnd, SIDE);
    return pick(rnd, ['龙', '虎'] as const);
  }
  if (gameCode === 'kuai3') {
    if (rnd() < 0.8) return pick(rnd, SIDE);
    return '和' + String(pickInt(rnd, 4, 17));
  }
  /* 时时彩：两面 / 定位两面 / 龙虎和 */
  const roll = rnd();
  if (roll < 0.5) return pick(rnd, SIDE);
  if (roll < 0.8) return pick(rnd, DIGIT5_POS) + pick(rnd, SIDE);
  return pick(rnd, ['龙', '虎', '和'] as const);
}

/**
 * 机器人氛围注：基础玩法，可 1～3 注搭配；金额 30～2000。
 */
export function genRobotBet(
  roomId: string,
  gameCode: ChatLotteryGame,
  issueNo: string,
  tickKey: string,
  opts?: RobotBetOpts,
): { name: string; avatar: string; text: string; plays: RoomChatPlayLine[]; totalAmount: number } {
  const roster = robotRoster(roomId, gameCode, opts?.robotCount ?? 14);
  const rnd = mulberry32(hashSeed(`${roomId}:${gameCode}:${issueNo}:${tickKey}`));
  const avoid = new Set((opts?.avoidNames || []).map((n) => String(n || '').trim()).filter(Boolean));
  const candidates = roster.filter((r) => !avoid.has(r.name));
  const pool = candidates.length ? candidates : roster;
  const who = pool[Math.floor(rnd() * pool.length)]!;

  /* 约 55% 单注，35% 两注，10% 三注 */
  const n = rnd() < 0.55 ? 1 : rnd() < 0.9 ? 2 : 3;
  const plays: RoomChatPlayLine[] = [];
  const used = new Set<string>();

  for (let i = 0; i < n; i++) {
    let guard = 0;
    let chunk: RoomChatPlayLine[] = [];
    while (guard++ < 14) {
      const raw = genBasicPlay(gameCode, rnd);
      const amt = pick(rnd, ROBOT_AMTS);
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
    plays.push({ play: pick(rnd, SIDE), amount: pick(rnd, ROBOT_AMTS) });
  }

  const text = plays.map((p) => `${p.play}/${p.amount}`).join(' ');
  const totalAmount = plays.reduce((s, p) => s + p.amount, 0);
  return { name: who.name, avatar: who.avatar, text, plays, totalAmount };
}

/**
 * 上下分闲聊：上分为主（约 75%），金额固定档；只刷口令不动账。
 */
export function genRobotFundTalk(
  roomId: string,
  gameCode: string,
  tickKey: string,
  opts?: { avoidNames?: string[]; robotCount?: number },
): { name: string; avatar: string; text: string; fundType: 'up' | 'down' } | null {
  const roster = robotRoster(roomId, gameCode, opts?.robotCount ?? 14);
  if (!roster.length) return null;
  const rnd = mulberry32(hashSeed(`${roomId}:${gameCode}:fund:${tickKey}`));
  const avoid = new Set((opts?.avoidNames || []).map((n) => String(n || '').trim()).filter(Boolean));
  const candidates = roster.filter((r) => !avoid.has(r.name));
  const pool = candidates.length ? candidates : roster;
  const who = pool[Math.floor(rnd() * pool.length)]!;

  const fundType: 'up' | 'down' = rnd() < 0.75 ? 'up' : 'down';
  const amt = pick(rnd, fundType === 'up' ? FUND_UP_AMTS : FUND_DOWN_AMTS);
  const roll = rnd();
  let text: string;
  if (fundType === 'up') {
    if (roll < 0.55) text = `上分${amt}`;
    else if (roll < 0.8) text = `上分/${amt}`;
    else text = `上分 ${amt}`;
  } else if (roll < 0.6) {
    text = `下分${amt}`;
  } else if (roll < 0.85) {
    text = `下分/${amt}`;
  } else {
    text = `下分 ${amt}`;
  }
  return { name: who.name, avatar: who.avatar, text, fundType };
}

/* 中奖核对请用 room-chat-robot-settle.pickRobotWinnersByDraw（真实开奖+赔率，钱不入账） */
