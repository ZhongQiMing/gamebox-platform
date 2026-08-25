import {
  Body, Controller, DefaultValuePipe, ForbiddenException, Get, HttpStatus,
  ParseIntPipe, Post, Query, Req, Res,
} from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import { createHash, timingSafeEqual } from 'node:crypto';
import { IsInt, IsOptional, IsString, Length, Max, Min } from 'class-validator';
import { Public } from '../../common/decorators/public.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { FundReconService } from './fund-recon.service';
import { AdminPasswordService } from '../admin/admin-password.service';

class GateReleaseDto {
  /** 放行等于在账不平的情况下继续出款，必须写清为什么 */
  @IsString()
  @Length(4, 200)
  reason!: string;

  /** 放行时长（小时），服务端上限 24 */
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(24)
  hours?: number;

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

  /**
   * 最近一次结果。
   * 内存里没有时（刚重启）回落到落库的最近一次，避免页面显示「尚未对账」。
   * 同时带上出款闸门状态，让人一眼看到「现在能不能出款」。
   */
  @Get()
  async last() {
    const inMemory = this.svc.getLast();
    if (inMemory) {
      return {
        report: inMemory,
        gate: await this.svc.payoutGateStatus({ autoRun: false }),
      };
    }
    const persisted = await this.svc.getLastPersisted();
    return {
      report: persisted?.report ?? null,
      persisted: persisted
        ? { trigger: persisted.trigger, checkedAt: persisted.checkedAt.toISOString() }
        : null,
      gate: await this.svc.payoutGateStatus({ autoRun: false }),
    };
  }

  @Post('run')
  async run() {
    return { report: await this.svc.run('manual') };
  }

  /** 历次对账记录：重启也不会丢，用来回溯「什么时候开始不平的」 */
  @Get('history')
  history(
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page = 1,
    @Query('pageSize', new DefaultValuePipe(20), ParseIntPipe) pageSize = 20,
  ) {
    return this.svc.history({ page, pageSize });
  }

  /** 出款闸门当前状态 */
  @Get('payout-gate')
  payoutGate() {
    return this.svc.payoutGateStatus({ autoRun: false });
  }

  /**
   * 知情放行：对账不平时临时允许出款。
   * 必须填原因、过二次密码、有到期时间，全程留痕。
   */
  @Post('payout-gate/release')
  async releaseGate(
    @CurrentUser() u: { id: string; role: string },
    @Body() dto: GateReleaseDto,
  ) {
    await this.adminPwd.verify(u, dto.adminPassword);
    return this.svc.releasePayoutGate({
      operatorId: u.id,
      reason: dto.reason,
      hours: dto.hours ?? 2,
    });
  }

  /** 撤销放行，立即恢复拦截 */
  @Post('payout-gate/revoke')
  async revokeGate(@CurrentUser() u: { id: string; role: string }) {
    return this.svc.revokePayoutGateRelease(u.id);
  }

  /*
   * 这里曾有 fix-points / fix-quota 两个「补流水」接口，已删除。
   *
   * 它们只写一条流水让「余额 vs 流水」的差额归零，却不动余额。所以当真相是
   * 「余额多了」时，它会把流水也改成多的，两边一起错——原本能看出差额，
   * 补完反而看不出来了，等于把证据抹掉。而且幂等键用随机数，可以无限重复补。
   *
   * 对不上就说明出过事，正确做法是查清原因，再走正常的上分/下分把钱调平：
   * 那条路会同时改余额和写流水，两边始终一致，也留下可追溯的资金流水。
   */
}
