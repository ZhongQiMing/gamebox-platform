import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../../prisma/prisma.service';
import { RoomChatService } from './room-chat.service';
import { CHAT_LOTTERY_GAMES } from './room-chat.types';

/** 聊天记录保留天数：玩家只会往上翻几屏，留半个月足够对账用 */
const CHAT_KEEP_DAYS = Number(process.env.CHAT_KEEP_DAYS || 15);
const CHAT_PRUNE_BATCH = 5000;
/** 单次任务最多删这么多批，剩下的留到明天，避免维护窗被一张表占满 */
const CHAT_PRUNE_MAX_BATCHES = 200;

@Injectable()
export class RoomChatScheduler {
  private readonly logger = new Logger(RoomChatScheduler.name);
  private locking = false;
  private openBusy = false;
  private robotBusy = false;
  private pruning = false;

  constructor(
    private prisma: PrismaService,
    private chat: RoomChatService,
  ) {}

  /**
   * 封盘公告：找出刚进入 LOCKED 且尚未写过 close 的期号。
   * （lottery.scheduler 用 updateMany 批量封盘，这里补聊天写入）
   */
  @Cron('*/3 * * * * *')
  async announceLocks() {
    if (this.locking) return;
    this.locking = true;
    try {
      for (const gameCode of CHAT_LOTTERY_GAMES) {
        const game = await this.prisma.game.findUnique({ where: { code: gameCode } });
        if (!game) continue;
        const locked = await this.prisma.lotteryIssue.findMany({
          where: { gameId: game.id, status: 'LOCKED' },
          orderBy: { lockAt: 'desc' },
          take: 5,
          select: { issueNo: true },
        });
        for (const iss of locked) {
          await this.chat.fanOutIssueLocked(gameCode, iss.issueNo).catch((e) =>
            this.logger.warn(`fanOut lock ${gameCode}/${iss.issueNo}: ${e.message}`),
          );
        }
      }
      await this.tickDueOpens();
    } finally {
      this.locking = false;
    }
  }

  /** 开盘线：全局单飞，避免 announceLocks 与 robot 定时器并发各写一条 */
  private async tickDueOpens() {
    if (this.openBusy) return;
    this.openBusy = true;
    try {
      await this.chat.fanOutDueOpens();
    } catch (e) {
      this.logger.warn(`fanOut opens: ${(e as Error).message}`);
    } finally {
      this.openBusy = false;
    }
  }

  private fundTalkBusy = false;

  /** 机器人氛围下注（2s 一轮，便于高峰把人数刷满） */
  @Cron('*/2 * * * * *')
  async robotBets() {
    if (this.robotBusy) return;
    this.robotBusy = true;
    try {
      /* 开盘线只在 announceLocks 链路写；这里不再 fanOutDueOpens，杜绝双开盘线 */
      await this.chat.tickRobotAtmosphere();
    } catch (e) {
      this.logger.warn(`robot atmosphere: ${(e as Error).message}`);
    } finally {
      this.robotBusy = false;
    }
  }

  /** 机器人上下分闲聊（氛围，不真上下分） */
  @Cron('*/8 * * * * *')
  async robotFundTalk() {
    if (this.fundTalkBusy) return;
    this.fundTalkBusy = true;
    try {
      await this.chat.tickRobotFundTalk();
    } catch (e) {
      this.logger.warn(`robot fund talk: ${(e as Error).message}`);
    } finally {
      this.fundTalkBusy = false;
    }
  }

  /**
   * 每日 04:20（上海，维护窗内）清理过期聊天。
   *
   * 这张表每期每房都在写，机器人氛围还在加码，是全库增长最快的一张。
   * 没人会去翻两周前的房间闲聊，但它会一路把备份体积和磁盘吃掉。
   * 分批删：一次性 DELETE 上百万行会长时间持锁，把开奖一起卡住。
   */
  @Cron('20 4 * * *', { timeZone: 'Asia/Shanghai' })
  async pruneOldChat() {
    if (this.pruning) return;
    this.pruning = true;
    const cutoff = new Date(Date.now() - CHAT_KEEP_DAYS * 24 * 60 * 60 * 1000);
    let removed = 0;
    try {
      for (let i = 0; i < CHAT_PRUNE_MAX_BATCHES; i++) {
        const batch = await this.prisma.$executeRaw`
          DELETE FROM "RoomChatMessage"
          WHERE "id" IN (
            SELECT "id" FROM "RoomChatMessage"
            WHERE "createdAt" < ${cutoff}
            LIMIT ${CHAT_PRUNE_BATCH}
          )
        `;
        removed += batch;
        if (batch < CHAT_PRUNE_BATCH) break;
      }
      if (removed) {
        this.logger.log(`chat prune: 删除 ${removed} 条（早于 ${cutoff.toISOString()}）`);
      }
    } catch (e) {
      this.logger.warn(`chat prune: ${(e as Error).message}`);
    } finally {
      this.pruning = false;
    }
  }
}
