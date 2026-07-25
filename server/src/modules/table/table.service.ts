/**
 * TableService — 棋牌桌面状态机（Redis 多实例协调）
 *
 * 状态机循环：BETTING → DRAWING → SETTLED → BETTING
 * （各游戏下注/开奖/派奖时长见 table-rules.TABLE_TIMING）
 *
 * 协调策略：
 *   - Redis 保存相位 / phaseEndsAt / 种子承诺 / 展示汇总
 *   - 每房间 leader 锁保证仅一个实例推进相位
 *   - Pub/Sub 同步快照到各 Gateway 实例
 *   - DB 保持资金与注单权威；结算/退款使用 CAS
 */
import {
  Injectable,
  Logger,
  OnModuleInit,
  OnModuleDestroy,
  BadRequestException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { RedisService } from '../../redis/redis.service';
import { PointsService, PLATFORM_OWNER_ID } from '../points/points.service';
import { CommissionService } from '../agents/commission.service';
import { genServerSeed } from '../game-core/fairness.util';
import { businessNo } from '../game-core/business-id';
import type { TableBetPayload, TableSnapshot } from './table.types';
import {
  TABLE_BROADCAST_CHANNEL,
  roomKey,
  roomLeaderKey,
  secondsLeftOf,
  type RedisRoomState,
} from './table.redis-state';
import {
  allowedSides,
  alignedBettingEndsAt,
  alignedDrawEndsAt,
  alignedRoundNo,
  alignedSettleEndsAt,
  calcTablePayout,
  drawOutcome,
  maxTableCycleMs,
  normalizeGameCode,
  tableOutcomesMatch,
} from './table-rules';
import {
  oppositeHedgeSides,
  sideExposure,
  TABLE_RISK,
} from './table-risk';
import { createHash } from 'node:crypto';
import { capWin, getTablePayTable, tableSideMaxBet, tableTimingOf } from '@gamebox/shared';

/** 覆盖 settle + 最长 draw 窗口，transition 内还会续期 */
const LEADER_TTL_MS = 30_000;
const TICK_MS = 1_000;
/** 多实例周期性重新 SCAN 房间，避免启动后新建房无人接管 */
const DISCOVER_MS = 15_000;
/** 超过完整周期 + 缓冲仍 PLAYING 且 Redis 无活跃相位 → 孤儿退款 */
/** 覆盖最长整局 + 一倍缓冲，避免周期拉长后误判孤儿局 */
const ORPHAN_GRACE_MS = maxTableCycleMs() * 2;

@Injectable()
export class TableService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(TableService.name);
  private readonly instanceId = randomUUID();
  private readonly leading = new Set<string>();
  private broadcastFn: ((gameCode: string, snap: TableSnapshot) => void) | null = null;
  private tickTimer: ReturnType<typeof setInterval> | null = null;
  private discoverTimer: ReturnType<typeof setInterval> | null = null;
  private knownRooms = new Set<string>();

  constructor(
    private prisma: PrismaService,
    private redis: RedisService,
    private points: PointsService,
    private commission: CommissionService,
  ) {}

  async onModuleInit() {
    await this.redis.subscribe(TABLE_BROADCAST_CHANNEL, (message) => {
      try {
        const snap = JSON.parse(message) as TableSnapshot;
        this.broadcastFn?.(snap.gameCode, snap);
      } catch (err) {
        this.logger.warn(`忽略非法广播: ${err instanceof Error ? err.message : String(err)}`);
      }
    });

    await this.discoverRooms();
    await this.recoverOrphanRounds();

    this.tickTimer = setInterval(() => {
      void this.leaderTick();
    }, TICK_MS);
    /** 多实例下定期补发现启动后新建的房间，避免 leader 空档 */
    this.discoverTimer = setInterval(() => {
      void this.discoverRooms();
    }, DISCOVER_MS);
  }

  /** 从 Redis 恢复本实例需要竞选 leader 的房间列表 */
  private async discoverRooms() {
    let cursor = '0';
    do {
      const [next, keys] = await this.redis.raw.scan(cursor, 'MATCH', 'table:room:*', 'COUNT', 50);
      cursor = next;
      for (const key of keys) {
        if (key.endsWith(':leader')) continue;
        const gameCode = key.slice('table:room:'.length);
        if (gameCode && !gameCode.includes(':')) this.knownRooms.add(gameCode);
      }
    } while (cursor !== '0');
  }

  onModuleDestroy() {
    if (this.tickTimer) clearInterval(this.tickTimer);
    if (this.discoverTimer) clearInterval(this.discoverTimer);
    for (const gameCode of [...this.leading]) {
      void this.redis.releaseLock(roomLeaderKey(gameCode), this.instanceId);
    }
  }

  setBroadcast(fn: (gameCode: string, snap: TableSnapshot) => void) {
    this.broadcastFn = fn;
  }

  /**
   * 仅退款「无法从 Redis 恢复」的过期孤儿局。
   * 多实例下正常 PLAYING 局由 leader 接管，禁止启动时全量退款。
   */
  private async recoverOrphanRounds() {
    const cutoff = new Date(Date.now() - ORPHAN_GRACE_MS);
    const candidates = await this.prisma.gameRound.findMany({
      where: {
        category: 'TABLE',
        state: 'PLAYING',
        startedAt: { lt: cutoff },
      },
      select: { id: true, roundNo: true, game: { select: { code: true } } },
    });

    for (const round of candidates) {
      const gameCode = round.game.code;
      const room = await this.loadRoom(gameCode);
      if (room?.roundId === round.id && room.phaseEndsAt > Date.now() - ORPHAN_GRACE_MS) {
        continue;
      }
      this.logger.warn(`孤儿桌局退款 ${round.roundNo}`);
      await this.refundRound(round.id, '孤儿桌局超时，作废退款');
    }
  }

  private async refundRound(roundId: string, reason: string) {
    const pendingBets = await this.prisma.bet.findMany({
      where: { roundId, status: 'PENDING' },
    });
    if (pendingBets.length > 0) {
      await this.prisma.$transaction(async (tx) => {
        for (const bet of pendingBets) {
          const claimed = await tx.bet.updateMany({
            where: { id: bet.id, status: 'PENDING' },
            data: { status: 'CANCELLED', settledAt: new Date() },
          });
          if (claimed.count === 0) continue;
          await this.refundOneBetInTx(tx, bet, roundId, reason);
        }
      });
    }
    await this.prisma.gameRound.updateMany({
      where: { id: roundId, state: 'PLAYING' },
      data: { state: 'CANCELLED', endedAt: new Date() },
    });
  }

  async getOrCreateRoom(rawCode: string): Promise<RedisRoomState> {
    const gameCode = normalizeGameCode(rawCode);
    const existing = await this.loadRoom(gameCode);
    if (existing) {
      this.knownRooms.add(gameCode);
      return existing;
    }

    const game = await this.ensureTableGame(gameCode);
    if (!game || game.category !== 'TABLE' || game.status !== 'ONLINE') {
      throw new BadRequestException('桌面游戏不存在或未上线');
    }

    const raced = await this.loadRoom(gameCode);
    if (raced) {
      this.knownRooms.add(gameCode);
      return raced;
    }

    const { seed, hash } = genServerSeed();
    const now = Date.now();
    const room: RedisRoomState = {
      gameCode,
      gameId: game.id,
      gameName: game.name,
      minBet: Math.max(1, game.minBet || 1),
      maxBet: game.maxBet,
      roundId: null,
      roundNo: alignedRoundNo(gameCode, now),
      phase: 'BETTING',
      phaseEndsAt: alignedBettingEndsAt(gameCode, now),
      outcome: null,
      serverSeed: seed,
      serverSeedHash: hash,
      nonce: 1,
      betSummary: {},
      history: [],
      version: 0,
    };

    const created = await this.redis.raw.set(
      roomKey(gameCode),
      JSON.stringify(room),
      'NX',
    );
    if (created !== 'OK') {
      const again = await this.loadRoom(gameCode);
      if (again) {
        this.knownRooms.add(gameCode);
        return again;
      }
    }

    this.knownRooms.add(gameCode);
    await this.publishSnapshot(room);
    return room;
  }

  private async loadRoom(gameCode: string): Promise<RedisRoomState | null> {
    const raw = await this.redis.get(roomKey(gameCode));
    if (!raw) return null;
    try {
      const room = JSON.parse(raw) as RedisRoomState;
      if (typeof room.version !== 'number') room.version = 0;
      return room;
    } catch {
      return null;
    }
  }

  /** 无条件覆盖（仅用于 NX 创建后的兜底发布；正常推进用 saveRoomCas） */
  private async saveRoom(room: RedisRoomState): Promise<void> {
    if (typeof room.version !== 'number') room.version = 0;
    await this.redis.set(roomKey(room.gameCode), JSON.stringify(room));
  }

  /** 乐观锁写回；失败返回 false（调用方应放弃本轮 in-memory 变更） */
  private async saveRoomCas(room: RedisRoomState): Promise<boolean> {
    const expected = typeof room.version === 'number' ? room.version : 0;
    const next: RedisRoomState = { ...room, version: expected + 1 };
    const ok = await this.redis.compareAndSetRoom(
      roomKey(room.gameCode),
      expected,
      JSON.stringify(next),
    );
    if (ok) room.version = expected + 1;
    return ok;
  }

  /** transition / settle 期间持续续锁，避免 TTL 短于开奖 */
  private async withLeaderRenew<T>(gameCode: string, fn: () => Promise<T>): Promise<T> {
    const lockKey = roomLeaderKey(gameCode);
    const renew = () => this.redis.renewLock(lockKey, this.instanceId, LEADER_TTL_MS);
    await renew();
    const timer = setInterval(() => {
      void renew();
    }, Math.floor(LEADER_TTL_MS / 3));
    try {
      return await fn();
    } finally {
      clearInterval(timer);
    }
  }

  private async leaderTick() {
    for (const gameCode of this.knownRooms) {
      try {
        const lockKey = roomLeaderKey(gameCode);
        let isLeader = this.leading.has(gameCode);
        if (isLeader) {
          const renewed = await this.redis.renewLock(lockKey, this.instanceId, LEADER_TTL_MS);
          if (!renewed) {
            this.leading.delete(gameCode);
            isLeader = false;
          }
        }
        if (!isLeader) {
          const acquired = await this.redis.tryLock(lockKey, this.instanceId, LEADER_TTL_MS);
          if (!acquired) continue;
          this.leading.add(gameCode);
        }

        const room = await this.loadRoom(gameCode);
        if (!room) {
          this.knownRooms.delete(gameCode);
          this.leading.delete(gameCode);
          await this.redis.releaseLock(lockKey, this.instanceId);
          continue;
        }

        if (Date.now() >= room.phaseEndsAt) {
          await this.withLeaderRenew(gameCode, () => this.transition(room));
        } else {
          await this.publishSnapshot(room);
        }
      } catch (err) {
        this.logger.error(
          `leaderTick ${gameCode} 失败`,
          err instanceof Error ? err.stack : String(err),
        );
      }
    }
  }

  private async transition(room: RedisRoomState) {
    if (room.phase === 'BETTING') {
      room.phase = 'DRAWING';
      room.phaseEndsAt = alignedDrawEndsAt(room.gameCode);
      room.outcome = drawOutcome(room.gameCode, room.serverSeed, room.nonce);
      if (!(await this.saveRoomCas(room))) {
        this.logger.warn(`transition BETTING→DRAWING CAS 冲突 ${room.gameCode}`);
        return;
      }
      await this.settle(room);
      await this.publishSnapshot(room);
      return;
    }

    if (room.phase === 'DRAWING') {
      room.phase = 'SETTLED';
      room.phaseEndsAt = alignedSettleEndsAt(room.gameCode);
      if (!(await this.saveRoomCas(room))) {
        this.logger.warn(`transition DRAWING→SETTLED CAS 冲突 ${room.gameCode}`);
        return;
      }
      await this.publishSnapshot(room);
      return;
    }

    if (room.phase === 'SETTLED') {
      if (room.roundId) {
        const stragglers = await this.prisma.bet.count({
          where: { roundId: room.roundId, status: 'PENDING' },
        });
        if (stragglers > 0) {
          await this.refundRoundBetsOnly(room.roundId, '投注晚于封盘，退款');
        }
      }

      const { seed, hash } = genServerSeed();
      const now = Date.now();
      room.phase = 'BETTING';
      room.phaseEndsAt = alignedBettingEndsAt(room.gameCode, now);
      room.serverSeed = seed;
      room.serverSeedHash = hash;
      room.nonce += 1;
      room.roundNo = alignedRoundNo(room.gameCode, now);
      room.roundId = null;
      room.outcome = null;
      room.betSummary = {};
      if (!(await this.saveRoomCas(room))) {
        this.logger.warn(`transition SETTLED→BETTING CAS 冲突 ${room.gameCode}`);
        return;
      }
      await this.publishSnapshot(room);
    }
  }

  private async refundRoundBetsOnly(roundId: string, reason: string) {
    const pendingBets = await this.prisma.bet.findMany({
      where: { roundId, status: 'PENDING' },
    });
    await this.prisma.$transaction(async (tx) => {
      for (const bet of pendingBets) {
        const claimed = await tx.bet.updateMany({
          where: { id: bet.id, status: 'PENDING' },
          data: { status: 'CANCELLED', settledAt: new Date() },
        });
        if (claimed.count === 0) continue;
        await this.refundOneBetInTx(tx, bet, roundId, reason);
      }
    });
  }

  /** 单注退款：平台池 → 玩家（加锁顺序与派彩一致） */
  private async refundOneBetInTx(
    tx: Prisma.TransactionClient,
    bet: { id: string; playerId: string; amount: number },
    roundId: string,
    reason: string,
  ) {
    await this.points.transferInTx(
      tx,
      {
        type: 'PLATFORM',
        id: PLATFORM_OWNER_ID,
        remark: reason,
        idempotencyKey: `table_refund_plat_${bet.id}`,
      },
      {
        type: 'PLAYER',
        id: bet.playerId,
        remark: reason,
        idempotencyKey: `table_refund_player_${bet.id}`,
      },
      bet.amount,
      { bizType: 'ADJUST', refType: 'round', refId: roundId },
    );
  }

  /** Redis roundId 可能尚未补齐：按 roundNo 找回 PLAYING 局，避免封盘漏结算 */
  private async resolveRoundId(room: RedisRoomState): Promise<string | null> {
    if (room.roundId) return room.roundId;
    const gr = await this.prisma.gameRound.findUnique({
      where: { roundNo: room.roundNo },
      select: { id: true, state: true, gameId: true },
    });
    if (!gr || gr.gameId !== room.gameId || gr.state !== 'PLAYING') return null;
    room.roundId = gr.id;
    return gr.id;
  }

  private async settle(room: RedisRoomState) {
    const outcome = room.outcome;
    if (!outcome) return;
    const roundId = await this.resolveRoundId(room);
    if (!roundId) return;

    try {
      await this.prisma.$transaction(async (tx) => {
        const claimed = await tx.gameRound.updateMany({
          where: { id: roundId, state: 'PLAYING' },
          data: {
            state: 'SETTLED',
            endedAt: new Date(),
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            outcome: outcome as any,
            serverSeed: room.serverSeed,
          },
        });
        if (claimed.count === 0) return;

        // 认领后再读 PENDING，避免封盘瞬间迟到注单漏结算
        const bets = await tx.bet.findMany({
          where: { roundId, status: 'PENDING' },
        });
        const totalFlow = bets.reduce((s, b) => s + b.amount, 0);
        await tx.gameRound.update({
          where: { id: roundId },
          data: { totalFlow },
        });

        for (const bet of bets) {
          const raw = calcTablePayout(room.gameCode, bet.betType ?? '', outcome, bet.amount);
          const { win: payout, capped } = capWin(bet.amount, raw);
          if (capped) {
            this.logger.error(
              `派彩触顶 ${room.gameCode} bet=${bet.id} 原始=${raw} 封顶=${payout}`,
            );
          }
          const refundOnly = payout > 0 && payout === bet.amount;

          const betClaimed = await tx.bet.updateMany({
            where: { id: bet.id, status: 'PENDING' },
            data: {
              status: payout > 0 ? 'WON' : 'LOST',
              payout,
              odds: bet.amount > 0 ? payout / bet.amount : 0,
              /* 开和退本本金原路返回，不构成有效流水，不参与回水与分佣 */
              validFlow: refundOnly ? 0 : bet.amount,
              settledAt: new Date(),
            },
          });
          if (betClaimed.count === 0) continue;

          if (payout > 0) {
            const resultTag = String(outcome.result || outcome.winner || '');
            const tag = `${room.gameName} ${resultTag}${refundOnly ? ' 退本' : ''}`;
            await this.points.transferInTx(
              tx,
              {
                type: 'PLATFORM',
                id: PLATFORM_OWNER_ID,
                remark: `${tag} 派彩`,
                idempotencyKey: `table_win_plat_${bet.id}`,
              },
              {
                type: 'PLAYER',
                id: bet.playerId,
                remark: tag,
                idempotencyKey: `table_win_player_${bet.id}`,
              },
              payout,
              { bizType: 'WIN', refType: 'round', refId: roundId },
            );
          }

          /* 回水统一由 RebateService 按 Bet.validFlow 日结发放，此处不再局内发放 */

          const player = await tx.user.findUnique({
            where: { id: bet.playerId },
            select: { id: true, agentPath: true },
          });
          if (player?.agentPath && !refundOnly) {
            await this.commission.distributeInTx(
              tx,
              player,
              bet.amount,
              roundId,
              `table_${bet.id}`,
            );
          }
        }
      });

      room.history.unshift({
        roundNo: room.roundNo,
        outcome,
        createdAt: new Date().toISOString(),
        serverSeed: room.serverSeed,
        serverSeedHash: room.serverSeedHash,
        nonce: room.nonce,
      });
      if (room.history.length > 72) room.history.pop();
      if (!(await this.saveRoomCas(room))) {
        this.logger.warn(`settle 写 history CAS 冲突 ${room.gameCode} round=${roundId}`);
      }
    } catch (err) {
      this.logger.error(
        `结算失败 ${room.gameCode} round=${roundId}，尝试退款作废`,
        err instanceof Error ? err.stack : String(err),
      );
      try {
        await this.refundRound(roundId, '结算异常，本局作废退款');
      } catch (refundErr) {
        this.logger.error(
          `退款兜底也失败 round=${roundId}`,
          refundErr instanceof Error ? refundErr.stack : String(refundErr),
        );
      }
    }
  }

  /** 玩家下注：挂单扣分，封盘后整局结算 */
  async placeBet(playerId: string, payload: TableBetPayload) {
    const side = String(payload.side || '');
    const amount = payload.amount;
    const roomId = normalizeGameCode(payload.roomId);
    const clientKey = String(payload.clientKey || '')
      .trim()
      .slice(0, 64);
    const idemKey = clientKey ? `table:idem:${playerId}:${clientKey}` : '';

    if (idemKey) {
      const cached = await this.redis.get(idemKey);
      if (cached) {
        try {
          return JSON.parse(cached) as {
            roomId: string;
            side: string;
            amount: number;
            roundNo: string;
            balance: number;
            phase: string;
            secondsLeft: number;
          };
        } catch {
          /* 缓存坏了则重走下注 */
        }
      }
    }

    const room = await this.getOrCreateRoom(roomId);
    if (room.phase !== 'BETTING' || Date.now() >= room.phaseEndsAt) {
      throw new BadRequestException('当前不在下注阶段');
    }
    if (!allowedSides(room.gameCode).includes(side)) {
      throw new BadRequestException('投注方向无效');
    }
    /* 千倍赔率的低频边单独限红，避免单注击穿平台池 */
    const sideCap = tableSideMaxBet(room.gameCode, side, room.maxBet);
    if (!Number.isInteger(amount) || amount < room.minBet || amount > sideCap) {
      throw new BadRequestException(`下注额须在 ${room.minBet}~${sideCap} 之间`);
    }

    /* Redis 丢 roundId 时先按 roundNo 找回 */
    await this.resolveRoundId(room);

    const platformNext = sideExposure(room.betSummary, side) + amount;
    if (platformNext > TABLE_RISK.maxPlatformSideExposure) {
      this.logger.warn(
        `平台暴露超限 game=${room.gameCode} side=${side} next=${platformNext}`,
      );
      throw new BadRequestException('该方向投注已满，请稍后再试');
    }

    const oppSides = oppositeHedgeSides(room.gameCode, side);
    let roundId = room.roundId;
    try {
      await this.prisma.$transaction(async (tx) => {
        /* 1) 先落/锁住本局，再做对冲与单边上限（避免首注竞态绕过） */
        if (!roundId) {
          try {
            const created = await tx.gameRound.create({
              data: {
                roundNo: room.roundNo,
                gameId: room.gameId,
                category: 'TABLE',
                state: 'PLAYING',
                serverSeedHash: room.serverSeedHash,
                nonce: room.nonce,
              },
            });
            roundId = created.id;
          } catch (err) {
            if (
              !(err instanceof Prisma.PrismaClientKnownRequestError) ||
              err.code !== 'P2002'
            ) {
              throw err;
            }
            const existing = await tx.gameRound.findUnique({
              where: { roundNo: room.roundNo },
              select: { id: true, state: true },
            });
            if (!existing || existing.state !== 'PLAYING') {
              throw new BadRequestException('本局已封盘');
            }
            roundId = existing.id;
          }
        }

        await tx.$queryRaw`SELECT id FROM "GameRound" WHERE id = ${roundId} FOR UPDATE`;

        const live = await tx.gameRound.findUnique({
          where: { id: roundId! },
          select: { state: true },
        });
        if (!live || live.state !== 'PLAYING') {
          throw new BadRequestException('本局已封盘');
        }

        if (oppSides.length) {
          const hedged = await tx.bet.findFirst({
            where: {
              roundId: roundId!,
              playerId,
              status: 'PENDING',
              betType: { in: oppSides },
            },
            select: { id: true },
          });
          if (hedged) {
            throw new BadRequestException('同局不可对冲下注（庄闲/龙虎互斥）');
          }
        }

        const userSideAgg = await tx.bet.aggregate({
          where: {
            roundId: roundId!,
            playerId,
            status: 'PENDING',
            betType: side,
          },
          _sum: { amount: true },
        });
        const nextUserSide = (userSideAgg._sum.amount || 0) + amount;
        const userCap = Math.min(sideCap, TABLE_RISK.maxUserSidePerRound);
        if (nextUserSide > userCap) {
          throw new BadRequestException(`该方向本局累计不可超过 ${userCap}`);
        }

        const fresh = await this.loadRoom(roomId);
        if (!fresh || fresh.phase !== 'BETTING' || Date.now() >= fresh.phaseEndsAt) {
          throw new BadRequestException('当前不在下注阶段');
        }
        if (fresh.roundNo !== room.roundNo) {
          throw new BadRequestException('局号已切换，请重试');
        }

        const bet = await tx.bet.create({
          data: {
            betNo: businessNo('TB'),
            playerId,
            gameId: room.gameId,
            roundId: roundId!,
            betType: side,
            amount,
            status: 'PENDING',
          },
        });

        await this.points.transferInTx(
          tx,
          {
            type: 'PLAYER',
            id: playerId,
            remark: `${room.gameName}下注 ${side}`,
            idempotencyKey: `table_bet_player_${bet.id}`,
          },
          {
            type: 'PLATFORM',
            id: PLATFORM_OWNER_ID,
            remark: `${room.gameName} 注资 ${room.roundNo}`,
            idempotencyKey: `table_bet_plat_${bet.id}`,
          },
          amount,
          { bizType: 'BET', refType: 'round', refId: roundId! },
        );
      });
    } catch (err) {
      if (err instanceof BadRequestException) throw err;
      throw err;
    }

    const latest = (await this.loadRoom(roomId)) ?? room;
    const patch = await this.redis.patchTableBetSummary(
      roomKey(roomId),
      latest.roundNo,
      roundId || '',
      side,
      amount,
    );
    if (patch === 1) {
      const after = await this.loadRoom(roomId);
      if (after) await this.publishSnapshot(after);
    } else {
      this.logger.warn(
        `placeBet Redis patch 失败 code=${patch} room=${roomId} round=${latest.roundNo}`,
      );
      if (roundId && !latest.roundId) {
        latest.roundId = roundId;
        await this.saveRoomCas(latest).catch(() => undefined);
      }
    }

    const account = await this.prisma.pointsAccount.findUnique({
      where: { ownerId: playerId },
      select: { balance: true },
    });

    const snapRoom = (await this.loadRoom(roomId)) ?? latest;
    const result = {
      roomId,
      side,
      amount,
      roundNo: snapRoom.roundNo,
      balance: account?.balance ?? 0,
      phase: snapRoom.phase,
      secondsLeft: secondsLeftOf(snapRoom),
    };
    if (idemKey) {
      await this.redis.set(idemKey, JSON.stringify(result), 120).catch(() => undefined);
    }
    return result;
  }

  async snapshot(gameCode: string): Promise<TableSnapshot> {
    const room = await this.getOrCreateRoom(normalizeGameCode(gameCode));
    return this.buildSnapshot(room);
  }

  /** 当前玩家本局挂单汇总（前端动画用）；可按 roundNo 查已封盘局 */
  async myRoundBets(playerId: string, gameCode: string, roundNo?: string) {
    const code = normalizeGameCode(gameCode);
    let roundId: string | null = null;
    let resolvedRoundNo = roundNo || '';
    let phase = 'BETTING';

    if (roundNo) {
      const gr = await this.prisma.gameRound.findUnique({
        where: { roundNo },
        select: { id: true, roundNo: true, state: true },
      });
      if (gr) {
        roundId = gr.id;
        resolvedRoundNo = gr.roundNo;
        if (gr.state === 'PLAYING') {
          const room = await this.loadRoom(code);
          phase =
            room && room.roundNo === gr.roundNo
              ? room.phase
              : 'DRAWING';
        } else {
          phase = 'SETTLED';
        }
      }
    } else {
      const room = await this.getOrCreateRoom(code);
      roundId = room.roundId;
      resolvedRoundNo = room.roundNo;
      phase = room.phase;
    }

    if (!roundId) {
      return {
        roundNo: resolvedRoundNo,
        phase,
        bets: [],
        totalPayout: 0,
        totalStake: 0,
      };
    }
    const bets = await this.prisma.bet.findMany({
      where: { roundId, playerId },
      select: {
        betType: true,
        amount: true,
        payout: true,
        status: true,
      },
    });
    return {
      roundNo: resolvedRoundNo,
      phase,
      bets,
      totalPayout: bets.reduce((s, b) => s + (b.payout || 0), 0),
      totalStake: bets.reduce((s, b) => s + (b.amount || 0), 0),
    };
  }

  private buildSnapshot(room: RedisRoomState): TableSnapshot {
    const sealed = room.phase === 'DRAWING' || room.phase === 'SETTLED';
    const timing = tableTimingOf(room.gameCode);
    return {
      roomId: room.gameCode,
      gameCode: room.gameCode,
      phase: room.phase,
      roundNo: room.roundNo,
      secondsLeft: secondsLeftOf(room),
      outcome: room.outcome ?? undefined,
      betSummary: { ...room.betSummary },
      history: room.history.slice(0, 72),
      serverSeedHash: room.serverSeedHash,
      nonce: room.nonce,
      serverSeed: sealed ? room.serverSeed : undefined,
      timing: {
        bettingMs: timing.bettingMs,
        drawMs: timing.drawMs,
        settleMs: timing.settleMs,
        cycleMs: timing.cycleMs,
      },
    };
  }

  /** 赔率表（与 @gamebox/shared 同源） */
  payTable(gameCode: string) {
    const code = normalizeGameCode(gameCode);
    const pt = getTablePayTable(code);
    if (!pt) throw new BadRequestException('桌面游戏不存在');
    return { gameCode: code, ...pt };
  }

  /**
   * 可证明公平核验：
   * - 当前局下注期：只返回 hash 承诺
   * - 封盘后 / 历史局：返回 seed+nonce，并校验 hash(seed)===hash
   */
  async verify(gameCode: string, roundNo?: string) {
    const code = normalizeGameCode(gameCode);
    const room = await this.getOrCreateRoom(code);

    if (roundNo && roundNo !== room.roundNo) {
      const hit = room.history.find((h) => h.roundNo === roundNo);
      if (hit?.serverSeed != null && hit.nonce != null) {
        const hash = createHash('sha256').update(hit.serverSeed).digest('hex');
        const expectedHash = hit.serverSeedHash || hash;
        let outcomeMatches: boolean | null = null;
        try {
          const recomputed = drawOutcome(code, hit.serverSeed, hit.nonce);
          outcomeMatches = tableOutcomesMatch(code, recomputed, hit.outcome);
        } catch {
          outcomeMatches = null;
        }
        return {
          gameCode: code,
          roundNo,
          phase: 'SETTLED' as const,
          serverSeedHash: expectedHash,
          serverSeed: hit.serverSeed,
          nonce: hit.nonce,
          outcome: hit.outcome,
          hashMatches: hash === expectedHash,
          outcomeMatches,
        };
      }

      const gr = await this.prisma.gameRound.findUnique({
        where: { roundNo },
        select: {
          roundNo: true,
          state: true,
          serverSeed: true,
          serverSeedHash: true,
          nonce: true,
          outcome: true,
          game: { select: { code: true } },
        },
      });
      if (!gr || normalizeGameCode(gr.game.code) !== code) {
        throw new BadRequestException('局号不存在');
      }
      const seed = gr.serverSeed || undefined;
      const hash = seed ? createHash('sha256').update(seed).digest('hex') : null;
      let outcomeMatches: boolean | null = null;
      const stored = (gr.outcome as Record<string, unknown>) || undefined;
      if (seed != null && gr.nonce != null && stored) {
        try {
          outcomeMatches = tableOutcomesMatch(
            code,
            drawOutcome(code, seed, gr.nonce),
            stored,
          );
        } catch {
          outcomeMatches = null;
        }
      }
      return {
        gameCode: code,
        roundNo: gr.roundNo,
        phase: gr.state === 'PLAYING' ? 'DRAWING' : 'SETTLED',
        serverSeedHash: gr.serverSeedHash || hash || '',
        serverSeed: seed,
        nonce: gr.nonce ?? undefined,
        outcome: stored,
        hashMatches: seed && gr.serverSeedHash ? hash === gr.serverSeedHash : null,
        outcomeMatches,
      };
    }

    const sealed = room.phase === 'DRAWING' || room.phase === 'SETTLED';
    const hashOk = sealed
      ? createHash('sha256').update(room.serverSeed).digest('hex') ===
        room.serverSeedHash
      : null;
    let outcomeMatches: boolean | null = null;
    if (sealed && room.outcome) {
      try {
        outcomeMatches = tableOutcomesMatch(
          code,
          drawOutcome(code, room.serverSeed, room.nonce),
          room.outcome,
        );
      } catch {
        outcomeMatches = null;
      }
    }
    return {
      gameCode: code,
      roundNo: room.roundNo,
      phase: room.phase,
      serverSeedHash: room.serverSeedHash,
      serverSeed: sealed ? room.serverSeed : undefined,
      nonce: room.nonce,
      outcome: sealed ? room.outcome ?? undefined : undefined,
      hashMatches: hashOk,
      outcomeMatches,
    };
  }

  private async publishSnapshot(room: RedisRoomState) {
    const snap = this.buildSnapshot(room);
    this.broadcastFn?.(room.gameCode, snap);
    await this.redis.publish(TABLE_BROADCAST_CHANNEL, JSON.stringify(snap));
  }

  private async ensureTableGame(code: string) {
    const names: Record<string, string> = {
      'dragon-tiger': '龙虎斗',
      baccarat: '百家乐',
      zhajinhua: '炸金花',
      douniu: '斗牛',
    };
    let game = await this.prisma.game.findUnique({ where: { code } });
    if (!game && names[code]) {
      const pt = getTablePayTable(code);
      game = await this.prisma.game.create({
        data: {
          code,
          name: names[code],
          category: 'TABLE',
          status: 'ONLINE',
          minBet: 1,
          maxBet: 1_000_000,
          configs: {
            create: {
              version: 1,
              active: true,
              // 展示用；真结算仍读 @gamebox/shared
              payTable: (pt ?? {}) as object,
              rtp: 0.97,
            },
          },
        },
      });
    }
    return game;
  }
}
