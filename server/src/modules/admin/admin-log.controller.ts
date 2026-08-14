import {
  Controller, Get, Query, DefaultValuePipe, ParseIntPipe,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import {
  ADMIN_ACTION_META,
  listActionOptions,
  summarizeAdminLog,
} from './admin-log.labels';
import { ConsoleScopeService } from '../console/console-scope.service';

@Controller('admin/logs')
@Roles('ADMIN', 'BRANCH', 'GENERAL', 'AGENT', 'PROXY')
export class AdminLogController {
  constructor(
    private prisma: PrismaService,
    private scope: ConsoleScopeService,
  ) {}

  @Get('meta')
  meta() {
    return { actions: listActionOptions() };
  }

  /** ADMIN 全量；BRANCH/GENERAL 本人操作 + 管辖房间相关；AGENT/PROXY 仅本人 */
  @Get()
  async list(
    @CurrentUser() user: { id: string; role: string },
    @Query('action') action?: string,
    @Query('keyword') keyword?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page = 1,
    @Query('pageSize', new DefaultValuePipe(20), ParseIntPipe) pageSize = 20,
  ) {
    let where: Prisma.AdminLogWhereInput = { operatorId: user.id };
    if (user.role === 'ADMIN') {
      where = {};
    } else if (user.role === 'BRANCH' || user.role === 'GENERAL') {
      const scopeActor = { id: user.id, role: user.role };
      const roomIds = (await this.scope.grantedRoomIds(scopeActor)) ?? [];
      const userIds = await this.scope.scopedUserIds(scopeActor);
      const targets = [
        ...roomIds,
        ...(userIds || []).filter((id) => id !== user.id),
      ];
      where = {
        OR: [
          { operatorId: user.id },
          ...(targets.length ? [{ target: { in: targets } }] : []),
        ],
      };
    }

    if (action) where.action = action;
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
        take: 80,
      });
      const rooms = await this.prisma.room.findMany({
        where: {
          OR: [
            { roomNo: { contains: kw } },
            { name: { contains: kw } },
          ],
        },
        select: { id: true },
        take: 40,
      });
      const ids = [...users.map((u) => u.id), ...rooms.map((r) => r.id)];
      where.OR = [
        { action: { contains: kw.toUpperCase() } },
        { target: { contains: kw } },
        ...(ids.length ? [{ target: { in: ids } }] : []),
        {
          operator: {
            OR: [
              { uid: { contains: kw } },
              { nickname: { contains: kw } },
            ],
          },
        },
      ];
    }

    const take = Math.min(Math.max(pageSize, 1), 100);
    const [total, rows] = await this.prisma.$transaction([
      this.prisma.adminLog.count({ where }),
      this.prisma.adminLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * take,
        take,
        include: {
          operator: {
            select: { id: true, uid: true, nickname: true, role: true },
          },
        },
      }),
    ]);

    const targetIds = [...new Set(rows.map((r) => r.target).filter(Boolean))] as string[];
    const detailUserIds: string[] = [];
    for (const r of rows) {
      const d = r.detail as { playerId?: string; ownerUserId?: string } | null;
      if (d?.playerId) detailUserIds.push(d.playerId);
      if (d?.ownerUserId) detailUserIds.push(d.ownerUserId);
    }
    const allUserIds = [...new Set([...targetIds, ...detailUserIds])];
    const [users, rooms, games] = await Promise.all([
      allUserIds.length
        ? this.prisma.user.findMany({
            where: { id: { in: allUserIds } },
            select: { id: true, uid: true, nickname: true, role: true },
          })
        : Promise.resolve([]),
      targetIds.length
        ? this.prisma.room.findMany({
            where: { id: { in: targetIds } },
            select: { id: true, roomNo: true, name: true },
          })
        : Promise.resolve([]),
      this.prisma.game.findMany({
        select: { code: true, name: true },
      }),
    ]);
    const userMap = new Map(users.map((u) => [u.id, u]));
    const roomMap = new Map(rooms.map((r) => [r.id, r]));
    const gameMap = new Map(games.map((g) => [g.code, g.name]));

    const list = rows.map((r) => {
      const meta = ADMIN_ACTION_META[r.action];
      const detail = (r.detail ?? null) as Record<string, unknown> | null;
      let resolved = resolveTargetLabel(r.target, r.action, userMap, roomMap, gameMap);
      const detailPlayerId = typeof detail?.playerId === 'string' ? detail.playerId : null;
      if (detailPlayerId && userMap.has(detailPlayerId) && r.action.startsWith('RECHARGE_')) {
        const pu = userMap.get(detailPlayerId)!;
        resolved = `${pu.nickname}（${pu.uid}）`;
      }
      return {
        id: r.id,
        action: r.action,
        actionLabel: meta?.label ?? r.action,
        actionGroup: meta?.group ?? '其他',
        target: r.target,
        targetLabel: resolved,
        detail,
        summary: summarizeAdminLog(r.action, detail, resolved),
        ip: r.ip,
        createdAt: r.createdAt,
        operator: {
          id: r.operator.id,
          uid: r.operator.uid,
          nickname: r.operator.nickname,
          role: r.operator.role,
          roleLabel: roleLabel(r.operator.role),
        },
      };
    });

    return { total, page, pageSize: take, list };
  }
}

function roleLabel(role: string): string {
  if (role === 'ADMIN') return '管理员';
  if (role === 'BRANCH') return '房主';
  if (role === 'AGENT') return '代理';
  if (role === 'PROXY') return '子账号';
  if (role === 'PLAYER') return '玩家';
  return role;
}

function resolveTargetLabel(
  target: string | null,
  action: string,
  userMap: Map<string, { id: string; uid: string; nickname: string; role: string }>,
  roomMap: Map<string, { id: string; roomNo: string; name: string }>,
  gameMap: Map<string, string>,
): string | null {
  if (!target) return null;

  const u = userMap.get(target);
  if (u) return `${u.nickname}（${u.uid}）`;

  const room = roomMap.get(target);
  if (room) return `${room.name}（${room.roomNo}）`;

  // 游戏排序等多 code
  if (target.includes(',')) {
    return target
      .split(',')
      .map((c) => c.trim())
      .filter(Boolean)
      .map((c) => gameMap.get(c) || c)
      .join('、');
  }

  if (gameMap.has(target)) return `${gameMap.get(target)}（${target}）`;

  // 日切日期等原样
  if (/^\d{4}-\d{2}-\d{2}/.test(target)) return target;

  // 游戏相关动作：短 code
  if (action.startsWith('GAME_') && target.length < 40) {
    return gameMap.get(target) ? `${gameMap.get(target)}（${target}）` : target;
  }

  // 过长 cuid 缩短展示
  if (target.length > 24) return `${target.slice(0, 10)}…`;
  return target;
}
