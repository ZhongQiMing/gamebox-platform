/**
 * 即时游戏结算内核：扣注 / 派彩 / 分佣 / 幂等回放。
 * 各引擎只负责开奖结果，资金动作统一走这里。
 *
 * 回水不在此发放：统一由 RebateService 按 Bet.validFlow 日结，
 * 局内再发一次会造成同一笔流水双倍回水。
 */
import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { asMoney, capWin, roundMoney } from '@gamebox/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { PointsService, PLATFORM_OWNER_ID } from '../points/points.service';
import { CommissionService } from '../agents/commission.service';

export type Tx = Prisma.TransactionClient;

@Injectable()
export class SettlementKernel {
  private readonly logger = new Logger(SettlementKernel.name);

  constructor(
    private prisma: PrismaService,
    private points: PointsService,
    private commission: CommissionService,
  ) {}

  assertClientRequestId(id?: string): string {
    if (!id || id.length < 8 || id.length > 100) {
      throw new BadRequestException('clientRequestId 无效');
    }
    return id;
  }

  /**
   * 按 Bet.clientRequestId 查找已结算局，供幂等回放。
   * 被占用但非本人 → 400。
   */
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

  /** 玩家押注 → 平台池（round 级幂等键） */
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
    await this.points.transferInTx(
      tx,
      {
        type: 'PLAYER',
        id: playerId,
        remark: `${gameName} 押注`,
        idempotencyKey: `${keyPrefix}_bet_player_${roundId}`,
      },
      {
        type: 'PLATFORM',
        id: PLATFORM_OWNER_ID,
        idempotencyKey: `${keyPrefix}_bet_plat_${roundId}`,
      },
      amount,
      { bizType: 'BET', refType: 'round', refId: roundId },
    );
  }

  /**
   * 平台池 → 玩家派彩（bet 级幂等键）。
   * 默认在这里封顶；多仓引擎可先整局 allocateCappedWins，再 skipCap 写入已拆好的金额。
   */
  async creditWinInTx(
    tx: Tx,
    opts: {
      playerId: string;
      roundId: string;
      betId: string;
      amount: number;
      remark: string;
      keyPrefix: string;
      /** 本局总下注，用于计算封顶线；缺省则只受绝对上限约束 */
      stake?: number;
      /** 调用方已做整局封顶时跳过二次 cap */
      skipCap?: boolean;
    },
  ): Promise<{ paid: number; capped: boolean }> {
    const { playerId, roundId, betId, remark, keyPrefix } = opts;
    if (opts.amount <= 0) return { paid: 0, capped: false };
    const { win: amount, capped } = opts.skipCap
      ? { win: Math.max(0, roundMoney(opts.amount)), capped: false }
      : capWin(opts.stake ?? Number.MAX_SAFE_INTEGER, opts.amount);
    if (capped) {
      this.logger.error(
        `派彩触顶：round=${roundId} bet=${betId} 原始=${opts.amount} 封顶=${amount}，请立即核对赔率配置`,
      );
    }
    if (amount <= 0) return { paid: 0, capped };
    await this.points.transferInTx(
      tx,
      {
        type: 'PLATFORM',
        id: PLATFORM_OWNER_ID,
        idempotencyKey: `${keyPrefix}_win_plat_${betId}`,
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
    return { paid: amount, capped };
  }

  async applyCommissionInTx(
    tx: Tx,
    player: { id: string; agentPath: string | null } | null | undefined,
    validFlow: number,
    roundId: string,
  ) {
    if (!player?.agentPath || validFlow <= 0) return;
    await this.commission.distributeInTx(
      tx,
      { id: player.id, agentPath: player.agentPath },
      validFlow,
      roundId,
    );
  }
}
