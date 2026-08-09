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
 * 停点权重：印刷倍率不动，只调「谁更容易停」。
 * 口径：小奖（×2 / 大苹果×5）常停，高倍格少停；与 awardWeights 一起标定（改后跑 audit:rtp）。
 */
export const FRUIT_RING: FruitRingCell[] = [
  { kind: 'orange_small', symbol: 'orange', size: 'small', mult: 2, weight: 110, label: '橘子' },
  { kind: 'bell_small', symbol: 'bell', size: 'small', mult: 2, weight: 112, label: '铃铛' },
  { kind: 'bar_small', symbol: 'bar', size: 'small', mult: 50, weight: 5, label: '小天门' },
  { kind: 'bar_big', symbol: 'bar', size: 'big', mult: 100, weight: 4, label: '大天门' },
  { kind: 'apple_small', symbol: 'apple', size: 'small', mult: 2, weight: 95, label: '苹果' },
  { kind: 'apple_big', symbol: 'apple', size: 'big', mult: 5, weight: 260, label: '大苹果' },
  { kind: 'lemon_small', symbol: 'lemon', size: 'small', mult: 2, weight: 112, label: '芒果' },
  { kind: 'melon_small', symbol: 'melon', size: 'small', mult: 2, weight: 200, label: '西瓜' },
  { kind: 'melon_big', symbol: 'melon', size: 'big', mult: 20, weight: 36, label: '大西瓜' },
  { kind: 'luck', symbol: null, size: 'luck', mult: 0, weight: 80, label: 'GOOD LUCK' },
  { kind: 'apple_small', symbol: 'apple', size: 'small', mult: 2, weight: 95, label: '苹果' },
  { kind: 'orange_big', symbol: 'orange', size: 'big', mult: 10, weight: 90, label: '大橘子' },
  { kind: 'orange_small', symbol: 'orange', size: 'small', mult: 2, weight: 110, label: '橘子' },
  { kind: 'bell_small', symbol: 'bell', size: 'small', mult: 2, weight: 112, label: '铃铛' },
  { kind: 'seven_big', symbol: 'seven', size: 'big', mult: 40, weight: 14, label: '大77' },
  { kind: 'seven_small', symbol: 'seven', size: 'small', mult: 2, weight: 200, label: '77' },
  { kind: 'apple_small', symbol: 'apple', size: 'small', mult: 2, weight: 95, label: '苹果' },
  { kind: 'lemon_big', symbol: 'lemon', size: 'big', mult: 15, weight: 48, label: '大芒果' },
  { kind: 'lemon_small', symbol: 'lemon', size: 'small', mult: 2, weight: 112, label: '芒果' },
  { kind: 'star_small', symbol: 'star', size: 'small', mult: 2, weight: 200, label: '双星' },
  { kind: 'star_big', symbol: 'star', size: 'big', mult: 30, weight: 20, label: '大双星' },
  { kind: 'luck', symbol: null, size: 'luck', mult: 0, weight: 80, label: 'GOOD LUCK' },
  { kind: 'apple_small', symbol: 'apple', size: 'small', mult: 2, weight: 95, label: '苹果' },
  { kind: 'bell_big', symbol: 'bell', size: 'big', mult: 20, weight: 36, label: '大铃铛' },
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
 * 默认奖型权重（分母 10000，可被 DB 配置覆盖）。
 *
 * 手感：普通/小奖占绝大多数；送灯吃灯偶发；火车/三元/四喜/满贯极稀。
 * train / big3 / small3 / four / slam 无条件点亮整组，权重必须极低。
 */
export const FRUIT_DEFAULT_AWARD_WEIGHTS: Record<FruitAwardType, number> = {
  normal: 9858,
  luck_send: 55,
  luck_eat: 75,
  train: 3,
  big3: 1,
  small3: 4,
  four: 3,
  slam: 1,
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
