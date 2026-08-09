import { BadRequestException, Controller, Get, Query, ParseIntPipe, DefaultValuePipe } from '@nestjs/common';
import { asMoney, roundMoney } from '@gamebox/shared';
import type { LedgerBizType, Prisma } from '@prisma/client';
import { resolveTimeWindow } from '../../common/shanghai-range';
import { PrismaService } from '../../prisma/prisma.service';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { PointsService } from './points.service';

@Controller('wallet')
export class PointsController {
  constructor(
    private prisma: PrismaService,
    private points: PointsService,
  ) {}

  /** 解析 PLAYER 运营房间：roomId 或 roomNo（须为 APPROVED 成员） */
  private async resolvePlayerRoomId(
    playerId: string,
    roomIdRaw?: string,
    roomNoRaw?: string,
  ): Promise<string> {
    const roomId = String(roomIdRaw || '').trim();
    if (roomId) {
      const member = await this.prisma.roomMember.findFirst({
        where: { playerId, roomId, status: 'APPROVED' },
        select: { roomId: true },
      });
      if (!member) throw new BadRequestException('未加入该房间或未通过审核');
      return member.roomId;
    }
    const roomNo = String(roomNoRaw || '').trim();
    if (!roomNo) {
      throw new BadRequestException('请指定房间 roomId 或 roomNo');
    }
    const room = await this.prisma.room.findFirst({
      where: { roomNo },
      select: { id: true },
    });
    if (!room) throw new BadRequestException('房间不存在');
    const member = await this.prisma.roomMember.findFirst({
      where: { playerId, roomId: room.id, status: 'APPROVED' },
      select: { roomId: true },
    });
    if (!member) throw new BadRequestException('未加入该房间或未通过审核');
    return member.roomId;
  }

  /** GET /api/wallet/balance?roomNo=|/roomId= — 当前用户在指定房间的余额 */
  @Get('balance')
  async balance(
    @CurrentUser() user: { id: string; role?: string },
    @Query('roomId') roomId?: string,
    @Query('roomNo') roomNo?: string,
  ) {
    if (user.role && user.role !== 'PLAYER') {
      const account = await this.prisma.pointsAccount.findFirst({
        where: {
          ownerId: user.id,
          roomId: '',
        },
        select: { balance: true },
      });
      return { balance: asMoney(account?.balance ?? 0) };
    }
    const rid = await this.resolvePlayerRoomId(user.id, roomId, roomNo);
    const balance = await this.points.getPlayerBalance(user.id, rid);
    return { balance, roomId: rid };
  }

  /**
   * GET /api/wallet/ledger?roomNo=|/roomId=
   * range=today|… 或 from/to 毫秒；bizTypes 逗号分隔。
   */
  @Get('ledger')
  async ledger(
    @CurrentUser() user: { id: string; role?: string },
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number,
    @Query('pageSize', new DefaultValuePipe(50), ParseIntPipe) pageSize: number,
    @Query('range') rangeKey?: string,
    @Query('from') fromStr?: string,
    @Query('to') toStr?: string,
    @Query('bizTypes') bizTypesStr?: string,
    @Query('roomId') roomId?: string,
    @Query('roomNo') roomNo?: string,
  ) {
    let account: { id: string } | null;
    if (user.role && user.role !== 'PLAYER') {
      account = await this.prisma.pointsAccount.findFirst({
        where: { ownerId: user.id, roomId: '' },
        select: { id: true },
      });
    } else {
      const rid = await this.resolvePlayerRoomId(user.id, roomId, roomNo);
      account = await this.prisma.pointsAccount.findUnique({
        where: this.points.accountWhere('PLAYER', user.id, rid),
        select: { id: true },
      });
    }
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
          refType: true,
          refId: true,
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
      list: list.map((row) => {
        const remark = row.remark || '';
        const orderFromRemark = remark.match(/订单号\s*([A-Za-z0-9_-]{8,64})/)?.[1] ?? null;
        const orderNo =
          (row.refType?.startsWith('console_') || row.refType === 'recharge') && row.refId
            ? row.refId
            : orderFromRemark;
        let method: string | null = null;
        if (row.bizType === 'RECHARGE' || row.bizType === 'TRANSFER_IN') method = '上分';
        else if (row.bizType === 'WITHDRAW' || row.bizType === 'TRANSFER_OUT') method = '下分';
        return {
          ...row,
          amount: asMoney(row.amount),
          balanceAfter: asMoney(row.balanceAfter),
          orderNo,
          method,
        };
      }),
    };
  }
}
