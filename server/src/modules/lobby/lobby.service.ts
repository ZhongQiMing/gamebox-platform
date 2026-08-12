import { Injectable } from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import { RedisService } from '../../redis/redis.service';
import { LotteryService } from '../lottery/lottery.service';
import { TableService } from '../table/table.service';

/**
 * 大厅聚合读。
 *
 * 大厅原本每个彩种要打 current+history 两枪、每个牌桌一枪 snapshot，一屏十来个游戏
 * 就是十七八个并发请求，还每隔几秒重来一轮。这些都是公开只读、彼此独立的查询，
 * 完全可以在服务端一次并行取齐，前端只需一个来回——对香港这种高延迟链路收益最大。
 *
 * 单个游戏查询失败（下架 / 无数据）只把该项置空，不影响其余卡片。
 */
@Injectable()
export class LobbyService {
  private readonly inflight = new Map<string, Promise<unknown>>();
  private static readonly CACHE_TTL_SEC = 3;

  constructor(
    private readonly lottery: LotteryService,
    private readonly table: TableService,
    private readonly redis: RedisService,
  ) {}

  async snapshot(lotteryCodes: string[], tableCodes: string[]) {
    const normalizedLottery = [...new Set(lotteryCodes)].sort();
    const normalizedTable = [...new Set(tableCodes)].sort();
    const identity = JSON.stringify([normalizedLottery, normalizedTable]);
    const key = `gamebox:lobby:snapshot:${createHash('sha256').update(identity).digest('hex')}`;
    const running = this.inflight.get(key);
    if (running) return running;

    const promise = this.cachedSnapshot(key, normalizedLottery, normalizedTable);
    this.inflight.set(key, promise);
    try {
      return await promise;
    } finally {
      if (this.inflight.get(key) === promise) this.inflight.delete(key);
    }
  }

  private async cachedSnapshot(key: string, lotteryCodes: string[], tableCodes: string[]) {
    const cached = await this.redis.get(key).catch(() => null);
    if (cached) {
      try {
        return JSON.parse(cached) as unknown;
      } catch {
        /* 损坏缓存按 miss 降级 */
      }
    }

    const lockKey = `${key}:lock`;
    const token = randomUUID();
    const locked = await this.redis.tryLock(lockKey, token, 2_000).catch(() => false);
    if (!locked) {
      /* 多实例同键合并：给持锁实例一个很短的填充窗口；Redis 故障时不阻断请求 */
      for (let i = 0; i < 3; i++) {
        await new Promise((resolve) => setTimeout(resolve, 25));
        const filled = await this.redis.get(key).catch(() => null);
        if (!filled) continue;
        try {
          return JSON.parse(filled) as unknown;
        } catch {
          break;
        }
      }
    }

    try {
      const result = await this.loadSnapshot(lotteryCodes, tableCodes);
      await this.redis
        .set(key, JSON.stringify(result), LobbyService.CACHE_TTL_SEC)
        .catch(() => undefined);
      return result;
    } finally {
      if (locked) await this.redis.releaseLock(lockKey, token).catch(() => undefined);
    }
  }

  private async loadSnapshot(lotteryCodes: string[], tableCodes: string[]) {
    const lotteryEntries = await Promise.all(
      lotteryCodes.map(async (code) => {
        const [current, hist] = await Promise.all([
          this.lottery.currentIssue(code).catch(() => null),
          this.lottery.history(code, 1).catch(() => [] as unknown[]),
        ]);
        const row = (Array.isArray(hist) ? hist[0] : undefined) as
          | { issueNo: string; drawNumbers: string }
          | undefined;
        const lastDraw = row
          ? { issueNo: String(row.issueNo), drawNumbers: row.drawNumbers }
          : null;
        return [code, { current: current ?? null, lastDraw }] as const;
      }),
    );

    const tableEntries = await Promise.all(
      tableCodes.map(async (code) => {
        const snap = await this.table.snapshot(code).catch(() => null);
        return [code, snap] as const;
      }),
    );

    return {
      lottery: Object.fromEntries(lotteryEntries),
      table: Object.fromEntries(tableEntries),
    };
  }
}
