import {
  Controller, Get, Query, DefaultValuePipe, ParseIntPipe,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

@Controller('admin/recharge')
@Roles('ADMIN', 'BRANCH', 'AGENT', 'PROXY', 'CS')
export class RechargeAdminController {
  constructor(private prisma: PrismaService) {}

  /** 客服粘性指派中的玩家（与客服会话口径一致） */
  private async csAssignedPlayerIds(csUserId: string): Promise<string[]> {
    const recent = await this.prisma.csMessage.findMany({
      where: { assigneeId: csUserId },
      distinct: ['playerId'],
      select: { playerId: true },
      orderBy: { createdAt: 'desc' },
      take: 500,
    });
    const ids: string[] = [];
    for (const row of recent) {
      const last = await this.prisma.csMessage.findFirst({
        where: { playerId: row.playerId, assigneeId: { not: null } },
        orderBy: { createdAt: 'desc' },
        select: { assigneeId: true },
      });
      if (last?.assigneeId === csUserId) ids.push(row.playerId);
    }
    return ids;
  }

  /** 主代理房间内已通过的玩家（含尚未挂靠到 agentPath 的） */
  private async roomMemberPlayerIds(agentRootId: string): Promise<string[]> {
    const rooms = await this.prisma.room.findMany({
      where: { ownerAgent: { userId: agentRootId } },
      select: { id: true },
    });
    if (!rooms.length) return [];
    const members = await this.prisma.roomMember.findMany({
      where: { roomId: { in: rooms.map((r) => r.id) }, status: 'APPROVED' },
      select: { playerId: true },
    });
    return [...new Set(members.map((m) => m.playerId))];
  }

  /**
   * 订单列表：
   * - ADMIN 全量
   * - AGENT/PROXY：代理树 ∪ 本房成员（避免进房未挂靠导致角标有、列表空）
   * - CS：仅系统派给自己的玩家（不能浏览全部）
   */
  @Get()
  async list(
    @CurrentUser() user: { id: string; role: string; agentPath?: string },
    @Query('status') status?: string,
    @Query('type') type?: string,
    @Query('playerId') playerId?: string,
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

    if (me?.role === 'CS') {
      const assigned = await this.csAssignedPlayerIds(user.id);
      const want = playerId?.trim();
      if (want) {
        if (!assigned.includes(want)) {
          return { total: 0, page, pageSize, list: [] };
        }
        where.playerId = want;
      } else {
        where.playerId = { in: assigned.length ? assigned : ['__none__'] };
      }
    } else {
      if (playerId?.trim()) where.playerId = playerId.trim();
      if (me && me.role !== 'ADMIN') {
        let agentRootId = user.id;
        let teamPrefix = `${me.agentPath}${user.id}/`;
        if (me.role === 'PROXY' && me.parentId) {
          const parent = await this.prisma.user.findUnique({
            where: { id: me.parentId },
            select: { id: true, role: true, agentPath: true },
          });
          if (parent?.role === 'AGENT') {
            agentRootId = parent.id;
            teamPrefix = `${parent.agentPath}${parent.id}/`;
          }
        }
        if (me.role === 'AGENT' || me.role === 'PROXY') {
          const memberIds = await this.roomMemberPlayerIds(agentRootId);
          const or: Prisma.UserWhereInput[] = [
            { agentPath: { startsWith: teamPrefix } },
          ];
          if (memberIds.length) or.push({ id: { in: memberIds } });
          where.player = { OR: or };
        } else if (me.role === 'BRANCH') {
          where.player = {
            agentPath: { startsWith: teamPrefix },
          };
        }
      }
    }

    const take = Math.min(Math.max(pageSize, 1), 100);
    const [total, list] = await this.prisma.$transaction([
      this.prisma.rechargeOrder.count({ where }),
      this.prisma.rechargeOrder.findMany({
        where,
        orderBy: [{ status: 'asc' }, { createdAt: 'desc' }],
        skip: (Math.max(page, 1) - 1) * take,
        take,
        include: { player: { select: { id: true, uid: true, nickname: true } } },
      }),
    ]);

    return {
      total,
      page,
      pageSize: take,
      list: list.map((o) => ({
        ...o,
        playerId: o.playerId,
        player: { uid: o.player.uid, nickname: o.player.nickname },
      })),
    };
  }
}
