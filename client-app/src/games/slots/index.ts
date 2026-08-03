/**
 * 水果机前端布局入口 —— 权威数据来自 @gamebox/shared
 */
export {
  FRUIT_RING,
  FRUIT_SLOT_POS,
  FRUIT_BET_SYMBOLS,
  FRUIT_AWARD_LABELS,
  FRUIT_AWARD_TYPES,
  type FruitAwardType,
  type FruitBetSymbolId,
  type FruitRingCell,
} from '@gamebox/shared'

/** 底部倍数档位：下注区显示注数(00)，实际扣分 = 注数 × 倍数 */
export const FRUIT_MULT_STEPS = [1, 5, 10, 20, 50, 100] as const
