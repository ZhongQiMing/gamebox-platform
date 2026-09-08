import {
  Controller, Get, Post, Query, Body,
  ForbiddenException, BadRequestException,
} from '@nestjs/common';
import { IsOptional, IsString, Length } from 'class-validator';
import { asMoney } from '@gamebox/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { HangService } from './hang.service';
import { shanghaiRangeBounds } from '../../common/shanghai-range';

class HangDto {
  @IsString()
  @Length(6, 16)
  friendUid!: string;

  @IsString()
  @Length(6, 16)
  underUid!: string;

  /** 多房时代理必传；单房可省略由服务端推断 */
  @IsOptional()
  @IsString()
  roomId?: string;
}

const AGENT_ROLES = new Set(['BRANCH', 'AGENT', 'PROXY']);

/*
 * 类级 @Roles 收口。
 *
 * 方法里虽然都用 isAgentRole 挡了，但那是一条条手写的——
 * 以后随手加个接口忘了写，任何登录用户都能调。放到类上兜底，
 * 方法内的检查保留（返回的是更具体的中文提示）。
 */
@Controller('agent')
@Roles('ADMIN', 'BRANCH', 'AGENT', 'PROXY')
export class AgentController {
  constructor(
    private prisma: PrismaService,
    private hangService: HangService,
  ) {}

  private isAgentRole(role: string) {
    return AGENT_ROLES.has(role);
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

    const [todayStart] = shanghaiRangeBounds('today');

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
    if (!dto.friendUid?.trim() || !dto.underUid?.trim()) {
      throw new BadRequestException('请填写好友与推荐人 UID');
    }
    return this.hangService.hang(me.id, dto.friendUid, dto.underUid, dto.roomId);
  }

  @Post('transfer')
  transfer(): never {
    throw new ForbiddenException('禁止私下转分，请通过官方充值通道上分');
  }
}
