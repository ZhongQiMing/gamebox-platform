/**
 * 奔驰宝马街机引擎。
 *
 * 12 仓位（4 车×3 色）+ YoPlay YBEN ResultBonus 六大奖。
 * 资金动作走 SettlementKernel；本文件只负责开奖与盘面。
 */
import { Injectable, BadRequestException, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { GameConfigCache } from './game-config.cache';
import { SettlementKernel } from './settlement-kernel';
import { genServerSeed, deriveRandom, weightedPick } from './fairness.util';
import {
  BCBM_RING,
  BCBM_BET_SLOTS,
  BCBM_DEFAULT_AWARD_WEIGHTS,
  BCBM_AWARD_TYPES,
  allocateCappedWins,
  asMoney,
  bcbmBetSlot,
  bcbmIndexesOfBrand,
  bcbmIndexesOfColor,
  bcbmFreeIndexes,
  bcbmNonFreeIndexes,
  isBcbmBetId,
  roundMoney,
  type BcbmAwardType,
  type BcbmBetId,
  type BcbmBrandId,
  type BcbmColorId,
} from '@gamebox/shared';
import { businessNo } from './business-id';

const GAME_CODE = 'bcbm';
const KEY = 'bcbm';
const log = new Logger('BcbmEngine');

interface BcbmConfigPayTable {
  awardWeights?: Partial<Record<BcbmAwardType, number>>;
}

export interface BcbmSpinInput {
  playerId: string;
  gameCode?: string;
  bets: Record<string, number>;
  clientSeed?: string;
  clientRequestId: string;
}

export interface BcbmWinLine {
  position: BcbmBetId;
  mult: number;
  amount: number;
  cellIndex: number;
}

interface BcbmRoundOutcome {
  awardType: BcbmAwardType;
  stopIndex: number;
  hitIndexes: number[];
  freeStopIndex: number | null;
  winner: string;
  kind: string;
  multiplier: number;
  wins: BcbmWinLine[];
  totalBet: number;
  totalPayout: number;
}

@Injectable()
export class BcbmEngine {
  constructor(
    private prisma: PrismaService,
    private configCache: GameConfigCache,
    private settle: SettlementKernel,
  ) {}

  async spin(input: BcbmSpinInput) {
    const clientRequestId = this.settle.assertClientRequestId(input.clientRequestId);
    const replay = await this.replayIfAny(input.playerId, clientRequestId);
    if (replay) return replay;

    const { playerId, bets } = input;
    const clientSeed = input.clientSeed?.slice(0, 128) || clientRequestId;
    const gameCode = input.gameCode || GAME_CODE;

    if (Object.keys(bets ?? {}).length > BCBM_BET_SLOTS.length) {
      throw new BadRequestException('押注仓位数量超限');
    }
    const entries = Object.entries(bets ?? {}).filter(([, amt]) => amt > 0);
    if (entries.length === 0) throw new BadRequestException('请至少押一个仓位');
    for (const [pos, amt] of entries) {
      if (!isBcbmBetId(pos)) throw new BadRequestException(`无效仓位：${pos}`);
      if (!Number.isInteger(amt) || amt < 1) throw new BadRequestException('押注额必须是正整数');
    }
    const totalAmount = entries.reduce((s, [, amt]) => s + amt, 0);
    const betMap = Object.fromEntries(entries) as Record<BcbmBetId, number>;

    const game = await this.configCache.get(gameCode);
    if (!game || game.status !== 'ONLINE') throw new NotFoundException('游戏不存在或已下架');
    if (game.category !== 'ARCADE') throw new BadRequestException('该游戏不是街机品类');
    const config = game.configs[0];
    if (!config) throw new BadRequestException('游戏未配置');
    if (totalAmount < asMoney(game.minBet) || totalAmount > asMoney(game.maxBet)) {
      throw new BadRequestException(`总押注须在 ${asMoney(game.minBet)}~${asMoney(game.maxBet)} 之间`);
    }

    const rawPay = config.payTable;
    const payCfg = (!rawPay || Array.isArray(rawPay) ? {} : rawPay) as BcbmConfigPayTable;
    const awardWeights = { ...BCBM_DEFAULT_AWARD_WEIGHTS, ...(payCfg.awardWeights ?? {}) };

    const { seed: serverSeed, hash: serverSeedHash } = genServerSeed();
    const rnd1 = deriveRandom(serverSeed, clientSeed, 1);
    const rnd2 = deriveRandom(serverSeed, clientSeed, 2);
    const rnd3 = deriveRandom(serverSeed, clientSeed, 3);
    const awardType = pickAwardType(awardWeights, rnd1);
    const { stopIndex, hitIndexes, freeStopIndex } = resolveHits(awardType, rnd2, rnd3);
    const wins = settleWins(hitIndexes, betMap);
    const totalPayout = wins.reduce((s, w) => s + w.amount, 0);
    const stopCell = BCBM_RING[stopIndex];

    const player = await this.prisma.user.findUnique({
      where: { id: playerId },
      select: { id: true, agentPath: true },
    });

    const result = await this.prisma.$transaction(async (tx) => {
      const round = await tx.gameRound.create({
        data: {
          roundNo: businessNo('BCBM'),
          gameId: game.id,
          category: 'ARCADE',
          playerId,
          configVer: config.version,
          state: 'PLAYING',
          serverSeed,
          serverSeedHash,
          clientSeed,
          nonce: 1,
        },
      });

      await this.settle.debitBetInTx(tx, {
        playerId,
        roundId: round.id,
        amount: totalAmount,
        gameName: game.name,
        keyPrefix: KEY,
      });

      const rawByPos = entries.map(([pos]) =>
        wins.filter((w) => w.position === pos).reduce((s, w) => s + w.amount, 0),
      );
      const allocated = allocateCappedWins(totalAmount, rawByPos);
      if (allocated.capped) {
        log.error(`奔驰宝马整局派彩触顶 原始=${totalPayout} 封顶=${allocated.total}`);
      }

      const betResults: Array<{ position: string; amount: number; payout: number; won: boolean }> =
        [];
      let first = true;
      for (let i = 0; i < entries.length; i++) {
        const [pos, amt] = entries[i]!;
        const posWins = wins.filter((w) => w.position === pos);
        const payout = allocated.wins[i] ?? 0;
        const won = payout > 0;
        const mult = won && posWins[0] ? posWins[0].mult : 0;

        const bet = await tx.bet.create({
          data: {
            betNo: businessNo('BB'),
            clientRequestId: first ? clientRequestId : undefined,
            playerId,
            gameId: game.id,
            roundId: round.id,
            betType: pos,
            amount: amt,
            status: won ? 'WON' : 'LOST',
            payout,
            multiplier: mult,
            odds: mult,
            validFlow: amt,
            settledAt: new Date(),
          },
        });
        first = false;

        await this.settle.creditWinInTx(tx, {
          playerId,
          roundId: round.id,
          betId: bet.id,
          amount: payout,
          remark: `${game.name} ${pos}`,
          keyPrefix: KEY,
          skipCap: true,
        });

        betResults.push({ position: pos, amount: amt, payout, won });
      }

      await this.settle.applyCommissionInTx(tx, player, totalAmount, round.id);

      const paidTotal = allocated.total;
      const outcome: BcbmRoundOutcome = {
        awardType,
        stopIndex,
        hitIndexes,
        freeStopIndex,
        winner: stopCell.label,
        kind: stopCell.kind,
        multiplier: stopCell.mult,
        wins,
        totalBet: totalAmount,
        totalPayout: paidTotal,
      };
      await tx.gameRound.update({
        where: { id: round.id },
        data: {
          state: 'SETTLED',
          endedAt: new Date(),
          totalFlow: totalAmount,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          outcome: outcome as any,
        },
      });

      return { roundId: round.id, betResults, totalPayout: paidTotal };
    });

    const balance = await this.settle.getBalance(playerId);
    return this.toResponse({
      gameCode,
      roundId: result.roundId,
      awardType,
      stopIndex,
      hitIndexes,
      freeStopIndex,
      winner: stopCell.label,
      winnerKind: stopCell.kind,
      multiplier: stopCell.mult,
      wins,
      bets: result.betResults,
      totalBet: totalAmount,
      totalPayout: result.totalPayout,
      balance,
      serverSeed,
      serverSeedHash,
    });
  }

  private async replayIfAny(playerId: string, clientRequestId: string) {
    const bet = await this.settle.findSettledByClientRequestId(playerId, clientRequestId);
    if (!bet?.round?.outcome) return null;
    const o = bet.round.outcome as unknown as BcbmRoundOutcome;
    const roundBets = await this.prisma.bet.findMany({
      where: { roundId: bet.round.id },
      select: { betType: true, amount: true, payout: true },
    });
    const balance = await this.settle.getBalance(playerId);
    return this.toResponse({
      gameCode: bet.game.code,
      roundId: bet.round.id,
      awardType: o.awardType,
      stopIndex: o.stopIndex,
      hitIndexes: o.hitIndexes,
      freeStopIndex: o.freeStopIndex ?? null,
      winner: o.winner,
      winnerKind: o.kind,
      multiplier: o.multiplier,
      wins: o.wins ?? [],
      bets: roundBets.map((b) => ({
        position: b.betType ?? '',
        amount: asMoney(b.amount),
        payout: asMoney(b.payout),
        won: asMoney(b.payout) > 0,
      })),
      totalBet: o.totalBet ?? roundBets.reduce((s, b) => s + asMoney(b.amount), 0),
      totalPayout: o.totalPayout ?? roundBets.reduce((s, b) => s + asMoney(b.payout), 0),
      balance,
      serverSeed: bet.round.serverSeed ?? '',
      serverSeedHash: bet.round.serverSeedHash ?? '',
    });
  }

  private toResponse(r: {
    gameCode: string;
    roundId: string;
    awardType: BcbmAwardType | string;
    stopIndex: number;
    hitIndexes: number[];
    freeStopIndex: number | null;
    winner: string;
    winnerKind: string;
    multiplier: number;
    wins: BcbmWinLine[];
    bets: Array<{ position: string; amount: number; payout: number; won: boolean }>;
    totalBet: number;
    totalPayout: number;
    balance: number;
    serverSeed: string;
    serverSeedHash: string;
  }) {
    return {
      ...r,
      slots: BCBM_BET_SLOTS.map((s) => ({
        id: s.id,
        label: s.label,
        mult: s.mult,
        brand: s.brand,
        color: s.color,
      })),
    };
  }
}

function pickAwardType(weights: Record<BcbmAwardType, number>, rnd: number): BcbmAwardType {
  const list = BCBM_AWARD_TYPES.map((t) => Math.max(0, weights[t] ?? 0));
  const idx = weightedPick(list, rnd);
  return BCBM_AWARD_TYPES[idx];
}

function pickNonFreeStop(rnd: number): number {
  const idxs = bcbmNonFreeIndexes();
  const weights = idxs.map((i) => BCBM_RING[i].weight);
  return idxs[weightedPick(weights, rnd)];
}

function resolveHits(
  awardType: BcbmAwardType,
  rnd: number,
  rndBonus = 0.5,
): { stopIndex: number; hitIndexes: number[]; freeStopIndex: number | null } {
  if (awardType === 'free' || awardType === 'lightning') {
    /* 派彩停在可押注格；free 格仅作视觉途经点（权重已从普通停点池排除） */
    const stopIndex = pickNonFreeStop(rnd);
    const frees = bcbmFreeIndexes();
    const freeStopIndex = frees.length
      ? frees[Math.floor(rndBonus * frees.length) % frees.length]!
      : null;
    return { stopIndex, hitIndexes: [stopIndex], freeStopIndex };
  }
  if (awardType.startsWith('sanyuan_')) {
    const brand = awardType.replace('sanyuan_', '') as BcbmBrandId;
    const hits = bcbmIndexesOfBrand(brand);
    return { stopIndex: hits[0] ?? pickNonFreeStop(rnd), hitIndexes: hits, freeStopIndex: null };
  }
  if (awardType.startsWith('sixi_')) {
    const color = awardType.replace('sixi_', '') as BcbmColorId;
    const hits = bcbmIndexesOfColor(color);
    return { stopIndex: hits[0] ?? pickNonFreeStop(rnd), hitIndexes: hits, freeStopIndex: null };
  }
  if (awardType === 'fast') {
    const ring = bcbmNonFreeIndexes();
    const start = weightedPick(
      ring.map((i) => BCBM_RING[i].weight),
      rnd,
    );
    const hits: number[] = [];
    for (let n = 0; n < 5; n++) hits.push(ring[(start + n) % ring.length]!);
    return { stopIndex: hits[0]!, hitIndexes: hits, freeStopIndex: null };
  }
  if (awardType === 'uturn') {
    const ring = bcbmNonFreeIndexes();
    const mid = weightedPick(
      ring.map((i) => BCBM_RING[i].weight),
      rnd,
    );
    const len = ring.length;
    const hits = [
      ring[(mid - 5 + len * 5) % len]!,
      ring[mid]!,
      ring[(mid + 5) % len]!,
    ];
    return { stopIndex: hits[1]!, hitIndexes: hits, freeStopIndex: null };
  }
  if (awardType === 'drift') {
    const hits = bcbmNonFreeIndexes();
    const stopIndex = hits[weightedPick(
      hits.map((i) => BCBM_RING[i].weight),
      rnd,
    )]!;
    return { stopIndex, hitIndexes: hits, freeStopIndex: null };
  }
  void rndBonus;
  const stopIndex = pickNonFreeStop(rnd);
  return { stopIndex, hitIndexes: [stopIndex], freeStopIndex: null };
}

function settleWins(hitIndexes: number[], betMap: Record<BcbmBetId, number>): BcbmWinLine[] {
  const wins: BcbmWinLine[] = [];
  const paid = new Set<string>();
  for (const i of hitIndexes) {
    const cell = BCBM_RING[i];
    if (cell.kind === 'free' || !cell.brand || !cell.color) continue;
    const pos = cell.kind;
    const amt = betMap[pos] ?? 0;
    if (amt <= 0) continue;
    const key = `${pos}@${i}`;
    if (paid.has(key)) continue;
    paid.add(key);
    if (wins.some((w) => w.position === pos)) continue;
    const slot = bcbmBetSlot(pos);
    wins.push({
      position: pos,
      mult: slot.mult,
      amount: roundMoney(amt * slot.mult),
      cellIndex: i,
    });
  }
  return wins;
}
