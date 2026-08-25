/**
 * 出款闸门的判定：对账不平就不准出款。
 *
 * 刻意写成「只吃一个 Prisma 客户端」的纯函数，不做成需要注入的服务：
 * 出款动作分布在 Console（后台下分）和 Recharge（下分单审核）里，如果让这两个
 * 模块去依赖 FundReconModule，就会形成
 *   ConsoleModule → FundReconModule → AdminModule → ConsoleModule
 * 的三方环，Nest 在模块实例化阶段直接卡死（表现是启动停在路由注册之后，
 * 既不报错也不监听端口，极难排查）。而闸门要读的只有两张表，没必要为它拉一条模块边。
 */
import { BadRequestException, Logger } from '@nestjs/common';
import type { PrismaClient } from '@prisma/client';
import type { PrismaService } from '../../prisma/prisma.service';
import type { ReconReport } from './fund-recon.types';

type Db = PrismaService | PrismaClient;

const logger = new Logger('PayoutGate');

/**
 * 出款闸门可接受的对账时效。
 * 超过这个时长就当结论已过期——不拦，但记日志，由定时巡检与告警接手。
 */
export const PAYOUT_GATE_MAX_AGE_HOURS = 26;

export interface PayoutGateStatus {
  allowed: boolean;
  /** ok=账平 | drift=账本异常 | released=人工放行中 | stale/no_report=暂无有效结论 */
  reason: 'ok' | 'drift' | 'released' | 'stale' | 'no_report';
  release?: { reason: string; expiresAt: string; createdById: string };
  lastCheckedAt?: string;
  totalBad?: number;
  /** 具体是哪几项在拦 */
  blocking?: string[];
}

/** 当前生效的人工放行；过期或已撤销的不算 */
export async function activePayoutRelease(db: Db) {
  return db.payoutGateRelease.findFirst({
    where: { revokedAt: null, expiresAt: { gt: new Date() } },
    orderBy: { expiresAt: 'desc' },
  });
}

/**
 * 读闸门状态。
 *
 * 只按「账本被破坏」那几项判断（见 fund-recon.service 的 GATING_CHECKS），
 * 信用盘偏离之类的正常业务波动不该停掉全站出款——拿正常波动去拦，
 * 结果就是所有人天天点放行，闸门也就废了。
 */
export async function payoutGateStatus(db: Db): Promise<PayoutGateStatus> {
  const release = await activePayoutRelease(db);
  if (release) {
    return {
      allowed: true,
      reason: 'released',
      release: {
        reason: release.reason,
        expiresAt: release.expiresAt.toISOString(),
        createdById: release.createdById,
      },
    };
  }

  const last = await db.fundReconRun.findFirst({ orderBy: { createdAt: 'desc' } });
  if (!last) return { allowed: true, reason: 'no_report' };

  const ageMs = Date.now() - last.createdAt.getTime();
  if (ageMs > PAYOUT_GATE_MAX_AGE_HOURS * 3600_000) {
    /*
     * 结论太旧就不作为依据。这里选择放行而不是拦死：
     * 拦死会让「定时巡检没跑起来」这一个运维问题直接停掉全部出款，
     * 影响面远大于它防的风险。缺口由巡检本身的告警补上。
     */
    logger.warn(
      `最近一次对账已过期（${Math.round(ageMs / 3600_000)} 小时前），闸门本次放行`,
    );
    return { allowed: true, reason: 'stale', lastCheckedAt: last.createdAt.toISOString() };
  }

  const report = last.report as unknown as ReconReport | null;
  const gatingBad = (report?.checks ?? []).filter((c) => c.gating && c.bad > 0);
  const count = gatingBad.reduce((n, c) => n + c.bad, 0);
  if (count > 0) {
    return {
      allowed: false,
      reason: 'drift',
      lastCheckedAt: last.createdAt.toISOString(),
      totalBad: count,
      blocking: gatingBad.map((c) => c.label),
    };
  }
  return {
    allowed: true,
    reason: 'ok',
    lastCheckedAt: last.createdAt.toISOString(),
    totalBad: 0,
  };
}

/**
 * 出款前的断言。放在「钱真正离开平台」的动作前面：
 * 下分单审核通过、后台直接下分、回收代理额度。
 *
 * 挡住的是「账已经花了还继续往外付」——那会把一个可查的记账问题
 * 变成不可逆的资金损失。
 */
export async function assertPayoutAllowed(db: Db, action: string): Promise<void> {
  const st = await payoutGateStatus(db);
  if (st.allowed) return;
  logger.error(
    `出款被闸门拦下：${action}，账本异常 ${st.totalBad} 处`
      + `（${(st.blocking ?? []).join('；')}），对账时间 ${st.lastCheckedAt}`,
  );
  throw new BadRequestException(
    `资金账本存在 ${st.totalBad} 处异常，为避免损失已暂停出款。`
      + '请管理员先在「资金对账」处理或知情放行',
  );
}
