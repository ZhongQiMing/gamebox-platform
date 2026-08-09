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
  maintWindow: '04:00 ～ 06:00',
} as const;

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
        '每日 04:00–06:00 维护窗只动「当时上架」的游戏；你手动维护/下架的不受影响。',
        '进维护后立刻停新注/新期；牌桌本局会结算完再暂停开局，不会中途掐结算踢人。',
        '报表「今日」流水、输赢按上海自然日切分，与 00:00 日切对齐。',
        '平台账户触及下限时会紧急全站维护，须处理后再点「全部上架」；06:01 不会自动恢复。',
      ],
    };
  }

  /** 上海自然日 yyyy-mm-dd */
  private shanghaiDateKey(d = new Date()): string {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: SH_TZ,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(d);
  }

  private shanghaiMinutes(d = new Date()): number {
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

  /** 临时跳过每日维护窗（.env DISABLE_DAILY_MAINT=1） */
  private dailyMaintDisabled(): boolean {
    const v = (process.env.DISABLE_DAILY_MAINT || '').trim().toLowerCase();
    return v === '1' || v === 'true' || v === 'yes';
  }

  /** 是否在 [04:00, 06:00) */
  private inMaintWindow(d = new Date()): boolean {
    if (this.dailyMaintDisabled()) return false;
    const mins = this.shanghaiMinutes(d);
    return mins >= 4 * 60 && mins < 6 * 60;
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
      const raw = await this.redis.get(REDIS_MAINT_CODES);
      if (!raw) {
        this.logger.warn('boot reconcile: inside maint window without Redis marker → enter');
        await this.enterDailyMaintenance();
      }
      return;
    }
    /* 窗外：有 Redis 标记、或 Redis 丢失但库里仍卡在维护 → 都尝试恢复 */
    const raw = await this.redis.get(REDIS_MAINT_CODES);
    const stuck = await this.prisma.game.count({ where: { status: 'MAINTENANCE' } });
    if (raw || stuck > 0) {
      this.logger.warn(
        `boot reconcile: outside maint window (redis=${!!raw}, stuckMaint=${stuck}) → exit`,
      );
      await this.exitDailyMaintenance();
    }
  }

  /** 解析本次自动维护的游戏码：Redis → 当日 START 日志 → 当前仍维护的游戏 */
  private async resolveAutoMaintCodes(): Promise<string[]> {
    const raw = await this.redis.get(REDIS_MAINT_CODES);
    if (raw) {
      try {
        const codes = JSON.parse(raw) as string[];
        if (Array.isArray(codes) && codes.length) return codes.filter((c) => !!c);
      } catch {
        /* fall through */
      }
    }

    const dayStart = this.shanghaiDayStart();
    const startLog = await this.prisma.adminLog.findFirst({
      where: { action: 'GAME_DAILY_MAINT_START', createdAt: { gte: dayStart } },
      orderBy: { createdAt: 'desc' },
      select: { createdAt: true, detail: true, target: true },
    });
    if (startLog) {
      const endAfter = await this.prisma.adminLog.findFirst({
        where: {
          action: 'GAME_DAILY_MAINT_END',
          createdAt: { gte: startLog.createdAt },
        },
        select: { id: true },
      });
      if (!endAfter) {
        const detail = (startLog.detail ?? {}) as { codes?: string[] };
        if (Array.isArray(detail.codes) && detail.codes.length) return detail.codes;
        if (startLog.target) {
          return startLog.target.split(',').map((s) => s.trim()).filter(Boolean);
        }
      }
    }

    /* Redis/日志都丢了：窗外仍维护的视为卡死的自动维护，全部拉回上架 */
    const stuck = await this.prisma.game.findMany({
      where: { status: 'MAINTENANCE' },
      select: { code: true },
    });
    return stuck.map((g) => g.code);
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
    } catch (e) {
      this.logger.error(`dayCut failed: ${(e as Error).message}`);
    } finally {
      this.dayCutting = false;
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
      await this.prisma.game.updateMany({
        where: { id: { in: online.map((g) => g.id) } },
        data: { status: 'MAINTENANCE' },
      });
      /* TTL 覆盖到次日维护窗，避免 4h 过期后 06:01/重启无法恢复 */
      await this.redis.set(REDIS_MAINT_CODES, JSON.stringify(codes), 26 * 3600);
      this.configCache.invalidateAll();

      this.logger.log(`daily maint start: ${codes.join(',')}`);
      await this.safeLog('GAME_DAILY_MAINT_START', codes.join(','), {
        codes,
        window: GAME_OPS_SCHEDULE.maintWindow,
      });
    } catch (e) {
      this.logger.error(`enterDailyMaintenance failed: ${(e as Error).message}`);
    } finally {
      this.maintBusy = false;
    }
  }

  /** 06:01 结束维护窗（错开回水 06:00）；窗外启动也会走这里恢复卡死维护 */
  @Cron(GAME_OPS_SCHEDULE.maintEnd.cron, { timeZone: SH_TZ })
  async exitDailyMaintenance() {
    if (this.maintBusy) return;
    this.maintBusy = true;
    try {
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

      const codes = await this.resolveAutoMaintCodes();
      if (!codes.length) {
        this.logger.log('daily maint end: no scheduled codes');
        return;
      }

      const restored = await this.prisma.game.updateMany({
        where: { code: { in: codes }, status: 'MAINTENANCE' },
        data: { status: 'ONLINE' },
      });
      await this.redis.del(REDIS_MAINT_CODES);
      this.configCache.invalidateAll();

      this.logger.log(`daily maint end: restored=${restored.count} codes=${codes.join(',')}`);
      await this.safeLog('GAME_DAILY_MAINT_END', codes.join(','), {
        codes,
        restored: restored.count,
      });
    } catch (e) {
      this.logger.error(`exitDailyMaintenance failed: ${(e as Error).message}`);
    } finally {
      this.maintBusy = false;
    }
  }

  /**
   * 管理端手动：把仍处维护的游戏全部拉回上架（需有生效配置），并清掉自动维护标记。
   * 用于 Redis/定时任务异常导致全站卡在「维护中」。
   */
  async forceRestoreAllOnline(): Promise<{ restored: number; codes: string[] }> {
    const emergency = await this.platformEmergency.isEmergencyActive();
    if (!emergency && this.inMaintWindow()) {
      throw new BadRequestException('当前处于每日维护窗（04:00–06:00），请过窗后再全部上架');
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
      data: { status: 'ONLINE' },
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
