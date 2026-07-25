import { GameCategory } from '@prisma/client';

/** 按游戏类别默认回水率 */
export const CATEGORY_REBATE_RATE: Record<GameCategory, number> = {
  LOTTERY: 0.008,
  SLOT: 0.005,
  ARCADE: 0.005,
  TABLE: 0.005,
};

/** 个别游戏覆盖（0 = 不参与回水） */
export const GAME_REBATE_OVERRIDES: Record<string, number> = {
  'fruit-machine': 0,
};

export function resolveRebateRate(
  gameCode: string,
  category: GameCategory,
  params?: unknown,
): number {
  if (gameCode in GAME_REBATE_OVERRIDES) return GAME_REBATE_OVERRIDES[gameCode];
  if (params && typeof params === 'object' && params !== null) {
    const r = (params as Record<string, unknown>).rebateRate;
    if (typeof r === 'number' && r >= 0) return r;
  }
  return CATEGORY_REBATE_RATE[category] ?? 0.005;
}

export interface GameRebateFlow {
  gameCode: string;
  gameName: string;
  validFlow: number;
  rate: number;
  amount: number;
}

export function calcRebateFromFlows(
  items: Array<{ gameCode: string; gameName: string; validFlow: number; rate: number }>,
): { validFlow: number; amount: number; rate: number; games: GameRebateFlow[] } {
  const games: GameRebateFlow[] = items
    .filter((g) => g.validFlow > 0 && g.rate > 0)
    .map((g) => ({
      ...g,
      amount: Math.floor(g.validFlow * g.rate),
    }));

  const validFlow = games.reduce((s, g) => s + g.validFlow, 0);
  const amount = games.reduce((s, g) => s + g.amount, 0);
  const rate = validFlow > 0 ? amount / validFlow : 0;
  return { validFlow, amount, rate, games };
}
