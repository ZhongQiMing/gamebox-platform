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
      generalUserId?: string;
      sitting?: 'PLATFORM' | 'GENERAL' | 'AGENT';
      bookMode?: string;
      agentPath?: string | null;
      roundId?: string;
    },
  ) {
    const flow = roundMoney(opts.validFlow);
    if (flow <= 0 || !opts.betId) return;

    const isCredit = opts.bookMode === 'CREDIT';
    const roomId = opts.roomId;
    const rates = roomId
      ? await this.fly.resolvePlayerRate(opts.playerId, roomId)
      : { agentPkg: 0, generalPkg: 0 };
    const sitting =
      opts.sitting ||
      (opts.flying ? 'PLATFORM' : opts.generalUserId ? 'GENERAL' : 'AGENT');
    const agentId = opts.agentUserId;
    const generalId = opts.generalUserId;
    const agentAmt = roundMoney(flow * (rates.agentPkg || 0));
    const generalAmt = roundMoney(flow * (rates.generalPkg || 0));

    /* 飞上台：平台出总代整包（无总代则出代理整包），总代再转代理整包 */
    if (sitting === 'PLATFORM' && agentId) {
      if (generalId && generalAmt > 0) {
        await this.payPlatformToAgentWageInTx(tx, {
          agentUserId: generalId,
          amount: generalAmt,
          betId: opts.betId,
          isCredit,
          ratePct: (rates.generalPkg || 0) * 100,
          tag: 'general',
        });
        if (agentAmt > 0) {
          await this.payAgentToAgentWageInTx(tx, {
            fromUserId: generalId,
            toUserId: agentId,
            amount: agentAmt,
            betId: opts.betId,
            isCredit,
            ratePct: (rates.agentPkg || 0) * 100,
          });
        }
      } else if (agentAmt > 0) {
        await this.payPlatformToAgentWageInTx(tx, {
          agentUserId: agentId,
          amount: agentAmt,
          betId: opts.betId,
          isCredit,
          ratePct: (rates.agentPkg || 0) * 100,
          tag: 'agent',
        });
      }
    }

    /* 总代坐庄：总代出代理整包 */
    if (sitting === 'GENERAL' && generalId && agentId && agentAmt > 0) {
      await this.payAgentToAgentWageInTx(tx, {
        fromUserId: generalId,
        toUserId: agentId,
        amount: agentAmt,
        betId: opts.betId,
        isCredit,
        ratePct: (rates.agentPkg || 0) * 100,
      });
    }

    /* 挂靠一律本房代理出 */
    if (agentId && roomId) {
      await this.commission.distributeInTx(
        tx,
        { id: opts.playerId },
        flow,
        opts.roundId,
        `flow_upline_${opts.betId}`,
        {
          payerAgentUserId: agentId,
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

  private async payPlatformToAgentWageInTx(
    tx: Prisma.TransactionClient,
    opts: {
      agentUserId: string;
      amount: number;
      betId: string;
      isCredit: boolean;
      ratePct: number;
      tag: string;
    },
  ) {
    const remark = `流水整包 ${opts.ratePct.toFixed(2)}%`;
    const outKey = `flow_rebate_${opts.tag}_out_${opts.betId}`;
    const inKey = `flow_rebate_${opts.tag}_in_${opts.betId}`;
    if (opts.isCredit) {
      await this.points.transferInTx(
        tx,
        { type: 'PLATFORM', id: PLATFORM_OWNER_ID, idempotencyKey: outKey },
        { type: 'AGENT', id: opts.agentUserId, idempotencyKey: inKey },
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
    await this.points.creditInTx(
      tx,
      'PLATFORM',
      PLATFORM_OWNER_ID,
      -opts.amount,
      'REBATE',
      { remark, refType: 'bet', refId: opts.betId, idempotencyKey: outKey },
    );
    await adjustCashDiskInTx(tx, this.points, {
      agentUserId: opts.agentUserId,
      delta: opts.amount,
      bizType: 'REBATE',
      remark,
      refType: 'bet',
      refId: opts.betId,
      idempotencyKey: inKey,
    });
  }

  private async payAgentToAgentWageInTx(
    tx: Prisma.TransactionClient,
    opts: {
      fromUserId: string;
      toUserId: string;
      amount: number;
      betId: string;
      isCredit: boolean;
      ratePct: number;
    },
  ) {
    if (opts.fromUserId === opts.toUserId || opts.amount <= 0) return;
    const remark = `流水整包下发 ${opts.ratePct.toFixed(2)}%`;
    const outKey = `flow_rebate_down_out_${opts.betId}`;
    const inKey = `flow_rebate_down_in_${opts.betId}`;
    if (opts.isCredit) {
      await this.points.transferInTx(
        tx,
        { type: 'AGENT', id: opts.fromUserId, idempotencyKey: outKey },
        { type: 'AGENT', id: opts.toUserId, idempotencyKey: inKey },
        opts.amount,
        { bizType: 'REBATE', refType: 'bet', refId: opts.betId, remark: `${remark}(佣金账)` },
      );
      return;
    }
    await adjustCashDiskInTx(tx, this.points, {
      agentUserId: opts.fromUserId,
      delta: -opts.amount,
      bizType: 'REBATE',
      remark,
      refType: 'bet',
      refId: opts.betId,
      idempotencyKey: outKey,
    });
    await adjustCashDiskInTx(tx, this.points, {
      agentUserId: opts.toUserId,
      delta: opts.amount,
      bizType: 'REBATE',
      remark,
      refType: 'bet',
      refId: opts.betId,
      idempotencyKey: inKey,
    });
  }

}
