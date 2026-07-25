import {
  Injectable, BadRequestException, NotFoundException, ForbiddenException,
} from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { PointsService } from '../points/points.service';
import { AdminLogService } from '../admin/admin-log.service';

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
  ) {}

  private async assertReviewScope(
    tx: Prisma.TransactionClient,
    reviewerId: string,
    playerId: string,
  ) {
    if (reviewerId === playerId) throw new ForbiddenException('不能审核自己的订单');
    const [reviewer, player] = await Promise.all([
      tx.user.findUnique({
        where: { id: reviewerId },
        select: { role: true, agentPath: true },
      }),
      tx.user.findUnique({
        where: { id: playerId },
        select: { agentPath: true },
      }),
    ]);
    if (!reviewer || !['AGENT', 'BRANCH', 'ADMIN'].includes(reviewer.role)) {
      throw new ForbiddenException('无权操作');
    }
    if (!player) throw new NotFoundException('玩家不存在');
    if (reviewer.role === 'ADMIN') return;

    const teamPrefix = `${reviewer.agentPath}${reviewerId}/`;
    if (!player.agentPath.startsWith(teamPrefix)) {
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
    if (!account || account.balance < amount) throw new BadRequestException('余额不足');

    // 在事务内：建单并立即扣除余额（驳回时再退回）
    return this.prisma.$transaction(async (tx) => {
      const orderNo = genOrderNo();
      const order = await tx.rechargeOrder.create({
        data: { orderNo, playerId, type: 'DOWN', amount, status: 'PENDING', channel: '人工' },
      });
      await this.points.creditInTx(tx, 'PLAYER', playerId, -amount, 'WITHDRAW', {
        refType: 'recharge', refId: order.id,
        remark: '下分扣除（待客服审核）',
        idempotencyKey: `withdraw_${order.id}`,
      });
      return order;
    });
  }

  /** 代理/管理员：审核通过（UP 加积分 / DOWN 标记完成，余额已在申请时扣除） */
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

      let ledgerId: string | undefined;
      if (order.type === 'UP') {
        const ledger = await this.points.creditInTx(
          tx,
          'PLAYER',
          order.playerId,
          order.amount,
          'RECHARGE',
          {
            refType: 'recharge',
            refId: order.id,
            operatorId: reviewerId,
            idempotencyKey: `recharge_approve_${order.id}`,
          },
        );
        ledgerId = ledger.id;
        await tx.rechargeOrder.update({
          where: { id: orderId },
          data: { ledgerId },
        });
      }

      await this.adminLog.logInTx(tx, reviewerId, 'RECHARGE_APPROVE', orderId, {
        playerId: order.playerId,
        type: order.type,
        amount: order.amount,
        ledgerId,
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
          order.amount,
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

  /** 玩家查询自己的充值/提现记录 */
  async myOrders(playerId: string, page = 1, pageSize = 20) {
    const [total, list] = await this.prisma.$transaction([
      this.prisma.rechargeOrder.count({ where: { playerId } }),
      this.prisma.rechargeOrder.findMany({
        where: { playerId },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        select: { id: true, orderNo: true, type: true, amount: true, status: true,
          channel: true, rejectReason: true, createdAt: true },
      }),
    ]);
    return { total, page, pageSize, list };
  }

  /** 代理/管理员：待审核订单列表 */
  async pendingOrders(reviewerId: string, page = 1, pageSize = 50) {
    const reviewer = await this.prisma.user.findUnique({
      where: { id: reviewerId }, select: { role: true, agentPath: true },
    });
    if (!reviewer || !['AGENT', 'BRANCH', 'ADMIN'].includes(reviewer.role)) {
      throw new ForbiddenException('无权操作');
    }
    const where: Prisma.RechargeOrderWhereInput = { status: 'PENDING' };
    if (reviewer.role !== 'ADMIN') {
      where.player = {
        agentPath: { startsWith: `${reviewer.agentPath}${reviewerId}/` },
      };
    }

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
