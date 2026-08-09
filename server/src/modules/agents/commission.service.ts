import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron } from '@nestjs/schedule';
import type { Prisma } from '@prisma/client';
import { asMoney, roundMoney } from '@gamebox/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { PointsService } from '../points/points.service';
import {
  lockAgentRowInTx,
  payCreditDiskToPlayerInTx,
  writeAgentQuotaInTx,
} from '../console/player-fund.helper';

/**
 * 玩家挂靠佣金（推荐奖）：
 * 下级玩家在某房产生有效流水后，沿该房 RoomPlayerHang.hangPath 向上只发给「玩家」推荐人。
 * 本房无挂靠关系则不发（跨房隔离）。
 * - 现金：从代理盘分（余额+上盘额度）出；不够记 CommissionDebt，盘分补足后自动补发
 * - 信用：从剩余信用出，不动佣金账户
 */
@Injectable()
export class CommissionService {
  private readonly logger = new Logger(CommissionService.name);
  private settlingPayers = new Set<string>();

  constructor(
    private prisma: PrismaService,
    private points: PointsService,
    private cfg: ConfigService,
  ) {}

  /** 路径成环时同一祖先可能出现多次，去重后只按最近一级发一次 */
  private parseAncestors(agentPath: string): string[] {
    return [...new Set(agentPath.split('/').filter(Boolean).reverse())];
  }

  async distributeInTx(
    tx: Prisma.TransactionClient,
    sourceUser: { id: string; agentPath?: string },
    validFlow: number,
    refRoundId?: string,
    idemScope?: string,
    opts?: {
      payerAgentUserId?: string;
      /** CASH=盘分出；CREDIT=剩余信用出 */
      bookMode?: 'CASH' | 'CREDIT';
      /** 下注房间：按本房挂靠链发佣；无 roomId 则不发挂靠佣金 */
      roomId?: string;
      /** @deprecated 现金不足记欠账，不再抛错拖垮结算 */
      softIfBroke?: boolean;
    },
  ): Promise<void> {
    if (validFlow <= 0) return;
    const roomId = String(opts?.roomId || '').trim();
    if (!roomId) return;

    const hang = await tx.roomPlayerHang.findUnique({
      where: { roomId_playerId: { roomId, playerId: sourceUser.id } },
      select: { hangPath: true },
    });
    if (!hang?.hangPath || hang.hangPath === '/') return;

    const maxLevel = Number(this.cfg.get('COMMISSION_MAX_LEVEL') ?? 5);
    const ancestors = this.parseAncestors(hang.hangPath).slice(0, maxLevel);

    const scope = idemScope ?? refRoundId;
    if (!scope) {
      throw new Error('distributeInTx 需要 refRoundId 或 idemScope 之一作为幂等作用域');
    }
    if (ancestors.length === 0) return;

    const [agents, users] = await Promise.all([
      tx.agent.findMany({
        where: { userId: { in: ancestors } },
        select: { userId: true, commissionRate: true },
      }),
      tx.user.findMany({
        where: { id: { in: ancestors } },
        select: { id: true, role: true },
      }),
    ]);
    const agentMap = new Map(agents.map((a) => [a.userId, a]));
    const roleMap = new Map(users.map((u) => [u.id, u.role]));
    const maxTotalRate = Number(this.cfg.get('COMMISSION_MAX_RATE') ?? 0.2);
    let lowerLevelRate = 0;

    const payerId =
      opts?.payerAgentUserId ||
      (await this.resolvePayerAgentId(tx, sourceUser.id, ancestors));
    if (!payerId) return;

    const isCredit = opts?.bookMode === 'CREDIT';

    for (let i = 0; i < ancestors.length; i++) {
      const beneficiaryUserId = ancestors[i];
      if (roleMap.get(beneficiaryUserId) !== 'PLAYER') continue;
      if (beneficiaryUserId === payerId) continue;

      const agent = agentMap.get(beneficiaryUserId);
      if (!agent || agent.commissionRate <= 0) continue;

      const configuredRate = Math.min(agent.commissionRate, maxTotalRate);
      const differentialRate = Math.max(0, configuredRate - lowerLevelRate);
      lowerLevelRate = Math.max(lowerLevelRate, configuredRate);
      const amount = roundMoney(validFlow * differentialRate);
      if (amount <= 0) continue;

      const key = `commission:${scope}:${sourceUser.id}:${beneficiaryUserId}`;
      /* 已发过（重结/补发）：转账会被幂等跳过，此处必须一并跳过盘分扣减 */
      const paid = await tx.pointsLedger.findUnique({
        where: { idempotencyKey: `${key}:IN` },
        select: { id: true },
      });
      if (paid) continue;
      const remark = `挂靠佣金 ${(differentialRate * 100).toFixed(2)}%`;
      const creditRoomId =
        (await this.resolveBeneficiaryRoomId(tx, beneficiaryUserId, payerId, refRoundId)) ||
        roomId;
      if (!creditRoomId) {
        throw new BadRequestException('挂靠佣金入账缺少房间');
      }

      let ledgerId: string;
      if (isCredit) {
        const ledger = await payCreditDiskToPlayerInTx(tx, this.points, {
          agentUserId: payerId,
          playerId: beneficiaryUserId,
          amount,
          bizType: 'COMMISSION',
          remark,
          refType: 'round',
          refId: refRoundId,
          idemPlayer: `${key}:IN`,
          roomId: creditRoomId,
        });
        if (!ledger) continue;
        ledgerId = ledger.id;
      } else {
        await lockAgentRowInTx(tx, payerId);
        const payerAgent = await tx.agent.findUnique({ where: { userId: payerId } });
        const acc = await tx.pointsAccount.findUnique({
          where: this.points.accountWhere('AGENT', payerId),
        });
        const bal = asMoney(acc?.balance ?? 0);
        const quota = asMoney(payerAgent?.pointsQuota ?? 0);
        if (Math.min(bal, quota) + 1e-9 < amount) {
          await this.enqueueDebtInTx(tx, {
            payerAgentUserId: payerId,
            beneficiaryId: beneficiaryUserId,
            sourceUserId: sourceUser.id,
            level: i + 1,
            sourceRoundId: refRoundId,
            idemKey: key,
            baseFlow: validFlow,
            rate: differentialRate,
            amount,
          });
          this.logger.warn(
            `代理盘分不足，挂靠佣金记欠账：payer=${payerId} beneficiary=${beneficiaryUserId} ` +
              `bal=${bal} quota=${quota} need=${amount} scope=${scope}`,
          );
          continue;
        }
        const { in: ledger } = await this.points.transferInTx(
          tx,
          { type: 'AGENT', id: payerId, idempotencyKey: `${key}:OUT` },
          {
            type: 'PLAYER',
            id: beneficiaryUserId,
            roomId: creditRoomId,
            idempotencyKey: `${key}:IN`,
          },
          amount,
          { bizType: 'COMMISSION', refType: 'round', refId: refRoundId, remark },
        );
        await writeAgentQuotaInTx(tx, {
          agentUserId: payerId,
          bookMode: 'CASH',
          delta: -amount,
          bizType: 'COMMISSION',
          remark,
          refType: 'round',
          refId: refRoundId,
          idempotencyKey: `${key}:QUOTA`,
        });
        ledgerId = ledger.id;
      }

      const recordExists = await tx.commissionRecord.findFirst({ where: { ledgerId } });
      if (recordExists) continue;

      await tx.commissionRecord.create({
        data: {
          beneficiaryId: beneficiaryUserId,
          sourceUserId: sourceUser.id,
          level: i + 1,
          sourceRoundId: refRoundId,
          baseFlow: validFlow,
          rate: differentialRate,
          amount,
          ledgerId,
        },
      });
    }
  }

  /** 代理盘分入账后立刻尝试补发其名下欠账（非阻塞） */
  triggerSettleForPayer(payerAgentUserId: string) {
    if (!payerAgentUserId) return;
    void this.settlePendingForPayer(payerAgentUserId).catch((err) => {
      this.logger.error(
        `补发挂靠佣金欠账失败 payer=${payerAgentUserId}`,
        err instanceof Error ? err.stack : String(err),
      );
    });
  }

  /** 定时扫一批 PENDING 欠账（防漏触发） */
  @Cron('*/30 * * * * *')
  async cronSettleCommissionDebts() {
    const payers = await this.prisma.commissionDebt.findMany({
      where: { status: 'PENDING' },
      distinct: ['payerAgentUserId'],
      take: 40,
      select: { payerAgentUserId: true },
      orderBy: { createdAt: 'asc' },
    });
    for (const row of payers) {
      await this.settlePendingForPayer(row.payerAgentUserId);
    }
  }

  async settlePendingForPayer(payerAgentUserId: string): Promise<number> {
    if (!payerAgentUserId || this.settlingPayers.has(payerAgentUserId)) return 0;
    this.settlingPayers.add(payerAgentUserId);
    let settledCount = 0;
    try {
      /* 每次最多结 50 笔，避免单次事务过长；循环直到本轮结不动 */
      for (let round = 0; round < 20; round++) {
        const n = await this.settleOneBatchForPayer(payerAgentUserId, 50);
        settledCount += n;
        if (n === 0) break;
      }
    } finally {
      this.settlingPayers.delete(payerAgentUserId);
    }
    if (settledCount > 0) {
      this.logger.log(
        `挂靠佣金欠账补发完成 payer=${payerAgentUserId} count=${settledCount}`,
      );
    }
    return settledCount;
  }

  private async settleOneBatchForPayer(payerAgentUserId: string, take: number): Promise<number> {
    const debts = await this.prisma.commissionDebt.findMany({
      where: { payerAgentUserId, status: 'PENDING' },
      orderBy: { createdAt: 'asc' },
      take,
    });
    if (debts.length === 0) return 0;

    let settled = 0;
    for (const debt of debts) {
      const ok = await this.trySettleOneDebt(debt.id);
      if (!ok) break; /* 盘分又不够：按时间顺序停，等下次入资 */
      settled += 1;
    }
    return settled;
  }

  private async trySettleOneDebt(debtId: string): Promise<boolean> {
    try {
      return await this.prisma.$transaction(async (tx) => {
        const debt = await tx.commissionDebt.findUnique({ where: { id: debtId } });
        if (!debt || debt.status !== 'PENDING') return true;

        const amount = asMoney(debt.amount);
        const key = debt.idemKey;
        const remark = `挂靠佣金补发 ${(debt.rate * 100).toFixed(2)}%`;

        /* 同一 idemKey 已被直接发放过：只销账，不能再扣一次盘分 */
        const paid = await tx.pointsLedger.findUnique({
          where: { idempotencyKey: `${key}:IN` },
          select: { id: true },
        });
        if (paid) {
          await tx.commissionDebt.update({
            where: { id: debt.id },
            data: {
              status: 'SETTLED',
              settledAt: new Date(),
              settleLedgerId: paid.id,
            },
          });
          return true;
        }

        await lockAgentRowInTx(tx, debt.payerAgentUserId);
        const payerAgent = await tx.agent.findUnique({
          where: { userId: debt.payerAgentUserId },
        });
        const acc = await tx.pointsAccount.findUnique({
          where: this.points.accountWhere('AGENT', debt.payerAgentUserId),
        });
        const bal = asMoney(acc?.balance ?? 0);
        const quota = asMoney(payerAgent?.pointsQuota ?? 0);
        if (Math.min(bal, quota) + 1e-9 < amount) {
          return false;
        }

        const creditRoomId = await this.resolveBeneficiaryRoomId(
          tx,
          debt.beneficiaryId,
          debt.payerAgentUserId,
          debt.sourceRoundId ?? undefined,
        );
        if (!creditRoomId) return false;

        const { in: ledger } = await this.points.transferInTx(
          tx,
          {
            type: 'AGENT',
            id: debt.payerAgentUserId,
            idempotencyKey: `${key}:OUT`,
          },
          {
            type: 'PLAYER',
            id: debt.beneficiaryId,
            roomId: creditRoomId,
            idempotencyKey: `${key}:IN`,
          },
          amount,
          {
            bizType: 'COMMISSION',
            refType: 'round',
            refId: debt.sourceRoundId ?? undefined,
            remark,
          },
        );
        await writeAgentQuotaInTx(tx, {
          agentUserId: debt.payerAgentUserId,
          bookMode: 'CASH',
          delta: -amount,
          bizType: 'COMMISSION',
          remark,
          refType: 'round',
          refId: debt.sourceRoundId ?? undefined,
          idempotencyKey: `${key}:QUOTA`,
        });

        const recordExists = await tx.commissionRecord.findFirst({
          where: { ledgerId: ledger.id },
        });
        if (!recordExists) {
          await tx.commissionRecord.create({
            data: {
              beneficiaryId: debt.beneficiaryId,
              sourceUserId: debt.sourceUserId,
              level: debt.level,
              sourceRoundId: debt.sourceRoundId,
              baseFlow: debt.baseFlow,
              rate: debt.rate,
              amount: debt.amount,
              ledgerId: ledger.id,
            },
          });
        }

        await tx.commissionDebt.update({
          where: { id: debt.id },
          data: {
            status: 'SETTLED',
            settledAt: new Date(),
            settleLedgerId: ledger.id,
          },
        });
        return true;
      });
    } catch (err) {
      this.logger.error(
        `单笔挂靠佣金欠账补发失败 debt=${debtId}`,
        err instanceof Error ? err.stack : String(err),
      );
      return false;
    }
  }

  private async enqueueDebtInTx(
    tx: Prisma.TransactionClient,
    data: {
      payerAgentUserId: string;
      beneficiaryId: string;
      sourceUserId: string;
      level: number;
      sourceRoundId?: string;
      idemKey: string;
      baseFlow: number;
      rate: number;
      amount: number;
    },
  ) {
    const existing = await tx.commissionDebt.findUnique({
      where: { idemKey: data.idemKey },
      select: { id: true, status: true },
    });
    if (existing) {
      if (existing.status === 'PENDING') {
        await tx.commissionDebt.update({
          where: { id: existing.id },
          data: {
            amount: data.amount,
            baseFlow: data.baseFlow,
            rate: data.rate,
            level: data.level,
            sourceRoundId: data.sourceRoundId,
          },
        });
      }
      return;
    }
    await tx.commissionDebt.create({
      data: {
        payerAgentUserId: data.payerAgentUserId,
        beneficiaryId: data.beneficiaryId,
        sourceUserId: data.sourceUserId,
        level: data.level,
        sourceRoundId: data.sourceRoundId,
        idemKey: data.idemKey,
        baseFlow: data.baseFlow,
        rate: data.rate,
        amount: data.amount,
        status: 'PENDING',
      },
    });
  }

  /** 受益玩家入账房：优先注单 fly.roomId，否则取其在付款代理下的 APPROVED 房 */
  private async resolveBeneficiaryRoomId(
    tx: Prisma.TransactionClient,
    beneficiaryId: string,
    payerAgentUserId: string,
    sourceRoundId?: string,
  ): Promise<string> {
    if (sourceRoundId) {
      const bet = await tx.bet.findFirst({
        where: { roundId: sourceRoundId },
        orderBy: { createdAt: 'asc' },
        select: { payload: true },
      });
      const fromFly = String(
        (bet?.payload as { fly?: { roomId?: string } } | null)?.fly?.roomId || '',
      ).trim();
      if (fromFly) return fromFly;
    }
    const member = await tx.roomMember.findFirst({
      where: {
        playerId: beneficiaryId,
        status: 'APPROVED',
        room: { ownerAgent: { userId: payerAgentUserId } },
      },
      orderBy: { updatedAt: 'desc' },
      select: { roomId: true },
    });
    if (member?.roomId) return member.roomId;
    const any = await tx.roomMember.findFirst({
      where: { playerId: beneficiaryId, status: 'APPROVED' },
      orderBy: { updatedAt: 'desc' },
      select: { roomId: true },
    });
    return String(any?.roomId || '').trim();
  }

  private async resolvePayerAgentId(
    tx: Prisma.TransactionClient,
    playerId: string,
    ancestors: string[],
  ): Promise<string | null> {
    const member = await tx.roomMember.findFirst({
      where: { playerId, status: 'APPROVED', room: { ownerAgentId: { not: null } } },
      include: { room: { include: { ownerAgent: { select: { userId: true } } } } },
      orderBy: { updatedAt: 'desc' },
    });
    if (member?.room?.ownerAgent?.userId) return member.room.ownerAgent.userId;
    for (const id of ancestors) {
      const u = await tx.user.findUnique({ where: { id }, select: { role: true } });
      if (u?.role === 'AGENT' || u?.role === 'PROXY') return id;
    }
    return ancestors[0] ?? null;
  }
}
