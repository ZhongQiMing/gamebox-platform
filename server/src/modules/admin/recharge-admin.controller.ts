import {
  Controller, Get, Query, DefaultValuePipe, ParseIntPipe,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

@Controller('admin/recharge')
@Roles('ADMIN', 'BRANCH', 'AGENT', 'PROXY')
export class RechargeAdminController {
  constructor(private prisma: PrismaService) {}

  /** 订单列表：ADMIN 全量；BRANCH/AGENT/PROXY 仅团队玩家（PROXY 走主代理树） */
  @Get()
  async list(
    @CurrentUser() user: { id: string; role: string; agentPath?: string },
    @Query('status') status?: string,
    @Query('type') type?: string,
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page = 1,
    @Query('pageSize', new DefaultValuePipe(20), ParseIntPipe) pageSize = 20,
  ) {
    const me = await this.prisma.user.findUnique({
      where: { id: user.id },
      select: { role: true, agentPath: true, parentId: true },
    });
    const where: Prisma.RechargeOrderWhereInput = {};
    if (status) where.status = status as Prisma.RechargeOrderWhereInput['status'];
    if (type) where.type = type as Prisma.RechargeOrderWhereInput['type'];
    if (me && me.role !== 'ADMIN') {
      let teamPrefix = `${me.agentPath}${user.id}/`;
      if (me.role === 'PROXY' && me.parentId) {
        const parent = await this.prisma.user.findUnique({
          where: { id: me.parentId },
          select: { id: true, role: true, agentPath: true },
        });
        if (parent?.role === 'AGENT') {
          teamPrefix = `${parent.agentPath}${parent.id}/`;
        }
      }
      where.player = {
        agentPath: { startsWith: teamPrefix },
      };
    }

    const [total, list] = await this.prisma.$transaction([
      this.prisma.rechargeOrder.count({ where }),
      this.prisma.rechargeOrder.findMany({
        where,
        orderBy: [{ status: 'asc' }, { createdAt: 'desc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: { player: { select: { uid: true, nickname: true } } },
      }),
    ]);

    return { total, page, pageSize, list };
  }
}
