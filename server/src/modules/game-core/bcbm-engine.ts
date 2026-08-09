/**
 * 奔驰宝马街机引擎。
 *
 * 12 仓位（4 车×3 色）+ YoPlay YBEN ResultBonus 六大奖。
 * 资金动作走 SettlementKernel；本文件只负责开奖与盘面。
 */
import {
  Injectable, BadRequestException, Logger, NotFoundException,
  Optional, Inject, forwardRef,
} from '@nestjs/common';
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
import { RiskService } from '../risk/risk.service';
import { ConsoleControlService } from '../console/console-control.service';
import { GlobalSoftControlService } from '../console/global-soft-control.service';
import { FlyDiskService } from '../console/fly-disk.service';
import { pickSeedForArcadePool } from '../console/control-pick.util';

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
  /** 6 位运营房间号（多房隔离必填） */
  roomNo?: string;
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
    private risk: RiskService,
    @Optional() @Inject(forwardRef(() => ConsoleControlService))
    private control?: ConsoleControlService,
    @Optional() @Inject(forwardRef(() => GlobalSoftControlService))
    private globalSoft?: GlobalSoftControlService,
    @Optional() private flyDisk?: FlyDiskService,
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

    if (gameCode !== GAME_CODE) {
      throw new BadRequestException('游戏编码无效');
    }
    const game = await this.configCache.get(gameCode);
    if (!game || game.status !== 'ONLINE') throw new NotFoundException('游戏不存在或已下架');
    if (game.category !== 'ARCADE') throw new BadRequestException('该游戏不是街机品类');
    if (game.code !== GAME_CODE) throw new BadRequestException('游戏编码无效');
    const config = game.configs[0];
    if (!config) throw new BadRequestException('游戏未配置');
    if (totalAmount < asMoney(game.minBet) || totalAmount > asMoney(game.maxBet)) {
      throw new BadRequestException(`总押注须在 ${asMoney(game.minBet)}~${asMoney(game.maxBet)} 之间`);
    }

    const rawPay = config.payTable;
    const payCfg = (!rawPay || Array.isArray(rawPay) ? {} : rawPay) as BcbmConfigPayTable;
    const awardWeights = { ...BCBM_DEFAULT_AWARD_WEIGHTS, ...(payCfg.awardWeights ?? {}) };

    const house = this.flyDisk
      ? await this.flyDisk.resolveHouse(
          playerId,
          await this.flyDisk.requireOpsRoomId(playerId, input.roomNo),
          totalAmount,
          { requireRoom: true },
        )
      : null;
    const globalRt = this.globalSoft
      ? await this.globalSoft.getArcadeDrawRuntime(GAME_CODE)
      : null;
    const softPick = pickSeedForArcadePool({
      runtime: globalRt,
      stake: totalAmount,
      gen: () => {
        const g = genServerSeed();
        return { seed: g.seed, hash: g.hash };
      },
      simulate: (seed) => {
        const rnd1 = deriveRandom(seed, clientSeed, 1);
        const rnd2 = deriveRandom(seed, clientSeed, 2);
        const rnd3 = deriveRandom(seed, clientSeed, 3);
        const awardType = pickAwardType(awardWeights, rnd1);
        const hits = resolveHits(awardType, rnd2, rnd3);
        const wins = settleWins(hits.hitIndexes, betMap);
        const rawTotal = wins.reduce((s, w) => s + w.amount, 0);
        const rawByPos = entries.map(([pos]) =>
          wins.filter((w) => w.position === pos).reduce((s, w) => s + w.amount, 0),
        );
        const allocated = allocateCappedWins(totalAmount, rawByPos);
        return {
          payout: allocated.total,
          awardType,
          stopIndex: hits.stopIndex,
          hitIndexes: hits.hitIndexes,
          freeStopIndex: hits.freeStopIndex,
          wins,
          rawTotal,
          allocated,
        };
      },
    });

    const {
      seed: serverSeed,
      hash: serverSeedHash,
      awardType,
      stopIndex,
      hitIndexes,
      freeStopIndex,
      wins,
      rawTotal: totalPayout,
      allocated,
    } = softPick.result;
    const stopCell = BCBM_RING[stopIndex];
    const flyPayload = house
      ? {
          type: house.type,
          id: house.id,
          flying: house.flying,
          roomId: house.roomId,
          agentUserId: house.agentUserId,
        }
      : undefined;

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
        house: house ?? undefined,
      });

      if (allocated.capped) {
        log.error(`奔驰宝马整局派彩触顶 原始=${totalPayout} 封顶=${allocated.total}`);
      }

      /* wins 按封顶后金额对齐，供客户端报奖累加与 outcome 复盘一致 */
      const paidWins = scaleWinLinesToTotal(wins, allocated.total);

      const betResults: Array<{ position: string; amount: number; payout: number; won: boolean }> =
        [];
      let first = true;
      for (let i = 0; i < entries.length; i++) {
        const [pos, amt] = entries[i]!;
        const posWins = paidWins.filter((w) => w.position === pos);
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
            ...(flyPayload ? { payload: { fly: flyPayload } as never } : {}),
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
          stake: amt,
          skipCap: true,
          house: house ?? undefined,
        });

        betResults.push({ position: pos, amount: amt, payout, won });
      }

      const paidTotal = allocated.total;
      const outcome: BcbmRoundOutcome = {
        awardType,
        stopIndex,
        hitIndexes,
        freeStopIndex,
        winner: stopCell.label,
        kind: stopCell.kind,
        multiplier: stopCell.mult,
        wins: paidWins,
        totalBet: totalAmount,
        totalPayout: paidTotal,
      };
      await tx.gameRound.update({
        where: { id: round.id },
        data: {
          state: 'SETTLED',
          endedAt: new Date(),
          totalFlow: totalAmount,
           
          outcome: outcome as any,
        },
      });

      return { roundId: round.id, betResults, totalPayout: paidTotal, paidWins };
    });


    if (result.totalPayout >= Math.max(totalAmount * 50, 100_000)) {
      await this.risk.record({
        type: 'BIG_WIN',
        level: result.totalPayout >= 1_000_000 ? 'CRITICAL' : 'WARN',
        targetId: playerId,
        fingerprint: `bw:${result.roundId}`,
        dedupeMs: 24 * 3600_000,
        detail: {
          playerId,
          totalAmount,
          totalPayout: result.totalPayout,
          gameCode,
          roundId: result.roundId,
          summary: `${gameCode} 派彩 ${result.totalPayout}（下注 ${totalAmount}）`,
        },
      });
    }

    try {
      if (this.control) await this.control.refreshGoalExhaustion(GAME_CODE);
    } catch {
      /* 不影响开奖 */
    }

    const balRoomId = String(house?.roomId || '').trim();
    const balance = balRoomId ? await this.settle.getBalance(playerId, balRoomId) : 0;
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
      wins: result.paidWins,
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
    if (bet.game.code !== GAME_CODE) {
      throw new BadRequestException('clientRequestId 已被占用');
    }
    const o = bet.round.outcome as unknown as BcbmRoundOutcome;
    const roundBets = await this.prisma.bet.findMany({
      where: { roundId: bet.round.id },
      select: { betType: true, amount: true, payout: true },
    });
    const balRoomId = String(
      (bet.payload as { fly?: { roomId?: string } } | null)?.fly?.roomId || '',
    ).trim();
    const balance = balRoomId ? await this.settle.getBalance(playerId, balRoomId) : 0;
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

/** 将各格赢分按比例缩放到封顶后总额，保证 Σamount === paidTotal */
function scaleWinLinesToTotal(wins: BcbmWinLine[], paidTotal: number): BcbmWinLine[] {
  if (wins.length === 0) return wins;
  const rawTotal = roundMoney(wins.reduce((s, w) => s + w.amount, 0));
  const target = roundMoney(Math.max(0, paidTotal));
  if (rawTotal <= 0 || target === rawTotal) {
    return target === 0 && rawTotal > 0 ? wins.map((w) => ({ ...w, amount: 0 })) : wins;
  }
  if (target <= 0) return wins.map((w) => ({ ...w, amount: 0 }));

  const scaled = wins.map((w) => ({
    ...w,
    amount: roundMoney((w.amount * target) / rawTotal),
  }));
  let allocated = roundMoney(scaled.reduce((s, w) => s + w.amount, 0));
  let i = 0;
  while (allocated + 0.005 < target && i < scaled.length * 200) {
    const idx = i % scaled.length;
    if (wins[idx]!.amount > 0) {
      scaled[idx] = { ...scaled[idx]!, amount: roundMoney(scaled[idx]!.amount + 0.01) };
      allocated = roundMoney(allocated + 0.01);
    }
    i += 1;
  }
  while (allocated - 0.005 > target && i < scaled.length * 400) {
    const idx = scaled.findIndex((w) => w.amount >= 0.01);
    if (idx < 0) break;
    scaled[idx] = { ...scaled[idx]!, amount: roundMoney(scaled[idx]!.amount - 0.01) };
    allocated = roundMoney(allocated - 0.01);
    i += 1;
  }
  return scaled;
}
