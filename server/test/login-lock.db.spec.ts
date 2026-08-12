import type { PrismaClient } from '@prisma/client';
import { LoginLockService } from '../src/modules/auth/login-lock.service';
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

describe('错密临时退避数据库不变量', () => {
  it('连续错密不会写 loginLockedAt 或递增 tokenVersion', async () => {
    const userId = await makeUser(prisma);
    const before = await prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: {
        username: true,
        loginLockedAt: true,
        tokenVersion: true,
      },
    });
    const counts = new Map<string, number>();
    const redis = {
      consumeFixedWindow: async (key: string) => {
        const next = (counts.get(key) ?? 0) + 1;
        counts.set(key, next);
        return next;
      },
      del: async () => undefined,
    };
    const service = new LoginLockService(
      prisma as unknown as PrismaService,
      redis as never,
    );

    for (let attempt = 0; attempt < 10; attempt += 1) {
      await service.recordFailure({
        username: before.username,
        ip: '203.0.113.8',
      });
    }

    const after = await prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: {
        loginLockedAt: true,
        tokenVersion: true,
      },
    });
    expect(after.loginLockedAt).toBeNull();
    expect(after.tokenVersion).toBe(before.tokenVersion);
  });
});
