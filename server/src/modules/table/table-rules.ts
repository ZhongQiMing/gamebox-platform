import {
  formatTableRoundNo,
  maxTableCycleMs as sharedMaxTableCycleMs,
  TABLE_BETTING_MS as SHARED_TABLE_BETTING_MS,
  TABLE_SETTLE_MS as SHARED_TABLE_SETTLE_MS,
  TABLE_TIMING as SHARED_TABLE_TIMING,
  tableTimingOf,
  type TableTiming,
} from '@gamebox/shared';
import { drawBaccarat, calcBaccaratPayout, BACCARAT_SIDES } from './baccarat.game';
import { drawZhajinhua, calcZhajinhuaPayout, ZHAJINHUA_SIDES } from './zhajinhua.game';
import { drawDouniu, calcDouniuPayout, DOUNIU_SIDES } from './douniu.game';
import { drawCards, calcPayout as calcDtPayout } from './dragon-tiger.game';
import { fromLegacyDtCard, rankToNumber } from './table-cards';
import type { DragonTigerOutcome } from './table.types';

export type TableOutcome = Record<string, unknown>;
export type { TableTiming };

export function normalizeGameCode(code: string): string {
  if (code === 'longhu') return 'dragon-tiger';
  return code;
}

/** @deprecated 请用 @gamebox/shared；此处 re-export 保持 server 内部 import 稳定 */
export const TABLE_BETTING_MS = SHARED_TABLE_BETTING_MS;
export const TABLE_SETTLE_MS = SHARED_TABLE_SETTLE_MS;
export const TABLE_TIMING = SHARED_TABLE_TIMING;

export function timingOf(gameCode: string): TableTiming {
  return tableTimingOf(normalizeGameCode(gameCode));
}

/** 孤儿退款宽限：覆盖最长整局 + 缓冲 */
export function maxTableCycleMs(): number {
  return sharedMaxTableCycleMs();
}

export function allowedSides(gameCode: string): string[] {
  const code = normalizeGameCode(gameCode);
  if (code === 'dragon-tiger') return ['dragon', 'tiger', 'tie', 'DRAGON', 'TIGER', 'TIE'];
  if (code === 'baccarat') return [...BACCARAT_SIDES];
  if (code === 'zhajinhua') return [...ZHAJINHUA_SIDES];
  if (code === 'douniu') return [...DOUNIU_SIDES];
  return [];
}

function toH5DragonTiger(dt: DragonTigerOutcome) {
  const dragon = fromLegacyDtCard(dt.dragon);
  const tiger = fromLegacyDtCard(dt.tiger);
  return {
    game: 'dragon-tiger',
    dragon,
    tiger,
    result:
      dt.winner === 'DRAGON' ? 'dragon' : dt.winner === 'TIGER' ? 'tiger' : 'tie',
    winner: dt.winner,
    dragonRank: rankToNumber(dragon.rank),
    tigerRank: rankToNumber(tiger.rank),
  };
}

export function drawOutcome(gameCode: string, serverSeed: string, nonce: number): TableOutcome {
  const code = normalizeGameCode(gameCode);
  if (code === 'dragon-tiger') return toH5DragonTiger(drawCards(serverSeed, nonce));
  if (code === 'baccarat') return drawBaccarat(serverSeed, nonce) as unknown as TableOutcome;
  if (code === 'zhajinhua') return drawZhajinhua(serverSeed, nonce) as unknown as TableOutcome;
  if (code === 'douniu') return drawDouniu(serverSeed, nonce) as unknown as TableOutcome;
  throw new Error(`不支持的牌桌：${gameCode}`);
}

/** FaceCard / 旧龙虎牌 → 稳定键，忽略多余字段与顺序差异以外的噪音 */
function cardKey(c: unknown): string {
  if (!c || typeof c !== 'object') return '';
  const o = c as Record<string, unknown>;
  if (typeof o.suit === 'string' && typeof o.rank === 'string') {
    return `${o.suit}:${o.rank}`;
  }
  if (
    (o.suit === 'S' || o.suit === 'H' || o.suit === 'D' || o.suit === 'C') &&
    typeof o.rank === 'number'
  ) {
    const fc = fromLegacyDtCard({
      suit: o.suit,
      rank: o.rank,
    });
    return `${fc.suit}:${fc.rank}`;
  }
  return '';
}

function cardsKey(arr: unknown): string {
  if (!Array.isArray(arr)) return '';
  return arr.map(cardKey).join('|');
}

function resultKey(gameCode: string, outcome: TableOutcome): string {
  const code = normalizeGameCode(gameCode);
  if (code === 'dragon-tiger') {
    if (outcome.result === 'dragon' || outcome.result === 'tiger' || outcome.result === 'tie') {
      return outcome.result;
    }
    if (outcome.winner === 'DRAGON') return 'dragon';
    if (outcome.winner === 'TIGER') return 'tiger';
    if (outcome.winner === 'TIE') return 'tie';
    return '';
  }
  return String(outcome.result ?? '');
}

/**
 * 语义比对开奖结果（勿用 JSON.stringify：字段增减 / 旧格式会误报不一致）
 * 只比对定输赢的关键面：结果方向 + 牌面序列
 */
export function tableOutcomesMatch(
  gameCode: string,
  a: TableOutcome | null | undefined,
  b: TableOutcome | null | undefined,
): boolean {
  if (!a || !b) return false;
  const code = normalizeGameCode(gameCode);
  if (resultKey(code, a) !== resultKey(code, b)) return false;

  if (code === 'dragon-tiger') {
    return (
      cardKey(a.dragon) === cardKey(b.dragon) && cardKey(a.tiger) === cardKey(b.tiger)
    );
  }
  if (code === 'baccarat') {
    return (
      cardsKey(a.banker) === cardsKey(b.banker) &&
      cardsKey(a.player) === cardsKey(b.player) &&
      Number(a.bankerPoint) === Number(b.bankerPoint) &&
      Number(a.playerPoint) === Number(b.playerPoint) &&
      Boolean(a.bankerPair) === Boolean(b.bankerPair) &&
      Boolean(a.playerPair) === Boolean(b.playerPair)
    );
  }
  if (code === 'zhajinhua' || code === 'douniu') {
    return (
      cardsKey(a.banker) === cardsKey(b.banker) && cardsKey(a.player) === cardsKey(b.player)
    );
  }
  return false;
}

function normalizeDtSide(side: string): 'DRAGON' | 'TIGER' | 'TIE' | null {
  if (side === 'DRAGON' || side === 'dragon' || side === '龙') return 'DRAGON';
  if (side === 'TIGER' || side === 'tiger' || side === '虎') return 'TIGER';
  if (side === 'TIE' || side === 'tie' || side === '和') return 'TIE';
  return null;
}

function dtWinnerOf(outcome: TableOutcome): DragonTigerOutcome['winner'] {
  if (outcome.winner === 'DRAGON' || outcome.winner === 'TIGER' || outcome.winner === 'TIE') {
    return outcome.winner;
  }
  if (outcome.result === 'dragon') return 'DRAGON';
  if (outcome.result === 'tiger') return 'TIGER';
  return 'TIE';
}

export function calcTablePayout(
  gameCode: string,
  side: string,
  outcome: TableOutcome,
  amount: number,
): number {
  const code = normalizeGameCode(gameCode);
  if (code === 'dragon-tiger') {
    const mapped = normalizeDtSide(side);
    if (!mapped) return 0;
    const dt: DragonTigerOutcome = {
      dragon: { suit: 'S', rank: 1 },
      tiger: { suit: 'S', rank: 1 },
      winner: dtWinnerOf(outcome),
    };
    return calcDtPayout(mapped, dt, amount);
  }
  if (code === 'baccarat') return calcBaccaratPayout(side, outcome as never, amount);
  if (code === 'zhajinhua') return calcZhajinhuaPayout(side, outcome as never, amount);
  if (code === 'douniu') return calcDouniuPayout(side, outcome as never, amount);
  return 0;
}

/** 墙钟对齐：本局下注截止时间 */
export function alignedBettingEndsAt(gameCode: string, now = Date.now()): number {
  const t = timingOf(gameCode);
  const cycleStart = Math.floor(now / t.cycleMs) * t.cycleMs;
  let end = cycleStart + t.bettingMs;
  if (now >= end) end = cycleStart + t.cycleMs + t.bettingMs;
  return end;
}

/** 墙钟对齐：开奖(DRAWING)截止 = 本周期 bettingEnds + drawMs */
export function alignedDrawEndsAt(gameCode: string, now = Date.now()): number {
  const t = timingOf(gameCode);
  const cycleStart = Math.floor(now / t.cycleMs) * t.cycleMs;
  let end = cycleStart + t.bettingMs + t.drawMs;
  if (now >= end) end = Math.max(now + 500, end);
  return end;
}

/** 墙钟对齐：派奖(SETTLED)截止 = 本周期末 */
export function alignedSettleEndsAt(gameCode: string, now = Date.now()): number {
  const t = timingOf(gameCode);
  const cycleStart = Math.floor(now / t.cycleMs) * t.cycleMs;
  let end = cycleStart + t.cycleMs;
  if (now >= end) end = Math.max(now + 500, end);
  return end;
}

/** 局号：{LHD|BJL|ZJH|DN}{YYYYMMDD}-{seq4}，与墙钟周期对齐 */
export function alignedRoundNo(gameCode: string, now = Date.now()): string {
  const t = timingOf(gameCode);
  return formatTableRoundNo(normalizeGameCode(gameCode), t.cycleMs, now);
}
