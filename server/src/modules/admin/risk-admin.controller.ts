import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  NotFoundException,
  Patch,
  Query,
  Param,
  DefaultValuePipe,
  ParseIntPipe,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AdminLogService } from './admin-log.service';
import { RISK_TYPE_META, RISK_TYPES, type RiskType } from '../risk/risk.types';

@Controller('admin/risk')
@Roles('ADMIN', 'BRANCH')
export class RiskAdminController {
  constructor(
    private prisma: PrismaService,
    private adminLog: AdminLogService,
  ) {}

  @Get('meta')
  meta() {
    return {
      types: Object.entries(RISK_TYPE_META).map(([value, m]) => ({
        value,
        label: m.label,
        hint: m.hint,
      })),
      levels: [
        { value: 'CRITICAL', label: '严重' },
        { value: 'WARN', label: '警告' },
        { value: 'INFO', label: '提示' },
      ],
      monitors: [
        { type: RISK_TYPES.BIG_WIN, label: '大额中奖', desc: '彩票/牌桌/电玩单笔派彩过高自动告警（≥max(下注×50, 10万)）' },
        { type: RISK_TYPES.SAME_IP, label: '同 IP 多号', desc: '玩家登录时检测同公网 IP 多账号' },
        { type: RISK_TYPES.SUSPECT_WASH, label: '疑似刷分', desc: '控制台/申请上下分：上分后低流水又快速下分' },
        { type: RISK_TYPES.COLLUSION, label: '疑似对刷', desc: '桌台同局对立方向金额接近对押' },
      ],
    };
  }

  @Get('summary')
  async summary(@CurrentUser() user: { id: string; role: string }) {
    const scope = await this.scopeWhere(user);
    const todayStart = startOfShanghaiDay();

    const [unhandled, critical, warn, todayNew, byTypeRaw] = await Promise.all([
      this.prisma.riskEvent.count({ where: { ...scope, handled: false } }),
      this.prisma.riskEvent.count({
        where: { ...scope, handled: false, level: 'CRITICAL' },
      }),
      this.prisma.riskEvent.count({
        where: { ...scope, handled: false, level: 'WARN' },
      }),
      this.prisma.riskEvent.count({
        where: { ...scope, createdAt: { gte: todayStart } },
      }),
      this.prisma.riskEvent.groupBy({
        by: ['type'],
        where: { ...scope, handled: false },
        _count: { _all: true },
      }),
    ]);

    const byType: Record<string, number> = {};
    for (const t of Object.keys(RISK_TYPE_META)) byType[t] = 0;
    for (const row of byTypeRaw) byType[row.type] = row._count._all;

    return { unhandled, critical, warn, todayNew, byType };
  }

  /**
   * ADMIN 全量；BRANCH 仅 targetId 落在其代理子树内的事件（无 target 的平台级事件不可见）。
   */
  @Get()
  async list(
    @CurrentUser() user: { id: string; role: string },
    @Query('handled') handledStr?: string,
    @Query('level') level?: string,
    @Query('type') type?: string,
    @Query('keyword') keyword?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page = 1,
    @Query('pageSize', new DefaultValuePipe(20), ParseIntPipe) pageSize = 20,
  ) {
    const scope = await this.scopeWhere(user);
    const where: Prisma.RiskEventWhereInput = { ...scope };

    if (handledStr === 'true') where.handled = true;
    else if (handledStr === 'false') where.handled = false;
    if (level) where.level = level;
    if (type) where.type = type;

    if (from || to) {
      where.createdAt = {};
      if (from) where.createdAt.gte = new Date(from);
      if (to) where.createdAt.lte = new Date(to);
    }

    if (keyword?.trim()) {
      const kw = keyword.trim();
      const users = await this.prisma.user.findMany({
        where: {
          OR: [
            { uid: { contains: kw } },
            { nickname: { contains: kw } },
            { username: { contains: kw.toLowerCase() } },
          ],
        },
        select: { id: true },
        take: 100,
      });
      const ids = users.map((u) => u.id);
      const or: Prisma.RiskEventWhereInput[] = [];
      if (ids.length) or.push({ targetId: { in: ids } });
      or.push({ targetId: kw });
      if (kw.length >= 8) or.push({ id: kw });
      where.OR = or;
    }

    const take = Math.min(Math.max(pageSize, 1), 100);
    const [total, rows] = await this.prisma.$transaction([
      this.prisma.riskEvent.count({ where }),
      this.prisma.riskEvent.findMany({
        where,
        orderBy: [{ handled: 'asc' }, { createdAt: 'desc' }],
        skip: (page - 1) * take,
        take,
        include: {
          handler: { select: { id: true, uid: true, nickname: true } },
        },
      }),
    ]);

    const targetIds = [...new Set(rows.map((r) => r.targetId).filter(Boolean))] as string[];
    const targets = targetIds.length
      ? await this.prisma.user.findMany({
          where: { id: { in: targetIds } },
          select: {
            id: true,
            uid: true,
            nickname: true,
            username: true,
            lastLoginIp: true,
            status: true,
          },
        })
      : [];
    const targetMap = new Map(targets.map((t) => [t.id, t]));

    const list = rows.map((r) => {
      const meta = RISK_TYPE_META[r.type as RiskType];
      const detail = (r.detail ?? {}) as Record<string, unknown>;
      return {
        id: r.id,
        type: r.type,
        typeLabel: meta?.label ?? r.type,
        typeHint: meta?.hint ?? '',
        level: r.level,
        targetId: r.targetId,
        target: r.targetId ? targetMap.get(r.targetId) ?? null : null,
        detail,
        summary: typeof detail.summary === 'string' ? detail.summary : summarizeDetail(r.type, detail),
        handled: r.handled,
        handleNote: r.handleNote,
        handledAt: r.handledAt,
        handler: r.handler,
        createdAt: r.createdAt,
      };
    });

    return { total, page, pageSize: take, list };
  }

  /** 批量标记须在 :id 路由之前注册 */
  @Patch('handle-batch')
  async batchHandle(
    @CurrentUser() user: { id: string; role: string },
    @Body() body: { ids?: string[]; note?: string },
  ) {
    const ids = Array.isArray(body?.ids) ? body.ids.filter(Boolean).slice(0, 100) : [];
    if (!ids.length) return { ok: true, count: 0 };

    const events = await this.prisma.riskEvent.findMany({
      where: { id: { in: ids }, handled: false },
      select: { id: true, targetId: true },
    });

    let count = 0;
    for (const ev of events) {
      try {
        await this.assertCanHandle(user, ev.targetId);
        await this.prisma.riskEvent.update({
          where: { id: ev.id },
          data: {
            handled: true,
            handleNote: body?.note?.trim() || null,
            handledAt: new Date(),
            handledBy: user.id,
          },
        });
        count += 1;
      } catch {
        /* 跳过无权 */
      }
    }
    if (count) {
      await this.adminLog.log(user.id, 'RISK_EVENT_BATCH_HANDLE', undefined, {
        count,
        note: body?.note,
      });
    }
    return { ok: true, count };
  }

  @Patch(':id/handle')
  async handle(
    @Param('id') id: string,
    @CurrentUser() user: { id: string; role: string },
    @Body() body?: { note?: string },
  ) {
    const ev = await this.prisma.riskEvent.findUnique({ where: { id } });
    if (!ev) throw new NotFoundException('告警不存在');
    await this.assertCanHandle(user, ev.targetId);

    await this.prisma.riskEvent.update({
      where: { id },
      data: {
        handled: true,
        handleNote: body?.note?.trim() || null,
        handledAt: new Date(),
        handledBy: user.id,
      },
    });
    await this.adminLog.log(user.id, 'RISK_EVENT_HANDLE', id, {
      note: body?.note,
      type: ev.type,
      level: ev.level,
    });
    return { ok: true };
  }

  private async scopeWhere(user: {
    id: string;
    role: string;
  }): Promise<Prisma.RiskEventWhereInput> {
    if (user.role === 'ADMIN') return {};
    const me = await this.prisma.user.findUnique({
      where: { id: user.id },
      select: { agentPath: true },
    });
    const prefix = `${me?.agentPath ?? '/'}${user.id}/`;
    const scoped = await this.prisma.user.findMany({
      where: {
        OR: [
          { id: user.id },
          { parentId: user.id },
          { agentPath: { startsWith: prefix } },
        ],
      },
      select: { id: true },
      take: 50_000,
    });
    return { targetId: { in: scoped.map((u) => u.id) } };
  }

  private async assertCanHandle(
    user: { id: string; role: string },
    targetId: string | null,
  ) {
    if (user.role === 'ADMIN') return;
    if (!targetId) throw new ForbiddenException('无权处理平台级事件');
    const me = await this.prisma.user.findUnique({
      where: { id: user.id },
      select: { agentPath: true },
    });
    const prefix = `${me?.agentPath ?? '/'}${user.id}/`;
    const target = await this.prisma.user.findUnique({
      where: { id: targetId },
      select: { id: true, parentId: true, agentPath: true },
    });
    const ok =
      target &&
      (target.id === user.id ||
        target.parentId === user.id ||
        target.agentPath.startsWith(prefix));
    if (!ok) throw new ForbiddenException('目标不在管辖范围');
  }
}

function startOfShanghaiDay(): Date {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  const day = fmt.format(new Date());
  return new Date(`${day}T00:00:00+08:00`);
}

function summarizeDetail(type: string, detail: Record<string, unknown>): string {
  if (typeof detail.summary === 'string') return detail.summary;
  if (type === RISK_TYPES.BIG_WIN) {
    const payout = detail.payout ?? detail.totalPayout;
    const game = detail.gameCode ?? '';
    return `大额派彩 ${payout ?? '—'} ${game}`.trim();
  }
  try {
    return JSON.stringify(detail).slice(0, 120);
  } catch {
    return '—';
  }
}
