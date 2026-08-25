import { Global, Injectable, Module } from '@nestjs/common';
import type { Game, GameConfig } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

export type GameWithActiveConfig = Game & {
  configs: GameConfig[]
  playLimits?: unknown
};

/**
 * GameConfig 进程内缓存。
 *
 * 所有引擎/彩票每次 spin/draw 都要读「游戏 + 当前生效配置」，
 * 这里加一层短 TTL 缓存，削掉高频热路径上的重复 DB 往返。
 * admin 改配置/上下架时主动 invalidate，保证秒级生效、不脏读。
 */
@Injectable()
export class GameConfigCache {
  private readonly ttlMs = 30_000;
  private readonly cache = new Map<string, { at: number; value: GameWithActiveConfig | null }>();

  constructor(private prisma: PrismaService) {}

  /** 读游戏 + active 配置（带缓存）。传 code。 */
  async get(code: string): Promise<GameWithActiveConfig | null> {
    const hit = this.cache.get(code);
    if (hit && Date.now() - hit.at < this.ttlMs) return hit.value;

    const value = (await this.prisma.game.findUnique({
      where: { code },
      include: { configs: { where: { active: true }, take: 1 } },
    })) as GameWithActiveConfig | null;

    this.cache.set(code, { at: Date.now(), value });
    return value;
  }

  /** 失效单个游戏缓存（admin 改该游戏配置/状态后调用）。 */
  invalidate(code: string): void {
    this.cache.delete(code);
  }

  /** 清空全部缓存。 */
  invalidateAll(): void {
    this.cache.clear();
  }
}

@Global()
@Module({
  providers: [GameConfigCache],
  exports: [GameConfigCache],
})
export class GameConfigModule {}
