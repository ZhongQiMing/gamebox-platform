/**
 * 飞盘：解析下注对手盘、读取返水比例。
 * 现金/信用同一套：开关开且盘分可飞 ≥ 本注额 → 飞平台；不足则本注关盘、代理坐庄。
 * 飞盘单笔输赢只动玩家↔平台，不改代理盘分（算法 A）。
 */
import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { asMoney, roundMoney } from '@gamebox/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { PointsService, PLATFORM_OWNER_ID, type OwnerType } from '../points/points.service';
import {
  cashDiskFlyAvailable,
  creditDiskFlyAvailable,
} from './credit-settle.helper';

export type FlyHouse = {
  type: OwnerType;
  id: string;
  flying: boolean;
  roomId?: string;
  agentUserId?: string;
  /** CASH | CREDIT；关盘结算分支用 */
  bookMode?: string;
};

@Injectable()
export class FlyDiskService {
  constructor(
    private prisma: PrismaService,
    private points: PointsService,
  ) {}

  /** 上盘可飞 = 代理余额 + 客服未发出额度（同一笔盘分池） */
  async cashFlyAvailable(
    tx: Prisma.TransactionClient | PrismaService,
    agentUserId: string,
  ): Promise<number> {
    return cashDiskFlyAvailable(tx, agentUserId);
  }

  private readonly roomInclude = {
    bookMode: true,
    ownerAgent: {
      select: { id: true, userId: true, flyCover: true, rebateRate: true, pointsQuota: true },
    },
  } as const;

  /**
   * 下注/资金路径：6 位房间号 → 运营房间 id，并校验 APPROVED 成员。
   * 多房玩家必须显式指定房间，禁止按 updatedAt 猜房。
   */
  async requireOpsRoomId(playerId: string, roomNoRaw?: string | null): Promise<string> {
    const roomNo = String(roomNoRaw || '').trim();
    if (!/^\d{6}$/.test(roomNo)) {
      throw new BadRequestException('请先进入房间再下注');
    }
    const room = await this.prisma.room.findUnique({
      where: { roomNo },
      select: { id: true, status: true },
    });
    if (!room || room.status !== 'OPEN') {
      throw new BadRequestException('房间不存在或已关闭');
    }
    const member = await this.prisma.roomMember.findFirst({
      where: { playerId, roomId: room.id, status: 'APPROVED' },
      select: { id: true },
    });
    if (!member) {
      throw new BadRequestException('您不在该房间或尚未通过审核');
    }
    return room.id;
  }

  /**
   * 玩家运营房间成员。
   * - preferredRoomId 有值：只认该房（不在房则 null）
   * - required=true：无 preferred 或不在房直接抛错（下注路径）
   * - required=false 且无 preferred：仅控制台非资金展示可回退「最近房」（勿用于下注）
   */
  async resolvePlayerRoom(
    playerId: string,
    preferredRoomId?: string,
    opts?: { required?: boolean },
  ) {
    const required = !!opts?.required;
    if (preferredRoomId) {
      const m = await this.prisma.roomMember.findFirst({
        where: { playerId, roomId: preferredRoomId, status: 'APPROVED' },
        include: { room: { select: this.roomInclude } },
      });
      if (m) return m;
      if (required) {
        throw new BadRequestException('您不在该房间或尚未通过审核');
      }
      return null;
    }
    if (required) {
      throw new BadRequestException('请先进入房间再下注');
    }
    return this.prisma.roomMember.findFirst({
      where: { playerId, status: 'APPROVED', room: { ownerAgentId: { not: null } } },
      orderBy: { updatedAt: 'desc' },
      include: { room: { select: this.roomInclude } },
    });
  }

  /**
   * 飞盘开 → 平台盘口池；关盘 → 房间绑定代理
   * - 现金/信用：开关开且盘分可飞 ≥ 本注额；不足则本注关盘、代理坐庄
   * - 未传 stakeAmount 时：可飞 > 0 即视为可飞（仅供非下注查询）
   * - requireRoom=true（下注默认）：必须带运营房间 id，禁止猜房
   */
  async resolveHouse(
    playerId: string,
    preferredRoomId?: string,
    stakeAmount?: number,
    opts?: { requireRoom?: boolean },
  ): Promise<FlyHouse> {
    const requireRoom = !!opts?.requireRoom;
    if (requireRoom && !preferredRoomId) {
      throw new BadRequestException('请先进入房间再下注');
    }
    const member = await this.resolvePlayerRoom(playerId, preferredRoomId, { required: requireRoom });
    if (!member?.room?.ownerAgent) {
      if (requireRoom) {
        throw new BadRequestException('房间未绑定代理，无法下注');
      }
      return { type: 'PLATFORM', id: PLATFORM_OWNER_ID, flying: false };
    }
    const agent = member.room.ownerAgent;
    const isCredit = member.room.bookMode === 'CREDIT';
    const bookMode = isCredit ? 'CREDIT' : 'CASH';
    const switchOn = member.flyEnabled !== false;
    const available = isCredit
      ? await creditDiskFlyAvailable(this.prisma, agent.userId)
      : await this.cashFlyAvailable(this.prisma, agent.userId);
    const stake = Math.max(0, asMoney(stakeAmount ?? 0));
    const flying = stake > 0
      ? switchOn && available + 1e-9 >= stake
      : switchOn && available > 0;
    if (flying) {
      return {
        type: 'PLATFORM',
        id: PLATFORM_OWNER_ID,
        flying: true,
        roomId: member.roomId,
        agentUserId: agent.userId,
        bookMode,
      };
    }
    return {
      type: 'AGENT',
      id: agent.userId,
      flying: false,
      roomId: member.roomId,
      agentUserId: agent.userId,
      bookMode,
    };
  }

  /**
   * 历史兼容：飞盘单笔净输赢不再改代理盘分（算法 A）。
   * 派彩只走玩家↔平台；盘分仅上分/下分/买额度/关盘庄家路径变动。
   */
  /* eslint-disable-next-line @typescript-eslint/require-await
     -- 保持 async：三处结算调用点都在 await 它，日后若这里恢复动账，
     少一个 await 就是钱没落库还继续往下走 */
  async applyFlyLossInTx(
    _tx: Prisma.TransactionClient,
    _agentUserId: string | undefined,
    _flying: boolean,
    _stake: number,
    _payout: number,
    _idemKey?: string,
    _bookMode?: string,
  ): Promise<void> {
    return;
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
