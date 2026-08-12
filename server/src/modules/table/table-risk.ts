import { allowedSides, normalizeGameCode } from './table-rules';

/** 庄家风控：对冲互斥、单用户单边、平台单边暴露 */
export const TABLE_RISK = {
  /** 单用户单局同一方向累计上限（与房间 maxBet 取更严） */
  maxUserSidePerRound: 200_000,
  /** Redis betSummary 单边累计上限（全桌） */
  maxPlatformSideExposure: 2_000_000,
};

/** 同局不可同时押的对立边（归一化小写） */
const HEDGE_PAIRS: Record<string, Array<[string, string]>> = {
  baccarat: [['banker', 'player']],
  zhajinhua: [['banker', 'player']],
  douniu: [['banker', 'player']],
  'dragon-tiger': [['dragon', 'tiger']],
};

export function normalizeBetSide(side: string): string {
  const s = String(side || '').trim();
  if (s === 'DRAGON' || s === '龙') return 'dragon';
  if (s === 'TIGER' || s === '虎') return 'tiger';
  if (s === 'TIE' || s === '和') return 'tie';
  return s.toLowerCase();
}

/** DB 查询用的同方向等价值；仅从该游戏明确允许的 side 中取，避免跨方向合并。 */
export function equivalentBetSides(gameCode: string, side: string): string[] {
  const norm = normalizeBetSide(side);
  const aliases = allowedSides(gameCode).filter((candidate) => normalizeBetSide(candidate) === norm);
  return aliases.length ? [...new Set(aliases)] : [side];
}

/** 若下注 side 与某对立边互斥，返回对立边（含大小写别名） */
export function oppositeHedgeSides(gameCode: string, side: string): string[] {
  const code = normalizeGameCode(gameCode);
  const pairs = HEDGE_PAIRS[code];
  if (!pairs) return [];
  const norm = normalizeBetSide(side);
  for (const [a, b] of pairs) {
    if (norm === a) {
      return code === 'dragon-tiger' ? [b, b.toUpperCase()] : [b];
    }
    if (norm === b) {
      return code === 'dragon-tiger' ? [a, a.toUpperCase()] : [a];
    }
  }
  return [];
}

/** betSummary 里可能同时有大小写 key，合并读取 */
export function sideExposure(betSummary: Record<string, number>, side: string): number {
  const norm = normalizeBetSide(side);
  let total = 0;
  for (const [k, v] of Object.entries(betSummary || {})) {
    if (normalizeBetSide(k) === norm) total += v || 0;
  }
  return total;
}
