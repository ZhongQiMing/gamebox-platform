/**
 * 信用盘资金口径（结账用）：
 *   合计 = 剩余额度 + 玩家余额 + 客服额度
 *   超出 = 合计 − 合同信用额度
 *   超出>0：平台亏，补给代理 超出×(1−占成)
 *   超出<0：平台赚，代理上缴 |超出|×(1−占成)
 *   结后额度 = 合同额度 − 玩家余额 − 客服额度（可为负）
 *   日常盘分与现金盘同一本（余额=额度）。结账占成按飞盘注单，方向相反；
 *   整包日常先记进盘分，结账抽走改走交割，避免额度滚存。
 *
 * 挂总代的房再按文档口径拆出成数差：总代 = 庄家盈亏 ×（总代成数 − 代理成数）。
 * 这一份是从代理上缴的那一截里分出去的，由总代与平台在总代账期交割，
 * 代理自己的交割额不受总代成数影响。
 *
 * 客服额度是从剩余信用划出的一块，必须计入合计，否则一划额合计就假跌。
 */
import { asMoney, roundMoney } from '@gamebox/shared';
import { Prisma } from '@prisma/client';
import type { PrismaClient } from '@prisma/client';

type DbClient = Prisma.TransactionClient | PrismaClient;

export type CreditBookSnapshot = {
  creditLimit: number;
  pointsQuota: number;
  playerBalances: number;
  /** 该房主代理名下客服额度合计 */
  csBalances: number;
  sum: number;
  /** 合计 − 合同额度；>0 平台亏，<0 平台赚 */
  excess: number;
  /** 庄家视角 = −excess */
  housePnl: number;
  agentShareRate: number;
  agentShareAmount: number;
  /** 实际生效的总代成数；未挂总代时等于代理成数 */
  generalShareRate: number;
  /** 总代成数差 = 庄家盈亏 ×（总代成数 − 代理成数），由总代与平台交割 */
  generalShareAmount: number;
  platformShareAmount: number;
  /** 平台应付代理（可负：负=代理应付平台）= excess × (1−占成) */
  platformPayToAgent: number;
  /** 结账后应写入的剩余额度 */
  newQuota: number;
};

/**
 * 信用盘补盘分：飞盘庄家盈亏补回，同时把本期整包净额从盘分抽走。
 * 不抽的话每期都会在额度里留一点，盘分会越滚越多。
 */
export function creditDiskRecycle(housePnl: number, flyRebateToAgent = 0): number {
  return roundMoney(Number(housePnl) - Math.max(0, Number(flyRebateToAgent) || 0));
}

/**
 * 信用盘实付（上家→代理，可负）= 飞盘上缴 + 已进盘代理佣金。
 * 整包日常先记进盘分，结账加回交割，额度另加回合同。
 */
export function netCreditSettlePay(grossPay: number, agentCommission = 0): number {
  return roundMoney(Number(grossPay) + Math.max(0, Number(agentCommission) || 0));
}

/**
 * 结账才把可飞加回合同。正=充额度，负=扣额度。
 * 结账前涨出来的那截可以飞，这里不能提前扣。
 */
export function creditQuotaRestoreDelta(opts: {
  creditLimit: number;
  pointsQuota: number;
  playerBalances: number;
  csBalances?: number;
}): number {
  const fly = roundMoney(
    asMoney(opts.pointsQuota) +
      Math.max(0, asMoney(opts.playerBalances)) +
      Math.max(0, asMoney(opts.csBalances)),
  );
  return roundMoney(asMoney(opts.creditLimit) - fly);
}

/**
 * 信用房间单：上家应付代理。
 * 飞上台上缴「庄家盈亏 − 代理占成」，再加回已进盘的代理佣金。
 */
export function creditFlownSettlePay(
  housePnl: number,
  agentShareAmount: number,
  agentCommission = 0,
): number {
  return roundMoney(
    asMoney(agentShareAmount) - asMoney(housePnl) + Math.max(0, asMoney(agentCommission)),
  );
}

/**
 * 总表这一间信用房：对方应付平台 = 平台占成 − 已发代理佣金。
 * 现金房不能走这条，钱已经在平台账上。
 */
export function creditRoomPayToPlatform(
  platformShareAmount: number,
  agentCommission = 0,
): number {
  return roundMoney(asMoney(platformShareAmount) - Math.max(0, asMoney(agentCommission)));
}

export function clampShareRate(rate: number): number {
  if (!Number.isFinite(rate)) return 0;
  return Math.min(1, Math.max(0, rate));
}

export function computeCreditBook(opts: {
  creditLimit: number;
  pointsQuota: number;
  playerBalances: number;
  csBalances?: number;
  agentShareRate: number;
  /** 房间挂靠总代的成数；不挂总代传 null/undefined */
  generalShareRate?: number | null;
}): CreditBookSnapshot {
  const creditLimit = roundMoney(Math.max(0, Number(opts.creditLimit) || 0));
  const pointsQuota = roundMoney(Number(opts.pointsQuota) || 0);
  const playerBalances = roundMoney(Math.max(0, Number(opts.playerBalances) || 0));
  const csBalances = roundMoney(Math.max(0, Number(opts.csBalances) || 0));
  const agentShareRate = clampShareRate(Number(opts.agentShareRate) || 0);
  /* 总代成数被改到低于代理时成数差会变负、等于总代倒贴，按代理成数兜住（与现金盘同一规则） */
  const generalShareRate =
    opts.generalShareRate == null
      ? agentShareRate
      : Math.min(1, Math.max(agentShareRate, Number(opts.generalShareRate) || 0));
  const sum = roundMoney(pointsQuota + playerBalances + csBalances);
  const excess = roundMoney(sum - creditLimit);
  const housePnl = roundMoney(-excess);
  const agentShareAmount = roundMoney(housePnl * agentShareRate);
  const generalShareAmount = roundMoney(housePnl * (generalShareRate - agentShareRate));
  const platformShareAmount = roundMoney(housePnl - agentShareAmount - generalShareAmount);
  /*
   * 代理与上家的交割额只跟自己的成数有关，不受总代成数影响：
   * 总代那一份是从「代理上缴的那一截」里再分出去的，由总代与平台在总代账期交割，
   * 所以这里必须用 housePnl − 代理占成，而不是收缩后的平台那一份。
   */
  const agentPayBase = roundMoney(housePnl - agentShareAmount);
  const platformPayToAgent = roundMoney(-agentPayBase);
  const newQuota = roundMoney(creditLimit - playerBalances - csBalances);
  return {
    creditLimit,
    pointsQuota,
    playerBalances,
    csBalances,
    sum,
    excess,
    housePnl,
    agentShareRate,
    agentShareAmount,
    generalShareRate,
    generalShareAmount,
    platformShareAmount,
    platformPayToAgent,
    newQuota,
  };
}

/**
 * 对外统一口径的「代理余额」——两盘都是盘分余额。
 * 日常记账余额与额度同步；取余额即可。
 */
export function agentDisplayBalance(opts: {
  bookMode?: 'CASH' | 'CREDIT' | null;
  balance: number;
  pointsQuota?: number;
}): number {
  return roundMoney(Number(opts.balance) || 0);
}

/** 盘分库存：余额与额度取更紧的那一侧（同步时相等；未并账的旧数据不会把两边相加） */
export function agentWorkingDisk(balance: number, pointsQuota: number): number {
  return roundMoney(Math.min(Number(balance) || 0, Number(pointsQuota) || 0));
}

/** 本房 APPROVED 玩家积分合计 */
export async function sumRoomPlayerBalances(
  tx: DbClient,
  roomId: string,
): Promise<number> {
  const members = await tx.roomMember.findMany({
    where: { roomId, status: 'APPROVED' },
    select: { playerId: true },
  });
  const ids = members.map((m) => m.playerId);
  if (!ids.length) return 0;
  const accs = await tx.pointsAccount.findMany({
    where: { ownerId: { in: ids }, ownerType: 'PLAYER', roomId },
    select: { balance: true },
  });
  let sum = 0;
  for (const a of accs) sum += asMoney(a.balance);
  return roundMoney(Math.max(0, sum));
}

/** 主代理名下客服额度合计 */
export async function sumAgentCsBalances(
  tx: DbClient,
  agentUserId: string | undefined | null,
): Promise<number> {
  if (!agentUserId) return 0;
  const staff = await tx.user.findMany({
    where: { parentId: agentUserId, role: 'CS' },
    select: { id: true },
  });
  const ids = staff.map((s) => s.id);
  if (!ids.length) return 0;
  const accs = await tx.pointsAccount.findMany({
    where: { ownerId: { in: ids }, ownerType: 'CS' },
    select: { balance: true },
  });
  let sum = 0;
  for (const a of accs) sum += asMoney(a.balance);
  return roundMoney(Math.max(0, sum));
}

/** 该代理名下所有房间的玩家持分合计（口径与 sumRoomPlayerBalances 一致：只算 APPROVED） */
export async function sumAgentRoomPlayerBalances(
  tx: DbClient,
  agentUserId: string | undefined | null,
): Promise<number> {
  if (!agentUserId) return 0;
  const rows = await tx.$queryRaw<{ s: unknown }[]>`
    SELECT COALESCE(SUM(a."balance"), 0) AS s
    FROM "PointsAccount" a
    JOIN "RoomMember" m
      ON m."playerId" = a."ownerId"
     AND m."roomId"   = a."roomId"
     AND m."status"   = 'APPROVED'
    JOIN "Room" r  ON r."id" = m."roomId"
    JOIN "Agent" ag ON ag."id" = r."ownerAgentId"
    WHERE a."ownerType" = 'PLAYER'
      AND ag."userId" = ${agentUserId}
  `;
  return roundMoney(Math.max(0, asMoney(rows[0]?.s ?? 0)));
}

/**
 * 上盘可飞额度 —— 平台一共替这个代理体系保管着多少分。
 *
 *   可飞 = 代理盘分 + 客服未发出 + 名下房间玩家持分合计
 *
 * 这个数的物理意义是「有多少真钱进了系统」，所以它天然给出正确的行为：
 *
 *   上分/下分     分只在代理与玩家之间挪，两边一增一减 → 额度不变
 *   关盘输赢      钱只在代理与玩家之间挪              → 额度不变
 *   飞盘玩家输    分交给平台，系统里少了              → 额度减少
 *   飞盘玩家赢    平台掏分给玩家，系统里多了          → 额度增加
 *   代理买分/提现  → 额度增/减
 *
 * 归零就说明这个体系里一分真钱都没有了，自然没什么可飞的，只能关盘坐庄。
 *
 * ── 为什么代理盘分这一项不能夹在 0 以上 ──
 *
 * 超发时盘分是负的，而那个负数正是「发出去但没付钱」的部分，必须参与相减：
 *   代理垫 20 万、发给玩家 100 万 → 盘分 −80 万 + 玩家 100 万 = 20 万（正好是他真交的钱）
 * 若把 −80 万夹成 0，就会算出 100 万，等于把超发的假分也当成平台该挡的风险。
 * 只有最终结果才夹 0。
 *
 * 盘分取 min(余额, 上盘额度)：两盘日常都同步动这两个数，取谁都一样。
 * 未并账的旧信用数据若两边还对不上，取更紧的一侧，避免把佣金袋和剩余信用加两遍。
 */
export async function agentFlyAvailable(
  tx: DbClient,
  agentUserId: string | undefined | null,
  bookMode: 'CASH' | 'CREDIT',
): Promise<number> {
  if (!agentUserId) return 0;
  const [acc, agent] = await Promise.all([
    tx.pointsAccount.findFirst({
      where: { ownerType: 'AGENT', ownerId: agentUserId, roomId: '' },
      select: { balance: true },
    }),
    tx.agent.findUnique({
      where: { userId: agentUserId },
      select: { pointsQuota: true },
    }),
  ]);
  const quota = asMoney(agent?.pointsQuota ?? 0);
  const balance = asMoney(acc?.balance ?? 0);
  const disk = agentWorkingDisk(balance, quota);
  const [csBal, playerBal] = await Promise.all([
    sumAgentCsBalances(tx, agentUserId),
    sumAgentRoomPlayerBalances(tx, agentUserId),
  ]);
  return roundMoney(Math.max(0, disk + csBal + playerBal));
}

/**
 * 整棵总代树的可飞额度 = 总代那一支 + 名下所有代理那一支，之和。
 *
 * 为什么平台还要看这个：平台面对的是总代，不是单个代理。总代一旦超发
 * （赔出去的钱超过他手上有的，盘分变负），某个代理那一支的数字会被抬高，
 * 但那部分分**没有真钱背书**——玩家输了平台收到的是白纸，玩家赢了平台要掏真金白银。
 * 所以平台当庄的上限是这棵树里实际有多少钱，而不是某一支的数字。
 *
 * 两个盘种是**各自独立**的，不能用同一个：
 *   总代那一格  → 用 Agent.bookMode（总代与平台的约定）
 *   每个代理那一支 → 用 Room.bookMode（代理与总代的约定，各房可以不同）
 * 平台只跟总代对接，总代怎么跟下面谈是他的事，所以一棵树里现金房信用房可以混着。
 *
 * 与单支口径的另一个差别：这里**不能逐支夹 0**。某一支为负正是「超发未付钱」，
 * 必须参与相减，只有最终结果才夹 0。
 */
export async function generalTreeFlyAvailable(
  tx: DbClient,
  generalUserId: string | undefined | null,
): Promise<number> {
  if (!generalUserId) return 0;
  const rows = await tx.$queryRaw<{ total: unknown }[]>`
    WITH g AS (
      SELECT ag."id" AS agent_id, ag."userId" AS user_id, ag."pointsQuota" AS quota,
             ag."bookMode" AS book_mode
      FROM "Agent" ag
      WHERE ag."userId" = ${generalUserId}
    ),
    members AS (
      /* 总代自己：盘种取他与平台的约定 */
      SELECT agent_id, user_id, quota, book_mode FROM g
      UNION
      /*
       * 名下代理：盘种取该房间的约定。一个代理可能有多间房挂同一个总代，
       * 理论上盘种还可能不同；取 CREDIT 优先。
       */
      SELECT a."id", a."userId", a."pointsQuota",
             CASE WHEN BOOL_OR(r."bookMode" = 'CREDIT') THEN 'CREDIT' ELSE 'CASH' END
      FROM "Room" r
      JOIN g ON g.agent_id = r."generalAgentId"
      JOIN "Agent" a ON a."id" = r."ownerAgentId"
      GROUP BY a."id", a."userId", a."pointsQuota"
    ),
    disks AS (
      SELECT LEAST(COALESCE(pa."balance", 0), m.quota) AS d
      FROM members m
      LEFT JOIN "PointsAccount" pa
        ON pa."ownerType" = 'AGENT' AND pa."ownerId" = m.user_id AND pa."roomId" = ''
    ),
    players AS (
      SELECT COALESCE(SUM(pa."balance"), 0) AS s
      FROM "PointsAccount" pa
      JOIN "RoomMember" mb
        ON mb."playerId" = pa."ownerId" AND mb."roomId" = pa."roomId" AND mb."status" = 'APPROVED'
      JOIN "Room" r ON r."id" = mb."roomId"
      JOIN g ON g.agent_id = r."generalAgentId"
      WHERE pa."ownerType" = 'PLAYER'
    ),
    cs AS (
      SELECT COALESCE(SUM(pa."balance"), 0) AS s
      FROM "PointsAccount" pa
      JOIN "User" u ON u."id" = pa."ownerId" AND u."role" = 'CS'
      WHERE pa."ownerType" = 'CS'
        AND u."parentId" IN (SELECT user_id FROM members)
    )
    SELECT COALESCE((SELECT SUM(d) FROM disks), 0)
         + (SELECT s FROM players)
         + (SELECT s FROM cs) AS total
  `;
  return roundMoney(Math.max(0, asMoney(rows[0]?.total ?? 0)));
}

/**
 * 总代名下「房间余额」= 各代理房间那一支之和（代理盘分 + 客服 + 该房玩家），
 * 不含总代自己还没划下去的那一格。
 *
 * 不夹 0：某一房代理手上是负数，就是他还欠的钱，顶栏必须露出来。
 */
export async function generalRoomBalance(
  tx: DbClient,
  generalUserId: string | undefined | null,
): Promise<number> {
  if (!generalUserId) return 0;
  const rows = await tx.$queryRaw<{ total: unknown }[]>`
    WITH g AS (
      SELECT ag."id" AS agent_id
      FROM "Agent" ag
      WHERE ag."userId" = ${generalUserId}
    ),
    members AS (
      SELECT a."id" AS agent_id, a."userId" AS user_id, a."pointsQuota" AS quota,
             CASE WHEN BOOL_OR(r."bookMode" = 'CREDIT') THEN 'CREDIT' ELSE 'CASH' END AS book_mode
      FROM "Room" r
      JOIN g ON g.agent_id = r."generalAgentId"
      JOIN "Agent" a ON a."id" = r."ownerAgentId"
      GROUP BY a."id", a."userId", a."pointsQuota"
    ),
    disks AS (
      SELECT LEAST(COALESCE(pa."balance", 0), m.quota) AS d
      FROM members m
      LEFT JOIN "PointsAccount" pa
        ON pa."ownerType" = 'AGENT' AND pa."ownerId" = m.user_id AND pa."roomId" = ''
    ),
    players AS (
      SELECT COALESCE(SUM(pa."balance"), 0) AS s
      FROM "PointsAccount" pa
      JOIN "RoomMember" mb
        ON mb."playerId" = pa."ownerId" AND mb."roomId" = pa."roomId" AND mb."status" = 'APPROVED'
      JOIN "Room" r ON r."id" = mb."roomId"
      JOIN g ON g.agent_id = r."generalAgentId"
      WHERE pa."ownerType" = 'PLAYER'
    ),
    cs AS (
      SELECT COALESCE(SUM(pa."balance"), 0) AS s
      FROM "PointsAccount" pa
      JOIN "User" u ON u."id" = pa."ownerId" AND u."role" = 'CS'
      WHERE pa."ownerType" = 'CS'
        AND u."parentId" IN (SELECT user_id FROM members)
    )
    SELECT COALESCE((SELECT SUM(d) FROM disks), 0)
         + (SELECT s FROM players)
         + (SELECT s FROM cs) AS total
  `;
  return roundMoney(asMoney(rows[0]?.total ?? 0));
}

/** 批量：多个主代理名下房间的玩家持分合计（列表页用，避免逐个代理查） */
export async function sumAgentRoomPlayerBalancesMap(
  tx: DbClient,
  agentUserIds: string[],
): Promise<Map<string, number>> {
  const map = new Map<string, number>();
  const ids = [...new Set(agentUserIds.filter(Boolean))];
  for (const id of ids) map.set(id, 0);
  if (!ids.length) return map;
  const rows = await tx.$queryRaw<{ uid: string; s: unknown }[]>`
    SELECT ag."userId" AS uid, COALESCE(SUM(a."balance"), 0) AS s
    FROM "PointsAccount" a
    JOIN "RoomMember" m
      ON m."playerId" = a."ownerId"
     AND m."roomId"   = a."roomId"
     AND m."status"   = 'APPROVED'
    JOIN "Room" r   ON r."id" = m."roomId"
    JOIN "Agent" ag ON ag."id" = r."ownerAgentId"
    WHERE a."ownerType" = 'PLAYER'
      AND ag."userId" IN (${Prisma.join(ids)})
    GROUP BY ag."userId"
  `;
  for (const r of rows) map.set(r.uid, roundMoney(Math.max(0, asMoney(r.s))));
  return map;
}

/** 批量：多个主代理的客服额度合计 */
export async function sumAgentCsBalancesMap(
  tx: DbClient,
  agentUserIds: string[],
): Promise<Map<string, number>> {
  const map = new Map<string, number>();
  const ids = [...new Set(agentUserIds.filter(Boolean))];
  for (const id of ids) map.set(id, 0);
  if (!ids.length) return map;
  const staff = await tx.user.findMany({
    where: { parentId: { in: ids }, role: 'CS' },
    select: { id: true, parentId: true },
  });
  if (!staff.length) return map;
  const accs = await tx.pointsAccount.findMany({
    where: { ownerId: { in: staff.map((s) => s.id) }, ownerType: 'CS' },
    select: { ownerId: true, balance: true },
  });
  const balByCs = new Map(accs.map((a) => [a.ownerId, asMoney(a.balance)]));
  for (const s of staff) {
    if (!s.parentId) continue;
    map.set(s.parentId, roundMoney((map.get(s.parentId) ?? 0) + (balByCs.get(s.id) ?? 0)));
  }
  return map;
}
