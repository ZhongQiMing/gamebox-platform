import {
  BadRequestException, ForbiddenException, Injectable, NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../prisma/prisma.service';

type HangUser = {
  id: string;
  uid: string;
  nickname: string;
  role: string;
};

@Injectable()
export class HangService {
  constructor(
    private prisma: PrismaService,
    private cfg: ConfigService,
  ) {}

  /**
   * 本房挂靠：把 friendUid 挂到 underUid 名下。
   * - 仅本房主代理可操作
   * - friend / under（玩家）必须是本房 APPROVED 成员；under 也可为本房代理本人
   * - 只写 RoomPlayerHang，不改全局 User.parentId
   */
  async hang(
    operatorId: string,
    friendUidRaw: string,
    underUidRaw: string,
    roomIdRaw?: string,
  ) {
    const friendUid = friendUidRaw.trim();
    const underUid = underUidRaw.trim();
    if (!friendUid || !underUid) {
      throw new BadRequestException('请填写好友与推荐人 UID');
    }
    if (friendUid === underUid) {
      throw new BadRequestException('好友与推荐人不能相同');
    }

    const room = await this.resolveOperableRoom(operatorId, roomIdRaw);

    const [friend, under] = await Promise.all([
      this.prisma.user.findUnique({
        where: { uid: friendUid },
        select: { id: true, uid: true, nickname: true, role: true },
      }),
      this.prisma.user.findUnique({
        where: { uid: underUid },
        select: { id: true, uid: true, nickname: true, role: true },
      }),
    ]);
    if (!friend) throw new NotFoundException('好友 UID 不存在');
    if (!under) throw new NotFoundException('推荐人 UID 不存在');
    if (friend.role !== 'PLAYER') {
      throw new BadRequestException('只能挂靠玩家');
    }
    if (friend.id === operatorId) {
      throw new BadRequestException('不能挂靠自己');
    }

    await this.assertApprovedMember(room.id, friend.id, '好友');
    const underIsRoomAgent = under.id === room.ownerUserId;
    if (!underIsRoomAgent) {
      if (under.role !== 'PLAYER') {
        throw new BadRequestException('推荐人须为本房玩家或本房代理');
      }
      await this.assertApprovedMember(room.id, under.id, '推荐人');
    }

    const [friendHang, underHang] = await Promise.all([
      this.prisma.roomPlayerHang.findUnique({
        where: { roomId_playerId: { roomId: room.id, playerId: friend.id } },
      }),
      underIsRoomAgent
        ? Promise.resolve(null)
        : this.prisma.roomPlayerHang.findUnique({
            where: { roomId_playerId: { roomId: room.id, playerId: under.id } },
          }),
    ]);

    const underHangPath = underIsRoomAgent ? '/' : (underHang?.hangPath ?? '/');
    const underDepth = underIsRoomAgent ? 0 : (underHang?.depth ?? 0);

    if (underHangPath.includes(`/${friend.id}/`) || under.id === friend.id) {
      throw new BadRequestException('不能将上级挂到下级名下');
    }

    if (friendHang?.parentId === under.id) {
      return {
        ok: true,
        message: '本房已在该推荐人名下，无需重复挂靠',
        roomId: room.id,
        friend: { uid: friend.uid, nickname: friend.nickname },
        under: { uid: under.uid, nickname: under.nickname },
      };
    }

    await this.applyRoomHang({
      roomId: room.id,
      friend,
      under,
      underHangPath,
      underDepth,
      existing: friendHang,
    });

    return {
      ok: true,
      message: `已在本房将 ${friend.nickname} 挂到 ${under.nickname} 名下`,
      roomId: room.id,
      friend: { uid: friend.uid, nickname: friend.nickname },
      under: { uid: under.uid, nickname: under.nickname },
    };
  }

  /** 进房通过：本房尚无挂靠时，默认挂到本房代理（不产生玩家挂靠佣金链） */
  async ensureDefaultHangToRoomAgent(
    roomId: string,
    playerId: string,
    agentUserId: string,
  ) {
    const existing = await this.prisma.roomPlayerHang.findUnique({
      where: { roomId_playerId: { roomId, playerId } },
      select: { id: true },
    });
    if (existing) return;

    const [player, agent] = await Promise.all([
      this.prisma.user.findUnique({
        where: { id: playerId },
        select: { id: true, uid: true, nickname: true, role: true },
      }),
      this.prisma.user.findUnique({
        where: { id: agentUserId },
        select: { id: true, uid: true, nickname: true, role: true },
      }),
    ]);
    if (!player || player.role !== 'PLAYER' || !agent) return;

    await this.applyRoomHang({
      roomId,
      friend: player,
      under: agent,
      underHangPath: '/',
      underDepth: 0,
      existing: null,
    });
  }

  private async resolveOperableRoom(operatorId: string, roomIdRaw?: string) {
    const roomId = String(roomIdRaw || '').trim();
    if (roomId) {
      const room = await this.prisma.room.findUnique({
        where: { id: roomId },
        select: {
          id: true,
          ownerAgent: { select: { userId: true } },
        },
      });
      if (!room?.ownerAgent?.userId) {
        throw new NotFoundException('房间不存在');
      }
      if (room.ownerAgent.userId !== operatorId) {
        throw new ForbiddenException('只能操作自己房间的挂靠');
      }
      return { id: room.id, ownerUserId: room.ownerAgent.userId };
    }

    const rooms = await this.prisma.room.findMany({
      where: { ownerAgent: { userId: operatorId } },
      select: { id: true, ownerAgent: { select: { userId: true } } },
      take: 2,
    });
    if (rooms.length === 0) {
      throw new BadRequestException('您名下没有房间，无法挂靠');
    }
    if (rooms.length > 1) {
      throw new BadRequestException('名下有多个房间，请指定 roomId');
    }
    return {
      id: rooms[0].id,
      ownerUserId: rooms[0].ownerAgent!.userId,
    };
  }

  private async assertApprovedMember(roomId: string, userId: string, label: string) {
    const m = await this.prisma.roomMember.findUnique({
      where: { playerId_roomId: { playerId: userId, roomId } },
      select: { status: true },
    });
    if (!m || m.status !== 'APPROVED') {
      throw new ForbiddenException(`${label}不是本房间玩家，无法挂靠`);
    }
  }

  private async applyRoomHang(opts: {
    roomId: string;
    friend: HangUser;
    under: HangUser;
    underHangPath: string;
    underDepth: number;
    existing: { hangPath: string; depth: number; parentId: string } | null;
  }) {
    const { roomId, friend, under, underHangPath, underDepth, existing } = opts;
    const newHangPath = `${underHangPath}${under.id}/`;
    const newDepth = underDepth + 1;
    const playerRate = Number(this.cfg.get('PLAYER_COMMISSION_RATE') ?? 0.002);

    await this.prisma.$transaction(async (tx) => {
      if (existing) {
        const oldPrefix = `${existing.hangPath}${friend.id}/`;
        const newPrefix = `${newHangPath}${friend.id}/`;
        const depthDelta = newDepth - existing.depth;

        await tx.roomPlayerHang.update({
          where: { roomId_playerId: { roomId, playerId: friend.id } },
          data: {
            parentId: under.id,
            hangPath: newHangPath,
            depth: newDepth,
          },
        });

        const descendants = await tx.roomPlayerHang.findMany({
          where: { roomId, hangPath: { startsWith: oldPrefix } },
          select: { id: true, hangPath: true, depth: true },
        });
        for (const d of descendants) {
          await tx.roomPlayerHang.update({
            where: { id: d.id },
            data: {
              hangPath: newPrefix + d.hangPath.slice(oldPrefix.length),
              depth: d.depth + depthDelta,
            },
          });
        }
      } else {
        await tx.roomPlayerHang.create({
          data: {
            roomId,
            playerId: friend.id,
            parentId: under.id,
            hangPath: newHangPath,
            depth: newDepth,
          },
        });
      }

      if (under.role === 'PLAYER') {
        const existingAgent = await tx.agent.findUnique({
          where: { userId: under.id },
          select: { commissionRate: true },
        });
        if (!existingAgent) {
          await tx.agent.create({
            data: { userId: under.id, commissionRate: playerRate },
          });
        } else if (existingAgent.commissionRate <= 0) {
          await tx.agent.update({
            where: { userId: under.id },
            data: { commissionRate: playerRate },
          });
        }
      }
    });
  }
}
