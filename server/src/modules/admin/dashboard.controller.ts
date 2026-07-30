import { Controller, Get, Query } from '@nestjs/common';
import { asMoney } from '@gamebox/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { Roles } from '../../common/decorators/roles.decorator';
import { PLATFORM_OWNER_ID } from '../points/points.service';

@Controller('admin/dashboard')
@Roles('ADMIN', 'BRANCH')
export class DashboardController {
  constructor(private prisma: PrismaService) {}

  @Get('stats')
  async stats() {
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());

    const [
      totalPlayers,
      todayNew,
      platformAccount,
      todayBetAgg,
      todayWinAgg,
      pendingRecharge,
      pendingWithdraw,
    ] = await this.prisma.$transaction([
      this.prisma.user.count({ where: { role: 'PLAYER' } }),
      this.prisma.user.count({ where: { role: 'PLAYER', createdAt: { gte: todayStart } } }),
      this.prisma.pointsAccount.findUnique({ where: { ownerId: PLATFORM_OWNER_ID } }),
      this.prisma.pointsLedger.aggregate({
        where: {
          bizType: 'BET', createdAt: { gte: todayStart },
          account: { ownerId: PLATFORM_OWNER_ID },
        },
        _sum: { amount: true },
      }),
      this.prisma.pointsLedger.aggregate({
        where: {
          bizType: 'WIN', createdAt: { gte: todayStart },
          account: { ownerId: PLATFORM_OWNER_ID },
        },
        _sum: { amount: true },
      }),
      this.prisma.rechargeOrder.count({ where: { status: 'PENDING', type: 'UP' } }),
      this.prisma.rechargeOrder.count({ where: { status: 'PENDING', type: 'DOWN' } }),
    ]);

    // 今日 BET 流水（进入平台的部分）
    const todayBetFlow = asMoney(todayBetAgg._sum.amount ?? 0);
    // 今日盈亏 = 流水进 + 胜率出（WIN 是负数，自然相加）
    const todayWinOut = asMoney(todayWinAgg._sum.amount ?? 0);
    const todayPnl = todayBetFlow + todayWinOut;

    // 今日活跃（有下注的玩家数，排除平台账户）
    const activeTodayGroups = await this.prisma.pointsLedger.groupBy({
      by: ['accountId'],
      where: {
        bizType: 'BET', createdAt: { gte: todayStart },
        account: { ownerType: 'PLAYER' },
      },
    });

    return {
      totalPlayers,
      todayNew,
      activeToday: activeTodayGroups.length,
      platformBalance: asMoney(platformAccount?.balance ?? 0),
      todayBetFlow,
      todayPnl,
      pendingRecharge,
      pendingWithdraw,
    };
  }

  @Get('trend')
  async trend(@Query('days') daysStr = '7') {
    const days = Math.min(Math.max(parseInt(daysStr) || 7, 1), 90);
    const result = [];
    const now = new Date();

    for (let i = days - 1; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i);
      const dEnd = new Date(d.getTime() + 86400_000);

      const [betAgg, winAgg, newUsers] = await this.prisma.$transaction([
        this.prisma.pointsLedger.aggregate({
          where: {
            bizType: 'BET', createdAt: { gte: d, lt: dEnd },
            account: { ownerId: PLATFORM_OWNER_ID },
          },
          _sum: { amount: true },
        }),
        this.prisma.pointsLedger.aggregate({
          where: {
            bizType: 'WIN', createdAt: { gte: d, lt: dEnd },
            account: { ownerId: PLATFORM_OWNER_ID },
          },
          _sum: { amount: true },
        }),
        this.prisma.user.count({ where: { role: 'PLAYER', createdAt: { gte: d, lt: dEnd } } }),
      ]);

      const betFlow = asMoney(betAgg._sum.amount ?? 0);
      const winOut  = asMoney(winAgg._sum.amount ?? 0);
      result.push({
        date: d.toISOString().slice(0, 10),
        betFlow,
        pnl: betFlow + winOut,
        newUsers,
      });
    }
    return result;
  }
}
