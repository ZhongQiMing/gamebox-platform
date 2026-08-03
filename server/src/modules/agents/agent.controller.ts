import {
  Controller, Get, Post, Query, Body,
  ForbiddenException, BadRequestException, NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { IsString, Length } from 'class-validator';
import { asMoney } from '@gamebox/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

class HangDto {
  @IsString()
  @Length(6, 16)
  friendUid!: string;

  @IsString()
  @Length(6, 16)
  underUid!: string;
}

const AGENT_ROLES = new Set(['BRANCH', 'AGENT', 'PROXY']);

@Controller('agent')
export class AgentController {
  constructor(
    private prisma: PrismaService,
    private cfg: ConfigService,
  ) {}

  private isAgentRole(role: string) {
    return AGENT_ROLES.has(role);
  }

  private inTeam(callerId: string, user: { id: string; agentPath: string }) {
    return user.id === callerId || user.agentPath.includes(`/${callerId}/`);
  }

  @Get('overview')
  async overview(@CurrentUser() u: { id: string }) {
    const me = await this.prisma.user.findUniqueOrThrow({
      where: { id: u.id },
      select: {
        id: true, role: true,
        parent: { select: { uid: true, nickname: true, role: true } },
      },
    });

    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

    const [directCount, teamCount, totalAgg, todayAgg] = await Promise.all([
      this.prisma.user.count({ where: { parentId: u.id } }),
      this.prisma.user.count({ where: { agentPath: { contains: `/${u.id}/` } } }),
      this.prisma.commissionRecord.aggregate({
        where: { beneficiaryId: u.id },
        _sum: { amount: true },
      }),
      this.prisma.commissionRecord.aggregate({
        where: { beneficiaryId: u.id, settledAt: { gte: todayStart } },
        _sum: { amount: true },
      }),
    ]);

    return {
      canHang: this.isAgentRole(me.role),
      parent: me.parent
        ? { uid: me.parent.uid, nickname: me.parent.nickname, role: me.parent.role }
        : null,
      directCount,
      teamCount,
      totalCommission: totalAgg._sum.amount ?? 0,
      todayCommission: todayAgg._sum.amount ?? 0,
    };
  }

  @Get('team')
  async team(
    @CurrentUser() u: { id: string },
    @Query('page') page = '1',
  ) {
    const take = 20;
    const skip = (Math.max(1, Number(page)) - 1) * take;

    const [members, total] = await Promise.all([
      this.prisma.user.findMany({
        where: { parentId: u.id },
        orderBy: { createdAt: 'desc' },
        skip, take,
        select: { id: true, uid: true, nickname: true, createdAt: true, lastLoginAt: true },
      }),
      this.prisma.user.count({ where: { parentId: u.id } }),
    ]);

    const enriched = await Promise.all(members.map(async (m) => {
      const [flowAgg, commAgg] = await Promise.all([
        this.prisma.bet.aggregate({
          where: { playerId: m.id, status: { in: ['WON', 'LOST'] } },
          _sum: { validFlow: true },
        }),
        this.prisma.commissionRecord.aggregate({
          where: { beneficiaryId: u.id, sourceUserId: m.id },
          _sum: { amount: true },
        }),
      ]);
      return {
        uid: m.uid,
        nickname: m.nickname,
        createdAt: m.createdAt,
        lastLoginAt: m.lastLoginAt,
        totalFlow: asMoney(flowAgg._sum.validFlow ?? 0),
        myCommission: commAgg._sum.amount ?? 0,
      };
    }));

    return { list: enriched, total, page: Number(page) };
  }

  @Get('commissions')
  async commissions(
    @CurrentUser() u: { id: string },
    @Query('page') page = '1',
  ) {
    const take = 20;
    const skip = (Math.max(1, Number(page)) - 1) * take;

    const [records, total] = await Promise.all([
      this.prisma.commissionRecord.findMany({
        where: { beneficiaryId: u.id },
        orderBy: { settledAt: 'desc' },
        skip, take,
        select: {
          id: true, level: true, baseFlow: true, rate: true, amount: true, settledAt: true,
          sourceUser: { select: { uid: true, nickname: true } },
        },
      }),
      this.prisma.commissionRecord.count({ where: { beneficiaryId: u.id } }),
    ]);

    return { list: records, total, page: Number(page) };
  }

  @Post('hang')
  async hang(@CurrentUser() u: { id: string }, @Body() dto: HangDto) {
    const me = await this.prisma.user.findUniqueOrThrow({
      where: { id: u.id },
      select: { id: true, role: true },
    });
    if (!this.isAgentRole(me.role)) {
      throw new ForbiddenException('仅代理可操作挂靠，请联系您的代理处理');
    }

    const friendUid = dto.friendUid.trim();
    const underUid = dto.underUid.trim();
    if (friendUid === underUid) {
      throw new BadRequestException('好友与推荐人不能相同');
    }

    const [friend, under] = await Promise.all([
      this.prisma.user.findUnique({
        where: { uid: friendUid },
        select: { id: true, uid: true, nickname: true, parentId: true, agentPath: true, depth: true, role: true },
      }),
      this.prisma.user.findUnique({
        where: { uid: underUid },
        select: { id: true, uid: true, nickname: true, parentId: true, agentPath: true, depth: true, role: true },
      }),
    ]);
    if (!friend) throw new NotFoundException('好友 UID 不存在');
    if (!under) throw new NotFoundException('推荐人 UID 不存在');
    if (friend.id === me.id) throw new BadRequestException('不能挂靠自己');

    if (!this.inTeam(me.id, under)) {
      throw new ForbiddenException('推荐人不在您的团队内，无法挂靠');
    }

    if (friend.parentId && !this.inTeam(me.id, friend)) {
      throw new ForbiddenException('该好友已挂在其他代理名下，无法操作');
    }

    if (under.agentPath.includes(`/${friend.id}/`) || under.id === friend.id) {
      throw new BadRequestException('不能将上级挂到下级名下');
    }

    if (friend.parentId === under.id) {
      return { ok: true, message: '已在该推荐人名下，无需重复挂靠', friend: friend.nickname, under: under.nickname };
    }

    const oldPrefix = `${friend.agentPath}${friend.id}/`;
    const newAgentPath = `${under.agentPath}${under.id}/`;
    const newDepth = under.depth + 1;
    const depthDelta = newDepth - friend.depth;
    const newPrefix = `${newAgentPath}${friend.id}/`;
    const playerRate = Number(this.cfg.get('PLAYER_COMMISSION_RATE') ?? 0.002);

    await this.prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: friend.id },
        data: {
          parentId: under.id,
          agentPath: newAgentPath,
          depth: newDepth,
        },
      });

      const descendants = await tx.user.findMany({
        where: { agentPath: { startsWith: oldPrefix } },
        select: { id: true, agentPath: true, depth: true },
      });
      for (const d of descendants) {
        await tx.user.update({
          where: { id: d.id },
          data: {
            agentPath: newPrefix + d.agentPath.slice(oldPrefix.length),
            depth: d.depth + depthDelta,
          },
        });
      }

      if (under.role === 'PLAYER') {
        const existing = await tx.agent.findUnique({
          where: { userId: under.id },
          select: { commissionRate: true },
        });
        if (!existing) {
          await tx.agent.create({
            data: { userId: under.id, commissionRate: playerRate },
          });
        } else if (existing.commissionRate <= 0) {
          await tx.agent.update({
            where: { userId: under.id },
            data: { commissionRate: playerRate },
          });
        }
      }
    });

    return {
      ok: true,
      message: `已将 ${friend.nickname} 挂到 ${under.nickname} 名下`,
      friend: { uid: friend.uid, nickname: friend.nickname },
      under: { uid: under.uid, nickname: under.nickname },
    };
  }

  @Post('transfer')
  async transfer() {
    throw new ForbiddenException('禁止私下转分，请通过官方充值通道上分');
  }
}
