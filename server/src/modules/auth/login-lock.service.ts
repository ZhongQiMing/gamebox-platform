import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { RedisService } from '../../redis/redis.service';

const FAIL_LIMIT = 10;
const FAIL_WINDOW_SEC = 15 * 60;

/** 旧版本永久计数 key，仅用于成功登录/人工解冻时顺手清理 */
function legacyUserFailKey(username: string) {
  return `login:fail:user:${username.toLowerCase()}`;
}
function pairFailKey(username: string, ip: string | null) {
  return `login:fail:pair:${username.toLowerCase()}:${ip || 'unknown'}`;
}
function ipFailKey(ip: string) {
  return `login:fail:ip:${ip}`;
}

@Injectable()
export class LoginLockService {
  private readonly logger = new Logger(LoginLockService.name);

  constructor(
    private prisma: PrismaService,
    private redis: RedisService,
  ) {}

  isLocked(loginLockedAt: Date | null | undefined): boolean {
    return !!loginLockedAt;
  }

  async clearFailCounters(username: string, ip?: string | null) {
    const normalizedIp = (ip || '').trim() || null;
    const keys = [
      legacyUserFailKey(username),
      pairFailKey(username, normalizedIp),
    ];
    try {
      /*
       * 不清整个 IP 计数：否则攻击者只要拿一个正确账号登录，就能重置同 IP 的撞库额度。
       * IP key 自行在 15 分钟后过期。
       */
      await this.redis.del(...keys);
    } catch (error) {
      this.logger.warn(`清理登录失败计数失败：${(error as Error).message}`);
    }
  }

  /**
   * 记录一次失败。只写 15 分钟 Redis 窗口，不写 loginLockedAt、不吊销 tokenVersion：
   * - 账号+IP：让同一来源反复猜同一账号进入退避
   * - IP：限制同一来源轮换用户名撞库
   *
   * 正确密码仍由 AuthService 先验证并放行，因此攻击者不能靠这些计数锁住别人的账号。
   */
  async recordFailure(opts: {
    username: string;
    ip?: string | null;
  }): Promise<{ blocked: boolean; pairBlocked: boolean; ipBlocked: boolean }> {
    const username = opts.username.toLowerCase();
    const ip = (opts.ip || '').trim() || null;

    try {
      const [pairCount, ipCount] = await Promise.all([
        this.redis.consumeFixedWindow(pairFailKey(username, ip), FAIL_WINDOW_SEC),
        ip
          ? this.redis.consumeFixedWindow(ipFailKey(ip), FAIL_WINDOW_SEC)
          : Promise.resolve(0),
      ]);
      const pairBlocked = pairCount >= FAIL_LIMIT;
      const ipBlocked = ipCount >= FAIL_LIMIT;
      return {
        blocked: pairBlocked || ipBlocked,
        pairBlocked,
        ipBlocked,
      };
    } catch (error) {
      /*
       * Redis 故障时由控制器/Nginx IP 限流继续兜底；绝不能退回数据库永久冻号。
       * 登录失败本身仍返回 401，不会因为配额故障放行错误密码。
       */
      this.logger.warn(`记录登录失败计数失败：${(error as Error).message}`);
      return { blocked: false, pairBlocked: false, ipBlocked: false };
    }
  }

  /** 重置密码后解冻并清计数（仅房主/管理员调用路径） */
  async unlockAfterPasswordReset(userId: string, username: string) {
    await this.prisma.user.update({
      where: { id: userId },
      data: { loginLockedAt: null },
    });
    await this.clearFailCounters(username, null);
  }
}
