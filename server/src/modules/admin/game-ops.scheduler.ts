/**
 * 平台游戏运维定时（Asia/Shanghai）：
 *   00:00  日切：期号按自然日重新计数；清理跨日空待开期
 *   04:00  进入每日维护窗：仅把「上架」游戏切到维护（不碰手动下架/维护）
 *          → 立刻停新注/新期；牌桌本局结算完后进 PAUSED，不强行掐局
 *   06:01  结束维护窗：只恢复本窗内自动维护的游戏；牌台 PAUSED 自动开新局
 *
 * 与回水 06:00 错开 1 分钟。彩票预创由 LotteryScheduler 每 15s 自行补齐。
 */
import { BadRequestException, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { RedisService } from '../../redis/redis.service';
import { GameConfigCache } from '../game-core/game-config.cache';
import { LOTTERY_INTERVALS } from '../lottery/lottery-intervals';
import { AdminLogService } from './admin-log.service';
import {
  PlatformEmergencyService,
  REDIS_EMERGENCY_MAINT,
} from '../points/platform-emergency.service';

const REDIS_MAINT_CODES = 'gamebox:ops:daily-maint-codes';
const SH_TZ = 'Asia/Shanghai';

export const GAME_OPS_SCHEDULE = {
  timezone: SH_TZ,
  dayCut: {
    cron: '0 0 * * *',
    label: '每天 00:00',
    desc: '期号按上海自然日从头计数；流水/账单按日切统计',
  },
  maintStart: {
    cron: '0 4 * * *',
    label: '每天 04:00',
    desc: '全站进入维护（仅自动关闭当时上架中的游戏）',
  },
  maintEnd: {
    cron: '1 6 * * *',
    label: '每天 06:01',
    desc: '结束维护，恢复凌晨自动关闭的游戏（与回水 06:00 错开）',
  },
  maintWindow: '04:00 ～ 06:01',
} as const;

const MAINT_START_MIN = 4 * 60;
const MAINT_END_MIN = 6 * 60 + 1; // 06:01，与结束 cron 对齐

export function dailyMaintDisabled(): boolean {
  const v = (process.env.DISABLE_DAILY_MAINT || '').trim().toLowerCase();
  return v === '1' || v === 'true' || v === 'yes';
}

export function shanghaiDateKey(d = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: SH_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d);
}

export function shanghaiClockMinutes(d = new Date()): number {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: SH_TZ,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(d);
  const h = Number(parts.find((p) => p.type === 'hour')?.value ?? 0);
  const m = Number(parts.find((p) => p.type === 'minute')?.value ?? 0);
  return h * 60 + m;
}

/** 上海 [04:00, 06:01)；DISABLE_DAILY_MAINT=1 时恒为 false */
export function inDailyMaintWindow(d = new Date()): boolean {
  if (dailyMaintDisabled()) return false;
  const mins = shanghaiClockMinutes(d);
  return mins >= MAINT_START_MIN && mins < MAINT_END_MIN;
}

/** 距今日 06:01 的剩余秒；窗外为 0 */
export function dailyMaintRemainSec(d = new Date()): number {
  if (!inDailyMaintWindow(d)) return 0;
  const end = new Date(`${shanghaiDateKey(d)}T06:01:00+08:00`);
  return Math.max(0, Math.floor((end.getTime() - d.getTime()) / 1000));
}

@Injectable()
export class GameOpsScheduler implements OnModuleInit {
  private readonly logger = new Logger(GameOpsScheduler.name);
  private dayCutting = false;
  private maintBusy = false;

  constructor(
    private prisma: PrismaService,
    private redis: RedisService,
    private configCache: GameConfigCache,
    private adminLog: AdminLogService,
    private platformEmergency: PlatformEmergencyService,
  ) {}

  onModuleInit() {
    /* 重启后对齐维护窗（漏跑 cron / Redis 残留） */
    setTimeout(() => {
      void this.reconcileMaintenanceWindow().catch((e: Error) =>
        this.logger.error(`reconcile maint: ${e.message}`),
      );
    }, 2500);
  }

  /** 管理端展示用 */
  getScheduleInfo() {
    return {
      timezone: GAME_OPS_SCHEDULE.timezone,
      items: [
        {
          key: 'dayCut',
          ...GAME_OPS_SCHEDULE.dayCut,
        },
        {
          key: 'maintStart',
          ...GAME_OPS_SCHEDULE.maintStart,
          window: GAME_OPS_SCHEDULE.maintWindow,
        },
        {
          key: 'maintEnd',
          ...GAME_OPS_SCHEDULE.maintEnd,
          window: GAME_OPS_SCHEDULE.maintWindow,
        },
      ],
      notes: [
        '期号（彩票/桌台）按上海日历日自动重计，无需手工重置。',
        '每日 04:00–06:01 维护窗只动「当时上架」的游戏；你手动维护/下架的不受影响。',
        '进维护后立刻停新注/新期；牌桌本局会结算完再暂停开局，不会中途掐结算踢人。',
        '报表「今日」流水、输赢按上海自然日切分，与 00:00 日切对齐。',
        '平台账户触及下限时会紧急全站维护，须处理后再点「全部上架」；06:01 不会自动恢复。',
      ],
    };
  }

  /** 上海自然日 yyyy-mm-dd */
  private shanghaiDateKey(d = new Date()): string {
    return shanghaiDateKey(d);
  }

  /** 临时跳过每日维护窗（.env DISABLE_DAILY_MAINT=1） */
  private dailyMaintDisabled(): boolean {
    return dailyMaintDisabled();
  }

  /** 是否在 [04:00, 06:01) */
  private inMaintWindow(d = new Date()): boolean {
    return inDailyMaintWindow(d);
  }

  private shanghaiDayStart(d = new Date()): Date {
    return new Date(`${this.shanghaiDateKey(d)}T00:00:00+08:00`);
  }

  private async systemOperatorId(): Promise<string | null> {
    const admin = await this.prisma.user.findFirst({
      where: { role: 'ADMIN', status: 'ACTIVE' },
      select: { id: true },
      orderBy: { createdAt: 'asc' },
    });
    return admin?.id ?? null;
  }

  private async safeLog(action: string, target: string, detail?: object) {
    const op = await this.systemOperatorId();
    if (!op) return;
    await this.adminLog.log(op, action, target, detail).catch((e: Error) =>
      this.logger.warn(`adminLog ${action}: ${e.message}`),
    );
  }

  async reconcileMaintenanceWindow() {
    if (this.inMaintWindow()) {
      const batch = await this.resolveAutoMaintBatch();
      const online = await this.prisma.game.findMany({
        where: { status: 'ONLINE' },
        select: { id: true, code: true },
      });
      if (!batch) {
        this.logger.warn('boot reconcile: inside maint window without valid AUTO batch → enter');
        await this.enterDailyMaintenance();
      } else if (online.length) {
        /*
         * Redis marker 不能证明库状态完整。重启期间仍 ONLINE 的游戏并入数据库权威批次；
         * 查询只选 ONLINE，因此不会触碰 MANUAL / EMERGENCY 维护。
         */
        await this.prisma.game.updateMany({
          where: { id: { in: online.map((game) => game.id) }, status: 'ONLINE' },
          data: {
            status: 'MAINTENANCE',
            maintenanceSource: 'AUTO',
            maintenanceBatchId: batch.batchId,
          },
        });
        const codes = [...new Set([...batch.codes, ...online.map((game) => game.code)])];
        await this.redis
          .set(
            REDIS_MAINT_CODES,
            JSON.stringify({ batchId: batch.batchId, codes }),
            26 * 3600,
          )
          .catch((e: Error) => this.logger.warn(`refresh maint marker: ${e.message}`));
        this.configCache.invalidateAll();
        this.logger.warn(
          `boot reconcile: joined ${online.length} ONLINE games into AUTO batch ${batch.batchId}`,
        );
      }
      return;
    }
    /* 窗外只恢复持久化标记为 AUTO 的批次；人工/紧急维护绝不参与 */
    const raw = await this.redis.get(REDIS_MAINT_CODES);
    const autoStuck = await this.prisma.game.count({
      where: { status: 'MAINTENANCE', maintenanceSource: 'AUTO' },
    });
    if (raw || autoStuck > 0) {
      this.logger.warn(
        `boot reconcile: outside maint window (redis=${!!raw}, autoMaint=${autoStuck}) → exit`,
      );
      await this.exitDailyMaintenance();
    }
  }

  /** 解析本次自动维护批次：数据库来源+最新批次是唯一权威，Redis 不参与选择 */
  private async resolveAutoMaintBatch(): Promise<{ batchId: string; codes: string[] } | null> {
    const latest = await this.prisma.game.findFirst({
      where: {
        status: 'MAINTENANCE',
        maintenanceSource: 'AUTO',
        maintenanceBatchId: { not: null },
      },
      orderBy: { updatedAt: 'desc' },
      select: { maintenanceBatchId: true },
    });
    const batchId = String(latest?.maintenanceBatchId || '').trim();
    if (!batchId) return null;
    const rows = await this.prisma.game.findMany({
      where: {
        status: 'MAINTENANCE',
        maintenanceSource: 'AUTO',
        maintenanceBatchId: batchId,
      },
      select: { code: true },
    });
    return rows.length ? { batchId, codes: rows.map((row) => row.code) } : null;
  }

  /**
   * 00:00 日切
   * 期号算法本身按上海 0 点重计；这里清理跨日空期待开，保证大厅立刻切到今日期。
   */
  @Cron(GAME_OPS_SCHEDULE.dayCut.cron, { timeZone: SH_TZ })
  async onShanghaiDayCut() {
    if (this.dayCutting) return;
    this.dayCutting = true;
    const dayKey = this.shanghaiDateKey();
    const dayStart = this.shanghaiDayStart();
    try {
      /* 进程内标志只管自己那台；扩到两台会同时删期号、写两遍日志，取锁失败宁可不跑 */
      await this.redis.runExclusive(
        `gamebox:cron:day-cut:${dayKey}`,
        10 * 60 * 1000,
        () => this.runDayCut(dayKey, dayStart),
        { onLockError: 'skip' },
      );
    } catch (e) {
      this.logger.error(`dayCut failed: ${(e as Error).message}`);
    } finally {
      this.dayCutting = false;
    }
  }

  private async runDayCut(dayKey: string, dayStart: Date) {
    {
      const lotteryCodes = Object.keys(LOTTERY_INTERVALS);
      const games = await this.prisma.game.findMany({
        where: { code: { in: lotteryCodes } },
        select: { id: true, code: true },
      });

      let purged = 0;
      for (const g of games) {
        const stale = await this.prisma.lotteryIssue.findMany({
          where: {
            gameId: g.id,
            status: { in: ['PENDING', 'LOCKED'] },
            openAt: { lt: dayStart },
          },
          select: { id: true, _count: { select: { bets: true } } },
        });
        const emptyIds = stale.filter((r) => r._count.bets === 0).map((r) => r.id);
        if (emptyIds.length) {
          const del = await this.prisma.lotteryIssue.deleteMany({ where: { id: { in: emptyIds } } });
          purged += del.count;
        }
      }

      this.logger.log(`Shanghai day-cut ${dayKey}: purgedEmptyIssues=${purged}, lottery=${games.length}`);
      await this.safeLog('GAME_DAY_CUT', dayKey, {
        purgedEmptyIssues: purged,
        lotteryCodes: games.map((g) => g.code),
        note: '期号按上海自然日 MMDD+序号重计；流水/账单按日切统计',
      });
    }
  }

  /** 04:00 进入维护窗 */
  @Cron(GAME_OPS_SCHEDULE.maintStart.cron, { timeZone: SH_TZ })
  async enterDailyMaintenance() {
    if (this.dailyMaintDisabled()) {
      this.logger.warn('daily maint start skipped: DISABLE_DAILY_MAINT=1');
      return;
    }
    if (this.maintBusy) return;
    this.maintBusy = true;
    try {
      /* 多实例同时进维护会各生成一个 batchId，退出时只认得回其中一个 */
      await this.redis.runExclusive(
        `gamebox:cron:maint-start:${this.shanghaiDateKey()}`,
        10 * 60 * 1000,
        () => this.runEnterMaintenance(),
        { onLockError: 'skip' },
      );
    } catch (e) {
      this.logger.error(`daily maint start failed: ${(e as Error).message}`);
    } finally {
      this.maintBusy = false;
    }
  }

  private async runEnterMaintenance() {
    {
      const online = await this.prisma.game.findMany({
        where: { status: 'ONLINE' },
        select: { id: true, code: true },
      });
      if (!online.length) {
        await this.redis.del(REDIS_MAINT_CODES);
        this.logger.log('daily maint start: no ONLINE games');
        return;
      }

      const codes = online.map((g) => g.code);
      const batchId = randomUUID();
      await this.prisma.game.updateMany({
        where: { id: { in: online.map((g) => g.id) } },
        data: {
          status: 'MAINTENANCE',
          maintenanceSource: 'AUTO',
          maintenanceBatchId: batchId,
        },
      });
      /* TTL 覆盖到次日维护窗，避免 4h 过期后 06:01/重启无法恢复 */
      await this.redis.set(
        REDIS_MAINT_CODES,
        JSON.stringify({ batchId, codes }),
        26 * 3600,
      );
      this.configCache.invalidateAll();

      this.logger.log(`daily maint start: ${codes.join(',')}`);
      await this.safeLog('GAME_DAILY_MAINT_START', codes.join(','), {
        codes,
        batchId,
        window: GAME_OPS_SCHEDULE.maintWindow,
      });
    }
  }

  /** 06:01 结束维护窗（错开回水 06:00）；窗外启动也会走这里恢复卡死维护 */
  @Cron(GAME_OPS_SCHEDULE.maintEnd.cron, { timeZone: SH_TZ })
  async exitDailyMaintenance() {
    if (this.maintBusy) return;
    this.maintBusy = true;
    try {
      /*
       * 这一条刻意保持「取锁失败也跑」，跟进维护窗相反。
       * 恢复上架是幂等的，多跑一次没有代价；跳过却会让全部游戏一直停在维护中，
       * 那是比重复执行严重得多的后果。
       */
      await this.redis.runExclusive(
        `gamebox:cron:maint-end:${this.shanghaiDateKey()}`,
        10 * 60 * 1000,
        () => this.runExitMaintenance(),
        { onLockError: 'run' },
      );
    } catch (e) {
      this.logger.error(`daily maint end failed: ${(e as Error).message}`);
    } finally {
      this.maintBusy = false;
    }
  }

  private async runExitMaintenance() {
    {
      if (await this.platformEmergency.isEmergencyActive()) {
        this.logger.warn(
          `daily maint end skipped: emergency active (${REDIS_EMERGENCY_MAINT})`,
        );
        return;
      }
      if (this.inMaintWindow()) {
        this.logger.log('daily maint end skipped: still inside window');
        return;
      }

      const batch = await this.resolveAutoMaintBatch();
      if (!batch?.codes.length) {
        await this.redis.del(REDIS_MAINT_CODES);
        this.logger.log('daily maint end: no scheduled codes');
        return;
      }
      const { batchId, codes } = batch;

      const restored = await this.prisma.game.updateMany({
        where: {
          code: { in: codes },
          status: 'MAINTENANCE',
          maintenanceSource: 'AUTO',
          maintenanceBatchId: batchId,
        },
        data: { status: 'ONLINE', maintenanceSource: null, maintenanceBatchId: null },
      });
      await this.redis.del(REDIS_MAINT_CODES);
      this.configCache.invalidateAll();

      this.logger.log(`daily maint end: restored=${restored.count} codes=${codes.join(',')}`);
      await this.safeLog('GAME_DAILY_MAINT_END', codes.join(','), {
        codes,
        batchId,
        restored: restored.count,
      });
    }
  }

  /**
   * 管理端手动：把仍处维护的游戏全部拉回上架（需有生效配置），并清掉自动维护标记。
   * 用于 Redis/定时任务异常导致全站卡在「维护中」。
   */
  async forceRestoreAllOnline(): Promise<{ restored: number; codes: string[] }> {
    const emergency = await this.platformEmergency.isEmergencyActive();
    if (!emergency && this.inMaintWindow()) {
      throw new BadRequestException('当前处于每日维护窗（04:00–06:01），请过窗后再全部上架');
    }
    const stuck = await this.prisma.game.findMany({
      where: {
        status: 'MAINTENANCE',
        configs: { some: { active: true } },
      },
      select: { code: true },
    });
    const codes = stuck.map((g) => g.code);
    if (!codes.length) {
      await this.redis.del(REDIS_MAINT_CODES);
      await this.platformEmergency.clearEmergencyFlag();
      return { restored: 0, codes: [] };
    }
    const restored = await this.prisma.game.updateMany({
      where: { code: { in: codes }, status: 'MAINTENANCE' },
      data: { status: 'ONLINE', maintenanceSource: null, maintenanceBatchId: null },
    });
    await this.redis.del(REDIS_MAINT_CODES);
    await this.platformEmergency.clearEmergencyFlag();
    this.configCache.invalidateAll();
    await this.safeLog('GAME_FORCE_RESTORE_ONLINE', codes.join(','), {
      codes,
      restored: restored.count,
      clearedEmergency: emergency,
    });
    return { restored: restored.count, codes };
  }
}
