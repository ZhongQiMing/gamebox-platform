/**
 * ActivityService — 活动发奖逻辑
 *
 * 支持活动类型：
 *   FIRST_DEPOSIT  首充奖励：首次上分审核通过后可领，按充值额阶梯给奖金
 *   VIP            VIP 等级礼包：累计充值≥门槛即可领取对应等级礼包
 *   NEWBIE         新人注册礼：注册后 24h 内可领固定奖励
 */
import { Injectable, BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { asMoney } from '@gamebox/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { PointsService, PLATFORM_OWNER_ID } from '../points/points.service';

interface ActivityConfig {
  tiers?: Array<{ minDeposit: number; reward: number }>;  // FIRST_DEPOSIT / VIP
  reward?: number;                                         // NEWBIE 固定奖励
  expiresHours?: number;                                   // NEWBIE 有效时长
}

@Injectable()
export class ActivityService {
  constructor(
    private prisma: PrismaService,
    private points: PointsService,
  ) {}

  /** 查询玩家可见的活动列表（含是否已领取） */
  async listForPlayer(playerId: string) {
    const now = new Date();
    const activities = await this.prisma.activity.findMany({
      where: {
        status: 'ONLINE',
        OR: [
          { startAt: null },
          { startAt: { lte: now } },
        ],
        AND: [
          {
            OR: [
              { endAt: null },
              { endAt: { gte: now } },
            ],
          },
        ],
      },
      orderBy: { createdAt: 'asc' },
    });

    const claims = await this.prisma.activityClaim.findMany({
      where: { playerId, activityId: { in: activities.map(a => a.id) } },
    });

    const claimMap = new Map(claims.map(c => [c.activityId, c]));

    return activities.map(act => ({
      id: act.id,
      code: act.code,
      type: act.type,
      title: act.title,
      bannerUrl: act.bannerUrl,
      config: act.config,
      claim: claimMap.get(act.id) ?? null,
    }));
  }

  /** 玩家领取一个活动奖励 */
  async claimActivity(playerId: string, activityId: string) {
    const act = await this.prisma.activity.findUnique({ where: { id: activityId } });
    if (!act || act.status !== 'ONLINE') throw new BadRequestException('活动不存在或已下线');

    const now = new Date();
    if (act.startAt && act.startAt > now) throw new BadRequestException('活动尚未开始');
    if (act.endAt   && act.endAt   < now) throw new BadRequestException('活动已结束');

    // 防重复领取（部分活动可多次领，但当前实现仅允许各领一次）
    const existing = await this.prisma.activityClaim.findFirst({
      where: { playerId, activityId },
    });
    if (existing) throw new BadRequestException('已领取过该活动奖励');

    const cfg = act.config as ActivityConfig;
    const reward = await this.calcReward(playerId, act.type, cfg);
    if (reward <= 0) throw new BadRequestException('暂不符合领取条件');

    try {
      return await this.prisma.$transaction(async (tx) => {
        // 先占用唯一领取记录，数据库约束作为并发场景下的最终防线。
        const claim = await tx.activityClaim.create({
          data: {
            activityId,
            playerId,
            rewardPoints: reward,
            status: 'PENDING',
          },
        });
        const idKey = `activity_${activityId}_${playerId}`;
        const { in: ledger } = await this.points.transferInTx(
          tx,
          {
            type: 'PLATFORM',
            id: PLATFORM_OWNER_ID,
            remark: `活动:${act.title}`,
            idempotencyKey: `${idKey}_plat`,
          },
          {
            type: 'PLAYER',
            id: playerId,
            remark: `活动奖励:${act.title}`,
            idempotencyKey: `${idKey}_player`,
          },
          reward,
          { bizType: 'ACTIVITY', remark: `活动奖励:${act.title}` },
        );
        const granted = await tx.activityClaim.update({
          where: { id: claim.id },
          data: { status: 'GRANTED', ledgerId: ledger.id },
        });
        return { claim: granted, reward };
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new BadRequestException('已领取过该活动奖励');
      }
      throw error;
    }
  }

  /** 根据活动类型计算本次应发奖励 */
  private async calcReward(
    playerId: string,
    type: string,
    cfg: ActivityConfig,
  ): Promise<number> {
    if (type === 'NEWBIE') {
      const user = await this.prisma.user.findUnique({ where: { id: playerId } });
      if (!user) return 0;
      const expiresHours = cfg.expiresHours ?? 24;
      const deadline = new Date(user.createdAt.getTime() + expiresHours * 3600_000);
      if (new Date() > deadline) return 0;
      return cfg.reward ?? 0;
    }

    if (type === 'FIRST_DEPOSIT' || type === 'VIP') {
      // 累计充值总额（仅计 UP 且 APPROVED）
      const agg = await this.prisma.rechargeOrder.aggregate({
        where: { playerId, type: 'UP', status: 'APPROVED' },
        _sum: { amount: true },
      });
      const totalDeposit = asMoney(agg._sum.amount ?? 0);

      const tiers = cfg.tiers ?? [];
      let reward = 0;
      for (const t of tiers) {
        if (totalDeposit >= t.minDeposit) reward = t.reward;
      }
      return reward;
    }

    return 0;
  }
}
