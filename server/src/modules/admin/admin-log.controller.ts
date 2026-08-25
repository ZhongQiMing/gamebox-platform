import {
  Controller, Get, Query, DefaultValuePipe, ParseIntPipe,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import {
  ADMIN_ACTION_META,
  SOFT_CONTROL_ACTIONS,
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
  meta(@CurrentUser() user: { role: string }) {
    return { actions: listActionOptions(user?.role) };
  }

  /**
   * ADMIN 全量；BRANCH/GENERAL 本人操作 + 管辖房间相关；
   * AGENT 本人 + 本房客服/子账号的操作（要对得上账，不然客服划了额他查不到）；
   * 代理子账号仍只看自己。
   */
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
    /*
     * 管辖条件单独拿着，最后跟关键词条件用 AND 合起来。
     * 早先是直接往 where.OR 上写关键词，把管辖那组 OR 整个盖掉，
     * 总监/总代一搜关键词就能翻到别人名下的上下分、改档记录。
     */
    let scopeWhere: Prisma.AdminLogWhereInput | null = { operatorId: user.id };
    if (user.role === 'ADMIN') {
      scopeWhere = null;
    } else if (
      user.role === 'BRANCH'
      || user.role === 'GENERAL'
      || await this.scope.isGeneralSide({ id: user.id, role: user.role })
    ) {
      const scopeActor = { id: user.id, role: user.role };
      const roomIds = (await this.scope.grantedRoomIds(scopeActor)) ?? [];
      const userIds = await this.scope.scopedUserIds(scopeActor);
      const operatorIds = new Set<string>([user.id]);
      if (await this.scope.isGeneralSide(scopeActor)) {
        const rootId = await this.scope.generalRootId(scopeActor);
        operatorIds.add(rootId);
        const kids = await this.prisma.user.findMany({
          where: { parentId: rootId, role: { in: ['PROXY', 'CS'] } },
          select: { id: true },
        });
        for (const c of kids) operatorIds.add(c.id);
      }
      const targets = [
        ...roomIds,
        ...(userIds || []).filter((id) => id !== user.id),
      ];
      scopeWhere = {
        OR: [
          { operatorId: { in: [...operatorIds] } },
          ...(targets.length ? [{ target: { in: targets } }] : []),
        ],
      };
    } else if (user.role === 'AGENT') {
      /*
       * 主代理要能审自己房里发生过什么：客服划额、子账号改设置都算他的账。
       * 只给他看「本人 + 名下客服/子账号」的操作，不放开到别的房。
       */
      const staff = await this.prisma.user.findMany({
        where: { parentId: user.id, role: { in: ['PROXY', 'CS'] } },
        select: { id: true },
      });
      const operatorIds = [user.id, ...staff.map((s) => s.id)];
      scopeWhere = { operatorId: { in: operatorIds } };
    }

    const and: Prisma.AdminLogWhereInput[] = [];
    if (scopeWhere) and.push(scopeWhere);
    /*
     * 软控/控奖记录只有 ADMIN 能看。
     * 不能指望「管辖范围碰巧匹配不上」——只要某条记录的 target 落进总代/代理的
     * 管辖集合，软控痕迹就漏出去了。这里按动作名显式排除。
     */
    if (user.role !== 'ADMIN') {
      and.push({ action: { notIn: SOFT_CONTROL_ACTIONS } });
    }
    if (action) and.push({ action });
    if (from || to) {
      const createdAt: Prisma.DateTimeFilter = {};
      if (from) createdAt.gte = new Date(from);
      if (to) createdAt.lte = new Date(to);
      and.push({ createdAt });
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
      and.push({
        OR: [
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
        ],
      });
    }
    const where: Prisma.AdminLogWhereInput = and.length ? { AND: and } : {};

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
            select: { id: true, uid: true, nickname: true, username: true, role: true },
          },
        },
      }),
    ]);

    const targetIds = [...new Set(rows.map((r) => r.target).filter(Boolean))] as string[];
    /*
     * detail 里凡是 xxxId 的都收集起来一并解析。
     * 前端抽屉原先直接把 cuid 显示出来，运营看不出是哪个房、哪个人。
     */
    const detailUserIds: string[] = [];
    const detailRoomIds: string[] = [];
    for (const r of rows) {
      const d = r.detail as Record<string, unknown> | null;
      if (!d) continue;
      for (const [k, v] of Object.entries(d)) {
        if (typeof v !== 'string' || v.length < 20) continue;
        if (/roomId$/i.test(k)) detailRoomIds.push(v);
        else if (/(playerId|userId|ById|AgentId)$/i.test(k)) detailUserIds.push(v);
      }
    }
    const allUserIds = [...new Set([...targetIds, ...detailUserIds])];
    const [users, rooms, games] = await Promise.all([
      allUserIds.length
        ? this.prisma.user.findMany({
            where: { id: { in: allUserIds } },
            select: { id: true, uid: true, nickname: true, username: true, role: true },
          })
        : Promise.resolve([]),
      targetIds.length || detailRoomIds.length
        ? this.prisma.room.findMany({
            where: { id: { in: [...new Set([...targetIds, ...detailRoomIds])] } },
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
        resolved = `${pu.nickname}（${pu.username} · ${pu.uid}）`;
      }
      /* ID → 人话，前端抽屉照着这张表把 cuid 换成名字 */
      const detailNames: Record<string, string> = {}
      for (const v of Object.values(detail ?? {})) {
        if (typeof v !== 'string' || detailNames[v]) continue;
        const u = userMap.get(v);
        if (u) {
          detailNames[v] = `${u.nickname}（${u.username}）`;
          continue;
        }
        const rm = roomMap.get(v);
        if (rm) detailNames[v] = `${rm.name}（${rm.roomNo}）`;
      }
      return {
        id: r.id,
        action: r.action,
        actionLabel: meta?.label ?? r.action,
        actionGroup: meta?.group ?? '其他',
        target: r.target,
        targetLabel: resolved,
        detail,
        detailNames,
        summary: summarizeAdminLog(r.action, detail, resolved),
        ip: r.ip,
        createdAt: r.createdAt,
        operator: {
          id: r.operator.id,
          uid: r.operator.uid,
          nickname: r.operator.nickname,
          username: r.operator.username,
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
  if (role === 'BRANCH') return '总监';
  if (role === 'GENERAL') return '总代';
  if (role === 'AGENT') return '代理';
  if (role === 'PROXY') return '子账号';
  if (role === 'CS') return '客服';
  if (role === 'PLAYER') return '玩家';
  return role;
}

function resolveTargetLabel(
  target: string | null,
  action: string,
  userMap: Map<string, { id: string; uid: string; nickname: string; username?: string; role: string }>,
  roomMap: Map<string, { id: string; roomNo: string; name: string }>,
  gameMap: Map<string, string>,
): string | null {
  if (!target) return null;

  const u = userMap.get(target);
  if (u) return u.username ? `${u.nickname}（${u.username} · ${u.uid}）` : `${u.nickname}（${u.uid}）`;

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
