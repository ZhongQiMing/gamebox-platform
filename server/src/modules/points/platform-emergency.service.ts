/**
 * 平台池触及下限：全站游戏进入维护，阻止继续下注/派彩扩大亏空。
 * 恢复须管理员手动「全部上架」（见 GameOpsScheduler.forceRestoreAllOnline）。
 */
import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { RedisService } from '../../redis/redis.service';
import { GameConfigCache } from '../game-core/game-config.cache';

export const REDIS_EMERGENCY_MAINT = 'gamebox:ops:emergency-maint';
/** 与 PointsService 抛错文案对齐，便于外层识别 */
export const PLATFORM_FLOOR_HIT_MARKER = 'PLATFORM_FLOOR_HIT';

@Injectable()
export class PlatformEmergencyService {
  private readonly logger = new Logger(PlatformEmergencyService.name);
  private scheduled = false;

  constructor(
    private prisma: PrismaService,
    private redis: RedisService,
    private configCache: GameConfigCache,
  ) {}

  /** 是否处于平台触底紧急维护（Redis 标记） */
  async isEmergencyActive(): Promise<boolean> {
    return !!(await this.redis.get(REDIS_EMERGENCY_MAINT));
  }

  /**
   * 事务内触底时调用：事务回滚后再异步进维护，避免维护写入被同一事务回滚掉。
   */
  scheduleEnterOnPlatformFloor(floor: number) {
    if (this.scheduled) return;
    this.scheduled = true;
    setImmediate(() => {
      void this.enterAllGamesMaintenance(floor)
        .catch((e: Error) =>
          this.logger.error(`紧急维护失败: ${e.message}`, e.stack),
        )
        .finally(() => {
          this.scheduled = false;
        });
    });
  }

  async enterAllGamesMaintenance(floor: number): Promise<{ codes: string[] }> {
    if (await this.isEmergencyActive()) {
      const raw = await this.redis.get(REDIS_EMERGENCY_MAINT);
      this.logger.warn(`紧急维护已生效，跳过重复进入: ${raw}`);
      return { codes: [] };
    }

    const online = await this.prisma.game.findMany({
      where: { status: 'ONLINE' },
      select: { id: true, code: true },
    });

    const codes = online.map((g) => g.code);
    if (codes.length) {
      await this.prisma.game.updateMany({
        where: { id: { in: online.map((g) => g.id) } },
        data: {
          status: 'MAINTENANCE',
          maintenanceSource: 'EMERGENCY',
          maintenanceBatchId: null,
        },
      });
      this.configCache.invalidateAll();
    }

    const payload = JSON.stringify({
      at: new Date().toISOString(),
      floor,
      reason: 'PLATFORM_BALANCE_FLOOR',
      codes,
    });
    /* 无过期：必须人工处理平台池并全部上架后才清 */
    await this.redis.set(REDIS_EMERGENCY_MAINT, payload, 0);

    this.logger.error(
      `平台账户触及下限 ${floor}，全部上架游戏已进维护 codes=${codes.join(',') || '(无)'}`,
    );

    try {
      await this.prisma.adminLog.create({
        data: {
          operatorId: 'SYSTEM',
          action: 'GAME_EMERGENCY_MAINT',
          target: codes.join(',') || 'ALL',
          detail: { floor, reason: 'PLATFORM_BALANCE_FLOOR', codes },
        },
      });
    } catch (e) {
      this.logger.warn(`紧急维护写审计失败: ${(e as Error).message}`);
    }

    return { codes };
  }

  async clearEmergencyFlag() {
    await this.redis.del(REDIS_EMERGENCY_MAINT);
  }
}
