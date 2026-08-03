/**
 * 控制台数据隔离：
 *   ADMIN   全部房间
 *   BRANCH  仅 RoomOwnerGrant 授权可见的房间（创建/授权时勾选）
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
    if (role === 'AGENT') return 'AGENT';
    return 'PLAYER';
  }

  walletOwnerId(actor: ConsoleActor): string {
    if (actor.role === 'ADMIN') return 'PLATFORM';
    return actor.id;
  }

  /**
   * 业务归属根用户：PROXY → 上级 AGENT；其余为自己。
   * 用于房间归属、玩家树、真分库存扣减。
   */
  async scopeRootUserId(actor: ConsoleActor): Promise<string> {
    if (actor.role !== 'PROXY') return actor.id;
    const me = await this.prisma.user.findUnique({
      where: { id: actor.id },
      select: { parentId: true },
    });
    if (!me?.parentId) throw new ForbiddenException('代分未绑定上级代理');
    const parent = await this.prisma.user.findUnique({
      where: { id: me.parentId },
      select: { id: true, role: true },
    });
    if (!parent || parent.role !== 'AGENT') {
      throw new ForbiddenException('代分须挂在代理账号下');
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
    if (actor.role === 'AGENT' || actor.role === 'PROXY') {
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

  async assertUserInScope(actor: ConsoleActor, targetUserId: string) {
    if (actor.role === 'ADMIN') return;
    if (targetUserId === actor.id) return;

    const target = await this.prisma.user.findUnique({
      where: { id: targetUserId },
      select: { id: true, agentPath: true, parentId: true, role: true },
    });
    if (!target) throw new NotFoundException('用户不存在');

    /* 房主：仅授权房间内的代理/玩家/子账号 */
    if (actor.role === 'BRANCH') {
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

    /* 代理/代分：玩家在管辖房间内即可 */
    if (
      (actor.role === 'AGENT' || actor.role === 'PROXY') &&
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

  /** 玩家过滤 */
  async playerWhere(actor: ConsoleActor): Promise<Record<string, unknown>> {
    if (actor.role === 'ADMIN') return { role: 'PLAYER' };

    /* 房主 / 代理 / 客服：仅管辖房间内的在房玩家 */
    if (actor.role === 'BRANCH' || actor.role === 'AGENT' || actor.role === 'PROXY') {
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
    return actor.role === 'ADMIN' || actor.role === 'BRANCH';
  }
}
