/**
 * 事务冲突重试。
 *
 * Postgres 在两笔事务互相等锁时会主动杀掉一方并回滚（死锁检测）。这是数据库
 * 的正常自保行为，不是 bug——但如果调用方不重试，表现出来就是「玩家随机遇到
 * 一次失败」，而且日志里只有一句 40P01，谁也复现不出来。
 *
 * 三条纪律：
 *  1. **只重试确定可安全重试的错误**：死锁（40P01）与串行化失败（40001）。
 *     这两种情况下事务已经完整回滚，什么都没写进去，重放不会重复扣钱。
 *  2. 业务异常（余额不足、已封盘）一律不重试——重试一百次结果都一样。
 *  3. 唯一键冲突（P2002）也不重试：那说明这笔已经做过了，重试只会再撞一次。
 *
 * 退避带抖动：两笔事务撞在一起时若都按固定间隔重试，会再一次同时冲上去。
 */
import { Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';

/** 可安全重试的 Postgres 错误码 */
const RETRYABLE_PG_CODES = new Set([
  '40P01', // deadlock_detected
  '40001', // serialization_failure
]);

const logger = new Logger('TxRetry');

/** 从 Prisma 各种包装里把 Postgres 错误码挖出来 */
export function retryablePgCode(err: unknown): string | null {
  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    /* P2034 = Prisma 自己识别出的事务冲突（写冲突或死锁） */
    if (err.code === 'P2034') return 'P2034';
    const meta = err.meta as { code?: unknown } | undefined;
    const code = typeof meta?.code === 'string' ? meta.code : null;
    if (code && RETRYABLE_PG_CODES.has(code)) return code;
  }
  /*
   * 原生 SQL（$queryRaw / $executeRaw）抛出的错误里，错误码只出现在 message 里。
   * 这里按错误码文本匹配，比按中文/英文描述匹配稳。
   */
  const msg = err instanceof Error ? err.message : String(err);
  for (const code of RETRYABLE_PG_CODES) {
    if (msg.includes(code)) return code;
  }
  if (/deadlock detected/i.test(msg)) return '40P01';
  return null;
}

export interface TxRetryOptions {
  /** 最多重试几次（不含首次） */
  retries?: number;
  /** 首次退避基数（毫秒），实际退避为 base * 2^n * (0.5~1.5 抖动) */
  baseDelayMs?: number;
  /** 出现在日志里，便于定位是哪条链路在打架 */
  label?: string;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * 包一层可重试执行。
 *
 * 用法：把**整个事务**（含 $transaction 调用本身）放进 fn，
 * 不要只包事务里的一部分——重试的前提是上一次已经完整回滚。
 */
export async function withTxRetry<T>(
  fn: () => Promise<T>,
  opts: TxRetryOptions = {},
): Promise<T> {
  const retries = Math.max(0, Math.floor(opts.retries ?? 3));
  const base = Math.max(1, Math.floor(opts.baseDelayMs ?? 25));
  const label = opts.label || 'tx';

  for (let attempt = 0; ; attempt++) {
    try {
      return await fn();
    } catch (err) {
      const code = retryablePgCode(err);
      if (!code || attempt >= retries) {
        if (code) {
          logger.error(`${label} 事务冲突重试 ${attempt} 次后仍失败（${code}）`);
        }
        throw err;
      }
      /* 抖动：否则撞车的两笔会按同一节奏再次同时冲上来 */
      const delay = Math.round(base * 2 ** attempt * (0.5 + Math.random()));
      logger.warn(`${label} 事务冲突（${code}），第 ${attempt + 1} 次重试，等待 ${delay}ms`);
      await sleep(delay);
    }
  }
}
