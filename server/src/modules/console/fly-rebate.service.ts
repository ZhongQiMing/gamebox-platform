/**
 * 飞盘 / 关盘流水佣金（现金/信用同一套意思，出资落账不同）：
 * - 飞盘：平台 → 代理(A) 即时；玩家(P) 进自助回水池
 * - 关盘：玩家(P) 进自助回水池；代理 → 玩家上级（挂靠）即时
 * - 自助回水：玩家可提前领；未领则次日 06:00 自动发「昨日」（不含当日 0–6 点）
 *
 * 两本账：盘分账 + 玩家账
 * - 现金：代理 A 进盘分（余额+上盘额度同步）
 * - 信用：平台付给代理的 A 进佣金账户（余额）；玩家领取时关盘部分从剩余信用出
 */
import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { roundMoney } from '@gamebox/shared';
import { PLATFORM_OWNER_ID, PointsService } from '../points/points.service';
import { CommissionService } from '../agents/commission.service';
import { FlyDiskService } from './fly-disk.service';
import { adjustCashDiskInTx } from './player-fund.helper';

@Injectable()
export class FlyRebateService {
  constructor(
    private points: PointsService,
    private fly: FlyDiskService,
    private commission: CommissionService,
  ) {}

  /**
   * 一笔有效流水的佣金发放（局结事务内）。
   * - 代理份额 A、挂靠：即时入账（笔结）
   * - 玩家份额 P：不进余额，累计进自助回水；手动提前领，或次日 06:00 自动发昨日未领
   */
  async payBetFlowInTx(
    tx: Prisma.TransactionClient,
    opts: {
      betId: string;
      playerId: string;
      validFlow: number;
      flying: boolean;
      roomId?: string;
      agentUserId?: string;
      bookMode?: string;
      agentPath?: string | null;
      roundId?: string;
    },
  ) {
    const flow = roundMoney(opts.validFlow);
    if (flow <= 0 || !opts.betId) return;

    const isCredit = opts.bookMode === 'CREDIT';
    const roomId = opts.roomId;
    const { A } = roomId
      ? await this.fly.resolvePlayerRate(opts.playerId, roomId)
      : { A: 0 };

    /* 仅飞盘时平台付代理 A；玩家 P 走自助回水，不在此发放 */
    if (opts.flying && opts.agentUserId && A > 0) {
      const agentShare = roundMoney(flow * A);
      if (agentShare > 0) {
        await this.payPlatformToAgentWageInTx(tx, {
          agentUserId: opts.agentUserId,
          amount: agentShare,
          betId: opts.betId,
          isCredit,
          ratePct: A * 100,
        });
      }
    }

    /* 挂靠佣金按本房 RoomPlayerHang；无 roomId / 无本房挂靠则不发 */
    if (opts.agentUserId && roomId) {
      await this.commission.distributeInTx(
        tx,
        { id: opts.playerId },
        flow,
        opts.roundId,
        `flow_upline_${opts.betId}`,
        {
          payerAgentUserId: opts.agentUserId,
          bookMode: isCredit ? 'CREDIT' : 'CASH',
          roomId,
        },
      );
    }
  }

  /** @deprecated 使用 payBetFlowInTx */
  async payAgentShareInTx(
    tx: Prisma.TransactionClient,
    opts: {
      betId: string;
      playerId: string;
      validFlow: number;
      flying: boolean;
      roomId?: string;
      agentUserId?: string;
      bookMode?: string;
      agentPath?: string | null;
      roundId?: string;
    },
  ) {
    return this.payBetFlowInTx(tx, opts);
  }

  /** 平台 → 代理工资 A */
  private async payPlatformToAgentWageInTx(
    tx: Prisma.TransactionClient,
    opts: {
      agentUserId: string;
      amount: number;
      betId: string;
      isCredit: boolean;
      ratePct: number;
    },
  ) {
    const remark = `飞盘返水代理 ${opts.ratePct.toFixed(2)}%`;
    if (opts.isCredit) {
      /* 信用：进佣金账户（余额），结账时轧差；不动剩余信用 */
      await this.points.transferInTx(
        tx,
        {
          type: 'PLATFORM',
          id: PLATFORM_OWNER_ID,
          idempotencyKey: `flow_rebate_agent_out_${opts.betId}`,
        },
        {
          type: 'AGENT',
          id: opts.agentUserId,
          idempotencyKey: `flow_rebate_agent_in_${opts.betId}`,
        },
        opts.amount,
        {
          bizType: 'REBATE',
          refType: 'bet',
          refId: opts.betId,
          remark: `${remark}(佣金账)`,
        },
      );
      return;
    }
    /* 现金：平台出，同步加盘分（余额+上盘额度） */
    await this.points.creditInTx(
      tx,
      'PLATFORM',
      PLATFORM_OWNER_ID,
      -opts.amount,
      'REBATE',
      {
        remark,
        refType: 'bet',
        refId: opts.betId,
        idempotencyKey: `flow_rebate_agent_out_${opts.betId}`,
      },
    );
    await adjustCashDiskInTx(tx, this.points, {
      agentUserId: opts.agentUserId,
      delta: opts.amount,
      bizType: 'REBATE',
      remark,
      refType: 'bet',
      refId: opts.betId,
      idempotencyKey: `flow_rebate_agent_in_${opts.betId}`,
    });
  }

}
