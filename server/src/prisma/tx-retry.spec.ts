import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { retryablePgCode, withTxRetry } from './tx-retry';

/**
 * 事务冲突重试。
 *
 * 最要紧的不是「能重试」，而是**只重试真的可以安全重放的错误**：
 * 死锁与串行化失败下事务已完整回滚，重放不会重复扣钱；
 * 业务错误和唯一键冲突重试一百次结果都一样，只会拖长响应。
 */
describe('事务冲突重试', () => {
  const pgErr = (code: string) => {
    const e = new Prisma.PrismaClientKnownRequestError('db error', {
      code: 'P2010',
      clientVersion: '5.22.0',
      meta: { code },
    });
    return e;
  };

  describe('哪些错误算可重试', () => {
    it('死锁与串行化失败可重试', () => {
      expect(retryablePgCode(pgErr('40P01'))).toBe('40P01');
      expect(retryablePgCode(pgErr('40001'))).toBe('40001');
    });

    it('Prisma 自己识别的事务冲突可重试', () => {
      const e = new Prisma.PrismaClientKnownRequestError('write conflict', {
        code: 'P2034',
        clientVersion: '5.22.0',
      });
      expect(retryablePgCode(e)).toBe('P2034');
    });

    it('原生 SQL 只把错误码写在 message 里，也要认出来', () => {
      expect(retryablePgCode(new Error('deadlock detected'))).toBe('40P01');
      expect(retryablePgCode(new Error('... 40001 ...'))).toBe('40001');
    });

    it('业务错误一律不重试', () => {
      expect(retryablePgCode(new BadRequestException('余额不足'))).toBeNull();
      expect(retryablePgCode(new BadRequestException('本局已封盘'))).toBeNull();
    });

    it('唯一键冲突不重试——那说明这笔已经做过了', () => {
      const e = new Prisma.PrismaClientKnownRequestError('dup', {
        code: 'P2002',
        clientVersion: '5.22.0',
      });
      expect(retryablePgCode(e)).toBeNull();
    });

    it('外键冲突之类的确定性错误不重试', () => {
      const e = new Prisma.PrismaClientKnownRequestError('fk', {
        code: 'P2003',
        clientVersion: '5.22.0',
      });
      expect(retryablePgCode(e)).toBeNull();
    });
  });

  describe('重试行为', () => {
    it('第一次就成功时不重试', async () => {
      const fn = jest.fn().mockResolvedValue('ok');
      await expect(withTxRetry(fn)).resolves.toBe('ok');
      expect(fn).toHaveBeenCalledTimes(1);
    });

    it('死锁后重试并最终成功', async () => {
      const fn = jest.fn()
        .mockRejectedValueOnce(pgErr('40P01'))
        .mockRejectedValueOnce(pgErr('40P01'))
        .mockResolvedValue('ok');
      await expect(withTxRetry(fn, { baseDelayMs: 1 })).resolves.toBe('ok');
      expect(fn).toHaveBeenCalledTimes(3);
    });

    it('业务错误立刻抛出，一次都不重试', async () => {
      const fn = jest.fn().mockRejectedValue(new BadRequestException('余额不足'));
      await expect(withTxRetry(fn, { baseDelayMs: 1 })).rejects.toThrow('余额不足');
      expect(fn).toHaveBeenCalledTimes(1);
    });

    it('重试到上限仍失败就把原始错误抛出去，不吞掉', async () => {
      const fn = jest.fn().mockRejectedValue(pgErr('40P01'));
      await expect(withTxRetry(fn, { retries: 2, baseDelayMs: 1 })).rejects.toBeInstanceOf(
        Prisma.PrismaClientKnownRequestError,
      );
      /* 首次 + 2 次重试 */
      expect(fn).toHaveBeenCalledTimes(3);
    });

    it('退避带抖动：两次等待时长不应恒等', async () => {
      const delays: number[] = [];
      const realSetTimeout = global.setTimeout;
      // @ts-expect-error 测试替身
      global.setTimeout = (cb: () => void, ms?: number) => {
        delays.push(Number(ms) || 0);
        return realSetTimeout(cb, 0);
      };
      try {
        const fn = jest.fn()
          .mockRejectedValueOnce(pgErr('40P01'))
          .mockRejectedValueOnce(pgErr('40P01'))
          .mockRejectedValueOnce(pgErr('40P01'))
          .mockResolvedValue('ok');
        await withTxRetry(fn, { baseDelayMs: 100 });
      } finally {
        global.setTimeout = realSetTimeout;
      }
      expect(delays).toHaveLength(3);
      /* 指数增长：后一次的上限应高于前一次的下限 */
      expect(delays[2]!).toBeGreaterThan(delays[0]!);
      /* 抖动范围 0.5~1.5 倍 */
      expect(delays[0]!).toBeGreaterThanOrEqual(50);
      expect(delays[0]!).toBeLessThanOrEqual(150);
    });
  });
});
