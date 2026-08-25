/** 按游戏类型的回水三层默认（管理框：下限 / 默认 / 上限） */

export type GameRebateFallback = {
  generalMin: number;
  generalDefault: number;
  generalMax: number;
  agentMin: number;
  agentDefault: number;
  agentMax: number;
  playerMin: number;
  playerDefault: number;
  playerMax: number;
};

export const REBATE_CATEGORY_ORDER = ['LOTTERY', 'TABLE', 'SLOT', 'ARCADE'] as const;

export const REBATE_CATEGORY_LABEL: Record<string, string> = {
  LOTTERY: '彩票',
  TABLE: '棋牌',
  SLOT: '电子',
  ARCADE: '街机',
};

/** 彩票 / 棋牌：同一桶水。总代 7%、代理 5%、玩家 1.8%；下限盖住下级上限，上限顶着上级默认 */
export const REBATE_NORMAL_TEMPLATE: GameRebateFallback = {
  generalMin: 0.07,
  generalDefault: 0.07,
  generalMax: 0.1,
  agentMin: 0.03,
  agentDefault: 0.05,
  agentMax: 0.07,
  playerMin: 0.01,
  playerDefault: 0.018,
  playerMax: 0.03,
};

/** 电子老虎机 / 街机：回水更低，同样此消彼长 */
export const REBATE_SLOT_TEMPLATE: GameRebateFallback = {
  generalMin: 0.025,
  generalDefault: 0.025,
  generalMax: 0.04,
  agentMin: 0.01,
  agentDefault: 0.015,
  agentMax: 0.025,
  playerMin: 0.002,
  playerDefault: 0.005,
  playerMax: 0.01,
};

export function rebateFallbackForCategory(category?: string | null): GameRebateFallback {
  if (category === 'SLOT' || category === 'ARCADE') return REBATE_SLOT_TEMPLATE;
  return REBATE_NORMAL_TEMPLATE;
}

export function rebateCategoryHint(category?: string | null): string {
  const t = rebateFallbackForCategory(category);
  const pct = (n: number) => `${(n * 100).toFixed(1)}%`;
  return `总代 ${pct(t.generalDefault)} · 代理 ${pct(t.agentDefault)} · 玩家 ${pct(t.playerDefault)}`;
}
