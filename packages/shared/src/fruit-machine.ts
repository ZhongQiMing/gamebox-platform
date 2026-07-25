/**
 * 经典水果机（玛丽机）权威盘面与赔率。
 * 前后端必须同源引用，禁止各自改一份。
 */

export const FRUIT_BET_SYMBOLS = [
  { id: 'bar', label: '天门', bigMult: 100, smallMult: 50 },
  { id: 'seven', label: '77', bigMult: 40, smallMult: 2 },
  { id: 'star', label: '双星', bigMult: 30, smallMult: 2 },
  { id: 'melon', label: '西瓜', bigMult: 20, smallMult: 2 },
  { id: 'bell', label: '铃铛', bigMult: 20, smallMult: 2 },
  { id: 'lemon', label: '芒果', bigMult: 15, smallMult: 2 },
  { id: 'orange', label: '橘子', bigMult: 10, smallMult: 2 },
  { id: 'apple', label: '苹果', bigMult: 5, smallMult: 2 },
] as const;

export type FruitBetSymbolId = (typeof FRUIT_BET_SYMBOLS)[number]['id'];

export type FruitCellKind =
  | `${FruitBetSymbolId}_big`
  | `${FruitBetSymbolId}_small`
  | 'luck';

export interface FruitRingCell {
  kind: FruitCellKind;
  /** 押注仓位；luck 为 null */
  symbol: FruitBetSymbolId | null;
  size: 'big' | 'small' | 'luck';
  /** 落地倍率；luck 为 0 */
  mult: number;
  /** 跑灯停点权重（越大越容易停） */
  weight: number;
  /** 盘面展示名 */
  label: string;
}

/**
 * 经典小玛丽 24 格（顺时针，从左上角起）
 * 「大」格带 X倍率角标（玩法翻倍/赔率）；普通小格为 X2；小天门 X50；大天门 X100
 * 上7：橘子X2 铃铛X2 小天门X50 大天门X100 苹果X2 大苹果X5 芒果X2
 * 右5：西瓜X2 大西瓜X20 GOOD LUCK 苹果X2 大橘子X10
 * 下7（右→左）：橘子X2 铃铛X2 大77X40 77X2 苹果X2 大芒果X15 芒果X2
 * 左5（下→上）：双星X2 大双星X30 GOOD LUCK 苹果X2 大铃铛X20
 */
/**
 * 停点权重按「每个符号的加权期望相等」标定：
 * 各符号 Σ(权重×倍率) 均为 ≈2000，总权重 2238 → 单符号普通开奖 RTP ≈ 89%，
 * 余下由大三元 / 大四喜 / 开火车 / 大满贯补足（见 FRUIT_DEFAULT_AWARD_WEIGHTS）。
 *
 * 早先的权重让大天门（×100）拿到权重 3/254，单格 RTP 就有 118%，
 * 天门整体 197%，押天门稳赚。倍率是盘面印刷值不能动，只能改权重。
 * 改权重后必须跑 `pnpm audit:rtp arcade`。
 */
export const FRUIT_RING: FruitRingCell[] = [
  { kind: 'orange_small', symbol: 'orange', size: 'small', mult: 2, weight: 75, label: '橘子' },
  { kind: 'bell_small', symbol: 'bell', size: 'small', mult: 2, weight: 75, label: '铃铛' },
  { kind: 'bar_small', symbol: 'bar', size: 'small', mult: 50, weight: 10, label: '小天门' },
  { kind: 'bar_big', symbol: 'bar', size: 'big', mult: 100, weight: 15, label: '大天门' },
  { kind: 'apple_small', symbol: 'apple', size: 'small', mult: 2, weight: 38, label: '苹果' },
  { kind: 'apple_big', symbol: 'apple', size: 'big', mult: 5, weight: 340, label: '大苹果' },
  { kind: 'lemon_small', symbol: 'lemon', size: 'small', mult: 2, weight: 75, label: '芒果' },
  { kind: 'melon_small', symbol: 'melon', size: 'small', mult: 2, weight: 150, label: '西瓜' },
  { kind: 'melon_big', symbol: 'melon', size: 'big', mult: 20, weight: 85, label: '大西瓜' },
  { kind: 'luck', symbol: null, size: 'luck', mult: 0, weight: 134, label: 'GOOD LUCK' },
  { kind: 'apple_small', symbol: 'apple', size: 'small', mult: 2, weight: 38, label: '苹果' },
  /* 橘子没有专属大奖补偿，普通开奖权重略高于其他符号 */
  { kind: 'orange_big', symbol: 'orange', size: 'big', mult: 10, weight: 175, label: '大橘子' },
  { kind: 'orange_small', symbol: 'orange', size: 'small', mult: 2, weight: 75, label: '橘子' },
  { kind: 'bell_small', symbol: 'bell', size: 'small', mult: 2, weight: 75, label: '铃铛' },
  { kind: 'seven_big', symbol: 'seven', size: 'big', mult: 40, weight: 43, label: '大77' },
  { kind: 'seven_small', symbol: 'seven', size: 'small', mult: 2, weight: 150, label: '77' },
  { kind: 'apple_small', symbol: 'apple', size: 'small', mult: 2, weight: 38, label: '苹果' },
  { kind: 'lemon_big', symbol: 'lemon', size: 'big', mult: 15, weight: 113, label: '大芒果' },
  { kind: 'lemon_small', symbol: 'lemon', size: 'small', mult: 2, weight: 75, label: '芒果' },
  { kind: 'star_small', symbol: 'star', size: 'small', mult: 2, weight: 150, label: '双星' },
  { kind: 'star_big', symbol: 'star', size: 'big', mult: 30, weight: 57, label: '大双星' },
  { kind: 'luck', symbol: null, size: 'luck', mult: 0, weight: 134, label: 'GOOD LUCK' },
  { kind: 'apple_small', symbol: 'apple', size: 'small', mult: 2, weight: 38, label: '苹果' },
  { kind: 'bell_big', symbol: 'bell', size: 'big', mult: 20, weight: 85, label: '大铃铛' },
];

/** 7×7 网格坐标（列, 行），与 FRUIT_RING 下标一一对应 */
export const FRUIT_SLOT_POS: ReadonlyArray<readonly [number, number]> = [
  // 上 7
  [0, 0], [1, 0], [2, 0], [3, 0], [4, 0], [5, 0], [6, 0],
  // 右 5
  [6, 1], [6, 2], [6, 3], [6, 4], [6, 5],
  // 下 7（右→左）
  [6, 6], [5, 6], [4, 6], [3, 6], [2, 6], [1, 6], [0, 6],
  // 左 5（下→上）
  [0, 5], [0, 4], [0, 3], [0, 2], [0, 1],
];

export const FRUIT_AWARD_TYPES = [
  'normal',
  'luck_send',
  'luck_eat',
  'train',
  'big3',
  'small3',
  'four',
  'slam',
] as const;

export type FruitAwardType = (typeof FRUIT_AWARD_TYPES)[number];

export const FRUIT_AWARD_LABELS: Record<FruitAwardType, string> = {
  normal: '普通中奖',
  luck_send: '幸运送灯',
  luck_eat: '幸运吃灯',
  train: '开火车',
  big3: '大三元',
  small3: '小三元',
  four: '大四喜',
  slam: '大满贯',
};

/**
 * 默认大奖权重（分母 10000，可被 DB 配置覆盖）。
 *
 * train / big3 / small3 / four / slam 会无条件点亮整组格子，不受停点权重约束：
 * 大满贯一次点亮全部 22 个非 LUCK 格，单押天门就是 150 倍，
 * 因此这些奖型必须是千分位以下量级，否则 RTP 会被顶到数倍。
 */
export const FRUIT_DEFAULT_AWARD_WEIGHTS: Record<FruitAwardType, number> = {
  normal: 9600,
  luck_send: 200,
  luck_eat: 120,
  train: 10,
  big3: 3,
  small3: 15,
  four: 50,
  slam: 2,
};

export function fruitBetSymbolIds(): FruitBetSymbolId[] {
  return FRUIT_BET_SYMBOLS.map((s) => s.id);
}

export function isFruitBetSymbolId(v: string): v is FruitBetSymbolId {
  return FRUIT_BET_SYMBOLS.some((s) => s.id === v);
}

export function findFruitRingIndexes(
  pred: (cell: FruitRingCell, index: number) => boolean,
): number[] {
  const out: number[] = [];
  FRUIT_RING.forEach((cell, i) => {
    if (pred(cell, i)) out.push(i);
  });
  return out;
}

export function fruitBigIndexes(symbol: FruitBetSymbolId): number[] {
  return findFruitRingIndexes((c) => c.symbol === symbol && c.size === 'big');
}

/** 大四喜：盘面全部苹果格（含大小苹果） */
export function fruitAppleIndexes(): number[] {
  return findFruitRingIndexes((c) => c.symbol === 'apple');
}

export function fruitNonLuckIndexes(): number[] {
  return findFruitRingIndexes((c) => c.size !== 'luck');
}

export function fruitLuckIndexes(): number[] {
  return findFruitRingIndexes((c) => c.size === 'luck');
}
