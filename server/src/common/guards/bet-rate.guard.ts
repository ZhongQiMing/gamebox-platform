import {
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
} from '@nestjs/common';
import { RedisService } from '../../redis/redis.service';
import { extractClientIp } from '../utils/client-ip';

/**
 * 下注专用限流：按玩家计数，而不是按 IP。
 *
 * 全局兜底限流是 120 次/分且按 IP 计数，用在牌桌下注上有两个毛病：
 * 一是运营商 NAT、网吧、家庭 WiFi 下的多个玩家共用一个桶，互相挤占额度，
 * 彼此并不相识却会把对方挡在门外；二是 120 次/分平均只有 2 次/秒，
 * 而连点筹码很容易超过这个手速，单个玩家自己就会撞上。
 *
 * 改成按玩家计数后，一个人刷不到别人；额度也放宽到足以支撑正常连点。
 * 未登录请求走不到这里（全局 JWT 守卫先拦），针对本路由的匿名洪水
 * 由边缘 Nginx 的 limit_req（按来源 IP 30r/s）兜住。
 */
const WINDOW_SEC = Math.max(1, Math.floor(Number(process.env.BET_RATE_WINDOW_SEC ?? 10)));
const WINDOW_LIMIT = Math.max(1, Math.floor(Number(process.env.BET_RATE_LIMIT ?? 100)));

@Injectable()
export class BetRateGuard implements CanActivate {
  private readonly logger = new Logger(BetRateGuard.name);

  constructor(private redis: RedisService) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    if (ctx.getType() !== 'http') return true;
    const req = ctx.switchToHttp().getRequest<{
      user?: { id?: string };
      ip?: string;
      headers?: Record<string, string | string[] | undefined>;
      socket?: { remoteAddress?: string };
    }>();

    const userId = String(req?.user?.id || '').trim();
    /* 兜底才按 IP：正常情况下鉴权已通过，一定拿得到玩家 */
    const scope = userId ? `u:${userId}` : `ip:${extractClientIp(req) || 'unknown'}`;
    /* 时间分桶：key 自带窗口序号，过期即自然重置 */
    const bucket = Math.floor(Date.now() / (WINDOW_SEC * 1000));
    const key = `rate:bet:${scope}:${bucket}`;

    let hits: number;
    try {
      hits = await this.redis.incrWithExpire(key, WINDOW_SEC * 2);
    } catch (err) {
      /* 限流器自身故障不该挡住下注，放行并记账 */
      this.logger.warn(
        `下注限流计数失败，本次放行：${err instanceof Error ? err.message : String(err)}`,
      );
      return true;
    }

    if (hits > WINDOW_LIMIT) {
      throw new HttpException('下注过快，请稍后再试', HttpStatus.TOO_MANY_REQUESTS);
    }
    return true;
  }
}
