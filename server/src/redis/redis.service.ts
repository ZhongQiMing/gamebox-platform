import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
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
      redis.call("SET", KEYS[1], cjson.encode(room))
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

  async ping(): Promise<boolean> {
    try {
      return (await this.client.ping()) === 'PONG';
    } catch {
      return false;
    }
  }
}
