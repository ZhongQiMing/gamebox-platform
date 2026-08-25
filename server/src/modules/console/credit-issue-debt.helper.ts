/**
 * 信用盘上分欠款。
 *
 * 开房/上分先记账。每周结账不冲这笔往来；人不干了走下分/收回额度时再减 remaining。
 * 占成跟现金同一套，不要用占成去轧欠款。
 */
import { Prisma } from '@prisma/client';
import type { PrismaClient } from '@prisma/client';
import { asMoney, roundMoney } from '@gamebox/shared';

type DbClient = Prisma.TransactionClient | PrismaClient;

export type CreditCreditorKind = 'PLATFORM' | 'GENERAL';

export type CreditDebtFilter = {
  debtorUserId: string;
  creditorKind: CreditCreditorKind;
  creditorUserId?: string | null;
  /** 有房间就按房；平台给总代上分不传 */
  roomId?: string | null;
  /** 下分冲欠时不按房切开，同一上家对同一下家一起减 */
  anyRoom?: boolean;
};

/**
 * 下分冲欠：按金额与 remaining 取小。每周结账不要拿占成来调这个。
 * 这是「一笔钱能冲掉多少欠款」的唯一实现，consumeCreditIssueDebtInTx 逐笔冲抵时也走它。
 */
export function creditDebtConsumeAmount(sharePay: number, unsettledDebt: number): number {
  const pay = asMoney(sharePay);
  const debt = Math.max(0, asMoney(unsettledDebt));
  if (pay <= 0 || debt <= 0) return 0;
  return roundMoney(Math.min(pay, debt));
}

/** 房间单：总代→代理或平台→直挂代理 */
export function roomCreditDebtFilter(opts: {
  agentUserId: string;
  generalUserId?: string | null;
  roomId: string;
}): CreditDebtFilter {
  if (opts.generalUserId) {
    return {
      debtorUserId: opts.agentUserId,
      creditorKind: 'GENERAL',
      creditorUserId: opts.generalUserId,
      roomId: opts.roomId,
    };
  }
  return {
    debtorUserId: opts.agentUserId,
    creditorKind: 'PLATFORM',
    roomId: opts.roomId,
  };
}

/** 总表：平台给信用总代的上分，不按房间切 */
export function platformGeneralDebtFilter(generalUserId: string): CreditDebtFilter {
  return {
    debtorUserId: generalUserId,
    creditorKind: 'PLATFORM',
    roomId: null,
  };
}

export async function recordCreditIssueDebtInTx(
  tx: DbClient,
  opts: CreditDebtFilter & {
    amount: number;
    idempotencyKey: string;
    remark?: string;
    refType?: string;
    refId?: string;
  },
) {
  const amount = asMoney(opts.amount);
  if (!(amount > 0)) return { id: null as string | null, replayed: false };
  const existed = await tx.creditIssueDebt.findUnique({
    where: { idempotencyKey: opts.idempotencyKey },
    select: { id: true },
  });
  if (existed) return { id: existed.id, replayed: true };
  const row = await tx.creditIssueDebt.create({
    data: {
      debtorUserId: opts.debtorUserId,
      creditorKind: opts.creditorKind,
      creditorUserId: opts.creditorKind === 'GENERAL' ? opts.creditorUserId || null : null,
      roomId: opts.roomId || null,
      amount: new Prisma.Decimal(amount.toFixed(2)),
      remaining: new Prisma.Decimal(amount.toFixed(2)),
      remark: opts.remark ?? null,
      refType: opts.refType ?? null,
      refId: opts.refId ?? null,
      idempotencyKey: opts.idempotencyKey,
    },
    select: { id: true },
  });
  return { id: row.id, replayed: false };
}

export async function sumUnsettledCreditDebt(tx: DbClient, filter: CreditDebtFilter) {
  const rows = await tx.creditIssueDebt.aggregate({
    where: unsettledWhere(filter),
    _sum: { remaining: true },
  });
  return asMoney(rows._sum.remaining ?? 0);
}

/**
 * 下分/收回额度冲欠：按时间从早到晚减 remaining。每周结账不走这里。
 * 返回实际冲掉的金额。
 */
export async function consumeCreditIssueDebtInTx(
  tx: DbClient,
  filter: CreditDebtFilter,
  consumeRaw: number,
) {
  let left = Math.max(0, asMoney(consumeRaw));
  if (left <= 0) return 0;
  const rows = await tx.creditIssueDebt.findMany({
    where: unsettledWhere(filter),
    orderBy: { createdAt: 'asc' },
    select: { id: true, remaining: true },
  });
  let used = 0;
  for (const row of rows) {
    if (left <= 0) break;
    const remain = asMoney(row.remaining);
    if (remain <= 0) continue;
    const take = creditDebtConsumeAmount(left, remain);
    if (take <= 0) continue;
    await tx.creditIssueDebt.update({
      where: { id: row.id },
      data: { remaining: new Prisma.Decimal(roundMoney(remain - take).toFixed(2)) },
    });
    left = roundMoney(left - take);
    used = roundMoney(used + take);
  }
  return used;
}

function unsettledWhere(filter: CreditDebtFilter): Prisma.CreditIssueDebtWhereInput {
  return {
    debtorUserId: filter.debtorUserId,
    creditorKind: filter.creditorKind,
    creditorUserId:
      filter.creditorKind === 'GENERAL' ? filter.creditorUserId || undefined : null,
    remaining: { gt: 0 },
    ...(filter.anyRoom
      ? {}
      : filter.roomId
        ? { roomId: filter.roomId }
        : { roomId: null }),
  };
}
