import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

export interface RoomCard {
  roomNo: string;
  name: string;
  icon: string | null;
}

@Injectable()
export class RoomsService {
  constructor(private prisma: PrismaService) {}

  private toCard(r: { roomNo: string; name: string; icon: string | null }): RoomCard {
    return {
      roomNo: r.roomNo,
      name: r.name,
      icon: r.icon || '/images/rooms/default-room.png',
    };
  }

  /** 当前玩家已通过的房间列表（欢迎归来格子） */
  async listMine(playerId: string): Promise<RoomCard[]> {
    const rows = await this.prisma.roomMember.findMany({
      where: { playerId, status: 'APPROVED', room: { status: 'OPEN' } },
      include: { room: { select: { roomNo: true, name: true, icon: true } } },
      orderBy: { updatedAt: 'desc' },
    });
    return rows.map((m) => this.toCard(m.room));
  }

  /**
   * 输入房间号进入：房间须存在且 OPEN。
   * MVP：校验通过即 APPROVED（后续可改为 PENDING 等代理审核）。
   */
  async enter(playerId: string, roomNoRaw: string): Promise<RoomCard> {
    const roomNo = String(roomNoRaw || '').trim();
    if (!/^\d{6}$/.test(roomNo)) {
      throw new BadRequestException('请输入完整的 6 位房间号');
    }

    const room = await this.prisma.room.findUnique({ where: { roomNo } });
    if (!room) throw new NotFoundException('房间号不存在');
    if (room.status !== 'OPEN') throw new BadRequestException('该房间已关闭');

    await this.prisma.roomMember.upsert({
      where: { playerId_roomId: { playerId, roomId: room.id } },
      create: { playerId, roomId: room.id, status: 'APPROVED' },
      update: { status: 'APPROVED' },
    });

    return this.toCard(room);
  }
}
