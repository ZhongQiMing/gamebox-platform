/**
 * 级联额度 + 玩家上下分：
 * - 给代理上分 = 向平台买盘分额度（余额+上盘额度同加）
 * - 给玩家上分 = 玩家向代理买分（扣盘分 → 加玩家）
 * - 给玩家下分 = 代理向玩家买回（扣玩家 → 加回盘分）
 */
import {
  BadRequestException, ForbiddenException, Injectable, NotFoundException,
} from '@nestjs/common';
import {
  asMoney,
  isValidMoney,
  PLAYER_DOWN_MIN,
  PLAYER_FUND_MAX,
  PLAYER_UP_MIN,
  roundMoney,
} from '@gamebox/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { PointsService, PLATFORM_OWNER_ID, type OwnerType } from '../points/points.service';
import { AdminLogService } from '../admin/admin-log.service';
import { ConsoleScopeService, type ConsoleActor } from './console-scope.service';
import { RiskDetectorService } from '../risk/risk-detector.service';
import {
  applyAgentCreditToPlayerInTx,
  applyCsCreditToPlayerInTx,
  assertFundOrderNo,
  settlePlayerDebitToAgentInTx,
  settleCsPlayerDebitInTx,
  withOrderRemark,
  writeAgentQuotaInTx,
} from './player-fund.helper';
import {
  cashDiskFlyAvailable,
  creditDiskFlyAvailable,
  sumAgentCsBalances,
} from './credit-settle.helper';
import { CommissionService } from '../agents/commission.service';

const ISSUE_MAX = 50_000_000;

@Injectable()
export class ConsoleWalletService {
  constructor(
    private prisma: PrismaService,
    private points: PointsService,
    private adminLog: AdminLogService,
    private scope: ConsoleScopeService,
    private riskDetector: RiskDetectorService,
    private commission: CommissionService,
  ) {}

  async myBalance(actor: ConsoleActor) {
    const ownerType = this.scope.ownerTypeOf(actor.role);
    // 管理员/房主共用平台池给代理记账上下分，无个人可分余额（勿查 BRANCH 小金库）
    if (actor.role === 'ADMIN' || actor.role === 'BRANCH') {
      return {
        ownerType,
        ownerId: actor.role === 'ADMIN' ? PLATFORM_OWNER_ID : actor.id,
        balance: null,
        noPersonalWallet: true,
        poolMode: true,
      };
    }

    const ownerId = this.scope.walletOwnerId(actor);
    const acc = await this.prisma.pointsAccount.findFirst({
      where: { ownerType: ownerType as never, ownerId, roomId: '' },
    });
    const base = {
      ownerType,
      ownerId,
      balance: asMoney(acc?.balance ?? 0),
    };
    /* 总代：可用额度、合同额度与自己的费率——建房时代理的上限就是按这两个费率卡的 */
    if (actor.role === 'GENERAL') {
      const agent = await this.prisma.agent.findUnique({
        where: { userId: actor.id },
        select: {
          pointsQuota: true,
          creditLimit: true,
          bookMode: true,
          flowRate: true,
          shareRate: true,
          settleCycle: true,
        },
      });
      const quota = asMoney(agent?.pointsQuota ?? 0);
      return {
        ...base,
        bookMode: agent?.bookMode === 'CREDIT' ? 'CREDIT' : 'CASH',
        creditLimit: asMoney(agent?.creditLimit ?? 0),
        pointsQuota: quota,
        /* 额度发超了就是欠平台的，负数在这里翻成正的欠额 */
        overIssueUsed: roundMoney(Math.max(0, -quota)),
        flowRate: Number(agent?.flowRate ?? 0.07),
        shareRate: Number(agent?.shareRate ?? 0.5),
        settleCycle: agent?.settleCycle ?? 'WEEKLY_MON',
      };
    }

    if (!['AGENT', 'PROXY', 'CS'].includes(actor.role)) return base;

    // PROXY 上盘额度/飞盘在主代理账上；自己钱包余额仍用 walletOwnerId
    const agentUserId =
      actor.role === 'PROXY' ? await this.scope.scopeRootUserId(actor) : actor.id;
    const agent = await this.prisma.agent.findUnique({ where: { userId: agentUserId } });
    if (!agent) return base;

    const playerIds = await this.scopedPlayerIds(actor);
    let playerPointsTotal = 0;
    if (playerIds.length) {
      const scopedRooms = await this.scope.grantedRoomIds(actor);
      const roomFilter =
        scopedRooms && scopedRooms.length === 1
          ? { roomId: scopedRooms[0]! }
          : scopedRooms && scopedRooms.length > 1
            ? { roomId: { in: scopedRooms } }
            : {};
      const accs = await this.prisma.pointsAccount.findMany({
        where: {
          ownerId: { in: playerIds },
          ownerType: 'PLAYER',
          ...roomFilter,
        },
        select: { balance: true },
      });
      for (const a of accs) playerPointsTotal += asMoney(a.balance);
    }
    const pointsQuota = asMoney(agent.pointsQuota);
    const rooms = await this.prisma.room.findMany({
      where: { ownerAgentId: agent.id },
      select: {
        id: true,
        bookMode: true,
        creditLimit: true,
        agentShareRate: true,
        settleCycle: true,
        createdAt: true,
      },
      orderBy: { createdAt: 'asc' },
    });
    /* 主绑定房：取最早创建的一间（与房间列表默认一致） */
    const primary = rooms[0] ?? null;
    const bookMode = primary?.bookMode === 'CREDIT' ? 'CREDIT' : primary ? 'CASH' : undefined;
    const csBalances = await sumAgentCsBalances(this.prisma, agent.userId);
    /* 现金/信用可飞同一套：盘分(≥0部分)+客服未发出 */
    const flyAvailable =
      bookMode === 'CREDIT'
        ? await creditDiskFlyAvailable(this.prisma, agent.userId)
        : await cashDiskFlyAvailable(this.prisma, agent.userId);
    /** 未进玩家账的池：额度可为负（超分）；客服未发出仍按 ≥0 */
    const diskPoolRemaining = roundMoney(pointsQuota + Math.max(0, csBalances));
    const overIssueUsed = roundMoney(Math.max(0, -pointsQuota));
    return {
      ...base,
      pointsQuota,
      csBalances,
      diskPoolRemaining,
      flyCover: flyAvailable,
      flyAvailable,
      playerPointsTotal: roundMoney(playerPointsTotal),
      overIssueUsed,
      overIssueLimit: 0,
      fakeExposure: overIssueUsed,
      bookMode,
      creditLimit: primary ? asMoney(primary.creditLimit) : undefined,
      agentShareRate: primary != null ? Number(primary.agentShareRate ?? 0) : undefined,
      settleCycle: primary?.settleCycle ?? undefined,
      primaryRoomId: primary?.id,
      /** 顶栏信用展示：未发总额（剩余信用+客服） */
      creditUnused: bookMode === 'CREDIT' ? diskPoolRemaining : undefined,
    };
  }

  private async scopedPlayerIds(actor: ConsoleActor): Promise<string[]> {
    const where = await this.scope.playerWhere(actor);
    const rows = await this.prisma.user.findMany({
      where,
      select: { id: true },
      take: 50_000,
    });
    return rows.map((r) => r.id);
  }

  /**
   * 级联下发：
   * 给 AGENT 时同步增加上盘额度 pointsQuota（与余额同加）
   * 给 PLAYER 时走 creditPlayer（扣盘分/剩余信用 → 加玩家）
   */
  async issue(
    actor: ConsoleActor,
    toUserId: string,
    amountRaw: number,
    remark?: string,
    clientRequestId?: string,
  ) {
    const orderNo = assertFundOrderNo(clientRequestId);
    const amount = roundMoney(amountRaw);
    if (!isValidMoney(amount) || amount <= 0) {
      throw new BadRequestException('金额无效');
    }
    if (amount > ISSUE_MAX) throw new BadRequestException(`单笔上限 ${ISSUE_MAX}`);
    if (toUserId === actor.id) throw new BadRequestException('不能给自己上分');

    const target = await this.prisma.user.findUnique({
      where: { id: toUserId },
      select: { id: true, role: true, status: true },
    });
    if (!target || target.status === 'DISABLED') {
      throw new NotFoundException('目标用户不存在或已停用');
    }

    if (target.role === 'BRANCH') {
      throw new BadRequestException('管理员与房主同级、共用平台盘口池，请直接给代理上分（只记流水）');
    }
    if (target.role === 'PROXY') {
      throw new BadRequestException('子账号与主代理共用额度，请给主代理上分');
    }
    this.assertIssueHierarchy(actor.role, target.role);
    if (actor.role !== 'ADMIN') {
      await this.scope.assertUserInScope(actor, toUserId);
    }

    if (target.role === 'PLAYER') {
      throw new BadRequestException('玩家上分请使用 credit-player 并指定 roomId');
    }

    if (target.role === 'GENERAL') {
      /* 信用盘总代的额度由合同额度决定，改合同才是唯一入口，避免两个口径打架 */
      if ((await this.generalBookMode(target.id)) === 'CREDIT') {
        throw new BadRequestException(
          '信用盘总代不能用上分加款；请在账号中心用「调整信用额度」同步改合同与剩余信用',
        );
      }
    } else if (await this.agentHasCreditRoom(toUserId)) {
      throw new BadRequestException(
        '信用盘代理不能用上下分加款；请在房间详情用「调整信用额度」同步增加合同与剩余信用',
      );
    }

    const overIssue = actor.role === 'GENERAL'
      ? await this.generalOverIssue(actor.id, amount)
      : 0;

    const res = await this.sellQuotaToStaff(
      actor,
      target.id,
      target.role,
      amount,
      withOrderRemark(
        orderNo,
        remark,
        target.role === 'GENERAL' ? '控制台给总代上分' : '控制台给代理上分',
      ),
      orderNo,
    );
    /* 超发不拦，但要让操作方看见自己这一笔垫了多少 */
    return overIssue > 0 ? { ...res, overIssue } : res;
  }

  /**
   * 回收额度（下分）：从代理扣回余额与上盘额度，退回操作方。
   * 不可超过对方当前余额与上盘额度（pointsQuota）的较小值。
   */
  async recall(
    actor: ConsoleActor,
    fromUserId: string,
    amountRaw: number,
    remark?: string,
    clientRequestId?: string,
  ) {
    const orderNo = assertFundOrderNo(clientRequestId);
    const amount = roundMoney(amountRaw);
    if (!isValidMoney(amount) || amount <= 0) {
      throw new BadRequestException('金额无效');
    }
    if (amount > ISSUE_MAX) throw new BadRequestException(`单笔上限 ${ISSUE_MAX}`);
    if (fromUserId === actor.id) throw new BadRequestException('不能从自己下分');

    const target = await this.prisma.user.findUnique({
      where: { id: fromUserId },
      select: { id: true, role: true, status: true },
    });
    if (!target || target.status === 'DISABLED') {
      throw new NotFoundException('目标用户不存在或已停用');
    }
    if (target.role !== 'AGENT' && target.role !== 'GENERAL') {
      throw new BadRequestException(
        target.role === 'PROXY'
          ? '子账号与主代理共用额度，请从主代理回收'
          : '只能从总代或代理回收额度（管理员与房主同级，无上下分关系）',
      );
    }

    this.assertIssueHierarchy(actor.role, target.role);
    if (actor.role !== 'ADMIN') {
      await this.scope.assertUserInScope(actor, fromUserId);
    }

    if (target.role === 'GENERAL') {
      if ((await this.generalBookMode(target.id)) === 'CREDIT') {
        throw new BadRequestException(
          '信用盘总代不能用下分回收；请用「调整信用额度」下调合同额度',
        );
      }
    } else if (await this.agentHasCreditRoom(fromUserId)) {
      throw new BadRequestException(
        '信用盘代理不能用下分回收；信用只随玩家下分买回 / 收回客服额度回升',
      );
    }

    return this.recallQuotaFromStaff(
      actor,
      target.id,
      target.role,
      amount,
      withOrderRemark(orderNo, remark, '控制台回收额度'),
      orderNo,
    );
  }

  /** 主代理是否绑定信用盘房间（信用盘禁用代理上下分） */
  private async agentHasCreditRoom(agentUserId: string): Promise<boolean> {
    const agent = await this.prisma.agent.findUnique({
      where: { userId: agentUserId },
      select: { id: true },
    });
    if (!agent) return false;
    const n = await this.prisma.room.count({
      where: { ownerAgentId: agent.id, bookMode: 'CREDIT' },
    });
    return n > 0;
  }

  /**
   * 下发额度：加接收方余额 + 上盘额度。
   * 出资方：管理/总监走平台池；现金盘总代走自己钱包（那是他真金买来的分）；
   * 信用盘总代手上只是平台给的信用，真钱仍从平台池出，另扣他的额度记这笔欠。
   */
  private async sellQuotaToStaff(
    actor: ConsoleActor,
    toUserId: string,
    toRole: string,
    amount: number,
    remark: string,
    orderNo: string,
  ) {
    if (toRole !== 'AGENT' && toRole !== 'PROXY' && toRole !== 'GENERAL') {
      throw new BadRequestException('只能给总代、代理或子账号上分');
    }
    const payerBook = actor.role === 'GENERAL' ? await this.generalBookMode(actor.id) : null;
    /* 超管、房主共用平台池，不扣各自小金库 */
    const fromPool =
      actor.role === 'ADMIN' || actor.role === 'BRANCH' || payerBook === 'CREDIT';
    const fromType = (fromPool ? 'PLATFORM' : this.scope.ownerTypeOf(actor.role)) as OwnerType;
    const fromId = fromPool ? PLATFORM_OWNER_ID : actor.id;
    const toType = this.scope.ownerTypeOf(toRole) as OwnerType;
    /* 幂等键锚定订单号：原先拼 Date.now()，两次点击间隔 >1ms 就是两个键，等于没有幂等 */
    const idemBase = `console_quota:${orderNo}`;

    await this.prisma.$transaction(async (tx) => {
      const existed = await tx.pointsLedger.findUnique({
        where: { idempotencyKey: `${idemBase}:IN` },
        select: { id: true },
      });
      if (existed) return;
      await this.points.transferInTx(
        tx,
        {
          type: fromType,
          id: fromId,
          remark,
          idempotencyKey: `${idemBase}:OUT`,
        },
        {
          type: toType,
          id: toUserId,
          remark,
          idempotencyKey: `${idemBase}:IN`,
        },
        amount,
        {
          bizType: 'TRANSFER_OUT',
          bizTypeIn: 'TRANSFER_IN',
          operatorId: actor.id,
          remark,
          refType: 'console_quota',
          refId: toUserId,
        },
      );
      await writeAgentQuotaInTx(tx, {
        agentUserId: toUserId,
        bookMode: 'CASH',
        delta: amount,
        bizType: 'TRANSFER_IN',
        remark,
        refType: 'console_quota',
        refId: toUserId,
        idempotencyKey: `${idemBase}:QUOTA`,
        /* 子账号首次买分时 Agent 行还不存在 */
        createIfMissing: true,
      });
      /*
       * 总代出资：额度从他手上划走。现金盘的余额已由上面的转账扣过，
       * 信用盘没动余额，这一笔就是他欠平台的凭据。
       */
      if (actor.role === 'GENERAL') {
        await writeAgentQuotaInTx(tx, {
          agentUserId: actor.id,
          bookMode: payerBook === 'CREDIT' ? 'CREDIT' : 'CASH',
          delta: -amount,
          bizType: 'TRANSFER_OUT',
          remark: `${remark}（下发给代理）`,
          refType: 'console_quota',
          refId: toUserId,
          idempotencyKey: `${idemBase}:PAYER_QUOTA`,
        });
      }
      await this.adminLog.logInTx(tx, actor.id, 'QUOTA_SELL', toUserId, {
        amount,
        fromType,
        fromId,
        fromRole: actor.role,
        toRole,
        remark,
        direction: 'IN',
        pool: fromPool ? 'PLATFORM' : 'SELF',
        ...(payerBook ? { payerBookMode: payerBook } : {}),
      });
    });

    /* 盘分补足后自动补发挂靠佣金欠账 */
    this.commission.triggerSettleForPayer(toUserId);

    return { ok: true, ...(await this.myBalance(actor)) };
  }

  /** 从总代/代理/子账号回收额度，退回平台池（超管/房主操作时）或操作方钱包 */
  private async recallQuotaFromStaff(
    actor: ConsoleActor,
    fromUserId: string,
    fromRole: string,
    amount: number,
    remark: string,
    orderNo: string,
  ) {
    if (fromRole !== 'AGENT' && fromRole !== 'PROXY' && fromRole !== 'GENERAL') {
      throw new BadRequestException('只能从总代、代理或子账号回收');
    }
    const payerBook = actor.role === 'GENERAL' ? await this.generalBookMode(actor.id) : null;
    /* 与下发对称：信用盘总代的真钱本来就没经他手，退也退回平台池 */
    const toPool =
      actor.role === 'ADMIN' || actor.role === 'BRANCH' || payerBook === 'CREDIT';
    const toType = (toPool ? 'PLATFORM' : this.scope.ownerTypeOf(actor.role)) as OwnerType;
    const toId = toPool ? PLATFORM_OWNER_ID : actor.id;
    const staffType = this.scope.ownerTypeOf(fromRole) as OwnerType;
    /* 幂等键锚定订单号；原先的 Date.now() 让连点变成两笔独立回收 */
    const idemBase = `console_quota_recall:${orderNo}`;

    await this.prisma.$transaction(async (tx) => {
      const existed = await tx.pointsLedger.findUnique({
        where: { idempotencyKey: `${idemBase}:OUT` },
        select: { id: true },
      });
      if (existed) return;
      const acc = await tx.pointsAccount.findUnique({
        where: this.points.accountWhere(staffType, fromUserId),
      });
      const agent = await tx.agent.findUnique({ where: { userId: fromUserId } });
      const bal = asMoney(acc?.balance ?? 0);
      const quota = asMoney(agent?.pointsQuota ?? 0);
      const maxTake = roundMoney(Math.min(bal, quota));
      if (amount > maxTake) {
        throw new BadRequestException(
          `可回收额度不足：余额 ${bal}，上盘额度 ${quota}，最多可下分 ${maxTake}`,
        );
      }

      await this.points.transferInTx(
        tx,
        {
          type: staffType,
          id: fromUserId,
          remark,
          idempotencyKey: `${idemBase}:OUT`,
        },
        {
          type: toType,
          id: toId,
          remark,
          idempotencyKey: `${idemBase}:IN`,
        },
        amount,
        {
          bizType: 'TRANSFER_OUT',
          bizTypeIn: 'TRANSFER_IN',
          operatorId: actor.id,
          remark,
          refType: 'console_quota_recall',
          refId: fromUserId,
        },
      );
      await writeAgentQuotaInTx(tx, {
        agentUserId: fromUserId,
        bookMode: 'CASH',
        delta: -amount,
        bizType: 'TRANSFER_OUT',
        remark,
        refType: 'console_quota_recall',
        refId: fromUserId,
        idempotencyKey: `${idemBase}:QUOTA`,
      });
      /* 总代收回：额度回到他自己名下，与下发那一笔对称 */
      if (actor.role === 'GENERAL') {
        await writeAgentQuotaInTx(tx, {
          agentUserId: actor.id,
          bookMode: payerBook === 'CREDIT' ? 'CREDIT' : 'CASH',
          delta: amount,
          bizType: 'TRANSFER_IN',
          remark: `${remark}（从代理收回）`,
          refType: 'console_quota_recall',
          refId: fromUserId,
          idempotencyKey: `${idemBase}:PAYER_QUOTA`,
        });
      }
      await this.adminLog.logInTx(tx, actor.id, 'QUOTA_RECALL', fromUserId, {
        amount,
        toType,
        toId,
        fromRole,
        operatorRole: actor.role,
        remark,
        direction: 'OUT',
        balanceBefore: bal,
        quotaBefore: quota,
        pool: toPool ? 'PLATFORM' : 'SELF',
      });
    });

    return { ok: true, ...(await this.myBalance(actor)) };
  }

  /** 给玩家上分：主代理或客服（客服只走客服额度，不透支主代理盘分） */
  async creditPlayer(
    actor: ConsoleActor,
    playerId: string,
    amountRaw: number,
    roomId: string,
    remark?: string,
    clientRequestId?: string,
  ) {
    if (actor.role !== 'AGENT' && actor.role !== 'CS') {
      throw new ForbiddenException('玩家上分由主代理或客服操作');
    }
    const amount = roundMoney(amountRaw);
    if (!isValidMoney(amount) || amount <= 0) throw new BadRequestException('金额无效');
    if (amount < PLAYER_UP_MIN) throw new BadRequestException(`上分最低 ${PLAYER_UP_MIN}`);
    if (amount > PLAYER_FUND_MAX) throw new BadRequestException(`单笔上分不超过 ${PLAYER_FUND_MAX}`);
    const rid = String(roomId || '').trim();
    if (!rid) throw new BadRequestException('请指定上分房间 roomId');
    await this.scope.assertRoomAccess(actor, rid);

    const player = await this.prisma.user.findUnique({
      where: { id: playerId },
      select: { id: true, role: true, status: true },
    });
    if (!player || player.role !== 'PLAYER') throw new BadRequestException('只能给玩家上分');
    if (player.status === 'CLOSED') throw new BadRequestException('玩家已注销，不能上分');
    if (player.status !== 'ACTIVE') throw new BadRequestException('玩家已停用');
    await this.scope.assertUserInScope(actor, playerId);

    const agentUserId = await this.scope.scopeRootUserId(actor);
    const orderNo = assertFundOrderNo(clientRequestId);
    const ledgerRemark = withOrderRemark(orderNo, remark, '上分');
    const idemBase = `console_credit:${orderNo}`;
    const idemIn = `${idemBase}:IN`;

    const result = await this.prisma.$transaction(async (tx) => {
      const existedIn = await tx.pointsLedger.findUnique({
        where: { idempotencyKey: idemIn },
      });
      if (existedIn) {
        const log = await tx.adminLog.findFirst({
          where: {
            action: 'CONSOLE_CREDIT',
            detail: { path: ['orderNo'], equals: orderNo },
          },
          select: { detail: true },
        });
        const detail = (log?.detail ?? {}) as {
          real?: number;
          fake?: number;
          overIssue?: number;
          wage?: number;
        };
        const overIssue = Number(detail.overIssue ?? detail.fake ?? 0);
        return {
          orderNo,
          real: Number(detail.real ?? amount),
          overIssue,
          fake: overIssue,
          wage: Number(detail.wage ?? 0),
          replayed: true as const,
        };
      }

      if (actor.role === 'CS') {
        const staff = await tx.csStaff.findUnique({ where: { userId: actor.id } });
        if (!staff || staff.parentAgentUserId !== agentUserId) {
          throw new ForbiddenException('客服档案无效');
        }
        const split = await applyCsCreditToPlayerInTx(tx, this.points, {
          csUserId: actor.id,
          agentUserId,
          playerId,
          amount,
          operatorId: actor.id,
          remark: ledgerRemark,
          refType: 'console_credit_cs',
          refId: orderNo,
          idemOut: `${idemBase}:OUT`,
          idemIn,
          wageRate: staff.wageRate,
          roomId: rid,
        });
        await this.adminLog.logInTx(tx, actor.id, 'CONSOLE_CREDIT', playerId, {
          amount,
          real: split.real,
          overIssue: 0,
          fake: 0,
          wage: split.wage,
          byCs: true,
          agentUserId,
          roomId: rid,
          remark: (remark || '').trim() || null,
          direction: 'UP',
          method: '上分',
          orderNo,
          operatorRole: actor.role,
          clientRequestId: orderNo,
        });
        return {
          orderNo,
          real: split.real,
          overIssue: 0,
          fake: 0,
          wage: split.wage,
        };
      }

      const split = await applyAgentCreditToPlayerInTx(tx, this.points, {
        agentUserId,
        playerId,
        amount,
        operatorId: actor.id,
        remark: ledgerRemark,
        refType: 'console_credit',
        refId: orderNo,
        idemOut: `${idemBase}:OUT`,
        idemIn,
        playerBizType: 'TRANSFER_IN',
        roomId: rid,
      });

      await this.adminLog.logInTx(tx, actor.id, 'CONSOLE_CREDIT', playerId, {
        amount,
        real: split.real,
        fromBalance: split.fromBalance,
        overIssue: split.overIssue,
        fake: split.overIssue,
        roomId: split.roomId,
        agentUserId,
        remark: (remark || '').trim() || null,
        direction: 'UP',
        method: '上分',
        orderNo,
        operatorRole: actor.role,
        clientRequestId: orderNo,
      });
      return {
        orderNo,
        real: split.real,
        overIssue: split.overIssue,
        fake: split.overIssue,
        wage: 0,
      };
    });

    return { ok: true, ...result, ...(await this.myBalance(actor)) };
  }

  /** BRANCH 给玩家上分时，优先找到房间绑定代理以维护 flyCover */
  private async findAgentForPlayer(playerId: string, actor: ConsoleActor): Promise<string> {
    const member = await this.prisma.roomMember.findFirst({
      where: { playerId, status: 'APPROVED', room: { ownerAgentId: { not: null } } },
      include: { room: { include: { ownerAgent: { select: { userId: true } } } } },
      orderBy: { updatedAt: 'desc' },
    });
    if (member?.room?.ownerAgent?.userId) {
      await this.scope.assertUserInScope(actor, member.room.ownerAgent.userId).catch(() => undefined);
      return member.room.ownerAgent.userId;
    }
    return actor.id;
  }

  async debitPlayer(
    actor: ConsoleActor,
    playerId: string,
    amountRaw: number,
    roomId: string,
    remark?: string,
    clientRequestId?: string,
  ) {
    if (actor.role !== 'AGENT' && actor.role !== 'CS') {
      throw new ForbiddenException('玩家下分由主代理或客服操作');
    }
    const amount = roundMoney(amountRaw);
    if (!isValidMoney(amount) || amount <= 0) throw new BadRequestException('金额无效');
    if (amount < PLAYER_DOWN_MIN) throw new BadRequestException(`下分最低 ${PLAYER_DOWN_MIN}`);
    if (amount > PLAYER_FUND_MAX) throw new BadRequestException(`单笔下分不超过 ${PLAYER_FUND_MAX}`);
    const rid = String(roomId || '').trim();
    if (!rid) throw new BadRequestException('请指定下分房间 roomId');
    await this.scope.assertRoomAccess(actor, rid);

    const player = await this.prisma.user.findUnique({
      where: { id: playerId },
      select: { id: true, role: true },
    });
    if (!player || player.role !== 'PLAYER') throw new BadRequestException('只能从玩家下分');
    await this.scope.assertUserInScope(actor, playerId);

    const agentUserId = await this.scope.scopeRootUserId(actor);
    const orderNo = assertFundOrderNo(clientRequestId);
    const ledgerRemark = withOrderRemark(orderNo, remark, '下分');
    const idemBase = `console_debit:${orderNo}`;
    const idemOut = `${idemBase}:OUT`;

    const replayed = await this.prisma.$transaction(async (tx) => {
      const existedOut = await tx.pointsLedger.findUnique({
        where: { idempotencyKey: idemOut },
      });
      if (existedOut) return true;

      if (actor.role === 'CS') {
        const staff = await tx.csStaff.findUnique({ where: { userId: actor.id } });
        if (!staff || staff.parentAgentUserId !== agentUserId) {
          throw new ForbiddenException('客服档案无效');
        }
        await this.points.lockOwnersInTx(tx, [
          { type: 'PLAYER', id: playerId, roomId: rid },
          { type: 'CS', id: actor.id },
          { type: 'AGENT', id: agentUserId },
        ]);
        await this.points.creditInTx(tx, 'PLAYER', playerId, -amount, 'TRANSFER_OUT', {
          operatorId: actor.id,
          remark: ledgerRemark,
          refType: 'console_debit_cs',
          refId: orderNo,
          idempotencyKey: idemOut,
          roomId: rid,
        });
        const restored = await settleCsPlayerDebitInTx(tx, this.points, {
          csUserId: actor.id,
          agentUserId,
          playerId,
          amount,
          operatorId: actor.id,
          remark: ledgerRemark,
          refType: 'console_debit_cs',
          refId: orderNo,
          idemCs: `${idemBase}:CS`,
          wageRate: staff.wageRate,
          roomId: rid,
        });
        await this.adminLog.logInTx(tx, actor.id, 'CONSOLE_DEBIT', playerId, {
          amount,
          coverBack: restored.coverBack,
          wage: restored.wage,
          byCs: true,
          agentUserId,
          roomId: rid,
          remark: (remark || '').trim() || null,
          direction: 'DOWN',
          method: '下分',
          orderNo,
          operatorRole: actor.role,
          clientRequestId: orderNo,
        });
        return false;
      }

      await this.points.lockOwnersInTx(tx, [
        { type: 'PLAYER', id: playerId, roomId: rid },
        { type: 'AGENT', id: agentUserId },
      ]);

      await this.points.creditInTx(tx, 'PLAYER', playerId, -amount, 'TRANSFER_OUT', {
        operatorId: actor.id,
        remark: ledgerRemark,
        refType: 'console_debit',
        refId: orderNo,
        idempotencyKey: idemOut,
        roomId: rid,
      });

      const restored = await settlePlayerDebitToAgentInTx(tx, this.points, {
        agentUserId,
        playerId,
        amount,
        operatorId: actor.id,
        remark: ledgerRemark,
        refType: 'console_debit',
        refId: orderNo,
        idemAgent: `${idemBase}:AGENT`,
        roomId: rid,
      });

      await this.adminLog.logInTx(tx, actor.id, 'CONSOLE_DEBIT', playerId, {
        amount,
        coverBack: restored.coverBack,
        overIssueBack: restored.overIssueBack,
        realPart: restored.realPart,
        roomId: restored.roomId,
        agentUserId,
        remark: (remark || '').trim() || null,
        direction: 'DOWN',
        method: '下分',
        orderNo,
        operatorRole: actor.role,
        clientRequestId: orderNo,
      });
      return false;
    });

    if (!replayed) void this.riskDetector.onPlayerDebit(playerId, amount);

    /* 下分回盘后也可能补足挂靠佣金欠账 */
    this.commission.triggerSettleForPayer(agentUserId);

    return {
      ok: true,
      orderNo,
      replayed: !!replayed,
      ...(await this.myBalance(actor)),
    };
  }

  private assertIssueHierarchy(fromRole: string, toRole: string) {
    /*
     * 额度只给主代理与总代；子账号共用主代理额度；玩家上下分仅代理/子账号。
     * 挂了总代的房间，代理的分找总代买，平台不再直接对这个代理下发——
     * 那层限制在 issue 里按房间判断，这里只管角色组合是否成立。
     */
    const ok =
      (fromRole === 'ADMIN' && (toRole === 'AGENT' || toRole === 'GENERAL')) ||
      (fromRole === 'BRANCH' && (toRole === 'AGENT' || toRole === 'GENERAL')) ||
      (fromRole === 'GENERAL' && toRole === 'AGENT') ||
      (fromRole === 'AGENT' && toRole === 'PLAYER') ||
      (fromRole === 'PROXY' && toRole === 'PLAYER');
    if (!ok) throw new ForbiddenException(`不允许 ${fromRole} → ${toRole} 下发`);
  }

  /** 总代与平台的盘口；非总代返回 null */
  private async generalBookMode(userId: string): Promise<'CASH' | 'CREDIT' | null> {
    const agent = await this.prisma.agent.findUnique({
      where: { userId },
      select: { bookMode: true, user: { select: { role: true } } },
    });
    if (!agent || agent.user.role !== 'GENERAL') return null;
    return agent.bookMode === 'CREDIT' ? 'CREDIT' : 'CASH';
  }

  /**
   * 总代额度不够也照发，超出部分算他欠平台的——与代理给玩家上分同一套规矩：
   * 盘分账允许变负，负数就是欠账，结算时一并算。这里只把超发额算出来供提示与留痕。
   */
  private async generalOverIssue(generalUserId: string, amount: number): Promise<number> {
    const agent = await this.prisma.agent.findUnique({
      where: { userId: generalUserId },
      select: { pointsQuota: true },
    });
    const avail = asMoney(agent?.pointsQuota ?? 0);
    return roundMoney(Math.max(0, amount - Math.max(0, avail)));
  }
}
