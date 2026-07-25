import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

export type OwnerType = 'PLATFORM' | 'BRANCH' | 'AGENT' | 'PROXY' | 'PLAYER';
export type BizType =
  | 'RECHARGE'
  | 'WITHDRAW'
  | 'TRANSFER_OUT'
  | 'TRANSFER_IN'
  | 'BET'
  | 'WIN'
  | 'FEE'
  | 'COMMISSION'
  | 'REBATE'
  | 'ACTIVITY'
  | 'ADJUST';

export interface LedgerOpts {
  refType?: string;
  refId?: string;
  remark?: string;
  operatorId?: string;
  idempotencyKey?: string;
}

export const PLATFORM_OWNER_ID = 'PLATFORM';

/**
 * 平台账户余额下限。
 * 平台侧允许为负（代表已下发到生态的积分总量），但不能无底线——
 * 一旦跌破说明赔率配置或风控出了问题，此时拒绝继续派彩并让事务回滚，
 * 比闷声亏到底更容易被发现。可用 PLATFORM_BALANCE_FLOOR 覆盖。
 */
const DEFAULT_PLATFORM_FLOOR = -100_000_000;

function platformFloor(): number {
  const raw = Number(process.env.PLATFORM_BALANCE_FLOOR);
  return Number.isFinite(raw) ? raw : DEFAULT_PLATFORM_FLOOR;
}

/**
 * 积分账本 —— 全平台积分变动的唯一入口。
 * 规则：
 *   1. 任何余额变动必须经此服务，且必须写一条 PointsLedger
 *   2. 转账 = 同一事务内 出账 + 入账 两条流水
 *   3. 所有写入用 $transaction，禁止事务外更新 balance
 *   4. idempotencyKey 幂等，防重复扣/派彩
 *   5. PLATFORM 账户允许为负，但不得跌破 platformFloor()；其余账户禁止透支
 *   6. 【加锁顺序】一笔转账必须先动 PLATFORM 侧再动对手方。
 *      平台账户是所有资金流的公共行，两个方向不一致会形成死锁环
 *      （下注 PLAYER→PLATFORM 撞上派彩 PLATFORM→PLAYER）。
 *      成对出账/入账请一律走 transferInTx，不要自己拼两次 creditInTx。
 */
@Injectable()
export class PointsService {
  constructor(private prisma: PrismaService) {}

  /**
   * 事务内转账：自动保证「PLATFORM 侧先加锁」，避免与其他资金流互相等待。
   * 两侧幂等键独立传入，便于沿用各引擎既有的键命名。
   */
  async transferInTx(
    tx: Prisma.TransactionClient,
    from: { type: OwnerType; id: string; idempotencyKey?: string; remark?: string },
    to: { type: OwnerType; id: string; idempotencyKey?: string; remark?: string },
    amount: number,
    opts: LedgerOpts & { bizType: BizType } = { bizType: 'ADJUST' },
  ) {
    if (amount <= 0) throw new BadRequestException('转账金额必须 > 0');
    const debit = () =>
      this.creditInTx(tx, from.type, from.id, -amount, opts.bizType, {
        ...opts,
        remark: from.remark ?? opts.remark,
        idempotencyKey: from.idempotencyKey,
      });
    const credit = () =>
      this.creditInTx(tx, to.type, to.id, amount, opts.bizType, {
        ...opts,
        remark: to.remark ?? opts.remark,
        idempotencyKey: to.idempotencyKey,
      });

    // 平台侧先行；两边都不是平台时按 ownerId 字典序，保证全局一致的加锁顺序
    if (from.type === 'PLATFORM') return { out: await debit(), in: await credit() };
    if (to.type === 'PLATFORM') {
      const inn = await credit();
      return { out: await debit(), in: inn };
    }
    if (from.id <= to.id) return { out: await debit(), in: await credit() };
    const inn = await credit();
    return { out: await debit(), in: inn };
  }

  async credit(
    ownerType: OwnerType,
    ownerId: string,
    amount: number,
    bizType: BizType,
    opts: LedgerOpts = {},
  ) {
    if (amount === 0) throw new BadRequestException('金额不能为 0');
    return this.prisma.$transaction((tx) =>
      this.creditInTx(tx, ownerType, ownerId, amount, bizType, opts),
    );
  }

  /** 复用外部事务（供结算/分润批量调用） */
  async creditInTx(
    tx: Prisma.TransactionClient,
    ownerType: OwnerType,
    ownerId: string,
    amount: number,
    bizType: BizType,
    opts: LedgerOpts = {},
  ) {
    if (opts.idempotencyKey) {
      const existed = await tx.pointsLedger.findUnique({
        where: { idempotencyKey: opts.idempotencyKey },
      });
      if (existed) return existed;
    }

    const account = await tx.pointsAccount.upsert({
      where: { ownerId },
      update: {},
      create: { ownerType: ownerType as never, ownerId },
    });

    // 原子增减（UPDATE 自带行锁），杜绝并发读改写丢更新。
    // 扣款时把下限写进 WHERE：普通账户不得透支，平台账户不得跌破 floor。
    const floor = ownerType === 'PLATFORM' ? platformFloor() : 0;
    const guard =
      amount < 0 ? Prisma.sql`AND "balance" + ${amount} >= ${floor}` : Prisma.empty;
    const rows = await tx.$queryRaw<{ balance: number }[]>`
      UPDATE "PointsAccount"
      SET "balance" = "balance" + ${amount}, "updatedAt" = NOW()
      WHERE "id" = ${account.id}
        ${guard}
      RETURNING "balance"
    `;
    if (rows.length === 0) {
      if (ownerType === 'PLATFORM') {
        throw new BadRequestException(
          `平台池已触及下限 ${floor}，本次派彩被拒绝，请检查赔率与风控配置`,
        );
      }
      throw new BadRequestException(`账户余额不足：${ownerType}/${ownerId}`);
    }
    const newBalance = rows[0].balance;

    return tx.pointsLedger.create({
      data: {
        accountId: account.id,
        bizType: bizType as never,
        amount,
        balanceAfter: newBalance,
        refType: opts.refType,
        refId: opts.refId,
        remark: opts.remark,
        operatorId: opts.operatorId,
        idempotencyKey: opts.idempotencyKey,
      },
    });
  }

  /** 标准转账：A 扣，B 加，同事务两条流水 */
  async transfer(
    from: { type: OwnerType; id: string },
    to: { type: OwnerType; id: string },
    amount: number,
    opts: LedgerOpts & { bizTypeOut?: BizType; bizTypeIn?: BizType } = {},
  ) {
    if (amount <= 0) throw new BadRequestException('转账金额必须 > 0');
    if (from.id === to.id) throw new BadRequestException('不能转给自己');
    const bizOut = opts.bizTypeOut ?? 'TRANSFER_OUT';
    const bizIn = opts.bizTypeIn ?? 'TRANSFER_IN';
    return this.prisma.$transaction(async (tx) => {
      const outKey = opts.idempotencyKey ? `${opts.idempotencyKey}:OUT` : undefined;
      const inKey = opts.idempotencyKey ? `${opts.idempotencyKey}:IN` : undefined;
      const out = await this.creditInTx(tx, from.type, from.id, -amount, bizOut, {
        ...opts,
        idempotencyKey: outKey,
      });
      const inn = await this.creditInTx(tx, to.type, to.id, amount, bizIn, {
        ...opts,
        idempotencyKey: inKey,
      });
      return { out, in: inn };
    });
  }
}
