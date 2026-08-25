/** 单个玩法的单注上下限 */
export interface PlayBetLimit {
  minBet: number
  maxBet: number
}

export type PlayLimitMap = Record<string, PlayBetLimit>

function asLimitNum(v: unknown): number | null {
  const n = Number(v)
  return Number.isFinite(n) && n > 0 ? n : null
}

/** 从库里的 JSON 读出玩法限红；坏数据直接丢掉，回落到游戏默认 */
export function parsePlayLimits(raw: unknown): PlayLimitMap {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {}
  const out: PlayLimitMap = {}
  for (const [key, val] of Object.entries(raw as Record<string, unknown>)) {
    if (!key || !val || typeof val !== 'object' || Array.isArray(val)) continue
    const row = val as { minBet?: unknown; maxBet?: unknown }
    const minBet = asLimitNum(row.minBet)
    const maxBet = asLimitNum(row.maxBet)
    if (minBet == null || maxBet == null || minBet > maxBet) continue
    out[key] = { minBet, maxBet }
  }
  return out
}

/**
 * 某玩法实际生效的单注区间。
 * 有单独配置用单独的；没有则用游戏默认，并可再叠一层「额外上限」（高赔硬顶 / 牌桌边限）。
 */
export function resolvePlayBetRange(opts: {
  gameMin: number
  gameMax: number
  playLimits?: PlayLimitMap | null
  playKey: string
  extraMax?: number | null
}): PlayBetLimit {
  const gameMin = asLimitNum(opts.gameMin) ?? 1
  const gameMax = Math.max(gameMin, asLimitNum(opts.gameMax) ?? gameMin)
  const ov = opts.playLimits?.[opts.playKey]
  if (ov) return { minBet: ov.minBet, maxBet: ov.maxBet }
  const extra = asLimitNum(opts.extraMax)
  return {
    minBet: gameMin,
    maxBet: extra != null ? Math.min(gameMax, extra) : gameMax,
  }
}

/** 已单独配过的玩法区间包络，给列表「限红」列用 */
export function playLimitEnvelope(
  playLimits: PlayLimitMap,
  fallback: PlayBetLimit,
): PlayBetLimit {
  const rows = Object.values(playLimits)
  if (!rows.length) return fallback
  return {
    minBet: Math.min(...rows.map((r) => r.minBet)),
    maxBet: Math.max(...rows.map((r) => r.maxBet)),
  }
}
