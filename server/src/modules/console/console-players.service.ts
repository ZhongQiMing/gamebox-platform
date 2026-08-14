import {
  BadRequestException, ForbiddenException, Injectable, NotFoundException,
} from '@nestjs/common';
import { randomBytes, randomUUID } from 'node:crypto';
import { asMoney, validateOpsPassword, validatePassword } from '@gamebox/shared';
import * as bcrypt from 'bcrypt';
import { PASSWORD_SALT_ROUNDS } from '../../common/security.constants';
import { PrismaService } from '../../prisma/prisma.service';
import { RedisService } from '../../redis/redis.service';
import { AdminLogService } from '../admin/admin-log.service';
import { HangService } from '../agents/hang.service';
import { ConsoleScopeService, type ConsoleActor } from './console-scope.service';
import { rethrowUserUniqueConflict, throwUsernameTaken } from '../../common/utils/user-unique';
import { pickAvatarUniqueInTx } from '../users/avatar-assign';
import { writeAgentQuotaInTx } from './player-fund.helper';
import { normalizeSettleCycle } from './room-settle.service';

const csDutyKey = (agentUserId: string) => `gamebox:cs-duty:${agentUserId}`;

function genProxyPassword() {
  return `Px${randomBytes(4).toString('hex')}9`;
}

@Injectable()
export class ConsolePlayersService {
  constructor(
    private prisma: PrismaService,
    private scope: ConsoleScopeService,
    private adminLog: AdminLogService,
    private redis: RedisService,
    private hangService: HangService,
  ) {}

  async list(
    actor: ConsoleActor,
    opts: {
      page?: number;
      pageSize?: number;
      q?: string;
      roomId?: string;
      /** positive=持分>0；zero=持分严格为 0（含无账户；不含负数） */
      points?: string;
    } = {},
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

    const pointsFilter = (opts.points || '').trim().toLowerCase();
    if (pointsFilter === 'positive' || pointsFilter === 'zero') {
      const scopeIds = (
        await this.prisma.user.findMany({
          where: baseWhere,
          select: { id: true },
        })
      ).map((u) => u.id);
      const listRoomId = String(opts.roomId || '').trim();
      const accs = scopeIds.length
        ? await this.prisma.pointsAccount.findMany({
            where: {
              ownerType: 'PLAYER',
              ownerId: { in: scopeIds },
              ...(listRoomId ? { roomId: listRoomId } : {}),
            },
            select: { ownerId: true, balance: true },
          })
        : [];
      const balMap = new Map<string, number>();
      for (const a of accs) {
        balMap.set(a.ownerId, (balMap.get(a.ownerId) ?? 0) + asMoney(a.balance));
      }
      const filtered =
        pointsFilter === 'positive'
          ? scopeIds.filter((id) => (balMap.get(id) ?? 0) > 0)
          : scopeIds.filter((id) => (balMap.get(id) ?? 0) === 0);
      baseWhere = {
        AND: [baseWhere, { id: { in: filtered.length ? filtered : ['__none__'] } }],
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
          loginLockedAt: true,
          parentId: true,
          createdAt: true,
          lastLoginIp: true,
          lastLoginAt: true,
        },
      }),
    ]);

    const ids = rows.map((r) => r.id);
    const listRoomId = String(opts.roomId || '').trim();
    let defaultRebateRate = 0.018;
    try {
      const rootId = await this.scope.scopeRootUserId(actor);
      const ag = await this.prisma.agent.findUnique({
        where: { userId: rootId },
        select: { rebateRate: true },
      });
      if (ag) defaultRebateRate = asMoney(ag.rebateRate);
    } catch {
      /* ADMIN 等无根代理时用默认 */
    }

    const roomHangs = listRoomId && ids.length
      ? await this.prisma.roomPlayerHang.findMany({
          where: { roomId: listRoomId, playerId: { in: ids } },
          select: { playerId: true, parentId: true },
        })
      : [];
    const hangParentByPlayer = new Map(roomHangs.map((h) => [h.playerId, h.parentId]));
    const parentIds = listRoomId
      ? [...new Set(roomHangs.map((h) => h.parentId))]
      : ([...new Set(rows.map((r) => r.parentId).filter(Boolean))] as string[]);

    const [accs, memberRows, parents, childGroups] = await Promise.all([
      this.prisma.pointsAccount.findMany({
        where: {
          ownerId: { in: ids },
          ownerType: 'PLAYER',
          ...(listRoomId ? { roomId: listRoomId } : {}),
        },
        select: { ownerId: true, balance: true },
      }),
      ids.length
        ? this.prisma.roomMember.findMany({
            where: {
              playerId: { in: ids },
              status: 'APPROVED',
              ...(listRoomId ? { roomId: listRoomId } : {}),
            },
            select: {
              playerId: true,
              flyEnabled: true,
              playerRebateRate: true,
              updatedAt: true,
            },
            orderBy: { updatedAt: 'desc' },
          })
        : Promise.resolve([]),
      parentIds.length
        ? this.prisma.user.findMany({
            where: { id: { in: parentIds } },
            select: { id: true, uid: true, nickname: true, username: true },
          })
        : Promise.resolve([]),
      ids.length
        ? listRoomId
          ? this.prisma.roomPlayerHang.groupBy({
              by: ['parentId'],
              where: { roomId: listRoomId, parentId: { in: ids } },
              _count: { _all: true },
            })
          : this.prisma.user.groupBy({
              by: ['parentId'],
              where: { parentId: { in: ids } },
              _count: { _all: true },
            })
        : Promise.resolve([]),
    ]);
    const balMap = new Map<string, number>();
    for (const a of accs) {
      balMap.set(a.ownerId, (balMap.get(a.ownerId) ?? 0) + asMoney(a.balance));
    }
    const parentMap = new Map(parents.map((p) => [p.id, p]));
    const childCountMap = new Map(
      childGroups.map((g) => [g.parentId as string, g._count._all]),
    );
    const memberMap = new Map<string, { flyEnabled: boolean; playerRebateRate: number | null }>();
    for (const m of memberRows) {
      if (memberMap.has(m.playerId)) continue;
      memberMap.set(m.playerId, {
        flyEnabled: m.flyEnabled,
        playerRebateRate: m.playerRebateRate,
      });
    }

    return {
      total,
      page,
      pageSize,
      list: rows.map((r) => {
        const mem = memberMap.get(r.id);
        const parentId = listRoomId
          ? hangParentByPlayer.get(r.id) ?? null
          : r.parentId;
        const parent = parentId ? parentMap.get(parentId) ?? null : null;
        const playerRebateRate = mem?.playerRebateRate ?? null;
        return {
          ...r,
          parentId,
          loginLocked: !!r.loginLockedAt,
          balance: balMap.get(r.id) ?? 0,
          flyEnabled: mem?.flyEnabled ?? true,
          playerRebateRate,
          rebateRate: playerRebateRate ?? defaultRebateRate,
          childCount: childCountMap.get(r.id) ?? 0,
          parent: parent
            ? {
                id: parent.id,
                uid: parent.uid,
                nickname: parent.nickname,
                username: parent.username,
              }
            : null,
        };
      }),
    };
  }

  /** 玩家详情：资料 + 上级 + 直属下级 + 本房飞盘/回水 */
  async getPlayerDetail(actor: ConsoleActor, playerId: string, roomId?: string) {
    if (actor.role !== 'ADMIN') await this.scope.assertUserInScope(actor, playerId);
    const user = await this.prisma.user.findUnique({
      where: { id: playerId },
      select: {
        id: true,
        uid: true,
        username: true,
        nickname: true,
        status: true,
        parentId: true,
        createdAt: true,
        lastLoginAt: true,
        lastLoginIp: true,
        role: true,
      },
    });
    if (!user || user.role !== 'PLAYER') {
      throw new NotFoundException('玩家不存在');
    }

    const detailRoomId = String(roomId || '').trim();
    const roomHang = detailRoomId
      ? await this.prisma.roomPlayerHang.findUnique({
          where: { roomId_playerId: { roomId: detailRoomId, playerId } },
          select: { parentId: true },
        })
      : null;
    const effectiveParentId = detailRoomId
      ? roomHang?.parentId ?? null
      : user.parentId;

    const [parent, children, member] = await Promise.all([
      effectiveParentId
        ? this.prisma.user.findUnique({
            where: { id: effectiveParentId },
            select: { id: true, uid: true, nickname: true, username: true, role: true },
          })
        : Promise.resolve(null),
      detailRoomId
        ? this.prisma.roomPlayerHang.findMany({
            where: { roomId: detailRoomId, parentId: playerId },
            orderBy: { createdAt: 'desc' },
            take: 50,
            select: {
              player: {
                select: {
                  id: true, uid: true, nickname: true, username: true, status: true, createdAt: true,
                },
              },
            },
          }).then((rows) => rows.map((r) => r.player))
        : this.prisma.user.findMany({
            where: { parentId: playerId },
            orderBy: { createdAt: 'desc' },
            take: 50,
            select: {
              id: true, uid: true, nickname: true, username: true, status: true, createdAt: true,
            },
          }),
      this.prisma.roomMember.findFirst({
        where: {
          playerId,
          status: 'APPROVED',
          ...(detailRoomId ? { roomId: detailRoomId } : {}),
        },
        orderBy: { updatedAt: 'desc' },
        select: {
          roomId: true,
          flyEnabled: true,
          playerRebateRate: true,
          room: { select: { id: true, roomNo: true, name: true } },
        },
      }),
    ]);

    const balRoomId = roomId || member?.roomId;
    const acc = balRoomId
      ? await this.prisma.pointsAccount.findFirst({
          where: { ownerType: 'PLAYER', ownerId: playerId, roomId: balRoomId },
          select: { balance: true },
        })
      : await this.prisma.pointsAccount.findFirst({
          where: { ownerType: 'PLAYER', ownerId: playerId },
          select: { balance: true },
          orderBy: { updatedAt: 'desc' },
        });

    const childIds = children.map((c) => c.id);
    const childAccs = childIds.length
      ? await this.prisma.pointsAccount.findMany({
          where: {
            ownerId: { in: childIds },
            ownerType: 'PLAYER',
            ...(balRoomId ? { roomId: balRoomId } : {}),
          },
          select: { ownerId: true, balance: true },
        })
      : [];
    const childBal = new Map(childAccs.map((a) => [a.ownerId, asMoney(a.balance)]));

    return {
      id: user.id,
      uid: user.uid,
      username: user.username,
      nickname: user.nickname,
      status: user.status,
      createdAt: user.createdAt,
      lastLoginAt: user.lastLoginAt,
      lastLoginIp: user.lastLoginIp,
      balance: asMoney(acc?.balance ?? 0),
      flyEnabled: member?.flyEnabled ?? true,
      playerRebateRate: member?.playerRebateRate ?? null,
      roomId: member?.roomId ?? null,
      room: member?.room
        ? { id: member.room.id, roomNo: member.room.roomNo, name: member.room.name }
        : null,
      parent: parent
        ? {
            id: parent.id,
            uid: parent.uid,
            nickname: parent.nickname,
            username: parent.username,
            role: parent.role,
          }
        : null,
      children: children.map((c) => ({
        ...c,
        balance: childBal.get(c.id) ?? 0,
      })),
      childCount: children.length,
    };
  }

  /**
   * 控制台挂靠：本房把 friendUid 挂到 underUid（推荐人）名下。
   * 仅房间主代理可操作；规则与 POST /agent/hang 一致（按房隔离）。
   */
  async hangPlayer(
    actor: ConsoleActor,
    friendUid: string,
    underUid: string,
    roomId?: string,
  ) {
    if (actor.role !== 'AGENT') {
      throw new ForbiddenException('仅代理可操作挂靠');
    }
    const result = await this.hangService.hang(actor.id, friendUid, underUid, roomId);
    await this.adminLog.log(actor.id, 'PLAYER_HANG', underUid, {
      friendUid: friendUid.trim(),
      underUid: underUid.trim(),
      roomId: result.roomId,
      message: result.message,
    });
    return result;
  }

  async setStatus(actor: ConsoleActor, userId: string, status: 'ACTIVE' | 'DISABLED') {
    if (actor.role !== 'ADMIN') await this.scope.assertUserInScope(actor, userId);
    const before = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { status: true },
    });
    /* 注销是玩家自己发起且已清个人信息，后台不能再把它启用回来 */
    if (before?.status === 'CLOSED') {
      throw new BadRequestException('该账号已注销，不能再改状态');
    }
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

  /** 单玩家飞盘开关：仅主代理（管理员/房主/子账号不可改） */
  async setPlayerFly(
    actor: ConsoleActor,
    playerId: string,
    flyEnabled: boolean,
    roomId?: string,
  ) {
    if (actor.role !== 'AGENT') {
      throw new ForbiddenException('仅房间主代理可调整玩家飞盘');
    }
    await this.scope.assertUserInScope(actor, playerId);
    const member = await this.prisma.roomMember.findFirst({
      where: {
        playerId,
        status: 'APPROVED',
        ...(roomId ? { roomId } : {}),
      },
      orderBy: { updatedAt: 'desc' },
    });
    if (!member) throw new BadRequestException('玩家未绑定房间');
    await this.scope.assertRoomAccess(actor, member.roomId);
    const room = await this.prisma.room.findUnique({
      where: { id: member.roomId },
      select: { ownerAgent: { select: { userId: true } } },
    });
    if (room?.ownerAgent?.userId !== actor.id) {
      throw new ForbiddenException('只能调整自己房间的玩家飞盘');
    }
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
    const member = await this.prisma.roomMember.findFirst({
      where: {
        playerId,
        status: 'APPROVED',
        ...(roomId ? { roomId } : {}),
      },
      orderBy: { updatedAt: 'desc' },
      include: {
        room: { select: { ownerAgent: { select: { flowRate: true } } } },
      },
    });
    if (!member) throw new BadRequestException('玩家未绑定房间');

    const policy = await this.prisma.rebatePolicy.findUnique({ where: { id: 1 } });
    const min = policy?.playerMinRate ?? 0.018;
    /* 上限跟发放口径对齐：本房代理整包的一半，超了会在发放时被静默截断 */
    const agentPkg = Math.max(
      min,
      Number(member.room?.ownerAgent?.flowRate ?? policy?.agentDefaultRate ?? 0.05),
    );
    const max = agentPkg / 2;
    if (rate < min || rate > max) {
      throw new BadRequestException(
        `玩家回水须在 ${(min * 100).toFixed(1)}%～${(max * 100).toFixed(2)}%（本房代理整包 ${(agentPkg * 100).toFixed(1)}% 的一半）`,
      );
    }
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
    } else if (actor.role === 'GENERAL') {
      /* 总代：自己的子账号，以及名下房间绑定的代理 */
      const roomIds = (await this.scope.grantedRoomIds(actor)) ?? [];
      where = opts.role === 'AGENT'
        ? roomIds.length
          ? { role: 'AGENT', agent: { is: { rooms: { some: { id: { in: roomIds } } } } } }
          : { role: 'AGENT', id: { in: ['__none__'] } }
        : { role: 'PROXY', parentId: actor.id };
    } else {
      /* ADMIN / BRANCH：默认已绑房代理；可筛子账号 / 房主 */
      const role = ['BRANCH', 'AGENT', 'PROXY', 'GENERAL'].includes(opts.role || '')
        ? (opts.role as string)
        : 'AGENT';
      if (actor.role === 'BRANCH') {
        /* 总监：总代全平台可见；代理/子账号仍只看授权房间 */
        if (role === 'GENERAL') {
          where = { role: 'GENERAL' };
        } else {
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
    const agentUserIds = rows.filter((r) => r.role === 'AGENT' || r.role === 'GENERAL').map((r) => r.id);
    /* 子账号额度读主代理：一并加载 parent 的 Agent */
    const agentLookupIds = [...new Set([...ids, ...parentIds])];
    const [accs, agents, parents, agentRows, childGroups] = await Promise.all([
      this.prisma.pointsAccount.findMany({
        where: { ownerId: { in: ids } },
        select: { ownerId: true, balance: true },
      }),
      this.prisma.agent.findMany({
        where: { userId: { in: agentLookupIds } },
        select: {
          id: true,
          userId: true,
          commissionRate: true,
          rebateRate: true,
          flowRate: true,
          shareRate: true,
          pointsQuota: true,
          pointsUsed: true,
          flyCover: true,
          bookMode: true,
          creditLimit: true,
          settleCycle: true,
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
          where: {
            OR: [
              { ownerAgentId: { in: agentIds } },
              { generalAgentId: { in: agentIds } },
            ],
          },
          select: {
            id: true, roomNo: true, name: true, status: true, ownerAgentId: true, generalAgentId: true, bookMode: true,
            _count: { select: { members: { where: { status: 'APPROVED' } } } },
          },
        })
      : [];
    type BoundRoom = {
      id: string; roomNo: string; name: string; status: string; memberCount: number; bookMode: string;
    };
    const roomsByAgentId = new Map<string, BoundRoom[]>();
    const roomsByGeneralId = new Map<string, BoundRoom[]>();
    for (const r of rooms) {
      const item = {
        id: r.id,
        roomNo: r.roomNo,
        name: r.name,
        status: r.status,
        memberCount: r._count.members,
        bookMode: r.bookMode === 'CREDIT' ? 'CREDIT' : 'CASH',
      };
      if (r.ownerAgentId) {
        const arr = roomsByAgentId.get(r.ownerAgentId) ?? [];
        arr.push(item);
        roomsByAgentId.set(r.ownerAgentId, arr);
      }
      if (r.generalAgentId) {
        const garr = roomsByGeneralId.get(r.generalAgentId) ?? [];
        garr.push(item);
        roomsByGeneralId.set(r.generalAgentId, garr);
      }
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
            id: true, roomNo: true, name: true, status: true, ownerAgentId: true, bookMode: true,
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
        bookMode: r.bookMode === 'CREDIT' ? 'CREDIT' : 'CASH',
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

    const branchIds = rows.filter((r) => r.role === 'BRANCH').map((r) => r.id);
    const branchGrantGroups = branchIds.length
      ? await this.prisma.roomOwnerGrant.groupBy({
          by: ['ownerId'],
          where: { ownerId: { in: branchIds } },
          _count: { _all: true },
        })
      : [];
    const grantCountByBranch = new Map(
      branchGrantGroups.map((g) => [g.ownerId, g._count._all]),
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
        } else if (r.role === 'GENERAL') {
          const aid = agentIdByUser.get(r.id);
          boundRooms = aid ? (roomsByGeneralId.get(aid) ?? []) : [];
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
        const roomCount =
          r.role === 'BRANCH'
            ? (grantCountByBranch.get(r.id) ?? 0)
            : boundRooms.length;
        /* 子账号与主代理共用额度/飞盘 */
        const quotaAg =
          r.role === 'PROXY' && r.parentId
            ? agentMap.get(r.parentId) ?? ag
            : ag;
        return {
          ...r,
          balance: balMap.get(r.id) ?? 0,
          commissionRate: quotaAg ? asMoney(quotaAg.commissionRate) : 0.002,
          rebateRate: quotaAg ? asMoney(quotaAg.rebateRate) : 0.018,
          flowRate: quotaAg ? Number(quotaAg.flowRate ?? 0.05) : 0.05,
          shareRate: quotaAg ? Number(quotaAg.shareRate ?? 0.5) : 0.5,
          /* 盘口与合同额度只有总代自己这一层有意义，代理侧不返回免得误读 */
          bookMode: r.role === 'GENERAL' ? (ag?.bookMode ?? 'CASH') : undefined,
          creditLimit: r.role === 'GENERAL' ? asMoney(ag?.creditLimit ?? 0) : undefined,
          settleCycle: r.role === 'GENERAL' ? (ag?.settleCycle ?? 'WEEKLY_MON') : undefined,
          pointsQuota: r.role === 'BRANCH' ? 0 : quotaAg ? asMoney(quotaAg.pointsQuota) : 0,
          pointsUsed: r.role === 'BRANCH' ? 0 : quotaAg ? asMoney(quotaAg.pointsUsed) : 0,
          flyCover: quotaAg ? asMoney(quotaAg.flyCover) : 0,
          parent: parent
            ? { id: parent.id, nickname: parent.nickname, username: parent.username, role: parent.role }
            : null,
          rooms: boundRooms,
          roomCount,
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
    if (!user || !['BRANCH', 'AGENT', 'PROXY', 'GENERAL'].includes(user.role)) {
      throw new BadRequestException('账号不存在');
    }

    const agentRootId =
      user.role === 'PROXY' && user.parentId ? user.parentId : userId;

    const ownerType =
      user.role === 'BRANCH' ? 'BRANCH' : user.role === 'PROXY' ? 'PROXY' : 'AGENT';
    const [acc, agent, parent, children] = await Promise.all([
      this.prisma.pointsAccount.findFirst({
        where: { ownerType: ownerType as never, ownerId: userId, roomId: '' },
        select: { balance: true },
      }),
      /* 子账号额度/飞盘读主代理 */
      this.prisma.agent.findUnique({
        where: { userId: agentRootId },
          select: {
            id: true, commissionRate: true, rebateRate: true,
            pointsQuota: true, pointsUsed: true, flyCover: true,
            flowRate: true, shareRate: true,
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

    if (user.role === 'AGENT' || user.role === 'PROXY' || user.role === 'GENERAL') {
      const ownerAgent = await this.prisma.agent.findUnique({
        where: { userId: agentRootId },
        select: { id: true },
      });
      if (ownerAgent) {
        const rows = await this.prisma.room.findMany({
          where: user.role === 'GENERAL'
            ? { generalAgentId: ownerAgent.id }
            : { ownerAgentId: ownerAgent.id },
          orderBy: { createdAt: 'desc' },
          select: {
            id: true, roomNo: true, name: true, status: true, monthlyFee: true,
            enabledGames: true,
            _count: { select: { members: { where: { status: 'APPROVED' } } } },
          },
        });
        rooms = rows.map((r) => {
          let openGames: number;
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
    } else if (user.role === 'BRANCH') {
      /* 与房间「可见房主」一致：只认 RoomOwnerGrant，禁止把全平台房间算给房主 */
      const grants = await this.prisma.roomOwnerGrant.findMany({
        where: { ownerId: userId },
        select: { roomId: true },
      });
      const grantedIds = grants.map((g) => g.roomId);
      roomTotal = grantedIds.length;
      if (grantedIds.length) {
        const rows = await this.prisma.room.findMany({
          where: { id: { in: grantedIds } },
          orderBy: { createdAt: 'desc' },
          take: 8,
          select: {
            id: true, roomNo: true, name: true, status: true, monthlyFee: true,
            enabledGames: true,
            _count: { select: { members: { where: { status: 'APPROVED' } } } },
          },
        });
        rooms = rows.map((r) => {
          let openGames: number;
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
   * tab=balance 余额流水 | fund 上下分/额度/客服划额 | ops 全部操作
   * fund 支持 from/to、fundType 筛选，并返回筛选后汇总 fundTotals
   */
  async getAgentAudit(
    actor: ConsoleActor,
    userId: string,
    opts: {
      page?: number;
      pageSize?: number;
      tab?: 'balance' | 'fund' | 'ops' | 'wage';
      from?: string;
      to?: string;
      fundType?: string;
    } = {},
  ) {
    if (actor.role === 'CS' && userId !== actor.id) {
      throw new ForbiddenException('客服仅可查看本人流水');
    }
    if (actor.role !== 'ADMIN') {
      await this.scope.assertUserInScope(actor, userId);
    }
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, role: true, parentId: true, nickname: true, username: true },
    });
    if (!user || !['BRANCH', 'AGENT', 'PROXY', 'CS'].includes(user.role)) {
      throw new BadRequestException('账号不存在');
    }

    const page = Math.max(1, opts.page ?? 1);
    const pageSize = Math.min(100, Math.max(1, opts.pageSize ?? 20));
    const tab = opts.tab ?? 'fund';
    const agentRootId =
      (user.role === 'PROXY' || user.role === 'CS') && user.parentId
        ? user.parentId
        : userId;

    const proxyIds =
      user.role === 'AGENT'
        ? (
            await this.prisma.user.findMany({
              where: { parentId: userId, role: 'PROXY' },
              select: { id: true },
            })
          ).map((p) => p.id)
        : [];
    const csIds =
      user.role === 'AGENT' || user.role === 'PROXY'
        ? (
            await this.prisma.user.findMany({
              where: { parentId: agentRootId, role: 'CS' },
              select: { id: true },
            })
          ).map((c) => c.id)
        : [];
    const staffIds =
      user.role === 'AGENT'
        ? [userId, ...proxyIds]
        : user.role === 'PROXY' || user.role === 'CS'
          ? [userId]
          : [userId];
    const operatorIds =
      user.role === 'CS' ? [userId] : [...new Set([...staffIds, ...csIds])];

    const walletType =
      user.role === 'CS' ? 'CS' : user.role === 'PROXY' ? 'PROXY' : 'AGENT';
    const [acc, agentRow] = await Promise.all([
      this.prisma.pointsAccount.findFirst({
        where: { ownerType: walletType as never, ownerId: userId, roomId: '' },
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

    if (tab === 'balance' || tab === 'wage') {
      return {
        tab,
        summary,
        ...(await this.listBalanceLedger(acc?.id, page, pageSize, tab === 'wage' ? 'wage' : 'all')),
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
          operatorIds,
          role: user.role,
          page,
          pageSize,
          from: opts.from,
          to: opts.to,
          fundType: opts.fundType,
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
    /* 房主：统计「他给代理上/回收」；代理：统计「别人给他上/回收」 */
    const quotaRows = await this.prisma.adminLog.findMany({
      where:
        p.role === 'BRANCH'
          ? {
              operatorId: p.userId,
              action: { in: ['QUOTA_SELL', 'QUOTA_RECALL'] },
            }
          : {
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
      if (r.action === 'QUOTA_SELL') {
        if (p.role === 'BRANCH') quotaOut += amt;
        else quotaIn += amt;
      }
      if (r.action === 'QUOTA_RECALL') {
        if (p.role === 'BRANCH') quotaIn += amt;
        else quotaOut += amt;
      }
    }

    const fundWhere = this.fundLogWhere(p.userId, p.agentRootId, p.staffIds, p.staffIds, p.role);
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
    operatorIds: string[],
    role: string,
  ): Record<string, unknown> {
    if (role === 'BRANCH') {
      return {
        OR: [
          { action: { in: ['QUOTA_SELL', 'QUOTA_RECALL'] }, target: userId },
          { action: { in: ['QUOTA_SELL', 'QUOTA_RECALL'] }, operatorId: userId },
          { action: 'ROOM_CREDIT_LIMIT_BUMP', operatorId: userId },
        ],
      };
    }
    if (role === 'CS') {
      return {
        OR: [
          {
            action: { in: ['CONSOLE_CREDIT', 'CONSOLE_DEBIT'] },
            operatorId: userId,
          },
          {
            action: { in: ['CS_STAFF_ALLOC', 'CS_STAFF_RECALL'] },
            target: userId,
          },
        ],
      };
    }
    return {
      OR: [
        { action: { in: ['QUOTA_SELL', 'QUOTA_RECALL'] }, target: userId },
        {
          action: { in: ['CONSOLE_CREDIT', 'CONSOLE_DEBIT'] },
          OR: [
            { operatorId: { in: operatorIds.length ? operatorIds : staffIds } },
            { detail: { path: ['agentUserId'], equals: agentRootId } },
          ],
        },
        {
          action: { in: ['CS_STAFF_ALLOC', 'CS_STAFF_RECALL'] },
          operatorId: agentRootId,
        },
      ],
    };
  }

  private fundTypeActions(fundType?: string): string[] | null {
    const t = (fundType || 'all').trim().toLowerCase();
    if (!t || t === 'all') return null;
    const map: Record<string, string[]> = {
      quota: ['QUOTA_SELL', 'QUOTA_RECALL'],
      quota_in: ['QUOTA_SELL'],
      quota_out: ['QUOTA_RECALL'],
      player: ['CONSOLE_CREDIT', 'CONSOLE_DEBIT'],
      player_up: ['CONSOLE_CREDIT'],
      player_down: ['CONSOLE_DEBIT'],
      cs: ['CS_STAFF_ALLOC', 'CS_STAFF_RECALL'],
      cs_alloc: ['CS_STAFF_ALLOC'],
      cs_recall: ['CS_STAFF_RECALL'],
    };
    return map[t] ?? null;
  }

  private parseAuditDate(raw?: string, end = false): Date | null {
    if (!raw?.trim()) return null;
    const d = new Date(raw.trim());
    if (Number.isNaN(d.getTime())) {
      throw new BadRequestException(end ? '结束时间无效' : '开始时间无效');
    }
    return d;
  }

  private async listBalanceLedger(
    accountId: string | undefined,
    page: number,
    pageSize: number,
    filter: 'all' | 'wage' = 'all',
  ) {
    if (!accountId) return { total: 0, page, pageSize, list: [] as unknown[] };
    const where: Record<string, unknown> =
      filter === 'wage'
        ? {
            accountId,
            amount: { gt: 0 },
            OR: [
              { remark: { contains: '佣金' } },
              { idempotencyKey: { endsWith: ':WAGE' } },
              { idempotencyKey: { endsWith: ':WAGE_IN' } },
            ],
          }
        : { accountId };
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
        actionLabel: ledgerLabel(r.bizType, r.refType, r.remark),
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
    operatorIds: string[];
    role: string;
    page: number;
    pageSize: number;
    from?: string;
    to?: string;
    fundType?: string;
  }) {
    const base = this.fundLogWhere(
      p.userId,
      p.agentRootId,
      p.staffIds,
      p.operatorIds,
      p.role,
    );
    const and: Record<string, unknown>[] = [base];
    const from = this.parseAuditDate(p.from, false);
    const to = this.parseAuditDate(p.to, true);
    if (from || to) {
      and.push({
        createdAt: {
          ...(from ? { gte: from } : {}),
          ...(to ? { lt: to } : {}),
        },
      });
    }
    const typeActions = this.fundTypeActions(p.fundType);
    if (typeActions) and.push({ action: { in: typeActions } });
    const where = and.length === 1 ? and[0] : { AND: and };

    const [total, rows, sumRows] = await this.prisma.$transaction([
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
      this.prisma.adminLog.findMany({
        where,
        select: { action: true, detail: true },
      }),
    ]);

    const fundTotals = {
      count: total,
      quotaIn: 0,
      quotaOut: 0,
      playerUp: 0,
      playerDown: 0,
      csAlloc: 0,
      csRecall: 0,
    };
    for (const r of sumRows) {
      const amt = Number((r.detail as { amount?: number } | null)?.amount ?? 0);
      if (!Number.isFinite(amt) || amt === 0) continue;
      if (r.action === 'QUOTA_SELL') fundTotals.quotaIn += amt;
      else if (r.action === 'QUOTA_RECALL') fundTotals.quotaOut += amt;
      else if (r.action === 'CONSOLE_CREDIT') fundTotals.playerUp += amt;
      else if (r.action === 'CONSOLE_DEBIT') fundTotals.playerDown += amt;
      else if (r.action === 'CS_STAFF_ALLOC') fundTotals.csAlloc += amt;
      else if (r.action === 'CS_STAFF_RECALL') fundTotals.csRecall += amt;
    }
    fundTotals.quotaIn = round2(fundTotals.quotaIn);
    fundTotals.quotaOut = round2(fundTotals.quotaOut);
    fundTotals.playerUp = round2(fundTotals.playerUp);
    fundTotals.playerDown = round2(fundTotals.playerDown);
    fundTotals.csAlloc = round2(fundTotals.csAlloc);
    fundTotals.csRecall = round2(fundTotals.csRecall);

    return {
      total,
      page: p.page,
      pageSize: p.pageSize,
      fundTotals,
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
    const roomIds = new Set<string>();
    for (const r of rows) {
      userIds.add(r.operatorId);
      if (r.target) {
        if (r.action.startsWith('ROOM_') || r.action === 'ROOM_FUND') roomIds.add(r.target);
        else userIds.add(r.target);
      }
      const d = r.detail as { agentUserId?: string; ownerUserId?: string } | null;
      if (d?.agentUserId) userIds.add(d.agentUserId);
      if (d?.ownerUserId) userIds.add(d.ownerUserId);
    }
    const [users, rooms] = await Promise.all([
      userIds.size
        ? this.prisma.user.findMany({
            where: { id: { in: [...userIds] } },
            select: { id: true, nickname: true, username: true, role: true, uid: true },
          })
        : Promise.resolve([]),
      roomIds.size
        ? this.prisma.room.findMany({
            where: { id: { in: [...roomIds] } },
            select: { id: true, name: true, roomNo: true },
          })
        : Promise.resolve([]),
    ]);
    const umap = new Map(users.map((u) => [u.id, u]));
    const rmap = new Map(rooms.map((x) => [x.id, x]));

    return rows.map((r) => {
      const d = (r.detail || {}) as Record<string, unknown>;
      const amount = d.amount != null ? Number(d.amount) : null;
      const operator = umap.get(r.operatorId) ?? null;
      let counterparty: {
        id: string; nickname: string; username: string; role: string; uid: string
      } | null = r.target ? umap.get(r.target) ?? null : null;
      const room = r.target ? rmap.get(r.target) : undefined;
      if (!counterparty && room) {
        counterparty = {
          id: room.id,
          nickname: room.name,
          username: room.roomNo,
          role: 'ROOM',
          uid: room.roomNo,
        };
      }
      const orderNo =
        typeof d.orderNo === 'string' && d.orderNo
          ? d.orderNo
          : typeof d.clientRequestId === 'string' && d.clientRequestId
            ? d.clientRequestId
            : null;
      const method =
        typeof d.method === 'string' && d.method
          ? d.method
          : r.action === 'CONSOLE_CREDIT'
            ? '上分'
            : r.action === 'CONSOLE_DEBIT'
              ? '下分'
              : null;
      return {
        id: r.id,
        kind: 'ADMIN_LOG',
        action: r.action,
        actionLabel: adminActionLabel(r.action, d),
        amount,
        balanceAfter: null as number | null,
        remark: typeof d.remark === 'string' ? d.remark : null,
        orderNo,
        method,
        createdAt: r.createdAt,
        operator,
        counterparty,
        detail: {
          ...d,
          orderNo,
          method,
          roomNo: room?.roomNo ?? d.roomNo,
          roomName: room?.name,
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

  /** 仅代理本人可设值班（空=代理自己接） */
  async setCsDuty(actor: ConsoleActor, agentUserId: string, dutyUserId: string | null) {
    if (actor.role !== 'AGENT' || actor.id !== agentUserId) {
      throw new ForbiddenException('仅代理本人可调整值班');
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

  /** 停用/启用：子账号（管理员/房主）或房主（仅管理员） */
  async setProxyStatus(actor: ConsoleActor, proxyUserId: string, status: 'ACTIVE' | 'DISABLED') {
    const target = await this.prisma.user.findUnique({
      where: { id: proxyUserId },
      select: { id: true, role: true, parentId: true, status: true },
    });
    if (!target) throw new BadRequestException('账号不存在');

    if (target.role === 'BRANCH') {
      if (actor.role !== 'ADMIN') throw new ForbiddenException('仅管理员可停用/启用房主');
      if (target.status === status) return { id: target.id, status };
      const u = await this.prisma.user.update({
        where: { id: proxyUserId },
        data: {
          status,
          ...(status === 'DISABLED' ? { tokenVersion: { increment: 1 } } : {}),
        },
        select: { id: true, status: true },
      });
      await this.adminLog.log(actor.id, 'USER_STATUS', proxyUserId, { status, role: 'BRANCH' });
      return u;
    }

    if (target.role !== 'PROXY' || !target.parentId) {
      throw new BadRequestException('目标不是子账号或房主');
    }
    await this.assertCanHardManageProxy(actor, target.parentId);
    if (target.status === status) return { id: target.id, status };

    const u = await this.prisma.user.update({
      where: { id: proxyUserId },
      data: {
        status,
        ...(status === 'DISABLED' ? { tokenVersion: { increment: 1 } } : {}),
      },
      select: { id: true, status: true },
    });
    if (status === 'DISABLED') {
      const duty = await this.redis.get(csDutyKey(target.parentId));
      if (duty === proxyUserId) {
        await this.redis.del(csDutyKey(target.parentId));
        await this.adminLog.log(actor.id, 'CS_DUTY_CLEAR', target.parentId, { reason: 'proxy_disabled' });
      }
    }
    await this.adminLog.log(actor.id, 'USER_STATUS', proxyUserId, { status, role: 'PROXY' });
    return u;
  }

  /**
   * 重置玩家密码并解冻登录冻结。
   * 仅管理员 / 房主可操作（代理不可解冻）。
   */
  async resetPlayerPassword(actor: ConsoleActor, playerId: string, password?: string) {
    if (actor.role !== 'ADMIN' && actor.role !== 'BRANCH') {
      throw new ForbiddenException('仅房主或管理员可重置密码并解冻');
    }
    const player = await this.prisma.user.findUnique({
      where: { id: playerId },
      select: { id: true, role: true, username: true, status: true },
    });
    if (!player) throw new BadRequestException('账号不存在');
    if (player.role === 'ADMIN') {
      throw new ForbiddenException('不能重置管理员密码（忘记只能改数据库）');
    }
    if (player.role !== 'PLAYER') {
      throw new BadRequestException('只能重置玩家密码');
    }
    await this.scope.assertUserInScope(actor, playerId);

    const plainPassword = password?.trim() || genProxyPassword();
    const pwdErr = validatePassword(plainPassword);
    if (pwdErr) throw new BadRequestException(pwdErr);
    const passwordHash = await bcrypt.hash(plainPassword, PASSWORD_SALT_ROUNDS);
    await this.prisma.user.update({
      where: { id: playerId },
      data: {
        passwordHash,
        loginLockedAt: null,
        tokenVersion: { increment: 1 },
      },
    });
    await this.redis.del(`login:fail:user:${player.username.toLowerCase()}`);
    await this.adminLog.log(actor.id, 'PLAYER_RESET_PWD', playerId, {
      username: player.username,
      unlocked: true,
    });
    return {
      ok: true,
      username: player.username,
      password: plainPassword,
      message: '密码已重置并解冻，请立即告知玩家；旧登录态已失效',
    };
  }

  /** 重置密码：子账号（管理员/房主）或房主（仅管理员） */
  async resetProxyPassword(actor: ConsoleActor, proxyUserId: string, password?: string) {
    const target = await this.prisma.user.findUnique({
      where: { id: proxyUserId },
      select: { id: true, role: true, parentId: true, username: true },
    });
    if (!target) throw new BadRequestException('账号不存在');
    if (target.role === 'ADMIN') {
      throw new ForbiddenException('不能重置管理员密码（忘记只能改数据库）');
    }

    if (target.role === 'BRANCH') {
      if (actor.role !== 'ADMIN') throw new ForbiddenException('仅管理员可重置房主密码');
    } else if (target.role === 'PROXY' && target.parentId) {
      await this.assertCanHardManageProxy(actor, target.parentId);
    } else {
      throw new BadRequestException('目标不是子账号或房主');
    }

    const plainPassword = password?.trim() || genProxyPassword();
    const pwdErr = validateOpsPassword(plainPassword);
    if (pwdErr) throw new BadRequestException(pwdErr);
    const passwordHash = await bcrypt.hash(plainPassword, PASSWORD_SALT_ROUNDS);
    await this.prisma.user.update({
      where: { id: proxyUserId },
      data: { passwordHash, tokenVersion: { increment: 1 } },
    });
    await this.adminLog.log(actor.id, 'ROOM_AGENT_RESET_PWD', proxyUserId, {
      username: target.username,
      kind: target.role,
    });
    return {
      ok: true,
      username: target.username,
      password: plainPassword,
      message: '密码已重置，请立即告知；旧登录态已失效',
    };
  }

  /** 改子账号显示名：管理员/房主/所属主代理 */
  async renameProxyNickname(actor: ConsoleActor, proxyUserId: string, nickname: string) {
    const name = nickname.trim();
    if (!name) throw new BadRequestException('名字不能为空');
    if (name.length > 20) throw new BadRequestException('名字最多 20 字');

    const proxy = await this.prisma.user.findUnique({
      where: { id: proxyUserId },
      select: { id: true, role: true, parentId: true, nickname: true },
    });
    if (!proxy || proxy.role !== 'PROXY' || !proxy.parentId) {
      throw new BadRequestException('目标不是子账号');
    }
    await this.assertCanManageAgentStaff(actor, proxy.parentId);

    if (proxy.nickname === name) return { id: proxy.id, nickname: name };
    const u = await this.prisma.user.update({
      where: { id: proxyUserId },
      data: { nickname: name },
      select: { id: true, nickname: true },
    });
    await this.adminLog.log(actor.id, 'USER_NICKNAME', proxyUserId, {
      role: 'PROXY',
      from: proxy.nickname,
      to: name,
    });
    return u;
  }

  /** 值班/改名：管理员、房主（管辖内）、或该代理本人 */
  private async assertCanManageAgentStaff(actor: ConsoleActor, agentUserId: string) {
    if (actor.role === 'ADMIN') return;
    if (actor.role === 'AGENT' && actor.id === agentUserId) return;
    if (actor.role === 'BRANCH') {
      await this.scope.assertUserInScope(actor, agentUserId);
      return;
    }
    throw new ForbiddenException('无权管理该代理的子账号');
  }

  /** 重置密码/停用：仅管理员、房主（代理本人不可） */
  private async assertCanHardManageProxy(actor: ConsoleActor, agentUserId: string) {
    if (actor.role === 'ADMIN') return;
    if (actor.role === 'BRANCH') {
      await this.scope.assertUserInScope(actor, agentUserId);
      return;
    }
    throw new ForbiddenException('代理不能重置密码或停用子账号，请联系管理或总监');
  }

  private rolePermissions(role: string) {
    if (role === 'BRANCH') {
      return {
        label: '总监',
        summary: '与管理共用平台池、不吃流水；看报表；和股东怎么分平台利润私下协商',
        can: ['全部房间', '代理/客服', '额度', '报表'],
        cannot: ['游戏赔率', '控奖'],
      };
    }
    if (role === 'GENERAL') {
      return {
        label: '总代',
        summary: '发展房间；拿名下全部房间流水差与占成差。自己做房需另开代理号',
        can: ['名下房间', '开代理房', '整房飞盘', '报表'],
        cannot: ['改赔率', '改已建账号的流水/占成'],
      };
    }
    if (role === 'AGENT') {
      return {
        label: '代理',
        summary: '房间绑定账号；子账号由管理/总监开通',
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

  /** 创建总监 / 总代 / 子账号。代理号只在创建房间时生成 */
  async createAgent(
    actor: ConsoleActor,
    body: {
      username: string;
      password: string;
      nickname?: string;
      role?: 'BRANCH' | 'AGENT' | 'PROXY' | 'GENERAL';
      parentAgentUserId?: string;
      flowRate?: number;
      shareRate?: number;
      /** 总代与平台的结算方式 CASH | CREDIT */
      bookMode?: string;
      /** 总代信用盘合同额度 */
      creditLimit?: number;
      /** 总代与平台的结算周期 */
      settleCycle?: string;
    },
  ) {
    const role = body.role ?? 'PROXY';
    if ((role as string) === 'ADMIN') {
      throw new BadRequestException('不能创建管理员；全站有且仅有一名管理员');
    }
    if (role === 'AGENT') {
      throw new BadRequestException('代理账号请在「房间中心」创建房间时生成，不可在此单独添加');
    }
    if (actor.role === 'AGENT' || actor.role === 'PROXY') {
      throw new BadRequestException('代理/子账号不能在此开号');
    }
    /* 总代只能给自己开助手，帮他管名下房间与额度；不能开总代、总监 */
    if (actor.role === 'GENERAL' && role !== 'PROXY') {
      throw new BadRequestException('总代只能开自己的子账号');
    }
    if (actor.role === 'BRANCH' && role !== 'PROXY' && role !== 'GENERAL') {
      throw new BadRequestException('总监只能开总代或给代理开子账号');
    }
    if (actor.role !== 'ADMIN' && role === 'BRANCH') {
      throw new BadRequestException('仅管理可创建总监');
    }

    const username = body.username.toLowerCase().trim();
    if (!/^[a-z0-9]{8,20}$/.test(username)) {
      throw new BadRequestException('用户名须 8-20 位小写字母数字');
    }
    const newAccountPwdErr = validateOpsPassword(body.password || '');
    if (newAccountPwdErr) throw new BadRequestException(newAccountPwdErr);
    if (await this.prisma.user.findUnique({ where: { username } })) {
      throwUsernameTaken();
    }

    const policy = await this.prisma.rebatePolicy.findUnique({ where: { id: 1 } });
    const generalMax = Number(policy?.generalMaxRate ?? 0.1);
    const generalDef = Number(policy?.generalDefaultRate ?? 0.07);
    let flowRate = generalDef;
    let shareRate = 0.5;
    let bookMode = 'CASH';
    let creditLimit = 0;
    let settleCycle = 'WEEKLY_MON';
    if (role === 'GENERAL') {
      flowRate = Number(body.flowRate);
      if (!Number.isFinite(flowRate)) flowRate = generalDef;
      if (flowRate > 1) flowRate = flowRate / 100;
      if (flowRate < 0.018 || flowRate > generalMax + 1e-9) {
        throw new BadRequestException(`总代流水整包须在 1.8%～${(generalMax * 100).toFixed(0)}%`);
      }
      shareRate = Number(body.shareRate);
      if (!Number.isFinite(shareRate)) shareRate = 0.5;
      if (shareRate > 1) shareRate = shareRate / 100;
      if (shareRate < 0 || shareRate > 0.7 + 1e-9) {
        throw new BadRequestException('总代占成须在 0%～70%');
      }
      bookMode = body.bookMode === 'CREDIT' ? 'CREDIT' : 'CASH';
      settleCycle = normalizeSettleCycle(body.settleCycle);
      if (bookMode === 'CREDIT') {
        creditLimit = Math.max(0, Math.floor(Number(body.creditLimit ?? 0) || 0));
        if (creditLimit <= 0) {
          throw new BadRequestException('信用盘总代须设置合同额度（大于 0）');
        }
      }
    }

    let parentId: string | null = actor.id;
    let parent = await this.prisma.user.findUnique({ where: { id: actor.id } });
    if (!parent) throw new BadRequestException();

    if (role === 'BRANCH') {
      parentId = null;
    } else if (role === 'GENERAL') {
      parentId = actor.id;
    } else if (role === 'PROXY') {
      /* 总代开的子账号直接挂自己名下，范围跟着总代走 */
      if (actor.role === 'GENERAL') {
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

    const passwordHash = await bcrypt.hash(body.password, PASSWORD_SALT_ROUNDS);
    const uid = await this.allocUid();
    const nickname = body.nickname?.trim()
      || (role === 'PROXY' ? `代理${uid.slice(-4)}` : role === 'GENERAL' ? `总代${uid.slice(-4)}` : `总监${uid.slice(-4)}`);

    let user;
    try {
      user = await this.prisma.$transaction(async (tx) => {
        const avatar = await pickAvatarUniqueInTx(tx);
        const created = await tx.user.create({
          data: {
            username,
            passwordHash,
            uid,
            nickname,
            avatar,
            role,
            parentId,
            agentPath: parentId && parent
              ? `${parent.agentPath}${parent.id}/`
              : '/',
            depth: parentId && parent ? parent.depth + 1 : 0,
          },
        });
        await tx.agent.create({
          data: {
            userId: created.id,
            ...(role === 'GENERAL'
              ? {
                  flowRate,
                  shareRate,
                  rebateRate: 0.018,
                  bookMode,
                  creditLimit,
                  settleCycle,
                }
              : {}),
          },
        });
        /* 信用盘总代：合同额度即刻计入可用盘分，结算时再校准回这个值 */
        if (role === 'GENERAL' && bookMode === 'CREDIT' && creditLimit > 0) {
          await writeAgentQuotaInTx(tx, {
            agentUserId: created.id,
            bookMode: 'CREDIT',
            delta: creditLimit,
            bizType: 'OPEN',
            remark: `建号期初信用额度 ${creditLimit}`,
            refType: 'general_open',
            refId: created.id,
            idempotencyKey: `general_open:${created.id}`,
          });
        }
        await tx.pointsAccount.create({
          data: {
            ownerType: role === 'BRANCH' ? 'BRANCH' : role === 'PROXY' ? 'PROXY' : 'AGENT',
            ownerId: created.id,
          },
        });
        return created;
      });
    } catch (e: unknown) {
      rethrowUserUniqueConflict(e);
    }

    await this.adminLog.log(actor.id, 'AGENT_CREATE', user.id, {
      role, username, parentId, flowRate, shareRate,
      ...(role === 'GENERAL' ? { bookMode, creditLimit, settleCycle } : {}),
    });
    return {
      id: user.id,
      uid: user.uid,
      username: user.username,
      nickname: user.nickname,
      role: user.role,
      parentId,
      flowRate: role === 'GENERAL' ? flowRate : undefined,
      shareRate: role === 'GENERAL' ? shareRate : undefined,
      bookMode: role === 'GENERAL' ? bookMode : undefined,
      creditLimit: role === 'GENERAL' ? creditLimit : undefined,
      settleCycle: role === 'GENERAL' ? settleCycle : undefined,
      password: body.password,
    };
  }

  /**
   * 调整总代与平台的合同信用额度：合同与剩余信用同增同减。
   * 结算把额度校准回合同值，所以两者必须一起动，否则下期结算会凭空多出或吃掉一笔。
   */
  async bumpGeneralCreditLimit(
    actor: ConsoleActor,
    generalUserId: string,
    amountRaw: number,
    direction: 'up' | 'down',
    remark?: string,
  ) {
    if (actor.role !== 'ADMIN' && actor.role !== 'BRANCH') {
      throw new ForbiddenException('仅管理或总监可调整总代信用额度');
    }
    const amount = Math.floor(Number(amountRaw) || 0);
    if (!(amount > 0)) throw new BadRequestException('金额须大于 0');

    const target = await this.prisma.user.findUnique({
      where: { id: generalUserId },
      select: { id: true, role: true, nickname: true, agent: { select: { bookMode: true } } },
    });
    if (!target || target.role !== 'GENERAL') {
      throw new BadRequestException('总代账号无效');
    }
    if (target.agent?.bookMode !== 'CREDIT') {
      throw new BadRequestException('现金盘总代请用「上分 / 下分」增减额度');
    }

    const delta = direction === 'down' ? -amount : amount;

    const result = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "Agent" WHERE "userId" = ${generalUserId} FOR UPDATE`;
      const locked = await tx.agent.findUnique({
        where: { userId: generalUserId },
        select: { creditLimit: true, pointsQuota: true },
      });
      if (!locked) throw new BadRequestException('总代账户不存在');

      const before = asMoney(locked.creditLimit);
      const quotaBefore = asMoney(locked.pointsQuota);
      const after = Math.round((before + delta) * 100) / 100;
      const quotaAfter = Math.round((quotaBefore + delta) * 100) / 100;

      if (direction === 'down') {
        if (quotaBefore + 1e-9 < amount) {
          throw new BadRequestException(
            `剩余信用不足，最多可减 ${Math.max(0, quotaBefore)}（已发给代理的不能从这里扣）`,
          );
        }
        if (after <= 0) throw new BadRequestException('合同额度须大于 0');
      }

      await tx.agent.update({
        where: { userId: generalUserId },
        data: { creditLimit: after },
      });
      /* 无前端订单号，随机键只为占住流水唯一约束 */
      await writeAgentQuotaInTx(tx, {
        agentUserId: generalUserId,
        bookMode: 'CREDIT',
        quotaTo: quotaAfter,
        bizType: 'ADJUST',
        remark: `总代合同额度 ${before}→${after}${remark?.trim() ? `｜${remark.trim()}` : ''}`,
        refType: 'general_credit_limit',
        refId: generalUserId,
        idempotencyKey: `general_credit_bump:${generalUserId}:${randomUUID()}`,
      });
      return { before, after, quotaBefore, quotaAfter };
    });

    await this.adminLog.log(actor.id, 'GENERAL_CREDIT_LIMIT_BUMP', generalUserId, {
      ...result,
      amount,
      direction,
      remark: remark?.trim() || null,
    });

    const sign = direction === 'down' ? '-' : '+';
    return {
      ok: true,
      creditLimitBefore: result.before,
      creditLimit: result.after,
      pointsQuotaBefore: result.quotaBefore,
      pointsQuota: result.quotaAfter,
      message: `合同与剩余信用各 ${sign}${amount}：合同 ${result.before}→${result.after}，剩余 ${result.quotaBefore}→${result.quotaAfter}`,
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

function ledgerLabel(bizType: string, refType?: string | null, remark?: string | null) {
  const rm = String(remark || '');
  if (rm.includes('上分佣金') || /客服上分佣金/.test(rm)) return '上分佣金';
  if (rm.includes('下分佣金') || /客服下分佣金/.test(rm)) return '下分佣金';
  if (rm.includes('佣金')) return '佣金入账';
  if (refType === 'console_quota') return bizType === 'TRANSFER_IN' ? '收到额度' : '下发额度';
  if (refType === 'console_quota_recall') {
    return bizType === 'TRANSFER_OUT' ? '被回收额度' : '回收额度入账';
  }
  if (refType === 'console_credit' || refType === 'console_credit_real' || refType === 'console_credit_cs') {
    return bizType === 'TRANSFER_OUT' ? '给玩家上分' : '玩家上分入账';
  }
  if (refType === 'console_debit' || refType === 'console_debit_cs') {
    return bizType === 'TRANSFER_IN' ? '玩家下分回收' : '玩家下分扣款';
  }
  if (refType === 'cs_alloc') return bizType === 'TRANSFER_IN' ? '代理划入额度' : '划给客服';
  if (refType === 'cs_recall') return bizType === 'TRANSFER_OUT' ? '代理收回额度' : '收回客服额度';
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
    const from = detail.fromRole === 'BRANCH' ? '房主' : detail.fromRole === 'ADMIN' ? '管理员' : '上级';
    return `${from}下发额度`;
  }
  if (action === 'QUOTA_RECALL') {
    const by = detail.operatorRole === 'BRANCH' ? '房主' : detail.operatorRole === 'ADMIN' ? '管理员' : '上级';
    return `${by}回收额度`;
  }
  if (action === 'CONSOLE_CREDIT') {
    return detail.byCs ? '客服给玩家上分' : detail.byProxy ? '子账号给玩家上分' : '给玩家上分';
  }
  if (action === 'CONSOLE_DEBIT') {
    return detail.byCs ? '客服给玩家下分' : detail.byProxy ? '子账号给玩家下分' : '给玩家下分';
  }
  if (action === 'CS_STAFF_ALLOC') return '划额度给客服';
  if (action === 'CS_STAFF_RECALL') return '收回客服额度';
  const map: Record<string, string> = {
    AGENT_CREATE: '开通账号',
    CS_DUTY_SET: '设置值班',
    CS_DUTY_CLEAR: '清除值班',
    ROOM_FUND: '房间盘口注资(已废弃)',
    ROOM_CREATE: '创建房间',
    ROOM_SOFT_DELETE: '关闭房间',
    ROOM_DELETE: '删除房间',
    ROOM_STATUS: '变更房间状态',
    ROOM_BILLING_UPDATE: '修改月费',
    ROOM_ROTATE_CODE: '轮换进房码',
    ROOM_AGENT_RESET_PWD: '重置代理密码',
    ROOM_GRANT_OWNER: '授权房主可见',
    ROOM_REVOKE_OWNER: '取消房主可见',
    ROOM_GAME_CONFIG: '修改房间游戏配置',
    RISK_EVENT_HANDLE: '处理风控告警',
    RISK_EVENT_BATCH_HANDLE: '批量处理风控',
  };
  return map[action] || action;
}
