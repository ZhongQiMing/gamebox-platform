import {
  Injectable,
  BadRequestException,
  NotFoundException,
  ForbiddenException,
  Inject,
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

/** 唯一键冲突 */
function isUniqueConflict(e: unknown): boolean {
  return (e as { code?: string })?.code === 'P2002';
}

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

  /**
   * 审核范围与控制台/客服会话对齐：
   * 1) 订单房间属于主代理，且玩家在该房 APPROVED（同人多房按房间隔离）
   * 2) 或玩家挂在主代理 agentPath 团队树下（兼容旧挂线）
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
    const team = await this.teamPlayerPrefix(tx, reviewerId);
    if (!team) throw new ForbiddenException('仅代理/客服可审核玩家上下分申请');
    const player = await tx.user.findUnique({
      where: { id: playerId },
      select: { agentPath: true },
    });
    if (!player) throw new NotFoundException('玩家不存在');

    const agentRootId = await this.agentRootUserId(tx, reviewerId);
    const rid = String(roomId || '').trim();
    let inScope = false;
    if (rid) {
      const mem = await tx.roomMember.findFirst({
        where: {
          playerId,
          roomId: rid,
          status: 'APPROVED',
          room: { ownerAgent: { userId: agentRootId } },
        },
        select: { id: true },
      });
      inScope = !!mem;
    }
    if (!inScope && player.agentPath.startsWith(team.prefix)) {
      inScope = true;
    }
    if (!inScope) {
      throw new ForbiddenException('只能审核所属房间玩家的订单');
    }

    /* 客服还要过粘性派单：与控制台上下分、客服会话同一口径，
       否则任意客服都能审掉整个代理树下的单 */
    if (team.role === 'CS' && !(await this.cs.isAssignedToCs(reviewerId, playerId))) {
      throw new ForbiddenException('该玩家未分配给你，无法审核');
    }
  }

  /** 解析并校验玩家 APPROVED 运营房间 */
  private async resolveOrderRoomId(
    playerId: string,
    opts?: ApplyFundOpts,
  ): Promise<string> {
    const roomId = String(opts?.roomId || '').trim();
    if (roomId) {
      const member = await this.prisma.roomMember.findFirst({
        where: { playerId, roomId, status: 'APPROVED' },
        select: { roomId: true },
      });
      if (!member) throw new BadRequestException('未加入该房间或未通过审核');
      return member.roomId;
    }
    const roomNo = String(opts?.roomNo || '').trim();
    if (roomNo) {
      const room = await this.prisma.room.findFirst({
        where: { roomNo },
        select: { id: true },
      });
      if (!room) throw new BadRequestException('房间不存在');
      const member = await this.prisma.roomMember.findFirst({
        where: { playerId, roomId: room.id, status: 'APPROVED' },
        select: { roomId: true },
      });
      if (!member) throw new BadRequestException('未加入该房间或未通过审核');
      return member.roomId;
    }
    /* CS 聊天等未传房号：取最近 APPROVED 房；多房时仍要求显式指定 */
    const members = await this.prisma.roomMember.findMany({
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

  /** 同号重放：确认确实是本人同类型的那张单再返回，避免猜号拿到别人的订单 */
  private async findReplayedOrder(orderNo: string, playerId: string, type: 'UP' | 'DOWN') {
    const existed = await this.prisma.rechargeOrder.findUnique({ where: { orderNo } });
    if (!existed || existed.playerId !== playerId || existed.type !== type) {
      throw new BadRequestException('订单号已被占用，请重新提交');
    }
    return existed;
  }

  /** 玩家申请上分（RECHARGE） */
  async applyRecharge(
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

    const roomId = await this.resolveOrderRoomId(playerId, opts);
    const orderNo = this.resolveOrderNo(opts?.clientRequestId);
    let order;
    try {
      order = await this.prisma.rechargeOrder.create({
        data: {
          orderNo,
          playerId,
          type: 'UP',
          amount,
          channel: channel ?? '人工',
          status: 'PENDING',
          roomId,
        },
      });
    } catch (e) {
      /* 连点：同一个订单号只该有一张单，返回已建的那张而不是再建一张 */
      if (!isUniqueConflict(e)) throw e;
      return this.findReplayedOrder(orderNo, playerId, 'UP');
    }

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

  /** 玩家申请下分：冻结余额 + 建单；通过后出冻结并结算到代理；驳回解冻 */
  async applyWithdraw(
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

    const roomId = await this.resolveOrderRoomId(playerId, opts);
    const account = await this.prisma.pointsAccount.findUnique({
      where: this.points.accountWhere('PLAYER', playerId, roomId),
    });
    if (!account || asMoney(account.balance) < amount) throw new BadRequestException('余额不足');

    const orderNo = this.resolveOrderNo(opts?.clientRequestId);
    let order;
    try {
      order = await this.prisma.$transaction(async (tx) => {
        const created = await tx.rechargeOrder.create({
          data: {
            orderNo,
            playerId,
            type: 'DOWN',
            amount,
            status: 'PENDING',
            channel: channel ?? '人工',
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
      });
    } catch (e) {
      /*
       * 连点下分特别要命：每点一次就冻一笔，余额会被全部冻住，
       * 玩家看着钱在却动不了，还得客服一张张驳回。
       * 同号重放直接返回已建的单，不再冻第二笔。
       */
      if (!isUniqueConflict(e)) throw e;
      return this.findReplayedOrder(orderNo, playerId, 'DOWN');
    }

    void this.riskDetector.onPlayerDebit(playerId, amount);

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

  /** 审单结果写入客服会话（失败不影响主流程） */
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
    const team = await this.teamPlayerPrefix(this.prisma, reviewerId);
    if (!team) {
      throw new ForbiddenException('仅代理/客服可查看待审上下分');
    }
    const agentRootId = await this.agentRootUserId(this.prisma, reviewerId);
    const ownedRoomIds = (
      await this.prisma.room.findMany({
        where: { ownerAgent: { userId: agentRootId } },
        select: { id: true },
      })
    ).map((r) => r.id);
    const pid = playerId?.trim() || '';
    const where: Prisma.RechargeOrderWhereInput = {
      status: 'PENDING',
      ...(pid ? { playerId: pid } : {}),
      OR: [
        { player: { agentPath: { startsWith: team.prefix } } },
        ...(ownedRoomIds.length ? [{ roomId: { in: ownedRoomIds } }] : []),
      ],
    };
    /* 与 assertReviewScope 对齐：客服只看派给自己的玩家，避免列出批不动的单 */
    if (team.role === 'CS') {
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
        include: { player: { select: { id: true, uid: true, nickname: true } } },
      }),
    ]);
    return { total, page, pageSize, list };
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
    const team = await this.teamPlayerPrefix(this.prisma, reviewerId);
    if (!team) {
      throw new ForbiddenException('仅代理/客服可查看上下分明细');
    }
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
    if (window) {
      const [from, to] = window;
      /* 已审单按审核时间落在报表区间；无 reviewedAt 时回退创建时间 */
      where.AND = [
        {
          OR: [
            { reviewedAt: { gte: from, lt: to } },
            { reviewedAt: null, createdAt: { gte: from, lt: to } },
          ],
        },
      ];
    }
    if (team.role === 'CS') {
      where.reviewerId = reviewerId;
    } else {
      const agentRootId = await this.agentRootUserId(this.prisma, reviewerId);
      const ownedRoomIds = (
        await this.prisma.room.findMany({
          where: { ownerAgent: { userId: agentRootId } },
          select: { id: true },
        })
      ).map((r) => r.id);
      where.OR = [
        { player: { agentPath: { startsWith: team.prefix } } },
        ...(ownedRoomIds.length ? [{ roomId: { in: ownedRoomIds } }] : []),
      ];
    }

    const [total, list] = await this.prisma.$transaction([
      this.prisma.rechargeOrder.count({ where }),
      this.prisma.rechargeOrder.findMany({
        where,
        orderBy: { reviewedAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: { player: { select: { id: true, uid: true, nickname: true } } },
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
