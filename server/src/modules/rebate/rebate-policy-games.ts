/** 回水政策里按游戏拆开的三层比例（存在 RebatePolicy.defaults.games） */

import {
  REBATE_NORMAL_TEMPLATE,
  rebateFallbackForCategory,
  type GameRebateFallback,
} from '@gamebox/shared';

export type { GameRebateFallback };

export const DEFAULT_PLAYER_MIN = REBATE_NORMAL_TEMPLATE.playerMin;
export const DEFAULT_PLAYER_MAX = REBATE_NORMAL_TEMPLATE.playerMax;
export const DEFAULT_GAME_FALLBACK: GameRebateFallback = REBATE_NORMAL_TEMPLATE;

export { rebateFallbackForCategory };

export type StoredGameRebate = GameRebateFallback & {
  /** 兼容旧字段：玩家下限 / 上限 / 当前默认 */
  minRate: number;
  maxRate: number;
  playerRate: number;
};

function asRate(v: unknown, fallback: number): number {
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0) return fallback;
  const rate = n > 1 ? n / 100 : n;
  return Math.round(rate * 10000) / 10000;
}

export function clampRate(v: number, min: number, max: number): number {
  const lo = Math.min(min, max);
  const hi = Math.max(min, max);
  if (!Number.isFinite(v)) return lo;
  return Math.min(hi, Math.max(lo, Math.round(v * 10000) / 10000));
}

function layer(
  row: Record<string, unknown>,
  keys: { min: string[]; def: string[]; max: string[] },
  fb: { min: number; def: number; max: number },
) {
  const min = asRate(keys.min.map((k) => row[k]).find((v) => v != null), fb.min);
  const max = Math.max(min, asRate(keys.max.map((k) => row[k]).find((v) => v != null), fb.max));
  const def = clampRate(
    asRate(keys.def.map((k) => row[k]).find((v) => v != null), fb.def),
    min,
    max,
  );
  return { min, def, max };
}

export function hydrateGameRebate(
  item: unknown,
  fallback: GameRebateFallback = DEFAULT_GAME_FALLBACK,
): StoredGameRebate {
  const row = item && typeof item === 'object' ? (item as Record<string, unknown>) : {};
  const general = layer(row, {
    min: ['generalMin', 'generalMinRate'],
    def: ['generalDefault', 'generalDefaultRate', 'generalRate'],
    max: ['generalMax', 'generalMaxRate'],
  }, { min: fallback.generalMin, def: fallback.generalDefault, max: fallback.generalMax });
  const agent = layer(row, {
    min: ['agentMin', 'agentMinRate'],
    def: ['agentDefault', 'agentDefaultRate', 'agentRate'],
    max: ['agentMax', 'agentMaxRate'],
  }, { min: fallback.agentMin, def: fallback.agentDefault, max: fallback.agentMax });
  const player = layer(row, {
    min: ['playerMin', 'playerMinRate', 'minRate'],
    def: ['playerDefault', 'playerDefaultRate', 'playerRate', 'rate'],
    max: ['playerMax', 'playerMaxRate', 'maxRate'],
  }, { min: fallback.playerMin, def: fallback.playerDefault, max: fallback.playerMax });

  const generalMax = Math.max(general.min, general.max);
  let generalDef = clampRate(general.def, general.min, generalMax);
  const agentMax = Math.min(agent.max, generalDef);
  let agentDef = clampRate(agent.def, agent.min, agentMax);
  const playerMax = Math.min(player.max, agentDef);
  const playerMin = Math.min(player.min, playerMax);
  const playerDef = clampRate(player.def, playerMin, playerMax);
  let agentMin = Math.max(agent.min, playerMax);
  agentMin = Math.min(agentMin, agentMax);
  agentDef = clampRate(agentDef, agentMin, agentMax);
  let generalMin = Math.max(general.min, agentMax);
  generalMin = Math.min(generalMin, generalMax);
  generalDef = clampRate(generalDef, generalMin, generalMax);
  return {
    generalMin,
    generalDefault: generalDef,
    generalMax,
    agentMin,
    agentDefault: agentDef,
    agentMax,
    playerMin,
    playerDefault: playerDef,
    playerMax,
    minRate: playerMin,
    maxRate: playerMax,
    playerRate: playerDef,
  };
}

const NINE_KEYS = [
  'generalMin', 'generalDefault', 'generalMax',
  'agentMin', 'agentDefault', 'agentMax',
  'playerMin', 'playerDefault', 'playerMax',
] as const;

export function gameRebateNineDiffer(raw: unknown, next: StoredGameRebate): boolean {
  const row = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  for (const k of NINE_KEYS) {
    const n = Number(row[k]);
    const have = Number.isFinite(n) ? (n > 1 ? n / 100 : n) : Number.NaN;
    if (!Number.isFinite(have) || Math.abs(have - next[k]) > 1e-9) return true;
  }
  return false;
}

export function readRawGameMap(defaults: unknown): Record<string, unknown> {
  const root = defaults && typeof defaults === 'object' ? (defaults as Record<string, unknown>) : {};
  const raw = root.games && typeof root.games === 'object'
    ? (root.games as Record<string, unknown>)
    : {};
  const out: Record<string, unknown> = {};
  for (const [code, item] of Object.entries(raw)) {
    const key = String(code || '').trim().toLowerCase();
    if (!key) continue;
    out[key] = item;
  }
  return out;
}

export function readGameRebateMap(
  defaults: unknown,
  fallback: GameRebateFallback = DEFAULT_GAME_FALLBACK,
): Record<string, StoredGameRebate> {
  const out: Record<string, StoredGameRebate> = {};
  for (const [key, item] of Object.entries(readRawGameMap(defaults))) {
    out[key] = hydrateGameRebate(item, fallback);
  }
  return out;
}

/** 旧全站一套（玩家 1.8%）——换成按类型模板 */
export function isLegacyUniformRebate(item: unknown): boolean {
  if (item == null) return true;
  const row = item && typeof item === 'object' ? (item as Record<string, unknown>) : {};
  const hasLayer = row.generalMin != null || row.generalDefault != null || row.agentDefault != null;
  if (!hasLayer) return true;
  const playerDef = Number(row.playerDefault ?? row.playerRate ?? row.minRate);
  const playerMin = Number(row.playerMin ?? row.minRate);
  const toRate = (n: number) => (n > 1 ? n / 100 : n);
  const defRate = toRate(playerDef);
  const minRate = toRate(playerMin);
  return Number.isFinite(defRate) && Number.isFinite(minRate)
    && Math.abs(defRate - 0.018) < 1e-9
    && Math.abs(minRate - 0.018) < 1e-9;
}

export function shouldApplyCategoryTemplate(item: unknown, category?: string | null): boolean {
  if (item == null) return true;
  if (category === 'SLOT' || category === 'ARCADE') return isLegacyUniformRebate(item);
  return false;
}

export function writeGameRebateMap(
  defaults: unknown,
  games: Record<string, StoredGameRebate>,
): Record<string, unknown> {
  const root = defaults && typeof defaults === 'object'
    ? { ...(defaults as Record<string, unknown>) }
    : {};
  const packed: Record<string, Omit<StoredGameRebate, 'minRate' | 'maxRate' | 'playerRate'>> = {};
  for (const [code, g] of Object.entries(games)) {
    packed[code] = {
      generalMin: g.generalMin,
      generalDefault: g.generalDefault,
      generalMax: g.generalMax,
      agentMin: g.agentMin,
      agentDefault: g.agentDefault,
      agentMax: g.agentMax,
      playerMin: g.playerMin,
      playerDefault: g.playerDefault,
      playerMax: g.playerMax,
    };
  }
  root.games = packed;
  return root;
}

/** 总代/代理按游戏自己调过的额度 { pk10: { flowRate } } */
export function readAgentGameRates(raw: unknown): Record<string, number> {
  if (!raw || typeof raw !== 'object') return {};
  const out: Record<string, number> = {};
  for (const [code, item] of Object.entries(raw as Record<string, unknown>)) {
    const key = String(code || '').trim().toLowerCase();
    if (!key) continue;
    const n = typeof item === 'number'
      ? item
      : asRate((item as { flowRate?: unknown })?.flowRate, Number.NaN);
    if (!Number.isFinite(n) || n < 0) continue;
    out[key] = n > 1 ? Math.round((n / 100) * 10000) / 10000 : Math.round(n * 10000) / 10000;
  }
  return out;
}

export function writeAgentGameLayers(
  raw: unknown,
  patch: Record<string, Record<string, number>>,
): Record<string, Record<string, number>> {
  const prev = raw && typeof raw === 'object' ? { ...(raw as Record<string, unknown>) } : {};
  const out: Record<string, Record<string, number>> = {};
  for (const [code, item] of Object.entries(prev)) {
    const key = String(code || '').trim().toLowerCase();
    if (!key || !item || typeof item !== 'object') continue;
    const row = item as Record<string, unknown>;
    const packed: Record<string, number> = {};
    for (const [k, v] of Object.entries(row)) {
      const n = Number(v);
      if (Number.isFinite(n) && n >= 0 && k !== 'flowRate') packed[k] = n > 1 ? n / 100 : n;
    }
    if (Object.keys(packed).length) out[key] = packed;
  }
  for (const [code, fields] of Object.entries(patch)) {
    const key = String(code || '').trim().toLowerCase();
    if (!key) continue;
    out[key] = { ...(out[key] ?? {}) };
    for (const [k, v] of Object.entries(fields)) {
      if (!Number.isFinite(v)) continue;
      out[key][k] = Math.round(v * 10000) / 10000;
    }
  }
  return out;
}

function pickLayer(raw: unknown, keys: string[]): Record<string, unknown> {
  const row = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const out: Record<string, unknown> = {};
  for (const k of keys) {
    if (row[k] != null) out[k] = row[k];
  }
  return out;
}

/** 管理框 ← 总代给下级的框 ← 代理给玩家的框。总代自己的三格永远用管理的。 */
export function overlayDownlineRebate(
  admin: StoredGameRebate,
  generalRaw?: unknown,
  agentRaw?: unknown,
): StoredGameRebate {
  let merged = admin;
  const gPick = pickLayer(generalRaw, [
    'agentMin', 'agentDefault', 'agentMax',
    'playerMin', 'playerDefault', 'playerMax', 'playerRate', 'minRate', 'maxRate',
  ]);
  if (Object.keys(gPick).length) merged = hydrateGameRebate(gPick, merged);
  const aPick = pickLayer(agentRaw, [
    'playerMin', 'playerDefault', 'playerMax', 'playerRate', 'minRate', 'maxRate',
  ]);
  if (Object.keys(aPick).length) merged = hydrateGameRebate(aPick, merged);
  return {
    ...merged,
    generalMin: admin.generalMin,
    generalDefault: admin.generalDefault,
    generalMax: admin.generalMax,
  };
}

export function readAgentGameLayerMap(raw: unknown): Record<string, unknown> {
  if (!raw || typeof raw !== 'object') return {};
  const out: Record<string, unknown> = {};
  for (const [code, item] of Object.entries(raw as Record<string, unknown>)) {
    const key = String(code || '').trim().toLowerCase();
    if (!key) continue;
    out[key] = item;
  }
  return out;
}
