/**
 * 回填信用房 111113 开房期初欠款：当时从总代划给代理的额度。
 * 只写 CreditIssueDebt，不动现金房 111112，不把玩家上分记成欠款。
 *
 * 跑法：node scripts/backfill-credit-issue-debt-111113.mjs
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const room = await prisma.room.findFirst({
  where: { roomNo: '111113' },
  select: {
    id: true,
    roomNo: true,
    bookMode: true,
    creditLimit: true,
    ownerAgent: { select: { userId: true } },
    generalAgent: { select: { userId: true } },
  },
});

if (!room || room.bookMode !== 'CREDIT' || !room.ownerAgent) {
  console.log('skip: 没有信用房 111113');
  await prisma.$disconnect();
  process.exit(0);
}

const key = `credit_debt:agent_open:${room.ownerAgent.userId}`;
const existed = await prisma.creditIssueDebt.findUnique({
  where: { idempotencyKey: key },
  select: { id: true, amount: true, remaining: true },
});
if (existed) {
  console.log(`already: ${existed.id} amount=${existed.amount} remaining=${existed.remaining}`);
  await prisma.$disconnect();
  process.exit(0);
}

const open = await prisma.agentQuotaLedger.findFirst({
  where: { idempotencyKey: `agent_open:${room.ownerAgent.userId}` },
  select: { delta: true },
});
const amount = Math.round(Number(open?.delta ?? room.creditLimit) * 100) / 100;
if (!(amount > 0)) {
  console.log('skip: 开房额度不是正数');
  await prisma.$disconnect();
  process.exit(0);
}

const row = await prisma.creditIssueDebt.create({
  data: {
    debtorUserId: room.ownerAgent.userId,
    creditorKind: room.generalAgent?.userId ? 'GENERAL' : 'PLATFORM',
    creditorUserId: room.generalAgent?.userId ?? null,
    roomId: room.id,
    amount,
    remaining: amount,
    remark: `回填开房期初额度 ${amount}`,
    refType: 'agent_open',
    refId: room.id,
    idempotencyKey: key,
  },
  select: { id: true, amount: true, remaining: true, creditorKind: true },
});

console.log(
  `ok: room ${room.roomNo} ${row.creditorKind} amount=${row.amount} remaining=${row.remaining} id=${row.id}`,
);
await prisma.$disconnect();
