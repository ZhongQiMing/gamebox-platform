/**
 * 信用盘资金口径（结账用）：
 *   合计 = 剩余额度 + 玩家余额 + 客服额度
 *   超出 = 合计 − 合同信用额度
 *   超出>0：平台亏，补给代理 超出×(1−占成)
 *   超出<0：平台赚，代理上缴 |超出|×(1−占成)
 *   结后额度 = 合同额度 − 玩家余额 − 客服额度（可为负）
 *   实付另轧「佣金账户」后清零（见 room-settle netCreditSettlePay）
 *
 * 客服额度是从剩余信用划出的一块，必须计入合计，否则一划额合计就假跌。
 */
import { asMoney, roundMoney } from '@gamebox/shared';
import type { Prisma, PrismaClient } from '@prisma/client';

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
  platformShareAmount: number;
  /** 平台应付代理（可负：负=代理应付平台）= excess × (1−占成) */
  platformPayToAgent: number;
  /** 结账后应写入的剩余额度 */
  newQuota: number;
};

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
}): CreditBookSnapshot {
  const creditLimit = roundMoney(Math.max(0, Number(opts.creditLimit) || 0));
  const pointsQuota = roundMoney(Number(opts.pointsQuota) || 0);
  const playerBalances = roundMoney(Math.max(0, Number(opts.playerBalances) || 0));
  const csBalances = roundMoney(Math.max(0, Number(opts.csBalances) || 0));
  const agentShareRate = clampShareRate(Number(opts.agentShareRate) || 0);
  const sum = roundMoney(pointsQuota + playerBalances + csBalances);
  const excess = roundMoney(sum - creditLimit);
  const housePnl = roundMoney(-excess);
  const agentShareAmount = roundMoney(housePnl * agentShareRate);
  const platformShareAmount = roundMoney(housePnl - agentShareAmount);
  const platformPayToAgent = roundMoney(-platformShareAmount);
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
    platformShareAmount,
    platformPayToAgent,
    newQuota,
  };
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

/**
 * 现金盘上盘可飞（代理桌 + 客服桌未发出）：
 * 划给客服只是分桌，同一笔买来的盘分仍算在池里。负数盘分按 0 计可飞。
 */
export async function cashDiskFlyAvailable(
  tx: DbClient,
  agentUserId: string | undefined | null,
): Promise<number> {
  if (!agentUserId) return 0;
  const acc = await tx.pointsAccount.findFirst({
    where: { ownerType: 'AGENT', ownerId: agentUserId, roomId: '' },
    select: { balance: true },
  });
  const agentBal = asMoney(acc?.balance ?? 0);
  const csBal = await sumAgentCsBalances(tx, agentUserId);
  return roundMoney(Math.max(0, agentBal) + Math.max(0, csBal));
}

/**
 * 信用盘可飞：剩余信用(pointsQuota) + 客服未发出；负数按 0。
 * 与现金同一套「盘分不够本注 → 本注关盘坐庄」。
 */
export async function creditDiskFlyAvailable(
  tx: DbClient,
  agentUserId: string | undefined | null,
): Promise<number> {
  if (!agentUserId) return 0;
  const agent = await tx.agent.findUnique({
    where: { userId: agentUserId },
    select: { pointsQuota: true },
  });
  const quota = asMoney(agent?.pointsQuota ?? 0);
  const csBal = await sumAgentCsBalances(tx, agentUserId);
  return roundMoney(Math.max(0, quota) + Math.max(0, csBal));
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
