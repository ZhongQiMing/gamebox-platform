import { randomUUID } from 'node:crypto';
import type { Prisma, PrismaClient } from '@prisma/client';
import { TableService } from '../src/modules/table/table.service';
import { createTestPrisma, makeUser } from './db/money-test-kit';

let prisma: PrismaClient;

beforeAll(() => {
  prisma = createTestPrisma();
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe('牌桌首局并发创建', () => {
  it('ON CONFLICT 后同一事务仍可继续查询，所有请求取得同一 PLAYING 局', async () => {
    const suffix = randomUUID().slice(0, 8);
    const game = await prisma.game.create({
      data: {
        code: `table-race-${suffix}`,
        name: `牌桌并发测试${suffix}`,
        category: 'TABLE',
        status: 'ONLINE',
      },
    });
    const roundNo = `TABLE-RACE-${suffix}`;
    const service = new TableService(
      prisma as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );
    const ensure = (
      service as unknown as {
        ensurePlayingRoundInTx: (
          tx: Prisma.TransactionClient,
          room: { roundNo: string; gameId: string; serverSeedHash: string },
        ) => Promise<string>;
      }
    ).ensurePlayingRoundInTx.bind(service);

    try {
      const ids = await Promise.all(
        Array.from({ length: 8 }, () =>
          prisma.$transaction(async (tx) => {
            const id = await ensure(tx, {
              roundNo,
              gameId: game.id,
              serverSeedHash: `hash-${suffix}`,
            });
            await tx.$queryRaw`SELECT 1`;
            return id;
          }),
        ),
      );
      expect(new Set(ids).size).toBe(1);
      expect(await prisma.gameRound.count({ where: { roundNo } })).toBe(1);
    } finally {
      await prisma.gameRound.deleteMany({ where: { roundNo } });
      await prisma.game.delete({ where: { id: game.id } });
    }
  });

  it('真实 PostgreSQL 聚合会合并龙虎大小写历史注单且不跨方向', async () => {
    const suffix = randomUUID().slice(0, 8);
    const playerId = await makeUser(prisma);
    const game = await prisma.game.create({
      data: {
        code: `table-alias-${suffix}`,
        name: `牌桌别名测试${suffix}`,
        category: 'TABLE',
        status: 'ONLINE',
      },
    });
    const round = await prisma.gameRound.create({
      data: {
        roundNo: `TABLE-ALIAS-${suffix}`,
        gameId: game.id,
        category: 'TABLE',
        state: 'PLAYING',
      },
    });
    await prisma.bet.createMany({
      data: [
        {
          betNo: `alias-lower-${suffix}`,
          playerId,
          gameId: game.id,
          roundId: round.id,
          betType: 'dragon',
          amount: 120,
          status: 'PENDING',
        },
        {
          betNo: `alias-upper-${suffix}`,
          playerId,
          gameId: game.id,
          roundId: round.id,
          betType: 'DRAGON',
          amount: 80,
          status: 'PENDING',
        },
        {
          betNo: `alias-other-${suffix}`,
          playerId,
          gameId: game.id,
          roundId: round.id,
          betType: 'TIGER',
          amount: 900,
          status: 'PENDING',
        },
      ],
    });
    const service = new TableService(
      prisma as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );
    const exposure = (
      service as unknown as {
        pendingSideExposureInTx: (
          tx: Prisma.TransactionClient,
          gameCode: string,
          roundId: string,
          side: string,
          playerId?: string,
        ) => Promise<number>;
      }
    ).pendingSideExposureInTx.bind(service);

    try {
      const [platformTotal, playerTotal] = await prisma.$transaction(async (tx) => [
        await exposure(tx, 'dragon-tiger', round.id, 'dragon'),
        await exposure(tx, 'dragon-tiger', round.id, 'DRAGON', playerId),
      ]);
      expect(platformTotal).toBe(200);
      expect(playerTotal).toBe(200);
    } finally {
      await prisma.bet.deleteMany({ where: { roundId: round.id } });
      await prisma.gameRound.delete({ where: { id: round.id } });
      await prisma.game.delete({ where: { id: game.id } });
      await prisma.user.delete({ where: { id: playerId } });
    }
  });
});
