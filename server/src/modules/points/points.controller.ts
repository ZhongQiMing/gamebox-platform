import { Controller, Get, Query, ParseIntPipe, DefaultValuePipe } from '@nestjs/common';
import { asMoney } from '@gamebox/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

@Controller('wallet')
export class PointsController {
  constructor(private prisma: PrismaService) {}

  /** GET /api/wallet/balance — 当前用户余额（两位小数 number） */
  @Get('balance')
  async balance(@CurrentUser() user: { id: string }) {
    const account = await this.prisma.pointsAccount.findUnique({
      where: { ownerId: user.id },
      select: { balance: true },
    });
    return { balance: asMoney(account?.balance ?? 0) };
  }

  /** GET /api/wallet/ledger?page=1&pageSize=20 — 流水列表 */
  @Get('ledger')
  async ledger(
    @CurrentUser() user: { id: string },
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number,
    @Query('pageSize', new DefaultValuePipe(20), ParseIntPipe) pageSize: number,
  ) {
    const account = await this.prisma.pointsAccount.findUnique({
      where: { ownerId: user.id },
      select: { id: true },
    });
    if (!account) return { total: 0, list: [] };

    const [total, list] = await this.prisma.$transaction([
      this.prisma.pointsLedger.count({ where: { accountId: account.id } }),
      this.prisma.pointsLedger.findMany({
        where: { accountId: account.id },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        select: {
          id: true,
          bizType: true,
          amount: true,
          balanceAfter: true,
          remark: true,
          createdAt: true,
        },
      }),
    ]);

    return {
      total,
      page,
      pageSize,
      list: list.map((row) => ({
        ...row,
        amount: asMoney(row.amount),
        balanceAfter: asMoney(row.balanceAfter),
      })),
    };
  }
}
