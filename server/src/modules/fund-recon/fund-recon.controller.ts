import { Body, Controller, ForbiddenException, Get, HttpStatus, Post, Req, Res } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import { createHash, timingSafeEqual } from 'node:crypto';
import { IsString, Length } from 'class-validator';
import { Public } from '../../common/decorators/public.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { FundReconService } from './fund-recon.service';
import { AdminPasswordService } from '../admin/admin-password.service';

class FixDto {
  @IsString()
  @Length(1, 64)
  id!: string;

  @IsString()
  @Length(4, 200)
  reason!: string;

  /** 补记会往账本里写一条调整，等于人工承认一笔差额，必须二次验密 */
  @IsString()
  @Length(1, 200)
  adminPassword!: string;
}

/** 定长摘要后再比，避免按字符提前返回泄露前缀，也免去长度不等的报错 */
function tokenMatches(provided: string, expected: string): boolean {
  const a = createHash('sha256').update(provided).digest();
  const b = createHash('sha256').update(expected).digest();
  return timingSafeEqual(a, b);
}

/**
 * 对账探活：给宿主机的 health-alert.mjs 用，配置里把 HEALTH_URL 指到这里即可复用
 * 现成的 Telegram 告警，服务端不必再配一份 Bot Token。
 *
 * 只念定时任务算好的缓存、不查库，所以不怕刷。刻意与 /api/health 分开：
 * 那个被容器存活探针盯着，一返回 503 容器就重启，而账对不上重启一万次也还是不对。
 *
 * 不走 JWT（探活脚本没有账号），改用共享密钥头：响应里带着差额金额与对不上的科目，
 * 这是账务健康度，不该谁都能拉。密钥由 deploy-on-server.sh 生成并同步给探活脚本。
 */
@Controller('health')
export class ReconHealthController {
  constructor(private svc: FundReconService) {}

  @Public()
  @SkipThrottle()
  @Get('reconcile')
  check(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const expected = String(process.env.RECON_HEALTH_TOKEN ?? '').trim();
    if (expected) {
      const got = String(req.headers['x-recon-token'] ?? '');
      if (!got || !tokenMatches(got, expected)) {
        throw new ForbiddenException('对账探活需要 X-Recon-Token');
      }
    } else if ((process.env.NODE_ENV ?? 'development') === 'production') {
      /* 生产没配密钥就别裸奔：宁可探活报错被发现，也不要默默公开账务差额 */
      throw new ForbiddenException('未配置 RECON_HEALTH_TOKEN，对账探活已关闭');
    }

    const last = this.svc.getLast();
    if (!last) {
      /* 进程刚起还没到 05:00，没有结论可报，不算异常 */
      return { status: 'pending', checkedAt: null, drift: 0 };
    }
    /*
     * 手动置 503 而不是抛 ServiceUnavailableException：异常会被全局过滤器接管，
     * body 换成 {message:'服务器内部错误'}，告警短信里就只剩一句「服务器内部错误」，
     * 跟真崩了长得一模一样。passthrough 保留正文，Telegram 才能带上是哪几项对不上。
     */
    if (!last.ok) res.status(HttpStatus.SERVICE_UNAVAILABLE);
    return {
      status: last.ok ? 'ok' : 'drift',
      checkedAt: last.checkedAt,
      drift: last.totalBad,
      checks: last.checks
        .filter((c) => c.bad > 0)
        .map((c) => ({ key: c.key, label: c.label, bad: c.bad })),
    };
  }
}

@Controller('admin/fund-recon')
@Roles('ADMIN')
export class FundReconController {
  constructor(
    private svc: FundReconService,
    private adminPwd: AdminPasswordService,
  ) {}

  /** 最近一次结果；没跑过返回 null，由前端提示先点「立即对账」 */
  @Get()
  last() {
    return { report: this.svc.getLast() };
  }

  @Post('run')
  async run() {
    return { report: await this.svc.run() };
  }

  /** 补记积分账差错调整：只写流水记录差额来路，不动余额 */
  @Post('fix-points')
  async fixPoints(@CurrentUser() u: { id: string; role: string }, @Body() dto: FixDto) {
    await this.adminPwd.verify(u, dto.adminPassword);
    return this.svc.fixPointsDrift(u.id, dto.id, dto.reason);
  }

  /** 补记盘分账差错调整：只写流水，不动 pointsQuota */
  @Post('fix-quota')
  async fixQuota(@CurrentUser() u: { id: string; role: string }, @Body() dto: FixDto) {
    await this.adminPwd.verify(u, dto.adminPassword);
    return this.svc.fixQuotaDrift(u.id, dto.id, dto.reason);
  }
}
