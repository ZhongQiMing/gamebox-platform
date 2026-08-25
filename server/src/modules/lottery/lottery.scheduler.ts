/**
 * LotteryScheduler：定时任务
 *
 *   boot       进程启动立即预创 + 结算一轮，避免「进房同步中」空窗
 *   preCreate  每 15 秒确保各彩票始终有足够待开期
 *   settle     每 2 秒检查到期期号并开奖/结算
 */
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../../prisma/prisma.service';
import { RedisService } from '../../redis/redis.service';
import { LotteryService } from './lottery.service';
import { LOTTERY_INTERVALS, lotteryIntervalSec } from './lottery-intervals';
import { inDailyMaintWindow } from '../admin/game-ops.scheduler';

@Injectable()
export class LotteryScheduler implements OnModuleInit {
  private readonly logger = new Logger(LotteryScheduler.name);
  private settling = false;
  private preCreating = false;

  constructor(
    private prisma: PrismaService,
    private lottery: LotteryService,
    private redis: RedisService,
  ) {}

  onModuleInit() {
    /* 启动即灌期号，不等首个 cron；失败不阻塞 Nest 启动 */
    setTimeout(() => {
      void this.preCreate().then(() => this.settle()).catch((e) =>
        this.logger.error(`boot lottery failed: ${e?.message || e}`),
      );
    }, 800);
  }

  /**
   * 每 15 秒：预创各游戏待开期号（间隔优先读 DB drawIntervalSec）。
   * 多实例同时预创会靠期号唯一键互相撞掉，但白扫一遍还是要钱，故只放一台。
   */
  @Cron('*/15 * * * * *')
  async preCreate() {
    if (this.preCreating) return;
    if (inDailyMaintWindow()) return;
    this.preCreating = true;
    try {
      await this.redis.runExclusive(
        'gamebox:cron:lottery-precreate',
        60_000,
        () => this.runPreCreate(),
        { onLockError: 'skip' },
      );
    } finally {
      this.preCreating = false;
    }
  }

  private async runPreCreate() {
    for (const code of Object.keys(LOTTERY_INTERVALS)) {
      const game = await this.prisma.game.findUnique({ where: { code } });
      if (!game || game.status !== 'ONLINE') continue;
      const interval = lotteryIntervalSec(code, game.drawIntervalSec);
      await this.lottery.preCreateIssues(code, interval, 5).catch((e) =>
        this.logger.error(`preCreate[${code}] failed: ${e.message}`),
      );
    }
  }

  /**
   * 每 2 秒：先封盘预开奖，再对 openAt 到期期号正式结算派彩。
   *
   * 进程内的 settling 标志只管得住自己那台，扩到两台就会同时开同一期。
   * 期号状态的 CAS（PENDING/LOCKED → DRAWN）保证只有一台真的派彩，
   * 但另一台会把整批到期期号白扫一遍，两秒一次地翻倍压库；
   * 而且两边的 prepareDraw 会同时挑候选，日志与冷却都会被搅乱。
   *
   * 取锁失败时跳过：这个任务两秒一轮，漏一轮下一轮立刻补上，没有代价。
   */
  @Cron('*/2 * * * * *')
  async settle() {
    if (this.settling) return;
    this.settling = true;
    try {
      await this.redis.runExclusive(
        'gamebox:cron:lottery-settle',
        30_000,
        () => this.runSettle(),
        { onLockError: 'skip' },
      );
    } finally {
      this.settling = false;
    }
  }

  /** 开奖正体：抽出来是为了套跨实例锁，逻辑未变 */
  private async runSettle() {
    {
      const now = new Date();

      /* 1) 封盘 → 预生成号码（动画用），不派彩 */
      await this.lottery.lockDueIssues().catch((e) =>
        this.logger.error(`lockDueIssues failed: ${e.message}`),
      );

      /* 2) 仅 openAt 到期才结算入账（开奖中阶段注单仍 PENDING） */
      const due = await this.prisma.lotteryIssue.findMany({
        where: {
          status: { in: ['PENDING', 'LOCKED'] },
          openAt: { lte: now },
        },
        orderBy: { openAt: 'asc' },
        take: 50,
      });

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
    }
  }
}
