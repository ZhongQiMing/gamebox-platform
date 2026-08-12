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
  Optional,
  Inject,
  forwardRef,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { RedisService } from '../../redis/redis.service';
import { PointsService, PLATFORM_OWNER_ID, type OwnerType } from '../points/points.service';
import { CommissionService } from '../agents/commission.service';
import { GameConfigCache } from '../game-core/game-config.cache';
import { genServerSeed } from '../game-core/fairness.util';
import { businessNo } from '../game-core/business-id';
import type { TableBetPayload, TableSnapshot } from './table.types';
import {
  TABLE_BROADCAST_CHANNEL,
  roomKey,
  roomLeaderKey,
  secondsLeftOf,
  normalizeRoomHistory,
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
  equivalentBetSides,
  oppositeHedgeSides,
  sideExposure,
  TABLE_RISK,
} from './table-risk';
import { RiskDetectorService } from '../risk/risk-detector.service';
import { RiskService } from '../risk/risk.service';
import { createHash } from 'node:crypto';
import {
  capWin,
  asMoney,
  getTablePayTable,
  isValidMoney,
  roundMoney,
  shanghaiDayOf,
  tableSideMaxBet,
  tableTimingOf,
} from '@gamebox/shared';
import type { TableHistoryItem } from './table.types';
import { ConsoleControlService } from '../console/console-control.service';
import { GlobalSoftControlService } from '../console/global-soft-control.service';
import { FlyDiskService } from '../console/fly-disk.service';
import { FlyRebateService } from '../console/fly-rebate.service';
import {
  closedDiskDebitBetInTx,
  closedDiskRefundBetInTx,
  closedDiskSettleWinInTx,
} from '../console/player-fund.helper';
import {
  CONTROL_PLAYER_WIN_HOUSE_FLOOR,
} from '../console/control.constants';
import {
  decidePeriodGuard,
  globalDayNetScore,
  isBetterSoftGlobalPick,
  periodCandidateLegal,
  periodLossScore,
  softBiasScore,
  type SoftPickRank,
} from '../console/control-pick.util';
import type { TableOutcome } from './table-rules';

type BetFlyMeta = {
  type: OwnerType;
  id: string;
  flying: boolean;
  roomId?: string;
  agentUserId?: string;
  bookMode?: string;
};

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
    private configCache: GameConfigCache,
    private riskDetector: RiskDetectorService,
    private risk: RiskService,
    @Optional() @Inject(forwardRef(() => ConsoleControlService))
    private control?: ConsoleControlService,
    @Optional() @Inject(forwardRef(() => GlobalSoftControlService))
    private globalSoft?: GlobalSoftControlService,
    @Optional() private flyDisk?: FlyDiskService,
    @Optional() private flyRebate?: FlyRebateService,
  ) {}

  /** 注单 payload 上的飞盘对手盘；缺省回退平台池 */
  private flyFromBet(bet: { payload?: unknown }): BetFlyMeta {
    const fly = (bet.payload as { fly?: Partial<BetFlyMeta> } | null)?.fly;
    return {
      type: (fly?.type as OwnerType) || 'PLATFORM',
      id: fly?.id || PLATFORM_OWNER_ID,
      flying: !!fly?.flying,
      roomId: fly?.roomId,
      agentUserId: fly?.agentUserId,
      bookMode: fly?.bookMode,
    };
  }

  /**
   * 派彩/退款用的真实对手盘。
   * 修复前下注写死 PLATFORM（幂等键 table_bet_plat_*），即使 payload.fly 写了 ROOM/AGENT，
   * 钱仍在平台池——必须原路退/派，且不再动上盘额度。
   */
  private async resolveBetHouseInTx(
    tx: Prisma.TransactionClient,
    bet: { id: string; payload?: unknown },
  ): Promise<BetFlyMeta> {
    const legacy = await tx.pointsLedger.findUnique({
      where: { idempotencyKey: `table_bet_plat_${bet.id}` },
      select: { id: true },
    });
    if (legacy) {
      return { type: 'PLATFORM', id: PLATFORM_OWNER_ID, flying: false };
    }
    return this.flyFromBet(bet);
  }

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
    /* 炸金花：启动即建房开跑，无人进房也持续开奖并记路单 */
    try {
      await this.getOrCreateRoom('zhajinhua');
    } catch (err) {
      this.logger.warn(
        `预热炸金花房间失败: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

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
          await this.refundOneBetInTx(tx, { ...bet, amount: asMoney(bet.amount) }, roundId, reason);
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
      minBet: Math.max(1, asMoney(game.minBet) || 1),
      maxBet: asMoney(game.maxBet),
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
      normalizeRoomHistory(room);
      room.history = this.pruneHistoryToShanghaiDay(room.history);
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

        /* 维护暂停：上架后自动开新局；维护中不推进 */
        if (room.phase === 'PAUSED') {
          const gameCfg = await this.configCache.get(gameCode);
          if (gameCfg?.status === 'ONLINE') {
            await this.withLeaderRenew(gameCode, () => this.resumeFromPaused(room));
          } else {
            await this.publishSnapshot(room);
          }
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

  /** 维护结束：从 PAUSED 开新 BETTING 局 */
  private async resumeFromPaused(room: RedisRoomState) {
    if (room.phase !== 'PAUSED') return;
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
      this.logger.warn(`resume PAUSED→BETTING CAS 冲突 ${room.gameCode}`);
      return;
    }
    this.logger.log(`桌台维护结束恢复开局 ${room.gameCode}`);
    await this.publishSnapshot(room);
  }

  private async transition(room: RedisRoomState) {
    if (room.phase === 'BETTING') {
      room.phase = 'DRAWING';
      room.phaseEndsAt = alignedDrawEndsAt(room.gameCode);
      const picked = await this.pickTableOutcomeWithControl(room);
      room.nonce = picked.nonce;
      room.outcome = picked.outcome;
      if (!(await this.saveRoomCas(room))) {
        this.logger.warn(`transition BETTING→DRAWING CAS 冲突 ${room.gameCode}`);
        return;
      }
      try {
        if (this.globalSoft) {
          await this.globalSoft.commitSoftDraw(room.gameCode, picked.softCommit);
        }
      } catch {
        /* 冷却失败不影响开奖 */
      }
      const settleTouches = await this.settle(room);
      await this.publishSnapshot(room);
      try {
        if (this.control) await this.control.refreshGoalExhaustion(room.gameCode);
      } catch {
        /* 不影响开奖 */
      }
      try {
        if (this.globalSoft && settleTouches.length) {
          await this.globalSoft.applySoftBiasProgress(settleTouches);
        }
      } catch {
        /* 不影响开奖 */
      }
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

      /* 维护中：本局已结算完，暂停开新局，勿踢掉结算、勿开新 BETTING */
      const gameCfg = await this.configCache.get(room.gameCode);
      if (!gameCfg || gameCfg.status !== 'ONLINE') {
        room.phase = 'PAUSED';
        room.phaseEndsAt = Date.now() + 365 * 24 * 3600 * 1000;
        room.roundId = null;
        room.outcome = null;
        room.betSummary = {};
        if (!(await this.saveRoomCas(room))) {
          this.logger.warn(`transition SETTLED→PAUSED CAS 冲突 ${room.gameCode}`);
          return;
        }
        this.logger.log(`桌台维护暂停开局 ${room.gameCode}`);
        await this.publishSnapshot(room);
        return;
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
        await this.refundOneBetInTx(tx, { ...bet, amount: asMoney(bet.amount) }, roundId, reason);
      }
    });
  }

  /** 单注退款：飞盘原路退平台；关盘从代理退回 */
  private async refundOneBetInTx(
    tx: Prisma.TransactionClient,
    bet: { id: string; playerId: string; amount: number; payload?: unknown },
    roundId: string,
    reason: string,
  ) {
    const house = await this.resolveBetHouseInTx(tx, bet);
    const amt = asMoney(bet.amount);
    if (house.flying || house.type !== 'AGENT') {
      const refundRoomId = String(house.roomId || '').trim();
      if (!refundRoomId) throw new BadRequestException('退注缺少房间');
      await this.points.transferInTx(
        tx,
        {
          type: 'PLATFORM',
          id: PLATFORM_OWNER_ID,
          remark: reason,
          idempotencyKey: `table_refund_house_${bet.id}`,
        },
        {
          type: 'PLAYER',
          id: bet.playerId,
          roomId: refundRoomId,
          remark: reason,
          idempotencyKey: `table_refund_player_${bet.id}`,
        },
        amt,
        { bizType: 'ADJUST', refType: 'round', refId: roundId },
      );
    } else {
      await closedDiskRefundBetInTx(tx, this.points, {
        playerId: bet.playerId,
        agentUserId: house.agentUserId || house.id,
        roomId: house.roomId,
        bookMode: house.bookMode,
        amount: amt,
        remark: `${reason}(关盘)`,
        refType: 'round',
        refId: roundId,
        idemPlayer: `table_refund_player_${bet.id}`,
        idemAgent: `table_refund_agent_${bet.id}`,
      });
    }
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

  /** 当日路单：有注/无注都落 Redis history（空局此前会跳过，导致进房才开始有路） */
  private async appendRoadHistory(room: RedisRoomState, outcome: NonNullable<RedisRoomState['outcome']>) {
    const roundNo = String(room.roundNo || '');
    if (roundNo && room.history.some((h) => String(h.roundNo) === roundNo)) {
      return;
    }
    room.history.unshift({
      roundNo: room.roundNo,
      outcome,
      createdAt: new Date().toISOString(),
      serverSeed: room.serverSeed,
      serverSeedHash: room.serverSeedHash,
      nonce: room.nonce,
    });
    room.history = this.pruneHistoryToShanghaiDay(room.history);
    if (!(await this.saveRoomCas(room))) {
      this.logger.warn(`写 history CAS 冲突 ${room.gameCode} round=${room.roundNo}`);
    }
  }

  private async settle(room: RedisRoomState): Promise<
    Array<{ roomId: string; playerId: string; stake: number; payout: number }>
  > {
    const empty: Array<{ roomId: string; playerId: string; stake: number; payout: number }> = [];
    const outcome = room.outcome;
    if (!outcome) return empty;
    const roundId = await this.resolveRoundId(room);
    if (!roundId) {
      /* 炸金花：无人下注的空局也记路单（其它桌面游戏仍按原逻辑跳过） */
      if (normalizeGameCode(room.gameCode) === 'zhajinhua') {
        await this.appendRoadHistory(room, outcome);
      }
      return empty;
    }

    const bigWins: Array<{ betId: string; playerId: string; amount: number; payout: number }> = [];
    const biasTouches: Array<{ roomId: string; playerId: string; stake: number; payout: number }> = [];
    try {
      await this.prisma.$transaction(async (tx) => {
        const claimed = await tx.gameRound.updateMany({
          where: { id: roundId, state: 'PLAYING' },
          data: {
            state: 'SETTLED',
            endedAt: new Date(),
             
            outcome: outcome as any,
            serverSeed: room.serverSeed,
            nonce: room.nonce,
          },
        });
        if (claimed.count === 0) return;

        // 认领后再读 PENDING，避免封盘瞬间迟到注单漏结算
        const bets = await tx.bet.findMany({
          where: { roundId, status: 'PENDING' },
        });
        const totalFlow = bets.reduce((s, b) => s + asMoney(b.amount), 0);
        await tx.gameRound.update({
          where: { id: roundId },
          data: { totalFlow },
        });

        for (const bet of bets) {
          const amt = asMoney(bet.amount);
          const raw = calcTablePayout(room.gameCode, bet.betType ?? '', outcome, amt);
          const { win: payout, capped } = capWin(amt, raw);
          if (capped) {
            this.logger.error(
              `派彩触顶 ${room.gameCode} bet=${bet.id} 原始=${raw} 封顶=${payout}`,
            );
          }
          const refundOnly = payout > 0 && payout === amt;

          const betClaimed = await tx.bet.updateMany({
            where: { id: bet.id, status: 'PENDING' },
            data: {
              status: payout > 0 ? 'WON' : 'LOST',
              payout,
              odds: amt > 0 ? payout / amt : 0,
              /* 开和退本本金原路返回，不构成有效流水，不参与回水与分佣 */
              validFlow: refundOnly ? 0 : amt,
              settledAt: new Date(),
            },
          });
          if (betClaimed.count === 0) continue;

          if (!refundOnly && payout >= Math.max(amt * 50, 100_000)) {
            bigWins.push({ betId: bet.id, playerId: bet.playerId, amount: amt, payout });
          }

          const house = await this.resolveBetHouseInTx(tx, bet);
          const touchRoomId = String(house.roomId || '').trim();
          if (touchRoomId && !refundOnly) {
            biasTouches.push({
              roomId: touchRoomId,
              playerId: bet.playerId,
              stake: amt,
              payout,
            });
          }

          const resultTag = String(outcome.result || outcome.winner || '');
          const tag = `${room.gameName} ${resultTag}${refundOnly ? ' 退本' : ''}`;
          if (house.flying || house.type !== 'AGENT') {
            if (payout > 0) {
              const winRoomId = String(house.roomId || '').trim();
              if (!winRoomId) throw new BadRequestException('派彩缺少房间');
              await this.points.transferInTx(
                tx,
                {
                  type: 'PLATFORM',
                  id: PLATFORM_OWNER_ID,
                  remark: `${tag} 派彩`,
                  idempotencyKey: `table_win_house_${bet.id}`,
                },
                {
                  type: 'PLAYER',
                  id: bet.playerId,
                  roomId: winRoomId,
                  remark: tag,
                  idempotencyKey: `table_win_player_${bet.id}`,
                },
                payout,
                { bizType: 'WIN', refType: 'round', refId: roundId },
              );
            }
          } else {
            await closedDiskSettleWinInTx(tx, this.points, {
              playerId: bet.playerId,
              agentUserId: house.agentUserId || house.id,
              roomId: house.roomId,
              bookMode: house.bookMode,
              stake: amt,
              payout,
              remark: `${tag}(关盘)`,
              refType: 'round',
              refId: roundId,
              idemPlayer: `table_win_player_${bet.id}`,
              idemAgent: `table_win_agent_${bet.id}`,
            });
          }

          if (!refundOnly) {
            if (house.flying && this.flyDisk) {
              await this.flyDisk.applyFlyLossInTx(
                tx,
                house.agentUserId,
                true,
                amt,
                payout,
                `table_fly_quota_${bet.id}`,
                house.bookMode,
              );
            }
            if (this.flyRebate) {
              await this.flyRebate.payBetFlowInTx(tx, {
                betId: bet.id,
                playerId: bet.playerId,
                validFlow: amt,
                flying: house.flying,
                roomId: house.roomId,
                agentUserId: house.agentUserId,
                bookMode: house.bookMode,
                roundId,
              });
            }
          }
        }
      });
    } catch (err) {
      this.logger.error(
        `结算事务失败 ${room.gameCode} round=${roundId}，尝试退款作废`,
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
      return empty;
    }

    /* 走到这里说明结算事务已提交（catch 分支一律 return）：
       之后的路单/风控失败不得再触发整局退款 */
    try {
      await this.appendRoadHistory(room, outcome);
    } catch (err) {
      this.logger.error(
        `写路单失败 ${room.gameCode} round=${roundId}`,
        err instanceof Error ? err.stack : String(err),
      );
    }
    for (const w of bigWins) {
      try {
        await this.risk.record({
          type: 'BIG_WIN',
          level: w.payout >= 1_000_000 ? 'CRITICAL' : 'WARN',
          targetId: w.playerId,
          fingerprint: `bw:table:${w.betId}`,
          dedupeMs: 24 * 3600_000,
          detail: {
            playerId: w.playerId,
            totalAmount: w.amount,
            totalPayout: w.payout,
            gameCode: room.gameCode,
            roundId,
            betId: w.betId,
            summary: `${room.gameCode} 派彩 ${w.payout}（下注 ${w.amount}）`,
          },
        });
      } catch (err) {
        this.logger.warn(
          `大额中奖风控记录失败 bet=${w.betId}`,
          err instanceof Error ? err.message : String(err),
        );
      }
    }
    return biasTouches;
  }

  /** 牌桌下注结果（含幂等重放） */
  private async buildTableBetResult(
    playerId: string,
    roomId: string,
    side: string,
    amount: number,
    roundNo: string,
    phase: string,
    secondsLeft: number,
    opsRoomId?: string,
  ) {
    const rid = String(opsRoomId || '').trim();
    const balance = rid
      ? await this.points.getPlayerBalance(playerId, rid)
      : 0;
    return {
      roomId,
      side,
      amount,
      roundNo,
      balance,
      phase,
      secondsLeft,
    };
  }

  /** 按已落库注单重放（DB 级幂等） */
  private async replayTableBet(
    playerId: string,
    roomId: string,
    bet: {
      playerId: string;
      betType: string | null;
      amount: unknown;
      roundId: string | null;
      payload?: unknown;
    },
    expectSide: string,
    expectAmount: number,
  ) {
    if (bet.playerId !== playerId) {
      throw new BadRequestException('clientKey 已被占用');
    }
    if (String(bet.betType || '') !== expectSide || asMoney(bet.amount) !== expectAmount) {
      throw new BadRequestException('clientKey 已被占用');
    }
    const room = (await this.loadRoom(roomId)) ?? (await this.getOrCreateRoom(roomId));
    let roundNo = room.roundNo;
    if (bet.roundId) {
      const round = await this.prisma.gameRound.findUnique({
        where: { id: bet.roundId },
        select: { roundNo: true },
      });
      if (round?.roundNo) roundNo = round.roundNo;
    }
    const opsRoomId = (bet.payload as { fly?: { roomId?: string } } | null)?.fly?.roomId;
    return this.buildTableBetResult(
      playerId,
      roomId,
      expectSide,
      expectAmount,
      roundNo,
      room.phase,
      secondsLeftOf(room),
      opsRoomId,
    );
  }

  /**
   * 首注并发建局：ON CONFLICT 不会让事务进入 aborted 状态，随后可在同一事务继续锁行和下注。
   */
  private async ensurePlayingRoundInTx(
    tx: Prisma.TransactionClient,
    room: { roundNo: string; gameId: string; serverSeedHash: string },
  ): Promise<string> {
    const inserted = await tx.$queryRaw<{ id: string; state: string }[]>`
      INSERT INTO "GameRound"
        ("id", "roundNo", "gameId", "category", "state", "serverSeedHash", "nonce")
      VALUES
        (${randomUUID()}, ${room.roundNo}, ${room.gameId}, 'TABLE'::"GameCategory",
         'PLAYING', ${room.serverSeedHash}, 0)
      ON CONFLICT ("roundNo") DO NOTHING
      RETURNING "id", "state"
    `;
    const currentRound =
      inserted[0] ??
      (await tx.gameRound.findUnique({
        where: { roundNo: room.roundNo },
        select: { id: true, state: true },
      }));
    if (!currentRound || currentRound.state !== 'PLAYING') {
      throw new BadRequestException('本局已封盘');
    }
    return currentRound.id;
  }

  /** 同一逻辑供平台全局与玩家单边累计复用；龙虎大小写 alias 视为同方向。 */
  private async pendingSideExposureInTx(
    tx: Prisma.TransactionClient,
    gameCode: string,
    roundId: string,
    side: string,
    playerId?: string,
  ): Promise<number> {
    const aggregate = await tx.bet.aggregate({
      where: {
        roundId,
        ...(playerId ? { playerId } : {}),
        status: 'PENDING',
        betType: { in: equivalentBetSides(gameCode, side) },
      },
      _sum: { amount: true },
    });
    return asMoney(aggregate._sum.amount || 0);
  }

  /** 玩家下注：挂单扣分，封盘后整局结算 */
  async placeBet(playerId: string, payload: TableBetPayload) {
    const side = String(payload.side || '');
    const amount = payload.amount;
    const roomId = normalizeGameCode(payload.roomId);
    const clientKey = String(payload.clientKey || '').trim();
    if (clientKey.length < 8 || clientKey.length > 64) {
      throw new BadRequestException('clientKey 无效');
    }
    /* DB 唯一键：与彩票/街机 clientRequestId 同列，加 tb: 前缀隔离 */
    const clientRequestId = `tb:${clientKey}`;
    const idemKey = `table:idem:${playerId}:${clientKey}`;

    const cached = await this.redis.get(idemKey);
    if (cached) {
      try {
        return JSON.parse(cached) as Awaited<ReturnType<TableService['buildTableBetResult']>>;
      } catch {
        /* 缓存坏了则走 DB / 新下 */
      }
    }

    const existing = await this.prisma.bet.findUnique({
      where: { clientRequestId },
      select: {
        playerId: true,
        betType: true,
        amount: true,
        roundId: true,
        payload: true,
      },
    });
    if (existing) {
      const replayed = await this.replayTableBet(playerId, roomId, existing, side, amount);
      await this.redis.set(idemKey, JSON.stringify(replayed), 120).catch(() => undefined);
      return replayed;
    }

    const room = await this.getOrCreateRoom(roomId);
    if (room.phase === 'PAUSED') {
      throw new BadRequestException('游戏维护中，本局已结束后暂停开局');
    }
    if (room.phase !== 'BETTING' || Date.now() >= room.phaseEndsAt) {
      throw new BadRequestException('当前不在下注阶段');
    }
    if (!allowedSides(room.gameCode).includes(side)) {
      throw new BadRequestException('投注方向无效');
    }
    /* 限红以平台 Game 表为准（后台改完立即生效，不依赖 Redis 旧缓存） */
    const gameCfg = await this.configCache.get(room.gameCode);
    if (!gameCfg || gameCfg.status !== 'ONLINE') {
      throw new BadRequestException('游戏维护中，暂停下注');
    }
    const minBet = Math.max(1, asMoney(gameCfg?.minBet ?? room.minBet) || 1);
    const maxBet = asMoney(gameCfg?.maxBet ?? room.maxBet) || room.maxBet;
    room.minBet = minBet;
    room.maxBet = maxBet;
    /* 千倍赔率的低频边单独限红，避免单注击穿平台池 */
    const sideCap = tableSideMaxBet(room.gameCode, side, maxBet);
    if (!isValidMoney(amount, 1) || amount < minBet || amount > sideCap) {
      throw new BadRequestException(`下注额须在 ${minBet}~${sideCap} 之间`);
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
    if (!this.flyDisk) {
      throw new BadRequestException('飞盘服务未就绪，暂不可下注');
    }
    const house = await this.flyDisk.resolveHouse(
      playerId,
      await this.flyDisk.requireOpsRoomId(playerId, payload.roomNo),
      amount,
      { requireRoom: true },
    );
    if (!house.roomId) {
      throw new BadRequestException('请先进入房间再下注');
    }
    const { P } = await this.flyDisk.resolvePlayerRate(playerId, house.roomId);
    const flyPayload = {
      type: house.type,
      id: house.id,
      flying: house.flying,
      roomId: house.roomId,
      agentUserId: house.agentUserId,
      bookMode: house.bookMode,
      P,
    };
    try {
      await this.prisma.$transaction(async (tx) => {
        /* 1) 先落/锁住本局，再做对冲与单边上限（避免首注竞态绕过） */
        if (!roundId) {
          roundId = await this.ensurePlayingRoundInTx(tx, room);
        }

        await tx.$queryRaw`SELECT id FROM "GameRound" WHERE id = ${roundId} FOR UPDATE`;

        const live = await tx.gameRound.findUnique({
          where: { id: roundId! },
          select: { state: true },
        });
        if (!live || live.state !== 'PLAYING') {
          throw new BadRequestException('本局已封盘');
        }

        /* GameRound 行锁串行同局下注；DB 聚合才是平台单边暴露的权威判断。 */
        const platformSideTotal = await this.pendingSideExposureInTx(
          tx,
          room.gameCode,
          roundId!,
          side,
        );
        const nextPlatformSide = platformSideTotal + amount;
        if (nextPlatformSide > TABLE_RISK.maxPlatformSideExposure) {
          this.logger.warn(
            `平台暴露超限(DB) game=${room.gameCode} side=${side} next=${nextPlatformSide}`,
          );
          throw new BadRequestException('该方向投注已满，请稍后再试');
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
            const code = normalizeGameCode(room.gameCode);
            const tip =
              code === 'dragon-tiger'
                ? '同局不可对冲下注（龙虎互斥）'
                : '同局不可对冲下注（庄闲互斥）';
            throw new BadRequestException(tip);
          }
        }

        const userSideTotal = await this.pendingSideExposureInTx(
          tx,
          room.gameCode,
          roundId!,
          side,
          playerId,
        );
        const nextUserSide = userSideTotal + amount;
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

        /* clientRequestId 唯一：并发同键时后到者 P2002，外层重放 */
        const bet = await tx.bet.create({
          data: {
            betNo: businessNo('TB'),
            clientRequestId,
            playerId,
            gameId: room.gameId,
            roundId: roundId!,
            betType: side,
            amount,
            status: 'PENDING',
            payload: { fly: flyPayload } as never,
          },
        });

        if (house.flying || house.type !== 'AGENT') {
          const betRoomId = String(house.roomId || '').trim();
          if (!betRoomId) throw new BadRequestException('下注缺少房间');
          await this.points.transferInTx(
            tx,
            {
              type: 'PLAYER',
              id: playerId,
              roomId: betRoomId,
              remark: `${room.gameName}下注 ${side}`,
              idempotencyKey: `table_bet_player_${bet.id}`,
            },
            {
              type: 'PLATFORM',
              id: PLATFORM_OWNER_ID,
              remark: `${room.gameName} 注资 ${room.roundNo}`,
              idempotencyKey: `table_bet_house_${bet.id}`,
            },
            amount,
            { bizType: 'BET', refType: 'round', refId: roundId! },
          );
        } else {
          await closedDiskDebitBetInTx(tx, this.points, {
            playerId,
            agentUserId: house.agentUserId || house.id,
            roomId: house.roomId,
            bookMode: house.bookMode,
            amount,
            remark: `${room.gameName}下注 ${side}(关盘)`,
            refType: 'round',
            refId: roundId!,
            idemPlayer: `table_bet_player_${bet.id}`,
            idemAgent: `table_bet_agent_${bet.id}`,
          });
        }
      });
    } catch (err) {
      if (err instanceof BadRequestException) throw err;
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        const raced = await this.prisma.bet.findUnique({
          where: { clientRequestId },
          select: {
            playerId: true,
            betType: true,
            amount: true,
            roundId: true,
            payload: true,
          },
        });
        if (raced) {
          const replayed = await this.replayTableBet(playerId, roomId, raced, side, amount);
          await this.redis.set(idemKey, JSON.stringify(replayed), 120).catch(() => undefined);
          return replayed;
        }
      }
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

    const snapRoom = (await this.loadRoom(roomId)) ?? latest;
    if (roundId) {
      void this.riskDetector.onTableBet({
        roundId,
        playerId,
        side,
        amount,
        gameCode: room.gameCode,
        roundNo: snapRoom.roundNo,
      });
    }

    const result = await this.buildTableBetResult(
      playerId,
      roomId,
      side,
      amount,
      snapRoom.roundNo,
      snapRoom.phase,
      secondsLeftOf(snapRoom),
      house.roomId,
    );
    await this.redis.set(idemKey, JSON.stringify(result), 120).catch(() => undefined);
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
      totalPayout: bets.reduce((s, b) => s + asMoney(b.payout || 0), 0),
      totalStake: bets.reduce((s, b) => s + asMoney(b.amount || 0), 0),
    };
  }


  /** 路单只保留上海时区当日记录（按局号日期 / createdAt） */
  private pruneHistoryToShanghaiDay(history: TableHistoryItem[]): TableHistoryItem[] {
    const list = Array.isArray(history) ? history : [];
    const { ymd } = shanghaiDayOf(Date.now());
    const kept = list.filter((h) => {
      const m = String(h?.roundNo || '').match(/(\d{8})-/);
      if (m) return m[1] === ymd;
      if (h?.createdAt) {
        const ts = Date.parse(h.createdAt);
        if (Number.isFinite(ts)) return shanghaiDayOf(ts).ymd === ymd;
      }
      return false;
    });
    // 安全上限，防止异常膨胀
    return kept.length > 2000 ? kept.slice(0, 2000) : kept;
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
      history: this.pruneHistoryToShanghaiDay(room.history),
      serverSeedHash: room.serverSeedHash,
      /* 下注阶段不公布 nonce，封盘控奖后再揭示，便于可验证复算 */
      nonce: sealed ? room.nonce : undefined,
      serverSeed: sealed ? room.serverSeed : undefined,
      timing: {
        bettingMs: timing.bettingMs,
        drawMs: timing.drawMs,
        settleMs: timing.settleMs,
        cycleMs: timing.cycleMs,
      },
    };
  }

  /**
   * 全站软控统一挑号：
   * 单期自然亏损未到触发线 → 不干预（偏置/缓刹除外）；
   * 到线后：铁律只拦亏超上限 → 朝目标亏损率靠拢 → 日账/偏置/缓刹。
   * 冷却 mark/consume 只通过 softCommit 在 CAS 成功后提交。
   */
  private async pickTableOutcomeWithControl(
    room: RedisRoomState,
  ): Promise<{ outcome: TableOutcome; nonce: number; softCommit: 'none' | 'mark' | 'consume' }> {
    const baseNonce = room.nonce;
    const defaultOutcome = drawOutcome(room.gameCode, room.serverSeed, baseNonce);
    const globalRt = this.globalSoft
      ? await this.globalSoft.getDrawRuntime(room.gameCode)
      : null;

    if (!globalRt?.needPick) {
      return {
        outcome: defaultOutcome,
        nonce: baseNonce,
        softCommit: globalRt?.cooldownActive ? 'consume' : 'none',
      };
    }

    const roundId = await this.resolveRoundId(room);
    if (!roundId) {
      return { outcome: defaultOutcome, nonce: baseNonce, softCommit: 'none' };
    }

    const pendingBets = await this.prisma.bet.findMany({
      where: { roundId, status: 'PENDING' },
      select: { amount: true, betType: true, payload: true, playerId: true },
    });

    type Bucket = { roomId: string; bets: typeof pendingBets; stake: number };
    const byRoom = new Map<string, Bucket>();
    let periodStake = 0;
    for (const b of pendingBets) {
      const amt = asMoney(b.amount);
      periodStake = roundMoney(periodStake + amt);
      const rid = (b.payload as { fly?: { roomId?: string } } | null)?.fly?.roomId;
      if (!rid) continue;
      let bucket = byRoom.get(rid);
      if (!bucket) {
        bucket = { roomId: rid, bets: [], stake: 0 };
        byRoom.set(rid, bucket);
      }
      bucket.bets.push(b);
      bucket.stake = roundMoney(bucket.stake + amt);
    }

    /* 空注/零流水：自然开奖，不占冷却 */
    if (periodStake <= 1e-9) {
      return { outcome: defaultOutcome, nonce: baseNonce, softCommit: 'none' };
    }

    const estimatePay = (bets: typeof pendingBets, cand: TableOutcome) => {
      let pay = 0;
      for (const b of bets) {
        const amt = asMoney(b.amount);
        const raw = calcTablePayout(room.gameCode, b.betType ?? '', cand, amt);
        pay = roundMoney(pay + capWin(amt, raw).win);
      }
      return pay;
    };

    let brakeKeys = new Set<string>();
    if (globalRt.playerBrakeEnabled && this.globalSoft) {
      const brakeTargets: Array<{ playerId: string; roomId: string }> = [];
      for (const b of pendingBets) {
        if (!b.playerId) continue;
        const rid = String(
          (b.payload as { fly?: { roomId?: string } } | null)?.fly?.roomId || '',
        ).trim();
        if (!rid) continue;
        brakeTargets.push({ playerId: b.playerId, roomId: rid });
      }
      brakeKeys = await this.globalSoft.playersNeedingBrake(
        brakeTargets,
        globalRt.playerBrakeMultiple,
      );
    }
    const brakeFirst = brakeKeys.size > 0;
    const biases = globalRt.biases || [];

    const naturalPay = estimatePay(pendingBets, defaultOutcome);
    const playerCount = new Set(
      pendingBets.map((b) => b.playerId).filter(Boolean) as string[],
    ).size;
    const guard = decidePeriodGuard({
      periodStake,
      naturalPayout: naturalPay,
      playerCount,
      cycleProfit: globalRt.cycleProfit,
      params: globalRt.periodGuard,
    });

    if (!guard.steer && biases.length === 0 && !brakeFirst) {
      return { outcome: defaultOutcome, nonce: baseNonce, softCommit: 'none' };
    }

    const tries = Math.max(1, globalRt.tries);
    const periodCommission = roundMoney(periodStake * (globalRt.commissionRatePct / 100));
    const dayTol = Math.max(1, periodStake * 0.001 + globalRt.dayF * 0.0005);

    let bestOutcome = defaultOutcome;
    let bestNonce = baseNonce;
    let bestRank: SoftPickRank = {
      valid: false,
      day: Number.POSITIVE_INFINITY,
      bias: Number.POSITIVE_INFINITY,
      brake: Number.POSITIVE_INFINITY,
      period: Number.POSITIVE_INFINITY,
      winners: -1,
    };
    let sawLegal = false;

    for (let i = 0; i < tries; i++) {
      const nonce = baseNonce + i;
      const cand = i === 0 ? defaultOutcome : drawOutcome(room.gameCode, room.serverSeed, nonce);
      const betPays = pendingBets.map((b) => estimatePay([b], cand));
      let periodPay = 0;
      for (const p of betPays) periodPay = roundMoney(periodPay + p);

      if (guard.steer && !periodCandidateLegal({
        periodStake,
        periodPayout: periodPay,
        decision: guard,
      })) continue;
      sawLegal = true;

      /* IDLE 仅偏置：不算日账主分 */
      const day = globalRt.daySteer
        ? globalDayNetScore({
          dayF: globalRt.dayF,
          dayG: globalRt.dayG,
          dayC: globalRt.dayC,
          periodStake,
          periodPayout: periodPay,
          periodCommission,
          targetNetPct: globalRt.targetNetPct,
        })
        : 0;

      const period = guard.steer
        ? periodLossScore({
          periodStake,
          periodPayout: periodPay,
          targetLossPct: guard.targetLossPct,
        })
        : 0;

      const roomBooks = new Map<string, { stake: number; payout: number }>();
      const playerPayouts = new Map<string, number>();
      const winnerIds = new Set<string>();
      let brake = 0;
      for (let k = 0; k < pendingBets.length; k++) {
        const b = pendingBets[k];
        const pay = betPays[k];
        if (pay > 1e-9 && b.playerId) winnerIds.add(b.playerId);
        const rid = String(
          (b.payload as { fly?: { roomId?: string } } | null)?.fly?.roomId || '',
        ).trim();
        if (!rid) continue;
        const bucket = byRoom.get(rid);
        const book = roomBooks.get(rid) || { stake: bucket?.stake ?? 0, payout: 0 };
        book.payout = roundMoney(book.payout + pay);
        roomBooks.set(rid, book);
        if (!b.playerId) continue;
        const key = `${rid}|${b.playerId}`;
        playerPayouts.set(key, roundMoney((playerPayouts.get(key) ?? 0) + pay));
        if (brakeKeys.has(key)) brake = roundMoney(brake + pay);
      }
      const biasRes = softBiasScore({
        biases,
        roomBooks,
        playerPayouts,
        houseFloor: CONTROL_PLAYER_WIN_HOUSE_FLOOR,
      });
      if (!biasRes.valid) continue;

      const rank: SoftPickRank = {
        valid: true,
        day,
        bias: biasRes.score,
        brake,
        period,
        winners: winnerIds.size,
      };
      if (isBetterSoftGlobalPick(rank, bestRank, dayTol, {
        brakeFirst,
        periodFirst: guard.steer,
      })) {
        bestRank = rank;
        bestOutcome = cand;
        bestNonce = nonce;
      }
    }

    if (!sawLegal || !bestRank.valid) {
      this.logger.log(
        `control global table=${room.gameCode} gear=${globalRt.gear} fallback=natural ` +
          `biasN=${biases.length} steer=${guard.steer} why=${guard.reason} ` +
          `dayR=${globalRt.dayR ?? 'n/a'}`,
      );
      return { outcome: defaultOutcome, nonce: baseNonce, softCommit: 'none' };
    }

    const sameAsNatural = bestNonce === baseNonce;
    this.logger.log(
      `control global table=${room.gameCode} mode=${globalRt.mode} gear=${globalRt.gear} ` +
        `nonce=${bestNonce} steer=${guard.steer} wipeout=${guard.allowWipeout} ` +
        `why=${guard.reason} winners=${bestRank.winners} ` +
        `period~=${Math.round(bestRank.period ?? 0)} day~=${Math.round(bestRank.day)} ` +
        `bias~=${Math.round(bestRank.bias)} biasN=${biases.length} ` +
        `brakeN=${brakeKeys.size} brakeFirst=${brakeFirst} ` +
        `soft=${sameAsNatural ? 'none' : 'mark'}`,
    );
    return {
      outcome: bestOutcome,
      nonce: bestNonce,
      softCommit: sameAsNatural ? 'none' : 'mark',
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
        let outcomeMatches: boolean | null;
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

  /** 只经 Redis 广播；本机订阅回调里再推，避免本地+回环各推一遍 */
  private async publishSnapshot(room: RedisRoomState) {
    const snap = this.buildSnapshot(room);
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
