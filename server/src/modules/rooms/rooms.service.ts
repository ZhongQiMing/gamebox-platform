import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

export interface RoomCard {
  roomNo: string;
  name: string;
  icon: string | null;
  /** 成员状态：APPROVED 可进厅；PENDING 待审 */
  memberStatus?: 'PENDING' | 'APPROVED' | 'REJECTED';
}

@Injectable()
export class RoomsService {
  constructor(private prisma: PrismaService) {}

  private toCard(
    r: { roomNo: string; name: string; icon: string | null },
    memberStatus?: RoomCard['memberStatus'],
  ): RoomCard {
    return {
      roomNo: r.roomNo,
      name: r.name,
      icon: r.icon?.trim() || '/images/rooms/default-room.webp',
      memberStatus,
    };
  }

  /** 当前玩家已通过的房间列表（欢迎归来格子） */
  async listMine(playerId: string): Promise<RoomCard[]> {
    const rows = await this.prisma.roomMember.findMany({
      where: { playerId, status: 'APPROVED', room: { status: 'OPEN' } },
      include: { room: { select: { roomNo: true, name: true, icon: true } } },
      orderBy: { updatedAt: 'desc' },
    });
    return rows.map((m) => this.toCard(m.room, 'APPROVED'));
  }

  /**
   * 输入房间号进入：房间须存在且 OPEN。
   * 新进房 / 被拒后重进 → PENDING，等代理审核；已通过保持 APPROVED。
   * 挂靠仅在审核通过时执行。
   */
  async enter(playerId: string, roomNoRaw: string): Promise<RoomCard> {
    const roomNo = String(roomNoRaw || '').trim();
    if (!/^\d{6}$/.test(roomNo)) {
      throw new BadRequestException('请输入完整的 6 位房间号');
    }

    const room = await this.prisma.room.findUnique({
      where: { roomNo },
      include: {
        ownerAgent: {
          select: { userId: true, user: { select: { id: true, uid: true, role: true } } },
        },
      },
    });
    if (!room) throw new NotFoundException('房间号不存在');
    if (room.status !== 'OPEN') throw new BadRequestException('该房间已关闭');

    const existing = await this.prisma.roomMember.findUnique({
      where: { playerId_roomId: { playerId, roomId: room.id } },
      select: { id: true, status: true },
    });

    if (existing?.status === 'APPROVED') {
      return this.toCard(room, 'APPROVED');
    }

    await this.prisma.roomMember.upsert({
      where: { playerId_roomId: { playerId, roomId: room.id } },
      create: { playerId, roomId: room.id, status: 'PENDING' },
      update: { status: 'PENDING' },
    });

    return this.toCard(room, 'PENDING');
  }
}
