import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

/**
 * 结算事务比 Prisma 默认的 5s 长得多：
 * 一期彩票可能有上千注单，每注都要写账本 + 分佣，且全部要排队等 PLATFORM 行锁。
 * 超时会让整局回滚重来，反而加剧拥塞，所以显式放宽（可用环境变量覆盖）。
 */
const TX_MAX_WAIT_MS = Number(process.env.PRISMA_TX_MAX_WAIT_MS || 15_000);
const TX_TIMEOUT_MS = Number(process.env.PRISMA_TX_TIMEOUT_MS || 120_000);

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  constructor() {
    super({
      transactionOptions: {
        maxWait: TX_MAX_WAIT_MS,
        timeout: TX_TIMEOUT_MS,
      },
    });
  }

  async onModuleInit() {
    await this.$connect();
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}
