/**
 * 经典水果机（玛丽机）引擎。
 *
 * 玩法：24 格跑灯 + 8 仓位多符号下注；开奖可为单格或特殊大奖多格命中。
 * 本引擎是该类街机的标准实现，不套用其它游戏结构。
 */
import {
  Injectable, BadRequestException, Logger, NotFoundException,
  Optional, Inject, forwardRef,
} from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { GameConfigCache } from './game-config.cache';
import { SettlementKernel } from './settlement-kernel';
import { SoftControlAuditService } from '../console/soft-control-audit.service';
import { genServerSeed, deriveRandom, weightedPick } from './fairness.util';
import {
  FRUIT_RING,
  FRUIT_BET_SYMBOLS,
  FRUIT_DEFAULT_AWARD_WEIGHTS,
  FRUIT_AWARD_TYPES,
  allocateCappedWins,
  asMoney,
  capWin,
  fruitAppleIndexes,
  fruitBigIndexes,
  fruitLuckIndexes,
  fruitNonLuckIndexes,
  isFruitBetSymbolId,
  parsePlayLimits,
  resolvePlayBetRange,
  roundMoney,
  type FruitAwardType,
  type FruitBetSymbolId,
} from '@gamebox/shared';
import { businessNo } from './business-id';
import { RiskService } from '../risk/risk.service';
import { ConsoleControlService } from '../console/console-control.service';
import { GlobalSoftControlService } from '../console/global-soft-control.service';
import { FlyDiskService, type FlyHouse } from '../console/fly-disk.service';
import { PLATFORM_OWNER_ID } from '../points/points.service';
import { pickSeedForArcadePool } from '../console/control-pick.util';

const GAME_CODE = 'fruit-machine';
const KEY = 'fruit';
/** 覆盖最长报奖动画；超时未揭晓则服务端强制入账（人不在游戏也结） */
const REVEAL_TIMEOUT_MS = 60_000;
const log = new Logger('FruitMachineEngine');

interface FruitConfigPayTable {
  awardWeights?: Partial<Record<FruitAwardType, number>>;
}

export interface FruitSpinInput {
  playerId: string;
  gameCode?: string;
  /** 符号仓位 → 押注额 */
  bets: Record<string, number>;
  clientSeed?: string;
  clientRequestId: string;
  /** 6 位运营房间号（多房隔离必填） */
  roomNo?: string;
}

export interface FruitWinLine {
  symbol: FruitBetSymbolId;
  mult: number;
  amount: number;
  cellIndex: number;
}

/** 写在 GameRound.outcome 上，供猜大小绑定当局赢分 */
interface FruitRoundOutcome {
  awardType: FruitAwardType;
  stopIndex: number;
  hitIndexes: number[];
  wins: FruitWinLine[];
  totalPayout: number;
  /** 当前可再赌金额；0 表示不可赌 */
  pendingGambleAmount: number;
  /**
   * 跑灯动画未结束：注单保持 PENDING，注单页显示「待开奖」。
   * 客户端 reveal / 进页兜底 / 1 分钟超时 cron 揭晓后清掉。
   */
  awaitingReveal?: boolean;
  /** 各仓位封顶后派彩（与 Bet 行一一对应，供揭晓入账） */
  betPlan?: Array<{ position: string; amount: number; payout: number; mult: number }>;
}

@Injectable()
export class FruitMachineEngine {
  constructor(
    private prisma: PrismaService,
    private configCache: GameConfigCache,
    private risk: RiskService,
    private settle: SettlementKernel,
    @Optional() @Inject(forwardRef(() => ConsoleControlService))
    private control?: ConsoleControlService,
    @Optional() @Inject(forwardRef(() => GlobalSoftControlService))
    private globalSoft?: GlobalSoftControlService,
    @Optional() private flyDisk?: FlyDiskService,
    @Optional() private softAudit?: SoftControlAuditService,
  ) {}

  private flyRoomId(payload: unknown): string {
    return String((payload as { fly?: { roomId?: string } } | null)?.fly?.roomId || '').trim();
  }

  private async balanceInRoom(playerId: string, roomId?: string | null): Promise<number> {
    const rid = String(roomId || '').trim();
    return rid ? this.settle.getBalance(playerId, rid) : 0;
  }

  private async roomIdFromRound(playerId: string, roundId: string): Promise<string> {
    const bet = await this.prisma.bet.findFirst({
      where: { roundId, playerId },
      orderBy: { createdAt: 'asc' },
      select: { payload: true },
    });
    return this.flyRoomId(bet?.payload);
  }

  async spin(input: FruitSpinInput) {
    const clientRequestId = this.settle.assertClientRequestId(input.clientRequestId);
    const replay = await this.replayIfAny(input.playerId, clientRequestId);
    if (replay) return replay;

    // 上一把若动画中断未揭晓，先入账，避免 PENDING 堆积
    await this.settleAwaitingReveal(input.playerId);

    const { playerId, bets } = input;
    const clientSeed = input.clientSeed?.slice(0, 128) || clientRequestId;
    const gameCode = input.gameCode || GAME_CODE;

    if (Object.keys(bets ?? {}).length > FRUIT_BET_SYMBOLS.length) {
      throw new BadRequestException('押注仓位数量超限');
    }
    const entries = Object.entries(bets ?? {}).filter(([, amt]) => amt > 0);
    if (entries.length === 0) throw new BadRequestException('请至少押一个符号');
    for (const [sym, amt] of entries) {
      if (!isFruitBetSymbolId(sym)) throw new BadRequestException(`无效仓位：${sym}`);
      if (!Number.isInteger(amt) || amt < 1) throw new BadRequestException('押注额必须是正整数');
    }
    const totalAmount = entries.reduce((s, [, amt]) => s + amt, 0);
    const betMap = Object.fromEntries(entries) as Record<FruitBetSymbolId, number>;

    const game = await this.configCache.get(gameCode);
    if (!game || game.status !== 'ONLINE') throw new NotFoundException('游戏不存在或已下架');
    if (game.category !== 'ARCADE') throw new BadRequestException('该游戏不是街机品类');
    const config = game.configs[0];
    if (!config) throw new BadRequestException('游戏未配置');
    const fruitLimits = parsePlayLimits(game.playLimits);
    if (Object.keys(fruitLimits).length) {
      for (const [sym, amt] of entries) {
        const range = resolvePlayBetRange({
          gameMin: asMoney(game.minBet),
          gameMax: asMoney(game.maxBet),
          playLimits: fruitLimits,
          playKey: sym,
        });
        if (amt < range.minBet || amt > range.maxBet) {
          throw new BadRequestException(`${sym} 须在 ${range.minBet}~${range.maxBet} 之间`);
        }
      }
    } else if (totalAmount < asMoney(game.minBet) || totalAmount > asMoney(game.maxBet)) {
      throw new BadRequestException(`总押注须在 ${asMoney(game.minBet)}~${asMoney(game.maxBet)} 之间`);
    }

    const payCfg = (config.payTable ?? {}) as FruitConfigPayTable;
    const awardWeights = { ...FRUIT_DEFAULT_AWARD_WEIGHTS, ...(payCfg.awardWeights ?? {}) };

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
        let nonce = 0;
        const random = () => deriveRandom(seed, clientSeed, ++nonce);
        const awardType = pickAwardType(awardWeights, random());
        const hits = resolveHits(awardType, random);
        const wins = settleWins(hits.hitIndexes, betMap);
        const rawTotal = wins.reduce((s, w) => s + w.amount, 0);
        const rawByPos = entries.map(([pos]) => {
          const sym = pos as FruitBetSymbolId;
          return wins.filter((w) => w.symbol === sym).reduce((s, w) => s + w.amount, 0);
        });
        const allocated = allocateCappedWins(totalAmount, rawByPos);
        return {
          payout: allocated.total,
          awardType,
          stopIndex: hits.stopIndex,
          hitIndexes: hits.hitIndexes,
          wins,
          rawTotal,
          allocated,
          nonce,
        };
      },
    });

    const {
      seed: serverSeed,
      hash: serverSeedHash,
      awardType,
      stopIndex,
      hitIndexes,
      wins,
      rawTotal: totalPayout,
      allocated,
      nonce,
    } = softPick.result;
    /* 三个比例都在下注时定死：揭晓可能晚很久，期间改比例不该动到这笔已发生的流水 */
    const rates = this.flyDisk && house?.roomId
      ? await this.flyDisk.resolvePlayerRate(playerId, house.roomId, GAME_CODE)
      : undefined;
    const flyPayload = house
      ? {
          type: house.type,
          id: house.id,
          flying: house.flying,
          roomId: house.roomId,
          agentUserId: house.agentUserId,
          generalUserId: house.generalUserId,
          sitting: house.sitting,
          /* 房间账本类型：揭晓派彩必须按信用/现金规则分支，不可丢 */
          bookMode: house.bookMode,
          P: rates?.P,
          agentPkg: rates?.agentPkg,
          generalPkg: rates?.generalPkg,
        }
      : undefined;

    const result = await this.prisma.$transaction(async (tx) => {
      // 新开一局即放弃上一把未再赌的当局赢分资格
      await this.clearPendingGambleInTx(tx, playerId, game.id);

      const round = await tx.gameRound.create({
        data: {
          roundNo: businessNo('FRU'),
          gameId: game.id,
          category: 'ARCADE',
          playerId,
          configVer: config.version,
          state: 'PLAYING',
          serverSeed,
          serverSeedHash,
          clientSeed,
          nonce,
        },
      });
      /* 介入留痕：只有 ADMIN 能查，写失败也不能拖累开奖 */
      if (softPick.steered && this.softAudit) {
        await this.softAudit.record({
          category: 'arcade',
          gameCode: GAME_CODE,
          refNo: round.roundNo,
          refId: round.id,
          reason: 'arcadePool',
          tries: softPick.tries,
          naturalDigest: `${softPick.natural.awardType} 停${softPick.natural.stopIndex}`,
          adoptedDigest: `${awardType} 停${stopIndex}`,
          stake: totalAmount,
          estPayout: softPick.result.payout,
        });
      }

      await this.settle.debitBetInTx(tx, {
        playerId,
        roundId: round.id,
        amount: totalAmount,
        gameName: game.name,
        keyPrefix: KEY,
        house: house ?? undefined,
      });

      if (allocated.capped) {
        log.error(`水果机整局派彩触顶 原始=${totalPayout} 封顶=${allocated.total}`);
      }

      /* wins 按封顶后金额对齐，供客户端报奖累加与 outcome 复盘一致 */
      const paidWins = scaleWinLinesToTotal(wins, allocated.total);

      const betResults: Array<{ position: string; amount: number; payout: number; won: boolean }> =
        [];
      const betPlan: NonNullable<FruitRoundOutcome['betPlan']> = [];
      let first = true;
      for (let i = 0; i < entries.length; i++) {
        const [pos, amt] = entries[i]!;
        const sym = pos as FruitBetSymbolId;
        const symWins = paidWins.filter((w) => w.symbol === sym);
        const payout = allocated.wins[i] ?? 0;
        const mult = symWins.length ? symWins.reduce((s, w) => s + w.mult, 0) : 0;

        await tx.bet.create({
          data: {
            betNo: businessNo('FR'),
            clientRequestId: first ? clientRequestId : undefined,
            playerId,
            gameId: game.id,
            roundId: round.id,
            betType: pos,
            amount: amt,
            /* 跑灯结束前不揭晓：注单页显示待开奖 */
            status: 'PENDING',
            payout: 0,
            ...(flyPayload ? { payload: { fly: flyPayload } as never } : {}),
          },
        });
        first = false;

        betPlan.push({ position: pos, amount: amt, payout, mult });
        betResults.push({ position: pos, amount: amt, payout, won: payout > 0 });
      }

      const paidTotal = allocated.total;
      const outcome: FruitRoundOutcome = {
        awardType,
        stopIndex,
        hitIndexes,
        wins: paidWins,
        totalPayout: paidTotal,
        pendingGambleAmount: 0,
        awaitingReveal: true,
        betPlan,
      };
      await tx.gameRound.update({
        where: { id: round.id },
        data: {
          state: 'PLAYING',
          totalFlow: totalAmount,
          /** 最终消耗的派生次数，供 seed+nonce 逐步复算 */
          nonce,
           
          outcome: outcome as any,
        },
      });

      return { roundId: round.id, betResults, totalPayout: paidTotal, paidWins };
    });


    const balance = await this.balanceInRoom(playerId, house?.roomId);
    return {
      gameCode,
      roundId: result.roundId,
      awardType,
      stopIndex,
      hitIndexes,
      wins: result.paidWins,
      bets: result.betResults,
      totalBet: totalAmount,
      totalWin: result.totalPayout,
      totalPayout: result.totalPayout,
      balance,
      serverSeed,
      serverSeedHash,
      awaitingReveal: true,
    };
  }

  /**
   * 客户端跑灯/报奖结束后揭晓：派彩入账、注单 WON/LOST，注单页才显示盈亏。
   * 幂等：已揭晓则回放余额与当局可再赌额度。
   */
  async reveal(playerId: string, roundId: string) {
    if (!roundId) throw new BadRequestException('roundId 无效');
    const settled = await this.revealRoundIfNeeded(playerId, roundId);
    const balance = await this.balanceInRoom(
      playerId,
      await this.roomIdFromRound(playerId, roundId),
    );
    return {
      ok: true as const,
      roundId,
      balance,
      totalPayout: settled.totalPayout,
      pendingGambleAmount: settled.pendingGambleAmount,
    };
  }

  /**
   * 每 5 秒扫一次：开局超过 1 分钟仍 awaitingReveal → 强制揭晓。
   * 人不进游戏、杀进程也不卡「待开奖」；时长留足特殊报奖动画。
   */
  @Cron('*/5 * * * * *')
  async cronForceRevealStale() {
    const game = await this.configCache.get(GAME_CODE);
    if (!game) return;
    const cutoff = new Date(Date.now() - REVEAL_TIMEOUT_MS);
    const rows = await this.prisma.gameRound.findMany({
      where: {
        gameId: game.id,
        category: 'ARCADE',
        state: 'PLAYING',
        startedAt: { lt: cutoff },
        playerId: { not: null },
      },
      orderBy: { startedAt: 'asc' },
      take: 40,
      select: { id: true, playerId: true, outcome: true },
    });
    for (const row of rows) {
      if (!row.playerId) continue;
      const o = row.outcome as unknown as FruitRoundOutcome | null;
      if (!o?.awaitingReveal) continue;
      try {
        await this.revealRoundIfNeeded(row.playerId, row.id);
        log.log(`水果机超时强制揭晓 round=${row.id} player=${row.playerId}`);
      } catch (err) {
        log.warn(
          `水果机超时揭晓失败 round=${row.id}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
  }

  /** 无 pending 局时，尽量用 roomNo 解析当前房余额；解析不到则不返回 balance，避免前端被 0 覆盖 */
  private async tryBalanceByRoomNo(
    playerId: string,
    roomNo?: string | null,
  ): Promise<number | undefined> {
    const no = String(roomNo || '').trim();
    if (!/^\d{6}$/.test(no) || !this.flyDisk) return undefined;
    try {
      const rid = await this.flyDisk.requireOpsRoomId(playerId, no);
      return this.balanceInRoom(playerId, rid);
    } catch {
      return undefined;
    }
  }

  /** 查询是否仍有可猜大小的当局赢分（进页恢复 UI） */
  async getPendingGamble(playerId: string, roomNo?: string) {
    await this.settleAwaitingReveal(playerId);
    const game = await this.configCache.get(GAME_CODE);
    if (!game) {
      const balance = await this.tryBalanceByRoomNo(playerId, roomNo);
      return balance == null
        ? { pendingGambleAmount: 0 }
        : { pendingGambleAmount: 0, balance };
    }
    const pending = await this.prisma.$transaction(async (tx) =>
      this.findPendingGambleRoundInTx(tx, playerId, game.id),
    );
    if (!pending) {
      const balance = await this.tryBalanceByRoomNo(playerId, roomNo);
      return balance == null
        ? { pendingGambleAmount: 0 }
        : { pendingGambleAmount: 0, balance };
    }
    const outcome = pending.outcome as unknown as FruitRoundOutcome;
    const balance = await this.balanceInRoom(
      playerId,
      await this.roomIdFromRound(playerId, pending.id),
    );
    return {
      pendingGambleAmount: Math.max(0, outcome.pendingGambleAmount || 0),
      balance,
      roundId: pending.id,
    };
  }

  /** 退币 / 放弃猜大小：清掉当局可再赌额度（积分已在开奖时入账，不扣回） */
  async abandonGamble(playerId: string, roomNo?: string) {
    await this.settleAwaitingReveal(playerId);
    const game = await this.configCache.get(GAME_CODE);
    if (!game) {
      const balance = await this.tryBalanceByRoomNo(playerId, roomNo);
      return balance == null ? { ok: true as const } : { ok: true as const, balance };
    }
    const pending = await this.findPendingGambleRoundInTx(this.prisma, playerId, game.id);
    let rid = pending ? await this.roomIdFromRound(playerId, pending.id) : '';
    if (!rid && roomNo && this.flyDisk) {
      try {
        rid = await this.flyDisk.requireOpsRoomId(playerId, roomNo);
      } catch {
        rid = '';
      }
    }
    await this.prisma.$transaction(async (tx) => {
      await this.clearPendingGambleInTx(tx, playerId, game.id);
    });
    if (!rid) {
      const balance = await this.tryBalanceByRoomNo(playerId, roomNo);
      return balance == null ? { ok: true as const } : { ok: true as const, balance };
    }
    return { ok: true as const, balance: await this.balanceInRoom(playerId, rid) };
  }

  private async replayGambleIfAny(playerId: string, clientRequestId: string) {
    const bet = await this.settle.findSettledByClientRequestId(playerId, clientRequestId);
    if (!bet?.round?.outcome) return null;
    const o = bet.round.outcome as {
      choice?: 'big' | 'small';
      roll?: number;
      result?: 'win' | 'lose' | 'push';
      payout?: number;
      pendingGambleAmount?: number;
    };
    if (typeof o.roll !== 'number' || !o.choice || !o.result) return null;
    return {
      roll: o.roll,
      choice: o.choice,
      result: o.result,
      amount: bet.amount,
      payout: typeof o.payout === 'number' ? o.payout : bet.payout,
      pendingGambleAmount:
        typeof o.pendingGambleAmount === 'number' ? o.pendingGambleAmount : 0,
      balance: await this.balanceInRoom(playerId, this.flyRoomId(bet.payload)),
      roundId: bet.round.id,
      betId: bet.id,
      serverSeed: bet.round.serverSeed ?? '',
      serverSeedHash: bet.round.serverSeedHash ?? '',
    };
  }

  private async replayIfAny(playerId: string, clientRequestId: string) {
    const bet = await this.settle.findSettledByClientRequestId(playerId, clientRequestId);
    if (!bet?.round?.outcome) return null;
    const o = bet.round.outcome as unknown as FruitRoundOutcome;
    const roundBets = await this.prisma.bet.findMany({
      where: { roundId: bet.round.id },
      select: { betType: true, amount: true, payout: true },
    });
    const balance = await this.balanceInRoom(playerId, this.flyRoomId(bet.payload));
    const totalBet = roundBets.reduce((s, b) => s + asMoney(b.amount), 0);
    const totalPayout = o.totalPayout ?? roundBets.reduce((s, b) => s + asMoney(b.payout), 0);
    const planByPos = new Map((o.betPlan ?? []).map((p) => [p.position, p]));
    return {
      gameCode: bet.game.code,
      roundId: bet.round.id,
      awardType: o.awardType,
      stopIndex: o.stopIndex,
      hitIndexes: o.hitIndexes,
      wins: o.wins ?? [],
      bets: roundBets.map((b) => {
        const pos = b.betType ?? '';
        const plan = planByPos.get(pos);
        const payout = plan ? plan.payout : asMoney(b.payout);
        return {
          position: pos,
          amount: asMoney(b.amount),
          payout,
          won: payout > 0,
        };
      }),
      totalBet,
      totalWin: totalPayout,
      totalPayout,
      balance,
      serverSeed: bet.round.serverSeed ?? '',
      serverSeedHash: bet.round.serverSeedHash ?? '',
      awaitingReveal: !!o.awaitingReveal || bet.round.state === 'PLAYING',
    };
  }

  /** 揭晓该玩家所有仍 awaitingReveal 的水果局（进页 / 新开一局兜底） */
  private async settleAwaitingReveal(playerId: string) {
    const game = await this.configCache.get(GAME_CODE);
    if (!game) return;
    const rows = await this.prisma.gameRound.findMany({
      where: {
        playerId,
        gameId: game.id,
        state: 'PLAYING',
        category: 'ARCADE',
      },
      orderBy: { startedAt: 'asc' },
      take: 10,
      select: { id: true, outcome: true },
    });
    for (const row of rows) {
      const o = row.outcome as unknown as FruitRoundOutcome | null;
      if (o?.awaitingReveal) {
        await this.revealRoundIfNeeded(playerId, row.id);
      }
    }
  }

  private async revealRoundIfNeeded(playerId: string, roundId: string) {
    const round = await this.prisma.gameRound.findFirst({
      where: { id: roundId, playerId, category: 'ARCADE' },
      include: {
        game: { select: { id: true, name: true, code: true } },
        bets: { orderBy: { createdAt: 'asc' } },
      },
    });
    if (!round) throw new NotFoundException('局不存在');
    const outcome = round.outcome as unknown as FruitRoundOutcome | null;
    if (!outcome) throw new BadRequestException('局无开奖结果');

    if (round.state === 'SETTLED' && !outcome.awaitingReveal) {
      return {
        totalPayout: Math.max(0, outcome.totalPayout || 0),
        pendingGambleAmount: Math.max(0, outcome.pendingGambleAmount || 0),
      };
    }

    const planByPos = new Map((outcome.betPlan ?? []).map((p) => [p.position, p]));
    const paidTotal = Math.max(0, outcome.totalPayout || 0);
    const gameName = round.game.name;
    const gameCode = round.game.code || GAME_CODE;

    await this.prisma.$transaction(async (tx) => {
      /* 行锁：并发揭晓（多端同开）会让两笔事务都走到派彩分支。
         对齐彩票 issue / 牌桌 round 的做法，先锁局行再判状态。 */
      await tx.$queryRaw`SELECT id FROM "GameRound" WHERE "id" = ${roundId} FOR UPDATE`;
      const locked = await tx.gameRound.findUnique({
        where: { id: roundId },
        select: { state: true, outcome: true },
      });
      if (!locked) throw new NotFoundException('局不存在');
      const lockedOut = locked.outcome as unknown as FruitRoundOutcome | null;
      if (locked.state === 'SETTLED' && lockedOut && !lockedOut.awaitingReveal) return;

      /* 旧注单可能缺 bookMode：按房间补齐，保证信用/现金规则不串 */
      let houseForReveal: FlyHouse | undefined;
      const firstFly = (round.bets[0]?.payload as { fly?: FlyHouse } | null)?.fly;
      if (firstFly) {
        houseForReveal = { ...firstFly };
        if (!houseForReveal.bookMode && houseForReveal.roomId) {
          const room = await tx.room.findUnique({
            where: { id: houseForReveal.roomId },
            select: { bookMode: true },
          });
          if (room?.bookMode === 'CREDIT' || room?.bookMode === 'CASH') {
            houseForReveal.bookMode = room.bookMode;
          }
        }
      }

      for (const bet of round.bets) {
        /* round.bets 是事务外读的快照，这里的 status 可能已过期，只作快速跳过 */
        if (bet.status !== 'PENDING') continue;
        const pos = bet.betType || '';
        const plan = planByPos.get(pos);
        const amt = asMoney(bet.amount);
        const payout = plan ? plan.payout : 0;
        const mult = plan ? plan.mult : 0;

        /* 先 CAS 抢占注单再派彩：抢不到说明别的事务已结过，跳过不重复出账 */
        const claimed = await tx.bet.updateMany({
          where: { id: bet.id, status: 'PENDING' },
          data: {
            status: payout > 0 ? 'WON' : 'LOST',
            payout,
            multiplier: mult,
            odds: mult,
            validFlow: amt,
            settledAt: new Date(),
          },
        });
        if (claimed.count === 0) continue;

        await this.settle.creditWinInTx(tx, {
          playerId,
          roundId: round.id,
          betId: bet.id,
          amount: payout,
          remark: `${gameName} 命中 ${pos}`,
          keyPrefix: KEY,
          stake: amt,
          skipCap: true,
          house: houseForReveal,
          gameCode: GAME_CODE,
          /* 揭晓可能晚很久，按下注时定死的整包比例发放 */
          rateSnapshot: (
            bet.payload as { fly?: { agentPkg?: unknown; generalPkg?: unknown; P?: unknown } } | null
          )?.fly,
        });
      }

      const nextOutcome: FruitRoundOutcome = {
        ...outcome,
        awaitingReveal: false,
        pendingGambleAmount: paidTotal > 0 ? paidTotal : 0,
      };
      await tx.gameRound.update({
        where: { id: round.id },
        data: {
          state: 'SETTLED',
          endedAt: new Date(),
           
          outcome: nextOutcome as any,
        },
      });
    });

    try {
      if (this.control) await this.control.refreshGoalExhaustion(GAME_CODE);
    } catch {
      /* 不影响揭晓 */
    }

    const totalAmount = round.bets.reduce((s, b) => s + asMoney(b.amount), 0);
    if (paidTotal >= Math.max(totalAmount * 50, 100_000)) {
      await this.risk.record({
        type: 'BIG_WIN',
        level: paidTotal >= 1_000_000 ? 'CRITICAL' : 'WARN',
        targetId: playerId,
        fingerprint: `bw:${roundId}`,
        dedupeMs: 24 * 3600_000,
        detail: {
          playerId,
          totalAmount,
          totalPayout: paidTotal,
          gameCode,
          roundId,
          summary: `${gameCode} 派彩 ${paidTotal}（下注 ${totalAmount}）`,
        },
      });
    }

    return {
      totalPayout: paidTotal,
      pendingGambleAmount: paidTotal > 0 ? paidTotal : 0,
    };
  }

  /**
   * 当局赢分「大 / 小」再赌：点数 1–6 小、8–13 大、7 和（退回本金）。
   * 金额必须等于最近一局水果机未消耗的 pendingGambleAmount，禁止用任意余额再赌。
   * 开奖与主转同一套控奖：单人偏赢/偏输优先，否则房间留存。
   */
  async gamble(input: {
    playerId: string;
    amount: number;
    choice: 'big' | 'small';
    clientRequestId: string;
    roomNo?: string;
  }) {
    const { playerId, amount, choice } = input;
    const clientRequestId = this.settle.assertClientRequestId(input.clientRequestId);
    if (!Number.isInteger(amount) || amount < 1) {
      throw new BadRequestException('再赌金额无效');
    }
    if (choice !== 'big' && choice !== 'small') {
      throw new BadRequestException('请选择大或小');
    }

    const replay = await this.replayGambleIfAny(playerId, clientRequestId);
    if (replay) return replay;

    await this.settleAwaitingReveal(playerId);

    const game = await this.configCache.get(GAME_CODE);
    const config = game?.configs[0];
    if (!game || game.status !== 'ONLINE' || !config) {
      throw new NotFoundException('水果机未上线或未配置');
    }

    /* 再赌必须沿用主转注单 fly.roomId，禁止猜「最近房」 */
    const pendingSrc = await this.findPendingGambleRoundInTx(this.prisma, playerId, game.id);
    if (!pendingSrc) throw new BadRequestException('没有可再赌的当局赢分');
    const srcBet = await this.prisma.bet.findFirst({
      where: { roundId: pendingSrc.id, playerId },
      orderBy: { createdAt: 'asc' },
      select: { payload: true },
    });
    const snapRoomId = (srcBet?.payload as { fly?: { roomId?: string } } | null)?.fly?.roomId;
    if (!snapRoomId) {
      throw new BadRequestException('当局赢分缺少房间信息，请重新下注后再猜大小');
    }
    if (input.roomNo && this.flyDisk) {
      const fromNo = await this.flyDisk.requireOpsRoomId(playerId, input.roomNo);
      if (fromNo !== snapRoomId) {
        throw new BadRequestException('再赌须在原下注房间');
      }
    }
    const house = this.flyDisk
      ? await this.flyDisk.resolveHouse(playerId, snapRoomId, amount, { requireRoom: true })
      : { type: 'PLATFORM' as const, id: PLATFORM_OWNER_ID, flying: false as boolean, roomId: snapRoomId };
    const flyPayload = {
      type: house.type,
      id: house.id,
      flying: house.flying,
      roomId: house.roomId,
      agentUserId: house.agentUserId,
      generalUserId: house.generalUserId,
      sitting: house.sitting,
      bookMode: house.bookMode,
    };

    const globalRt = this.globalSoft
      ? await this.globalSoft.getArcadeDrawRuntime(GAME_CODE)
      : null;
    const clientSeed = `${playerId}:${clientRequestId}`;
    const softPick = pickSeedForArcadePool({
      runtime: globalRt,
      stake: amount,
      gen: () => {
        const g = genServerSeed();
        return { seed: g.seed, hash: g.hash };
      },
      simulate: (seed) => {
        const rnd = deriveRandom(seed, clientSeed, 1);
        const roll = 1 + Math.floor(rnd * 13); // 1..13
        let result: 'win' | 'lose' | 'push';
        if (roll === 7) result = 'push';
        else if (roll <= 6) result = choice === 'small' ? 'win' : 'lose';
        else result = choice === 'big' ? 'win' : 'lose';
        const rawBack = result === 'win'
          ? roundMoney(amount * 2)
          : result === 'push' ? amount : 0;
        const { win: payout, capped } = capWin(amount, rawBack);
        return { payout, roll, result, capped, rawBack };
      },
    });
    const {
      seed,
      hash,
      roll,
      result,
      payout: payoutBack,
      capped: gambleCapped,
      rawBack,
    } = softPick.result;
    if (gambleCapped) {
      log.error(`水果机再赌派彩触顶 amount=${amount} 原始=${rawBack} 封顶=${payoutBack}`);
    }

    const audit = await this.prisma.$transaction(async (tx) => {
      const source = await this.findPendingGambleRoundInTx(tx, playerId, game.id);
      if (!source) {
        throw new BadRequestException('没有可再赌的当局赢分');
      }
      const sourceOutcome = source.outcome as unknown as FruitRoundOutcome;
      if (amount !== sourceOutcome.pendingGambleAmount) {
        throw new BadRequestException(
          `再赌金额须等于当局赢分（${sourceOutcome.pendingGambleAmount}）`,
        );
      }

      // 条件占用：仅当 pending 仍等于当局赢分时清零，防并发双赌
      const claimed = await tx.$executeRaw`
        UPDATE "GameRound"
        SET outcome = jsonb_set(COALESCE(outcome, '{}'::jsonb), '{pendingGambleAmount}', '0'::jsonb, true)
        WHERE id = ${source.id}
          AND COALESCE((outcome->>'pendingGambleAmount')::int, 0) = ${amount}
      `;
      if (Number(claimed) === 0) {
        throw new BadRequestException('没有可再赌的当局赢分');
      }

      const round = await tx.gameRound.create({
        data: {
          roundNo: businessNo('FGR'),
          gameId: game.id,
          category: 'ARCADE',
          playerId,
          configVer: config.version,
          state: 'PLAYING',
          serverSeed: seed,
          serverSeedHash: hash,
          clientSeed,
          nonce: 1,
        },
      });
      /* 再赌是同一局里的第二次挑选，留痕另记一行 */
      if (softPick.steered && this.softAudit) {
        await this.softAudit.record({
          category: 'arcade',
          gameCode: GAME_CODE,
          refNo: `${round.roundNo}:gamble`,
          refId: round.id,
          reason: 'arcadePool',
          tries: softPick.tries,
          naturalDigest: `点${softPick.natural.roll} ${softPick.natural.result}`,
          adoptedDigest: `点${roll} ${result}`,
          stake: amount,
          estPayout: payoutBack,
        });
      }
      const bet = await tx.bet.create({
        data: {
          betNo: businessNo('FGB'),
          clientRequestId,
          playerId,
          gameId: game.id,
          roundId: round.id,
          betType: `GAMBLE_${choice.toUpperCase()}`,
          amount,
          status: 'PENDING',
          payload: { sourceRoundId: source.id, choice, roll, result, fly: flyPayload } as never,
        },
      });

      await this.settle.debitBetInTx(tx, {
        playerId,
        roundId: round.id,
        amount,
        gameName: `${game.name}大小再赌`,
        keyPrefix: `${KEY}_gamble`,
        house,
      });

      const { paid } = await this.settle.creditWinInTx(tx, {
        playerId,
        roundId: round.id,
        betId: bet.id,
        amount: payoutBack,
        remark: `水果机大小再赌 ${choice} 点数${roll}`,
        keyPrefix: `${KEY}_gamble`,
        stake: amount,
        skipCap: true,
        /* 猜大小仍是 0 边缘玩法：不刷流水返水/佣金 */
        skipFlowRebate: true,
        house,
      });

      await tx.bet.update({
        where: { id: bet.id },
        data: {
          status: result === 'lose' ? 'LOST' : 'WON',
          payout: paid,
          odds: paid / amount,
          multiplier: paid / amount,
          validFlow: 0,
          settledAt: new Date(),
          payload: {
            sourceRoundId: source.id,
            choice,
            roll,
            result,
            fly: flyPayload,
          } as never,
        },
      });
      await tx.gameRound.update({
        where: { id: round.id },
        data: {
          state: 'SETTLED',
          totalFlow: 0,
          endedAt: new Date(),
          outcome: {
            choice,
            roll,
            result,
            payout: paid,
            sourceRoundId: source.id,
            pendingGambleAmount: result === 'lose' ? 0 : paid,
          },
        },
      });
      // 赢/和：把可续赌金额写回源局，供下一次 gamble 绑定
      const pendingWrite = result === 'lose' ? 0 : paid;
      if (pendingWrite > 0) {
        await tx.gameRound.update({
          where: { id: source.id },
          data: {
             
            outcome: { ...sourceOutcome, pendingGambleAmount: pendingWrite } as any,
          },
        });
      }
      return { roundId: round.id, betId: bet.id, pendingGambleAmount: pendingWrite, payout: paid };
    });


    try {
      if (this.control) await this.control.refreshGoalExhaustion(GAME_CODE);
    } catch {
      /* 不影响再赌结果 */
    }

    return {
      roll,
      choice,
      result,
      amount,
      payout: audit.payout,
      pendingGambleAmount: audit.pendingGambleAmount,
      balance: await this.balanceInRoom(playerId, house.roomId),
      roundId: audit.roundId,
      betId: audit.betId,
      serverSeed: seed,
      serverSeedHash: hash,
    };
  }

  private async clearPendingGambleInTx(
    tx: Prisma.TransactionClient,
    playerId: string,
    gameId: string,
  ) {
    const pending = await this.findPendingGambleRoundInTx(tx, playerId, gameId);
    if (!pending) return;
    const outcome = pending.outcome as unknown as FruitRoundOutcome;
    await tx.gameRound.update({
      where: { id: pending.id },
      data: {
         
        outcome: { ...outcome, pendingGambleAmount: 0 } as any,
      },
    });
  }

  private async findPendingGambleRoundInTx(
    tx: Prisma.TransactionClient,
    playerId: string,
    gameId: string,
  ) {
    // 最近若干局内找仍有 pendingGambleAmount 的水果局（含续赌后写回源局）
    const recent = await tx.gameRound.findMany({
      where: {
        playerId,
        gameId,
        state: 'SETTLED',
        category: 'ARCADE',
      },
      orderBy: { endedAt: 'desc' },
      take: 20,
      select: { id: true, outcome: true, roundNo: true },
    });
    for (const row of recent) {
      const outcome = row.outcome as unknown as FruitRoundOutcome | null;
      if (
        outcome &&
        typeof outcome.pendingGambleAmount === 'number' &&
        outcome.pendingGambleAmount > 0 &&
        Array.isArray(outcome.hitIndexes)
      ) {
        return row;
      }
    }
    return null;
  }
}

function pickAwardType(
  weights: Record<FruitAwardType, number>,
  rnd: number,
): FruitAwardType {
  const list = FRUIT_AWARD_TYPES.map((t) => Math.max(0, weights[t] ?? 0));
  const idx = weightedPick(list, rnd);
  return FRUIT_AWARD_TYPES[idx];
}

function pickWeightedIndex(
  indexes: number[],
  weights: number[],
  random: () => number,
): number {
  if (indexes.length === 0) {
    throw new Error('pickWeightedIndex: 候选索引不能为空');
  }
  const w = indexes.map((i) => Math.max(0, weights[i] ?? 1));
  const pick = weightedPick(w, random());
  return indexes[pick];
}

/**
 * 开奖命中解析。random 每次调用消耗一个派生随机数，
 * 保证送灯多格、大三元多格都可被 seed+nonce 逐步复算。
 */
function resolveHits(
  awardType: FruitAwardType,
  random: () => number,
): { stopIndex: number; hitIndexes: number[] } {
  const luckIdx = fruitLuckIndexes();
  const nonLuck = fruitNonLuckIndexes();
  const cellWeights = FRUIT_RING.map((c) => Math.max(0, c.weight));

  if (awardType === 'luck_eat') {
    const stopIndex = pickWeightedIndex(luckIdx, cellWeights, random);
    return { stopIndex, hitIndexes: [] };
  }

  if (awardType === 'luck_send') {
    const stopIndex = pickWeightedIndex(luckIdx, cellWeights, random);
    const count = 1 + Math.floor(random() * 5); // 1~5
    const hits = pickDistinct(nonLuck, count, cellWeights, random);
    return { stopIndex, hitIndexes: hits };
  }

  if (awardType === 'train') {
    const start = pickWeightedIndex(nonLuck, cellWeights, random);
    const len = 4 + Math.floor(random() * 3); // 4~6
    const hits: number[] = [];
    for (let i = 0; i < len; i++) {
      const idx = (start + i) % FRUIT_RING.length;
      if (FRUIT_RING[idx].size !== 'luck') hits.push(idx);
    }
    return { stopIndex: start, hitIndexes: hits };
  }

  if (awardType === 'big3') {
    const hits = [
      pickOne(fruitBigIndexes('seven'), random),
      pickOne(fruitBigIndexes('star'), random),
      pickOne(fruitBigIndexes('melon'), random),
    ];
    return { stopIndex: hits[0], hitIndexes: hits };
  }

  if (awardType === 'small3') {
    const hits = [
      pickOne(fruitBigIndexes('bell'), random),
      pickOne(fruitBigIndexes('lemon'), random),
      pickOne(fruitBigIndexes('orange'), random),
    ];
    return { stopIndex: hits[0], hitIndexes: hits };
  }

  if (awardType === 'four') {
    const hits = fruitAppleIndexes();
    return { stopIndex: hits[0] ?? 0, hitIndexes: hits };
  }

  if (awardType === 'slam') {
    return { stopIndex: nonLuck[0] ?? 0, hitIndexes: [...nonLuck] };
  }

  // normal：只停非 LUCK 格（正版口径）。送灯/吃灯由独立奖型 luck_send / luck_eat 触发，
  // 禁止「普通奖碰巧停好运 → 白送 1~3 格」。
  const stopIndex = pickWeightedIndex(nonLuck, cellWeights, random);
  return { stopIndex, hitIndexes: [stopIndex] };
}

function pickOne(indexes: number[], random: () => number): number {
  if (indexes.length === 0) {
    throw new Error('pickOne: 候选索引不能为空');
  }
  return indexes[Math.floor(random() * indexes.length) % indexes.length];
}

/** 无放回加权抽样；每格独立消耗一次 random，避免旧 LCG 递推退化 */
function pickDistinct(
  pool: number[],
  count: number,
  weights: number[],
  random: () => number,
): number[] {
  const left = [...pool];
  const out: number[] = [];
  const n = Math.min(count, left.length);
  for (let i = 0; i < n; i++) {
    const w = left.map((idx) => Math.max(0, weights[idx] ?? 1));
    const pick = weightedPick(w, random());
    out.push(left[pick]);
    left.splice(pick, 1);
  }
  return out;
}

function settleWins(
  hitIndexes: number[],
  betMap: Record<FruitBetSymbolId, number>,
): FruitWinLine[] {
  const wins: FruitWinLine[] = [];
  for (const cellIndex of hitIndexes) {
    const cell = FRUIT_RING[cellIndex];
    if (!cell?.symbol || cell.mult <= 0) continue;
    const betAmt = betMap[cell.symbol] ?? 0;
    if (betAmt <= 0) continue;
    wins.push({
      symbol: cell.symbol,
      mult: cell.mult,
      amount: roundMoney(betAmt * cell.mult),
      cellIndex,
    });
  }
  return wins;
}

/** 将各格赢分按比例缩放到封顶后总额，保证 Σamount === paidTotal */
function scaleWinLinesToTotal(wins: FruitWinLine[], paidTotal: number): FruitWinLine[] {
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

/** 供前端展示用的静态赔率表（也写入 seed 注释） */
export function fruitBetPayRows() {
  return FRUIT_BET_SYMBOLS.map((s) => ({
    id: s.id,
    label: s.label,
    bigMult: s.bigMult,
    smallMult: s.smallMult,
  }));
}
