import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { RedisService } from '../../redis/redis.service';

const FAIL_LIMIT = 10;
/** 同 IP 试密窗口（仅限流，不单独冻账号） */
const IP_FAIL_WINDOW_SEC = 15 * 60;

function userFailKey(username: string) {
  return `login:fail:user:${username.toLowerCase()}`;
}
function ipFailKey(ip: string) {
  return `login:fail:ip:${ip}`;
}

@Injectable()
export class LoginLockService {
  constructor(
    private prisma: PrismaService,
    private redis: RedisService,
  ) {}

  isLocked(loginLockedAt: Date | null | undefined): boolean {
    return !!loginLockedAt;
  }

  async clearFailCounters(username: string, ip?: string | null) {
    const keys = [userFailKey(username)];
    if (ip) keys.push(ipFailKey(ip));
    await this.redis.del(...keys);
  }

  /**
   * 记录一次失败：
   * - 同账号连续错满 10 次 → 写库冻结（须房主/管理员重置密码解冻）；计数成功登录或解冻才清
   * - 同 IP 15 分钟内 ≥10 次 → 仅拒绝继续试，不冻别人账号
   */
  async recordFailure(opts: {
    username: string;
    userId?: string | null;
    ip?: string | null;
  }): Promise<{ locked: boolean; blocked: boolean }> {
    const username = opts.username.toLowerCase();
    const ip = (opts.ip || '').trim() || null;

    /* 账号连续失败：不设短 TTL，成功登录/解冻才清零。
       账号不存在时不建 key，否则乱试用户名会在 Redis 堆出永不过期的垃圾键 */
    const userCount = opts.userId
      ? await this.redis.incrWithExpire(userFailKey(username), 0)
      : 0;
    let ipCount = 0;
    if (ip) {
      ipCount = await this.redis.incrWithExpire(ipFailKey(ip), IP_FAIL_WINDOW_SEC);
    }

    const userHit = userCount >= FAIL_LIMIT;
    const ipHit = ipCount >= FAIL_LIMIT;

    if (userHit && opts.userId) {
      await this.prisma.user.update({
        where: { id: opts.userId },
        data: {
          loginLockedAt: new Date(),
          tokenVersion: { increment: 1 },
        },
      });
      await this.clearFailCounters(username, ip);
      return { locked: true, blocked: true };
    }

    if (userHit || ipHit) {
      return { locked: false, blocked: true };
    }
    return { locked: false, blocked: false };
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
