import { Prisma } from '@prisma/client';
import type { PrismaService } from '../../prisma/prisma.service';

type SumRow = { action: string; amt: number };

/** 审计页「额度进出」：总监看自己经手的，其他人看别人打给自己的 */
export function quotaSummaryScopeSql(opts: { userId: string; role: string }): Prisma.Sql {
  if (opts.role === 'BRANCH') {
    return Prisma.sql`"operatorId" = ${opts.userId} AND "action" IN ('QUOTA_SELL', 'QUOTA_RECALL')`;
  }
  return Prisma.sql`"target" = ${opts.userId} AND "action" IN ('QUOTA_SELL', 'QUOTA_RECALL')`;
}

/**
 * 资金审计合计：按 action 在库内 SUM(detail.amount)，禁止把 AdminLog 全量拉进内存。
 */
export function fundLogScopeSql(opts: {
  userId: string;
  agentRootId: string;
  staffIds: string[];
  operatorIds: string[];
  role: string;
}): Prisma.Sql {
  const { userId, agentRootId, role } = opts;
  if (role === 'BRANCH') {
    return Prisma.sql`(
      ("action" IN ('QUOTA_SELL', 'QUOTA_RECALL') AND ("target" = ${userId} OR "operatorId" = ${userId}))
      OR ("action" = 'ROOM_CREDIT_LIMIT_BUMP' AND "operatorId" = ${userId})
    )`;
  }
  if (role === 'GENERAL') {
    return Prisma.sql`(
      ("action" IN ('QUOTA_SELL', 'QUOTA_RECALL') AND ("target" = ${userId} OR "operatorId" = ${userId}))
      OR ("action" = 'GENERAL_CREDIT_LIMIT_BUMP' AND "target" = ${userId})
    )`;
  }
  if (role === 'CS') {
    return Prisma.sql`(
      ("action" IN ('CONSOLE_CREDIT', 'CONSOLE_DEBIT') AND "operatorId" = ${userId})
      OR ("action" IN ('CS_STAFF_ALLOC', 'CS_STAFF_RECALL') AND "target" = ${userId})
    )`;
  }
  const ops = (opts.operatorIds.length ? opts.operatorIds : opts.staffIds).filter(Boolean);
  const opSql = ops.length
    ? Prisma.sql`"operatorId" IN (${Prisma.join(ops)})`
    : Prisma.sql`FALSE`;
  return Prisma.sql`(
    ("action" IN ('QUOTA_SELL', 'QUOTA_RECALL') AND "target" = ${userId})
    OR (
      "action" IN ('CONSOLE_CREDIT', 'CONSOLE_DEBIT')
      AND (${opSql} OR "detail"->>'agentUserId' = ${agentRootId})
    )
    OR ("action" IN ('CS_STAFF_ALLOC', 'CS_STAFF_RECALL') AND "operatorId" = ${agentRootId})
  )`;
}

export async function sumAdminLogAmountsByAction(
  prisma: Pick<PrismaService, '$queryRaw'>,
  opts: {
    userId: string;
    agentRootId: string;
    staffIds: string[];
    operatorIds: string[];
    role: string;
    from?: Date | null;
    to?: Date | null;
    actions?: string[] | null;
    scopeSql?: Prisma.Sql;
  },
): Promise<Map<string, number>> {
  const scope = opts.scopeSql ?? fundLogScopeSql(opts);
  const fromSql = opts.from ? Prisma.sql`AND "createdAt" >= ${opts.from}` : Prisma.empty;
  const toSql = opts.to ? Prisma.sql`AND "createdAt" < ${opts.to}` : Prisma.empty;
  const actionSql =
    opts.actions?.length
      ? Prisma.sql`AND "action" IN (${Prisma.join(opts.actions)})`
      : Prisma.empty;
  const rows = await prisma.$queryRaw<SumRow[]>`
    SELECT "action",
           COALESCE(SUM(COALESCE(("detail"->>'amount')::numeric, 0)), 0)::float8 AS amt
    FROM "AdminLog"
    WHERE ${scope}
      ${fromSql}
      ${toSql}
      ${actionSql}
    GROUP BY "action"
  `;
  return new Map(rows.map((r) => [r.action, Number(r.amt) || 0]));
}
