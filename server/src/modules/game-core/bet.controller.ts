import { Controller, Post, Body, Get, Param } from '@nestjs/common';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { SlotEngine } from './slot-engine';
import { IsString, IsInt, IsOptional, Min, Max } from 'class-validator';
import { Type } from 'class-transformer';
import { PrismaService } from '../../prisma/prisma.service';

export class PlaceBetDto {
  @IsString() gameCode!: string;
  @IsInt() @Min(1) @Max(10_000_000) @Type(() => Number) amount!: number;
  @IsOptional() @IsString() clientSeed?: string;
}

@Controller('bet')
export class BetController {
  constructor(
    private slot: SlotEngine,
    private prisma: PrismaService,
  ) {}

  /**
   * POST /api/bet/spin — 电子/街机一键下注+立即开奖（合并两步，客户端体验更简单）
   * 返回：中奖结果 + 新余额
   */
  @Post('spin')
  async spin(@CurrentUser() u: { id: string }, @Body() dto: PlaceBetDto) {
    const { betId, roundId } = await this.slot.placeBet({
      playerId: u.id,
      gameCode: dto.gameCode,
      amount: dto.amount,
      clientSeed: dto.clientSeed,
    });
    const result = await this.slot.settle(roundId);

    // 查最新余额
    const account = await this.prisma.pointsAccount.findUnique({
      where: { ownerId: u.id },
      select: { balance: true },
    });

    return {
      ...result,
      balance: account?.balance ?? 0,
    };
  }

  /** GET /api/bet/history — 下注历史 */
  @Get('history')
  async history(@CurrentUser() u: { id: string }) {
    const list = await this.prisma.bet.findMany({
      where: { playerId: u.id },
      orderBy: { createdAt: 'desc' },
      take: 50,
      select: {
        id: true, betNo: true, amount: true, payout: true, status: true,
        betType: true, settledAt: true, createdAt: true,
        game: { select: { name: true, code: true } },
      },
    });
    return list;
  }

  /** GET /api/bet/round/:id — 查单局详情（可证明公平验证用） */
  @Get('round/:id')
  async round(@Param('id') id: string) {
    return this.prisma.gameRound.findUnique({
      where: { id },
      select: {
        roundNo: true, state: true, outcome: true,
        serverSeed: true, serverSeedHash: true, clientSeed: true, nonce: true,
        startedAt: true, endedAt: true,
        game: { select: { name: true } },
      },
    });
  }
}
