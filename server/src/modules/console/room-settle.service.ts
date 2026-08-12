import {
  BadRequestException, ForbiddenException, Injectable, NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { asMoney, roundMoney } from '@gamebox/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { AdminLogService } from '../admin/admin-log.service';
import { PLATFORM_OWNER_ID, PointsService } from '../points/points.service';
import { csvRow } from '../../common/utils/csv';
import { ConsoleScopeService, type ConsoleActor } from './console-scope.service';
import { ConsoleReportsService } from './console-reports.service';
import {
  computeCreditBook,
  sumAgentCsBalances,
  sumRoomPlayerBalances,
  type CreditBookSnapshot,
} from './credit-settle.helper';
import { lockAgentRowInTx, writeAgentQuotaInTx } from './player-fund.helper';

const SH_MS = 8 * 3600 * 1000;
const DAY_MS = 86400000;

export type SettleCycle = 'WEEKLY_MON' | 'MONTHLY_15_30' | 'MONTHLY_1';

function shanghaiParts(d = new Date()) {
  const u = new Date(d.getTime() + SH_MS);
  return {
    y: u.getUTCFullYear(),
    m: u.getUTCMonth(),
    day: u.getUTCDate(),
    dow: u.getUTCDay(),
  };
}

export function normalizeSettleCycle(v?: string | null): SettleCycle {
  if (v === 'MONTHLY_15_30' || v === 'MONTHLY_15' || v === 'MONTHLY_30') {
    return 'MONTHLY_15_30';
  }
  if (v === 'MONTHLY_1') return 'MONTHLY_1';
  return 'WEEKLY_MON';
}

export function settleCycleToWeekday(c: SettleCycle): number {
  return c === 'MONTHLY_15_30' ? 15 : 1;
}

export function settleCycleLabel(c: SettleCycle): string {
  if (c === 'MONTHLY_15_30') return '每月 15 号与月末';
  if (c === 'MONTHLY_1') return '每月 1 号';
  return '礼拜一';
}

/**
 * 信用盘月费进哪一期结账：
 * - 距下次月费日 > 7 天 → 本期不计（下期再看）
 * - 距下次月费日 ≤ 7 天（或已到期）→ 本期计整笔合同月费
 * asOf 一般用账期结束日；提前结账用当前时间。
 */
export function creditMonthlyFeeDueThisPeriod(
  monthlyFee: number,
  nextBillAt: Date | null | undefined,
  asOf: Date,
): number {
  const fee = roundMoney(Math.max(0, Number(monthlyFee) || 0));
  if (fee <= 0 || !nextBillAt) return 0;
  const due = nextBillAt instanceof Date ? nextBillAt : new Date(nextBillAt);
  if (Number.isNaN(due.getTime())) return 0;
  const remainMs = due.getTime() - asOf.getTime();
  if (remainMs > 7 * DAY_MS) return 0;
  return fee;
}

/** 信用盘结账后推进下次月费日（仍不自动扣余额） */
function advanceCreditBillAt(fromDue: Date, billingDay: number): Date {
  const day = Math.min(28, Math.max(1, billingDay || 1));
  const y = fromDue.getFullYear();
  const m = fromDue.getMonth();
  const h = fromDue.getHours();
  const mi = fromDue.getMinutes();
  const s = fromDue.getSeconds();
  return new Date(y, m + 1, day, h, mi, s, 0);
}

/**
 * 信用盘实付（平台→代理，可负）= 占成应付 + 佣金账户余额。
 * 佣金账户 = 飞盘平台付给代理的流水工资；结账轧差后清零。
 * 例：占成应付 −4130、佣金 698 → 实付 −3431（代理应付 3431）。
 */
export function netCreditSettlePay(grossPay: number, agentCommission: number): number {
  return roundMoney(roundMoney(grossPay) + roundMoney(agentCommission));
}

export function shanghaiWeekBounds(offsetWeeks = 0): { weekStart: Date; weekEnd: Date } {
  const p = shanghaiParts();
  const daysFromMon = (p.dow + 6) % 7;
  const thisMonUtc = Date.UTC(p.y, p.m, p.day) - SH_MS - daysFromMon * DAY_MS;
  const weekStart = new Date(thisMonUtc + offsetWeeks * 7 * DAY_MS);
  const weekEnd = new Date(weekStart.getTime() + 7 * DAY_MS);
  return { weekStart, weekEnd };
}

function biMonthlyPointsInMonth(y: number, m: number): number[] {
  const lastDay = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  const days = lastDay <= 15 ? [lastDay] : [15, lastDay];
  return days.map((d) => Date.UTC(y, m, d) - SH_MS);
}

function collectBiMonthlyPoints(centerY: number, centerM: number, monthRadius = 3): number[] {
  const pts: number[] = [];
  for (let off = -monthRadius; off <= monthRadius; off++) {
    let m = centerM + off;
    let y = centerY;
    while (m < 0) {
      m += 12;
      y -= 1;
    }
    while (m > 11) {
      m -= 12;
      y += 1;
    }
    pts.push(...biMonthlyPointsInMonth(y, m));
  }
  return [...new Set(pts)].sort((a, b) => a - b);
}

function collectMonthly1Points(centerY: number, centerM: number, monthRadius = 6): number[] {
  const pts: number[] = [];
  for (let off = -monthRadius; off <= monthRadius + 1; off++) {
    let m = centerM + off;
    let y = centerY;
    while (m < 0) {
      m += 12;
      y -= 1;
    }
    while (m > 11) {
      m -= 12;
      y += 1;
    }
    pts.push(Date.UTC(y, m, 1) - SH_MS);
  }
  return [...new Set(pts)].sort((a, b) => a - b);
}

function boundsFromPoints(points: number[], offsetPeriods: number): { periodStart: Date; periodEnd: Date } {
  const now = Date.now();
  let idx = -1;
  for (let i = 0; i < points.length - 1; i++) {
    if (now >= points[i] && now < points[i + 1]) {
      idx = i;
      break;
    }
  }
  if (idx < 0) idx = Math.max(0, points.length - 2);
  const shifted = Math.min(Math.max(0, idx + offsetPeriods), points.length - 2);
  return {
    periodStart: new Date(points[shifted]),
    periodEnd: new Date(points[shifted + 1]),
  };
}

export function shanghaiSettleBounds(
  cycle: SettleCycle,
  offsetPeriods = 0,
): { periodStart: Date; periodEnd: Date } {
  if (cycle === 'WEEKLY_MON') {
    const w = shanghaiWeekBounds(offsetPeriods);
    return { periodStart: w.weekStart, periodEnd: w.weekEnd };
  }

  const p = shanghaiParts();
  if (cycle === 'MONTHLY_1') {
    return boundsFromPoints(collectMonthly1Points(p.y, p.m, 6), offsetPeriods);
  }
  return boundsFromPoints(collectBiMonthlyPoints(p.y, p.m, 6), offsetPeriods);
}

function fmtSh(d: Date) {
  const u = new Date(d.getTime() + SH_MS);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${u.getUTCFullYear()}-${pad(u.getUTCMonth() + 1)}-${pad(u.getUTCDate())} ${pad(u.getUTCHours())}:${pad(u.getUTCMinutes())}`;
}

function toShanghaiOffsetIso(d: Date) {
  const u = new Date(d.getTime() + SH_MS);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${u.getUTCFullYear()}-${pad(u.getUTCMonth() + 1)}-${pad(u.getUTCDate())}T${pad(u.getUTCHours())}:${pad(u.getUTCMinutes())}:${pad(u.getUTCSeconds())}+08:00`;
}

@Injectable()
export class RoomSettleService {
  constructor(
    private prisma: PrismaService,
    private adminLog: AdminLogService,
    private scope: ConsoleScopeService,
    private reports: ConsoleReportsService,
    private points: PointsService,
  ) {}

  private async loadCreditBook(
    room: Awaited<ReturnType<RoomSettleService['roomOrThrow']>>,
  ): Promise<CreditBookSnapshot | null> {
    if (room.bookMode !== 'CREDIT' || !room.ownerAgent) return null;
    const creditLimit = Number(room.creditLimit ?? 0);
    if (creditLimit <= 0) return null;
    const [playerBalances, csBalances] = await Promise.all([
      sumRoomPlayerBalances(this.prisma, room.id),
      sumAgentCsBalances(this.prisma, room.ownerAgent.userId),
    ]);
    return computeCreditBook({
      creditLimit,
      pointsQuota: asMoney(room.ownerAgent.pointsQuota),
      playerBalances,
      csBalances,
      agentShareRate: Number(room.agentShareRate ?? 0),
    });
  }

  private async roomOrThrow(actor: ConsoleActor, roomId: string) {
    await this.scope.assertRoomAccess(actor, roomId);
    const room = await this.prisma.room.findUnique({
      where: { id: roomId },
      select: {
        id: true,
        name: true,
        roomNo: true,
        bookMode: true,
        agentShareRate: true,
        creditLimit: true,
        settleCycle: true,
        settleWeekday: true,
        monthlyFee: true,
        billingDay: true,
        nextBillAt: true,
        ownerAgent: {
          select: {
            id: true,
            userId: true,
            pointsQuota: true,
            user: { select: { uid: true, nickname: true, username: true } },
          },
        },
      },
    });
    if (!room) throw new NotFoundException('房间不存在');
    return room;
  }

  private async sumRoomWeek(actor: ConsoleActor, roomId: string, from: Date, to: Date) {
    const s = await this.reports.summary(actor, roomId, {
      from: toShanghaiOffsetIso(from),
      to: toShanghaiOffsetIso(to),
    });
    return {
      betFlow: asMoney(s.betFlow ?? 0),
      payout: asMoney(s.payout ?? 0),
      housePnl: asMoney(s.housePnl ?? 0),
      betCount: Number(s.betCount ?? 0),
      playerPnl: asMoney(s.playerPnl ?? 0),
      upAmount: asMoney(s.upAmount ?? 0),
      upCount: Number(s.upCount ?? 0),
      downAmount: asMoney(s.downAmount ?? 0),
      downCount: Number(s.downCount ?? 0),
      commissionAmount: asMoney(s.commissionAmount ?? 0),
      commissionCount: Number(s.commissionCount ?? 0),
      activePlayers: Number(s.activePlayers ?? 0),
      byGame: Array.isArray(s.byGame) ? s.byGame : [],
    };
  }

  private split(housePnl: number, agentShareRate: number) {
    const rate = Math.min(1, Math.max(0, agentShareRate));
    const agentShareAmount = asMoney(housePnl * rate);
    const platformShareAmount = asMoney(housePnl - agentShareAmount);
    return { agentShareAmount, platformShareAmount };
  }

  /** 账期内：飞盘返水进代理账、玩家领取回水 */
  private async periodSideMoney(
    roomId: string,
    agentUserId: string | undefined,
    from: Date,
    to: Date,
  ) {
    const members = await this.prisma.roomMember.findMany({
      where: { roomId, status: 'APPROVED' },
      select: { playerId: true },
    });
    const playerIds = members.map((m) => m.playerId);

    let flyRebateToAgent = 0;
    if (agentUserId) {
      const acc = await this.prisma.pointsAccount.findFirst({
        where: { ownerType: 'AGENT', ownerId: agentUserId, roomId: '' },
        select: { id: true },
      });
      if (acc) {
        const agg = await this.prisma.pointsLedger.aggregate({
          where: {
            accountId: acc.id,
            bizType: 'REBATE',
            amount: { gt: 0 },
            createdAt: { gte: from, lt: to },
            OR: [
              { remark: { contains: '飞盘返水' } },
              { idempotencyKey: { startsWith: 'fly_rebate_agent_in_' } },
              { idempotencyKey: { startsWith: 'flow_rebate_agent_in_' } },
            ],
          },
          _sum: { amount: true },
          _count: true,
        });
        flyRebateToAgent = asMoney(agg._sum.amount ?? 0);
      }
    }

    let playerRebateClaimed = 0;
    let playerRebateCount = 0;
    if (playerIds.length) {
      const rebateAgg = await this.prisma.dailyRebateSettlement.aggregate({
        where: {
          playerId: { in: playerIds },
          claimedAt: { gte: from, lt: to },
        },
        _sum: { amount: true },
        _count: true,
      });
      playerRebateClaimed = asMoney(rebateAgg._sum.amount ?? 0);
      playerRebateCount = Number(rebateAgg._count ?? 0);
    }

    return { flyRebateToAgent, playerRebateClaimed, playerRebateCount };
  }

  /**
   * 结账对账单（给代理确认用）：流水/派彩/占成/佣金/信用轧差逐项列清，
   * 并给出最终「平台付代理 / 代理付平台」净额。
   */
  async statement(
    actor: ConsoleActor,
    roomId: string,
    opts?: { period?: 'current' | 'last' | 'early'; weekStart?: string },
  ) {
    const room = await this.roomOrThrow(actor, roomId);
    const cycle = normalizeSettleCycle(room.settleCycle);
    const share = Math.min(1, Math.max(0, Number(room.agentShareRate ?? 0)));
    const isCredit = room.bookMode === 'CREDIT';
    const periodKey = opts?.period === 'last' ? 'last' : opts?.period === 'early' ? 'early' : 'current';

    let periodStart: Date;
    let periodEnd: Date;
    let periodLabel: string;
    if (periodKey === 'early') {
      const current = shanghaiSettleBounds(cycle, 0);
      const lastSettled = await this.prisma.roomWeekSettle.findFirst({
        where: { roomId, status: 'SETTLED' },
        orderBy: { weekEnd: 'desc' },
      });
      periodStart = current.periodStart;
      if (lastSettled && lastSettled.weekEnd.getTime() > periodStart.getTime()) {
        periodStart = lastSettled.weekEnd;
      }
      periodEnd = new Date();
      periodLabel = '提前结账预览（上次结清 → 现在）';
    } else if (periodKey === 'last') {
      const last = shanghaiSettleBounds(cycle, -1);
      periodStart = last.periodStart;
      periodEnd = last.periodEnd;
      if (opts?.weekStart) {
        const ws = new Date(opts.weekStart);
        if (!Number.isNaN(ws.getTime())) {
          periodStart = ws;
          periodEnd = new Date(ws.getTime() + 7 * DAY_MS);
        }
      }
      periodLabel = '上期账期';
    } else {
      const current = shanghaiSettleBounds(cycle, 0);
      periodStart = current.periodStart;
      periodEnd = current.periodEnd;
      periodLabel = '本期进行中';
    }

    const agentUserId = room.ownerAgent?.userId ?? null;
    const [agg, side, creditBook, agentBalanceRaw] = await Promise.all([
      this.sumRoomWeek(actor, roomId, periodStart, periodEnd),
      this.periodSideMoney(roomId, agentUserId ?? undefined, periodStart, periodEnd),
      this.loadCreditBook(room),
      agentUserId
        ? this.prisma.pointsAccount.findFirst({
            where: { ownerType: 'AGENT', ownerId: agentUserId, roomId: '' },
            select: { balance: true },
          })
        : Promise.resolve(null),
    ]);
    const agentBalance = asMoney(agentBalanceRaw?.balance ?? 0);

    const cashSplit = this.split(agg.housePnl, share);
    const settleBasis = isCredit && creditBook
      ? {
          mode: 'CREDIT_EXCESS' as const,
          label: '信用账本超出轧差（剩余信用+玩家持分+客服额度 − 合同额度）',
          housePnl: creditBook.housePnl,
          agentShareAmount: creditBook.agentShareAmount,
          platformShareAmount: creditBook.platformShareAmount,
          platformPayToAgent: creditBook.platformPayToAgent,
        }
      : {
          mode: 'BET_HOUSE_PNL' as const,
          label: '注单庄家盈亏 × 占成（记账；现金盘结账时按此对账）',
          housePnl: agg.housePnl,
          agentShareAmount: cashSplit.agentShareAmount,
          platformShareAmount: cashSplit.platformShareAmount,
          platformPayToAgent: roundMoney(-cashSplit.platformShareAmount),
        };

    type Line = {
      key: string;
      group: string;
      label: string;
      amount: number;
      /** info=说明项；settle=计入最终交割 */
      kind: 'info' | 'settle';
      note?: string;
    };

    const grossPay = settleBasis.platformPayToAgent;
    /** 计入交割的代理余额（正=抵扣上缴/加到平台应付） */
    const balanceDelta = isCredit ? roundMoney(agentBalance) : 0;
    const monthlyFeeContract = asMoney(room.monthlyFee);
    /** 提前结账用「现在」看距下次月费；上期/本期用账期结束日 */
    const feeAsOf = periodKey === 'early' ? new Date() : periodEnd;
    const monthlyFeePeriod = isCredit
      ? creditMonthlyFeeDueThisPeriod(monthlyFeeContract, room.nextBillAt, feeAsOf)
      : 0;
    /** 月费由代理付给平台 → 交割净额减（平台应付↓ / 代理应付↑） */
    const monthlyFeeSettle = roundMoney(-monthlyFeePeriod);

    const lines: Line[] = [
      { key: 'betFlow', group: '经营', label: '有效流水', amount: agg.betFlow, kind: 'info' },
      { key: 'payout', group: '经营', label: '派彩', amount: agg.payout, kind: 'info' },
      { key: 'betHousePnl', group: '经营', label: '注单庄家盈亏', amount: agg.housePnl, kind: 'info' },
      { key: 'playerPnl', group: '经营', label: '玩家盈亏', amount: agg.playerPnl, kind: 'info' },

      { key: 'upAmount', group: '上下分', label: '上分合计', amount: agg.upAmount, kind: 'info' },
      { key: 'downAmount', group: '上下分', label: '下分合计', amount: agg.downAmount, kind: 'info' },
      { key: 'upCount', group: '上下分', label: '上分笔数', amount: agg.upCount, kind: 'info' },
      { key: 'downCount', group: '上下分', label: '下分笔数', amount: agg.downCount, kind: 'info' },

      { key: 'commission', group: '返水', label: '挂靠佣金', amount: agg.commissionAmount, kind: 'info' },
      { key: 'flyRebate', group: '返水', label: '飞盘返水', amount: side.flyRebateToAgent, kind: 'info' },
      {
        key: 'playerRebate',
        group: '返水',
        label: '玩家回水（已领）',
        amount: side.playerRebateClaimed,
        kind: 'info',
      },

      {
        key: 'creditQuota',
        group: '信用',
        label: '剩余额度',
        amount: creditBook?.pointsQuota ?? 0,
        kind: 'info',
      },
      {
        key: 'creditPlayers',
        group: '信用',
        label: '玩家余额',
        amount: creditBook?.playerBalances ?? 0,
        kind: 'info',
      },
      {
        key: 'creditCs',
        group: '信用',
        label: '客服额度',
        amount: creditBook?.csBalances ?? 0,
        kind: 'info',
      },
      {
        key: 'creditExcess',
        group: '信用',
        label: '超出',
        amount: creditBook?.excess ?? 0,
        kind: 'info',
      },
      {
        key: 'agentPocket',
        group: '信用',
        label: '佣金账户',
        amount: isCredit ? agentBalance : 0,
        kind: 'info',
        note: isCredit
          ? '飞盘平台付的代理流水工资；结账：实付=占成应付+佣金账户−月费；清零后线下交割'
          : undefined,
      },

      {
        key: 'settleBase',
        group: '占成',
        label: '交割基数',
        amount: isCredit && creditBook ? creditBook.excess : settleBasis.housePnl,
        kind: 'info',
      },
      {
        key: 'agentShare',
        group: '占成',
        label: '代理份额',
        amount: settleBasis.agentShareAmount,
        kind: 'info',
      },
      {
        key: 'platformSharePay',
        group: '占成',
        label: '应付基数',
        amount: grossPay,
        kind: 'settle',
      },
      {
        key: 'agentBalanceOffset',
        group: '占成',
        label: balanceDelta >= 0 ? '加：佣金账户' : '减：佣金欠款',
        amount: balanceDelta,
        kind: 'settle',
        note: isCredit
          ? '实付=占成应付+佣金账户−月费；结清后佣金账户清零，实付须线下交割'
          : undefined,
      },
      {
        key: 'monthlyFee',
        group: '占成',
        label: '减：本期月费',
        amount: monthlyFeeSettle,
        kind: 'settle',
        note: !isCredit || monthlyFeeContract <= 0
          ? undefined
          : monthlyFeePeriod > 0
            ? `距下次月费≤7天，本期计整笔 ${monthlyFeeContract}`
            : `距下次月费>7天，本期不计（下期再看）`,
      },
    ];

    const settleLines = lines.filter((l) => l.kind === 'settle');
    const netAmount = roundMoney(settleLines.reduce((s, l) => s + l.amount, 0));
    const platformToAgent = roundMoney(Math.max(0, netAmount));
    const agentToPlatform = roundMoney(Math.max(0, -netAmount));
    const netDirection =
      netAmount > 1e-9
        ? 'PLATFORM_PAYS_AGENT'
        : netAmount < -1e-9
          ? 'AGENT_PAYS_PLATFORM'
          : 'EVEN';
    const netLabel =
      netDirection === 'PLATFORM_PAYS_AGENT'
        ? `平台需付给代理 ${platformToAgent}`
        : netDirection === 'AGENT_PAYS_PLATFORM'
          ? `代理需付给平台 ${agentToPlatform}`
          : '双方互不找补（交割净额为 0）';

    const agent = room.ownerAgent?.user;

    return {
      room: {
        id: room.id,
        roomNo: room.roomNo,
        name: room.name,
        bookMode: isCredit ? 'CREDIT' : 'CASH',
        bookLabel: isCredit ? 'B · 信用盘' : 'A · 现金盘',
        agentShareRate: share,
        agentSharePct: Math.round(share * 1000) / 10,
        platformSharePct: Math.round((1 - share) * 1000) / 10,
        creditLimit: Number(room.creditLimit ?? 0),
        agent: agent
          ? {
              userId: room.ownerAgent!.userId,
              uid: agent.uid,
              nickname: agent.nickname,
              username: agent.username,
            }
          : null,
      },
      period: {
        key: periodKey,
        label: periodLabel,
        weekStart: periodStart.toISOString(),
        weekEnd: periodEnd.toISOString(),
        fromText: fmtSh(periodStart),
        toText: fmtSh(periodEnd),
      },
      ops: {
        betFlow: agg.betFlow,
        payout: agg.payout,
        betCount: agg.betCount,
        housePnl: agg.housePnl,
        playerPnl: agg.playerPnl,
        upAmount: agg.upAmount,
        upCount: agg.upCount,
        downAmount: agg.downAmount,
        downCount: agg.downCount,
        activePlayers: agg.activePlayers,
        byGame: agg.byGame,
      },
      fees: {
        commissionAmount: agg.commissionAmount,
        commissionCount: agg.commissionCount,
        flyRebateToAgent: side.flyRebateToAgent,
        playerRebateClaimed: side.playerRebateClaimed,
        playerRebateCount: side.playerRebateCount,
        /** 合同月费（整月） */
        monthlyFee: monthlyFeeContract,
        /** 本期是否计入（距下次月费≤7天则整笔；现金盘走余额自动扣） */
        monthlyFeePeriod,
        nextBillAt: room.nextBillAt?.toISOString?.() ?? room.nextBillAt ?? null,
      },
      creditBook,
      share: settleBasis,
      lines,
      settlement: {
        platformToAgent,
        agentToPlatform,
        netAmount,
        netDirection,
        netLabel,
        /** 挂靠佣金仍仅展示；信用盘代理余额已轧入交割净额 */
        alreadyPaidToAgent: roundMoney(
          isCredit
            ? agg.commissionAmount
            : agg.commissionAmount + side.flyRebateToAgent,
        ),
        /** @deprecated 兼容旧前端；信用盘改轧代理余额 */
        flyRebateOffset: isCredit ? Math.max(0, agentBalance) : 0,
        agentBalanceOffset: isCredit ? agentBalance : 0,
        monthlyFeePeriod,
        grossPlatformPayToAgent: settleBasis.platformPayToAgent,
      },
    };
  }

  async exportStatementCsv(
    actor: ConsoleActor,
    roomId: string,
    opts?: { period?: 'current' | 'last' | 'early'; weekStart?: string },
  ) {
    const s = await this.statement(actor, roomId, opts);

    /** 横排两行账单：上行项目名，下行金额（去掉应付基数等重复项） */
    const skipKeys = new Set(['platformSharePay']);
    const items: Array<{ name: string; amount: number }> = [];
    for (const l of s.lines) {
      if (skipKeys.has(l.key)) continue;
      if (l.key === 'agentBalanceOffset' || l.key === 'flyRebateOffset') {
        const bal = Number(
          s.settlement.agentBalanceOffset ?? s.settlement.flyRebateOffset ?? 0,
        );
        items.push({
          name: bal >= 0 ? '加：佣金账户' : '减：佣金欠款',
          amount: s.room.bookMode === 'CREDIT' ? bal : 0,
        });
        continue;
      }
      if (l.key === 'monthlyFee') {
        items.push({
          name: '减：本期月费',
          amount: s.room.bookMode === 'CREDIT' ? Number(s.settlement.monthlyFeePeriod || 0) : 0,
        });
        continue;
      }
      items.push({ name: l.label, amount: l.amount });
    }
    /** 代理赢利 = 占成份额 + 佣金账户（结账轧差项） */
    const agentWin = roundMoney(
      Number(s.share.agentShareAmount || 0) +
        Number(s.settlement.agentBalanceOffset ?? s.fees.flyRebateToAgent ?? 0),
    );
    const payPlat = Number(s.settlement.agentToPlatform || 0);
    const payAgent = Number(s.settlement.platformToAgent || 0);
    const netAbs = Math.abs(Number(s.settlement.netAmount || 0));
    items.push({ name: '代理赢利', amount: agentWin });
    items.push({ name: '实付', amount: netAbs });
    if (payPlat > 0) items.push({ name: '代理应付平台', amount: payPlat });
    else if (payAgent > 0) items.push({ name: '平台应付代理', amount: payAgent });
    else items.push({ name: '互不找补', amount: 0 });

    const names = ['项目', ...items.map((i) => i.name)];
    const amounts = ['金额', ...items.map((i) => i.amount)];

    const agentName = s.room.agent
      ? `${s.room.agent.nickname}/${s.room.agent.username}`
      : '';
    const lines = [
      csvRow([
        '房间结账对账单',
        `${s.room.name}（${s.room.roomNo}）`,
        s.room.bookLabel,
        agentName,
        `代${s.room.agentSharePct}%`,
        `平${s.room.platformSharePct}%`,
        s.period.label,
        `${s.period.fromText}～${s.period.toText}`,
      ]),
      csvRow(names),
      csvRow(amounts),
      csvRow([
        '结论',
        s.settlement.netLabel,
        '代理赢利(份额+飞盘返水)',
        agentWin,
        payPlat > 0 ? '代理应付平台' : payAgent > 0 ? '平台应付代理' : '互不找补',
        payPlat > 0 ? payPlat : payAgent,
      ]),
    ];

    const day = (s.period.fromText || '').slice(0, 10) || 'settle';
    const csv = `\uFEFF${lines.join('\r\n')}`;
    return {
      filename: `对账单-${s.room.roomNo}-${day}-${s.period.key}.csv`,
      csv,
      statement: s,
    };
  }

  async overview(actor: ConsoleActor, roomId: string) {
    const room = await this.roomOrThrow(actor, roomId);
    const cycle = normalizeSettleCycle(room.settleCycle);
    const current = shanghaiSettleBounds(cycle, 0);
    const last = shanghaiSettleBounds(cycle, -1);
    const share = Math.min(1, Math.max(0, Number(room.agentShareRate ?? 0)));
    const isCredit = room.bookMode === 'CREDIT';

    const [curAgg, lastAgg, history, creditBook] = await Promise.all([
      this.sumRoomWeek(actor, roomId, current.periodStart, current.periodEnd),
      this.sumRoomWeek(actor, roomId, last.periodStart, last.periodEnd),
      this.prisma.roomWeekSettle.findMany({
        where: { roomId },
        orderBy: { weekStart: 'desc' },
        take: 16,
      }),
      this.loadCreditBook(room),
    ]);

    const histMap = new Map(history.map((h) => [h.weekStart.toISOString(), h]));
    const curSplit = isCredit && creditBook
      ? {
          housePnl: creditBook.housePnl,
          agentShareAmount: creditBook.agentShareAmount,
          platformShareAmount: creditBook.platformShareAmount,
        }
      : { ...this.split(curAgg.housePnl, share), housePnl: curAgg.housePnl };
    const lastSplit = isCredit && creditBook
      ? {
          housePnl: creditBook.housePnl,
          agentShareAmount: creditBook.agentShareAmount,
          platformShareAmount: creditBook.platformShareAmount,
        }
      : { ...this.split(lastAgg.housePnl, share), housePnl: lastAgg.housePnl };

    const lastRow = histMap.get(last.periodStart.toISOString());
    const lastStatus = lastRow?.status
      ?? (Date.now() >= current.periodStart.getTime() ? 'CLOSED' : 'OPEN');

    return {
      contract: {
        bookMode: isCredit ? 'CREDIT' : 'CASH',
        bookLabel: isCredit ? 'B · 信用盘' : 'A · 现金盘',
        agentShareRate: share,
        agentSharePct: Math.round(share * 1000) / 10,
        platformSharePct: Math.round((1 - share) * 1000) / 10,
        creditLimit: Number(room.creditLimit ?? 0),
        settleCycle: cycle,
        settleWeekday: settleCycleToWeekday(cycle),
        settleLabel: settleCycleLabel(cycle),
      },
      /** 信用盘实时账本：合计/超出/结后额度预览 */
      creditBook: creditBook
        ? {
            creditLimit: creditBook.creditLimit,
            pointsQuota: creditBook.pointsQuota,
            playerBalances: creditBook.playerBalances,
            csBalances: creditBook.csBalances,
            sum: creditBook.sum,
            excess: creditBook.excess,
            newQuota: creditBook.newQuota,
            platformPayToAgent: creditBook.platformPayToAgent,
            agentShareAmount: creditBook.agentShareAmount,
            platformShareAmount: creditBook.platformShareAmount,
            housePnl: creditBook.housePnl,
          }
        : null,
      currentWeek: {
        weekStart: current.periodStart.toISOString(),
        weekEnd: current.periodEnd.toISOString(),
        fromText: fmtSh(current.periodStart),
        toText: fmtSh(current.periodEnd),
        status: 'OPEN',
        betFlow: curAgg.betFlow,
        payout: curAgg.payout,
        betCount: curAgg.betCount,
        ...curSplit,
      },
      lastWeek: {
        weekStart: last.periodStart.toISOString(),
        weekEnd: last.periodEnd.toISOString(),
        fromText: fmtSh(last.periodStart),
        toText: fmtSh(last.periodEnd),
        status: lastStatus,
        settledAt: lastRow?.settledAt?.toISOString() ?? null,
        creditRestored: lastRow?.creditRestored ?? false,
        id: lastRow?.id ?? null,
        betFlow: lastRow ? Number(lastRow.betFlow) : lastAgg.betFlow,
        payout: lastAgg.payout,
        betCount: lastAgg.betCount,
        ...(lastRow
          ? {
              agentShareAmount: Number(lastRow.agentShareAmount),
              platformShareAmount: Number(lastRow.platformShareAmount),
              housePnl: Number(lastRow.housePnl),
            }
          : lastSplit),
        canMarkSettled:
          lastStatus !== 'SETTLED'
          && (actor.role === 'ADMIN' || actor.role === 'BRANCH'),
      },
      /** CREDIT：仅管理员/房主可提前结清；代理只读对账 */
      canEarlySettle:
        isCredit
        && (actor.role === 'ADMIN' || actor.role === 'BRANCH'),
      history: history.map((h) => ({
        id: h.id,
        weekStart: h.weekStart.toISOString(),
        weekEnd: h.weekEnd.toISOString(),
        fromText: fmtSh(h.weekStart),
        toText: fmtSh(h.weekEnd),
        bookMode: h.bookMode,
        agentShareRate: h.agentShareRate,
        betFlow: Number(h.betFlow),
        housePnl: Number(h.housePnl),
        agentShareAmount: Number(h.agentShareAmount),
        platformShareAmount: Number(h.platformShareAmount),
        settlePay: Number(h.settlePay ?? 0),
        agentPocketAtSettle: Number(h.agentPocketAtSettle ?? 0),
        monthlyFeePeriod: Number(h.monthlyFeePeriod ?? 0),
        paymentStatus: h.paymentStatus ?? 'NONE',
        paidAt: h.paidAt?.toISOString() ?? null,
        status: h.status,
        settledAt: h.settledAt?.toISOString() ?? null,
        creditRestored: h.creditRestored,
        note: h.note,
      })),
    };
  }

  /**
   * CREDIT 提前结账：按当前「剩余额度+玩家余额」相对初始额度轧差交割，
   * 并把剩余信用校准为 初始额度−玩家余额（可为负）。
   */
  async earlySettle(
    actor: ConsoleActor,
    roomId: string,
    body?: { note?: string },
  ) {
    if (!['ADMIN', 'BRANCH'].includes(actor.role)) {
      throw new ForbiddenException('仅管理员/房主可结账；代理只可查看对账');
    }
    const room = await this.roomOrThrow(actor, roomId);
    if (room.bookMode !== 'CREDIT') {
      throw new BadRequestException('仅信用盘支持提前结账');
    }
    const cycle = normalizeSettleCycle(room.settleCycle);
    const current = shanghaiSettleBounds(cycle, 0);
    const lastSettled = await this.prisma.roomWeekSettle.findFirst({
      where: { roomId, status: 'SETTLED' },
      orderBy: { weekEnd: 'desc' },
    });
    let weekStart = current.periodStart;
    if (lastSettled && lastSettled.weekEnd.getTime() > weekStart.getTime()) {
      weekStart = lastSettled.weekEnd;
    }
    const weekEnd = new Date();
    if (weekEnd.getTime() - weekStart.getTime() < 60_000) {
      throw new BadRequestException('距上次结清不足 1 分钟，请稍后再试');
    }
    // 用毫秒级 weekStart 避免与常规周一账期主键撞车
    if (weekStart.getTime() === current.periodStart.getTime() && lastSettled?.weekStart.getTime() === weekStart.getTime()) {
      throw new BadRequestException('本期已结清');
    }
    return this.persistSettle(actor, room, roomId, weekStart, weekEnd, body?.note, true);
  }

  async markSettled(
    actor: ConsoleActor,
    roomId: string,
    body?: { weekStart?: string; note?: string; early?: boolean },
  ) {
    if (body?.early) {
      return this.earlySettle(actor, roomId, { note: body.note });
    }
    if (!['ADMIN', 'BRANCH'].includes(actor.role)) {
      throw new ForbiddenException('仅管理员/房主可结账；代理只可查看对账');
    }
    const room = await this.roomOrThrow(actor, roomId);
    const cycle = normalizeSettleCycle(room.settleCycle);
    const last = shanghaiSettleBounds(cycle, -1);
    let weekStart = last.periodStart;
    let weekEnd = last.periodEnd;
    if (body?.weekStart) {
      const ws = new Date(body.weekStart);
      if (Number.isNaN(ws.getTime())) throw new BadRequestException('weekStart 无效');
      weekStart = ws;
      if (ws.getTime() === last.periodStart.getTime()) {
        weekEnd = last.periodEnd;
      } else {
        weekEnd = new Date(ws.getTime() + 7 * DAY_MS);
      }
    }

    if (weekEnd.getTime() > Date.now() + 60_000) {
      throw new BadRequestException('该账期尚未关账，不能标记已结清');
    }
    return this.persistSettle(actor, room, roomId, weekStart, weekEnd, body?.note, false);
  }

  private async persistSettle(
    actor: ConsoleActor,
    room: Awaited<ReturnType<RoomSettleService['roomOrThrow']>>,
    roomId: string,
    weekStart: Date,
    weekEnd: Date,
    note: string | undefined,
    early: boolean,
  ) {
    const agg = await this.sumRoomWeek(actor, roomId, weekStart, weekEnd);
    const share = Math.min(1, Math.max(0, Number(room.agentShareRate ?? 0)));
    const bookMode = room.bookMode === 'CREDIT' ? 'CREDIT' : 'CASH';

    const noteParts = [early ? '提前结账' : null, note?.trim() || null].filter(Boolean);

    let creditRestored = false;
    let settledHousePnl = agg.housePnl;
    let agentShareAmount = 0;
    let platformShareAmount = 0;
    let settleGrossPay = 0;
    let settlePocket = 0;
    let settleFee = 0;
    let settlePay = 0;
    let paymentStatus = 'NONE';
    const creditHold: { book: CreditBookSnapshot | null } = { book: null };

    if (bookMode === 'CASH') {
      const split = this.split(agg.housePnl, share);
      agentShareAmount = split.agentShareAmount;
      platformShareAmount = split.platformShareAmount;
    }

    const row = await this.prisma.$transaction(async (tx) => {
      const existing = await tx.roomWeekSettle.findUnique({
        where: { roomId_weekStart: { roomId, weekStart } },
      });
      if (existing?.status === 'SETTLED') {
        throw new BadRequestException('该账期已标记结清');
      }

      if (bookMode === 'CREDIT' && room.ownerAgent && Number(room.creditLimit) > 0) {
        await lockAgentRowInTx(tx, room.ownerAgent.userId);
        await tx.$queryRaw`SELECT id FROM "Room" WHERE "id" = ${roomId} FOR UPDATE`;

        const multi = await tx.room.count({
          where: {
            ownerAgentId: room.ownerAgent.id,
            id: { not: roomId },
            bookMode: 'CREDIT',
          },
        });
        if (multi > 0) {
          throw new BadRequestException(
            '该代理绑定了多间信用盘房间，禁止结账（会串佣金账户/额度）。请拆成一房一代理后再结',
          );
        }

        const agent = await tx.agent.findUnique({
          where: { id: room.ownerAgent.id },
          select: { id: true, userId: true, pointsQuota: true },
        });
        if (!agent) throw new BadRequestException('代理账户不存在');

        /** 锁内重读合同/月费，避免与调额度并发用到陈旧 creditLimit */
        const roomLocked = await tx.room.findUnique({
          where: { id: roomId },
          select: {
            creditLimit: true,
            monthlyFee: true,
            billingDay: true,
            nextBillAt: true,
          },
        });
        if (!roomLocked) throw new BadRequestException('房间不存在');

        const [playerBalances, csBalances] = await Promise.all([
          sumRoomPlayerBalances(tx, roomId),
          sumAgentCsBalances(tx, agent.userId),
        ]);
        const book = computeCreditBook({
          creditLimit: Number(roomLocked.creditLimit),
          pointsQuota: asMoney(agent.pointsQuota),
          playerBalances,
          csBalances,
          agentShareRate: share,
        });
        creditHold.book = book;
        settledHousePnl = book.housePnl;
        agentShareAmount = book.agentShareAmount;
        platformShareAmount = book.platformShareAmount;

        await writeAgentQuotaInTx(tx, {
          agentUserId: agent.userId,
          bookMode: 'CREDIT',
          quotaTo: book.newQuota,
          usedTo: roundMoney(book.playerBalances + book.csBalances),
          bizType: 'SETTLE',
          remark: `信用盘结账校准剩余信用（合同 ${book.creditLimit}）`,
          refType: 'credit_settle',
          refId: roomId,
          idempotencyKey: `credit_settle_${roomId}_${weekStart.toISOString()}:QUOTA`,
        });
        await tx.room.update({
          where: { id: roomId },
          data: { overIssueUsed: new Prisma.Decimal(0) },
        });

        const grossPay = book.platformPayToAgent;
        const feeAsOf = early ? new Date() : weekEnd;
        const monthlyFeePeriod = creditMonthlyFeeDueThisPeriod(
          asMoney(roomLocked.monthlyFee),
          roomLocked.nextBillAt,
          feeAsOf,
        );
        const settleKey = `credit_settle_${roomId}_${weekStart.toISOString()}`;

        await tx.$queryRaw`
          SELECT id FROM "PointsAccount"
          WHERE "ownerType" = 'AGENT'::"AccountOwnerType"
            AND "ownerId" = ${agent.userId}
            AND "roomId" = ''
          FOR UPDATE
        `;
        const acc = await tx.pointsAccount.findUnique({
          where: this.points.accountWhere('AGENT', agent.userId),
          select: { balance: true },
        });
        const pocket = asMoney(acc?.balance ?? 0);
        const pay = roundMoney(
          netCreditSettlePay(grossPay, pocket) - monthlyFeePeriod,
        );

        settleGrossPay = grossPay;
        settlePocket = pocket;
        settleFee = monthlyFeePeriod;
        settlePay = pay;
        paymentStatus =
          Math.abs(pay) < 1e-9 ? 'EVEN' : 'UNPAID';

        /** 佣金账户清零；实付仅落库供线下交割，不在系统内再转整笔 */
        if (pocket > 1e-9) {
          await this.points.transferInTx(
            tx,
            {
              type: 'AGENT',
              id: agent.userId,
              remark: '信用盘结账·佣金账户清零',
              idempotencyKey: `${settleKey}_pocket_out`,
            },
            {
              type: 'PLATFORM',
              id: PLATFORM_OWNER_ID,
              remark: `信用盘结账收回佣金（超出${book.excess}）`,
              idempotencyKey: `${settleKey}_pocket_plat_in`,
            },
            pocket,
            {
              bizType: 'ADJUST',
              bizTypeIn: 'ADJUST',
              operatorId: actor.id,
              refType: 'room_week_settle',
              refId: roomId,
              remark: `信用盘结账清零佣金 ${pocket}；占成${grossPay} 实付${pay}`,
            },
          );
        } else if (pocket < -1e-9) {
          const fill = roundMoney(-pocket);
          await this.points.transferInTx(
            tx,
            {
              type: 'PLATFORM',
              id: PLATFORM_OWNER_ID,
              remark: `信用盘结账补平佣金欠款（超出${book.excess}）`,
              idempotencyKey: `${settleKey}_pocket_plat_out`,
            },
            {
              type: 'AGENT',
              id: agent.userId,
              remark: '信用盘结账·佣金欠款清零',
              idempotencyKey: `${settleKey}_pocket_in`,
            },
            fill,
            {
              bizType: 'ADJUST',
              bizTypeIn: 'ADJUST',
              operatorId: actor.id,
              refType: 'room_week_settle',
              refId: roomId,
              remark: `信用盘结账清零佣金欠款 ${fill}；占成${grossPay} 实付${pay}`,
            },
          );
        }

        if (monthlyFeePeriod > 0 && roomLocked.nextBillAt) {
          const nextDue = advanceCreditBillAt(
            roomLocked.nextBillAt instanceof Date
              ? roomLocked.nextBillAt
              : new Date(roomLocked.nextBillAt),
            roomLocked.billingDay ?? 1,
          );
          await tx.room.update({
            where: { id: roomId },
            data: {
              lastBilledAt: feeAsOf,
              nextBillAt: nextDue,
            },
          });
        }

        noteParts.push(
          `额度校准 ${book.pointsQuota}→${book.newQuota}`,
          `超出${book.excess}`,
          `占成${grossPay}`,
          `轧佣金${pocket}`,
          monthlyFeePeriod > 0 ? `减月费${monthlyFeePeriod}` : null,
          pay === 0
            ? '互不找补'
            : pay > 0
              ? `实付·平台付代理${pay}（待线下交割）`
              : `实付·代理付平台${roundMoney(-pay)}（待线下交割）`,
          '佣金账户已清零',
        );
        creditRestored = true;
      }

      const noteText = noteParts.filter(Boolean).join(' · ') || null;
      const settleFields = {
        grossPay: new Prisma.Decimal(roundMoney(settleGrossPay).toFixed(2)),
        agentPocketAtSettle: new Prisma.Decimal(roundMoney(settlePocket).toFixed(2)),
        monthlyFeePeriod: new Prisma.Decimal(roundMoney(settleFee).toFixed(2)),
        settlePay: new Prisma.Decimal(roundMoney(settlePay).toFixed(2)),
        paymentStatus,
      };

      return tx.roomWeekSettle.upsert({
        where: { roomId_weekStart: { roomId, weekStart } },
        create: {
          roomId,
          weekStart,
          weekEnd,
          bookMode,
          agentShareRate: share,
          betFlow: new Prisma.Decimal(roundMoney(agg.betFlow)),
          housePnl: new Prisma.Decimal(roundMoney(settledHousePnl)),
          agentShareAmount: new Prisma.Decimal(roundMoney(agentShareAmount)),
          platformShareAmount: new Prisma.Decimal(roundMoney(platformShareAmount)),
          ...settleFields,
          status: 'SETTLED',
          settledAt: new Date(),
          settledById: actor.id,
          creditRestored,
          note: noteText,
        },
        update: {
          betFlow: new Prisma.Decimal(roundMoney(agg.betFlow)),
          housePnl: new Prisma.Decimal(roundMoney(settledHousePnl)),
          agentShareAmount: new Prisma.Decimal(roundMoney(agentShareAmount)),
          platformShareAmount: new Prisma.Decimal(roundMoney(platformShareAmount)),
          ...settleFields,
          bookMode,
          agentShareRate: share,
          status: 'SETTLED',
          settledAt: new Date(),
          settledById: actor.id,
          creditRestored,
          note: noteText,
          weekEnd,
        },
      });
    });

    const creditBook = creditHold.book;
    await this.adminLog.log(actor.id, early ? 'ROOM_WEEK_SETTLE_EARLY' : 'ROOM_WEEK_SETTLE', roomId, {
      weekStart,
      weekEnd,
      bookMode,
      housePnl: settledHousePnl,
      agentShareAmount,
      platformShareAmount,
      settlePay,
      settlePocket,
      settleFee,
      settleGrossPay,
      paymentStatus,
      creditRestored,
      early,
      creditBook: creditBook
        ? {
            excess: creditBook.excess,
            sum: creditBook.sum,
            playerBalances: creditBook.playerBalances,
            csBalances: creditBook.csBalances,
            pointsQuotaBefore: creditBook.pointsQuota,
            newQuota: creditBook.newQuota,
            platformPayToAgent: creditBook.platformPayToAgent,
          }
        : null,
    });

    return {
      ok: true,
      id: row.id,
      status: row.status,
      creditRestored,
      early,
      weekStart: weekStart.toISOString(),
      fromText: fmtSh(weekStart),
      toText: fmtSh(weekEnd),
      settlePay,
      agentPocketAtSettle: settlePocket,
      monthlyFeePeriod: settleFee,
      grossPay: settleGrossPay,
      paymentStatus,
      creditBook: creditBook
        ? {
            excess: creditBook.excess,
            newQuota: creditBook.newQuota,
            platformPayToAgent: creditBook.platformPayToAgent,
            playerBalances: creditBook.playerBalances,
            csBalances: creditBook.csBalances,
            housePnl: creditBook.housePnl,
            agentShareAmount: creditBook.agentShareAmount,
            platformShareAmount: creditBook.platformShareAmount,
          }
        : null,
    };
  }

  /** 确认线下已交割实付（结清账本后的收款闭环） */
  async confirmPayment(
    actor: ConsoleActor,
    roomId: string,
    body?: { settleId?: string; weekStart?: string; note?: string },
  ) {
    if (!['ADMIN', 'BRANCH'].includes(actor.role)) {
      throw new ForbiddenException('仅管理员/房主可确认收款');
    }
    await this.roomOrThrow(actor, roomId);

    let row = body?.settleId
      ? await this.prisma.roomWeekSettle.findFirst({
          where: { id: body.settleId, roomId },
        })
      : null;
    if (!row && body?.weekStart) {
      const ws = new Date(body.weekStart);
      if (Number.isNaN(ws.getTime())) throw new BadRequestException('weekStart 无效');
      row = await this.prisma.roomWeekSettle.findUnique({
        where: { roomId_weekStart: { roomId, weekStart: ws } },
      });
    }
    if (!row) {
      row = await this.prisma.roomWeekSettle.findFirst({
        where: { roomId, status: 'SETTLED', paymentStatus: 'UNPAID' },
        orderBy: { settledAt: 'desc' },
      });
    }
    if (!row) throw new NotFoundException('未找到待收款的结账单');
    if (row.status !== 'SETTLED') {
      throw new BadRequestException('请先完成结账再确认收款');
    }
    if (row.paymentStatus === 'PAID') {
      throw new BadRequestException('该期实付已确认收款');
    }
    if (row.paymentStatus === 'NONE') {
      throw new BadRequestException('该结账单无需线下交割');
    }
    if (row.paymentStatus === 'EVEN') {
      // 允许标记为已核对
    }

    const pay = asMoney(row.settlePay);
    const updated = await this.prisma.roomWeekSettle.update({
      where: { id: row.id },
      data: {
        paymentStatus: 'PAID',
        paidAt: new Date(),
        paidById: actor.id,
        paymentNote: body?.note?.trim() || null,
      },
    });

    await this.adminLog.log(actor.id, 'ROOM_WEEK_SETTLE_PAYMENT', roomId, {
      settleId: row.id,
      weekStart: row.weekStart,
      settlePay: pay,
      note: body?.note?.trim() || null,
    });

    return {
      ok: true,
      id: updated.id,
      paymentStatus: updated.paymentStatus,
      settlePay: pay,
      paidAt: updated.paidAt?.toISOString() ?? null,
      direction:
        pay > 1e-9
          ? 'PLATFORM_PAYS_AGENT'
          : pay < -1e-9
            ? 'AGENT_PAYS_PLATFORM'
            : 'EVEN',
    };
  }
}
