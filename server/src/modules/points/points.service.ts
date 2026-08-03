import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { asMoney, roundMoney } from '@gamebox/shared';
import { PrismaService } from '../../prisma/prisma.service';

export type OwnerType = 'PLATFORM' | 'BRANCH' | 'AGENT' | 'PROXY' | 'PLAYER' | 'ROOM';
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

/** 代理欠账下限（飞盘关闭后玩家继续赢） */
const DEFAULT_AGENT_FLOOR = -100_000_000;
/** 房间盘口池下限 */
const DEFAULT_ROOM_FLOOR = -100_000_000;

function ownerFloor(ownerType: OwnerType): number | null {
  if (ownerType === 'PLATFORM') return platformFloor();
  if (ownerType === 'AGENT') {
    const raw = Number(process.env.AGENT_BALANCE_FLOOR);
    return Number.isFinite(raw) ? raw : DEFAULT_AGENT_FLOOR;
  }
  if (ownerType === 'ROOM') {
    const raw = Number(process.env.ROOM_BALANCE_FLOOR);
    return Number.isFinite(raw) ? raw : DEFAULT_ROOM_FLOOR;
  }
  return 0;
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
   * 多账户同事务时先按 ownerId 排序加行锁，再改余额。
   * 用于「代理扣真分 + 玩家加全额」等金额不对称、无法单笔 transferInTx 的场景，
   * 避免与反向转账（如下分）互相等待。
   */
  async lockOwnersInTx(
    tx: Prisma.TransactionClient,
    owners: Array<{ type: OwnerType; id: string }>,
  ) {
    const uniq = new Map<string, OwnerType>();
    for (const o of owners) {
      if (!o.id) continue;
      uniq.set(o.id, o.type);
    }
    const sorted = [...uniq.entries()].sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
    for (const [ownerId, ownerType] of sorted) {
      await tx.pointsAccount.upsert({
        where: { ownerId },
        update: {},
        create: { ownerType: ownerType as never, ownerId },
      });
      await tx.$queryRaw`SELECT id FROM "PointsAccount" WHERE "ownerId" = ${ownerId} FOR UPDATE`;
    }
  }

  /**
   * 事务内转账：自动保证「PLATFORM/ROOM 侧先加锁」，其余按 ownerId 排序。
   * 两侧幂等键独立传入，便于沿用各引擎既有的键命名。
   */
  async transferInTx(
    tx: Prisma.TransactionClient,
    from: { type: OwnerType; id: string; idempotencyKey?: string; remark?: string },
    to: { type: OwnerType; id: string; idempotencyKey?: string; remark?: string },
    amount: number,
    opts: LedgerOpts & { bizType: BizType; bizTypeIn?: BizType } = { bizType: 'ADJUST' },
  ) {
    amount = roundMoney(amount);
    if (amount <= 0) throw new BadRequestException('转账金额必须 > 0');
    const bizOut = opts.bizType;
    const bizIn = opts.bizTypeIn ?? opts.bizType;
    const debit = () =>
      this.creditInTx(tx, from.type, from.id, -amount, bizOut, {
        ...opts,
        remark: from.remark ?? opts.remark,
        idempotencyKey: from.idempotencyKey,
      });
    const credit = () =>
      this.creditInTx(tx, to.type, to.id, amount, bizIn, {
        ...opts,
        remark: to.remark ?? opts.remark,
        idempotencyKey: to.idempotencyKey,
      });

    // 公共池（PLATFORM/ROOM）先行，避免与派彩对锁
    const poolFirst = (t: OwnerType) => t === 'PLATFORM' || t === 'ROOM';
    if (poolFirst(from.type)) return { out: await debit(), in: await credit() };
    if (poolFirst(to.type)) {
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
    amount = roundMoney(amount);
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
    amount = roundMoney(amount);
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

    // 原子增减（UPDATE 自带行锁）；扣款时把下限写进 WHERE。
    const floor = ownerFloor(ownerType);
    const amountSql = new Prisma.Decimal(amount.toFixed(2));
    const floorSql = new Prisma.Decimal(roundMoney(floor ?? 0).toFixed(2));
    const guard =
      amount < 0 && floor != null
        ? Prisma.sql`AND "balance" + ${amountSql} >= ${floorSql}`
        : Prisma.empty;
    const rows = await tx.$queryRaw<{ balance: unknown }[]>`
      UPDATE "PointsAccount"
      SET "balance" = "balance" + ${amountSql}, "updatedAt" = NOW()
      WHERE "id" = ${account.id}
        ${guard}
      RETURNING "balance"
    `;
    if (rows.length === 0) {
      if (ownerType === 'PLATFORM' || ownerType === 'ROOM' || ownerType === 'AGENT') {
        throw new BadRequestException(
          `${ownerType} 账户已触及下限 ${floor}，本次变动被拒绝`,
        );
      }
      throw new BadRequestException(`账户余额不足：${ownerType}/${ownerId}`);
    }
    const newBalance = asMoney(rows[0].balance);

    return tx.pointsLedger.create({
      data: {
        accountId: account.id,
        bizType: bizType as never,
        amount: amountSql,
        balanceAfter: new Prisma.Decimal(newBalance.toFixed(2)),
        refType: opts.refType,
        refId: opts.refId,
        remark: opts.remark,
        operatorId: opts.operatorId,
        idempotencyKey: opts.idempotencyKey,
      },
    });
  }

  /** 标准转账：A 扣，B 加，同事务两条流水（加锁顺序与 transferInTx 一致） */
  async transfer(
    from: { type: OwnerType; id: string },
    to: { type: OwnerType; id: string },
    amount: number,
    opts: LedgerOpts & { bizTypeOut?: BizType; bizTypeIn?: BizType } = {},
  ) {
    amount = roundMoney(amount);
    if (amount <= 0) throw new BadRequestException('转账金额必须 > 0');
    if (from.id === to.id) throw new BadRequestException('不能转给自己');
    const bizOut = opts.bizTypeOut ?? 'TRANSFER_OUT';
    const bizIn = opts.bizTypeIn ?? 'TRANSFER_IN';
    return this.prisma.$transaction(async (tx) => {
      const outKey = opts.idempotencyKey ? `${opts.idempotencyKey}:OUT` : undefined;
      const inKey = opts.idempotencyKey ? `${opts.idempotencyKey}:IN` : undefined;
      return this.transferInTx(
        tx,
        { type: from.type, id: from.id, idempotencyKey: outKey, remark: opts.remark },
        { type: to.type, id: to.id, idempotencyKey: inKey, remark: opts.remark },
        amount,
        { ...opts, bizType: bizOut, bizTypeIn: bizIn },
      );
    });
  }
}
