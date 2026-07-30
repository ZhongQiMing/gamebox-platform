import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../../prisma/prisma.service';
import { RoomChatService } from './room-chat.service';
import { CHAT_LOTTERY_GAMES } from './room-chat.types';

@Injectable()
export class RoomChatScheduler {
  private readonly logger = new Logger(RoomChatScheduler.name);
  private locking = false;
  private openBusy = false;
  private robotBusy = false;

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

  /** 机器人氛围下注 */
  @Cron('*/5 * * * * *')
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
}
