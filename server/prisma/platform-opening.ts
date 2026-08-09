/**
 * 平台账户开账流水。
 *
 * 平台那笔初始盘口资金是 seed / wipe 直接写进 balance 的，没有对应流水，
 * 于是「逐账户 SUM(PointsLedger.amount) == balance」这条对账不变量对平台账户
 * 永远差一整个初始额。补一条开账分录后不变量零豁免，对账逻辑里就不必写
 * `WHERE ownerId <> 'PLATFORM'` 这种会连真问题一起放过的补丁。
 */
import type { PrismaClient } from '@prisma/client';

const PLATFORM_OWNER_ID = 'PLATFORM';
const OPENING_KEY = 'platform_opening_balance';

/** 平台账户若有余额却一条流水都没有，补记开账分录。已有流水则不动。 */
export async function writePlatformOpeningLedger(prisma: PrismaClient): Promise<void> {
  const account = await prisma.pointsAccount.findUnique({
    where: {
      ownerType_ownerId_roomId: {
        ownerType: 'PLATFORM',
        ownerId: PLATFORM_OWNER_ID,
        roomId: '',
      },
    },
    select: { id: true, balance: true },
  });
  if (!account) return;

  const existing = await prisma.pointsLedger.count({ where: { accountId: account.id } });
  if (existing > 0) return;
  if (account.balance.isZero()) return;

  await prisma.pointsLedger.create({
    data: {
      accountId: account.id,
      bizType: 'ADJUST',
      amount: account.balance,
      balanceAfter: account.balance,
      refType: 'platform_opening',
      refId: PLATFORM_OWNER_ID,
      remark: '平台盘口池开账',
      idempotencyKey: OPENING_KEY,
    },
  });
  console.log(`[opening] 平台账户开账流水已补记：${account.balance.toString()}`);
}
