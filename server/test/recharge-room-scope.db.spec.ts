import type { PrismaClient } from '@prisma/client';
import { ForbiddenException } from '@nestjs/common';
import { RechargeService } from '../src/modules/recharge/recharge.service';
import type { PrismaService } from '../src/prisma/prisma.service';
import {
  createTestPrisma,
  makeUser,
  wipeMoneyTables,
} from './db/money-test-kit';

let prisma: PrismaClient;

beforeAll(async () => {
  prisma = createTestPrisma();
  await wipeMoneyTables(prisma);
});

afterAll(async () => {
  await wipeMoneyTables(prisma);
  await prisma.$disconnect();
});

describe('上下分订单按 roomId 隔离', () => {
  it('旧 agentPath 属于 A 的玩家在 B 房下单后，A 看不到也不能拒绝', async () => {
    const agentAId = await makeUser(prisma, 'AGENT');
    const agentBId = await makeUser(prisma, 'AGENT');
    const playerId = await makeUser(prisma);
    const [agentA, agentB] = await Promise.all([
      prisma.agent.create({ data: { userId: agentAId } }),
      prisma.agent.create({ data: { userId: agentBId } }),
    ]);
    await prisma.user.update({
      where: { id: playerId },
      data: { agentPath: `/${agentAId}/` },
    });
    await prisma.room.create({
      data: {
        id: 'scope-room-a',
        roomNo: '871001',
        name: 'A房',
        ownerAgentId: agentA.id,
      },
    });
    const roomB = await prisma.room.create({
      data: {
        id: 'scope-room-b',
        roomNo: '871002',
        name: 'B房',
        ownerAgentId: agentB.id,
      },
    });
    await prisma.roomMember.create({
      data: { playerId, roomId: roomB.id, status: 'APPROVED' },
    });
    const order = await prisma.rechargeOrder.create({
      data: {
        orderNo: `scope-${Date.now()}`,
        playerId,
        roomId: roomB.id,
        type: 'UP',
        amount: 500,
      },
    });
    const service = new RechargeService(
      prisma as unknown as PrismaService,
      {} as never,
      { logInTx: jest.fn() } as never,
      {} as never,
      {
        assignedPlayerIdsForCs: jest.fn(),
        isAssignedToCs: jest.fn(),
        pushSystemMessage: jest.fn(),
      } as never,
    );

    const pending = await service.pendingOrders(agentAId);
    expect(pending.list).toHaveLength(0);
    await expect(
      service.rejectOrder(order.id, agentAId, '无权限测试'),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(
      await prisma.rechargeOrder.findUniqueOrThrow({
        where: { id: order.id },
        select: { status: true },
      }),
    ).toEqual({ status: 'PENDING' });
  });
});
