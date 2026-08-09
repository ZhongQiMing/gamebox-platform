import { Body, Controller, Get, HttpStatus, Post, Res } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import type { Response } from 'express';
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

/**
 * 对账探活：给宝塔的 health-alert.mjs 用，配置里把 HEALTH_URL 指到这里即可复用
 * 现成的 Telegram 告警，服务端不必再配一份 Bot Token。
 *
 * 只念定时任务算好的缓存、不查库，所以公开也不怕刷。刻意与 /api/health 分开：
 * 那个被容器存活探针盯着，一返回 503 容器就重启，而账对不上重启一万次也还是不对。
 */
@Controller('health')
export class ReconHealthController {
  constructor(private svc: FundReconService) {}

  @Public()
  @SkipThrottle()
  @Get('reconcile')
  check(@Res({ passthrough: true }) res: Response) {
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
