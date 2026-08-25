/**
 * 流水回水：总代、代理、玩家各按自己的点，记到自己账上。
 * - 总代自己的 = 总代% − 代理%
 * - 代理自己的 = 代理% − 玩家%
 * - 玩家的进回水池；关盘庄家盘分当场扣，领取只入玩家账户
 * 飞盘由平台分头打给总代、代理；关盘由庄家打给下家。不经手转。
 */

import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { roundMoney } from '@gamebox/shared';
import { PLATFORM_OWNER_ID, PointsService } from '../points/points.service';
import { CommissionService } from '../agents/commission.service';
import { FlyDiskService } from './fly-disk.service';
import { adjustCashDiskInTx } from './player-fund.helper';

/** 比例取值范围校验：只有 0~1 的有限数才算有效快照 */
function validRate(v: unknown): number | null {
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 && n <= 1 ? n : null;
}

/**
 * 从注单 payload.fly 里取下注时定死的整包比例。
 * 两个都缺就返回 null，由调用方回退到现算（老注单没有这两个字段）。
 */
export function persistedPkgRates(
  fly: { agentPkg?: unknown; generalPkg?: unknown; P?: unknown } | null | undefined,
): { agentPkg: number; generalPkg: number; P: number } | null {
  if (!fly) return null;
  const agentPkg = validRate(fly.agentPkg);
  const generalPkg = validRate(fly.generalPkg);
  if (agentPkg == null && generalPkg == null) return null;
  return {
    agentPkg: agentPkg ?? 0,
    generalPkg: generalPkg ?? 0,
    P: validRate(fly.P) ?? 0,
  };
}

function roundRate(n: number) {
  return Math.round(Math.max(0, n) * 10000) / 10000;
}

/** 各人自己的点：页面上的%是整层，自己拿的是扣掉下家之后剩下的。 */
export function ownRebateRates(agentPkg: number, generalPkg: number, P: number) {
  const playerRate = roundRate(Number(P) || 0);
  const agent = roundRate(Number(agentPkg) || 0);
  const general = roundRate(Number(generalPkg) || 0);
  return {
    playerRate,
    agentOwn: roundRate(agent - playerRate),
    generalOwn: general > 0 ? roundRate(general - agent) : 0,
  };
}

@Injectable()
export class FlyRebateService {
  constructor(
    private points: PointsService,
    private fly: FlyDiskService,
    private commission: CommissionService,
  ) {}

  /**
   * 一笔有效流水的佣金发放（局结事务内）。
   * - 总代、代理自己的点：即时入账
   * - 玩家的点：记进回水池，六点入账（可提前领）
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
      /** 本注所属游戏：仅用于房间单游戏回水覆盖 */
      gameCode?: string;
      /**
       * 下注时定死的整包比例（来自注单 payload.fly）。
       *
       * 结算可能比下注晚很久（尤其崩溃续跑），期间管理端改了比例的话，
       * 现算会按新比例结算旧流水。玩家回水 P 早就是下注时快照，
       * 代理与总代整包必须同样处理，否则同一笔注单三方口径不一致。
       * 老注单没有快照时才回退到现算。
       */
      rateSnapshot?: { agentPkg?: unknown; generalPkg?: unknown; P?: unknown } | null;
    },
  ) {
    const flow = roundMoney(opts.validFlow);
    if (flow <= 0 || !opts.betId) return;

    const isCredit = opts.bookMode === 'CREDIT';
    const roomId = opts.roomId;
    const snapshot = persistedPkgRates(opts.rateSnapshot);
    const rates =
      snapshot ??
      (roomId
        ? await this.fly.resolvePlayerRate(opts.playerId, roomId, opts.gameCode)
        : { agentPkg: 0, generalPkg: 0, P: 0 });
    const sitting =
      opts.sitting ||
      (opts.flying ? 'PLATFORM' : opts.generalUserId ? 'GENERAL' : 'AGENT');
    const agentId = opts.agentUserId;
    const generalId = opts.generalUserId;
    const { agentOwn, generalOwn, playerRate } = ownRebateRates(
      Number(rates.agentPkg) || 0,
      Number(rates.generalPkg) || 0,
      Number(rates.P) || 0,
    );
    const agentAmt = roundMoney(flow * agentOwn);
    const generalAmt = roundMoney(flow * generalOwn);
    const playerAmt = roundMoney(flow * playerRate);

    /* 飞上台：平台分头打到总代、代理自己的盘分 */
    if (sitting === 'PLATFORM') {
      if (generalId && generalAmt > 0) {
        await this.payPlatformToAgentWageInTx(tx, {
          agentUserId: generalId,
          amount: generalAmt,
          betId: opts.betId,
          isCredit,
          ratePct: generalOwn * 100,
          tag: 'general',
        });
      }
      if (agentId && agentAmt > 0) {
        await this.payPlatformToAgentWageInTx(tx, {
          agentUserId: agentId,
          amount: agentAmt,
          betId: opts.betId,
          isCredit,
          ratePct: agentOwn * 100,
          tag: 'agent',
        });
      }
    }

    /* 总代坐庄：总代出代理自己的那份 */
    if (sitting === 'GENERAL' && generalId && agentId && agentAmt > 0) {
      await this.payAgentToAgentWageInTx(tx, {
        fromUserId: generalId,
        toUserId: agentId,
        amount: agentAmt,
        betId: opts.betId,
        isCredit,
        ratePct: agentOwn * 100,
      });
    }

    /* 玩家回水：庄家盘分当场扣，钱先放到平台待入账；领取只进玩家账户，不再扣盘分 */
    await this.reservePlayerRebateInTx(tx, {
      betId: opts.betId,
      amount: playerAmt,
      sitting,
      generalUserId: generalId,
      agentUserId: agentId,
      isCredit,
      ratePct: playerRate * 100,
    });

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

  private async reservePlayerRebateInTx(
    tx: Prisma.TransactionClient,
    opts: {
      betId: string;
      amount: number;
      sitting: 'PLATFORM' | 'GENERAL' | 'AGENT';
      generalUserId?: string;
      agentUserId?: string;
      isCredit: boolean;
      ratePct: number;
    },
  ) {
    await reserveClosedPlayerRebateInTx(tx, this.points, opts);
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
    const remark = `流水回水 ${opts.ratePct.toFixed(2)}%`;
    const outKey = `flow_rebate_${opts.tag}_out_${opts.betId}`;
    const inKey = `flow_rebate_${opts.tag}_in_${opts.betId}`;
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
      bookMode: opts.isCredit ? 'CREDIT' : 'CASH',
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
    const remark = `流水回水 ${opts.ratePct.toFixed(2)}%`;
    const outKey = `flow_rebate_down_out_${opts.betId}`;
    const inKey = `flow_rebate_down_in_${opts.betId}`;
    const bookMode = opts.isCredit ? 'CREDIT' : 'CASH';
    await adjustCashDiskInTx(tx, this.points, {
      agentUserId: opts.fromUserId,
      bookMode,
      delta: -opts.amount,
      bizType: 'REBATE',
      remark,
      refType: 'bet',
      refId: opts.betId,
      idempotencyKey: outKey,
    });
    await adjustCashDiskInTx(tx, this.points, {
      agentUserId: opts.toUserId,
      bookMode,
      delta: opts.amount,
      bizType: 'REBATE',
      remark,
      refType: 'bet',
      refId: opts.betId,
      idempotencyKey: inKey,
    });
  }

}

/** 关盘：庄家盘分当场少掉玩家回水，平台先替玩家看着。飞盘不预扣。 */
export async function reserveClosedPlayerRebateInTx(
  tx: Prisma.TransactionClient,
  points: PointsService,
  opts: {
    betId: string;
    amount: number;
    sitting: 'PLATFORM' | 'GENERAL' | 'AGENT';
    generalUserId?: string;
    agentUserId?: string;
    isCredit: boolean;
    ratePct: number;
  },
) {
  if (opts.amount <= 0 || opts.sitting === 'PLATFORM') return;
  const fromUserId = opts.sitting === 'GENERAL' ? opts.generalUserId : opts.agentUserId;
  if (!fromUserId) return;

  const remark = `玩家回水 ${opts.ratePct.toFixed(2)}%`;
  const outKey = `flow_rebate_player_hold_out_${opts.betId}`;
  const inKey = `flow_rebate_player_hold_in_${opts.betId}`;
  const bookMode = opts.isCredit ? 'CREDIT' : 'CASH';
  await adjustCashDiskInTx(tx, points, {
    agentUserId: fromUserId,
    bookMode,
    delta: -opts.amount,
    bizType: 'REBATE',
    remark,
    refType: 'bet',
    refId: opts.betId,
    idempotencyKey: outKey,
  });
  await points.creditInTx(tx, 'PLATFORM', PLATFORM_OWNER_ID, opts.amount, 'REBATE', {
    remark: `${remark}·待入账`,
    refType: 'bet',
    refId: opts.betId,
    idempotencyKey: inKey,
  });
  await tx.$executeRaw`
    UPDATE "Bet"
    SET payload = jsonb_set(
      COALESCE(payload, '{}'::jsonb), '{fly,playerHeld}', 'true'::jsonb, true
    )
    WHERE id = ${opts.betId}
  `;
}
