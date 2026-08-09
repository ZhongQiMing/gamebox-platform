/**
 * 一次性：把历史 ROOM 分桶余额转回平台盘口池，并清零 ROOM 账户。
 * 运行：pnpm --filter @gamebox/server exec ts-node prisma/merge-room-pools-to-platform.ts
 */
import { PrismaClient, Prisma } from '@prisma/client';

const prisma = new PrismaClient();
const PLATFORM_OWNER_ID = 'PLATFORM';

async function main() {
  const rooms = await prisma.pointsAccount.findMany({
    where: { ownerType: 'ROOM' },
    select: { id: true, ownerId: true, balance: true },
  });
  if (!rooms.length) {
    console.log('[merge-room-pools] 无 ROOM 账户，跳过');
    return;
  }

  let moved = 0;
  for (const room of rooms) {
    const bal = new Prisma.Decimal(room.balance);
    if (bal.isZero()) continue;

    const stamp = Date.now();
    await prisma.$transaction(async (tx) => {
      const platform = await tx.pointsAccount.upsert({
        where: { ownerId: PLATFORM_OWNER_ID },
        update: {},
        create: { ownerType: 'PLATFORM', ownerId: PLATFORM_OWNER_ID },
      });

      /* ROOM +bal → PLATFORM；ROOM -bal → 从 PLATFORM 补回后清零 */
      const roomAfter = new Prisma.Decimal(0);
      const platformAfter = new Prisma.Decimal(platform.balance).add(bal);

      await tx.pointsAccount.update({
        where: { id: room.id },
        data: { balance: 0 },
      });
      await tx.pointsAccount.update({
        where: { id: platform.id },
        data: { balance: platformAfter },
      });

      await tx.pointsLedger.create({
        data: {
          accountId: room.id,
          bizType: bal.gt(0) ? 'TRANSFER_OUT' : 'TRANSFER_IN',
          amount: bal.neg(),
          balanceAfter: roomAfter,
          remark: '房间彩池并入平台盘口池',
          refType: 'room_pool_merge',
          refId: room.ownerId,
          idempotencyKey: `room_pool_merge_out_${room.ownerId}_${stamp}`,
        },
      });
      await tx.pointsLedger.create({
        data: {
          accountId: platform.id,
          bizType: bal.gt(0) ? 'TRANSFER_IN' : 'TRANSFER_OUT',
          amount: bal,
          balanceAfter: platformAfter,
          remark: '房间彩池并入平台盘口池',
          refType: 'room_pool_merge',
          refId: room.ownerId,
          idempotencyKey: `room_pool_merge_in_${room.ownerId}_${stamp}`,
        },
      });
    });
    moved += 1;
    console.log(`[merge-room-pools] ${room.ownerId}: ${bal.toString()} → PLATFORM`);
  }
  console.log(`[merge-room-pools] 完成：转回 ${moved} 个非零账户（共扫描 ${rooms.length}）`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
