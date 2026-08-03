/**
 * 级联额度 + 真分/假分：
 * - 给代理上分：扣出资方余额，加代理余额，并增加 pointsQuota（真分库存）
 * - 给玩家上分：真分部分扣代理余额+库存并增加 flyCover；假分只加玩家余额
 */
import {
  BadRequestException, ForbiddenException, Injectable, NotFoundException,
} from '@nestjs/common';
import { asMoney, isValidMoney, roundMoney } from '@gamebox/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { PointsService, PLATFORM_OWNER_ID, type OwnerType } from '../points/points.service';
import { AdminLogService } from '../admin/admin-log.service';
import { ConsoleScopeService, type ConsoleActor } from './console-scope.service';
import { RiskDetectorService } from '../risk/risk-detector.service';

const ISSUE_MAX = 50_000_000;

@Injectable()
export class ConsoleWalletService {
  constructor(
    private prisma: PrismaService,
    private points: PointsService,
    private adminLog: AdminLogService,
    private scope: ConsoleScopeService,
    private riskDetector: RiskDetectorService,
  ) {}

  async myBalance(actor: ConsoleActor) {
    const ownerId = this.scope.walletOwnerId(actor);
    const ownerType = this.scope.ownerTypeOf(actor.role);
    const acc = await this.prisma.pointsAccount.findUnique({ where: { ownerId } });
    const base = {
      ownerType,
      ownerId,
      balance: asMoney(acc?.balance ?? 0),
    };
    if (!['AGENT', 'PROXY', 'BRANCH'].includes(actor.role)) return base;

    // PROXY 真分/飞盘在主代理账上；自己钱包余额仍用 walletOwnerId
    const agentUserId =
      actor.role === 'PROXY' ? await this.scope.scopeRootUserId(actor) : actor.id;
    const agent = await this.prisma.agent.findUnique({ where: { userId: agentUserId } });
    if (!agent) return base;

    const playerIds = await this.scopedPlayerIds(actor);
    let playerPointsTotal = 0;
    if (playerIds.length) {
      const accs = await this.prisma.pointsAccount.findMany({
        where: { ownerId: { in: playerIds }, ownerType: 'PLAYER' },
        select: { balance: true },
      });
      for (const a of accs) playerPointsTotal += asMoney(a.balance);
    }
    const pointsQuota = asMoney(agent.pointsQuota);
    const flyCover = asMoney(agent.flyCover);
    const fakeExposure = roundMoney(Math.max(0, playerPointsTotal - flyCover - pointsQuota));
    return {
      ...base,
      pointsQuota,
      flyCover,
      playerPointsTotal: roundMoney(playerPointsTotal),
      fakeExposure,
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
   * 给 AGENT/PROXY 时同步增加真分库存 pointsQuota
   * 给 PLAYER 时走 creditPlayer 真/假分逻辑
   */
  async issue(
    actor: ConsoleActor,
    toUserId: string,
    amountRaw: number,
    remark?: string,
  ) {
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

    this.assertIssueHierarchy(actor.role, target.role);
    if (actor.role !== 'ADMIN') {
      await this.scope.assertUserInScope(actor, toUserId);
    }

    if (target.role === 'PLAYER') {
      if (actor.role !== 'AGENT' && actor.role !== 'PROXY') {
        throw new ForbiddenException('玩家上下分由代理操作；超管/房主请给代理卖额度');
      }
      return this.creditPlayer(actor, toUserId, amount, remark);
    }

    return this.sellQuotaToStaff(actor, target.id, target.role, amount, remark ?? '控制台卖额度');
  }

  /**
   * 回收额度（下分）：从代理/子账号扣回余额与真分库存，退回操作方。
   * 不可超过对方当前余额与剩余额度（pointsQuota）的较小值。
   */
  async recall(
    actor: ConsoleActor,
    fromUserId: string,
    amountRaw: number,
    remark?: string,
  ) {
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
    if (!['BRANCH', 'AGENT', 'PROXY'].includes(target.role)) {
      throw new BadRequestException('只能回收房主/代理/子账号的额度');
    }
    if (target.role === 'PLAYER') {
      throw new ForbiddenException('玩家下分请走玩家上下分');
    }

    this.assertIssueHierarchy(actor.role, target.role);
    if (actor.role !== 'ADMIN') {
      await this.scope.assertUserInScope(actor, fromUserId);
    }

    return this.recallQuotaFromStaff(
      actor,
      target.id,
      target.role,
      amount,
      remark ?? '控制台回收额度',
    );
  }

  /** 超管/房主卖额度给代理：余额 + 真分库存 */
  private async sellQuotaToStaff(
    actor: ConsoleActor,
    toUserId: string,
    toRole: string,
    amount: number,
    remark: string,
  ) {
    const fromType = this.scope.ownerTypeOf(actor.role);
    const fromId = actor.role === 'ADMIN' ? PLATFORM_OWNER_ID : actor.id;
    const toType = this.scope.ownerTypeOf(toRole) as OwnerType;
    const stamp = `${Date.now()}`;
    const idemBase = `console_quota_${actor.id}_${toUserId}_${stamp}_${amount}`;

    await this.prisma.$transaction(async (tx) => {
      await this.points.creditInTx(tx, fromType, fromId, -amount, 'TRANSFER_OUT', {
        operatorId: actor.id, remark, refType: 'console_quota', refId: toUserId,
        idempotencyKey: `${idemBase}:OUT`,
      });
      await this.points.creditInTx(tx, toType, toUserId, amount, 'TRANSFER_IN', {
        operatorId: actor.id, remark, refType: 'console_quota', refId: actor.id,
        idempotencyKey: `${idemBase}:IN`,
      });
      await tx.agent.upsert({
        where: { userId: toUserId },
        update: { pointsQuota: { increment: amount } },
        create: { userId: toUserId, pointsQuota: amount },
      });
      await this.adminLog.logInTx(tx, actor.id, 'QUOTA_SELL', toUserId, {
        amount,
        fromType,
        fromId,
        fromRole: actor.role,
        toRole,
        remark,
        direction: 'IN',
      });
    });

    return { ok: true, ...(await this.myBalance(actor)) };
  }

  /** 回收下级额度：扣对方余额+pointsQuota，加回操作方余额 */
  private async recallQuotaFromStaff(
    actor: ConsoleActor,
    fromUserId: string,
    fromRole: string,
    amount: number,
    remark: string,
  ) {
    const toType = this.scope.ownerTypeOf(actor.role);
    const toId = actor.role === 'ADMIN' ? PLATFORM_OWNER_ID : actor.id;
    const staffType = this.scope.ownerTypeOf(fromRole) as OwnerType;
    const stamp = `${Date.now()}`;
    const idemBase = `console_quota_recall_${actor.id}_${fromUserId}_${stamp}_${amount}`;

    await this.prisma.$transaction(async (tx) => {
      const acc = await tx.pointsAccount.findUnique({ where: { ownerId: fromUserId } });
      const agent = await tx.agent.findUnique({ where: { userId: fromUserId } });
      const bal = asMoney(acc?.balance ?? 0);
      const quota = asMoney(agent?.pointsQuota ?? 0);
      const maxTake = roundMoney(Math.min(bal, quota));
      if (amount > maxTake) {
        throw new BadRequestException(
          `可回收额度不足：余额 ${bal}，剩余真分额度 ${quota}，最多可下分 ${maxTake}`,
        );
      }

      await this.points.creditInTx(tx, staffType, fromUserId, -amount, 'TRANSFER_OUT', {
        operatorId: actor.id,
        remark,
        refType: 'console_quota_recall',
        refId: actor.id,
        idempotencyKey: `${idemBase}:OUT`,
      });
      await this.points.creditInTx(tx, toType, toId, amount, 'TRANSFER_IN', {
        operatorId: actor.id,
        remark,
        refType: 'console_quota_recall',
        refId: fromUserId,
        idempotencyKey: `${idemBase}:IN`,
      });
      await tx.agent.update({
        where: { userId: fromUserId },
        data: { pointsQuota: { decrement: amount } },
      });
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
      });
    });

    return { ok: true, ...(await this.myBalance(actor)) };
  }

  /** 给玩家上分：仅代理；真分扣库存/余额+增 flyCover；假分只加玩家余额 */
  async creditPlayer(
    actor: ConsoleActor,
    playerId: string,
    amountRaw: number,
    remark?: string,
    clientRequestId?: string,
  ) {
    if (actor.role !== 'AGENT' && actor.role !== 'PROXY') {
      throw new ForbiddenException('玩家上下分由代理操作');
    }
    const amount = roundMoney(amountRaw);
    if (!isValidMoney(amount) || amount <= 0) throw new BadRequestException('金额无效');
    if (amount > ISSUE_MAX) throw new BadRequestException(`单笔上限 ${ISSUE_MAX}`);

    const player = await this.prisma.user.findUnique({
      where: { id: playerId },
      select: { id: true, role: true, status: true },
    });
    if (!player || player.role !== 'PLAYER') throw new BadRequestException('只能给玩家上分');
    if (player.status === 'DISABLED') throw new BadRequestException('玩家已停用');
    await this.scope.assertUserInScope(actor, playerId);

    /* 代分用上级代理的真分库存；扣款账户也走主代理 */
    const agentUserId = await this.scope.scopeRootUserId(actor);
    const reqId = (clientRequestId || '').trim().slice(0, 64);
    if (clientRequestId != null && clientRequestId !== '' && reqId.length < 8) {
      throw new BadRequestException('clientRequestId 无效');
    }
    const stamp = reqId || `${Date.now()}`;
    const idemBase = `console_credit_${actor.id}_${playerId}_${stamp}_${amount}`;
    const idemIn = `${idemBase}:IN`;

    const result = await this.prisma.$transaction(async (tx) => {
      /* 整笔幂等：账本命中则不再动额度/飞盘（避免重试把库存扣两次） */
      const existedIn = await tx.pointsLedger.findUnique({
        where: { idempotencyKey: idemIn },
      });
      if (existedIn) {
        const log = await tx.adminLog.findFirst({
          where: { action: 'CONSOLE_CREDIT', target: playerId, operatorId: actor.id },
          orderBy: { createdAt: 'desc' },
          select: { detail: true },
        });
        const detail = (log?.detail ?? {}) as { real?: number; fake?: number };
        return {
          real: Number(detail.real ?? 0),
          fake: Number(detail.fake ?? 0),
          replayed: true as const,
        };
      }

      const agent = await tx.agent.findUnique({ where: { userId: agentUserId } });
      if (!agent) throw new BadRequestException('代理账户不存在');
      const quota = asMoney(agent.pointsQuota);
      const real = roundMoney(Math.min(amount, quota));
      const fake = roundMoney(amount - real);

      const payerType = 'AGENT' as OwnerType;
      const payerId = agentUserId;

      if (real > 0) {
        await this.points.creditInTx(tx, payerType, payerId, -real, 'TRANSFER_OUT', {
          operatorId: actor.id,
          remark: remark ?? '真分上分',
          refType: 'console_credit_real',
          refId: playerId,
          idempotencyKey: `${idemBase}:REAL_OUT`,
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

      await this.points.creditInTx(tx, 'PLAYER', playerId, amount, 'TRANSFER_IN', {
        operatorId: actor.id,
        remark: remark ?? (fake > 0 ? `上分(真${real}/假${fake})` : '上分'),
        refType: 'console_credit',
        refId: actor.id,
        idempotencyKey: idemIn,
      });

      await this.adminLog.logInTx(tx, actor.id, 'CONSOLE_CREDIT', playerId, {
        amount,
        real,
        fake,
        agentUserId,
        remark,
        byProxy: actor.role === 'PROXY',
        direction: 'UP',
        operatorRole: actor.role,
        clientRequestId: reqId || null,
      });
      return { real, fake };
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
    remark?: string,
    clientRequestId?: string,
  ) {
    if (actor.role !== 'AGENT' && actor.role !== 'PROXY') {
      throw new ForbiddenException('玩家下分由代理操作');
    }
    const amount = roundMoney(amountRaw);
    if (!isValidMoney(amount) || amount <= 0) throw new BadRequestException('金额无效');

    const player = await this.prisma.user.findUnique({
      where: { id: playerId },
      select: { id: true, role: true },
    });
    if (!player || player.role !== 'PLAYER') throw new BadRequestException('只能从玩家下分');
    await this.scope.assertUserInScope(actor, playerId);

    const agentUserId = await this.scope.scopeRootUserId(actor);
    const toType = 'AGENT' as OwnerType;
    const toId = agentUserId;
    const reqId = (clientRequestId || '').trim().slice(0, 64);
    if (clientRequestId != null && clientRequestId !== '' && reqId.length < 8) {
      throw new BadRequestException('clientRequestId 无效');
    }
    const stamp = reqId || `${Date.now()}`;
    const idemBase = `console_debit_${actor.id}_${playerId}_${stamp}_${amount}`;
    const idemOut = `${idemBase}:OUT`;

    const replayed = await this.prisma.$transaction(async (tx) => {
      const existedOut = await tx.pointsLedger.findUnique({
        where: { idempotencyKey: idemOut },
      });
      if (existedOut) return true;

      await this.points.creditInTx(tx, 'PLAYER', playerId, -amount, 'TRANSFER_OUT', {
        operatorId: actor.id,
        remark: remark ?? '控制台下分',
        refType: 'console_debit',
        refId: actor.id,
        idempotencyKey: idemOut,
      });
      await this.points.creditInTx(tx, toType, toId, amount, 'TRANSFER_IN', {
        operatorId: actor.id,
        remark: remark ?? '回收玩家下分',
        refType: 'console_debit',
        refId: playerId,
        idempotencyKey: `${idemBase}:IN`,
      });

      // 下分回冲真分库存（不超过当前 flyCover，避免虚增）
      let coverBack = 0;
      const agent = await tx.agent.findUnique({ where: { userId: agentUserId } });
      if (agent) {
        const cover = asMoney(agent.flyCover);
        coverBack = roundMoney(Math.min(amount, cover));
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
      }

      await this.adminLog.logInTx(tx, actor.id, 'CONSOLE_DEBIT', playerId, {
        amount,
        coverBack,
        agentUserId,
        remark,
        byProxy: actor.role === 'PROXY',
        direction: 'DOWN',
        operatorRole: actor.role,
        clientRequestId: reqId || null,
      });
      return false;
    });

    if (!replayed) void this.riskDetector.onPlayerDebit(playerId, amount);

    return { ok: true, ...(await this.myBalance(actor)) };
  }

  /** 向房间盘口池注资 */
  async fundRoom(actor: ConsoleActor, roomId: string, amountRaw: number, remark?: string) {
    const amount = roundMoney(amountRaw);
    if (!isValidMoney(amount) || amount <= 0) throw new BadRequestException('金额无效');
    await this.scope.assertRoomAccess(actor, roomId);

    const fromType = this.scope.ownerTypeOf(actor.role) as OwnerType;
    const fromId = actor.role === 'ADMIN' ? PLATFORM_OWNER_ID : actor.id;
    const stamp = `${Date.now()}`;
    const idemBase = `room_fund_${actor.id}_${roomId}_${stamp}_${amount}`;

    await this.prisma.$transaction(async (tx) => {
      await this.points.transferInTx(
        tx,
        { type: fromType, id: fromId, idempotencyKey: `${idemBase}:OUT` },
        { type: 'ROOM', id: roomId, idempotencyKey: `${idemBase}:IN` },
        amount,
        { bizType: 'TRANSFER_OUT', operatorId: actor.id, remark: remark ?? '房间盘口注资', refType: 'room_fund', refId: roomId },
      );
      await this.adminLog.logInTx(tx, actor.id, 'ROOM_FUND', roomId, { amount, remark });
    });

    const pool = await this.prisma.pointsAccount.findUnique({ where: { ownerId: roomId } });
    return { ok: true, roomId, poolBalance: asMoney(pool?.balance ?? 0) };
  }

  async roomPoolBalance(roomId: string) {
    const pool = await this.prisma.pointsAccount.findUnique({ where: { ownerId: roomId } });
    return { roomId, balance: asMoney(pool?.balance ?? 0) };
  }

  private assertIssueHierarchy(fromRole: string, toRole: string) {
    // 大组长只卖额度给下级干部；小组长才给玩家上下分
    const ok =
      (fromRole === 'ADMIN' && ['BRANCH', 'AGENT', 'PROXY'].includes(toRole)) ||
      (fromRole === 'BRANCH' && ['AGENT', 'PROXY'].includes(toRole)) ||
      (fromRole === 'AGENT' && ['PROXY', 'PLAYER'].includes(toRole)) ||
      (fromRole === 'PROXY' && toRole === 'PLAYER');
    if (!ok) throw new ForbiddenException(`不允许 ${fromRole} → ${toRole} 下发`);
  }
}
