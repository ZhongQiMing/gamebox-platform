/**
 * 真分 / 假分 / 飞盘：解析下注对手盘、扣减 flyCover、读取返水比例。
 */
import { BadRequestException, Injectable } from '@nestjs/common';
import { asMoney, roundMoney } from '@gamebox/shared';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import type { OwnerType } from '../points/points.service';

export type FlyHouse = { type: OwnerType; id: string; flying: boolean; roomId?: string; agentUserId?: string };

@Injectable()
export class FlyDiskService {
  constructor(private prisma: PrismaService) {}

  /** 玩家当前运营房间（优先有绑定代理的 APPROVED 成员） */
  async resolvePlayerRoom(playerId: string, preferredRoomId?: string) {
    if (preferredRoomId) {
      const m = await this.prisma.roomMember.findFirst({
        where: { playerId, roomId: preferredRoomId, status: 'APPROVED' },
        include: {
          room: { include: { ownerAgent: { select: { id: true, userId: true, flyCover: true, rebateRate: true } } } },
        },
      });
      if (m) return m;
    }
    return this.prisma.roomMember.findFirst({
      where: { playerId, status: 'APPROVED', room: { ownerAgentId: { not: null } } },
      orderBy: { updatedAt: 'desc' },
      include: {
        room: { include: { ownerAgent: { select: { id: true, userId: true, flyCover: true, rebateRate: true } } } },
      },
    });
  }

  /**
   * 飞盘开：玩家 flyEnabled 且代理 flyCover>0 → ROOM 池
   * 否则 → 房间绑定代理（可欠账）
   * 无房间时回退 PLATFORM（兼容未进房大厅玩法）
   */
  async resolveHouse(playerId: string, preferredRoomId?: string): Promise<FlyHouse> {
    const member = await this.resolvePlayerRoom(playerId, preferredRoomId);
    if (!member?.room?.ownerAgent) {
      return { type: 'PLATFORM', id: 'PLATFORM', flying: false };
    }
    const agent = member.room.ownerAgent;
    const cover = asMoney(agent.flyCover);
    const flying = member.flyEnabled !== false && cover > 0;
    if (flying) {
      return {
        type: 'ROOM',
        id: member.roomId,
        flying: true,
        roomId: member.roomId,
        agentUserId: agent.userId,
      };
    }
    return {
      type: 'AGENT',
      id: agent.userId,
      flying: false,
      roomId: member.roomId,
      agentUserId: agent.userId,
    };
  }

  /**
   * 玩家本注净亏（stake > payout）时调整代理真分账：
   * - 飞盘开：只减 flyCover（钱在房间盘口/平台侧，不回可发真分）
   * - 关盘：减 flyCover，并等额加回 pointsQuota（跟平台买的额度还在；钱已进代理钱包）
   * take 不超过当前 flyCover → 假分输赢不会凭空加额度
   */
  async applyFlyLossInTx(
    tx: Prisma.TransactionClient,
    agentUserId: string | undefined,
    flying: boolean,
    stake: number,
    payout: number,
  ) {
    if (!agentUserId) return;
    const netLoss = roundMoney(stake - payout);
    if (netLoss <= 0) return;
    const agent = await tx.agent.findUnique({ where: { userId: agentUserId } });
    if (!agent) return;
    const cover = asMoney(agent.flyCover);
    const take = roundMoney(Math.min(netLoss, cover));
    if (take <= 0) return;

    if (flying) {
      await tx.agent.update({
        where: { userId: agentUserId },
        data: { flyCover: { decrement: take } },
      });
      return;
    }

    const used = asMoney(agent.pointsUsed);
    const usedBack = roundMoney(Math.min(take, used));
    await tx.agent.update({
      where: { userId: agentUserId },
      data: {
        flyCover: { decrement: take },
        pointsQuota: { increment: take },
        ...(usedBack > 0 ? { pointsUsed: { decrement: usedBack } } : {}),
      },
    });
  }

  async getRebatePolicy() {
    const row = await this.prisma.rebatePolicy.findUnique({ where: { id: 1 } });
    return {
      totalRate: row?.totalRate ?? 0.05,
      playerMinRate: row?.playerMinRate ?? 0.018,
    };
  }

  /** 玩家 P：房间成员覆盖 → 房主代理默认 → 全局下限；并夹在 [min, T/2] */
  async resolvePlayerRate(playerId: string, roomId?: string): Promise<{ P: number; T: number; A: number }> {
    const { totalRate: T, playerMinRate } = await this.getRebatePolicy();
    const maxP = T / 2;
    const member = await this.resolvePlayerRoom(playerId, roomId);
    let P = member?.playerRebateRate
      ?? member?.room?.ownerAgent?.rebateRate
      ?? playerMinRate;
    if (P < playerMinRate) P = playerMinRate;
    if (P > maxP) P = maxP;
    return { P, T, A: roundMoney(T - P) };
  }

  clampPlayerRate(rate: number, T: number, playerMinRate: number) {
    const maxP = T / 2;
    if (rate < playerMinRate || rate > maxP) {
      throw new BadRequestException(`玩家回水须在 ${playerMinRate} ~ ${maxP}（不超过代理份额）`);
    }
    return rate;
  }
}
