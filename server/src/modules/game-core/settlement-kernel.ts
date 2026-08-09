/**
 * 即时游戏结算内核：扣注 / 派彩 / 分佣 / 幂等回放。
 * 飞盘开 → PLATFORM，并按净输赢增减上盘额度（余额+上盘额度）。
 * 关盘 → 现金 BV：只动玩家持分；信用：调剩余信用。
 * 下注时传入的 house 快照须在派彩时复用（当期锁定，下期再生效）。
 */
import { BadRequestException, Injectable, Logger, Optional } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { capWin, roundMoney } from '@gamebox/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { PointsService, PLATFORM_OWNER_ID } from '../points/points.service';
import { CommissionService } from '../agents/commission.service';
import { FlyDiskService, type FlyHouse } from '../console/fly-disk.service';
import { FlyRebateService } from '../console/fly-rebate.service';
import {
  closedDiskDebitBetInTx,
  closedDiskSettleWinInTx,
} from '../console/player-fund.helper';

export type Tx = Prisma.TransactionClient;

@Injectable()
export class SettlementKernel {
  private readonly logger = new Logger(SettlementKernel.name);

  constructor(
    private prisma: PrismaService,
    private points: PointsService,
    private commission: CommissionService,
    @Optional() private flyDisk?: FlyDiskService,
    @Optional() private flyRebate?: FlyRebateService,
  ) {}

  assertClientRequestId(id?: string): string {
    if (!id || id.length < 8 || id.length > 100) {
      throw new BadRequestException('clientRequestId 无效');
    }
    return id;
  }

  async findSettledByClientRequestId(playerId: string, clientRequestId: string) {
    const bet = await this.prisma.bet.findUnique({
      where: { clientRequestId },
      include: {
        round: true,
        game: { select: { code: true, name: true, category: true } },
      },
    });
    if (!bet) return null;
    if (bet.playerId !== playerId || !bet.round) {
      throw new BadRequestException('clientRequestId 已被占用');
    }
    return bet;
  }

  async getBalance(playerId: string, roomId: string): Promise<number> {
    if (!roomId) return 0;
    return this.points.getPlayerBalance(playerId, roomId);
  }

  async resolveHouse(
    playerId: string,
    stakeAmount?: number,
    opsRoomId?: string,
  ): Promise<FlyHouse> {
    if (!this.flyDisk) {
      return { type: 'PLATFORM', id: PLATFORM_OWNER_ID, flying: false };
    }
    if (!opsRoomId) {
      throw new BadRequestException('请先进入房间再下注');
    }
    return this.flyDisk.resolveHouse(playerId, opsRoomId, stakeAmount, { requireRoom: true });
  }

  private isClosedDisk(h: FlyHouse) {
    return !h.flying && h.type === 'AGENT';
  }

  private requirePlayerRoomId(h: FlyHouse, action: string): string {
    const rid = String(h.roomId || '').trim();
    if (!rid) {
      throw new BadRequestException(`${action}缺少房间，请先进入房间`);
    }
    return rid;
  }

  /** 玩家押注：飞盘/无房→平台；关盘→只扣玩家（BV 房间账） */
  async debitBetInTx(
    tx: Tx,
    opts: {
      playerId: string;
      roundId: string;
      amount: number;
      gameName: string;
      keyPrefix: string;
      /** 当期锁定的对手盘；不传则须带 opsRoomId 现场解析 */
      house?: FlyHouse;
      opsRoomId?: string;
    },
  ): Promise<FlyHouse> {
    const { playerId, roundId, amount, gameName, keyPrefix } = opts;
    if (amount <= 0) {
      if (opts.house) return opts.house;
      if (!opts.opsRoomId) {
        throw new BadRequestException('请先进入房间再下注');
      }
      return this.resolveHouse(playerId, undefined, opts.opsRoomId);
    }
    /* 未预解析时按本注额判断：可飞不足则关盘坐庄 */
    let h = opts.house;
    if (!h) {
      if (!opts.opsRoomId) {
        throw new BadRequestException('请先进入房间再下注');
      }
      h = await this.resolveHouse(playerId, amount, opts.opsRoomId);
    }
    const playerRoomId = this.requirePlayerRoomId(h, '下注');

    if (this.isClosedDisk(h)) {
      await closedDiskDebitBetInTx(tx, this.points, {
        playerId,
        agentUserId: h.agentUserId || h.id,
        roomId: playerRoomId,
        bookMode: h.bookMode,
        amount,
        remark: `${gameName} 押注(关盘)`,
        refType: 'round',
        refId: roundId,
        idemPlayer: `${keyPrefix}_bet_player_${roundId}`,
        idemAgent: `${keyPrefix}_bet_agent_${roundId}`,
      });
    } else {
      await this.points.transferInTx(
        tx,
        {
          type: 'PLAYER',
          id: playerId,
          roomId: playerRoomId,
          remark: `${gameName} 押注`,
          idempotencyKey: `${keyPrefix}_bet_player_${roundId}`,
        },
        {
          type: 'PLATFORM',
          id: PLATFORM_OWNER_ID,
          idempotencyKey: `${keyPrefix}_bet_house_${roundId}`,
        },
        amount,
        { bizType: 'BET', refType: 'round', refId: roundId },
      );
    }
    return h;
  }

  async creditWinInTx(
    tx: Tx,
    opts: {
      playerId: string;
      roundId: string;
      betId: string;
      amount: number;
      remark: string;
      keyPrefix: string;
      stake?: number;
      skipCap?: boolean;
      /** 猜大小等 0 边缘玩法：仍走房间对手盘，但不刷流水返水/佣金 */
      skipFlowRebate?: boolean;
      /** 须与扣注时同一快照 */
      house?: FlyHouse;
      opsRoomId?: string;
    },
  ): Promise<{ paid: number; capped: boolean; house: FlyHouse }> {
    const { playerId, roundId, betId, remark, keyPrefix } = opts;
    const stake = Math.max(0, roundMoney(opts.stake ?? 0));
    /* 派彩须带下注时的 house 快照；缺省时按本金再判一次飞/关 */
    let h = opts.house;
    if (!h) {
      if (!opts.opsRoomId) {
        throw new BadRequestException('派彩缺少对手盘快照');
      }
      h = await this.resolveHouse(playerId, stake > 0 ? stake : undefined, opts.opsRoomId);
    }
    const playerRoomId = this.requirePlayerRoomId(h, '派彩');

    let amount = 0;
    let capped = false;
    if (opts.amount > 0) {
      const cappedRes = opts.skipCap
        ? { win: Math.max(0, roundMoney(opts.amount)), capped: false }
        : capWin(stake > 0 ? stake : Number.MAX_SAFE_INTEGER, opts.amount);
      amount = cappedRes.win;
      capped = cappedRes.capped;
      if (capped) {
        this.logger.error(
          `派彩触顶：round=${roundId} bet=${betId} 原始=${opts.amount} 封顶=${amount}，请立即核对赔率配置`,
        );
      }
    }

    if (h.flying) {
      if (amount > 0) {
        await this.points.transferInTx(
          tx,
          {
            type: 'PLATFORM',
            id: PLATFORM_OWNER_ID,
            idempotencyKey: `${keyPrefix}_win_house_${betId}`,
          },
          {
            type: 'PLAYER',
            id: playerId,
            roomId: playerRoomId,
            remark,
            idempotencyKey: `${keyPrefix}_win_player_${betId}`,
          },
          amount,
          { bizType: 'WIN', refType: 'round', refId: roundId },
        );
      }
      if (this.flyDisk && stake > 0) {
        await this.flyDisk.applyFlyLossInTx(
          tx,
          h.agentUserId,
          true,
          stake,
          amount,
          `${keyPrefix}_fly_quota_${betId}`,
          h.bookMode,
        );
      }
      if (this.flyRebate && stake > 0 && !opts.skipFlowRebate) {
        await this.flyRebate.payBetFlowInTx(tx, {
          betId,
          playerId,
          validFlow: stake,
          flying: true,
          roomId: playerRoomId,
          agentUserId: h.agentUserId,
          bookMode: h.bookMode,
          roundId,
        });
      }
    } else if (h.type === 'PLATFORM') {
      if (amount > 0) {
        await this.points.transferInTx(
          tx,
          {
            type: 'PLATFORM',
            id: PLATFORM_OWNER_ID,
            idempotencyKey: `${keyPrefix}_win_house_${betId}`,
          },
          {
            type: 'PLAYER',
            id: playerId,
            roomId: playerRoomId,
            remark,
            idempotencyKey: `${keyPrefix}_win_player_${betId}`,
          },
          amount,
          { bizType: 'WIN', refType: 'round', refId: roundId },
        );
      }
    } else {
      /* 关盘：派彩加玩家并从代理盘分赔出 */
      await closedDiskSettleWinInTx(tx, this.points, {
        playerId,
        agentUserId: h.agentUserId || h.id,
        roomId: playerRoomId,
        bookMode: h.bookMode,
        stake,
        payout: amount,
        remark: `${remark}(关盘)`,
        refType: 'round',
        refId: roundId,
        idemPlayer: `${keyPrefix}_win_player_${betId}`,
        idemAgent: `${keyPrefix}_win_agent_${betId}`,
      });
      if (this.flyRebate && stake > 0 && !opts.skipFlowRebate) {
        await this.flyRebate.payBetFlowInTx(tx, {
          betId,
          playerId,
          validFlow: stake,
          flying: false,
          roomId: playerRoomId,
          agentUserId: h.agentUserId || h.id,
          bookMode: h.bookMode,
          roundId,
        });
      }
    }

    return { paid: amount, capped, house: h };
  }

  /**
   * @deprecated 流水佣金已并入 creditWinInTx → payBetFlowInTx；
   * 无 roomId 时不发挂靠佣金（按房隔离）。
   */
  async applyCommissionInTx(
    tx: Tx,
    player: { id: string; agentPath?: string } | null,
    validFlow: number,
    roundId: string,
    roomId?: string,
  ) {
    if (!player || validFlow <= 0 || !roomId) return;
    await this.commission.distributeInTx(tx, player, validFlow, roundId, undefined, { roomId });
  }
}
