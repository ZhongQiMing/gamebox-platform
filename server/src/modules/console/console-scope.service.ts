/**
 * 控制台数据隔离：
 *   ADMIN   全部房间
 *   BRANCH  仅 RoomOwnerGrant 授权可见的房间（创建/授权时勾选）
 *   GENERAL 仅挂在自己名下的房间（Room.generalAgentId）
 *   AGENT   仅绑定为自己主账号的房间
 *   PROXY   与上级代理同范围；写操作另行收紧
 */
import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import type { OwnerType } from '../points/points.service';

export type ConsoleActor = {
  id: string;
  role: string;
  uid?: string;
};

@Injectable()
export class ConsoleScopeService {
  constructor(private prisma: PrismaService) {}

  ownerTypeOf(role: string): OwnerType {
    if (role === 'ADMIN') return 'PLATFORM';
    if (role === 'BRANCH') return 'BRANCH';
    if (role === 'PROXY') return 'PROXY';
    if (role === 'CS') return 'CS';
    if (role === 'AGENT' || role === 'GENERAL') return 'AGENT';
    return 'PLAYER';
  }

  walletOwnerId(actor: ConsoleActor): string {
    if (actor.role === 'ADMIN') return 'PLATFORM';
    return actor.id;
  }

  /**
   * 业务归属根用户：PROXY/CS → 上级 AGENT；其余为自己。
   */
  async scopeRootUserId(actor: ConsoleActor): Promise<string> {
    if (actor.role !== 'PROXY' && actor.role !== 'CS') return actor.id;
    const me = await this.prisma.user.findUnique({
      where: { id: actor.id },
      select: { parentId: true },
    });
    if (!me?.parentId) throw new ForbiddenException('未绑定上级代理');
    const parent = await this.prisma.user.findUnique({
      where: { id: me.parentId },
      select: { id: true, role: true },
    });
    if (!parent || parent.role !== 'AGENT') {
      throw new ForbiddenException('须挂在代理账号下');
    }
    return parent.id;
  }

  async grantedRoomIds(actor: ConsoleActor): Promise<string[] | null> {
    /* null = 全部房间（仅超管） */
    if (actor.role === 'ADMIN') return null;
    if (actor.role === 'BRANCH') {
      const grants = await this.prisma.roomOwnerGrant.findMany({
        where: { ownerId: actor.id },
        select: { roomId: true },
      });
      return grants.map((g) => g.roomId);
    }
    if (actor.role === 'GENERAL') {
      const agent = await this.prisma.agent.findUnique({
        where: { userId: actor.id },
        select: { id: true },
      });
      if (!agent) return [];
      const rooms = await this.prisma.room.findMany({
        where: { generalAgentId: agent.id },
        select: { id: true },
      });
      return rooms.map((r) => r.id);
    }
    if (actor.role === 'AGENT' || actor.role === 'PROXY' || actor.role === 'CS') {
      const rootUserId = await this.scopeRootUserId(actor);
      const agent = await this.prisma.agent.findUnique({
        where: { userId: rootUserId },
        select: { id: true },
      });
      if (!agent) return [];
      const rooms = await this.prisma.room.findMany({
        where: { ownerAgentId: agent.id },
        select: { id: true },
      });
      return rooms.map((r) => r.id);
    }
    return [];
  }

  async assertRoomAccess(actor: ConsoleActor, roomId: string) {
    const ids = await this.grantedRoomIds(actor);
    if (ids === null) return;
    if (!ids.includes(roomId)) throw new ForbiddenException('无权访问该房间');
  }

  /**
   * 房主 / 总代可见用户集合：本人 + 管辖房间内的代理/子账号/在房玩家。
   * 用于风控、操作日志等「按目标人隔离」的查询。
   */
  async scopedUserIds(actor: ConsoleActor): Promise<string[] | null> {
    if (actor.role === 'ADMIN') return null;
    if (actor.role !== 'BRANCH' && actor.role !== 'GENERAL') {
      /* 代理侧不走此聚合，调用方应自行处理 */
      return [actor.id];
    }
    const roomIds = await this.grantedRoomIds(actor);
    if (!roomIds?.length) return [actor.id];

    const [rooms, members] = await Promise.all([
      this.prisma.room.findMany({
        where: { id: { in: roomIds } },
        select: {
          ownerAgent: {
            select: {
              userId: true,
              user: {
                select: {
                  id: true,
                  children: {
                    where: { role: { in: ['PROXY', 'CS'] } },
                    select: { id: true },
                  },
                },
              },
            },
          },
        },
      }),
      this.prisma.roomMember.findMany({
        where: { roomId: { in: roomIds }, status: 'APPROVED' },
        select: { playerId: true },
      }),
    ]);

    const ids = new Set<string>([actor.id]);
    for (const r of rooms) {
      const agentUser = r.ownerAgent?.user;
      if (!agentUser) continue;
      ids.add(agentUser.id);
      for (const c of agentUser.children || []) ids.add(c.id);
    }
    for (const m of members) ids.add(m.playerId);
    return [...ids];
  }

  /** 房主授权房间 ID；无授权返回空数组（与 ADMIN 的 null=全量区分） */
  async branchRoomIds(actor: ConsoleActor): Promise<string[]> {
    if (actor.role !== 'BRANCH') return [];
    return (await this.grantedRoomIds(actor)) ?? [];
  }

  async assertUserInScope(actor: ConsoleActor, targetUserId: string) {
    if (actor.role === 'ADMIN') return;
    if (targetUserId === actor.id) return;

    const target = await this.prisma.user.findUnique({
      where: { id: targetUserId },
      select: { id: true, agentPath: true, parentId: true, role: true },
    });
    if (!target) throw new NotFoundException('用户不存在');

    /* 总监：总代全平台可见；代理/玩家仍按授权房间 */
    if (actor.role === 'BRANCH') {
      if (target.role === 'GENERAL') return;
      const roomIds = await this.grantedRoomIds(actor);
      if (!roomIds?.length) throw new ForbiddenException('目标用户不在管辖范围');
      if (target.role === 'PLAYER') {
        const hit = await this.prisma.roomMember.findFirst({
          where: {
            playerId: targetUserId,
            status: 'APPROVED',
            roomId: { in: roomIds },
          },
          select: { id: true },
        });
        if (!hit) throw new ForbiddenException('目标用户不在管辖范围');
        return;
      }
      if (target.role === 'AGENT' || target.role === 'PROXY') {
        const agentUserId = target.role === 'PROXY'
          ? (target.parentId || targetUserId)
          : targetUserId;
        const agent = await this.prisma.agent.findUnique({
          where: { userId: agentUserId },
          select: { id: true },
        });
        if (!agent) throw new ForbiddenException('目标用户不在管辖范围');
        const hit = await this.prisma.room.findFirst({
          where: { ownerAgentId: agent.id, id: { in: roomIds } },
          select: { id: true },
        });
        if (!hit) throw new ForbiddenException('目标用户不在管辖范围');
        return;
      }
      throw new ForbiddenException('目标用户不在管辖范围');
    }

    /*
     * 总代：只认挂在自己名下的房间。
     * 不能退回 agentPath 树判断——代理是建房时挂到总代下的，房间若改挂他人，
     * 树还留着旧关系，会让总代继续看到已经不归他的玩家。
     */
    if (actor.role === 'GENERAL') {
      const roomIds = await this.grantedRoomIds(actor);
      if (!roomIds?.length) throw new ForbiddenException('目标用户不在管辖范围');
      const ok = await this.targetInRooms(roomIds, target);
      if (!ok) throw new ForbiddenException('目标用户不在管辖范围');
      return;
    }

    /* 代理/代分：玩家在管辖房间内即可；客服只能操作系统派给自己的玩家 */
    if (
      (actor.role === 'AGENT' || actor.role === 'PROXY' || actor.role === 'CS') &&
      target.role === 'PLAYER'
    ) {
      const roomIds = await this.grantedRoomIds(actor);
      if (!roomIds?.length) throw new ForbiddenException('目标用户不在管辖范围');
      const hit = await this.prisma.roomMember.findFirst({
        where: {
          playerId: targetUserId,
          status: 'APPROVED',
          roomId: { in: roomIds },
        },
        select: { id: true },
      });
      if (!hit) throw new ForbiddenException('目标用户不在管辖范围');
      if (actor.role === 'CS') {
        const assignee = await this.currentCsAssignee(targetUserId);
        if (assignee !== actor.id) {
          throw new ForbiddenException('该玩家未分配给你，无法操作');
        }
      }
      return;
    }

    const rootId = await this.scopeRootUserId(actor);
    const root = await this.prisma.user.findUnique({
      where: { id: rootId },
      select: { agentPath: true },
    });
    if (!root) throw new ForbiddenException();
    const prefix = `${root.agentPath}${rootId}/`;
    const inTree =
      target.id === actor.id ||
      target.id === rootId ||
      target.parentId === rootId ||
      target.parentId === actor.id ||
      target.agentPath.startsWith(prefix);
    if (!inTree) throw new ForbiddenException('目标用户不在管辖范围');
  }

  /** 目标用户是否落在这批房间里：玩家看在房记录，代理/子账号/客服看房间绑定的主代理 */
  private async targetInRooms(
    roomIds: string[],
    target: { id: string; role: string; parentId: string | null },
  ): Promise<boolean> {
    if (target.role === 'PLAYER') {
      const hit = await this.prisma.roomMember.findFirst({
        where: { playerId: target.id, status: 'APPROVED', roomId: { in: roomIds } },
        select: { id: true },
      });
      return !!hit;
    }
    if (target.role === 'AGENT' || target.role === 'PROXY' || target.role === 'CS') {
      const agentUserId = target.role === 'AGENT' ? target.id : (target.parentId || target.id);
      const agent = await this.prisma.agent.findUnique({
        where: { userId: agentUserId },
        select: { id: true },
      });
      if (!agent) return false;
      const hit = await this.prisma.room.findFirst({
        where: { ownerAgentId: agent.id, id: { in: roomIds } },
        select: { id: true },
      });
      return !!hit;
    }
    return false;
  }

  /** 客服粘性指派人（与会话派单口径一致） */
  async currentCsAssignee(playerId: string): Promise<string | null> {
    const last = await this.prisma.csMessage.findFirst({
      where: { playerId, assigneeId: { not: null } },
      orderBy: { createdAt: 'desc' },
      select: { assigneeId: true },
    });
    return last?.assigneeId ?? null;
  }

  /** 当前派给该客服的玩家 ID */
  async assignedPlayerIdsForCs(csUserId: string): Promise<string[]> {
    const recent = await this.prisma.csMessage.findMany({
      where: { assigneeId: csUserId },
      distinct: ['playerId'],
      select: { playerId: true },
      orderBy: { createdAt: 'desc' },
      take: 500,
    });
    const ids: string[] = [];
    for (const row of recent) {
      const sticky = await this.currentCsAssignee(row.playerId);
      if (sticky === csUserId) ids.push(row.playerId);
    }
    return ids;
  }

  /** 玩家过滤 */
  async playerWhere(actor: ConsoleActor): Promise<Record<string, unknown>> {
    if (actor.role === 'ADMIN') return { role: 'PLAYER' };

    /* 客服：不能浏览全部玩家，仅系统派给自己的 */
    if (actor.role === 'CS') {
      const ids = await this.assignedPlayerIdsForCs(actor.id);
      return { role: 'PLAYER', id: { in: ids.length ? ids : ['__none__'] } };
    }

    /* 房主 / 总代 / 代理 / 代分：仅管辖房间内的在房玩家 */
    if (
      actor.role === 'BRANCH' ||
      actor.role === 'GENERAL' ||
      actor.role === 'AGENT' ||
      actor.role === 'PROXY'
    ) {
      const roomIds = await this.grantedRoomIds(actor);
      if (roomIds && roomIds.length) {
        const members = await this.prisma.roomMember.findMany({
          where: { roomId: { in: roomIds }, status: 'APPROVED' },
          select: { playerId: true },
        });
        const ids = [...new Set(members.map((m) => m.playerId))];
        return { role: 'PLAYER', id: { in: ids.length ? ids : ['__none__'] } };
      }
      return { role: 'PLAYER', id: { in: ['__none__'] } };
    }

    const rootId = await this.scopeRootUserId(actor);
    const root = await this.prisma.user.findUnique({
      where: { id: rootId },
      select: { agentPath: true },
    });
    const prefix = `${root?.agentPath ?? '/'}${rootId}/`;
    return {
      role: 'PLAYER',
      OR: [
        { parentId: rootId },
        { agentPath: { startsWith: prefix } },
      ],
    };
  }

  canManageGamesGlobal(actor: ConsoleActor) {
    return actor.role === 'ADMIN';
  }

  canManageControl(actor: ConsoleActor) {
    return actor.role === 'ADMIN';
  }

  canCreateRoom(actor: ConsoleActor) {
    return actor.role === 'ADMIN' || actor.role === 'BRANCH' || actor.role === 'GENERAL';
  }
}
