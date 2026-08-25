import { BadRequestException } from '@nestjs/common';
import type { Game, GameConfig } from '@prisma/client';
import {
  asMoney,
  BCBM_BET_SLOTS,
  FRUIT_BET_SYMBOLS,
  getTablePayTable,
  highOddsBetCap,
  parsePlayLimits,
  playLimitEnvelope,
  resolvePlayBetRange,
  tableSideMaxBet,
  type PlayBetLimit,
  type PlayLimitMap,
} from '@gamebox/shared';
import { lotteryPlayLimitKey } from '../lottery/play-limit-key';

export interface GamePlayRow {
  key: string
  label: string
  minBet: number
  maxBet: number
  hint?: string
}

const TABLE_SIDE_LABELS: Record<string, string> = {
  banker: '庄',
  player: '闲',
  tie: '和',
  TIE: '和',
  bankerPair: '庄对',
  playerPair: '闲对',
  shunjin: '顺金',
  baozi: '豹子',
  san2: '散牌',
  san3: '对子',
  san6: '顺子',
  san7: '金花',
  small: '小牛牛',
  niuniu: '牛牛',
  niu79: '牛7-牛9',
  niu06: '无牛-牛6',
  flower: '五花牛',
  dragon: '龙',
  tiger: '虎',
  DRAGON: '龙',
  TIGER: '虎',
};

const TABLE_SKIP_SIDES = new Set(['DRAGON', 'TIGER', 'TIE']);

function gameRange(game: Game): { gameMin: number; gameMax: number } {
  return {
    gameMin: asMoney(game.minBet),
    gameMax: asMoney(game.maxBet),
  };
}

function lotteryPlays(game: Game, payTable: unknown, limits: PlayLimitMap): GamePlayRow[] {
  if (!payTable || typeof payTable !== 'object' || Array.isArray(payTable)) return [];
  const rows: GamePlayRow[] = [];
  for (const [key, val] of Object.entries(payTable as Record<string, unknown>)) {
    if (key === 'refund') continue;
    const rec = val && typeof val === 'object' && !Array.isArray(val)
      ? (val as { multiplier?: unknown; desc?: unknown })
      : {};
    const multiplier = Number(
      typeof val === 'number' ? val : rec.multiplier,
    );
    const extraMax = highOddsBetCap(multiplier);
    const range = resolvePlayBetRange({
      ...gameRange(game),
      playLimits: limits,
      playKey: key,
      extraMax,
    });
    const desc = typeof rec.desc === 'string' ? rec.desc : '';
    rows.push({
      key,
      label: desc || key,
      minBet: range.minBet,
      maxBet: range.maxBet,
      hint: extraMax != null && !limits[key] ? `赔率 ${multiplier} 倍 · 默认单注不超过 ${extraMax}` : undefined,
    });
  }
  return rows;
}

function tablePlays(game: Game, limits: PlayLimitMap): GamePlayRow[] {
  const pt = getTablePayTable(game.code);
  if (!pt) return [];
  const sides = pt.mode === 'profit-odds' ? Object.keys(pt.odds) : Object.keys(pt.mult);
  const seen = new Set<string>();
  const rows: GamePlayRow[] = [];
  for (const side of sides) {
    if (TABLE_SKIP_SIDES.has(side)) continue;
    if (seen.has(side)) continue;
    seen.add(side);
    const extraMax = tableSideMaxBet(game.code, side, asMoney(game.maxBet));
    const range = resolvePlayBetRange({
      ...gameRange(game),
      playLimits: limits,
      playKey: side,
      extraMax: limits[side] ? undefined : extraMax,
    });
    rows.push({
      key: side,
      label: TABLE_SIDE_LABELS[side] || side,
      minBet: range.minBet,
      maxBet: range.maxBet,
    });
  }
  return rows;
}

function arcadePlays(game: Game, limits: PlayLimitMap): GamePlayRow[] {
  const slots = game.code === 'bcbm'
    ? BCBM_BET_SLOTS.map((s) => ({ key: s.id, label: s.label }))
    : game.code === 'fruit-machine'
      ? FRUIT_BET_SYMBOLS.map((s) => ({ key: s.id, label: s.label }))
      : [];
  return slots.map((s) => {
    const range = resolvePlayBetRange({
      ...gameRange(game),
      playLimits: limits,
      playKey: s.key,
    });
    return { key: s.key, label: s.label, minBet: range.minBet, maxBet: range.maxBet };
  });
}

export function listGamePlays(
  game: Game & { playLimits?: unknown },
  activeConfig?: GameConfig | null,
): GamePlayRow[] {
  const limits = parsePlayLimits(game.playLimits);
  if (game.category === 'LOTTERY') return lotteryPlays(game, activeConfig?.payTable, limits);
  if (game.category === 'TABLE') return tablePlays(game, limits);
  if (game.category === 'ARCADE') return arcadePlays(game, limits);
  const fallback = gameRange(game)
  return [{
    key: 'default',
    label: '默认',
    minBet: fallback.gameMin,
    maxBet: fallback.gameMax,
  }];
}

export function parsePlayLimitsBody(
  raw: unknown,
  catalog: GamePlayRow[],
): PlayLimitMap {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new BadRequestException('玩法限红无效');
  }
  const allowed = new Set(catalog.map((p) => p.key));
  const out: PlayLimitMap = {};
  for (const [key, val] of Object.entries(raw as Record<string, unknown>)) {
    if (!allowed.has(key)) throw new BadRequestException(`未知玩法：${key}`);
    if (!val || typeof val !== 'object' || Array.isArray(val)) {
      throw new BadRequestException(`${key} 限红无效`);
    }
    const minBet = Number((val as { minBet?: unknown }).minBet);
    const maxBet = Number((val as { maxBet?: unknown }).maxBet);
    if (!Number.isFinite(minBet) || minBet <= 0) throw new BadRequestException(`${key} 最小下注无效`);
    if (!Number.isFinite(maxBet) || maxBet <= 0) throw new BadRequestException(`${key} 最大下注无效`);
    if (minBet > maxBet) throw new BadRequestException(`${key} 最小下注不能大于最大下注`);
    out[key] = { minBet, maxBet };
  }
  if (!Object.keys(out).length) throw new BadRequestException('请至少配置一个玩法限红');
  return out;
}

export function envelopeFromLimits(limits: PlayLimitMap, game: Game): PlayBetLimit {
  const r = gameRange(game)
  return playLimitEnvelope(limits, { minBet: r.gameMin, maxBet: r.gameMax })
}

export function playLimitsOf(game: { playLimits?: unknown }): PlayLimitMap {
  return parsePlayLimits(game.playLimits);
}

export function amountRangeForPlay(
  game: Game,
  playKey: string,
  extraMax?: number | null,
): PlayBetLimit {
  return resolvePlayBetRange({
    gameMin: asMoney(game.minBet),
    gameMax: asMoney(game.maxBet),
    playLimits: parsePlayLimits(game.playLimits),
    playKey,
    extraMax,
  });
}

export function assertAmountInPlayRange(
  amount: number,
  range: PlayBetLimit,
  label = '投注额',
): void {
  if (amount < range.minBet || amount > range.maxBet) {
    throw new BadRequestException(`${label}须在 ${range.minBet}~${range.maxBet} 之间`);
  }
}

export function lotteryBetPlayKey(
  betType: string,
  betValue: string | number | undefined,
  payTable: unknown,
): string {
  return lotteryPlayLimitKey(betType, betValue, payTable);
}
