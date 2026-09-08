import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { ensurePgUtcTimezone } from './pg-utc-timezone';

/**
 * 结算事务比 Prisma 默认的 5s 长得多：
 * 一期彩票可能有上千注单，每注都要写账本 + 分佣，且全部要排队等 PLATFORM 行锁。
 * 超时会让整局回滚重来，反而加剧拥塞，所以显式放宽（可用环境变量覆盖）。
 */
const TX_MAX_WAIT_MS = Number(process.env.PRISMA_TX_MAX_WAIT_MS || 15_000);
const TX_TIMEOUT_MS = Number(process.env.PRISMA_TX_TIMEOUT_MS || 120_000);

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);

  constructor() {
    const databaseUrl = process.env.DATABASE_URL
      ? ensurePgUtcTimezone(process.env.DATABASE_URL)
      : undefined;
    super({
      ...(databaseUrl ? { datasourceUrl: databaseUrl } : {}),
      transactionOptions: {
        maxWait: TX_MAX_WAIT_MS,
        timeout: TX_TIMEOUT_MS,
      },
    });
  }

  async onModuleInit() {
    /* 进程启动时连库；Prisma Client 须已 generate */
    await this.$connect();
    await this.assertUtcTimezone();
  }

  /**
   * 连接串 options 会给每条新连接钉 UTC；这里再核一次，
   * 免得 PgBouncer / 宝塔把 options 吃掉后日切悄悄偏 8 小时。
   */
  private async assertUtcTimezone() {
    try {
      await this.$executeRawUnsafe(`SET TIME ZONE 'UTC'`);
      const rows = await this.$queryRaw<Array<{ tz: string }>>`
        SELECT current_setting('TimeZone') AS tz
      `;
      const tz = String(rows[0]?.tz || '');
      if (!/^(UTC|Etc\/UTC|GMT|Etc\/GMT)$/i.test(tz)) {
        this.logger.error(
          `Postgres TimeZone=${tz}，报表「今日」会按会话时区再偏移。请把 DATABASE_URL 加上 options=-c TimeZone=UTC，或把库时区改为 UTC`,
        );
      }
    } catch (e) {
      this.logger.warn(`无法核对 Postgres TimeZone：${(e as Error).message}`);
    }
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}
