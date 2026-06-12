import {
  Injectable, BadRequestException, NotFoundException, ForbiddenException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { PointsService } from '../points/points.service';

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
  ) {}

  /** 玩家申请上分（RECHARGE） */
  async applyRecharge(playerId: string, amount: number, channel?: string) {
    if (!Number.isInteger(amount) || amount < 1) throw new BadRequestException('上分金额必须为正整数');
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

  /** 玩家申请下分（WITHDRAW）——冻结余额 */
  async applyWithdraw(playerId: string, amount: number) {
    if (!Number.isInteger(amount) || amount < 1) throw new BadRequestException('下分金额必须为正整数');

    // 检查余额是否足够（乐观检查，结合事务保证）
    const account = await this.prisma.pointsAccount.findUnique({ where: { ownerId: playerId } });
    if (!account || account.balance < amount) throw new BadRequestException('余额不足');

    // 在事务内：先建订单拿到 id，再用 id 做幂等键冻结余额（保证幂等）
    return this.prisma.$transaction(async (tx) => {
      const orderNo = genOrderNo();
      const order = await tx.rechargeOrder.create({
        data: { orderNo, playerId, type: 'DOWN', amount, status: 'PENDING', channel: '人工' },
      });
      await this.points.creditInTx(tx, 'PLAYER', playerId, -amount, 'WITHDRAW', {
        refType: 'recharge', refId: order.id,
        remark: '下分冻结（待审核）',
        idempotencyKey: `freeze_${order.id}`,
      });
      return order;
    });
  }

  /** 代理/管理员：审核通过（UP 加积分 / DOWN 标记完成，余额已在申请时冻结） */
  async approveRecharge(orderId: string, reviewerId: string) {
    const order = await this.prisma.rechargeOrder.findUnique({ where: { id: orderId } });
    if (!order) throw new NotFoundException('订单不存在');
    if (order.status !== 'PENDING') throw new BadRequestException('订单已处理');

    if (order.type === 'UP') {
      // 上分：给玩家加积分
      const ledger = await this.points.credit(
        'PLAYER', order.playerId, order.amount, 'RECHARGE',
        { refType: 'recharge', refId: order.id, operatorId: reviewerId,
          idempotencyKey: `recharge_approve_${order.id}` },
      );
      await this.prisma.rechargeOrder.update({
        where: { id: orderId },
        data: { status: 'APPROVED', reviewerId, reviewedAt: new Date(), ledgerId: ledger.id },
      });
    } else {
      // 下分：余额已在申请时冻结（扣除），审核通过只需更新状态
      // 平台实际打款给玩家（线下操作），这里仅标记完成
      await this.prisma.rechargeOrder.update({
        where: { id: orderId },
        data: { status: 'APPROVED', reviewerId, reviewedAt: new Date() },
      });
    }

    return { ok: true };
  }

  /** 代理/管理员：拒绝上分 */
  async rejectOrder(orderId: string, reviewerId: string, reason: string) {
    const order = await this.prisma.rechargeOrder.findUnique({ where: { id: orderId } });
    if (!order) throw new NotFoundException('订单不存在');
    if (order.status !== 'PENDING') throw new BadRequestException('订单已处理');

    // 如果是下分且被拒绝，退还冻结的余额
    if (order.type === 'DOWN') {
      await this.points.credit(
        'PLAYER', order.playerId, order.amount, 'ADJUST',
        { refType: 'recharge', refId: order.id, operatorId: reviewerId,
          remark: '下分拒绝退款', idempotencyKey: `reject_${order.id}` },
      );
    }

    await this.prisma.rechargeOrder.update({
      where: { id: orderId },
      data: { status: 'REJECTED', reviewerId, reviewedAt: new Date(), rejectReason: reason },
    });
    return { ok: true };
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
    // 验证权限（必须是 AGENT / BRANCH / ADMIN）
    const reviewer = await this.prisma.user.findUnique({
      where: { id: reviewerId }, select: { role: true },
    });
    if (!reviewer || !['AGENT','BRANCH','ADMIN'].includes(reviewer.role)) {
      throw new ForbiddenException('无权操作');
    }

    const [total, list] = await this.prisma.$transaction([
      this.prisma.rechargeOrder.count({ where: { status: 'PENDING' } }),
      this.prisma.rechargeOrder.findMany({
        where: { status: 'PENDING' },
        orderBy: { createdAt: 'asc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: { player: { select: { uid: true, nickname: true } } },
      }),
    ]);
    return { total, page, pageSize, list };
  }
}
