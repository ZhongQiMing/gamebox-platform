/**
 * LotteryScheduler：定时任务
 *
 *   preCreate  每分钟运行，确保各彩票游戏始终有 3 期待开号
 *   settle     每 5 秒运行，检查到期期号并开奖/结算
 */
import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../../prisma/prisma.service';
import { LotteryService } from './lottery.service';
import { LOTTERY_INTERVALS, lotteryIntervalSec } from './lottery-intervals';

@Injectable()
export class LotteryScheduler {
  private readonly logger = new Logger(LotteryScheduler.name);

  constructor(
    private prisma: PrismaService,
    private lottery: LotteryService,
  ) {}

  /** 每分钟：预创各游戏待开期号（间隔优先读 DB drawIntervalSec） */
  @Cron(CronExpression.EVERY_MINUTE)
  async preCreate() {
    for (const code of Object.keys(LOTTERY_INTERVALS)) {
      const game = await this.prisma.game.findUnique({ where: { code } });
      if (!game || game.status !== 'ONLINE') continue;
      const interval = lotteryIntervalSec(code, game.drawIntervalSec);
      await this.lottery.preCreateIssues(code, interval, 3).catch(e =>
        this.logger.error(`preCreate[${code}] failed: ${e.message}`)
      );
    }
  }

  /** 防重入：上一轮 settle 未跑完时跳过本轮，避免慢结算堆叠 */
  private settling = false;

  /** 每 5 秒：结算到期期号 */
  @Cron('*/5 * * * * *')
  async settle() {
    if (this.settling) return;
    this.settling = true;
    try {
      const now = new Date();
      const due = await this.prisma.lotteryIssue.findMany({
        where: {
          status: { in: ['PENDING', 'LOCKED'] },
          openAt: { lte: now },
        },
        orderBy: { openAt: 'asc' },
        take: 50,
      });

      // 按游戏分组：同游戏组内串行（保期号时序），组间并发（多游戏同时到期不互相阻塞）。
      // draw 内部已有 CAS 抢占，即使并发重入也不会双开奖。
      const groups = new Map<string, typeof due>();
      for (const issue of due) {
        const arr = groups.get(issue.gameId) ?? [];
        arr.push(issue);
        groups.set(issue.gameId, arr);
      }

      await Promise.allSettled(
        [...groups.values()].map(async (issues) => {
          for (const issue of issues) {
            await this.lottery.draw(issue.id).catch((e) =>
              this.logger.error(`settle[${issue.issueNo}] failed: ${e.message}`),
            );
          }
        }),
      );

      // 封盘：lockAt 已过 → LOCKED，并推房间封盘线/注单核对（勿只改状态）
      await this.lottery.lockDueIssues().catch((e) =>
        this.logger.error(`lockDueIssues failed: ${e.message}`),
      );
    } finally {
      this.settling = false;
    }
  }
}
