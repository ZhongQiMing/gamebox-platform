import { BadRequestException, Controller, Get, Query, ParseIntPipe, DefaultValuePipe } from '@nestjs/common';
import { asMoney, roundMoney } from '@gamebox/shared';
import type { LedgerBizType, Prisma } from '@prisma/client';
import { resolveTimeWindow } from '../../common/shanghai-range';
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

  /**
   * GET /api/wallet/ledger
   * range=today|… 或 from/to 毫秒；bizTypes 逗号分隔。
   */
  @Get('ledger')
  async ledger(
    @CurrentUser() user: { id: string },
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number,
    @Query('pageSize', new DefaultValuePipe(50), ParseIntPipe) pageSize: number,
    @Query('range') rangeKey?: string,
    @Query('from') fromStr?: string,
    @Query('to') toStr?: string,
    @Query('bizTypes') bizTypesStr?: string,
  ) {
    const account = await this.prisma.pointsAccount.findUnique({
      where: { ownerId: user.id },
      select: { id: true },
    });
    if (!account) {
      return {
        total: 0,
        page,
        pageSize,
        summary: { count: 0, income: 0, expense: 0, net: 0 },
        list: [],
      };
    }

    const where: Prisma.PointsLedgerWhereInput = { accountId: account.id };

    const window = resolveTimeWindow({
      range: rangeKey,
      fromMs: fromStr != null && fromStr !== '' ? Number(fromStr) : undefined,
      toMs: toStr != null && toStr !== '' ? Number(toStr) : undefined,
    });
    if (rangeKey && !window) {
      throw new BadRequestException('无效的时间范围');
    }
    if (window) {
      const [from, to] = window;
      where.createdAt = { gte: from, lt: to };
    }

    const bizTypes = (bizTypesStr || '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    if (bizTypes.length) {
      where.bizType = { in: bizTypes as LedgerBizType[] };
    }

    const take = Math.min(Math.max(pageSize, 1), 200);
    const skip = (Math.max(page, 1) - 1) * take;

    const [total, list, incomeAgg, expenseAgg] = await this.prisma.$transaction([
      this.prisma.pointsLedger.count({ where }),
      this.prisma.pointsLedger.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take,
        select: {
          id: true,
          bizType: true,
          amount: true,
          balanceAfter: true,
          remark: true,
          createdAt: true,
        },
      }),
      this.prisma.pointsLedger.aggregate({
        where: { ...where, amount: { gt: 0 } },
        _sum: { amount: true },
        _count: { _all: true },
      }),
      this.prisma.pointsLedger.aggregate({
        where: { ...where, amount: { lt: 0 } },
        _sum: { amount: true },
        _count: { _all: true },
      }),
    ]);

    const income = asMoney(incomeAgg._sum.amount ?? 0);
    const expenseAbs = Math.abs(asMoney(expenseAgg._sum.amount ?? 0));
    const net = roundMoney(income - expenseAbs);

    return {
      total,
      page: Math.max(page, 1),
      pageSize: take,
      summary: {
        count: total,
        income,
        expense: expenseAbs,
        net,
        incomeCount: incomeAgg._count._all,
        expenseCount: expenseAgg._count._all,
      },
      list: list.map((row) => ({
        ...row,
        amount: asMoney(row.amount),
        balanceAfter: asMoney(row.balanceAfter),
      })),
    };
  }
}
