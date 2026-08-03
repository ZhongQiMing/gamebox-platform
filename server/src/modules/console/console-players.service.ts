import { BadRequestException, Injectable } from '@nestjs/common';
import { asMoney } from '@gamebox/shared';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../../prisma/prisma.service';
import { RedisService } from '../../redis/redis.service';
import { AdminLogService } from '../admin/admin-log.service';
import { ConsoleScopeService, type ConsoleActor } from './console-scope.service';

const csDutyKey = (agentUserId: string) => `gamebox:cs-duty:${agentUserId}`;

@Injectable()
export class ConsolePlayersService {
  constructor(
    private prisma: PrismaService,
    private scope: ConsoleScopeService,
    private adminLog: AdminLogService,
    private redis: RedisService,
  ) {}

  async list(
    actor: ConsoleActor,
    opts: { page?: number; pageSize?: number; q?: string; roomId?: string } = {},
  ) {
    const page = Math.max(1, opts.page ?? 1);
    const pageSize = Math.min(100, Math.max(1, opts.pageSize ?? 20));
    if (opts.roomId) await this.scope.assertRoomAccess(actor, opts.roomId);

    let baseWhere = await this.scope.playerWhere(actor);
    if (opts.roomId) {
      const members = await this.prisma.roomMember.findMany({
        where: { roomId: opts.roomId, status: 'APPROVED' },
        select: { playerId: true },
      });
      baseWhere = {
        role: 'PLAYER',
        id: { in: members.map((m) => m.playerId) },
      };
    }
    if (opts.q?.trim()) {
      const q = opts.q.trim();
      baseWhere = {
        AND: [
          baseWhere,
          {
            OR: [
              { uid: { contains: q } },
              { nickname: { contains: q } },
              { username: { contains: q } },
            ],
          },
        ],
      };
    }

    const [total, rows] = await this.prisma.$transaction([
      this.prisma.user.count({ where: baseWhere }),
      this.prisma.user.findMany({
        where: baseWhere,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        select: {
          id: true,
          uid: true,
          username: true,
          nickname: true,
          status: true,
          parentId: true,
          createdAt: true,
        },
      }),
    ]);

    const ids = rows.map((r) => r.id);
    const accs = await this.prisma.pointsAccount.findMany({
      where: { ownerId: { in: ids } },
      select: { ownerId: true, balance: true },
    });
    const balMap = new Map(accs.map((a) => [a.ownerId, asMoney(a.balance)]));

    return {
      total,
      page,
      pageSize,
      list: rows.map((r) => ({
        ...r,
        balance: balMap.get(r.id) ?? 0,
      })),
    };
  }

  async setStatus(actor: ConsoleActor, userId: string, status: 'ACTIVE' | 'DISABLED') {
    if (actor.role !== 'ADMIN') await this.scope.assertUserInScope(actor, userId);
    const u = await this.prisma.user.update({
      where: { id: userId },
      data: {
        status,
        ...(status === 'DISABLED' ? { tokenVersion: { increment: 1 } } : {}),
      },
      select: { id: true, status: true, tokenVersion: true },
    });
    await this.adminLog.log(actor.id, 'USER_STATUS', userId, { status });
    return u;
  }

  async setRebateRate(actor: ConsoleActor, userId: string, rate: number) {
    if (actor.role !== 'ADMIN') await this.scope.assertUserInScope(actor, userId);
    const policy = await this.prisma.rebatePolicy.findUnique({ where: { id: 1 } });
    const T = policy?.totalRate ?? 0.05;
    const min = policy?.playerMinRate ?? 0.018;
    const max = T / 2;
    if (rate < min || rate > max) {
      throw new BadRequestException(`回水比例须在 ${min}~${max}（不超过代理份额 T/2）`);
    }
    const agent = await this.prisma.agent.findUnique({ where: { userId } });
    if (!agent) {
      throw new BadRequestException('仅代理/房主节点可设置默认玩家回水');
    }
    const row = await this.prisma.agent.update({
      where: { userId },
      data: { rebateRate: rate },
    });
    await this.adminLog.log(actor.id, 'REBATE_RATE', userId, { rate });
    return row;
  }

  /** 单玩家飞盘开关 */
  async setPlayerFly(
    actor: ConsoleActor,
    playerId: string,
    flyEnabled: boolean,
    roomId?: string,
  ) {
    if (actor.role !== 'ADMIN') await this.scope.assertUserInScope(actor, playerId);
    const member = await this.prisma.roomMember.findFirst({
      where: {
        playerId,
        status: 'APPROVED',
        ...(roomId ? { roomId } : {}),
      },
      orderBy: { updatedAt: 'desc' },
    });
    if (!member) throw new BadRequestException('玩家未绑定房间');
    if (roomId) await this.scope.assertRoomAccess(actor, member.roomId);
    const row = await this.prisma.roomMember.update({
      where: { id: member.id },
      data: { flyEnabled },
    });
    await this.adminLog.log(actor.id, 'PLAYER_FLY', playerId, { flyEnabled, roomId: member.roomId });
    return row;
  }

  /** 单玩家回水比例 P */
  async setPlayerRebateRate(
    actor: ConsoleActor,
    playerId: string,
    rate: number,
    roomId?: string,
  ) {
    if (actor.role !== 'ADMIN') await this.scope.assertUserInScope(actor, playerId);
    const policy = await this.prisma.rebatePolicy.findUnique({ where: { id: 1 } });
    const T = policy?.totalRate ?? 0.05;
    const min = policy?.playerMinRate ?? 0.018;
    const max = T / 2;
    if (rate < min || rate > max) {
      throw new BadRequestException(`玩家回水须在 ${min}~${max}`);
    }
    const member = await this.prisma.roomMember.findFirst({
      where: {
        playerId,
        status: 'APPROVED',
        ...(roomId ? { roomId } : {}),
      },
      orderBy: { updatedAt: 'desc' },
    });
    if (!member) throw new BadRequestException('玩家未绑定房间');
    const row = await this.prisma.roomMember.update({
      where: { id: member.id },
      data: { playerRebateRate: rate },
    });
    await this.adminLog.log(actor.id, 'PLAYER_REBATE', playerId, { rate, roomId: member.roomId });
    return row;
  }

  /** 修改挂靠佣金率（受益人 agent.commissionRate） */
  async setCommissionRate(actor: ConsoleActor, userId: string, rate: number) {
    if (actor.role !== 'ADMIN') await this.scope.assertUserInScope(actor, userId);
    if (rate < 0 || rate > 0.2) throw new BadRequestException('挂靠比例须在 0~20%');
    const agent = await this.prisma.agent.findUnique({ where: { userId } });
    if (!agent) {
      await this.prisma.agent.create({ data: { userId, commissionRate: rate } });
    } else {
      await this.prisma.agent.update({ where: { userId }, data: { commissionRate: rate } });
    }
    await this.adminLog.log(actor.id, 'COMMISSION_RATE', userId, { rate });
    return { ok: true, userId, rate };
  }

  /** 管辖范围内的房主/代理/代分列表 */
  async listAgents(
    actor: ConsoleActor,
    opts: {
      page?: number;
      pageSize?: number;
      role?: string;
      q?: string;
      /** 仅已绑房代理；ADMIN/BRANCH 默认 true（role=AGENT 或未指定时） */
      boundOnly?: boolean;
    } = {},
  ) {
    const page = Math.max(1, opts.page ?? 1);
    const pageSize = Math.min(100, Math.max(1, opts.pageSize ?? 20));
    const boundOnly = opts.boundOnly !== false;

    let where: Record<string, unknown>;
    if (actor.role === 'AGENT') {
      /* 代理只看自己名下子账号 */
      where = { role: 'PROXY', parentId: actor.id };
    } else if (actor.role === 'PROXY') {
      const rootId = await this.scope.scopeRootUserId(actor);
      where = { role: 'PROXY', parentId: rootId };
    } else {
      /* ADMIN / BRANCH：默认已绑房代理；可筛子账号 / 房主 */
      const role = ['BRANCH', 'AGENT', 'PROXY'].includes(opts.role || '')
        ? (opts.role as string)
        : 'AGENT';
      if (actor.role === 'BRANCH') {
        /* 房主只能看授权房间内的代理/子账号，禁止全平台列表 */
        const roomIds = await this.scope.grantedRoomIds(actor);
        if (!roomIds?.length) {
          return { total: 0, page, pageSize, list: [] };
        }
        if (role === 'BRANCH') {
          where = { id: actor.id, role: 'BRANCH' };
        } else if (role === 'PROXY') {
          where = {
            role: 'PROXY',
            parent: {
              agent: { is: { rooms: { some: { id: { in: roomIds } } } } },
            },
          };
        } else {
          where = {
            role: 'AGENT',
            agent: { is: { rooms: { some: { id: { in: roomIds } } } } },
          };
        }
      } else if (role === 'AGENT' && boundOnly) {
        where = {
          role: 'AGENT',
          agent: { is: { rooms: { some: {} } } },
        };
      } else {
        where = { role };
      }
    }

    if (opts.q?.trim()) {
      const q = opts.q.trim();
      where = {
        AND: [
          where,
          {
            OR: [
              { uid: { contains: q } },
              { nickname: { contains: q } },
              { username: { contains: q } },
            ],
          },
        ],
      };
    }

    const [total, rows] = await this.prisma.$transaction([
      this.prisma.user.count({ where }),
      this.prisma.user.findMany({
        where,
        orderBy: [{ role: 'asc' }, { depth: 'asc' }, { createdAt: 'desc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
        select: {
          id: true, uid: true, nickname: true, username: true,
          role: true, depth: true, status: true, parentId: true,
          createdAt: true, lastLoginAt: true,
        },
      }),
    ]);
    const ids = rows.map((r) => r.id);
    const parentIds = [...new Set(rows.map((r) => r.parentId).filter(Boolean))] as string[];
    const agentUserIds = rows.filter((r) => r.role === 'AGENT').map((r) => r.id);
    const [accs, agents, parents, agentRows, childGroups] = await Promise.all([
      this.prisma.pointsAccount.findMany({
        where: { ownerId: { in: ids } },
        select: { ownerId: true, balance: true },
      }),
      this.prisma.agent.findMany({
        where: { userId: { in: ids } },
        select: {
          id: true,
          userId: true,
          commissionRate: true,
          rebateRate: true,
          pointsQuota: true,
          pointsUsed: true,
          flyCover: true,
        },
      }),
      parentIds.length
        ? this.prisma.user.findMany({
            where: { id: { in: parentIds } },
            select: { id: true, nickname: true, username: true, role: true },
          })
        : Promise.resolve([]),
      this.prisma.agent.findMany({
        where: { userId: { in: ids } },
        select: { id: true, userId: true },
      }),
      agentUserIds.length
        ? this.prisma.user.groupBy({
            by: ['parentId'],
            where: { parentId: { in: agentUserIds }, role: 'PROXY' },
            _count: { _all: true },
          })
        : Promise.resolve([]),
    ]);
    const agentIdByUser = new Map(agentRows.map((a) => [a.userId, a.id]));
    const agentIds = [...agentIdByUser.values()];
    const childCountByParent = new Map(
      childGroups.map((g) => [g.parentId as string, g._count._all]),
    );
    const rooms = agentIds.length
      ? await this.prisma.room.findMany({
          where: { ownerAgentId: { in: agentIds } },
          select: {
            id: true, roomNo: true, name: true, status: true, ownerAgentId: true,
            _count: { select: { members: { where: { status: 'APPROVED' } } } },
          },
        })
      : [];
    type BoundRoom = {
      id: string; roomNo: string; name: string; status: string; memberCount: number;
    };
    const roomsByAgentId = new Map<string, BoundRoom[]>();
    for (const r of rooms) {
      if (!r.ownerAgentId) continue;
      const arr = roomsByAgentId.get(r.ownerAgentId) ?? [];
      arr.push({
        id: r.id,
        roomNo: r.roomNo,
        name: r.name,
        status: r.status,
        memberCount: r._count.members,
      });
      roomsByAgentId.set(r.ownerAgentId, arr);
    }

    const balMap = new Map(accs.map((a) => [a.ownerId, asMoney(a.balance)]));
    const agentMap = new Map(agents.map((a) => [a.userId, a]));
    const parentMap = new Map(parents.map((p) => [p.id, p]));

    /* 代分：展示上级代理绑定的房间 */
    const proxyParentAgentIds = rows
      .filter((r) => r.role === 'PROXY' && r.parentId)
      .map((r) => r.parentId!);
    const parentAgents = proxyParentAgentIds.length
      ? await this.prisma.agent.findMany({
          where: { userId: { in: proxyParentAgentIds } },
          select: { id: true, userId: true },
        })
      : [];
    const parentAgentIdByUser = new Map(parentAgents.map((a) => [a.userId, a.id]));
    const parentAgentIds = [...parentAgentIdByUser.values()];
    const parentRooms = parentAgentIds.length
      ? await this.prisma.room.findMany({
          where: { ownerAgentId: { in: parentAgentIds } },
          select: {
            id: true, roomNo: true, name: true, status: true, ownerAgentId: true,
            _count: { select: { members: { where: { status: 'APPROVED' } } } },
          },
        })
      : [];
    const roomsByParentAgentId = new Map<string, BoundRoom[]>();
    for (const r of parentRooms) {
      if (!r.ownerAgentId) continue;
      const arr = roomsByParentAgentId.get(r.ownerAgentId) ?? [];
      arr.push({
        id: r.id,
        roomNo: r.roomNo,
        name: r.name,
        status: r.status,
        memberCount: r._count.members,
      });
      roomsByParentAgentId.set(r.ownerAgentId, arr);
    }

    const dutyAgentIds = [
      ...new Set([
        ...agentUserIds,
        ...rows.filter((r) => r.role === 'PROXY' && r.parentId).map((r) => r.parentId!),
      ]),
    ];
    const dutyKeys = dutyAgentIds.map((id) => csDutyKey(id));
    const dutyVals = dutyKeys.length
      ? await this.redis.raw.mget(...dutyKeys)
      : [];
    const dutyByAgent = new Map(
      dutyAgentIds.map((id, i) => [id, dutyVals[i] || null]),
    );

    return {
      total,
      page,
      pageSize,
      list: rows.map((r) => {
        const ag = agentMap.get(r.id);
        const parent = r.parentId ? parentMap.get(r.parentId) : null;
        let boundRooms: BoundRoom[] = [];
        if (r.role === 'AGENT') {
          const aid = agentIdByUser.get(r.id);
          boundRooms = aid ? (roomsByAgentId.get(aid) ?? []) : [];
        } else if (r.role === 'PROXY' && r.parentId) {
          const paid = parentAgentIdByUser.get(r.parentId);
          boundRooms = paid ? (roomsByParentAgentId.get(paid) ?? []) : [];
        }
        const memberCount = boundRooms.reduce((s, x) => s + x.memberCount, 0);
        const dutyUserId =
          r.role === 'AGENT'
            ? dutyByAgent.get(r.id) ?? null
            : r.role === 'PROXY' && r.parentId
              ? dutyByAgent.get(r.parentId) ?? null
              : null;
        return {
          ...r,
          balance: balMap.get(r.id) ?? 0,
          commissionRate: ag ? asMoney(ag.commissionRate) : 0.002,
          rebateRate: ag ? asMoney(ag.rebateRate) : 0.018,
          pointsQuota: ag ? asMoney(ag.pointsQuota) : 0,
          pointsUsed: ag ? asMoney(ag.pointsUsed) : 0,
          flyCover: ag ? asMoney(ag.flyCover) : 0,
          parent: parent
            ? { id: parent.id, nickname: parent.nickname, username: parent.username, role: parent.role }
            : null,
          rooms: boundRooms,
          roomCount: boundRooms.length,
          memberCount,
          staffCount: r.role === 'AGENT' ? (childCountByParent.get(r.id) ?? 0) : 0,
          onDuty: r.role === 'PROXY' ? dutyUserId === r.id : false,
          dutyUserId,
        };
      }),
    };
  }

  /** 代理/房主/代分详情 */
  async getAgentDetail(actor: ConsoleActor, userId: string) {
    if (actor.role !== 'ADMIN') {
      await this.scope.assertUserInScope(actor, userId);
    }
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true, uid: true, username: true, nickname: true,
        role: true, depth: true, status: true, parentId: true,
        createdAt: true, lastLoginAt: true,
      },
    });
    if (!user || !['BRANCH', 'AGENT', 'PROXY'].includes(user.role)) {
      throw new BadRequestException('账号不存在');
    }

    const agentRootId =
      user.role === 'PROXY' && user.parentId ? user.parentId : userId;

    const [acc, agent, parent, children] = await Promise.all([
      this.prisma.pointsAccount.findUnique({
        where: { ownerId: userId },
        select: { balance: true },
      }),
      this.prisma.agent.findUnique({
        where: { userId },
        select: {
          id: true, commissionRate: true, rebateRate: true,
          pointsQuota: true, pointsUsed: true, flyCover: true,
        },
      }),
      user.parentId
        ? this.prisma.user.findUnique({
            where: { id: user.parentId },
            select: { id: true, nickname: true, username: true, role: true, uid: true },
          })
        : Promise.resolve(null),
      this.prisma.user.findMany({
        where: {
          parentId: user.role === 'PROXY' ? user.parentId! : userId,
          role: 'PROXY',
        },
        orderBy: { createdAt: 'desc' },
        select: {
          id: true, uid: true, username: true, nickname: true,
          role: true, status: true, createdAt: true, lastLoginAt: true,
        },
      }),
    ]);

    type RoomRow = {
      id: string; roomNo: string; name: string; status: string;
      monthlyFee: number; memberCount: number; openGames: number;
    };
    let rooms: RoomRow[] = [];
    let roomTotal = 0;

    if (user.role === 'AGENT' || user.role === 'PROXY') {
      const ownerAgent = await this.prisma.agent.findUnique({
        where: { userId: agentRootId },
        select: { id: true },
      });
      if (ownerAgent) {
        const rows = await this.prisma.room.findMany({
          where: { ownerAgentId: ownerAgent.id },
          orderBy: { createdAt: 'desc' },
          select: {
            id: true, roomNo: true, name: true, status: true, monthlyFee: true,
            enabledGames: true,
            _count: { select: { members: { where: { status: 'APPROVED' } } } },
          },
        });
        rooms = rows.map((r) => {
          let openGames = 0;
          try {
            const g = JSON.parse(String(r.enabledGames || '[]')) as unknown;
            openGames = Array.isArray(g) ? g.length : 0;
          } catch { openGames = 0; }
          return {
            id: r.id,
            roomNo: r.roomNo,
            name: r.name,
            status: r.status,
            monthlyFee: asMoney(r.monthlyFee),
            memberCount: r._count.members,
            openGames,
          };
        });
        roomTotal = rooms.length;
      }
    } else if (user.role === 'BRANCH' || user.role === 'ADMIN') {
      roomTotal = await this.prisma.room.count();
      const rows = await this.prisma.room.findMany({
        orderBy: { createdAt: 'desc' },
        take: 8,
        select: {
          id: true, roomNo: true, name: true, status: true, monthlyFee: true,
          enabledGames: true,
          _count: { select: { members: { where: { status: 'APPROVED' } } } },
        },
      });
      rooms = rows.map((r) => {
        let openGames = 0;
        try {
          const g = JSON.parse(String(r.enabledGames || '[]')) as unknown;
          openGames = Array.isArray(g) ? g.length : 0;
        } catch { openGames = 0; }
        return {
          id: r.id,
          roomNo: r.roomNo,
          name: r.name,
          status: r.status,
          monthlyFee: asMoney(r.monthlyFee),
          memberCount: r._count.members,
          openGames,
        };
      });
    }

    const childIds = children.map((c) => c.id);
    const childAccs = childIds.length
      ? await this.prisma.pointsAccount.findMany({
          where: { ownerId: { in: childIds } },
          select: { ownerId: true, balance: true },
        })
      : [];
    const childBal = new Map(childAccs.map((a) => [a.ownerId, asMoney(a.balance)]));

    const dutyUserId = (await this.redis.get(csDutyKey(agentRootId))) || null;
    const recentLogs = await this.prisma.adminLog.findMany({
      where: {
        OR: [
          { operatorId: userId },
          { target: userId },
          ...(childIds.length ? [{ operatorId: { in: childIds } }] : []),
        ],
      },
      orderBy: { createdAt: 'desc' },
      take: 12,
      select: {
        id: true, action: true, target: true, createdAt: true, operatorId: true,
      },
    });

    return {
      ...user,
      balance: asMoney(acc?.balance ?? 0),
      commissionRate: agent ? asMoney(agent.commissionRate) : 0.002,
      rebateRate: agent ? asMoney(agent.rebateRate) : 0.018,
      pointsQuota: agent ? asMoney(agent.pointsQuota) : 0,
      pointsUsed: agent ? asMoney(agent.pointsUsed) : 0,
      flyCover: agent ? asMoney(agent.flyCover) : 0,
      parent,
      rooms,
      roomTotal,
      dutyUserId,
      agentRootId,
      children: children.map((c) => ({
        ...c,
        balance: childBal.get(c.id) ?? 0,
        onDuty: dutyUserId === c.id,
      })),
      recentLogs,
      permissions: this.rolePermissions(user.role),
    };
  }

  /**
   * 账号资金/操作审计（只读、分页；底层为 PointsLedger + AdminLog，无删除接口）
   * tab=balance 余额流水 | fund 上下分/额度 | ops 全部操作
   */
  async getAgentAudit(
    actor: ConsoleActor,
    userId: string,
    opts: { page?: number; pageSize?: number; tab?: 'balance' | 'fund' | 'ops' } = {},
  ) {
    if (actor.role !== 'ADMIN') {
      await this.scope.assertUserInScope(actor, userId);
    }
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, role: true, parentId: true, nickname: true, username: true },
    });
    if (!user || !['BRANCH', 'AGENT', 'PROXY'].includes(user.role)) {
      throw new BadRequestException('账号不存在');
    }

    const page = Math.max(1, opts.page ?? 1);
    const pageSize = Math.min(100, Math.max(1, opts.pageSize ?? 20));
    const tab = opts.tab ?? 'fund';
    const agentRootId =
      user.role === 'PROXY' && user.parentId ? user.parentId : userId;

    const proxyIds =
      user.role === 'AGENT'
        ? (
            await this.prisma.user.findMany({
              where: { parentId: userId, role: 'PROXY' },
              select: { id: true },
            })
          ).map((p) => p.id)
        : [];
    const staffIds =
      user.role === 'AGENT'
        ? [userId, ...proxyIds]
        : user.role === 'PROXY'
          ? [userId]
          : [userId];

    const [acc, agentRow] = await Promise.all([
      this.prisma.pointsAccount.findUnique({
        where: { ownerId: userId },
        select: { id: true, balance: true },
      }),
      this.prisma.agent.findUnique({
        where: { userId: agentRootId },
        select: { pointsQuota: true, pointsUsed: true, flyCover: true },
      }),
    ]);

    const summary = await this.buildAuditSummary({
      userId,
      agentRootId,
      staffIds,
      accountId: acc?.id,
      balance: asMoney(acc?.balance ?? 0),
      pointsQuota: agentRow ? asMoney(agentRow.pointsQuota) : 0,
      pointsUsed: agentRow ? asMoney(agentRow.pointsUsed) : 0,
      flyCover: agentRow ? asMoney(agentRow.flyCover) : 0,
      role: user.role,
    });

    if (tab === 'balance') {
      return {
        tab,
        summary,
        ...(await this.listBalanceLedger(acc?.id, page, pageSize)),
      };
    }
    if (tab === 'fund') {
      return {
        tab,
        summary,
        ...(await this.listFundLogs({
          userId,
          agentRootId,
          staffIds,
          role: user.role,
          page,
          pageSize,
        })),
      };
    }
    return {
      tab: 'ops' as const,
      summary,
      ...(await this.listOpsLogs({ userId, staffIds, page, pageSize })),
    };
  }

  private async buildAuditSummary(p: {
    userId: string;
    agentRootId: string;
    staffIds: string[];
    accountId?: string;
    balance: number;
    pointsQuota: number;
    pointsUsed: number;
    flyCover: number;
    role: string;
  }) {
    const quotaRows = await this.prisma.adminLog.findMany({
      where: {
        OR: [
          { action: 'QUOTA_SELL', target: p.userId },
          { action: 'QUOTA_RECALL', target: p.userId },
        ],
      },
      select: { action: true, detail: true },
    });
    let quotaIn = 0;
    let quotaOut = 0;
    for (const r of quotaRows) {
      const d = r.detail as { amount?: number } | null;
      const amt = Number(d?.amount || 0);
      if (r.action === 'QUOTA_SELL') quotaIn += amt;
      if (r.action === 'QUOTA_RECALL') quotaOut += amt;
    }

    const fundWhere = this.fundLogWhere(p.userId, p.agentRootId, p.staffIds, p.role);
    const fundRows = await this.prisma.adminLog.findMany({
      where: fundWhere,
      select: { action: true, detail: true },
    });
    let playerUp = 0;
    let playerDown = 0;
    for (const r of fundRows) {
      const d = r.detail as { amount?: number } | null;
      const amt = Number(d?.amount || 0);
      if (r.action === 'CONSOLE_CREDIT') playerUp += amt;
      if (r.action === 'CONSOLE_DEBIT') playerDown += amt;
    }

    let ledgerIn = 0;
    let ledgerOut = 0;
    if (p.accountId) {
      const legs = await this.prisma.pointsLedger.findMany({
        where: { accountId: p.accountId },
        select: { amount: true },
      });
      for (const leg of legs) {
        const a = asMoney(leg.amount);
        if (a >= 0) ledgerIn += a;
        else ledgerOut += -a;
      }
    }

    return {
      balance: p.balance,
      pointsQuota: p.pointsQuota,
      pointsUsed: p.pointsUsed,
      flyCover: p.flyCover,
      quotaIn: round2(quotaIn),
      quotaOut: round2(quotaOut),
      playerUp: round2(playerUp),
      playerDown: round2(playerDown),
      ledgerIn: round2(ledgerIn),
      ledgerOut: round2(ledgerOut),
    };
  }

  private fundLogWhere(
    userId: string,
    agentRootId: string,
    staffIds: string[],
    role: string,
  ): Record<string, unknown> {
    if (role === 'BRANCH') {
      return {
        OR: [
          { action: { in: ['QUOTA_SELL', 'QUOTA_RECALL'] }, target: userId },
          { action: { in: ['QUOTA_SELL', 'QUOTA_RECALL'] }, operatorId: userId },
        ],
      };
    }
    return {
      OR: [
        { action: { in: ['QUOTA_SELL', 'QUOTA_RECALL'] }, target: userId },
        {
          action: { in: ['CONSOLE_CREDIT', 'CONSOLE_DEBIT'] },
          OR: [
            { operatorId: { in: staffIds } },
            { detail: { path: ['agentUserId'], equals: agentRootId } },
          ],
        },
      ],
    };
  }

  private async listBalanceLedger(
    accountId: string | undefined,
    page: number,
    pageSize: number,
  ) {
    if (!accountId) return { total: 0, page, pageSize, list: [] as unknown[] };
    const where = { accountId };
    const [total, rows] = await this.prisma.$transaction([
      this.prisma.pointsLedger.count({ where }),
      this.prisma.pointsLedger.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        select: {
          id: true,
          bizType: true,
          amount: true,
          balanceAfter: true,
          refType: true,
          refId: true,
          remark: true,
          operatorId: true,
          createdAt: true,
        },
      }),
    ]);
    const opIds = [...new Set(rows.map((r) => r.operatorId).filter(Boolean))] as string[];
    const ops = opIds.length
      ? await this.prisma.user.findMany({
          where: { id: { in: opIds } },
          select: { id: true, nickname: true, username: true, role: true, uid: true },
        })
      : [];
    const opMap = new Map(ops.map((o) => [o.id, o]));
    return {
      total,
      page,
      pageSize,
      list: rows.map((r) => ({
        id: r.id,
        kind: 'LEDGER',
        action: r.bizType,
        actionLabel: ledgerLabel(r.bizType, r.refType),
        amount: asMoney(r.amount),
        balanceAfter: asMoney(r.balanceAfter),
        remark: r.remark,
        refType: r.refType,
        createdAt: r.createdAt,
        operator: r.operatorId ? opMap.get(r.operatorId) ?? null : null,
        counterparty: null as null,
        detail: { refType: r.refType, refId: r.refId },
      })),
    };
  }

  private async listFundLogs(p: {
    userId: string;
    agentRootId: string;
    staffIds: string[];
    role: string;
    page: number;
    pageSize: number;
  }) {
    const where = this.fundLogWhere(p.userId, p.agentRootId, p.staffIds, p.role);
    const [total, rows] = await this.prisma.$transaction([
      this.prisma.adminLog.count({ where }),
      this.prisma.adminLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (p.page - 1) * p.pageSize,
        take: p.pageSize,
        select: {
          id: true,
          action: true,
          target: true,
          detail: true,
          operatorId: true,
          createdAt: true,
        },
      }),
    ]);
    return {
      total,
      page: p.page,
      pageSize: p.pageSize,
      list: await this.enrichAdminRows(rows),
    };
  }

  private async listOpsLogs(p: {
    userId: string;
    staffIds: string[];
    page: number;
    pageSize: number;
  }) {
    const where = {
      OR: [
        { operatorId: { in: p.staffIds } },
        { target: p.userId },
      ],
    };
    const [total, rows] = await this.prisma.$transaction([
      this.prisma.adminLog.count({ where }),
      this.prisma.adminLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (p.page - 1) * p.pageSize,
        take: p.pageSize,
        select: {
          id: true,
          action: true,
          target: true,
          detail: true,
          operatorId: true,
          createdAt: true,
        },
      }),
    ]);
    return {
      total,
      page: p.page,
      pageSize: p.pageSize,
      list: await this.enrichAdminRows(rows),
    };
  }

  private async enrichAdminRows(
    rows: {
      id: string;
      action: string;
      target: string | null;
      detail: unknown;
      operatorId: string;
      createdAt: Date;
    }[],
  ) {
    const userIds = new Set<string>();
    for (const r of rows) {
      userIds.add(r.operatorId);
      if (r.target) userIds.add(r.target);
      const d = r.detail as { agentUserId?: string } | null;
      if (d?.agentUserId) userIds.add(d.agentUserId);
    }
    const users = userIds.size
      ? await this.prisma.user.findMany({
          where: { id: { in: [...userIds] } },
          select: { id: true, nickname: true, username: true, role: true, uid: true },
        })
      : [];
    const umap = new Map(users.map((u) => [u.id, u]));

    return rows.map((r) => {
      const d = (r.detail || {}) as Record<string, unknown>;
      const amount = d.amount != null ? Number(d.amount) : null;
      const operator = umap.get(r.operatorId) ?? null;
      const targetUser = r.target ? umap.get(r.target) ?? null : null;
      return {
        id: r.id,
        kind: 'ADMIN_LOG',
        action: r.action,
        actionLabel: adminActionLabel(r.action, d),
        amount,
        balanceAfter: null as number | null,
        remark: typeof d.remark === 'string' ? d.remark : null,
        createdAt: r.createdAt,
        operator,
        counterparty: targetUser,
        detail: {
          ...d,
          real: d.real != null ? Number(d.real) : undefined,
          fake: d.fake != null ? Number(d.fake) : undefined,
          coverBack: d.coverBack != null ? Number(d.coverBack) : undefined,
          byProxy: !!d.byProxy,
          fromRole: d.fromRole,
          direction: d.direction,
        },
      };
    });
  }

  /** 设置当前值班客服（仅代理本人；空=代理自己接） */
  async setCsDuty(actor: ConsoleActor, agentUserId: string, dutyUserId: string | null) {
    if (actor.role !== 'AGENT' || actor.id !== agentUserId) {
      throw new BadRequestException('仅代理本人可调整本房值班');
    }
    const agentUser = await this.prisma.user.findUnique({
      where: { id: agentUserId },
      select: { id: true, role: true },
    });
    if (!agentUser || agentUser.role !== 'AGENT') {
      throw new BadRequestException('只能给代理设置值班客服');
    }

    if (!dutyUserId) {
      await this.redis.del(csDutyKey(agentUserId));
      await this.adminLog.log(actor.id, 'CS_DUTY_CLEAR', agentUserId, {});
      return { ok: true, dutyUserId: null };
    }

    const staff = await this.prisma.user.findUnique({
      where: { id: dutyUserId },
      select: { id: true, role: true, parentId: true, status: true },
    });
    if (!staff || staff.role !== 'PROXY' || staff.parentId !== agentUserId) {
      throw new BadRequestException('值班人须是该代理下的客服');
    }
    if (staff.status !== 'ACTIVE') throw new BadRequestException('该客服已停用');

    await this.redis.set(csDutyKey(agentUserId), dutyUserId);
    await this.adminLog.log(actor.id, 'CS_DUTY_SET', agentUserId, { dutyUserId });
    return { ok: true, dutyUserId };
  }

  private rolePermissions(role: string) {
    if (role === 'BRANCH') {
      return {
        label: '房主',
        summary: '管全部房间；游戏赔率由超管配置',
        can: ['全部房间', '代理/客服', '额度', '报表'],
        cannot: ['游戏赔率', '控奖'],
      };
    }
    if (role === 'AGENT') {
      return {
        label: '代理',
        summary: '房间绑定账号，可开子账号',
        can: ['报表', '回水', '机器人', '上下分', '子账号'],
        cannot: ['其他房间', '平台赔率'],
      };
    }
    return {
      label: '子账号',
      summary: '与代理同看，部分只读',
      can: ['上下分', '本房报表'],
      cannot: ['改回水/机器人', '建号'],
    };
  }

  /** 创建房主 / 子账号（客服）。代理号只在创建房间时生成，此处禁止建 AGENT */
  async createAgent(
    actor: ConsoleActor,
    body: {
      username: string;
      password: string;
      nickname?: string;
      role?: 'BRANCH' | 'AGENT' | 'PROXY';
      /** 创建子账号时：所属代理（超管/房主必填；代理创建则默认自己） */
      parentAgentUserId?: string;
    },
  ) {
    const role = body.role ?? 'PROXY';
    if (role === 'AGENT') {
      throw new BadRequestException('代理账号请在「房间中心」创建房间时生成，不可在此单独添加');
    }
    if (actor.role === 'AGENT' && role !== 'PROXY') {
      throw new BadRequestException('代理只能开子账号(客服)');
    }
    if (actor.role === 'BRANCH' && role !== 'PROXY') {
      throw new BadRequestException('房主只能给代理开子账号');
    }
    if (actor.role === 'PROXY') {
      throw new BadRequestException('子账号无权创建账号');
    }
    if (actor.role !== 'ADMIN' && role === 'BRANCH') {
      throw new BadRequestException('仅超管可创建房主');
    }

    const username = body.username.toLowerCase().trim();
    if (!/^[a-z0-9]{8,20}$/.test(username)) {
      throw new BadRequestException('用户名须 8-20 位小写字母数字');
    }
    if (!body.password || body.password.length < 6) {
      throw new BadRequestException('密码至少 6 位');
    }

    let parentId: string | null = actor.id;
    let parent = await this.prisma.user.findUnique({ where: { id: actor.id } });
    if (!parent) throw new BadRequestException();

    if (role === 'BRANCH') {
      parentId = null;
    } else if (role === 'PROXY') {
      if (actor.role === 'AGENT') {
        const hasRoom = await this.prisma.room.findFirst({
          where: { ownerAgent: { userId: actor.id } },
          select: { id: true },
        });
        if (!hasRoom) throw new BadRequestException('当前代理尚未绑定房间，无法开子账号');
        parentId = actor.id;
      } else {
        const pid = body.parentAgentUserId?.trim();
        if (!pid) throw new BadRequestException('开子账号须指定所属代理');
        await this.scope.assertUserInScope(actor, pid);
        const agentUser = await this.prisma.user.findUnique({ where: { id: pid } });
        if (!agentUser || agentUser.role !== 'AGENT') {
          throw new BadRequestException('所属账号必须是房间绑定代理');
        }
        const hasRoom = await this.prisma.room.findFirst({
          where: { ownerAgent: { userId: pid } },
          select: { id: true },
        });
        if (!hasRoom) throw new BadRequestException('该代理尚未绑定房间');
        parentId = pid;
        parent = agentUser;
      }
    }

    const passwordHash = await bcrypt.hash(body.password, 10);
    const uid = await this.allocUid();
    const nickname = body.nickname?.trim()
      || (role === 'PROXY' ? `客服${uid.slice(-4)}` : `房主${uid.slice(-4)}`);

    const user = await this.prisma.$transaction(async (tx) => {
      const created = await tx.user.create({
        data: {
          username,
          passwordHash,
          uid,
          nickname,
          role,
          parentId,
          agentPath: parentId && parent
            ? `${parent.agentPath}${parent.id}/`
            : '/',
          depth: parentId && parent ? parent.depth + 1 : 0,
        },
      });
      await tx.agent.create({ data: { userId: created.id } });
      await tx.pointsAccount.create({
        data: {
          ownerType: role === 'BRANCH' ? 'BRANCH' : role === 'PROXY' ? 'PROXY' : 'AGENT',
          ownerId: created.id,
        },
      });
      return created;
    });

    await this.adminLog.log(actor.id, 'AGENT_CREATE', user.id, {
      role, username, parentId,
    });
    return {
      id: user.id,
      uid: user.uid,
      username: user.username,
      nickname: user.nickname,
      role: user.role,
      parentId,
    };
  }

  private async allocUid() {
    for (let i = 0; i < 20; i++) {
      const uid = String(100000000 + Math.floor(Math.random() * 900000000));
      const clash = await this.prisma.user.findUnique({ where: { uid } });
      if (!clash) return uid;
    }
    throw new BadRequestException('UID 分配失败');
  }
}

function round2(n: number) {
  return Math.round(n * 100) / 100;
}

function ledgerLabel(bizType: string, refType?: string | null) {
  if (refType === 'console_quota') return bizType === 'TRANSFER_IN' ? '收到额度' : '下发额度';
  if (refType === 'console_quota_recall') {
    return bizType === 'TRANSFER_OUT' ? '被回收额度' : '回收额度入账';
  }
  if (refType === 'console_credit' || refType === 'console_credit_real') {
    return bizType === 'TRANSFER_OUT' ? '给玩家上分' : '玩家上分入账';
  }
  if (refType === 'console_debit') {
    return bizType === 'TRANSFER_IN' ? '玩家下分回收' : '玩家下分扣款';
  }
  if (refType === 'room_fund') return '房间注资';
  const map: Record<string, string> = {
    TRANSFER_IN: '转入',
    TRANSFER_OUT: '转出',
    RECHARGE: '充值',
    WITHDRAW: '提现',
    BET: '投注',
    WIN: '派奖',
    COMMISSION: '佣金',
    REBATE: '回水',
    ADJUST: '调账',
    FEE: '手续费',
    ACTIVITY: '活动',
  };
  return map[bizType] || bizType;
}

function adminActionLabel(action: string, detail: Record<string, unknown>) {
  if (action === 'QUOTA_SELL') {
    const from = detail.fromRole === 'BRANCH' ? '房主' : detail.fromRole === 'ADMIN' ? '超管' : '上级';
    return `${from}下发额度`;
  }
  if (action === 'QUOTA_RECALL') {
    const by = detail.operatorRole === 'BRANCH' ? '房主' : detail.operatorRole === 'ADMIN' ? '超管' : '上级';
    return `${by}回收额度`;
  }
  if (action === 'CONSOLE_CREDIT') {
    return detail.byProxy ? '子账号给玩家上分' : '给玩家上分';
  }
  if (action === 'CONSOLE_DEBIT') {
    return detail.byProxy ? '子账号给玩家下分' : '给玩家下分';
  }
  const map: Record<string, string> = {
    AGENT_CREATE: '开通账号',
    CS_DUTY_SET: '设置值班',
    CS_DUTY_CLEAR: '清除值班',
    ROOM_FUND: '房间注资',
  };
  return map[action] || action;
}
