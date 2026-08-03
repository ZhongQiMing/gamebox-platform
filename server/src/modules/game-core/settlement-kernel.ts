/**
 * 即时游戏结算内核：扣注 / 派彩 / 分佣 / 幂等回放。
 * 飞盘开 → ROOM；关盘 → AGENT；无房 → PLATFORM。
 */
import { BadRequestException, Injectable, Logger, Optional } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { asMoney, capWin, roundMoney } from '@gamebox/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { PointsService, PLATFORM_OWNER_ID, type OwnerType } from '../points/points.service';
import { CommissionService } from '../agents/commission.service';
import { FlyDiskService } from '../console/fly-disk.service';
import { FlyRebateService } from '../console/fly-rebate.service';

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

  async getBalance(playerId: string): Promise<number> {
    const account = await this.prisma.pointsAccount.findUnique({
      where: { ownerId: playerId },
      select: { balance: true },
    });
    return asMoney(account?.balance ?? 0);
  }

  private async house(playerId: string) {
    if (!this.flyDisk) {
      return { type: 'PLATFORM' as OwnerType, id: PLATFORM_OWNER_ID, flying: false as boolean };
    }
    return this.flyDisk.resolveHouse(playerId);
  }

  /** 玩家押注 → 飞盘对手盘 */
  async debitBetInTx(
    tx: Tx,
    opts: {
      playerId: string;
      roundId: string;
      amount: number;
      gameName: string;
      keyPrefix: string;
    },
  ) {
    const { playerId, roundId, amount, gameName, keyPrefix } = opts;
    if (amount <= 0) return;
    const h = await this.house(playerId);
    await this.points.transferInTx(
      tx,
      {
        type: 'PLAYER',
        id: playerId,
        remark: `${gameName} 押注`,
        idempotencyKey: `${keyPrefix}_bet_player_${roundId}`,
      },
      {
        type: h.type,
        id: h.id,
        idempotencyKey: `${keyPrefix}_bet_house_${roundId}`,
      },
      amount,
      { bizType: 'BET', refType: 'round', refId: roundId },
    );
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
    },
  ): Promise<{ paid: number; capped: boolean }> {
    const { playerId, roundId, betId, remark, keyPrefix } = opts;
    const stake = Math.max(0, roundMoney(opts.stake ?? 0));
    const h = await this.house(playerId);

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
      if (amount > 0) {
        await this.points.transferInTx(
          tx,
          {
            type: h.type,
            id: h.id,
            idempotencyKey: `${keyPrefix}_win_house_${betId}`,
          },
          {
            type: 'PLAYER',
            id: playerId,
            remark,
            idempotencyKey: `${keyPrefix}_win_player_${betId}`,
          },
          amount,
          { bizType: 'WIN', refType: 'round', refId: roundId },
        );
      }
    }

    // 全输（派彩0）也要处理飞盘占用 / 关盘回额度 / 飞盘返水
    if (this.flyDisk && stake > 0) {
      await this.flyDisk.applyFlyLossInTx(tx, h.agentUserId, h.flying, stake, amount);
    }
    if (this.flyRebate && stake > 0) {
      await this.flyRebate.payAgentShareInTx(tx, {
        betId,
        playerId,
        validFlow: stake,
        flying: h.flying,
        roomId: h.roomId,
        agentUserId: h.agentUserId,
      });
    }

    return { paid: amount, capped };
  }

  async applyCommissionInTx(
    tx: Tx,
    player: { id: string; agentPath: string } | null,
    validFlow: number,
    roundId: string,
  ) {
    if (!player || validFlow <= 0 || !player.agentPath) return;
    await this.commission.distributeInTx(tx, player, validFlow, roundId);
  }
}
