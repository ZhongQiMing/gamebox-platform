/**
 * 总代与平台的账期结算。
 *
 * 和房间那套是两个粒度，故意分开：
 * - 房间 ↔ 代理：按各房自谈的周期交割，走 RoomWeekSettle
 * - 平台 ↔ 总代：按总代自己的周期，把名下所有房间汇总成一张表，一次清账
 *
 * 占成只算飞盘（平台坐庄）；关盘是代理/总代自负，不进这张表。
 * 平台↔总代：现金房按占成付给下家；信用房上缴平台占成再减已发代理佣金。
 * 现金总代、信用总代总表都只汇总各房+月费，不冲 CreditIssueDebt。
 * 平台给信用总代的上分挂往来，人不干了再扣；不要把总代自己的合同加回满额。
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
import { csvRow } from '../../common/utils/csv';
import {
  normalizeSettleCycle,
  settleCycleLabel,
  shanghaiSettleBounds,
} from './room-settle.service';
import {
  cashFlownPayToAgent,
  cashFlownPayToPlatform,
  splitHouseShare,
} from './share-split.helper';
import { creditFlownSettlePay, creditRoomPayToPlatform } from './credit-settle.helper';
import { buildRoomFeeBill, type RoomFeeBill } from './general-room-fee.helper';
import { keepClosedRoomInPeriodList, OPEN_ROOM_WHERE } from './open-room.where';
import {
  platformGeneralDebtFilter,
  sumUnsettledCreditDebt,
} from './credit-issue-debt.helper';

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
  /** 平台从这一房分到的成数（记账，不是交割方向） */
  platformShareAmount: number;
  /**
   * 对方应付平台（正=对方付平台，负=平台付对方）。
   * 现金飞盘 = −(代理占成+成数差)；信用盘暂等于平台应得。
   */
  payToPlatform: number;
  /**
   * 这一房代理的收益（正=总代要付给他，负=要从他那收）。
   * 只含占成，不含整包与月费——整包已进盘分，月费在房间账单里轧。
   */
  agentPnl: number;
  /** 与代理的账结到哪了 */
  agentSettleStatus: 'SETTLED' | 'PENDING';
  agentSettledAt: string | null;
  /** 代理整包净额（已发） */
  agentWageAmount: number;
  /** 平台打给总代自己的那份（已发） */
  generalWageAmount: number;
  /** 总代自己留下的回水 */
  generalWageKeep: number;
  playerRebate: number;
  wageCount: number;
  upAmount: number;
  downAmount: number;
};

type RoomAggRow = {
  id: string;
  roomNo: string;
  name: string;
  status: string;
  bookMode: string;
  agentShareRate: unknown;
  settleCycle: string | null;
  ownerAgent: { user: { nickname: string; username: string } } | null;
};

const SH_MS = 8 * 3600 * 1000;

function shanghaiYmd(v: Date | string) {
  const d = v instanceof Date ? v : new Date(v);
  if (Number.isNaN(d.getTime())) return '—';
  const u = new Date(d.getTime() + SH_MS);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${u.getUTCFullYear()}-${p(u.getUTCMonth() + 1)}-${p(u.getUTCDate())}`;
}

function pctLabel(n: number) {
  const v = Number(n);
  if (!Number.isFinite(v)) return '0%';
  const x = v > 1 ? v : v * 100;
  return `${Math.round(x * 10) / 10}%`;
}

/**
 * 各房代理那一截只给总代当收付清单看，平台不管这条腿结没结。
 * 平台↔总代与总代↔代理的账期各定各的，两边账期不重合时数字本来就对不上，
 * 硬要对平只会让人以为系统算错了。
 */
/** 结清备注里注明这期收了哪几间房的月费，事后翻账能对上 */
function roomFeeNote(bill: RoomFeeBill): string | null {
  if (!bill.lines.length || bill.total <= 0) return null;
  const rooms = bill.lines
    .map((l) => `${l.name}(${l.roomNo})${l.months > 1 ? `×${l.months}月` : ''}`)
    .join('、');
  return `房间月费 ${bill.total}（单价 ${bill.unitFee}）：${rooms}`;
}

function payConclusion(payToPlatform: number) {
  if (payToPlatform > 0) return { label: '应付平台', amount: roundMoney(payToPlatform) };
  if (payToPlatform < 0) return { label: '平台应付', amount: roundMoney(-payToPlatform) };
  return { label: '互不找补', amount: 0 };
}

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
    const generalSide = await this.scope.isGeneralSide(actor);
    const targetId = generalSide
      ? await this.scope.generalRootId(actor)
      : String(generalUserId || '').trim();
    if (!targetId) throw new BadRequestException('请指定总代');
    if (actor.role !== 'ADMIN' && actor.role !== 'BRANCH' && !generalSide) {
      throw new ForbiddenException('无权查看总代账期');
    }
    /*
     * 总监必须先被授权看这个总代。
     * 少了这道校验，总监换个 generalUserId 就能看任意总代的合同（占成、流水费率、
     * 信用额度）和 history 里每一期的流水、庄家盈亏、应付金额——history 直接按
     * generalUserId 查快照表，没有任何房间级过滤兜底。
     */
    if (actor.role === 'BRANCH' && !(await this.scope.generalVisibleToBranch(actor, targetId))) {
      throw new ForbiddenException('该总代不在你的管辖范围');
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
            roomMonthlyFee: true,
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
   * 本期该向总代收的房间月费：名下每间房按平台定的单价收一笔，逐房列出来。
   * 总代向代理收多少是他自己的事（Room.monthlyFee），跟这里无关。
   */
  private async loadRoomFeeBill(
    target: Awaited<ReturnType<GeneralSettleService['resolveTarget']>>,
    periodEnd: Date,
  ): Promise<RoomFeeBill> {
    const rooms = await this.prisma.room.findMany({
      where: {
        generalAgentId: target.agent!.id,
        platformFeeDueAt: { not: null, lte: periodEnd },
        ...OPEN_ROOM_WHERE,
      },
      select: { id: true, roomNo: true, name: true, platformFeeDueAt: true },
      orderBy: { roomNo: 'asc' },
    });
    return buildRoomFeeBill(
      Number(target.agent!.roomMonthlyFee ?? 0),
      rooms.map((r) => ({
        roomId: r.id,
        roomNo: r.roomNo,
        name: r.name,
        platformFeeDueAt: r.platformFeeDueAt,
      })),
      periodEnd,
    );
  }

  /**
   * 账期汇总。period: current=本期进行中 / last=上一期（要结的通常是这个）
   * / early=提前结账预览（上次结清 → 现在），与房间结账的三个页签一一对应
   */
  async statement(
    actor: ConsoleActor,
    opts: {
      generalUserId?: string;
      period?: 'current' | 'last' | 'early';
      periodStart?: string;
    } = {},
  ) {
    const target = await this.resolveTarget(actor, opts.generalUserId);
    const cycle = normalizeSettleCycle(target.agent!.settleCycle);
    const periodKey = opts.period === 'current' || opts.period === 'early' ? opts.period : 'last';

    let bounds = shanghaiSettleBounds(cycle, periodKey === 'last' ? -1 : 0);
    if (opts.periodStart) {
      const ps = new Date(opts.periodStart);
      if (Number.isNaN(ps.getTime())) throw new BadRequestException('periodStart 无效');
      const saved = await this.prisma.generalPeriodSettle.findUnique({
        where: { generalUserId_periodStart: { generalUserId: target.id, periodStart: ps } },
      });
      if (saved) {
        return this.fromSaved(actor, target, saved);
      }
      bounds = { periodStart: ps, periodEnd: bounds.periodEnd };
    }

    const lastSettled = await this.lastSettledPeriod(target.id);

    if (periodKey === 'last') {
      const onCalendar = await this.prisma.generalPeriodSettle.findUnique({
        where: {
          generalUserId_periodStart: { generalUserId: target.id, periodStart: bounds.periodStart },
        },
      });
      if (onCalendar?.status === 'SETTLED') return this.fromSaved(actor, target, onCalendar);
      /*
       * 提前结账封的那张单落在本期里，日历上一期常常一张都没有，
       * 「上一期」看上去永远是空的。没单时就回放最近那张更新的已结单。
       */
      if (lastSettled && lastSettled.periodEnd.getTime() > bounds.periodEnd.getTime()) {
        return this.fromSaved(actor, target, lastSettled);
      }
    } else {
      /* 本期 / 提前结账都从上次结清之后接着算，跟房间结账同一套切法 */
      if (lastSettled && lastSettled.periodEnd.getTime() > bounds.periodStart.getTime()) {
        bounds = { periodStart: lastSettled.periodEnd, periodEnd: bounds.periodEnd };
      }
      /* 提前结账预览按「现在」收口，不把账期剩下没走完的时间也划进来 */
      if (periodKey === 'early') {
        bounds = { periodStart: bounds.periodStart, periodEnd: new Date() };
      }
    }

    const saved = await this.prisma.generalPeriodSettle.findUnique({
      where: {
        generalUserId_periodStart: { generalUserId: target.id, periodStart: bounds.periodStart },
      },
    });

    const [allLines, allRoomFee] = await Promise.all([
      this.buildLines(target, bounds.periodStart, bounds.periodEnd),
      this.loadRoomFeeBill(target, bounds.periodEnd),
    ]);
    const scoped = await this.scopeLinesForActor(actor, allLines);
    /* 总监只被授权部分房间时，月费也只列他看得见的那几间，免得跟明细对不上 */
    const roomFee = this.scopeRoomFee(allRoomFee, scoped.hiddenCount ? scoped.lines : null);
    const lines = await this.attachWages(scoped.lines, bounds.periodStart, bounds.periodEnd);
    const totals = await this.attachCreditGeneralDebt(
      this.sumLines(lines, roomFee.total),
      target,
    );

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
      payslip: this.buildPayslip(
        {
          nickname: target.nickname,
          username: target.username,
          bookMode: target.agent!.bookMode,
          shareRate: Number(target.agent!.shareRate ?? 0),
        },
        { fromText: shanghaiYmd(bounds.periodStart), toText: shanghaiYmd(bounds.periodEnd) },
        totals,
        this.isPlatformBill(actor),
      ),
      rooms: lines,
      roomsNote: '',
      /** 本期房间月费：逐房注明，合计已计入应付平台 */
      roomFee: {
        unitFee: roomFee.unitFee,
        total: roomFee.total,
        roomCount: roomFee.roomCount,
        monthCount: roomFee.monthCount,
        note: '',
        lines: roomFee.lines.map((l) => ({
          roomId: l.roomId,
          roomNo: l.roomNo,
          name: l.name,
          months: l.months,
          unitFee: l.unitFee,
          amount: l.amount,
        })),
      },
      /** 总代先垫给平台的部分：本期平台应得里，还没跟代理结清的那些房 */
      pendingFromAgents: roundMoney(
        scoped.lines
          .filter((l) => l.agentSettleStatus === 'PENDING')
          .reduce((s, l) => s + l.platformShareAmount, 0),
      ),
      canSettle:
        (actor.role === 'ADMIN' || actor.role === 'BRANCH')
        && scoped.hiddenCount === 0
        && saved?.status !== 'SETTLED',
    };
  }

  /** 最近一张已结账期，用来把「本期」切成「上次结清 → 现在」 */
  private lastSettledPeriod(generalUserId: string) {
    return this.prisma.generalPeriodSettle.findFirst({
      where: { generalUserId, status: 'SETTLED' },
      orderBy: { periodEnd: 'desc' },
    });
  }

  /** 已结账期直接回放快照，不再重算——重算会被后续改档和补注单污染 */
  private async fromSaved(
    actor: ConsoleActor,
    target: Awaited<ReturnType<GeneralSettleService['resolveTarget']>>,
    row: Prisma.GeneralPeriodSettleGetPayload<object>,
  ) {
    const cycle = normalizeSettleCycle(target.agent!.settleCycle);
    let rooms: GeneralRoomLine[];
    try {
      rooms = JSON.parse(row.roomsSnapshot) as GeneralRoomLine[];
    } catch {
      /* 快照坏了就按空表走，至少不让整页打不开 */
      rooms = [];
    }
    const scoped = await this.scopeLinesForActor(actor, rooms);
    /* 已结快照在落库前已经 attachWages。老快照没有佣金字段才补算一次。 */
    const snapshotHasWages = scoped.lines.some((l) => 'agentWageAmount' in l);
    const withWage = snapshotHasWages
      ? scoped.lines
      : await this.attachWages(scoped.lines, row.periodStart, row.periodEnd);
    const wageSum = this.sumLines(withWage, 0);
    const unsettledIssueDebt =
      row.bookMode === 'CREDIT'
        ? await sumUnsettledCreditDebt(this.prisma, platformGeneralDebtFilter(target.id))
        : 0;
    const totals = scoped.hiddenCount
      ? {
          ...this.sumLines(withWage, asMoney(row.roomFee)),
          sharePayToPlatform: asMoney(row.settlePay),
          unsettledIssueDebt,
        }
      : {
          roomFee: asMoney(row.roomFee),
          roomCount: row.roomCount,
          betFlow: asMoney(row.betFlow),
          payout: asMoney(row.payout),
          housePnl: asMoney(row.housePnl),
          agentShareAmount: asMoney(row.agentShareAmount),
          generalShareAmount: asMoney(row.generalShareAmount),
          platformShareAmount: asMoney(row.platformShareAmount),
          payToPlatform: asMoney(row.settlePay),
          sharePayToPlatform: asMoney(row.settlePay),
          unsettledIssueDebt,
          agentPnl: roundMoney(
            withWage.reduce((s, l) => s + Number(l.agentPnl ?? 0), 0),
          ),
          wageCount: wageSum.wageCount,
          agentWageAmount: wageSum.agentWageAmount,
          generalWageAmount: wageSum.generalWageAmount,
          generalWageKeep: wageSum.generalWageKeep,
          playerRebate: wageSum.playerRebate,
          platformNet: wageSum.platformNet,
          upAmount: wageSum.upAmount,
          downAmount: wageSum.downAmount,
        };
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
      totals,
      payslip: this.buildPayslip(
        {
          nickname: target.nickname,
          username: target.username,
          bookMode: row.bookMode,
          shareRate: Number(row.generalShareRate ?? 0),
        },
        {
          fromText: shanghaiYmd(row.periodStart),
          toText: shanghaiYmd(row.periodEnd),
        },
        totals,
        this.isPlatformBill(actor),
      ),
      rooms: withWage,
      roomsNote: '',
      /** 已结账期不再重算月费，只回放当时的合计；收了哪几间房在 note 里 */
      roomFee: {
        unitFee: asMoney(target.agent!.roomMonthlyFee ?? 0),
        total: asMoney(row.roomFee),
        roomCount: 0,
        monthCount: 0,
        note: '',
        lines: [] as Array<{
          roomId: string;
          roomNo: string;
          name: string;
          months: number;
          unitFee: number;
          amount: number;
        }>,
      },
      pendingFromAgents: roundMoney(
        scoped.lines
          .filter((l) => l.agentSettleStatus === 'PENDING')
          .reduce((s, l) => s + l.platformShareAmount, 0),
      ),
      canSettle: false,
      note: row.note,
    };
  }

  /**
   * 按可见房间收窄月费明细。
   * `visible` 为 null 表示全都看得见，原样返回。
   */
  private scopeRoomFee(bill: RoomFeeBill, visible: GeneralRoomLine[] | null): RoomFeeBill {
    if (!visible) return bill;
    const ids = new Set(visible.map((l) => l.roomId));
    const lines = bill.lines.filter((l) => ids.has(l.roomId));
    return {
      unitFee: bill.unitFee,
      lines,
      total: roundMoney(lines.reduce((s, l) => s + l.amount, 0)),
      roomCount: lines.length,
      monthCount: lines.reduce((s, l) => s + l.months, 0),
    };
  }

  /** 关掉观看的房间不计入该总监，也不能拿残表去结整期 */
  private async scopeLinesForActor(actor: ConsoleActor, lines: GeneralRoomLine[]) {
    if (actor.role !== 'BRANCH') return { lines, hiddenCount: 0 };
    const granted = await this.scope.grantedRoomIds(actor);
    const set = new Set(granted || []);
    const visible = lines.filter((l) => set.has(l.roomId));
    return { lines: visible, hiddenCount: lines.length - visible.length };
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
    const gShare = Math.min(1, Math.max(0, Number(target.agent!.shareRate ?? 0)));
    const lines = await this.linesForRoomRows(rooms, from, to, gShare);
    return lines.filter(keepClosedRoomInPeriodList);
  }

  private async linesForRoomRows(
    rooms: RoomAggRow[],
    from: Date,
    to: Date,
    gShare: number | null,
  ): Promise<GeneralRoomLine[]> {
    if (!rooms.length) return [];
    const roomIds = rooms.map((r) => r.id);
    const [byHouse, agentSettles] = await Promise.all([
      this.reports.settledRoomAggByHouse(roomIds, from, to),
      this.prisma.roomWeekSettle.findMany({
        where: { roomId: { in: roomIds }, status: 'SETTLED', weekEnd: { gte: from } },
        select: {
          roomId: true,
          weekEnd: true,
          settledAt: true,
        },
        orderBy: { weekEnd: 'desc' },
      }),
    ]);
    const lastAgentSettle = new Map<string, (typeof agentSettles)[number]>();
    for (const s of agentSettles) {
      if (!lastAgentSettle.has(s.roomId)) lastAgentSettle.set(s.roomId, s);
    }

    return rooms.map((r) => {
      const isCredit = r.bookMode === 'CREDIT';
      const house = byHouse.get(r.id);
      const betFlow = asMoney(house?.flown.betFlow ?? 0);
      const payout = asMoney(house?.flown.payout ?? 0);
      const aShare = Math.min(1, Math.max(0, Number(r.agentShareRate ?? 0)));
      const settled = lastAgentSettle.get(r.id);

      /* 总表只认飞上台。房间单是总代↔代理，含飞到总代，两张单不必对平。 */
      const housePnl = roundMoney(house?.flown.housePnl ?? 0);
      const { agentShareAmount, generalShareAmount, platformShareAmount } =
        splitHouseShare(housePnl, aShare, gShare);
      const payToPlatform = cashFlownPayToPlatform(agentShareAmount, generalShareAmount);
      const agentPnl = cashFlownPayToAgent(agentShareAmount);
      const cycle = normalizeSettleCycle(r.settleCycle);
      /*
       * 账期没走完时不能拿期末去比：本期结账通常发生在期中，
       * 那张单只封到「结账那一刻」，按期末比会把刚结完的房也算成未结。
       * 一分钟的容差是留给结账与本次取数之间的时间差。
       */
      const settledThrough = Math.min(to.getTime(), Date.now());
      const agentSettleStatus =
        settled && settled.weekEnd.getTime() + 60_000 >= settledThrough ? 'SETTLED' : 'PENDING';

      return {
        roomId: r.id,
        roomNo: r.roomNo,
        name: r.name,
        status: r.status,
        bookMode: isCredit ? 'CREDIT' : 'CASH',
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
        payToPlatform,
        agentPnl,
        agentSettleStatus,
        agentSettledAt: settled?.settledAt?.toISOString() ?? null,
        agentWageAmount: 0,
        generalWageAmount: 0,
        generalWageKeep: 0,
        playerRebate: 0,
        wageCount: 0,
        upAmount: 0,
        downAmount: 0,
      } satisfies GeneralRoomLine;
    });
  }

  /** @param roomFeeTotal 本期房间月费，总代应付平台，直接抬高 payToPlatform */
  private sumLines(lines: GeneralRoomLine[], roomFeeTotal = 0) {
    const add = (pick: (l: GeneralRoomLine) => number) =>
      roundMoney(lines.reduce((s, l) => s + pick(l), 0));
    const roomFee = roundMoney(roomFeeTotal);
    const housePnl = add((l) => l.housePnl);
    const agentShareAmount = add((l) => l.agentShareAmount);
    const generalShareAmount = add((l) => l.generalShareAmount);
    const generalWageAmount = add((l) => l.generalWageAmount ?? 0);
    const playerRebate = add((l) => l.playerRebate ?? 0);
    const agentWageAmount = add((l) => l.agentWageAmount ?? 0);
    const generalWageKeep = add((l) => l.generalWageKeep ?? 0);
    /* 旧账总代先收再下发、新账平台分头打，平台付出都是「总代自己的 + 代理自己的」 */
    const platformWageOut = roundMoney(agentWageAmount + generalWageKeep);
    return {
      roomFee,
      roomCount: lines.length,
      betFlow: add((l) => l.betFlow),
      payout: add((l) => l.payout),
      housePnl,
      agentShareAmount,
      generalShareAmount,
      platformShareAmount: add((l) => l.platformShareAmount),
      /* 盈亏 − 两级占成 − 平台出的回水（总代+代理+玩家） */
      platformNet: roundMoney(
        housePnl - agentShareAmount - generalShareAmount - platformWageOut - playerRebate,
      ),
      /* 月费是总代欠平台的，跟占成同向合并成一个交割数 */
      payToPlatform: roundMoney(
        add((l) => l.payToPlatform ?? l.platformShareAmount) + roomFee,
      ),
      agentPnl: add((l) => l.agentPnl ?? 0),
      wageCount: add((l) => l.wageCount ?? 0),
      agentWageAmount,
      generalWageAmount,
      generalWageKeep,
      playerRebate,
      upAmount: add((l) => l.upAmount ?? 0),
      downAmount: add((l) => l.downAmount ?? 0),
    };
  }

  /** 信用总代只挂出未结上分作往来，不冲进本期实付。现金总代原样返回。 */
  private async attachCreditGeneralDebt(
    totals: ReturnType<GeneralSettleService['sumLines']>,
    target: { id: string; agent: { bookMode: string | null } | null },
  ) {
    const sharePayToPlatform = totals.payToPlatform;
    if (target.agent?.bookMode !== 'CREDIT') {
      return { ...totals, sharePayToPlatform, unsettledIssueDebt: 0, consumeIssueDebt: 0 };
    }
    const debt = await sumUnsettledCreditDebt(
      this.prisma,
      platformGeneralDebtFilter(target.id),
    );
    return {
      ...totals,
      sharePayToPlatform,
      unsettledIssueDebt: debt,
      consumeIssueDebt: 0,
    };
  }

  private emptyWage() {
    return {
      wageCount: 0,
      agentWageAmount: 0,
      generalWageAmount: 0,
      generalWageKeep: 0,
      playerRebate: 0,
      upAmount: 0,
      downAmount: 0,
    };
  }

  /** 按房归集整包佣金：总代整包、代理整包、总代差价、玩家回水 */
  private async attachWages(lines: GeneralRoomLine[], from: Date, to: Date) {
    const ids = lines.map((l) => l.roomId);
    const [wages, funds] = await Promise.all([
      this.wageByRoom(ids, from, to),
      this.fundByRoom(ids, from, to),
    ]);
    return lines.map((l) => {
      const merged = {
        ...l,
        ...this.emptyWage(),
        ...wages.get(l.roomId),
        ...funds.get(l.roomId),
      };
      if (merged.bookMode === 'CREDIT') {
        merged.payToPlatform = creditRoomPayToPlatform(
          merged.platformShareAmount,
          merged.agentWageAmount,
        );
        merged.agentPnl = creditFlownSettlePay(
          merged.housePnl,
          merged.agentShareAmount,
          merged.agentWageAmount,
        );
      }
      return merged;
    });
  }

  private async fundByRoom(roomIds: string[], from: Date, to: Date) {
    return this.reports.playerFundByRoom(roomIds, from, to);
  }

  private async wageByRoom(roomIds: string[], from: Date, to: Date) {
    type Wage = ReturnType<GeneralSettleService['emptyWage']> & { generalToAgent: number };
    const out = new Map<string, Wage>();
    if (!roomIds.length) return out;
    const roomList = Prisma.join(roomIds);
    type LegRow = { room_id: string; leg: string; amt: unknown; cnt: number };
    type AccRow = { room_id: string; accrued: unknown };
    const [legs, accs] = await Promise.all([
      this.prisma.$queryRaw<LegRow[]>`
        SELECT
          NULLIF(b.payload->'fly'->>'roomId', '') AS room_id,
          CASE
            WHEN l."idempotencyKey" LIKE 'flow_rebate_general_in_%' THEN 'PLATFORM_TO_GENERAL'
            WHEN l."idempotencyKey" LIKE 'flow_rebate_agent_in_%' THEN 'PLATFORM_TO_AGENT'
            WHEN l."idempotencyKey" LIKE 'flow_rebate_down_in_%' THEN 'GENERAL_TO_AGENT'
            ELSE 'OTHER'
          END AS leg,
          COALESCE(SUM(l.amount), 0) AS amt,
          COUNT(*)::int AS cnt
        FROM "PointsLedger" l
        JOIN "Bet" b ON b."id" = l."refId"
        WHERE l."refType" = 'bet'
          AND l."bizType" = 'REBATE'
          AND l.amount > 0
          AND l."idempotencyKey" LIKE 'flow_rebate_%'
          AND b."settledAt" >= ${from}
          AND b."settledAt" < ${to}
          AND b.payload->'fly'->>'flying' = 'true'
          AND NULLIF(b.payload->'fly'->>'roomId', '') IN (${roomList})
        GROUP BY 1, 2
      `,
      this.prisma.$queryRaw<AccRow[]>`
        SELECT
          NULLIF(b.payload->'fly'->>'roomId', '') AS room_id,
          COALESCE(SUM(
            b."validFlow" * COALESCE(NULLIF(b.payload->'fly'->>'P', '')::numeric, 0)
          ), 0) AS accrued
        FROM "Bet" b
        WHERE b."settledAt" >= ${from}
          AND b."settledAt" < ${to}
          AND b.status IN ('WON', 'LOST')
          AND b."validFlow" > 0
          AND b.payload->'fly'->>'flying' = 'true'
          AND NULLIF(b.payload->'fly'->>'roomId', '') IN (${roomList})
        GROUP BY 1
      `,
    ]);
    const bucket = (id: string) => {
      let row = out.get(id);
      if (!row) {
        row = { ...this.emptyWage(), generalToAgent: 0 };
        out.set(id, row);
      }
      return row;
    };
    for (const r of legs) {
      if (!r.room_id) continue;
      const row = bucket(r.room_id);
      const amt = asMoney(r.amt);
      const cnt = Number(r.cnt || 0);
      if (r.leg === 'PLATFORM_TO_GENERAL') {
        row.generalWageAmount = amt;
        row.wageCount += cnt;
      } else if (r.leg === 'PLATFORM_TO_AGENT') {
        row.agentWageAmount = roundMoney(row.agentWageAmount + amt);
        row.wageCount += cnt;
      } else if (r.leg === 'GENERAL_TO_AGENT') {
        row.agentWageAmount = roundMoney(row.agentWageAmount + amt);
        row.generalToAgent = amt;
        row.wageCount += cnt;
      }
    }
    for (const a of accs) {
      if (!a.room_id) continue;
      bucket(a.room_id).playerRebate = asMoney(a.accrued);
    }
    for (const row of out.values()) {
      row.generalWageKeep = roundMoney(row.generalWageAmount - row.generalToAgent);
    }
    return out;
  }

  /** 管理/总监跟总代结，只列平台↔总代；总代自己看才拆佣金和代理占成 */
  private isPlatformBill(actor: ConsoleActor) {
    return actor.role === 'ADMIN' || actor.role === 'BRANCH';
  }

  /**
   * 总代那一条汇总工资条：项目名一行、金额一行，跟房间账单同一套排版。
   *
   * 结论写交割方向：应付平台 / 平台应付 / 互不找补。
   */
  private buildPayslip(
    general: { nickname: string; username: string; bookMode: string; shareRate: number },
    period: { fromText: string; toText: string },
    totals: ReturnType<GeneralSettleService['sumLines']> & {
      sharePayToPlatform?: number;
      unsettledIssueDebt?: number;
    },
    platformBill = true,
  ) {
    const money = (key: string, label: string, amount: number, emphasis = false) => ({
      key,
      label,
      kind: 'money' as const,
      amount: roundMoney(amount),
      emphasis,
    });
    const text = (key: string, label: string, value: string) => ({
      key,
      label,
      kind: 'text' as const,
      text: value,
      emphasis: false,
    });
    const count = (key: string, label: string, amount: number) => ({
      key,
      label,
      kind: 'count' as const,
      amount,
      emphasis: false,
    });
    return [
      text('general', '总代', `${general.nickname}/${general.username}`),
      text('book', '盘口', general.bookMode === 'CREDIT' ? 'B 信用盘' : 'A 现金盘'),
      text('period', '账单时间', `${period.fromText} ～ ${period.toText}`),
      count('roomCount', '房间数', totals.roomCount),
      money('betFlow', '结账投注额', totals.betFlow),
      money('payout', '派彩', totals.payout),
      money('housePnl', '庄家盈亏', totals.housePnl),
      money('upAmount', '上分', totals.upAmount ?? 0),
      money('downAmount', '下分', totals.downAmount ?? 0),
      money('roomFee', '房间月费', totals.roomFee),
      money(
        'wageAmount',
        '整包佣金',
        roundMoney(
          (totals.agentWageAmount ?? 0) +
            (totals.generalWageKeep ?? 0) +
            (totals.playerRebate ?? 0),
        ),
      ),
      ...(platformBill
        ? [
            money(
              'generalShareAmount',
              `总代占成 ${pctLabel(general.shareRate)}`,
              roundMoney(totals.generalShareAmount + totals.agentShareAmount),
            ),
            money(
              'platformShareAmount',
              `平台占成 ${pctLabel(1 - (Number(general.shareRate) > 1 ? Number(general.shareRate) / 100 : Number(general.shareRate)))}`,
              totals.platformShareAmount,
            ),
          ]
        : [
            money('generalWageKeep', '总代佣金', totals.generalWageKeep ?? 0),
            money('agentWageAmount', '代理佣金', totals.agentWageAmount ?? 0),
            money('generalShareAmount', '总代占成', totals.generalShareAmount),
            money('agentShareAmount', '代理占成', totals.agentShareAmount),
          ]),
      ...(general.bookMode === 'CREDIT'
        ? [money('issueDebt', '往来：未结上分', totals.unsettledIssueDebt ?? 0)]
        : []),
      money('generalNet', payConclusion(totals.payToPlatform).label, -totals.payToPlatform, true),
    ];
  }

  /**
   * 结清一个账期：把汇总与每房明细定格成快照。
   * 信用盘另把封账时的剩余信用记下来，对接补额度时按「当前额度 + 本期已结」补，
   * 封账之后产生的输赢就自动留到下一期，不会被抹掉。
   */
  async settle(
    actor: ConsoleActor,
    generalUserId: string,
    opts?: { period?: 'current' | 'last' | 'early'; note?: string },
  ) {
    if (actor.role !== 'ADMIN' && actor.role !== 'BRANCH') {
      throw new ForbiddenException('仅管理或总监可结清总代账期');
    }
    const target = await this.resolveTarget(actor, generalUserId);
    const cycle = normalizeSettleCycle(target.agent!.settleCycle);
    /* 提前结账封的就是本期未结的那一段，跟「本期」同一条路径 */
    const onCurrent = opts?.period === 'current' || opts?.period === 'early';
    const calendar = shanghaiSettleBounds(cycle, onCurrent ? 0 : -1);
    /*
     * 起点从上次结清那一刻接着往下走，跟房间结账同一套：
     * 主键随之后移，所以同一个日历账期里可以多次提前结账，
     * 每张单各自封一段，段与段首尾相接、不重叠。
     */
    const lastSettled = await this.lastSettledPeriod(target.id);
    const bounds = {
      periodStart:
        onCurrent
        && lastSettled
        && lastSettled.periodEnd.getTime() > calendar.periodStart.getTime()
          ? lastSettled.periodEnd
          : calendar.periodStart,
    };
    /*
     * 账期还没走完就结（提前结账）时，终点按「此刻」记，不写成周末。
     * 写成周末等于把还没发生的时间也划进这张单，页面上就会出现
     * 「上一期」和「本期」都显示同一个起止、看着完全重叠。
     */
    const periodEnd = new Date(Math.min(calendar.periodEnd.getTime(), Date.now()));
    if (periodEnd.getTime() - bounds.periodStart.getTime() < 60_000) {
      throw new BadRequestException('距上次结清不足 1 分钟，请稍后再试');
    }

    const existing = await this.prisma.generalPeriodSettle.findUnique({
      where: {
        generalUserId_periodStart: { generalUserId: target.id, periodStart: bounds.periodStart },
      },
    });
    if (existing?.status === 'SETTLED') {
      throw new BadRequestException('该账期已结清');
    }

    const built = await this.buildLines(target, bounds.periodStart, periodEnd);
    if (actor.role === 'BRANCH') {
      const scoped = await this.scopeLinesForActor(actor, built);
      if (scoped.hiddenCount > 0) {
        throw new ForbiddenException('有房间未授权给你看，不能代结该总代表，请由管理员结清');
      }
    }
    const roomFee = await this.loadRoomFeeBill(target, periodEnd);
    const lines = await this.attachWages(built, bounds.periodStart, periodEnd);
    const totals = await this.attachCreditGeneralDebt(
      this.sumLines(lines, roomFee.total),
      target,
    );
    const isCredit = target.agent!.bookMode === 'CREDIT';
    const quotaAtClose = asMoney(target.agent!.pointsQuota);
    const creditLimit = asMoney(target.agent!.creditLimit);
    /* 已含本期房间月费；信用总代也不冲平台上分 */
    const settlePay = totals.payToPlatform;

    const data = {
      periodEnd,
      bookMode: isCredit ? 'CREDIT' : 'CASH',
      generalShareRate: Number(target.agent!.shareRate ?? 0),
      betFlow: new Prisma.Decimal(totals.betFlow.toFixed(2)),
      payout: new Prisma.Decimal(totals.payout.toFixed(2)),
      housePnl: new Prisma.Decimal(totals.housePnl.toFixed(2)),
      agentShareAmount: new Prisma.Decimal(totals.agentShareAmount.toFixed(2)),
      generalShareAmount: new Prisma.Decimal(totals.generalShareAmount.toFixed(2)),
      platformShareAmount: new Prisma.Decimal(totals.platformShareAmount.toFixed(2)),
      roomFee: new Prisma.Decimal(roomFee.total.toFixed(2)),
      settlePay: new Prisma.Decimal(settlePay.toFixed(2)),
      quotaAtClose: new Prisma.Decimal(quotaAtClose.toFixed(2)),
      creditLimit: new Prisma.Decimal(creditLimit.toFixed(2)),
      roomsSnapshot: JSON.stringify(lines),
      roomCount: lines.length,
      status: 'SETTLED',
      closedAt: existing?.closedAt ?? new Date(),
      settledAt: new Date(),
      settledById: actor.id,
      note: [opts?.note?.trim() || null, roomFeeNote(roomFee)].filter(Boolean).join(' · ') || null,
    };

    /*
     * 落库与推进到期时间同一个事务：推进失败就整笔回滚，
     * 否则要么这期白收、要么下期重复收。
     */
    const row = await this.prisma.$transaction(async (tx) => {
      const saved = await tx.generalPeriodSettle.upsert({
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
      for (const line of roomFee.lines) {
        /* CAS：只有到期时间还停在本次算账用的那个值时才推进，防并发重复收 */
        await tx.room.updateMany({
          where: { id: line.roomId, platformFeeDueAt: { lte: periodEnd } },
          data: { platformFeeDueAt: line.nextDueAt },
        });
      }
      return saved;
    });

    await this.adminLog.log(actor.id, 'GENERAL_PERIOD_SETTLE', target.id, {
      periodStart: bounds.periodStart,
      periodEnd,
      ...totals,
      settlePay,
      bookMode: data.bookMode,
      roomFee: {
        unitFee: roomFee.unitFee,
        total: roomFee.total,
        rooms: roomFee.lines.map((l) => ({
          roomNo: l.roomNo,
          months: l.months,
          amount: l.amount,
        })),
      },
    });

    return {
      ok: true,
      id: row.id,
      periodStart: bounds.periodStart.toISOString(),
      periodEnd: periodEnd.toISOString(),
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
        roomFee: asMoney(r.roomFee),
        settlePay: asMoney(r.settlePay),
        status: r.status,
        settledAt: r.settledAt?.toISOString() ?? null,
        note: r.note,
      })),
    };
  }

  /**
   * 未挂总代的房间总表：跟平台直接按房间占成结，周期用礼拜一账期，
   * 方便一次拉齐、导出工资条，不必一间一间点进去。
   */
  async directStatement(
    actor: ConsoleActor,
    opts: { period?: 'current' | 'last' } = {},
  ) {
    if (actor.role !== 'ADMIN' && actor.role !== 'BRANCH') {
      throw new ForbiddenException('仅管理或总监可查看无总代总表');
    }
    const periodKey = opts.period === 'current' ? 'current' : 'last';
    let bounds = shanghaiSettleBounds('WEEKLY_MON', periodKey === 'current' ? 0 : -1);
    const granted = await this.scope.grantedRoomIds(actor);
    if (granted && !granted.length) {
      return this.emptyDirect(periodKey, bounds);
    }
    const rooms = await this.prisma.room.findMany({
      where: {
        generalAgentId: null,
        ...OPEN_ROOM_WHERE,
        ...(granted ? { id: { in: granted } } : {}),
      },
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

    /*
     * 直挂房是提前结账的常客，那些单落在本期里，日历上一期常常一张都没有。
     * 「上一期」没单时改成覆盖这些房最近一批已结单的区间，别显示一张空表。
     */
    if (periodKey === 'last' && rooms.length) {
      const roomIds = rooms.map((r) => r.id);
      const [onCalendar, newer] = await Promise.all([
        this.prisma.roomWeekSettle.count({
          where: { roomId: { in: roomIds }, weekStart: bounds.periodStart },
        }),
        this.prisma.roomWeekSettle.findMany({
          where: {
            roomId: { in: roomIds },
            status: 'SETTLED',
            weekEnd: { gt: bounds.periodEnd },
          },
          select: { weekStart: true, weekEnd: true },
        }),
      ]);
      if (!onCalendar && newer.length) {
        bounds = {
          periodStart: new Date(Math.min(...newer.map((s) => s.weekStart.getTime()))),
          periodEnd: new Date(Math.max(...newer.map((s) => s.weekEnd.getTime()))),
        };
      }
    }

    const built = await this.linesForRoomRows(rooms, bounds.periodStart, bounds.periodEnd, null);
    const lines = await this.attachWages(built, bounds.periodStart, bounds.periodEnd);
    return {
      kind: 'direct' as const,
      period: {
        key: periodKey,
        periodStart: bounds.periodStart.toISOString(),
        periodEnd: bounds.periodEnd.toISOString(),
        settleLabel: settleCycleLabel('WEEKLY_MON'),
      },
      totals: this.sumLines(lines),
      rooms: lines,
      roomsNote: '',
    };
  }

  private emptyDirect(
    periodKey: 'current' | 'last',
    bounds: { periodStart: Date; periodEnd: Date },
  ) {
    return {
      kind: 'direct' as const,
      period: {
        key: periodKey,
        periodStart: bounds.periodStart.toISOString(),
        periodEnd: bounds.periodEnd.toISOString(),
        settleLabel: settleCycleLabel('WEEKLY_MON'),
      },
      totals: this.sumLines([]),
      rooms: [] as GeneralRoomLine[],
      roomsNote: '',
    };
  }

  async exportStatementCsv(
    actor: ConsoleActor,
    opts: {
      generalUserId?: string;
      period?: 'current' | 'last' | 'early';
      periodStart?: string;
    } = {},
  ) {
    const stmt = await this.statement(actor, opts);
    const who = stmt.general.nickname || stmt.general.username || '总代';
    const from = shanghaiYmd(stmt.period.periodStart);
    const to = shanghaiYmd(stmt.period.periodEnd);
    const t = stmt.totals;
    const feeByRoom = new Map(
      (stmt.roomFee?.lines ?? []).map((l) => [l.roomId, l.amount] as const),
    );
    const book = stmt.general.bookMode === 'CREDIT' ? 'B 信用盘' : 'A 现金盘';
    const when = `${from} ~ ${to}`;
    const platformBill = this.isPlatformBill(actor);
    const gRate = Number(stmt.general.shareRate);
    const gPct = pctLabel(gRate);
    const pPct = pctLabel(1 - (gRate > 1 ? gRate / 100 : gRate));
    const slipHead = [
      '总代',
      '账号',
      '盘口',
      '账单时间',
      '结账投注额',
      '派彩',
      '庄家盈亏',
      '上分',
      '下分',
      '房间月费',
      '整包佣金',
      ...(platformBill
        ? [`总代占成 ${gPct}`, `平台占成 ${pPct}`]
        : ['总代佣金', '代理佣金', '总代占成', '代理占成']),
      ...(stmt.general.bookMode === 'CREDIT' ? ['往来：未结上分'] : []),
      '本期交割',
    ];
    const slipValues: Array<string | number> = [
      who,
      stmt.general.username,
      book,
      when,
      t.betFlow,
      t.payout,
      t.housePnl,
      t.upAmount ?? 0,
      t.downAmount ?? 0,
      t.roomFee,
      roundMoney(
        (t.agentWageAmount ?? 0) + (t.generalWageKeep ?? 0) + (t.playerRebate ?? 0),
      ),
      ...(platformBill
        ? [
            roundMoney((t.generalShareAmount ?? 0) + (t.agentShareAmount ?? 0)),
            t.platformShareAmount,
          ]
        : [
            t.generalWageKeep ?? 0,
            t.agentWageAmount ?? 0,
            t.generalShareAmount,
            t.agentShareAmount,
          ]),
      ...(stmt.general.bookMode === 'CREDIT' ? [t.unsettledIssueDebt ?? 0] : []),
      -t.payToPlatform,
    ];

    const roomHead = [
      '房间名',
      '房间号',
      '总代',
      '账号',
      '盘口',
      '账单时间',
      '总代输赢',
      '交割说明',
      '结账投注额',
      '派彩',
      '庄家盈亏',
      '上分',
      '下分',
      '佣金笔数',
      '总代整包净额 · 已发',
      '总代佣金 · 已发',
      '玩家回水 · 已发',
      '总代占成',
      '下家占成 · 计入交割',
      '与平台交割',
      '房间月费',
    ];
    const roomRows = stmt.rooms.map((r) => {
      const fee = feeByRoom.get(r.roomId) ?? 0;
      const pay = payConclusion(roundMoney((r.payToPlatform ?? 0) + fee));
      const win = (r.payToPlatform ?? 0) + fee > 0 ? -pay.amount : pay.amount;
      return [
        r.name,
        r.roomNo,
        who,
        stmt.general.username,
        r.bookMode === 'CREDIT' ? 'B 信用盘' : 'A 现金盘',
        when,
        win,
        pay.label,
        r.betFlow,
        r.payout,
        r.housePnl,
        r.upAmount ?? 0,
        r.downAmount ?? 0,
        r.wageCount ?? 0,
        r.generalWageAmount ?? 0,
        r.generalWageKeep ?? 0,
        r.playerRebate ?? 0,
        r.generalShareAmount,
        r.agentShareAmount,
        r.payToPlatform ?? 0,
        fee,
      ] as Array<string | number>;
    });

    return {
      filename: `总代工资条-${who}-${from}.csv`,
      csv: `\uFEFF${[
        csvRow(slipHead),
        csvRow(slipValues),
        '',
        csvRow(['房间明细']),
        csvRow(roomHead),
        ...roomRows.map((row) => csvRow(row)),
      ].join('\r\n')}`,
    };
  }


  async exportDirectCsv(actor: ConsoleActor, opts: { period?: 'current' | 'last' } = {}) {
    const stmt = await this.directStatement(actor, opts);
    const csv = this.buildPayslipCsv({
      title: '无总代房间结算工资条',
      headerRows: [
        ['对象', '直挂平台（未挂总代）', '房间数', String(stmt.totals.roomCount), '结账周期', stmt.period.settleLabel],
      ],
      periodStart: stmt.period.periodStart,
      periodEnd: stmt.period.periodEnd,
      totals: stmt.totals,
      rooms: stmt.rooms,
      hideGeneralShare: true,
      roomsNote: stmt.roomsNote,
    });
    const day = shanghaiYmd(stmt.period.periodStart);
    return {
      filename: `无总代工资条-${day}.csv`,
      csv,
    };
  }

  private buildPayslipCsv(p: {
    title: string;
    headerRows: Array<Array<string | number>>;
    periodStart: string;
    periodEnd: string;
    totals: ReturnType<GeneralSettleService['sumLines']>;
    rooms: GeneralRoomLine[];
    hideGeneralShare: boolean;
    pendingFromAgents?: number;
    /** 分房明细的用途说明：账期不一致时合计对不上是正常的 */
    roomsNote?: string;
    /** 本期房间月费逐房明细 */
    roomFee?: {
      unitFee: number;
      total: number;
      roomCount: number;
      monthCount: number;
      note: string;
      lines: Array<{
        roomNo: string;
        name: string;
        months: number;
        unitFee: number;
        amount: number;
      }>;
    };
  }) {
    const pay = payConclusion(p.totals.payToPlatform);
    const from = shanghaiYmd(p.periodStart);
    const to = shanghaiYmd(p.periodEnd);

    /* 汇总段用工资条排版：上行项目名、下行金额，跟后台页面看到的一致 */
    const slipNames: Array<string | number> = ['项目'];
    const slipValues: Array<string | number> = ['金额'];
    const put = (name: string, value: string | number) => {
      slipNames.push(name);
      slipValues.push(value);
    };
    put('账期', `${from} ～ ${to}`);
    put('房间数', p.totals.roomCount);
    put('结账投注额', p.totals.betFlow);
    put('派彩', p.totals.payout);
    put('庄家盈亏', p.totals.housePnl);
    if (!p.hideGeneralShare) put('总代占成', p.totals.generalShareAmount);
    put('代理占成', p.totals.agentShareAmount);
    put('平台占成', p.totals.platformShareAmount);
    if (!p.hideGeneralShare) put('房间月费', p.totals.roomFee);
    if (p.pendingFromAgents) put('其中未结代理垫付', p.pendingFromAgents);
    put(pay.label, pay.amount);

    const lines: string[] = [
      csvRow([p.title]),
      ...p.headerRows.map((row) => csvRow(row)),
      '',
      csvRow(['【本期汇总】']),
      csvRow(slipNames),
      csvRow(slipValues),
      '',
    ];
    if (p.roomFee?.lines.length) {
      lines.push(
        csvRow(['【房间月费】']),
        csvRow(['房间', '房号', '月数', '单价', '金额']),
        ...p.roomFee.lines.map((f) =>
          csvRow([f.name, f.roomNo, f.months, f.unitFee, f.amount]),
        ),
        csvRow(['合计', `${p.roomFee.roomCount} 间`, p.roomFee.monthCount, '', p.roomFee.total]),
        '',
      );
    }
    lines.push(csvRow(['【分房明细】']));
    const head = [
      '房间',
      '房号',
      '代理',
      '账号',
      '盘口',
      '本房结账周期',
      '代理占成',
      '结账投注额',
      '派彩',
      '庄家盈亏',
      '代理占成额',
    ];
    if (!p.hideGeneralShare) head.push('总代占成');
    head.push('平台占成', '与代理');
    lines.push(csvRow(head));
    for (const r of p.rooms) {
      const row: Array<string | number> = [
        r.name,
        r.roomNo,
        r.agentNickname || '—',
        r.agentUsername || '—',
        r.bookMode === 'CREDIT' ? 'B 信用' : 'A 现金',
        r.settleLabel,
        pctLabel(r.agentShareRate),
        r.betFlow,
        r.payout,
        r.housePnl,
        r.agentShareAmount,
      ];
      if (!p.hideGeneralShare) row.push(r.generalShareAmount);
      row.push(
        r.platformShareAmount,
        r.agentSettleStatus === 'SETTLED' ? '已结' : '未结',
      );
      lines.push(csvRow(row));
    }
    const totalRow: Array<string | number> = [
      '合计',
      `${p.totals.roomCount} 间`,
      '',
      '',
      '',
      '',
      '',
      p.totals.betFlow,
      p.totals.payout,
      p.totals.housePnl,
      p.totals.agentShareAmount,
    ];
    if (!p.hideGeneralShare) totalRow.push(p.totals.generalShareAmount);
    totalRow.push(p.totals.platformShareAmount, '');
    lines.push(csvRow(totalRow));
    lines.push('');
    lines.push(csvRow(['【结论】', pay.label, pay.amount, `账期 ${from} ～ ${to}`]));
    return `\uFEFF${lines.join('\r\n')}`;
  }
}
