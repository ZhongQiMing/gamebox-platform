import { HttpException } from '@nestjs/common';
import { BetRateGuard } from './bet-rate.guard';

/** 只造出守卫需要的那几个字段 */
function ctxOf(req: unknown) {
  return {
    getType: () => 'http',
    switchToHttp: () => ({ getRequest: () => req }),
  } as never;
}

function redisMock() {
  const counts = new Map<string, number>();
  return {
    counts,
    incrWithExpire: jest.fn(async (key: string) => {
      const n = (counts.get(key) || 0) + 1;
      counts.set(key, n);
      return n;
    }),
  };
}

describe('BetRateGuard 下注限流', () => {
  it('按玩家计数：同一出口 IP 的两个玩家各自独立，不互相挤占', async () => {
    const redis = redisMock();
    const guard = new BetRateGuard(redis as never);
    const sameIp = { ip: '1.2.3.4' };

    for (let i = 0; i < 100; i++) {
      await expect(
        guard.canActivate(ctxOf({ ...sameIp, user: { id: 'A' } })),
      ).resolves.toBe(true);
    }
    /* A 已打满，B 仍应放行 */
    await expect(
      guard.canActivate(ctxOf({ ...sameIp, user: { id: 'B' } })),
    ).resolves.toBe(true);

    const keys = [...redis.counts.keys()];
    expect(keys.some((k) => k.includes('u:A'))).toBe(true);
    expect(keys.some((k) => k.includes('u:B'))).toBe(true);
    expect(keys.every((k) => !k.includes('ip:'))).toBe(true);
  });

  it('同一玩家超过窗口额度就拒绝，并且是 429', async () => {
    const redis = redisMock();
    const guard = new BetRateGuard(redis as never);
    const req = { ip: '1.2.3.4', user: { id: 'A' } };

    for (let i = 0; i < 100; i++) {
      await expect(guard.canActivate(ctxOf(req))).resolves.toBe(true);
    }
    await expect(guard.canActivate(ctxOf(req))).rejects.toBeInstanceOf(HttpException);
    try {
      await guard.canActivate(ctxOf(req));
    } catch (e) {
      expect((e as HttpException).getStatus()).toBe(429);
    }
  });

  it('拿不到玩家时退回按 IP 计数', async () => {
    const redis = redisMock();
    const guard = new BetRateGuard(redis as never);
    await expect(guard.canActivate(ctxOf({ ip: '9.9.9.9' }))).resolves.toBe(true);
    expect([...redis.counts.keys()].some((k) => k.includes('ip:9.9.9.9'))).toBe(true);
  });

  it('计数器故障时放行，不因限流器自身问题挡住下注', async () => {
    const guard = new BetRateGuard({
      incrWithExpire: jest.fn(async () => {
        throw new Error('redis down');
      }),
    } as never);
    await expect(
      guard.canActivate(ctxOf({ ip: '1.1.1.1', user: { id: 'A' } })),
    ).resolves.toBe(true);
  });

  it('非 HTTP 上下文直接放行', async () => {
    const guard = new BetRateGuard(redisMock() as never);
    const wsCtx = { getType: () => 'ws' } as never;
    await expect(guard.canActivate(wsCtx)).resolves.toBe(true);
  });
});
