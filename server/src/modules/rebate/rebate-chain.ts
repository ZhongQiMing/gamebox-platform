/** 管理 → 总代 → 代理 → 玩家 的回水比例一条链（纯函数，发放和后台共用） */

import {
  clampRate,
  hydrateGameRebate,
  overlayDownlineRebate,
  readAgentGameLayerMap,
  readRawGameMap,
  rebateFallbackForCategory,
} from './rebate-policy-games';

export const REBATE_RATE_HARD_MAX = 0.2;

export type PlatformRebateBounds = {
  generalMin: number;
  generalMax: number;
  generalDefault: number;
  agentMin: number;
  agentMax: number;
  agentDefault: number;
  playerMin: number;
  playerMax: number;
};

export type GeneralRebateLayer = {
  flowRate: number;
  downlineFlowRate?: number | null;
  playerMinRate?: number | null;
  playerMaxRate?: number | null;
};

export type PlayerRebateBand = {
  agentPkg: number;
  generalPkg: number;
  playerMin: number;
  playerMax: number;
};

export function asRate(v: unknown, fallback: number): number {
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0) return fallback;
  const rate = n > 1 ? n / 100 : n;
  return Math.round(rate * 10000) / 10000;
}

export function parseRateInput(v: unknown, fallback: number): number {
  return clampRate(asRate(v, fallback), 0, REBATE_RATE_HARD_MAX);
}

export function readPlatformBounds(row: {
  generalMinRate?: number | null;
  generalMaxRate?: number | null;
  generalDefaultRate?: number | null;
  totalRate?: number | null;
  agentMinRate?: number | null;
  agentMaxRate?: number | null;
  agentDefaultRate?: number | null;
  playerMinRate?: number | null;
  playerMaxRate?: number | null;
  minRate?: number | null;
  maxRate?: number | null;
} | null): PlatformRebateBounds {
  const generalMaxWanted = asRate(row?.generalMaxRate, 0.1);
  let generalDefault = asRate(row?.generalDefaultRate ?? row?.totalRate, 0.07);
  const playerMin = asRate(row?.playerMinRate ?? row?.minRate, 0.01);
  const playerMaxWanted = asRate(row?.playerMaxRate ?? row?.maxRate, 0.03);
  const agentMax = clampRate(asRate(row?.agentMaxRate, 0.07), playerMaxWanted, generalDefault);
  const generalMin = Math.max(asRate(row?.generalMinRate, 0.07), agentMax);
  const generalMax = Math.max(generalMin, generalMaxWanted);
  generalDefault = clampRate(generalDefault, generalMin, generalMax);
  const agentMinClamped = Math.min(
    Math.max(asRate(row?.agentMinRate ?? row?.playerMinRate, 0.03), playerMaxWanted),
    agentMax,
  );
  const agentDefault = clampRate(asRate(row?.agentDefaultRate, 0.05), agentMinClamped, agentMax);
  const playerMax = clampRate(playerMaxWanted, playerMin, agentDefault);
  return {
    generalMin,
    generalMax,
    generalDefault,
    agentMin: agentMinClamped,
    agentMax,
    agentDefault,
    playerMin,
    playerMax,
  };
}

/** 总代给名下代理的默认整包（开房带入） */
export function resolveDownlineFlowRate(
  platform: PlatformRebateBounds,
  general: GeneralRebateLayer | null,
): number {
  const cap = general
    ? Math.min(platform.agentMax, Math.max(platform.agentMin, Number(general.flowRate) || 0))
    : platform.agentMax;
  const raw = general?.downlineFlowRate != null
    ? Number(general.downlineFlowRate)
    : platform.agentDefault;
  return clampRate(raw, platform.agentMin, cap);
}

/** 某一房（或总代默认）生效的玩家回水上下限 */
export function resolvePlayerBand(opts: {
  platform: PlatformRebateBounds;
  general?: GeneralRebateLayer | null;
  agentFlowRate?: number | null;
}): PlayerRebateBand {
  const { platform, general } = opts;
  const generalPkg = general ? Math.max(0, Number(general.flowRate) || 0) : 0;
  const agentPkg = opts.agentFlowRate != null && Number.isFinite(Number(opts.agentFlowRate))
    ? Math.max(0, Number(opts.agentFlowRate))
    : resolveDownlineFlowRate(platform, general ?? null);

  let playerMin = platform.playerMin;
  let playerMax = platform.playerMax;
  if (general?.playerMinRate != null && Number.isFinite(Number(general.playerMinRate))) {
    playerMin = Math.max(playerMin, Number(general.playerMinRate));
  }
  if (general?.playerMaxRate != null && Number.isFinite(Number(general.playerMaxRate))) {
    playerMax = Math.min(playerMax, Number(general.playerMaxRate));
  }
  playerMax = Math.min(playerMax, agentPkg);
  if (playerMax < playerMin) playerMax = playerMin;
  return { agentPkg, generalPkg, playerMin, playerMax };
}

export function clampPlayerRateToBand(rate: number, band: PlayerRebateBand): number {
  return clampRate(rate, band.playerMin, band.playerMax);
}

export type GamePayoutPkg = {
  agentPkg: number;
  generalPkg: number;
  playerMin: number;
  playerMax: number;
  playerDefault: number;
};

function rateInBand(rate: number | null | undefined, band: PlayerRebateBand): rate is number {
  return (
    rate != null
    && Number.isFinite(rate)
    && rate >= band.playerMin - 1e-9
    && rate <= band.playerMax + 1e-9
  );
}

/**
 * 下注发放用的整包 / 玩家 P。
 * 有游戏档时用该游戏回水规则（街机玩家默认 0.5%、代理整包 1.5%）。
 * 房间/代理那条 1.8% 是彩票框，不能套到水果机 / 奔驰宝马。
 */
export function resolvePayoutRates(opts: {
  roomBand: PlayerRebateBand;
  gamePkg?: GamePayoutPkg | null;
  roomGameRate?: number | null;
  memberRate?: number | null;
  agentDefaultRate?: number | null;
}): {
  P: number;
  A: number;
  agentPkg: number;
  generalPkg: number;
} {
  const band: PlayerRebateBand = opts.gamePkg
    ? {
        agentPkg: opts.gamePkg.agentPkg,
        generalPkg: opts.gamePkg.generalPkg,
        playerMin: opts.gamePkg.playerMin,
        playerMax: opts.gamePkg.playerMax,
      }
    : opts.roomBand;
  let P: number | null = rateInBand(opts.roomGameRate, band) ? opts.roomGameRate : null;
  if (P == null && rateInBand(opts.memberRate, band)) P = opts.memberRate;
  if (P == null && rateInBand(opts.agentDefaultRate, band)) P = opts.agentDefaultRate;
  if (P == null) {
    P = opts.gamePkg
      ? opts.gamePkg.playerDefault
      : clampPlayerRateToBand(0.018, band);
  }
  P = clampPlayerRateToBand(P, band);
  return {
    P,
    A: clampRate(Math.max(0, band.agentPkg - P), 0, 1),
    agentPkg: band.agentPkg,
    generalPkg: band.generalPkg,
  };
}

export function pctLabel(rate: number): string {
  return `${(Number(rate || 0) * 100).toFixed(1)}%`;
}

export function fallbackFromPlatform(platform: PlatformRebateBounds): {
  generalMin: number;
  generalDefault: number;
  generalMax: number;
  agentMin: number;
  agentDefault: number;
  agentMax: number;
  playerMin: number;
  playerDefault: number;
  playerMax: number;
} {
  return {
    generalMin: platform.generalMin,
    generalDefault: platform.generalDefault,
    generalMax: platform.generalMax,
    agentMin: platform.agentMin,
    agentDefault: platform.agentDefault,
    agentMax: platform.agentMax,
    playerMin: platform.playerMin,
    playerDefault: clampRate(0.018, platform.playerMin, platform.playerMax),
    playerMax: platform.playerMax,
  };
}

/** 某一游戏：总代包 = 管理默认；代理/玩家用当前框（已叠总代/代理下级设置） */
export function resolveGamePackages(opts: {
  game: {
    generalMin: number; generalDefault: number; generalMax: number;
    agentMin: number; agentDefault: number; agentMax: number;
    playerMin: number; playerDefault: number; playerMax: number;
  };
  hasGeneral?: boolean;
}): {
  generalPkg: number;
  agentPkg: number;
  playerMin: number;
  playerMax: number;
  playerDefault: number;
} {
  const g = opts.game;
  const generalPkg = opts.hasGeneral ? g.generalDefault : 0;
  const agentCap = opts.hasGeneral
    ? Math.min(g.agentMax, generalPkg || g.agentMax)
    : g.agentMax;
  const agentPkg = clampRate(g.agentDefault, g.agentMin, agentCap);
  const playerMax = Math.min(g.playerMax, agentPkg);
  const playerMin = Math.min(g.playerMin, playerMax);
  const playerDefault = clampRate(g.playerDefault, playerMin, playerMax);
  return { generalPkg, agentPkg, playerMin, playerMax, playerDefault };
}

/** 某房某游戏：管理 9 字段叠总代给下级、代理给玩家；总代自己的三格永远用管理的 */
export function bandForRoomGame(opts: {
  defaults: unknown;
  platform: PlatformRebateBounds;
  gameCode: string;
  category?: string | null;
  hasGeneral?: boolean;
  generalGameRates?: unknown;
  agentGameRates?: unknown;
}) {
  const code = String(opts.gameCode || '').trim().toLowerCase();
  const fb = rebateFallbackForCategory(opts.category);
  const admin = hydrateGameRebate(readRawGameMap(opts.defaults)[code], fb);
  const rule = overlayDownlineRebate(
    admin,
    readAgentGameLayerMap(opts.generalGameRates)[code],
    readAgentGameLayerMap(opts.agentGameRates)[code],
  );
  const pkg = resolveGamePackages({
    game: rule,
    hasGeneral: opts.hasGeneral,
  });
  return { rule, pkg };
}
