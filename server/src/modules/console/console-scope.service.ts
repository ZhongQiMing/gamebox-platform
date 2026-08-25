/**
 * 控制台数据隔离：
 *   ADMIN   全部房间
 *   BRANCH  见下方「总监的可见性」
 *   GENERAL 仅挂在自己名下的房间（Room.generalAgentId）
 *   AGENT   仅绑定为自己主账号的房间
 *   PROXY   挂代理=该房只读收紧；挂总代=总代分身，与总代同范围同权
 *
 * ── 总监的可见性：按房的挂靠情况二选一，不是两道叠加的闸门 ──
 *
 *   挂了总代的房 → 只看**总代级**授权（GeneralOwnerGrant）
 *   直挂房       → 只看**房间级**授权（RoomOwnerGrant）
 *
 * 也就是说：总代对某个总监可见，他名下**所有**房间就都可见，不能再单独关掉某一间；
 * 总代不可见，则他本人、名下房间、代理、玩家、报表、结算、开奖全部隐藏。
 * 这两件事是同一个开关，位置在总代详情页。
 *
 * 为什么不做成「两个都要过」：那会造出一种自相矛盾的状态——总监在名单里看得见
 * 这个总代，却一间房都打不开，看着就像系统坏了；而且同一件事要维护两份名单，
 * 两边一旦不同步就再也说不清谁该看见什么。挂总代的房本来就必须整体可见或整体
 * 不可见（总监是按总代账期结账的，只放开一半房间，他拉出来的总表就少了另一半的
 * 流水和月费，照着结必然算错），所以房间级那份对这类房没有存在的意义。
 *
 * 房间级授权因此只对直挂房有效；挂总代的房不写、不读、也不允许设置
 * （见 console-rooms 的 grantOwner / revokeOwner）。
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

  /** 旧房从未写过授权时补全总监可见，只跑一次 */
  private directorGrantBackfill: Promise<void> | null = null;

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
   * 业务归属根用户：PROXY/CS → 上级；其余为自己。
   * 子账号可以挂在代理下（管这一间房），也可以挂在总代下（管名下所有房）。
   */
  async scopeRootUserId(actor: ConsoleActor): Promise<string> {
    return (await this.scopeRoot(actor)).id;
  }

  private async scopeRoot(actor: ConsoleActor): Promise<{ id: string; role: string }> {
    if (actor.role !== 'PROXY' && actor.role !== 'CS') {
      return { id: actor.id, role: actor.role };
    }
    const me = await this.prisma.user.findUnique({
      where: { id: actor.id },
      select: { parentId: true },
    });
    if (!me?.parentId) throw new ForbiddenException('未绑定上级');
    const parent = await this.prisma.user.findUnique({
      where: { id: me.parentId },
      select: { id: true, role: true },
    });
    if (!parent || (parent.role !== 'AGENT' && parent.role !== 'GENERAL')) {
      throw new ForbiddenException('须挂在代理或总代账号下');
    }
    return { id: parent.id, role: parent.role };
  }

  /** 总代本人，或挂在总代下的子账号（分身） */
  async isGeneralSide(actor: ConsoleActor): Promise<boolean> {
    if (actor.role === 'GENERAL') return true;
    if (actor.role !== 'PROXY') return false;
    const root = await this.scopeRoot(actor);
    return root.role === 'GENERAL';
  }

  /** 总代分身操作时落到总代主号；非总代侧抛错 */
  async generalRootId(actor: ConsoleActor): Promise<string> {
    if (actor.role === 'GENERAL') return actor.id;
    if (actor.role === 'PROXY') {
      const root = await this.scopeRoot(actor);
      if (root.role === 'GENERAL') return root.id;
    }
    throw new ForbiddenException('仅总代可操作');
  }

  /**
   * 该总监被授权可见的总代 Agent.id；null = 不受总代级限制（仅超管）。
   *
   * 非总监角色也返回 null：总代/代理看到的本来就只有自己那一支，
   * 再套一层总代级过滤没有意义，只会把他自己的数据也筛掉。
   */
  async grantedGeneralAgentIds(actor: ConsoleActor): Promise<string[] | null> {
    if (actor.role !== 'BRANCH') return null;
    const grants = await this.prisma.generalOwnerGrant.findMany({
      where: { ownerId: actor.id },
      select: { generalAgentId: true },
    });
    return grants.map((g) => g.generalAgentId);
  }

  async grantedRoomIds(actor: ConsoleActor): Promise<string[] | null> {
    /* null = 全部房间（仅超管） */
    if (actor.role === 'ADMIN') return null;
    if (actor.role === 'BRANCH') {
      await this.ensureLegacyDirectorGrants();
      const generalIds = await this.grantedGeneralAgentIds(actor);
      /*
       * 两类房各按各自那一份名单，互不叠加（见文件头）：
       *   挂总代 → 该总代在 GeneralOwnerGrant 里给了这个总监就整间可见
       *   直挂   → 该房在 RoomOwnerGrant 里给了这个总监才可见
       */
      const rooms = await this.prisma.room.findMany({
        where: {
          OR: [
            { generalAgentId: { in: generalIds ?? [] } },
            {
              generalAgentId: null,
              ownerGrants: { some: { ownerId: actor.id } },
            },
          ],
        },
        select: { id: true },
      });
      return rooms.map((r) => r.id);
    }
    if (
      actor.role === 'GENERAL'
      || actor.role === 'AGENT'
      || actor.role === 'PROXY'
      || actor.role === 'CS'
    ) {
      const root = await this.scopeRoot(actor);
      const agent = await this.prisma.agent.findUnique({
        where: { userId: root.id },
        select: { id: true },
      });
      if (!agent) return [];
      /* 总代按名下房间，代理按绑定房间；子账号跟着自己挂的那一层 */
      const rooms = await this.prisma.room.findMany({
        where: root.role === 'GENERAL'
          ? { generalAgentId: agent.id }
          : { ownerAgentId: agent.id },
        select: { id: true },
      });
      return rooms.map((r) => r.id);
    }
    return [];
  }

  private async ensureLegacyDirectorGrants() {
    if (!this.directorGrantBackfill) {
      this.directorGrantBackfill = (async () => {
        const emptyRooms = await this.prisma.room.findMany({
          where: {
            ownerGrants: { none: {} },
            /*
             * 只补直挂房。挂总代的房不看房间级那份名单，给它补等于往库里
             * 塞一批永远不会被读到的行，下次查权限的人又要问这些是干嘛的。
             */
            generalAgentId: null,
          },
          select: { id: true },
        });
        if (!emptyRooms.length) return;
        const branches = await this.prisma.user.findMany({
          where: { role: 'BRANCH' },
          select: { id: true },
        });
        if (!branches.length) return;
        await this.prisma.roomOwnerGrant.createMany({
          data: emptyRooms.flatMap((r) =>
            branches.map((b) => ({ roomId: r.id, ownerId: b.id })),
          ),
          skipDuplicates: true,
        });
      })().catch((err) => {
        this.directorGrantBackfill = null;
        throw err;
      });
    }
    await this.directorGrantBackfill;
  }

  async assertRoomAccess(actor: ConsoleActor, roomId: string) {
    const ids = await this.grantedRoomIds(actor);
    if (ids === null) return;
    if (!ids.includes(roomId)) throw new ForbiddenException('无权访问该房间');
  }

  /** 该总监能否看见这个总代（传总代的 userId） */
  async generalVisibleToBranch(
    actor: ConsoleActor,
    generalUserId: string,
  ): Promise<boolean> {
    const ids = await this.grantedGeneralAgentIds(actor);
    if (ids === null) return true;
    if (!ids.length) return false;
    const agent = await this.prisma.agent.findUnique({
      where: { userId: generalUserId },
      select: { id: true },
    });
    return !!agent && ids.includes(agent.id);
  }

  /**
   * 把房挂到某个总代名下之前调用。
   *
   * 不校验会留一个后门：总监看不见 A 总代，却能把新房挂到 A 名下——
   * 房子建出来的一刻就落进自己看不见的范围，等于凭空造了一间黑房。
   */
  async assertGeneralAssignable(actor: ConsoleActor, generalUserId: string) {
    if (!generalUserId) return;
    if (await this.generalVisibleToBranch(actor, generalUserId)) return;
    throw new ForbiddenException('无权把房间挂到该总代名下');
  }

  /**
   * 房主 / 总代可见用户集合：本人 + 管辖房间内的代理/子账号/在房玩家。
   * 用于风控、操作日志等「按目标人隔离」的查询。
   */
  async scopedUserIds(actor: ConsoleActor): Promise<string[] | null> {
    if (actor.role === 'ADMIN') return null;
    const generalSide = await this.isGeneralSide(actor);
    if (actor.role !== 'BRANCH' && !generalSide) {
      /* 代理侧不走此聚合，调用方应自行处理 */
      return [actor.id];
    }
    const ids = new Set<string>([actor.id]);
    if (actor.role === 'BRANCH') {
      /* 只认被授权的总代；未授权的总代连人带子账号都不出现在日志/风控里 */
      const generalIds = await this.grantedGeneralAgentIds(actor);
      const generals = await this.prisma.user.findMany({
        where: {
          role: 'GENERAL',
          agent: { is: { id: { in: generalIds ?? [] } } },
        },
        select: {
          id: true,
          children: {
            where: { role: { in: ['PROXY', 'CS'] } },
            select: { id: true },
          },
        },
      });
      for (const g of generals) {
        ids.add(g.id);
        for (const c of g.children || []) ids.add(c.id);
      }
    }
    if (generalSide) {
      const rootId = await this.generalRootId(actor);
      ids.add(rootId);
      const kids = await this.prisma.user.findMany({
        where: { parentId: rootId, role: { in: ['PROXY', 'CS'] } },
        select: { id: true },
      });
      for (const c of kids) ids.add(c.id);
    }
    const roomIds = await this.grantedRoomIds(actor);
    if (!roomIds?.length) return [...ids];

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

    /* 总监：总代及其子账号要过总代级授权；房间代理/玩家仍按授权房间 */
    if (actor.role === 'BRANCH') {
      if (target.role === 'GENERAL') {
        if (await this.generalVisibleToBranch(actor, targetUserId)) return;
        throw new ForbiddenException('目标用户不在管辖范围');
      }
      if ((target.role === 'PROXY' || target.role === 'CS') && target.parentId) {
        const parent = await this.prisma.user.findUnique({
          where: { id: target.parentId },
          select: { id: true, role: true },
        });
        if (parent?.role === 'GENERAL') {
          if (await this.generalVisibleToBranch(actor, parent.id)) return;
          throw new ForbiddenException('目标用户不在管辖范围');
        }
      }
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
    if (await this.isGeneralSide(actor)) {
      const rootId = await this.generalRootId(actor);
      if (target.id === rootId || target.parentId === rootId) return;
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
