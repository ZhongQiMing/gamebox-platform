import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../../prisma/prisma.service';
import { RoomChatService } from './room-chat.service';
import { CHAT_LOTTERY_GAMES } from './room-chat.types';

@Injectable()
export class RoomChatScheduler {
  private readonly logger = new Logger(RoomChatScheduler.name);
  private locking = false;
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
    } finally {
      this.locking = false;
    }
  }

  /** 机器人氛围下注 */
  @Cron('*/5 * * * * *')
  async robotBets() {
    if (this.robotBusy) return;
    this.robotBusy = true;
    try {
      await this.chat.tickRobotAtmosphere();
    } catch (e) {
      this.logger.warn(`robot atmosphere: ${(e as Error).message}`);
    } finally {
      this.robotBusy = false;
    }
  }
}
