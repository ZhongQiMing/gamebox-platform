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
  /**
   * 大厅卡片只读 history[0]/[1]（上一局结果 + 相位判断），但牌桌快照带的是「当日全部
   * 局数」——炸金花一天能开一千多局，实测让这个接口涨到 868KB，占大厅首屏流量的 99%，
   * 在被限速的线路上光这一个请求就要 3 秒多，而且局数越攒越多、只会更慢。
   * 这里截断到最近几局，并去掉只有验证页才用得上的种子字段。
   */
  private static readonly LOBBY_HISTORY_LIMIT = 8;

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
        return [code, snap ? LobbyService.slimTableSnapshot(snap) : null] as const;
      }),
    );

    return {
      lottery: Object.fromEntries(lotteryEntries),
      table: Object.fromEntries(tableEntries),
    };
  }

  /** 只留大厅画卡片需要的字段；完整路单与种子仍由房间内的 /table/snapshot 提供 */
  private static slimTableSnapshot(snap: unknown) {
    if (!snap || typeof snap !== 'object') return snap;
    const source = snap as { history?: unknown };
    if (!Array.isArray(source.history)) return snap;
    const history = source.history
      .slice(0, LobbyService.LOBBY_HISTORY_LIMIT)
      .map((item) => {
        const row = (item ?? {}) as Record<string, unknown>;
        return { roundNo: row.roundNo, outcome: row.outcome, createdAt: row.createdAt };
      });
    return { ...(snap as Record<string, unknown>), history };
  }
}
