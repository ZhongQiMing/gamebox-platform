import {
  Controller, Get, Patch, Post, Param, Body, Query,
  DefaultValuePipe, ParseIntPipe, NotFoundException, BadRequestException,
} from '@nestjs/common';
import { asMoney } from '@gamebox/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { PointsService, PLATFORM_OWNER_ID } from '../points/points.service';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AdminLogService } from './admin-log.service';

interface AgentTreeNode {
  id: string; uid: string; nickname: string; role: string;
  depth: number; balance: number; children: AgentTreeNode[];
}

@Controller('admin/agents')
@Roles('ADMIN')
export class AgentAdminController {
  constructor(
    private prisma: PrismaService,
    private points: PointsService,
    private adminLog: AdminLogService,
  ) {}

  /** 代理列表（平铺，含余额） */
  @Get()
  async list(
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page = 1,
    @Query('pageSize', new DefaultValuePipe(20), ParseIntPipe) pageSize = 20,
  ) {
    const where = { role: { in: ['BRANCH', 'AGENT', 'PROXY'] as never[] } };
    const [total, users] = await this.prisma.$transaction([
      this.prisma.user.count({ where }),
      this.prisma.user.findMany({
        where,
        select: { id: true, uid: true, nickname: true, role: true, depth: true, agentPath: true },
        skip: (page - 1) * pageSize,
        take: pageSize,
        orderBy: { depth: 'asc' },
      }),
    ]);

    // 批量读余额
    const ids = users.map(u => u.id);
    const accounts = await this.prisma.pointsAccount.findMany({ where: { ownerId: { in: ids } } });
    const balMap = Object.fromEntries(accounts.map(a => [a.ownerId, a.balance]));

    const list = users.map(u => ({ ...u, balance: balMap[u.id] ?? 0 }));
    return { total, page, pageSize, list };
  }

  /** 代理树（递归嵌套结构） */
  @Get('tree')
  async tree(): Promise<AgentTreeNode[]> {
    const allUsers = await this.prisma.user.findMany({
      where: { role: { in: ['BRANCH', 'AGENT', 'PROXY'] as never[] } },
      select: { id: true, uid: true, nickname: true, role: true, depth: true, agentPath: true },
      orderBy: { depth: 'asc' },
    });
    const accounts = await this.prisma.pointsAccount.findMany({
      where: { ownerId: { in: allUsers.map(u => u.id) } },
    });
    const balMap = Object.fromEntries(accounts.map(a => [a.ownerId, a.balance]));

    const nodes: AgentTreeNode[] = allUsers.map(u => ({
      id: u.id, uid: u.uid, nickname: u.nickname, role: u.role,
      depth: u.depth, balance: asMoney(balMap[u.id] ?? 0), children: [],
    }));
    const nodeMap = Object.fromEntries(nodes.map(n => [n.id, n]));
    const pathMap = Object.fromEntries(allUsers.map(u => [u.id, u.agentPath ?? '']));

    const roots: AgentTreeNode[] = [];
    for (const n of nodes) {
      const parts = pathMap[n.id].split('/').filter(Boolean);
      const parentId = parts.at(-2);
      if (parentId && nodeMap[parentId]) {
        nodeMap[parentId].children.push(n);
      } else {
        roots.push(n);
      }
    }
    return roots;
  }

  /** 修改代理等级 */
  @Patch(':userId/level')
  async setLevel(
    @Param('userId') userId: string,
    @Body('levelCode') levelCode: string,
    @CurrentUser() operator: { id: string },
  ) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException('用户不存在');
    // 这里更新 agent 表的 level，或直接存在 user 的备注字段
    // 当前 schema 里 Agent.agentLevelId，先 upsert Agent 记录
    const level = await this.prisma.agentLevel.findUnique({ where: { code: levelCode } });
    if (!level) throw new BadRequestException('等级不存在');

    await this.prisma.agent.upsert({
      where: { userId },
      update: { levelId: level.id },
      create: { userId, levelId: level.id, commissionRate: level.commissionRate },
    });
    await this.adminLog.log(operator.id, 'AGENT_LEVEL_SET', userId, { levelCode });
    return { ok: true };
  }

  /** 从平台账户向代理额度下发 */
  @Post(':userId/issue')
  async issue(
    @Param('userId') userId: string,
    @Body('amount') amount: number,
    @CurrentUser() operator: { id: string },
  ) {
    if (!Number.isInteger(amount) || amount <= 0) throw new BadRequestException('金额无效');
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException('用户不存在');
    if (!['BRANCH', 'AGENT', 'PROXY'].includes(user.role)) {
      throw new BadRequestException('额度只能下发给分公司、代理或代分账户');
    }

    const ownerType = user.role as 'BRANCH' | 'AGENT' | 'PROXY';
    await this.points.transfer(
      { type: 'PLATFORM', id: PLATFORM_OWNER_ID },
      { type: ownerType,  id: userId },
      amount,
      { bizTypeOut: 'TRANSFER_OUT', bizTypeIn: 'TRANSFER_IN',
        remark: `管理员额度下发 ${amount}`,
        idempotencyKey: `issue_${operator.id}_${userId}_${Date.now()}` },
    );

    await this.adminLog.log(operator.id, 'AGENT_ISSUE', userId, { amount });
    return { ok: true };
  }
}
