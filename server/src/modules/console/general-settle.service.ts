/**
 * 总代与平台的账期结算。
 *
 * 和房间那套是两个粒度，故意分开：
 * - 房间 ↔ 代理：按各房自谈的周期交割，走 RoomWeekSettle
 * - 平台 ↔ 总代：按总代自己的周期，把名下所有房间汇总成一张表，一次清账
 *
 * 汇总一律用注单口径（流水 − 派彩），不依赖房间有没有跟代理结完账。
 * 月结的房一个月里会被四次周结各算一段，加起来等于代理那次月结里平台该得的部分；
 * 中间总代收不回来的部分是他垫，账面上只做展示，不改他该付平台的数。
 */
import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { asMoney, roundMoney } from '@gamebox/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { AdminLogService } from '../admin/admin-log.service';
import { ConsoleReportsService } from './console-reports.service';
import { ConsoleScopeService, type ConsoleActor } from './console-scope.service';
import {
  normalizeSettleCycle,
  settleCycleLabel,
  shanghaiSettleBounds,
} from './room-settle.service';
import { splitHouseShare } from './share-split.helper';

export type GeneralRoomLine = {
  roomId: string;
  roomNo: string;
  name: string;
  status: string;
  bookMode: string;
  agentNickname: string | null;
  agentUsername: string | null;
  /** 本房与代理约定的周期 */
  settleCycle: string;
  settleLabel: string;
  betFlow: number;
  payout: number;
  housePnl: number;
  agentShareRate: number;
  agentShareAmount: number;
  /** 总代在这一房拿到的成数差 */
  generalShareAmount: number;
  /** 平台从这一房拿走的，也就是总代要替它交的 */
  platformShareAmount: number;
  /** 与代理的账结到哪了 */
  agentSettleStatus: 'SETTLED' | 'PENDING';
  agentSettledAt: string | null;
};

@Injectable()
export class GeneralSettleService {
  constructor(
    private prisma: PrismaService,
    private scope: ConsoleScopeService,
    private reports: ConsoleReportsService,
    private adminLog: AdminLogService,
  ) {}

  /** 只有管理/总监能看别人的账；总代只能看自己的 */
  private async resolveTarget(actor: ConsoleActor, generalUserId?: string) {
    const targetId =
      actor.role === 'GENERAL' ? actor.id : String(generalUserId || '').trim();
    if (!targetId) throw new BadRequestException('请指定总代');
    if (actor.role !== 'ADMIN' && actor.role !== 'BRANCH' && actor.role !== 'GENERAL') {
      throw new ForbiddenException('无权查看总代账期');
    }

    const user = await this.prisma.user.findUnique({
      where: { id: targetId },
      select: {
        id: true,
        uid: true,
        nickname: true,
        username: true,
        role: true,
        agent: {
          select: {
            id: true,
            bookMode: true,
            creditLimit: true,
            pointsQuota: true,
            settleCycle: true,
            shareRate: true,
            flowRate: true,
          },
        },
      },
    });
    if (!user || user.role !== 'GENERAL' || !user.agent) {
      throw new NotFoundException('总代不存在');
    }
    return user;
  }

  /**
   * 账期汇总。period: current=本期进行中 / last=上一期（要结的通常是这个）
   */
  async statement(
    actor: ConsoleActor,
    opts: { generalUserId?: string; period?: 'current' | 'last'; periodStart?: string } = {},
  ) {
    const target = await this.resolveTarget(actor, opts.generalUserId);
    const cycle = normalizeSettleCycle(target.agent!.settleCycle);
    const periodKey = opts.period === 'current' ? 'current' : 'last';

    let bounds = shanghaiSettleBounds(cycle, periodKey === 'current' ? 0 : -1);
    if (opts.periodStart) {
      const ps = new Date(opts.periodStart);
      if (Number.isNaN(ps.getTime())) throw new BadRequestException('periodStart 无效');
      const saved = await this.prisma.generalPeriodSettle.findUnique({
        where: { generalUserId_periodStart: { generalUserId: target.id, periodStart: ps } },
      });
      if (saved) {
        return this.fromSaved(target, saved);
      }
      bounds = { periodStart: ps, periodEnd: bounds.periodEnd };
    }

    const saved = await this.prisma.generalPeriodSettle.findUnique({
      where: {
        generalUserId_periodStart: { generalUserId: target.id, periodStart: bounds.periodStart },
      },
    });
    if (saved && saved.status === 'SETTLED') {
      return this.fromSaved(target, saved);
    }

    const lines = await this.buildLines(target, bounds.periodStart, bounds.periodEnd);
    const totals = this.sumLines(lines);

    return {
      general: {
        userId: target.id,
        uid: target.uid,
        nickname: target.nickname,
        username: target.username,
        bookMode: target.agent!.bookMode === 'CREDIT' ? 'CREDIT' : 'CASH',
        creditLimit: asMoney(target.agent!.creditLimit),
        pointsQuota: asMoney(target.agent!.pointsQuota),
        shareRate: Number(target.agent!.shareRate ?? 0),
        flowRate: Number(target.agent!.flowRate ?? 0),
        settleCycle: cycle,
        settleLabel: settleCycleLabel(cycle),
      },
      period: {
        key: periodKey,
        periodStart: bounds.periodStart.toISOString(),
        periodEnd: bounds.periodEnd.toISOString(),
        status: saved?.status ?? 'OPEN',
        settledAt: saved?.settledAt?.toISOString() ?? null,
      },
      totals,
      rooms: lines,
      /** 总代先垫给平台的部分：本期平台应得里，还没跟代理结清的那些房 */
      pendingFromAgents: roundMoney(
        lines
          .filter((l) => l.agentSettleStatus === 'PENDING')
          .reduce((s, l) => s + l.platformShareAmount, 0),
      ),
      canSettle: actor.role === 'ADMIN' || actor.role === 'BRANCH',
    };
  }

  /** 已结账期直接回放快照，不再重算——重算会被后续改档和补注单污染 */
  private fromSaved(
    target: Awaited<ReturnType<GeneralSettleService['resolveTarget']>>,
    row: Prisma.GeneralPeriodSettleGetPayload<object>,
  ) {
    const cycle = normalizeSettleCycle(target.agent!.settleCycle);
    let rooms: GeneralRoomLine[] = [];
    try {
      rooms = JSON.parse(row.roomsSnapshot) as GeneralRoomLine[];
    } catch {
      rooms = [];
    }
    return {
      general: {
        userId: target.id,
        uid: target.uid,
        nickname: target.nickname,
        username: target.username,
        bookMode: row.bookMode,
        creditLimit: asMoney(row.creditLimit),
        pointsQuota: asMoney(target.agent!.pointsQuota),
        shareRate: row.generalShareRate,
        flowRate: Number(target.agent!.flowRate ?? 0),
        settleCycle: cycle,
        settleLabel: settleCycleLabel(cycle),
      },
      period: {
        key: 'saved' as const,
        periodStart: row.periodStart.toISOString(),
        periodEnd: row.periodEnd.toISOString(),
        status: row.status,
        settledAt: row.settledAt?.toISOString() ?? null,
      },
      totals: {
        roomCount: row.roomCount,
        betFlow: asMoney(row.betFlow),
        payout: asMoney(row.payout),
        housePnl: asMoney(row.housePnl),
        agentShareAmount: asMoney(row.agentShareAmount),
        generalShareAmount: asMoney(row.generalShareAmount),
        platformShareAmount: asMoney(row.platformShareAmount),
      },
      rooms,
      pendingFromAgents: roundMoney(
        rooms
          .filter((l) => l.agentSettleStatus === 'PENDING')
          .reduce((s, l) => s + l.platformShareAmount, 0),
      ),
      canSettle: false,
      note: row.note,
    };
  }

  /** 名下每间房在账期内的经营结果与三段拆 */
  private async buildLines(
    target: Awaited<ReturnType<GeneralSettleService['resolveTarget']>>,
    from: Date,
    to: Date,
  ): Promise<GeneralRoomLine[]> {
    const rooms = await this.prisma.room.findMany({
      where: { generalAgentId: target.agent!.id },
      select: {
        id: true,
        roomNo: true,
        name: true,
        status: true,
        bookMode: true,
        agentShareRate: true,
        settleCycle: true,
        ownerAgent: {
          select: { user: { select: { nickname: true, username: true } } },
        },
      },
      orderBy: { roomNo: 'asc' },
    });
    if (!rooms.length) return [];

    const roomIds = rooms.map((r) => r.id);
    const [byRoom, agentSettles] = await Promise.all([
      this.reports.settledRoomAgg(roomIds, from, to),
      this.prisma.roomWeekSettle.findMany({
        where: { roomId: { in: roomIds }, status: 'SETTLED', weekEnd: { gte: from } },
        select: { roomId: true, weekEnd: true, settledAt: true },
        orderBy: { weekEnd: 'desc' },
      }),
    ]);
    const lastAgentSettle = new Map<string, { weekEnd: Date; settledAt: Date | null }>();
    for (const s of agentSettles) {
      if (!lastAgentSettle.has(s.roomId)) {
        lastAgentSettle.set(s.roomId, { weekEnd: s.weekEnd, settledAt: s.settledAt });
      }
    }

    const gShare = Math.min(1, Math.max(0, Number(target.agent!.shareRate ?? 0)));

    return rooms.map((r) => {
      const agg = byRoom.get(r.id);
      const betFlow = asMoney(agg?.flow ?? 0);
      const payout = asMoney(agg?.payout ?? 0);
      const housePnl = roundMoney(betFlow - payout);
      const aShare = Math.min(1, Math.max(0, Number(r.agentShareRate ?? 0)));
      const { agentShareAmount, generalShareAmount, platformShareAmount } = splitHouseShare(
        housePnl,
        aShare,
        gShare,
      );
      const cycle = normalizeSettleCycle(r.settleCycle);
      const settled = lastAgentSettle.get(r.id);
      /* 代理那边把覆盖本账期结束点的账结掉了，才算结清 */
      const agentSettleStatus =
        settled && settled.weekEnd.getTime() >= to.getTime() ? 'SETTLED' : 'PENDING';

      return {
        roomId: r.id,
        roomNo: r.roomNo,
        name: r.name,
        status: r.status,
        bookMode: r.bookMode === 'CREDIT' ? 'CREDIT' : 'CASH',
        agentNickname: r.ownerAgent?.user.nickname ?? null,
        agentUsername: r.ownerAgent?.user.username ?? null,
        settleCycle: cycle,
        settleLabel: settleCycleLabel(cycle),
        betFlow,
        payout,
        housePnl,
        agentShareRate: aShare,
        agentShareAmount,
        generalShareAmount,
        platformShareAmount,
        agentSettleStatus,
        agentSettledAt: settled?.settledAt?.toISOString() ?? null,
      } satisfies GeneralRoomLine;
    });
  }

  private sumLines(lines: GeneralRoomLine[]) {
    const add = (pick: (l: GeneralRoomLine) => number) =>
      roundMoney(lines.reduce((s, l) => s + pick(l), 0));
    return {
      roomCount: lines.length,
      betFlow: add((l) => l.betFlow),
      payout: add((l) => l.payout),
      housePnl: add((l) => l.housePnl),
      agentShareAmount: add((l) => l.agentShareAmount),
      generalShareAmount: add((l) => l.generalShareAmount),
      platformShareAmount: add((l) => l.platformShareAmount),
    };
  }

  /**
   * 结清一个账期：把汇总与每房明细定格成快照。
   * 信用盘另把封账时的剩余信用记下来，对接补额度时按「当前额度 + 本期已结」补，
   * 封账之后产生的输赢就自动留到下一期，不会被抹掉。
   */
  async settle(
    actor: ConsoleActor,
    generalUserId: string,
    opts?: { period?: 'current' | 'last'; note?: string },
  ) {
    if (actor.role !== 'ADMIN' && actor.role !== 'BRANCH') {
      throw new ForbiddenException('仅管理或总监可结清总代账期');
    }
    const target = await this.resolveTarget(actor, generalUserId);
    const cycle = normalizeSettleCycle(target.agent!.settleCycle);
    const bounds = shanghaiSettleBounds(cycle, opts?.period === 'current' ? 0 : -1);

    const existing = await this.prisma.generalPeriodSettle.findUnique({
      where: {
        generalUserId_periodStart: { generalUserId: target.id, periodStart: bounds.periodStart },
      },
    });
    if (existing?.status === 'SETTLED') {
      throw new BadRequestException('该账期已结清');
    }

    const lines = await this.buildLines(target, bounds.periodStart, bounds.periodEnd);
    const totals = this.sumLines(lines);
    const isCredit = target.agent!.bookMode === 'CREDIT';
    const quotaAtClose = asMoney(target.agent!.pointsQuota);
    const creditLimit = asMoney(target.agent!.creditLimit);
    /* 平台应得为正=总代要付平台 */
    const settlePay = totals.platformShareAmount;

    const data = {
      periodEnd: bounds.periodEnd,
      bookMode: isCredit ? 'CREDIT' : 'CASH',
      generalShareRate: Number(target.agent!.shareRate ?? 0),
      betFlow: new Prisma.Decimal(totals.betFlow.toFixed(2)),
      payout: new Prisma.Decimal(totals.payout.toFixed(2)),
      housePnl: new Prisma.Decimal(totals.housePnl.toFixed(2)),
      agentShareAmount: new Prisma.Decimal(totals.agentShareAmount.toFixed(2)),
      generalShareAmount: new Prisma.Decimal(totals.generalShareAmount.toFixed(2)),
      platformShareAmount: new Prisma.Decimal(totals.platformShareAmount.toFixed(2)),
      settlePay: new Prisma.Decimal(settlePay.toFixed(2)),
      quotaAtClose: new Prisma.Decimal(quotaAtClose.toFixed(2)),
      creditLimit: new Prisma.Decimal(creditLimit.toFixed(2)),
      roomsSnapshot: JSON.stringify(lines),
      roomCount: lines.length,
      status: 'SETTLED',
      closedAt: existing?.closedAt ?? new Date(),
      settledAt: new Date(),
      settledById: actor.id,
      note: opts?.note?.trim() || null,
    };

    const row = await this.prisma.generalPeriodSettle.upsert({
      where: {
        generalUserId_periodStart: { generalUserId: target.id, periodStart: bounds.periodStart },
      },
      create: {
        generalUserId: target.id,
        periodStart: bounds.periodStart,
        ...data,
      },
      update: data,
    });

    await this.adminLog.log(actor.id, 'GENERAL_PERIOD_SETTLE', target.id, {
      periodStart: bounds.periodStart,
      periodEnd: bounds.periodEnd,
      ...totals,
      settlePay,
      bookMode: data.bookMode,
    });

    return {
      ok: true,
      id: row.id,
      periodStart: bounds.periodStart.toISOString(),
      periodEnd: bounds.periodEnd.toISOString(),
      ...totals,
      settlePay,
      message:
        settlePay > 0
          ? `本期总代应付平台 ${settlePay}`
          : settlePay < 0
            ? `本期平台应付总代 ${roundMoney(-settlePay)}`
            : '本期互不找补',
    };
  }

  /** 历史账期 */
  async history(actor: ConsoleActor, generalUserId?: string, take = 20) {
    const target = await this.resolveTarget(actor, generalUserId);
    const rows = await this.prisma.generalPeriodSettle.findMany({
      where: { generalUserId: target.id },
      orderBy: { periodStart: 'desc' },
      take: Math.min(60, Math.max(1, take)),
    });
    return {
      list: rows.map((r) => ({
        id: r.id,
        periodStart: r.periodStart.toISOString(),
        periodEnd: r.periodEnd.toISOString(),
        bookMode: r.bookMode,
        roomCount: r.roomCount,
        betFlow: asMoney(r.betFlow),
        housePnl: asMoney(r.housePnl),
        agentShareAmount: asMoney(r.agentShareAmount),
        generalShareAmount: asMoney(r.generalShareAmount),
        platformShareAmount: asMoney(r.platformShareAmount),
        settlePay: asMoney(r.settlePay),
        status: r.status,
        settledAt: r.settledAt?.toISOString() ?? null,
        note: r.note,
      })),
    };
  }
}
