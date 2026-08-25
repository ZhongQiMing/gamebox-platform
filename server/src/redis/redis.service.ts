import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'node:crypto';
import Redis from 'ioredis';

@Injectable()
export class RedisService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RedisService.name);
  private client!: Redis;
  private sub!: Redis;

  constructor(private config: ConfigService) {}

  async onModuleInit() {
    const url = this.config.get<string>('REDIS_URL') || 'redis://localhost:6379';
    this.client = new Redis(url, { maxRetriesPerRequest: 3 });
    this.sub = this.client.duplicate();
    this.client.on('error', (err) => this.logger.error(`Redis error: ${err.message}`));
    this.sub.on('error', (err) => this.logger.error(`Redis sub error: ${err.message}`));
    await this.client.ping();
    this.logger.log('Redis connected');
  }

  /**
   * 给单次读操作套一个超时。
   *
   * ioredis 默认开着离线队列：连接断了命令不报错，而是排队等重连。于是
   * 「Redis 挂掉」表现为请求一直卡住，而不是抛错——上层写好的降级分支
   * （牌桌快照降级成维护中）根本没机会执行，玩家看到的是转圈然后报错。
   *
   * 刻意**不**改成全局 enableOfflineQueue=false：那会让启动期的扫描与重连
   * 一起失败，实测直接把服务卡在启动阶段起不来。只给需要降级的读路径套超时，
   * 影响面可控。
   */
  async getWithTimeout(key: string, timeoutMs = 1500): Promise<string | null> {
    let timer: NodeJS.Timeout | undefined;
    /*
     * 必须先给底层那个 Promise 挂上 catch。
     *
     * Promise.race 里超时那一侧先 reject 之后，ioredis 那个 Promise 依旧会在稍后
     * 以 MaxRetriesPerRequestError 失败——那时已经没人处理它，成为
     * unhandled rejection，Node 22+ 默认直接结束进程。
     * 实测就是这样：Redis 抖一下，整个后端进程退出。
     */
    const pending = this.client.get(key).catch((err: unknown) => {
      throw err instanceof Error ? err : new Error(String(err));
    });
    pending.catch(() => undefined); // 兜住「超时先返回后」这一支的迟到失败
    try {
      return await Promise.race([
        pending,
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error('REDIS_TIMEOUT')), timeoutMs);
        }),
      ]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  async onModuleDestroy() {
    await Promise.allSettled([this.sub?.quit(), this.client?.quit()]);
  }

  get raw(): Redis {
    return this.client;
  }

  get subscriber(): Redis {
    return this.sub;
  }

  async get(key: string): Promise<string | null> {
    return this.client.get(key);
  }

  async set(key: string, value: string, ttlSec?: number): Promise<void> {
    if (ttlSec && ttlSec > 0) {
      await this.client.set(key, value, 'EX', ttlSec);
      return;
    }
    await this.client.set(key, value);
  }

  async del(...keys: string[]): Promise<void> {
    if (keys.length) await this.client.del(...keys);
  }

  /** INCR；若是新建 key 则设置 TTL（秒） */
  async incrWithExpire(key: string, ttlSec: number): Promise<number> {
    const n = await this.client.incr(key);
    if (n === 1 && ttlSec > 0) {
      await this.client.expire(key, ttlSec);
    }
    return n;
  }

  /**
   * 固定窗口计数：INCR 与首次 EXPIRE 在同一段 Lua 内完成，避免并发首请求留下无 TTL key。
   * 返回当前计数，由调用方决定是否超过上限。
   */
  async consumeFixedWindow(key: string, ttlSec: number): Promise<number> {
    const script = `
      local n = redis.call("INCR", KEYS[1])
      if n == 1 and tonumber(ARGV[1]) > 0 then
        redis.call("EXPIRE", KEYS[1], ARGV[1])
      end
      return n
    `;
    const res = await this.client.eval(script, 1, key, String(ttlSec));
    return Number(res);
  }

  async publish(channel: string, message: string): Promise<void> {
    await this.client.publish(channel, message);
  }

  async subscribe(channel: string, handler: (message: string) => void): Promise<void> {
    await this.sub.subscribe(channel);
    this.sub.on('message', (ch, message) => {
      if (ch === channel) handler(message);
    });
  }

  /** SET key token NX PX ttlMs —— 成功返回 true */
  async tryLock(key: string, token: string, ttlMs: number): Promise<boolean> {
    const res = await this.client.set(key, token, 'PX', ttlMs, 'NX');
    return res === 'OK';
  }

  /** 仅当 token 匹配时续期 */
  async renewLock(key: string, token: string, ttlMs: number): Promise<boolean> {
    const script = `
      if redis.call("get", KEYS[1]) == ARGV[1] then
        return redis.call("pexpire", KEYS[1], ARGV[2])
      else
        return 0
      end
    `;
    const res = await this.client.eval(script, 1, key, token, String(ttlMs));
    return Number(res) === 1;
  }

  /**
   * 定时任务的单实例闸门：多台机器同时到点时只放一台跑。
   *
   * 进程内的 busy 标志只管得住自己那个进程，扩到两台就会各跑各的。
   *
   * Redis 挂掉时怎么办分两种，由 onLockError 决定：
   * - 'run'（默认）：照跑。发回水、封账这类宁可重跑，下游都有幂等键兜底，
   *   不能因为缓存挂了就整天不发钱。
   * - 'skip'：宁可不跑。给那些「重跑虽然幂等、但会把额度算错或刷爆下游」的任务用，
   *   漏一轮下次补得回来，跑重了要人工查账。
   */
  async runExclusive(
    key: string,
    ttlMs: number,
    task: () => Promise<void>,
    opts?: { onLockError?: 'run' | 'skip' },
  ): Promise<'ran' | 'skipped'> {
    const token = randomUUID();
    let locked = false;
    try {
      locked = await this.tryLock(key, token, ttlMs);
      if (!locked) return 'skipped';
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (opts?.onLockError === 'skip') {
        this.logger.error(`取锁失败（${key}），本轮跳过以免多实例重跑：${msg}`);
        return 'skipped';
      }
      this.logger.warn(`取锁失败（${key}），按单实例放行：${msg}`);
    }
    try {
      await task();
      return 'ran';
    } finally {
      if (locked) await this.releaseLock(key, token).catch(() => undefined);
    }
  }

  /** 仅当 token 匹配时释放 */
  async releaseLock(key: string, token: string): Promise<void> {
    const script = `
      if redis.call("get", KEYS[1]) == ARGV[1] then
        return redis.call("del", KEYS[1])
      else
        return 0
      end
    `;
    await this.client.eval(script, 1, key, token);
  }

  /**
   * 房间态 CAS：仅当当前 JSON.version == expectedVersion 时写入 newJson（内含 version+1）
   * 返回 true=成功，false=版本冲突或 key 不存在
   */
  async compareAndSetRoom(
    key: string,
    expectedVersion: number,
    newJson: string,
  ): Promise<boolean> {
    const script = `
      local raw = redis.call("GET", KEYS[1])
      if not raw then return 0 end
      local ok, room = pcall(cjson.decode, raw)
      if not ok or type(room) ~= "table" then return 0 end
      local ver = tonumber(room["version"] or 0)
      if ver ~= tonumber(ARGV[1]) then return 0 end
      redis.call("SET", KEYS[1], ARGV[2])
      return 1
    `;
    const res = await this.client.eval(script, 1, key, String(expectedVersion), newJson);
    return Number(res) === 1;
  }

  /**
   * 下注侧增量 patch：仅 phase=BETTING 且 roundNo 匹配时更新 roundId/betSummary
   * 返回 1=ok，0=无 key，-1=非下注，-2=局号不符
   */
  async patchTableBetSummary(
    key: string,
    roundNo: string,
    roundId: string,
    side: string,
    amount: number,
  ): Promise<number> {
    const script = `
      local raw = redis.call("GET", KEYS[1])
      if not raw then return 0 end
      local ok, room = pcall(cjson.decode, raw)
      if not ok or type(room) ~= "table" then return 0 end
      if room["phase"] ~= "BETTING" then return -1 end
      if tostring(room["roundNo"]) ~= tostring(ARGV[1]) then return -2 end
      if ARGV[2] ~= nil and ARGV[2] ~= "" then
        room["roundId"] = ARGV[2]
      end
      if type(room["betSummary"]) ~= "table" then
        room["betSummary"] = {}
      end
      local side = tostring(ARGV[3])
      local amt = tonumber(ARGV[4]) or 0
      local prev = tonumber(room["betSummary"][side]) or 0
      room["betSummary"][side] = prev + amt
      room["version"] = (tonumber(room["version"]) or 0) + 1
      -- Lua cjson 把空 table 编成 {}；空 history 必须保持 JSON 数组 []
      local encoded = cjson.encode(room)
      encoded = string.gsub(encoded, '"history":{}', '"history":[]')
      redis.call("SET", KEYS[1], encoded)
      return 1
    `;
    const res = await this.client.eval(
      script,
      1,
      key,
      roundNo,
      roundId,
      side,
      String(amount),
    );
    return Number(res);
  }

  /**
   * 原子预留牌桌单边限红：**检查上限与累加在同一段 Lua 内完成**。
   *
   * 原先是「先读汇总判断、再进事务下注」，两步之间有窗口：一万人同时点同一边，
   * 每个人读到的都是旧值，全部通过，单边暴露可以远远冲破限红。
   * 靠数据库行锁堵这个窗口的代价是同一桌所有人下注完全串行——一桌上千人就排队到封盘。
   * 这里把限红判断做成不可分割的一步，既堵住绕过，也不需要任何串行。
   *
   * @param sides 与 side 等价的方向集合（如龙虎大小写别名），限红按它们的合计判断
   * @returns 1 成功；0 无房间状态；-1 非下注阶段；-2 局号已切换；-3 超过单边限红
   */
  async reserveTableSideExposure(params: {
    key: string;
    roundNo: string;
    roundId: string;
    side: string;
    sides: string[];
    amount: number;
    cap: number;
  }): Promise<number> {
    const script = `
      local raw = redis.call("GET", KEYS[1])
      if not raw then return 0 end
      local ok, room = pcall(cjson.decode, raw)
      if not ok or type(room) ~= "table" then return 0 end
      if room["phase"] ~= "BETTING" then return -1 end
      if tostring(room["roundNo"]) ~= tostring(ARGV[1]) then return -2 end
      if ARGV[2] ~= nil and ARGV[2] ~= "" then
        room["roundId"] = ARGV[2]
      end
      if type(room["betSummary"]) ~= "table" then
        room["betSummary"] = {}
      end
      local side = tostring(ARGV[3])
      local amt = tonumber(ARGV[4]) or 0
      local cap = tonumber(ARGV[5]) or 0
      local okSides, sides = pcall(cjson.decode, ARGV[6])
      if not okSides or type(sides) ~= "table" then sides = { side } end
      -- 等价方向合计后再判上限，避免用别名绕开限红
      local total = 0
      for _, s in ipairs(sides) do
        total = total + (tonumber(room["betSummary"][tostring(s)]) or 0)
      end
      if cap > 0 and total + amt > cap then return -3 end
      local prev = tonumber(room["betSummary"][side]) or 0
      room["betSummary"][side] = prev + amt
      room["version"] = (tonumber(room["version"]) or 0) + 1
      -- Lua cjson 把空 table 编成 {}；空 history 必须保持 JSON 数组 []
      local encoded = cjson.encode(room)
      encoded = string.gsub(encoded, '"history":{}', '"history":[]')
      redis.call("SET", KEYS[1], encoded)
      return 1
    `;
    const res = await this.client.eval(
      script,
      1,
      params.key,
      params.roundNo,
      params.roundId,
      params.side,
      String(params.amount),
      String(params.cap),
      JSON.stringify(params.sides && params.sides.length ? params.sides : [params.side]),
    );
    return Number(res);
  }

  async ping(): Promise<boolean> {
    try {
      return (await this.client.ping()) === 'PONG';
    } catch {
      return false;
    }
  }
}
