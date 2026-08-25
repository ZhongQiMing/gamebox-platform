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
import { equivalentBetSides, oppositeHedgeSides, TABLE_RISK } from './table-risk';
import { SoftControlAuditService } from '../console/soft-control-audit.service';
import { withTxRetry } from '../../prisma/tx-retry';
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
  parsePlayLimits,
  resolvePlayBetRange,
  tableSideMaxBet,
  tableSideRoundCap,
  tableTimingOf,
} from '@gamebox/shared';
import type { TableHistoryItem } from './table.types';
import { ConsoleControlService } from '../console/console-control.service';
import { GlobalSoftControlService } from '../console/global-soft-control.service';
import { FlyDiskService } from '../console/fly-disk.service';
import { FlyRebateService } from '../console/fly-rebate.service';
import {
  closedDiskDebitBetInTx,
  closedDiskHouseUserId,
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
  generalUserId?: string;
  sitting?: 'PLATFORM' | 'GENERAL' | 'AGENT';
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
/**
 * 撤销的封盘提前量：与客户端下注截止量同级。
 * 留这段窗口是为了不让「倒计时最后一瞬撤销」和封盘发牌撞在一起。
 */
const CANCEL_CUTOFF_MS = 1_000;

/**
 * 开奖固定用的 nonce。
 *
 * 候选之间改用互不相关的独立种子后，nonce 不再承担「第几个候选」的含义，
 * 恒为 1。旧做法是「同一种子 + 递增 nonce」，而起点等于上一局公布值 + 1，
 * 于是公布的 nonce 与起点一减就暴露「跳过了几个候选」——实测能从匿名接口
 * 反推出某一局被干预过。独立种子之间没有数学关系，只公布采用的那一个，
 * 外部无从比对。
 */
const PICK_NONCE = 1;

/**
 * 结算分批参数。
 *
 * 整局一个事务时，一万注约 15~30 万条语句、需 50~100 秒，而事务上限 120 秒，
 * 一超时整局回滚并触发全场退款。分批后单事务降到亚秒级。
 *
 * 取 64 而不是更大：批越小，单个事务越短、崩溃续跑的粒度越细，代价只是多几次
 * 事务开销。
 *
 * 曾经的一个坑（已解决）：批内第一次派彩就锁住平台资金池那一行，锁要持有到整批
 * 提交，期间全站现金盘下注都得排队。实测 198 笔的一局结算时另一桌出现最高 2~3 秒
 * 下注延迟。把批容量改小并不能缓解——争用总时长不变，只是被切成几段，排队的下注
 * 仍可能等过好几批。现在派彩对平台侧只记账不改余额（余额由 PlatformBalanceMerger
 * 批量补），结算事务里已经完全不碰那一行，所以这里不需要任何额外包装。
 */
const SETTLE_BATCH_SIZE = Math.max(
  1,
  Math.floor(Number(process.env.TABLE_SETTLE_BATCH_SIZE ?? 64)),
);
/** 同一批连续失败到这个次数就降为单笔，用来隔离「毒丸」注单 */
const SETTLE_BATCH_MAX_RETRY = 3;
/** 批次数硬上限，防止异常情况下无限循环 */
const SETTLE_MAX_BATCHES = 10_000;

/** 一次开奖挑选的结果：采用的结果、对应种子与其指纹 */
interface TablePick {
  outcome: TableOutcome;
  seed: string;
  seedHash: string;
  nonce: number;
  /** 是否放弃了自然结果（仅内部留痕，不对外暴露） */
  steered: boolean;
  softCommit: 'none' | 'mark' | 'consume';
  /** 介入时的留痕素材；未介入为空 */
  audit?: {
    reason: string;
    tries: number;
    naturalDigest: string;
    adoptedDigest: string;
    stake: number;
    estPayout: number;
  };
}

/** 结果摘要：给人看的一行字，用来事后核对「本来会开什么、最后开了什么」 */
function outcomeDigest(o: TableOutcome | null | undefined): string {
  if (!o) return '';
  const label = (v: unknown) => {
    const s = (v as { label?: unknown } | null)?.label;
    return typeof s === 'string' && s ? s : '';
  };
  const banker = label(o.bankerType);
  const player = label(o.playerType);
  const parts = [
    String(o.result ?? o.winner ?? ''),
    banker ? `庄:${banker}` : '',
    player ? `闲:${player}` : '',
  ].filter(Boolean);
  return parts.join(' ').slice(0, 120);
}

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
    @Optional() private softAudit?: SoftControlAuditService,
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
      generalUserId: fly?.generalUserId,
      sitting: fly?.sitting,
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
   * 处理过期的 PLAYING 局，分两种情况：
   *
   * 一、已写入开奖结果 → 是「分批结算中途断了」。必须用已落库的那个结果**续跑**
   *    把剩余注单结完，绝不能退款：前面几批已经按这个结果派过彩了，
   *    退掉剩下的会让同一局出现两种处理，账就乱了。
   * 二、没有开奖结果 → 真孤儿局，作废退款。
   */
  private async recoverOrphanRounds() {
    const cutoff = new Date(Date.now() - ORPHAN_GRACE_MS);
    const candidates = await this.prisma.gameRound.findMany({
      where: {
        category: 'TABLE',
        state: 'PLAYING',
        startedAt: { lt: cutoff },
      },
      select: {
        id: true,
        roundNo: true,
        outcome: true,
        serverSeed: true,
        serverSeedHash: true,
        nonce: true,
        game: { select: { code: true, name: true } },
      },
    });

    for (const round of candidates) {
      const gameCode = round.game.code;
      const room = await this.loadRoom(gameCode);
      const isCurrent =
        room?.roundId === round.id && room.phaseEndsAt > Date.now() - ORPHAN_GRACE_MS;

      if (round.outcome) {
        /* 结算中断：无论是否当前局，都要按已落库结果续跑结完 */
        this.logger.warn(`结算中断续跑 ${round.roundNo}`);
        try {
          await this.settleRoundInBatches(
            round.id,
            {
              gameCode,
              gameName: round.game.name,
              serverSeed: round.serverSeed || '',
              serverSeedHash: round.serverSeedHash || '',
              nonce: round.nonce ?? PICK_NONCE,
            } as RedisRoomState,
            round.outcome as NonNullable<RedisRoomState['outcome']>,
          );
        } catch (err) {
          this.logger.error(
            `结算续跑失败 ${round.roundNo}`,
            err instanceof Error ? err.stack : String(err),
          );
        }
        continue;
      }

      if (isCurrent) continue;
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
      /* 下注期不持有种子：封盘挑选时才定，见 pickTableOutcomeWithControl */
      serverSeed: '',
      serverSeedHash: '',
      nonce: PICK_NONCE,
      steered: false,
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
    /*
     * 带超时地读。Redis 断线时 ioredis 会把命令排队而不是报错，
     * 不加超时的话请求会一直挂着，上面的降级分支永远等不到。
     */
    const raw = await this.redis.getWithTimeout(roomKey(gameCode));
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
    const now = Date.now();
    room.phase = 'BETTING';
    room.phaseEndsAt = alignedBettingEndsAt(room.gameCode, now);
    /* 新局清空种子：封盘挑选时才生成，开局前无可承诺之物 */
    room.serverSeed = '';
    room.serverSeedHash = '';
    room.nonce = PICK_NONCE;
    room.steered = false;
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
      /* 种子在封盘这一刻才定：候选是互不相关的独立种子，只留采用的那把 */
      const picked = await this.pickTableOutcomeWithControl(room);
      room.serverSeed = picked.seed;
      room.serverSeedHash = picked.seedHash;
      room.nonce = picked.nonce;
      room.steered = picked.steered;
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
      /* 介入留痕：只有 ADMIN 能查，写失败也不能拖累开奖 */
      if (picked.audit && this.softAudit) {
        await this.softAudit.record({
          category: 'table',
          gameCode: room.gameCode,
          refNo: room.roundNo,
          refId: room.roundId ?? null,
          ...picked.audit,
        });
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

      const now = Date.now();
      room.phase = 'BETTING';
      room.phaseEndsAt = alignedBettingEndsAt(room.gameCode, now);
      /* 新局清空种子：封盘挑选时才生成，开局前无可承诺之物 */
      room.serverSeed = '';
      room.serverSeedHash = '';
      room.nonce = PICK_NONCE;
      room.steered = false;
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

  /** 单笔退款作废：用于结算中反复失败的「毒丸」注单，避免它卡死整局 */
  private async refundOneBetById(betId: string, roundId: string, reason: string) {
    await this.prisma.$transaction(async (tx) => {
      const bet = await tx.bet.findUnique({ where: { id: betId } });
      if (!bet || bet.status !== 'PENDING') return;
      const claimed = await tx.bet.updateMany({
        where: { id: betId, status: 'PENDING' },
        data: { status: 'CANCELLED', settledAt: new Date() },
      });
      if (claimed.count === 0) return;
      await this.refundOneBetInTx(
        tx,
        { ...bet, amount: asMoney(bet.amount) },
        roundId,
        reason,
      );
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
        agentUserId: closedDiskHouseUserId(house),
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

  /**
   * 认领本局结算权，并把开奖结果落库。
   *
   * 用「outcome 从空变为有值」做认领条件，而不是直接改成 SETTLED：
   * 分批结算期间局必须还留在 PLAYING，否则中途崩溃就会出现
   * 「局已结算、注单仍待结算」——那正是吞单。
   *
   * @returns true 表示本次认领成功；false 表示别人已认领或已在结算中
   */
  private async claimRoundForSettle(
    roundId: string,
    room: RedisRoomState,
    outcome: NonNullable<RedisRoomState['outcome']>,
  ): Promise<boolean> {
    const affected = await this.prisma.$executeRaw`
      UPDATE "GameRound"
      SET outcome = ${JSON.stringify(outcome)}::jsonb,
          "serverSeed" = ${room.serverSeed},
          "serverSeedHash" = ${room.serverSeedHash},
          nonce = ${room.nonce}
      WHERE id = ${roundId}
        AND state = 'PLAYING'
        AND outcome IS NULL
    `;
    return Number(affected) === 1;
  }

  /**
   * 抢一批待结算注单。
   *
   * SKIP LOCKED 让并发结算者各取各的、互不阻塞；行锁在事务内持有，
   * 配合每笔「以 PENDING 为条件认领」，同一笔不可能被结算两次。
   */
  private async lockPendingBetIdsInTx(
    tx: Prisma.TransactionClient,
    roundId: string,
    limit: number,
  ): Promise<string[]> {
    const rows = await tx.$queryRaw<{ id: string }[]>`
      SELECT id FROM "Bet"
      WHERE "roundId" = ${roundId} AND status = 'PENDING'
      ORDER BY "createdAt"
      LIMIT ${limit}
      FOR UPDATE SKIP LOCKED
    `;
    return rows.map((r) => r.id);
  }

  /**
   * 批量识别「历史上钱其实进了平台池」的注单。
   *
   * 原先每笔都单独查一次 pointsLedger，一万注就是一万次往返，
   * 全压在同一个事务里。改成一批一次查。
   */
  private async legacyPlatformBetIdsInTx(
    tx: Prisma.TransactionClient,
    betIds: string[],
  ): Promise<Set<string>> {
    if (!betIds.length) return new Set();
    const keys = betIds.map((id) => `table_bet_plat_${id}`);
    const rows = await tx.pointsLedger.findMany({
      where: { idempotencyKey: { in: keys } },
      select: { idempotencyKey: true },
    });
    const out = new Set<string>();
    for (const r of rows) {
      const id = String(r.idempotencyKey || '').replace('table_bet_plat_', '');
      if (id) out.add(id);
    }
    return out;
  }

  /** 单笔结算：资金语义与分批改造前完全一致 */
  private async settleOneBetInTx(
    tx: Prisma.TransactionClient,
    ctx: {
      roundId: string;
      gameCode: string;
      gameName: string;
      outcome: NonNullable<RedisRoomState['outcome']>;
      legacyPlatform: Set<string>;
    },
    bet: { id: string; playerId: string; betType: string | null; amount: unknown; payload?: unknown },
    sink: {
      bigWins: Array<{ betId: string; playerId: string; amount: number; payout: number }>;
      biasTouches: Array<{ roomId: string; playerId: string; stake: number; payout: number }>;
      flow: { total: number };
    },
  ): Promise<void> {
    const { roundId, gameCode, gameName, outcome } = ctx;
    const amt = asMoney(bet.amount);
    const raw = calcTablePayout(gameCode, bet.betType ?? '', outcome, amt);
    const { win: payout, capped } = capWin(amt, raw);
    if (capped) {
      this.logger.error(`派彩触顶 ${gameCode} bet=${bet.id} 原始=${raw} 封顶=${payout}`);
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
    if (betClaimed.count === 0) return;
    sink.flow.total = roundMoney(sink.flow.total + amt);

    if (!refundOnly && payout >= Math.max(amt * 50, 100_000)) {
      sink.bigWins.push({ betId: bet.id, playerId: bet.playerId, amount: amt, payout });
    }

    const house = ctx.legacyPlatform.has(bet.id)
      ? { type: 'PLATFORM' as OwnerType, id: PLATFORM_OWNER_ID, flying: false }
      : this.flyFromBet(bet);
    const touchRoomId = String(house.roomId || '').trim();
    if (touchRoomId && !refundOnly) {
      sink.biasTouches.push({
        roomId: touchRoomId,
        playerId: bet.playerId,
        stake: amt,
        payout,
      });
    }

    const resultTag = String(outcome.result || outcome.winner || '');
    const tag = `${gameName} ${resultTag}${refundOnly ? ' 退本' : ''}`;
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
        agentUserId: closedDiskHouseUserId(house),
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
      if (this.flyRebate) {
        await this.flyRebate.payBetFlowInTx(tx, {
          betId: bet.id,
          playerId: bet.playerId,
          validFlow: amt,
          flying: house.flying,
          roomId: house.roomId,
          agentUserId: house.agentUserId,
          generalUserId: house.generalUserId,
          sitting: house.sitting,
          bookMode: house.bookMode,
          roundId,
          gameCode,
          /* 用下注当时定死的整包比例结算，而不是结算这一刻的现值 */
          rateSnapshot: (
            bet.payload as { fly?: { agentPkg?: unknown; generalPkg?: unknown } } | null
          )?.fly,
        });
      }
    }
  }

  /**
   * 分批结算一局。
   *
   * 原先整局所有注单挤在一个事务里：一万注约 15~30 万条语句，按每笔 5~10 毫秒
   * 要跑 50~100 秒，而事务上限是 120 秒——一超时整局回滚并触发全场退款。
   * 改成每批 500 笔独立提交：单事务降到亚秒级，失败只影响一批且可重放。
   * 每笔本来就有幂等键，重放不会重复派彩。
   */
  private async settleRoundInBatches(
    roundId: string,
    room: RedisRoomState,
    outcome: NonNullable<RedisRoomState['outcome']>,
  ): Promise<{
    bigWins: Array<{ betId: string; playerId: string; amount: number; payout: number }>;
    biasTouches: Array<{ roomId: string; playerId: string; stake: number; payout: number }>;
  }> {
    const bigWins: Array<{ betId: string; playerId: string; amount: number; payout: number }> = [];
    const biasTouches: Array<{ roomId: string; playerId: string; stake: number; payout: number }> = [];
    const flow = { total: 0 };
    let batchSize = SETTLE_BATCH_SIZE;
    let consecutiveFailures = 0;
    let batches = 0;
    /** 已经走过退款隔离的注单，用来识别「退了还在」的空转 */
    const refundAttempted = new Set<string>();

    for (;;) {
      let handled: number;
      try {
        /*
         * 死锁/串行化失败自动重试：这两种错误下事务已完整回滚，重放不会重复派彩。
         * 不重试的话，跟回水领取撞一次就变成一批注单结算失败。
         */
        handled = await withTxRetry(
          () => this.prisma.$transaction(async (tx) => {
            const ids = await this.lockPendingBetIdsInTx(tx, roundId, batchSize);
            if (!ids.length) return 0;
            const bets = await tx.bet.findMany({ where: { id: { in: ids } } });
            const legacyPlatform = await this.legacyPlatformBetIdsInTx(tx, ids);
            const ctx = {
              roundId,
              gameCode: room.gameCode,
              gameName: room.gameName,
              outcome,
              legacyPlatform,
            };
            for (const bet of bets) {
              await this.settleOneBetInTx(tx, ctx, bet, { bigWins, biasTouches, flow });
            }
            return bets.length;
          }),
          { label: `牌桌结算 ${room.gameCode}` },
        );
        consecutiveFailures = 0;
      } catch (err) {
        consecutiveFailures += 1;
        this.logger.error(
          `结算批次失败（第 ${consecutiveFailures} 次）${room.gameCode} round=${roundId} batch=${batchSize}`,
          err instanceof Error ? err.stack : String(err),
        );
        if (consecutiveFailures >= SETTLE_BATCH_MAX_RETRY) {
          if (batchSize > 1) {
            /* 降到单笔，把「毒丸」那一笔精确定位出来，其余照常结算 */
            this.logger.warn(
              `结算批次连续失败，降为单笔隔离 ${room.gameCode} round=${roundId}`,
            );
            batchSize = 1;
            consecutiveFailures = 0;
            continue;
          }
          /* 单笔仍失败：这一笔无法结算，退款作废并继续，不让它卡死整局 */
          const stuck = await this.prisma.bet.findFirst({
            where: { roundId, status: 'PENDING' },
            select: { id: true },
            orderBy: { createdAt: 'asc' },
          });
          if (!stuck) break;
          /*
           * 同一笔第二次被挑出来，说明退款没能让它离开 PENDING，再退一次只会
           * 原地打转。这个循环失败时不增加批次计数，所以没有别的出口——
           * 空转会一个核心跑满、日志无上限地涨，最后把进程拖死。
           * 宁可把这一局留在 PLAYING 交给续跑巡检，也不能在这里空转。
           */
          if (refundAttempted.has(stuck.id)) {
            this.logger.error(
              `注单退款后仍未离开待结算，中止本局结算 round=${roundId} bet=${stuck.id}`,
            );
            break;
          }
          refundAttempted.add(stuck.id);
          this.logger.error(
            `注单无法结算，改为退款作废 round=${roundId} bet=${stuck.id}`,
          );
          await this.refundOneBetById(stuck.id, roundId, '结算异常，本注作废退款');
          consecutiveFailures = 0;
          continue;
        }
        continue;
      }

      if (handled === 0) break;
      batches += 1;
      /* 单笔隔离模式下处理完一笔就恢复批量，避免整局都按单笔跑 */
      if (batchSize === 1) batchSize = SETTLE_BATCH_SIZE;
      if (batches > SETTLE_MAX_BATCHES) {
        this.logger.error(`结算批次数异常超限 round=${roundId}，中止以免死循环`);
        break;
      }
    }

    /* 待结算归零后才把局收尾：中途崩溃时局仍是 PLAYING，由续跑巡检接手 */
    const remaining = await this.prisma.bet.count({
      where: { roundId, status: 'PENDING' },
    });
    if (remaining === 0) {
      const agg = await this.prisma.bet.aggregate({
        where: { roundId, status: { in: ['WON', 'LOST'] } },
        _sum: { amount: true },
      });
      await this.prisma.gameRound.updateMany({
        where: { id: roundId, state: 'PLAYING' },
        data: {
          state: 'SETTLED',
          endedAt: new Date(),
          totalFlow: asMoney(agg._sum.amount || 0),
        },
      });
    } else {
      this.logger.error(
        `结算未清空仍有 ${remaining} 笔待结算 round=${roundId}，局保持 PLAYING 等待续跑`,
      );
    }
    return { bigWins, biasTouches };
  }

  private async settle(room: RedisRoomState): Promise<
    Array<{ roomId: string; playerId: string; stake: number; payout: number }>
  > {
    const empty: Array<{ roomId: string; playerId: string; stake: number; payout: number }> = [];
    const outcome = room.outcome;
    if (!outcome) return empty;
    const roundId = await this.resolveRoundId(room);
    if (!roundId) {
      /*
       * 无人下注的空局照样记路单：路单是开奖历史，跟有没有人下注无关。
       * 这里原先只给炸金花开了特例，另外三桌空局直接跳过，结果没人玩的桌子
       * 路单永远是空的，玩家进来看到的是「本桌没开过奖」。
       */
      await this.appendRoadHistory(room, outcome);
      return empty;
    }

    let bigWins: Array<{ betId: string; playerId: string; amount: number; payout: number }>;
    let biasTouches: Array<{ roomId: string; playerId: string; stake: number; payout: number }>;
    try {
      if (!(await this.claimRoundForSettle(roundId, room, outcome))) {
        /* 别人已认领或已在结算：本次不重复做，避免两个结算者互相打架 */
        await this.appendRoadHistory(room, outcome);
        return empty;
      }
      ({ bigWins, biasTouches } = await this.settleRoundInBatches(roundId, room, outcome));
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

  /**
   * 撤销本局我的全部挂单：仅下注期、且距封盘还有余量时允许。
   *
   * 正确性靠「以 PENDING 为条件认领注单」保证：结算是先把整局从 PLAYING 改成
   * SETTLED、再读 PENDING 注单，所以撤销与结算必有一方抢不到——抢不到的那笔直接跳过，
   * 不会重复退款，也不会既结算又退款。
   */
  async cancelMyBets(playerId: string, gameCode: string) {
    const code = normalizeGameCode(gameCode);
    const room = await this.getOrCreateRoom(code);
    if (room.phase !== 'BETTING') {
      throw new BadRequestException('已封盘，本局不可撤销');
    }
    /* 与客户端封盘提前量对齐，避免边界上撤到已经开始发牌的局 */
    if (room.phaseEndsAt - Date.now() < CANCEL_CUTOFF_MS) {
      throw new BadRequestException('即将封盘，本局不可撤销');
    }
    const roundId = room.roundId;
    if (!roundId) {
      throw new BadRequestException('本局没有可撤销的下注');
    }

    const pending = await this.prisma.bet.findMany({
      where: { roundId, playerId, status: 'PENDING' },
    });
    if (pending.length === 0) {
      throw new BadRequestException('本局没有可撤销的下注');
    }

    const bySide = new Map<string, number>();
    let refunded = 0;
    let opsRoomId = '';

    await this.prisma.$transaction(async (tx) => {
      for (const bet of pending) {
        const claimed = await tx.bet.updateMany({
          where: { id: bet.id, status: 'PENDING' },
          data: { status: 'CANCELLED', settledAt: new Date() },
        });
        if (claimed.count === 0) continue;
        const amt = asMoney(bet.amount);
        await this.refundOneBetInTx(
          tx,
          { ...bet, amount: amt },
          roundId,
          '玩家撤销本局下注',
        );
        refunded = roundMoney(refunded + amt);
        const side = String(bet.betType || '');
        bySide.set(side, roundMoney((bySide.get(side) || 0) + amt));
        if (!opsRoomId) {
          opsRoomId = String(
            (bet.payload as { fly?: { roomId?: string } } | null)?.fly?.roomId || '',
          ).trim();
        }
      }
    });

    if (refunded === 0) {
      throw new BadRequestException('已封盘，本局不可撤销');
    }

    /* 扣回下注汇总：软控与单边限红都读它，漏扣会让本局限红虚高 */
    for (const [side, amt] of bySide) {
      const patch = await this.redis.patchTableBetSummary(
        roomKey(code),
        room.roundNo,
        roundId,
        side,
        -amt,
      );
      if (patch !== 1) {
        this.logger.warn(
          `撤销回写汇总失败 code=${patch} room=${code} round=${room.roundNo} side=${side}`,
        );
      }
    }

    const after = await this.loadRoom(code);
    if (after) await this.publishSnapshot(after);

    const snapRoom = after ?? room;
    const balance = opsRoomId
      ? await this.points.getPlayerBalance(playerId, opsRoomId)
      : 0;
    return {
      roomId: code,
      roundNo: snapRoom.roundNo,
      phase: snapRoom.phase,
      secondsLeft: secondsLeftOf(snapRoom),
      refunded,
      balance,
      bySide: Object.fromEntries(bySide),
    };
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

    /*
     * 缓存不可用时给一句明确的话，而不是把原始错误抛成 500。
     * 拒绝下注是正确方向（钱不会出问题），但玩家该知道是维护而不是「游戏坏了」。
     */
    let room: RedisRoomState;
    try {
      room = await this.getOrCreateRoom(roomId);
    } catch (err) {
      if (err instanceof BadRequestException) throw err;
      this.logger.error(
        `下注被拒：缓存不可用 ${roomId}`,
        err instanceof Error ? err.message : String(err),
      );
      throw new BadRequestException('游戏维护中，暂不可下注');
    }
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
    const playLimits = parsePlayLimits(gameCfg.playLimits);
    const sideDefaultCap = tableSideMaxBet(room.gameCode, side, maxBet);
    const range = resolvePlayBetRange({
      gameMin: minBet,
      gameMax: maxBet,
      playLimits,
      playKey: side,
      extraMax: playLimits[side] ? null : sideDefaultCap,
    });
    if (!isValidMoney(amount, 1) || amount < range.minBet || amount > range.maxBet) {
      throw new BadRequestException(`下注额须在 ${range.minBet}~${range.maxBet} 之间`);
    }
    const sideCap = range.maxBet;
    /*
     * 该方向的单局累计上限。
     *
     * 单人这一侧本来就被 sideCap 夹住（顺金单注 500，累计也就 500），漏的是全桌：
     * 默认 200 万不看赔率，顺金 100 倍下最坏要赔 2 亿，一桌几千人凑得出来。
     * 只有赔率超过 50 倍的方向有专属值，常规方向仍用默认的 10 万 / 200 万。
     */
    const roundCap = tableSideRoundCap(room.gameCode, side, {
      user: TABLE_RISK.maxUserSidePerRound,
      table: TABLE_RISK.maxPlatformSideExposure,
    });

    /* Redis 丢 roundId 时先按 roundNo 找回 */
    await this.resolveRoundId(room);

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
    /*
     * 三个比例都在下注这一刻定死：结算可能晚很久（尤其崩溃续跑），
     * 期间管理端改了比例的话，现算会按新比例结算旧流水。
     */
    const { P, agentPkg, generalPkg } = await this.flyDisk.resolvePlayerRate(
      playerId,
      house.roomId,
      room.gameCode,
    );
    const flyPayload = {
      type: house.type,
      id: house.id,
      flying: house.flying,
      roomId: house.roomId,
      agentUserId: house.agentUserId,
      generalUserId: house.generalUserId,
      sitting: house.sitting,
      bookMode: house.bookMode,
      P,
      agentPkg,
      generalPkg,
    };

    /*
     * 单边限红的预留放在事务内、资金动完之后。
     *
     * 放在事务之前也能保证不超限，但会让「注定要失败的请求」（余额不足、个人限额）
     * 先白占一份额度，并发高时其他人会被误拒「该方向投注已满」。
     * 放到最后，只剩「预留成功但提交失败」这个极小窗口需要回退。
     */
    let reservationHeld = false;
    const releaseReservation = async () => {
      if (!reservationHeld) return;
      reservationHeld = false;
      const back = await this.redis
        .patchTableBetSummary(roomKey(roomId), room.roundNo, roundId || '', side, -amount)
        .catch(() => -99);
      if (back !== 1) {
        this.logger.warn(
          `限红预留回退失败 code=${back} room=${roomId} round=${room.roundNo} side=${side}`,
        );
      }
    };

    try {
      await this.prisma.$transaction(async (tx) => {
        if (!roundId) {
          roundId = await this.ensurePlayingRoundInTx(tx, room);
        }

        /*
         * 共享锁而非排他锁。
         *
         * 这里要防的是「注单落库后本局才被结算认领」——那笔注会永远留在待结算，也就是吞单。
         * 结算认领走的是 UPDATE GameRound，与共享锁冲突，所以只要有下注在飞，认领就得等。
         * 而共享锁彼此不冲突，同桌上千人可以并发下注，不会像排他锁那样排队到封盘。
         */
        await tx.$queryRaw`SELECT id FROM "GameRound" WHERE id = ${roundId} FOR SHARE`;

        const live = await tx.gameRound.findUnique({
          where: { id: roundId! },
          select: { state: true, outcome: true },
        });
        if (!live || live.state !== 'PLAYING' || live.outcome) {
          throw new BadRequestException('本局已封盘');
        }

        /*
         * 只串行「同一玩家」的并发下注：对冲互斥与个人单边累计都只跟自己有关。
         * 原先用整局行锁把所有人一起串起来，代价远超收益。
         */
        await tx.$queryRaw<{ locked: string }[]>`
          SELECT pg_advisory_xact_lock(
            hashtextextended(${`tblbet:${playerId}:${roundId}`}, 0)
          )::text AS locked
        `;

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
        const userCap = Math.min(sideCap, roundCap.user);
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

        /*
         * 限红闸门：判上限与累加在同一段 Lua 内完成，并发绕不过去。
         * 同时把本局 roundId 写回房间状态（首注时 Redis 里还没有）。
         *
         * 位置很关键：必须在动资金**之前**。平台资金池是全站唯一一行，
         * 一旦更新到它，行锁就要持有到提交；若把这次 Redis 往返夹在
         * 「已锁住池子」和「提交」之间，全站下注吞吐会被这一次网络往返拖垮
         * （实测从每秒数百掉到每秒二十几）。
         */
        const reserved = await this.redis.reserveTableSideExposure({
          key: roomKey(roomId),
          roundNo: room.roundNo,
          roundId: roundId || '',
          side,
          sides: equivalentBetSides(room.gameCode, side),
          amount,
          cap: roundCap.table,
        });
        if (reserved === -3) {
          this.logger.warn(`平台暴露超限 game=${room.gameCode} side=${side} amount=${amount}`);
          throw new BadRequestException('该方向投注已满，请稍后再试');
        }
        if (reserved === -1) throw new BadRequestException('当前不在下注阶段');
        if (reserved === -2) throw new BadRequestException('局号已切换，请重试');
        if (reserved !== 1) {
          this.logger.warn(`限红预留失败 code=${reserved} room=${roomId} round=${room.roundNo}`);
          throw new BadRequestException('暂时无法下注，请重试');
        }
        reservationHeld = true;

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
            agentUserId: closedDiskHouseUserId(house),
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
      reservationHeld = false; /* 事务已提交，预留转为正式占用 */
    } catch (err) {
      /* 注单没落库，限红预留必须还回去，否则本局限红会被白占一份 */
      await releaseReservation();
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

    /* 汇总与 roundId 都由限红预留那一步写好了，这里只负责把新状态广播出去 */
    const latest = (await this.loadRoom(roomId)) ?? room;
    if (roundId && !latest.roundId) {
      latest.roundId = roundId;
      await this.saveRoomCas(latest).catch(() => undefined);
    }
    const published = (await this.loadRoom(roomId)) ?? latest;
    await this.publishSnapshot(published);

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
    const code = normalizeGameCode(gameCode);
    try {
      const room = await this.getOrCreateRoom(code);
      return this.buildSnapshot(room);
    } catch (err) {
      if (err instanceof BadRequestException) throw err;
      /*
       * Redis 不可用时如实降级成「维护中」，而不是把原始错误抛成 500。
       *
       * 牌桌的相位机与 leader 选举都在 Redis 上，Redis 一挂就推不动局。
       * 这时最重要的是别让玩家看到一个「像坏了」的游戏——客户端认识 PAUSED，
       * 会显示维护中并停止一切动画与下注。
       *
       * 刻意**不做**「从数据库推导相位」的兜底：那会造成两个真相来源，
       * 同一局可能被算出两个不同的开奖结果，比停摆严重得多。
       * 已开的局由孤儿巡检按既有规则处理（有结果就续跑、没结果就退款）。
       */
      this.logger.error(
        `牌桌快照降级为维护中（缓存不可用）${code}`,
        err instanceof Error ? err.message : String(err),
      );
      return this.degradedSnapshot(code);
    }
  }

  /** 缓存不可用时给客户端一个明确的「维护中」，不带任何局数据 */
  private degradedSnapshot(gameCode: string): TableSnapshot {
    return {
      roomId: gameCode,
      gameCode,
      phase: 'PAUSED',
      roundNo: '',
      secondsLeft: 0,
      betSummary: {},
      history: [],
      serverSeedHash: '',
      timing: tableTimingOf(gameCode),
      now: Date.now(),
    } as unknown as TableSnapshot;
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
    /*
     * 历史只给路单需要的字段。
     *
     * 原先把整条 history 直接下发，里面带着每一局的 serverSeed 与 nonce，
     * 一次就吐出上百局——匿名访客据此即可反推哪一局被干预过。
     * 种子仍留在 Redis 里，供按局号查询的验算接口使用。
     */
    const history = this.pruneHistoryToShanghaiDay(room.history).map((h) => ({
      roundNo: h.roundNo,
      outcome: h.outcome,
      createdAt: h.createdAt,
    }));
    return {
      roomId: room.gameCode,
      gameCode: room.gameCode,
      phase: room.phase,
      roundNo: room.roundNo,
      secondsLeft: secondsLeftOf(room),
      outcome: room.outcome ?? undefined,
      betSummary: { ...room.betSummary },
      history,
      /* 下注期没有种子可承诺（候选封盘才生成），封盘后才给出指纹与种子 */
      serverSeedHash: sealed ? room.serverSeedHash : '',
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
  ): Promise<TablePick> {
    /*
     * 候选一律用「互不相关的独立种子」，而不是同一种子上递增 nonce。
     *
     * 旧做法是 nonce = baseNonce + i，而 baseNonce 每局 +1、且历史 nonce 是公开的，
     * 于是任何人做一次减法就能看出本局跳过了几个候选（等于公开承认干预），
     * 还能用公开的种子算出「原本会开什么」。实测抓到过一局：
     * douniu DN20260820-0060 自然起点 154、实际公布 166。
     *
     * 换成独立种子后，未采用的候选与最终公布的种子在数学上毫无关系，
     * 也不存在可比对的链条——外部既看不出有没有介入，也算不出原本的结果。
     * 代价是开局前无法承诺 hash（用哪个种子要等封盘才定），
     * 但旧的承诺本来就是虚的：同一种子能算出十几个结果，用哪个是看完下注才决定的。
     */
    const natural = genServerSeed();
    const defaultOutcome = drawOutcome(room.gameCode, natural.seed, PICK_NONCE);
    const globalRt = this.globalSoft
      ? await this.globalSoft.getDrawRuntime(room.gameCode)
      : null;

    const naturalPick: TablePick = {
      outcome: defaultOutcome,
      seed: natural.seed,
      seedHash: natural.hash,
      nonce: PICK_NONCE,
      steered: false,
      softCommit: 'none',
    };

    if (!globalRt?.needPick) {
      return {
        ...naturalPick,
        softCommit: globalRt?.cooldownActive ? 'consume' : 'none',
      };
    }

    const roundId = await this.resolveRoundId(room);
    if (!roundId) return naturalPick;

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
    if (periodStake <= 1e-9) return naturalPick;

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

    if (!guard.steer && biases.length === 0 && !brakeFirst) return naturalPick;

    const tries = Math.max(1, globalRt.tries);
    const periodCommission = roundMoney(periodStake * (globalRt.commissionRatePct / 100));
    const dayTol = Math.max(1, periodStake * 0.001 + globalRt.dayF * 0.0005);

    let bestOutcome = defaultOutcome;
    let bestSeed = natural.seed;
    let bestHash = natural.hash;
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
      /* 每个候选一把独立种子，彼此无关联；只有被采用的那把会公布 */
      const candSeed = i === 0 ? natural : genServerSeed();
      const cand = i === 0
        ? defaultOutcome
        : drawOutcome(room.gameCode, candSeed.seed, PICK_NONCE);
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
        bestSeed = candSeed.seed;
        bestHash = candSeed.hash;
      }
    }

    if (!sawLegal || !bestRank.valid) {
      /*
       * 候选全非法 → 回落自然结果。这是「想控但控不住」，运营最需要知道的一种，
       * 单独打出来便于后续接告警。
       */
      this.logger.warn(
        `control global table=${room.gameCode} gear=${globalRt.gear} fallback=natural ` +
          `biasN=${biases.length} steer=${guard.steer} why=${guard.reason} ` +
          `dayR=${globalRt.dayR ?? 'n/a'}`,
      );
      return naturalPick;
    }

    const steered = bestSeed !== natural.seed;
    /* 触发来源：软控留痕要能回答「为什么改」，不能只留一个布尔 */
    const reasons: string[] = [];
    if (guard.steer) reasons.push('period');
    if (globalRt.daySteer) reasons.push('dayNet');
    if (biases.length) reasons.push('bias');
    if (brakeFirst) reasons.push('brake');
    this.logger.log(
      `control global table=${room.gameCode} mode=${globalRt.mode} gear=${globalRt.gear} ` +
        `steered=${steered} steer=${guard.steer} wipeout=${guard.allowWipeout} ` +
        `why=${guard.reason} winners=${bestRank.winners} ` +
        `period~=${Math.round(bestRank.period ?? 0)} day~=${Math.round(bestRank.day)} ` +
        `bias~=${Math.round(bestRank.bias)} biasN=${biases.length} ` +
        `brakeN=${brakeKeys.size} brakeFirst=${brakeFirst} ` +
        `soft=${steered ? 'mark' : 'none'}`,
    );
    return {
      outcome: bestOutcome,
      seed: bestSeed,
      seedHash: bestHash,
      nonce: PICK_NONCE,
      steered,
      softCommit: steered ? 'mark' : 'none',
      audit: steered
        ? {
            reason: reasons.length ? reasons.join('+') : 'unknown',
            tries: tries,
            /* 存下被放弃的自然结果，事后才能回答「本来会开什么」 */
            naturalDigest: outcomeDigest(defaultOutcome),
            adoptedDigest: outcomeDigest(bestOutcome),
            stake: periodStake,
            estPayout: estimatePay(pendingBets, bestOutcome),
          }
        : undefined,
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
   * 开奖核验：
   * - 下注期：无种子无指纹（候选封盘时才生成，开局前无可承诺之物）
   * - 封盘后 / 历史局：给出 seed 与指纹，并由服务端复算校验
   *
   * 一律不返回 nonce。新局恒为 1 本无信息量，但改动之前的旧局是逐局累加的，
   * 逐个查询就能重建链条、反推当时哪一局放弃了自然结果——那是最后一条泄露通道。
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
      serverSeedHash: sealed ? room.serverSeedHash : '',
      serverSeed: sealed ? room.serverSeed : undefined,
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
