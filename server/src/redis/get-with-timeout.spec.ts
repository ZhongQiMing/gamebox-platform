import { RedisService } from './redis.service';

/**
 * 带超时的读，以及它必须避免的那个致命坑。
 *
 * Promise.race 里超时那一侧先 reject 之后，底层 ioredis 的 Promise 依旧会在稍后
 * 失败（例如 MaxRetriesPerRequestError）。那时已经没人处理它，成为
 * unhandled rejection——Node 22+ 默认直接结束进程。
 *
 * 实测踩过：Redis 抖一下，整个后端进程退出，玩家全站掉线，而起因只是缓存抖动。
 * 这条测试就是钉住「迟到的失败必须被吞掉」。
 */
describe('getWithTimeout', () => {
  function makeService(getImpl: () => Promise<string | null>) {
    const svc = Object.create(RedisService.prototype) as RedisService;
    (svc as unknown as Record<string, unknown>).client = { get: getImpl };
    return svc;
  }

  it('正常返回值', async () => {
    const svc = makeService(() => Promise.resolve('hello'));
    await expect(svc.getWithTimeout('k', 500)).resolves.toBe('hello');
  });

  it('底层挂住时按超时失败', async () => {
    const svc = makeService(() => new Promise(() => { /* 永不 settle */ }));
    await expect(svc.getWithTimeout('k', 30)).rejects.toThrow('REDIS_TIMEOUT');
  });

  it('底层直接失败时原样抛出', async () => {
    const svc = makeService(() => Promise.reject(new Error('ECONNREFUSED')));
    await expect(svc.getWithTimeout('k', 500)).rejects.toThrow('ECONNREFUSED');
  });

  it('超时先返回后，底层迟到的失败不能变成未处理的 rejection', async () => {
    const seen: unknown[] = [];
    const onUnhandled = (reason: unknown) => seen.push(reason);
    process.on('unhandledRejection', onUnhandled);
    try {
      /* 底层 300ms 后才失败，而超时只有 20ms —— 正是踩过的那个时序 */
      const svc = makeService(
        () => new Promise((_, reject) => {
          setTimeout(() => reject(new Error('MaxRetriesPerRequestError')), 300);
        }),
      );
      await expect(svc.getWithTimeout('k', 20)).rejects.toThrow('REDIS_TIMEOUT');
      /* 等过底层失败的时刻，再看有没有漏出来 */
      await new Promise((r) => setTimeout(r, 500));
      expect(seen).toHaveLength(0);
    } finally {
      process.off('unhandledRejection', onUnhandled);
    }
  });
});
