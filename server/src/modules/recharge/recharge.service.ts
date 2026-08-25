import {
  Injectable,
  BadRequestException,
  ConflictException,
  NotFoundException,
  ForbiddenException,
  Inject,
  Optional,
  forwardRef,
} from '@nestjs/common';
import { randomInt } from 'node:crypto';
import type { Prisma } from '@prisma/client';
import {
  asMoney,
  PLAYER_DOWN_MIN,
  PLAYER_FUND_MAX,
  PLAYER_UP_MIN,
} from '@gamebox/shared';
import { resolveTimeWindow } from '../../common/shanghai-range';
import { PrismaService } from '../../prisma/prisma.service';
import { PointsService } from '../points/points.service';
import { AdminLogService } from '../admin/admin-log.service';
import { RiskDetectorService } from '../risk/risk-detector.service';
import { CsService } from '../cs/cs.service';
import { assertPayoutAllowed } from '../fund-recon/payout-gate.helper';
import {
  applyAgentCreditToPlayerInTx,
  applyCsCreditToPlayerInTx,
  settlePlayerDebitToAgentInTx,
  settleCsPlayerDebitInTx,
} from '../console/player-fund.helper';

function genOrderNo(): string {
  const now = new Date();
  const ts = now.toISOString().replace(/\D/g, '').slice(0, 14);
  const rand = randomInt(0, 1_000_000_000_000).toString().padStart(12, '0');
  return `${ts}${rand}`;
}

export type ApplyFundOpts = {
  skipCsNotify?: boolean;
  roomId?: string;
  roomNo?: string;
  /** 前端生成的订单号，兼作幂等键；不传则服务端自动生成（无防连点能力） */
  clientRequestId?: string;
};

@Injectable()
export class RechargeService {
  constructor(
    private prisma: PrismaService,
    private points: PointsService,
    private adminLog: AdminLogService,
    private riskDetector: RiskDetectorService,
    @Inject(forwardRef(() => CsService))
    private cs: CsService,
  ) {}

  /** 团队玩家 agentPath 前缀：AGENT 用自身；PROXY/CS 用上级主代理 */
  private async teamPlayerPrefix(
    tx: Prisma.TransactionClient | PrismaService,
    reviewerId: string,
  ): Promise<{ role: string; prefix: string } | null> {
    const reviewer = await tx.user.findUnique({
      where: { id: reviewerId },
      select: { role: true, agentPath: true, parentId: true },
    });
    if (!reviewer || !['AGENT', 'PROXY', 'CS'].includes(reviewer.role)) return null;
    if (reviewer.role === 'PROXY' || reviewer.role === 'CS') {
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

  private async reviewOrderScope(
    tx: Prisma.TransactionClient | PrismaService,
    reviewerId: string,
  ): Promise<{
    role: string;
    prefix: string;
    agentRootId: string;
    ownedRoomIds: string[];
  }> {
    const team = await this.teamPlayerPrefix(tx, reviewerId);
    if (!team) {
      throw new ForbiddenException('仅代理/客服可查看上下分申请');
    }
    const agentRootId = await this.agentRootUserId(tx, reviewerId);
    const ownedRoomIds = (
      await tx.room.findMany({
        where: { ownerAgent: { userId: agentRootId } },
        select: { id: true },
      })
    ).map((room) => room.id);
    return { ...team, agentRootId, ownedRoomIds };
  }

  /**
   * 有 roomId 的新订单只按房间归属授权；agentPath 仅兼容 roomId 为空的旧订单。
   * 列表、历史和处理动作必须复用这一条件，避免“看得见但不能批”或拒绝路径漏校验。
   */
  private reviewOrderWhere(scope: {
    prefix: string;
    ownedRoomIds: string[];
  }): Prisma.RechargeOrderWhereInput {
    return {
      OR: [
        ...(scope.ownedRoomIds.length
          ? [{ roomId: { in: scope.ownedRoomIds } }]
          : []),
        {
          roomId: null,
          player: { agentPath: { startsWith: scope.prefix } },
        },
        {
          roomId: '',
          player: { agentPath: { startsWith: scope.prefix } },
        },
      ],
    };
  }

  /**
   * 审核范围与控制台/客服会话对齐：
   * 1) 订单有 roomId：只能由该房主代理或其粘性客服处理
   * 2) 订单无 roomId：才允许按旧 agentPath 团队树兼容
   */
  private async assertReviewScope(
    tx: Prisma.TransactionClient,
    reviewerId: string,
    playerId: string,
    roomId?: string | null,
  ) {
    if (reviewerId === playerId) throw new ForbiddenException('不能审核自己的订单');
    const reviewer = await tx.user.findUnique({
      where: { id: reviewerId },
      select: { role: true },
    });
    if (reviewer?.role !== 'AGENT' && reviewer?.role !== 'CS') {
      throw new ForbiddenException('仅主代理或客服可审核玩家上下分');
    }
    const scope = await this.reviewOrderScope(tx, reviewerId);
    const rid = String(roomId || '').trim();
    if (rid) {
      const room = await tx.room.findFirst({
        where: {
          id: rid,
          ownerAgent: { userId: scope.agentRootId },
        },
        select: { id: true },
      });
      if (!room) {
        throw new ForbiddenException('只能审核所属房间的订单');
      }
    } else {
      const player = await tx.user.findUnique({
        where: { id: playerId },
        select: { agentPath: true },
      });
      if (!player) throw new NotFoundException('玩家不存在');
      if (!player.agentPath.startsWith(scope.prefix)) {
        throw new ForbiddenException('只能审核所属团队的历史订单');
      }
    }

    /* 客服还要过粘性派单：与控制台上下分、客服会话同一口径，
       否则任意客服都能审掉整个代理树下的单 */
    if (
      scope.role === 'CS' &&
      !(await this.cs.isAssignedToCs(reviewerId, playerId))
    ) {
      throw new ForbiddenException('该玩家未分配给你，无法审核');
    }
  }

  /** 解析并校验玩家 APPROVED 运营房间 */
  private async resolveOrderRoomId(
    tx: Prisma.TransactionClient | PrismaService,
    playerId: string,
    opts?: ApplyFundOpts,
  ): Promise<string> {
    const roomId = String(opts?.roomId || '').trim();
    if (roomId) {
      const member = await tx.roomMember.findFirst({
        where: { playerId, roomId, status: 'APPROVED' },
        select: { roomId: true },
      });
      if (!member) throw new BadRequestException('未加入该房间或未通过审核');
      return member.roomId;
    }
    const roomNo = String(opts?.roomNo || '').trim();
    if (roomNo) {
      const room = await tx.room.findFirst({
        where: { roomNo },
        select: { id: true },
      });
      if (!room) throw new BadRequestException('房间不存在');
      const member = await tx.roomMember.findFirst({
        where: { playerId, roomId: room.id, status: 'APPROVED' },
        select: { roomId: true },
      });
      if (!member) throw new BadRequestException('未加入该房间或未通过审核');
      return member.roomId;
    }
    /* CS 聊天等未传房号：取最近 APPROVED 房；多房时仍要求显式指定 */
    const members = await tx.roomMember.findMany({
      where: { playerId, status: 'APPROVED' },
      orderBy: { updatedAt: 'desc' },
      take: 2,
      select: { roomId: true },
    });
    if (members.length === 1) return members[0]!.roomId;
    if (members.length === 0) throw new BadRequestException('请先加入房间再申请上下分');
    throw new BadRequestException('请指定房间 roomId 或 roomNo');
  }

  /**
   * 订单号即幂等键：前端传就用前端的，不传退回服务端生成（此时没有防连点能力）。
   * 校验规则与控制台上下分的 assertFundOrderNo 一致。
   */
  private resolveOrderNo(clientRequestId?: string): string {
    const raw = String(clientRequestId || '').trim();
    if (!raw) return genOrderNo();
    if (!/^[A-Za-z0-9_-]{8,64}$/.test(raw)) {
      throw new BadRequestException('订单号格式无效');
    }
    return raw;
  }

  private normalizeChannel(channel?: string): string {
    return String(channel || '').trim() || '人工';
  }

  /** 同号重放的不可变参数必须完全一致，否则明确返回 409，不能静默复用旧单。 */
  private async findReplayedOrder(
    tx: Prisma.TransactionClient,
    orderNo: string,
    playerId: string,
    type: 'UP' | 'DOWN',
    amount: number,
    roomId: string,
    channel: string,
  ) {
    const existed = await tx.rechargeOrder.findUnique({ where: { orderNo } });
    if (
      !existed ||
      existed.playerId !== playerId ||
      existed.type !== type ||
      asMoney(existed.amount) !== asMoney(amount) ||
      String(existed.roomId || '').trim() !== roomId ||
      this.normalizeChannel(existed.channel ?? undefined) !== channel
    ) {
      throw new ConflictException('同一订单号的玩家、类型、金额、房间或渠道不一致');
    }
    return existed;
  }

  /** 同一订单号先串行再查重，避免唯一冲突使 PostgreSQL 事务进入 aborted 状态。 */
  private async lockOrderNoInTx(tx: Prisma.TransactionClient, orderNo: string) {
    await tx.$queryRaw<{ locked: string }[]>`
      SELECT pg_advisory_xact_lock(hashtextextended(${`recharge:${orderNo}`}, 0))::text AS locked
    `;
  }

  /** 事务内建上分单，供客服消息把消息、订单和回执原子提交。 */
  async applyRechargeInTx(
    tx: Prisma.TransactionClient,
    playerId: string,
    amount: number,
    channel?: string,
    opts?: ApplyFundOpts,
  ) {
    if (!Number.isInteger(amount) || amount < PLAYER_UP_MIN) {
      throw new BadRequestException(`上分最低 ${PLAYER_UP_MIN} 积分`);
    }
    if (amount > PLAYER_FUND_MAX) {
      throw new BadRequestException(`单笔上分不超过 ${PLAYER_FUND_MAX}`);
    }
    const orderNo = this.resolveOrderNo(opts?.clientRequestId);
    const normalizedChannel = this.normalizeChannel(channel);
    await this.lockOrderNoInTx(tx, orderNo);
    /* 房间是幂等请求的一部分，必须先解析业务语义再判断是否重放。 */
    const roomId = await this.resolveOrderRoomId(tx, playerId, opts);
    const replay = await tx.rechargeOrder.findUnique({ where: { orderNo } });
    if (replay) {
      return this.findReplayedOrder(
        tx,
        orderNo,
        playerId,
        'UP',
        amount,
        roomId,
        normalizedChannel,
      );
    }
    return tx.rechargeOrder.create({
      data: {
        orderNo,
        playerId,
        type: 'UP',
        amount,
        channel: normalizedChannel,
        status: 'PENDING',
        roomId,
      },
    });
  }

  /** 玩家申请上分（RECHARGE） */
  async applyRecharge(
    playerId: string,
    amount: number,
    channel?: string,
    opts?: ApplyFundOpts,
  ) {
    const order = await this.prisma.$transaction((tx) =>
      this.applyRechargeInTx(tx, playerId, amount, channel, opts),
    );

    if (!opts?.skipCsNotify) {
      void this.cs
        .notifyFundOrderSubmitted(playerId, {
          type: 'UP',
          amount,
          orderId: order.id,
          channel: order.channel,
        })
        .catch(() => undefined);
    }

    return order;
  }

  /** 事务内建下分单并冻结，订单号锁保证重放不会重复冻结。 */
  async applyWithdrawInTx(
    tx: Prisma.TransactionClient,
    playerId: string,
    amount: number,
    channel?: string,
    opts?: ApplyFundOpts,
  ) {
    if (!Number.isInteger(amount) || amount < PLAYER_DOWN_MIN) {
      throw new BadRequestException(`下分最低 ${PLAYER_DOWN_MIN} 积分`);
    }
    if (amount > PLAYER_FUND_MAX) {
      throw new BadRequestException(`单笔下分不超过 ${PLAYER_FUND_MAX}`);
    }
    const orderNo = this.resolveOrderNo(opts?.clientRequestId);
    const normalizedChannel = this.normalizeChannel(channel);
    await this.lockOrderNoInTx(tx, orderNo);
    const roomId = await this.resolveOrderRoomId(tx, playerId, opts);
    const replay = await tx.rechargeOrder.findUnique({ where: { orderNo } });
    if (replay) {
      return this.findReplayedOrder(
        tx,
        orderNo,
        playerId,
        'DOWN',
        amount,
        roomId,
        normalizedChannel,
      );
    }
    const account = await tx.pointsAccount.findUnique({
      where: this.points.accountWhere('PLAYER', playerId, roomId),
    });
    if (!account || asMoney(account.balance) < amount) throw new BadRequestException('余额不足');
    const created = await tx.rechargeOrder.create({
      data: {
        orderNo,
        playerId,
        type: 'DOWN',
        amount,
        status: 'PENDING',
        channel: normalizedChannel,
        roomId,
      },
    });
    await this.points.freezeInTx(tx, playerId, amount, {
      refType: 'recharge',
      refId: created.id,
      remark: '下分冻结（待客服审核）',
      idempotencyKey: `withdraw_freeze_${created.id}`,
      roomId,
    });
    return created;
  }

  /** 供把下分落在外层事务的调用方在提交后触发异步风控。 */
  onWithdrawCommitted(playerId: string, amount: number) {
    void this.riskDetector.onPlayerDebit(playerId, amount);
  }

  /** 玩家申请下分：冻结余额 + 建单；通过后出冻结并结算到代理；驳回解冻 */
  async applyWithdraw(
    playerId: string,
    amount: number,
    channel?: string,
    opts?: ApplyFundOpts,
  ) {
    const order = await this.prisma.$transaction((tx) =>
      this.applyWithdrawInTx(tx, playerId, amount, channel, opts),
    );

    this.onWithdrawCommitted(playerId, amount);

    if (!opts?.skipCsNotify) {
      void this.cs
        .notifyFundOrderSubmitted(playerId, {
          type: 'DOWN',
          amount,
          orderId: order.id,
          channel: order.channel,
        })
        .catch(() => undefined);
    }

    return order;
  }

  /** 审单归属主代理 userId（PROXY/CS → 上级） */
  private async agentRootUserId(
    tx: Prisma.TransactionClient | PrismaService,
    reviewerId: string,
  ): Promise<string> {
    const reviewer = await tx.user.findUnique({
      where: { id: reviewerId },
      select: { role: true, parentId: true },
    });
    if (
      (reviewer?.role === 'PROXY' || reviewer?.role === 'CS') &&
      reviewer.parentId
    ) {
      return reviewer.parentId;
    }
    return reviewerId;
  }

  /**
   * 下分通过：消费冻结额，再按超发/真分拆分结算到主代理。
   */
  private async restoreAgentAfterPlayerDown(
    tx: Prisma.TransactionClient,
    agentUserId: string,
    playerId: string,
    amount: number,
    orderId: string,
    reviewerId: string,
    roomId: string,
    orderNo?: string,
  ) {
    await this.points.consumeFrozenInTx(tx, playerId, amount, roomId);
    const no = String(orderNo || '').trim();
    return settlePlayerDebitToAgentInTx(tx, this.points, {
      agentUserId,
      playerId,
      amount,
      operatorId: reviewerId,
      remark: no ? `订单号 ${no}｜下分` : '下分审核结算',
      refType: 'recharge',
      refId: no || orderId,
      idemAgent: `recharge_approve_${orderId}:AGENT`,
      roomId,
    });
  }

  /** 代理/客服审核通过：UP 出账给玩家；DOWN 结算回代理或客服额度 */
  async approveRecharge(orderId: string, reviewerId: string) {
    /*
     * 下分是钱真正离开平台的动作，过闸门：对账不平时不准出款。
     * 上分是钱进来，不拦——账花了还继续收钱不会造成损失，拦了反而影响生意。
     * 闸门查询放在事务外：它自己可能要现跑一次对账，不该占着这笔审核的事务。
     */
    const pre = await this.prisma.rechargeOrder.findUnique({
      where: { id: orderId },
      select: { type: true },
    });
    if (pre?.type === 'DOWN') {
      await assertPayoutAllowed(this.prisma, `下分单审核 ${orderId}`);
    }
    return this.prisma.$transaction(async (tx) => {
      const order = await tx.rechargeOrder.findUnique({ where: { id: orderId } });
      if (!order) throw new NotFoundException('订单不存在');
      await this.assertReviewScope(tx, reviewerId, order.playerId, order.roomId);

      const reviewedAt = new Date();
      const claimed = await tx.rechargeOrder.updateMany({
        where: { id: orderId, status: 'PENDING' },
        data: { status: 'APPROVED', reviewerId, reviewedAt },
      });
      if (claimed.count === 0) throw new BadRequestException('订单已处理');

      const amount = asMoney(order.amount);
      const roomId = String(order.roomId || '').trim();
      if (!roomId) throw new BadRequestException('订单缺少房间，无法审核');
      const agentUserId = await this.agentRootUserId(tx, reviewerId);
      const reviewer = await tx.user.findUnique({
        where: { id: reviewerId },
        select: { role: true },
      });
      const byCs = reviewer?.role === 'CS';
      let ledgerId: string | undefined;
      let coverBack = 0;
      let overIssueBack = 0;
      let real = 0;
      let overIssue = 0;
      let wage = 0;

      if (order.type === 'UP') {
        if (byCs) {
          const staff = await tx.csStaff.findUnique({ where: { userId: reviewerId } });
          if (!staff || staff.parentAgentUserId !== agentUserId) {
            throw new ForbiddenException('客服档案无效');
          }
          const split = await applyCsCreditToPlayerInTx(tx, this.points, {
            csUserId: reviewerId,
            agentUserId,
            playerId: order.playerId,
            amount,
            operatorId: reviewerId,
            remark: `订单号 ${order.orderNo}｜上分`,
            refType: 'recharge',
            refId: order.orderNo,
            idemOut: `recharge_approve_${order.id}:OUT`,
            idemIn: `recharge_approve_${order.id}:IN`,
            wageRate: staff.wageRate,
            roomId,
          });
          real = split.real;
          wage = split.wage;
        } else {
          const split = await applyAgentCreditToPlayerInTx(tx, this.points, {
            agentUserId,
            playerId: order.playerId,
            amount,
            operatorId: reviewerId,
            remark: `订单号 ${order.orderNo}｜上分`,
            refType: 'recharge',
            refId: order.orderNo,
            idemOut: `recharge_approve_${order.id}:OUT`,
            idemIn: `recharge_approve_${order.id}:IN`,
            playerBizType: 'RECHARGE',
            roomId,
          });
          real = split.real;
          overIssue = split.overIssue;
        }
        const ledger = await tx.pointsLedger.findUnique({
          where: { idempotencyKey: `recharge_approve_${order.id}:IN` },
        });
        ledgerId = ledger?.id;
        if (ledgerId) {
          await tx.rechargeOrder.update({
            where: { id: orderId },
            data: { ledgerId },
          });
        }
      } else if (order.type === 'DOWN') {
        if (byCs) {
          const staff = await tx.csStaff.findUnique({ where: { userId: reviewerId } });
          if (!staff || staff.parentAgentUserId !== agentUserId) {
            throw new ForbiddenException('客服档案无效');
          }
          await this.points.consumeFrozenInTx(tx, order.playerId, amount, roomId);
          const restored = await settleCsPlayerDebitInTx(tx, this.points, {
            csUserId: reviewerId,
            agentUserId,
            playerId: order.playerId,
            amount,
            operatorId: reviewerId,
            remark: `订单号 ${order.orderNo}｜下分`,
            refType: 'recharge',
            refId: order.orderNo,
            idemCs: `recharge_approve_${order.id}:CS`,
            wageRate: staff.wageRate,
            roomId,
          });
          coverBack = restored.coverBack;
          wage = restored.wage;
        } else {
          const restored = await this.restoreAgentAfterPlayerDown(
            tx, agentUserId, order.playerId, amount, order.id, reviewerId, roomId, order.orderNo,
          );
          coverBack = restored.coverBack;
          overIssueBack = restored.overIssueBack;
        }
      }

      await this.adminLog.logInTx(tx, reviewerId, 'RECHARGE_APPROVE', orderId, {
        playerId: order.playerId,
        type: order.type,
        amount: order.amount,
        orderNo: order.orderNo,
        method: order.type === 'UP' ? '上分' : '下分',
        ledgerId,
        agentUserId,
        coverBack,
        overIssueBack,
        real,
        overIssue,
        fake: overIssue,
        wage,
        byCs,
      });
      return { ok: true, playerId: order.playerId, type: order.type, amount: order.amount };
    }).then(async (result) => {
      await this.pushCsSystemMessage(
        result.playerId,
        `${result.type === 'UP' ? '上分' : '下分'}${result.amount} 已通过`,
        orderId,
      );
      return { ok: true as const };
    });
  }

  /** 代理/管理员：拒绝上分 */
  async rejectOrder(orderId: string, reviewerId: string, reason: string) {
    return this.prisma.$transaction(async (tx) => {
      const order = await tx.rechargeOrder.findUnique({ where: { id: orderId } });
      if (!order) throw new NotFoundException('订单不存在');
      await this.assertReviewScope(tx, reviewerId, order.playerId, order.roomId);

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
        const roomId = String(order.roomId || '').trim();
        if (!roomId) throw new BadRequestException('订单缺少房间，无法解冻');
        await this.points.unfreezeToBalanceInTx(
          tx,
          order.playerId,
          asMoney(order.amount),
          {
            refType: 'recharge',
            refId: order.id,
            operatorId: reviewerId,
            remark: '下分未通过，冻结退回',
            idempotencyKey: `reject_${order.id}`,
            roomId,
          },
        );
      }

      await this.adminLog.logInTx(tx, reviewerId, 'RECHARGE_REJECT', orderId, {
        playerId: order.playerId,
        type: order.type,
        amount: order.amount,
        reason,
      });
      return {
        ok: true,
        playerId: order.playerId,
        type: order.type,
        amount: order.amount,
        reason,
      };
    }).then(async (result) => {
      const reasonText = result.reason?.trim() ? `（${result.reason.trim()}）` : '';
      await this.pushCsSystemMessage(
        result.playerId,
        `${result.type === 'UP' ? '上分' : '下分'}${result.amount} 未通过${reasonText}`,
        orderId,
      );
      return { ok: true as const };
    });
  }

  /**
   * 审单结果写入客服会话（失败不影响主流程）。
   * 顺带停掉响应计时——客服直接把单审掉了，动作比回一句话更实在，不该判成没回复。
   */
  private async pushCsSystemMessage(
    playerId: string,
    text: string,
    rechargeOrderId?: string,
  ) {
    try {
      await this.cs.pushSystemMessage(playerId, text, rechargeOrderId);
    } catch {
      /* ignore */
    }
    try {
      await this.cs.closeSlaRound(playerId);
    } catch {
      /* ignore */
    }
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
  async pendingOrders(reviewerId: string, page = 1, pageSize = 50, playerId?: string) {
    const scope = await this.reviewOrderScope(this.prisma, reviewerId);
    const pid = playerId?.trim() || '';
    const where: Prisma.RechargeOrderWhereInput = {
      status: 'PENDING',
      ...(pid ? { playerId: pid } : {}),
      AND: [this.reviewOrderWhere(scope)],
    };
    /* 与 assertReviewScope 对齐：客服只看派给自己的玩家，避免列出批不动的单 */
    if (scope.role === 'CS') {
      const assigned = await this.cs.assignedPlayerIdsForCs(reviewerId);
      where.playerId = pid
        ? (assigned.includes(pid) ? pid : '__none__')
        : { in: assigned.length ? assigned : ['__none__'] };
    }

    const [total, list] = await this.prisma.$transaction([
      this.prisma.rechargeOrder.count({ where }),
      this.prisma.rechargeOrder.findMany({
        where,
        orderBy: { createdAt: 'asc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: { player: { select: { id: true, uid: true, nickname: true, username: true } } },
      }),
    ]);
    /*
     * amount 必须过 asMoney 再出接口。
     * Prisma 的 Decimal 序列化成 JSON 是字符串，前端 formatMoney 收到字符串会算成 0.00，
     * 于是审核弹窗把一万块显示成 0.00 —— 审的人看不出金额。myOrders / reviewHistory
     * 都做了这层转换，只有这里漏了。
     */
    return {
      total,
      page,
      pageSize,
      list: list.map((o) => ({ ...o, amount: asMoney(o.amount) })),
    };
  }

  /**
   * 已审上下分明细：
   * - 客服：默认本人通过的单
   * - 代理：团队内已通过（可按 status/type 过滤）
   */
  async reviewHistory(
    reviewerId: string,
    page = 1,
    pageSize = 50,
    opts: {
      status?: string;
      type?: string;
      playerId?: string;
      range?: string;
      fromMs?: number;
      toMs?: number;
    } = {},
  ) {
    const scope = await this.reviewOrderScope(this.prisma, reviewerId);
    const statusRaw = (opts.status || 'APPROVED').trim().toUpperCase();
    const status =
      statusRaw === 'APPROVED' || statusRaw === 'REJECTED' || statusRaw === 'PENDING'
        ? statusRaw
        : 'APPROVED';
    const typeRaw = (opts.type || '').trim().toUpperCase();
    const type = typeRaw === 'UP' || typeRaw === 'DOWN' ? typeRaw : undefined;
    const pid = opts.playerId?.trim() || '';

    const where: Prisma.RechargeOrderWhereInput = {
      status,
      ...(type ? { type } : {}),
      ...(pid ? { playerId: pid } : {}),
    };
    const window = resolveTimeWindow({
      range: opts.range,
      fromMs: opts.fromMs,
      toMs: opts.toMs,
    });
    const and: Prisma.RechargeOrderWhereInput[] = [
      this.reviewOrderWhere(scope),
    ];
    if (window) {
      const [from, to] = window;
      /* 已审单按审核时间落在报表区间；无 reviewedAt 时回退创建时间 */
      and.push(
        {
          OR: [
            { reviewedAt: { gte: from, lt: to } },
            { reviewedAt: null, createdAt: { gte: from, lt: to } },
          ],
        },
      );
    }
    where.AND = and;
    if (scope.role === 'CS') {
      where.reviewerId = reviewerId;
    }

    const [total, list] = await this.prisma.$transaction([
      this.prisma.rechargeOrder.count({ where }),
      this.prisma.rechargeOrder.findMany({
        where,
        orderBy: { reviewedAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: { player: { select: { id: true, uid: true, nickname: true, username: true } } },
      }),
    ]);
    return {
      total,
      page,
      pageSize,
      list: list.map((o) => ({
        id: o.id,
        orderNo: o.orderNo,
        type: o.type,
        amount: asMoney(o.amount),
        status: o.status,
        channel: o.channel,
        rejectReason: o.rejectReason,
        createdAt: o.createdAt,
        reviewedAt: o.reviewedAt,
        playerId: o.playerId,
        player: o.player,
      })),
    };
  }

}
