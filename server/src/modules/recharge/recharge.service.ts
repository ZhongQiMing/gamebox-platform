import {
  Injectable, BadRequestException, NotFoundException, ForbiddenException,
} from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { asMoney, roundMoney } from '@gamebox/shared';
import { resolveTimeWindow } from '../../common/shanghai-range';
import { PrismaService } from '../../prisma/prisma.service';
import { PointsService } from '../points/points.service';
import { AdminLogService } from '../admin/admin-log.service';
import { RiskDetectorService } from '../risk/risk-detector.service';

function genOrderNo(): string {
  const now = new Date();
  const ts = now.toISOString().replace(/\D/g, '').slice(0, 14);
  const rand = Math.floor(Math.random() * 10000).toString().padStart(4, '0');
  return `${ts}${rand}`;
}

@Injectable()
export class RechargeService {
  constructor(
    private prisma: PrismaService,
    private points: PointsService,
    private adminLog: AdminLogService,
    private riskDetector: RiskDetectorService,
  ) {}

  /** 团队玩家 agentPath 前缀：AGENT 用自身；PROXY 用上级主代理 */
  private async teamPlayerPrefix(
    tx: Prisma.TransactionClient | PrismaService,
    reviewerId: string,
  ): Promise<{ role: string; prefix: string } | null> {
    const reviewer = await tx.user.findUnique({
      where: { id: reviewerId },
      select: { role: true, agentPath: true, parentId: true },
    });
    if (!reviewer || !['AGENT', 'PROXY'].includes(reviewer.role)) return null;
    if (reviewer.role === 'PROXY') {
      if (!reviewer.parentId) return null;
      const parent = await tx.user.findUnique({
        where: { id: reviewer.parentId },
        select: { id: true, role: true, agentPath: true },
      });
      if (!parent || parent.role !== 'AGENT') return null;
      return { role: reviewer.role, prefix: `${parent.agentPath}${parent.id}/` };
    }
    return { role: reviewer.role, prefix: `${reviewer.agentPath}${reviewerId}/` };
  }

  private async assertReviewScope(
    tx: Prisma.TransactionClient,
    reviewerId: string,
    playerId: string,
  ) {
    if (reviewerId === playerId) throw new ForbiddenException('不能审核自己的订单');
    const team = await this.teamPlayerPrefix(tx, reviewerId);
    // 玩家申请上下分仅由代理/代分审核；超管/房主走控制台直接上下分
    if (!team) throw new ForbiddenException('仅代理可审核玩家上下分申请');
    const player = await tx.user.findUnique({
      where: { id: playerId },
      select: { agentPath: true },
    });
    if (!player) throw new NotFoundException('玩家不存在');

    if (!player.agentPath.startsWith(team.prefix)) {
      throw new ForbiddenException('只能审核所属团队玩家的订单');
    }
  }

  /** 玩家申请上分（RECHARGE） */
  async applyRecharge(playerId: string, amount: number, channel?: string) {
    if (!Number.isInteger(amount) || amount < 200) throw new BadRequestException('上分最低 200 积分');
    if (amount > 10_000_000) throw new BadRequestException('单笔上分不超过 1000 万');

    return this.prisma.rechargeOrder.create({
      data: {
        orderNo: genOrderNo(),
        playerId,
        type: 'UP',
        amount,
        channel: channel ?? '人工',
        status: 'PENDING',
      },
    });
  }

  /** 玩家申请下分：立即扣余额 + 建单，客服通过即完成；驳回则退回余额 */
  async applyWithdraw(playerId: string, amount: number) {
    if (!Number.isInteger(amount) || amount < 500) {
      throw new BadRequestException('下分最低 500 积分');
    }

    // 检查余额是否足够（乐观检查，结合事务保证）
    const account = await this.prisma.pointsAccount.findUnique({ where: { ownerId: playerId } });
    if (!account || asMoney(account.balance) < amount) throw new BadRequestException('余额不足');

    // 在事务内：建单并立即扣除余额（驳回时再退回）
    const order = await this.prisma.$transaction(async (tx) => {
      const orderNo = genOrderNo();
      const created = await tx.rechargeOrder.create({
        data: { orderNo, playerId, type: 'DOWN', amount, status: 'PENDING', channel: '人工' },
      });
      await this.points.creditInTx(tx, 'PLAYER', playerId, -amount, 'WITHDRAW', {
        refType: 'recharge', refId: created.id,
        remark: '下分扣除（待客服审核）',
        idempotencyKey: `withdraw_${created.id}`,
      });
      return created;
    });

    // 申请时已扣款，按刷分规则检测（审核通过不再二次扣款）
    void this.riskDetector.onPlayerDebit(playerId, amount);

    return order;
  }

  /** 代分挂靠的主代理 userId（与控制台上下分同一归属） */
  private async agentRootUserId(
    tx: Prisma.TransactionClient,
    reviewerId: string,
  ): Promise<string> {
    const reviewer = await tx.user.findUnique({
      where: { id: reviewerId },
      select: { role: true, parentId: true },
    });
    if (reviewer?.role === 'PROXY' && reviewer.parentId) return reviewer.parentId;
    return reviewerId;
  }

  /**
   * 与控制台 debitPlayer 对齐：下分回代理钱包，并在 flyCover 内回冲真分额度。
   */
  private async restoreAgentAfterPlayerDown(
    tx: Prisma.TransactionClient,
    agentUserId: string,
    amount: number,
    orderId: string,
    reviewerId: string,
  ) {
    await this.points.creditInTx(tx, 'AGENT', agentUserId, amount, 'TRANSFER_IN', {
      refType: 'recharge',
      refId: orderId,
      operatorId: reviewerId,
      remark: '下分审核回代理',
      idempotencyKey: `recharge_approve_${orderId}:AGENT_IN`,
    });
    const agent = await tx.agent.findUnique({ where: { userId: agentUserId } });
    if (!agent) return 0;
    const coverBack = roundMoney(Math.min(amount, asMoney(agent.flyCover)));
    if (coverBack > 0) {
      await tx.agent.update({
        where: { userId: agentUserId },
        data: {
          flyCover: { decrement: coverBack },
          pointsQuota: { increment: coverBack },
          pointsUsed: { decrement: coverBack },
        },
      });
    }
    return coverBack;
  }

  /** 代理审核通过：UP 主代理出账给玩家；DOWN 玩家已扣款，回入主代理（对齐控制台） */
  async approveRecharge(orderId: string, reviewerId: string) {
    return this.prisma.$transaction(async (tx) => {
      const order = await tx.rechargeOrder.findUnique({ where: { id: orderId } });
      if (!order) throw new NotFoundException('订单不存在');
      await this.assertReviewScope(tx, reviewerId, order.playerId);

      const reviewedAt = new Date();
      const claimed = await tx.rechargeOrder.updateMany({
        where: { id: orderId, status: 'PENDING' },
        data: { status: 'APPROVED', reviewerId, reviewedAt },
      });
      if (claimed.count === 0) throw new BadRequestException('订单已处理');

      const amount = asMoney(order.amount);
      const agentUserId = await this.agentRootUserId(tx, reviewerId);
      let ledgerId: string | undefined;
      let coverBack = 0;
      let real = 0;
      let fake = 0;

      if (order.type === 'UP') {
        /* 与控制台 creditPlayer 一致：真分扣主代理钱包+额度→flyCover；假分只加玩家 */
        const agent = await tx.agent.findUnique({ where: { userId: agentUserId } });
        if (!agent) throw new BadRequestException('主代理账户不存在');
        const quota = asMoney(agent.pointsQuota);
        real = roundMoney(Math.min(amount, quota));
        fake = roundMoney(amount - real);
        if (real > 0) {
          await this.points.creditInTx(tx, 'AGENT', agentUserId, -real, 'TRANSFER_OUT', {
            refType: 'recharge',
            refId: order.id,
            operatorId: reviewerId,
            remark: '上分审核扣真分',
            idempotencyKey: `recharge_approve_${order.id}:OUT`,
          });
          await tx.agent.update({
            where: { userId: agentUserId },
            data: {
              pointsQuota: { decrement: real },
              pointsUsed: { increment: real },
              flyCover: { increment: real },
            },
          });
        }
        const ledger = await this.points.creditInTx(
          tx, 'PLAYER', order.playerId, amount, 'RECHARGE', {
            refType: 'recharge',
            refId: order.id,
            operatorId: reviewerId,
            remark: fake > 0 ? `上分到账(真${real}/假${fake})` : '上分到账',
            idempotencyKey: `recharge_approve_${order.id}:IN`,
          },
        );
        ledgerId = ledger.id;
        await tx.rechargeOrder.update({
          where: { id: orderId },
          data: { ledgerId },
        });
      } else if (order.type === 'DOWN') {
        /* 申请时已扣玩家；通过后回主代理，并回冲飞盘真分 */
        coverBack = await this.restoreAgentAfterPlayerDown(
          tx, agentUserId, amount, order.id, reviewerId,
        );
      }

      await this.adminLog.logInTx(tx, reviewerId, 'RECHARGE_APPROVE', orderId, {
        playerId: order.playerId,
        type: order.type,
        amount: order.amount,
        ledgerId,
        agentUserId,
        coverBack,
        real,
        fake,
      });
      return { ok: true };
    });
  }

  /** 代理/管理员：拒绝上分 */
  async rejectOrder(orderId: string, reviewerId: string, reason: string) {
    return this.prisma.$transaction(async (tx) => {
      const order = await tx.rechargeOrder.findUnique({ where: { id: orderId } });
      if (!order) throw new NotFoundException('订单不存在');
      await this.assertReviewScope(tx, reviewerId, order.playerId);

      const claimed = await tx.rechargeOrder.updateMany({
        where: { id: orderId, status: 'PENDING' },
        data: {
          status: 'REJECTED',
          reviewerId,
          reviewedAt: new Date(),
          rejectReason: reason,
        },
      });
      if (claimed.count === 0) throw new BadRequestException('订单已处理');

      if (order.type === 'DOWN') {
        await this.points.creditInTx(
          tx,
          'PLAYER',
          order.playerId,
          asMoney(order.amount),
          'ADJUST',
          {
            refType: 'recharge',
            refId: order.id,
            operatorId: reviewerId,
            remark: '下分未通过，余额返还',
            idempotencyKey: `reject_${order.id}`,
          },
        );
      }

      await this.adminLog.logInTx(tx, reviewerId, 'RECHARGE_REJECT', orderId, {
        playerId: order.playerId,
        type: order.type,
        amount: order.amount,
        reason,
      });
      return { ok: true };
    });
  }

  /** 玩家查询自己的充值/提现记录（可按时段；附带上分/下分与审核状态汇总） */
  async myOrders(
    playerId: string,
    page = 1,
    pageSize = 20,
    fromMs?: number,
    toMs?: number,
    rangeKey?: string,
  ) {
    const where: Prisma.RechargeOrderWhereInput = { playerId };
    const window = resolveTimeWindow({ range: rangeKey, fromMs, toMs });
    if (window) {
      const [from, to] = window;
      where.createdAt = { gte: from, lt: to };
    }

    const [total, list] = await this.prisma.$transaction([
      this.prisma.rechargeOrder.count({ where }),
      this.prisma.rechargeOrder.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        select: {
          id: true,
          orderNo: true,
          type: true,
          amount: true,
          status: true,
          channel: true,
          rejectReason: true,
          createdAt: true,
        },
      }),
    ]);

    const [byType, byStatus] = await Promise.all([
      this.prisma.rechargeOrder.groupBy({
        by: ['type'],
        where,
        _count: { _all: true },
        _sum: { amount: true },
      }),
      this.prisma.rechargeOrder.groupBy({
        by: ['status'],
        where,
        _count: { _all: true },
      }),
    ]);

    const summary = {
      upCount: 0,
      upAmount: 0,
      downCount: 0,
      downAmount: 0,
      pendingCount: 0,
      approvedCount: 0,
      rejectedCount: 0,
    };
    for (const row of byType) {
      const cnt = row._count._all;
      if (row.type === 'UP') {
        summary.upCount = cnt;
        summary.upAmount = asMoney(row._sum.amount ?? 0);
      } else if (row.type === 'DOWN') {
        summary.downCount = cnt;
        summary.downAmount = asMoney(row._sum.amount ?? 0);
      }
    }
    for (const row of byStatus) {
      const cnt = row._count._all;
      if (row.status === 'PENDING') summary.pendingCount = cnt;
      else if (row.status === 'APPROVED') summary.approvedCount = cnt;
      else if (row.status === 'REJECTED') summary.rejectedCount = cnt;
    }

    return {
      total,
      page,
      pageSize,
      summary,
      list: list.map((o) => ({
        id: o.id,
        orderNo: o.orderNo,
        type: o.type as 'UP' | 'DOWN',
        amount: asMoney(o.amount),
        status: o.status as 'PENDING' | 'APPROVED' | 'REJECTED',
        channel: o.channel,
        rejectReason: o.rejectReason,
        createdAt: o.createdAt,
      })),
    };
  }

  /** 代理/代分：待审核订单列表 */
  async pendingOrders(reviewerId: string, page = 1, pageSize = 50) {
    const team = await this.teamPlayerPrefix(this.prisma, reviewerId);
    if (!team) {
      throw new ForbiddenException('仅代理可查看待审上下分');
    }
    const where: Prisma.RechargeOrderWhereInput = {
      status: 'PENDING',
      player: {
        agentPath: { startsWith: team.prefix },
      },
    };

    const [total, list] = await this.prisma.$transaction([
      this.prisma.rechargeOrder.count({ where }),
      this.prisma.rechargeOrder.findMany({
        where,
        orderBy: { createdAt: 'asc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: { player: { select: { uid: true, nickname: true } } },
      }),
    ]);
    return { total, page, pageSize, list };
  }

}
