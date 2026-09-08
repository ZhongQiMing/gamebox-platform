import {
  BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException,
} from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { Prisma } from '@prisma/client';
import { asMoney, roundMoney } from '@gamebox/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { AdminLogService } from '../admin/admin-log.service';
import { PLATFORM_OWNER_ID, PointsService } from '../points/points.service';
import { csvRow } from '../../common/utils/csv';
import { ConsoleScopeService, type ConsoleActor } from './console-scope.service';
import { ConsoleReportsService } from './console-reports.service';
import { RedisService } from '../../redis/redis.service';
import { RiskService } from '../risk/risk.service';
import {
  computeCreditBook,
  creditQuotaRestoreDelta,
  creditRoomPayToPlatform,
  netCreditSettlePay,
  sumAgentCsBalances,
  sumRoomPlayerBalances,
  type CreditBookSnapshot,
} from './credit-settle.helper';
import { adjustCashDiskInTx, lockAgentRowInTx } from './player-fund.helper';
import {
  cashFlownPayToAgent,
  cashFlownPayToPlatform,
  creditAgentFlyPayToAgent,
  splitAgentFlyingHouse,
  splitHouseShare,
} from './share-split.helper';
import {
  roomCreditDebtFilter,
  sumUnsettledCreditDebt,
} from './credit-issue-debt.helper';
import { dueMonthsUntil } from './general-room-fee.helper';

const SH_MS = 8 * 3600 * 1000;
const DAY_MS = 86400000;
/**
 * 结账后多少天没线下交割算超期。
 * 现金盘一周一结，给三天缓冲；再拖就该有人被提醒了。
 */
const SETTLE_OVERDUE_DAYS = Math.max(
  1,
  Math.floor(Number(process.env.SETTLE_OVERDUE_DAYS ?? 3)),
);
/**
 * 封账快照的等待窗口：账期刚结束时若快照还没生成（cron 每小时 :07 跑），
 * 让人等一等，别拿实时余额去算额度加回。
 * 超过这个窗口还没有快照，说明这一期早于该机制或被 cron 跳过，只能按实时值兜底。
 */
const CLOSE_SNAPSHOT_GRACE_MS = 25 * 3600 * 1000;

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
 * 「上期」要不要改指最近一张已结单（提前结账封在本期里的那一段）。
 *
 * 日历上一期若已经结清、或关账单上有流水/盈亏/交割额，必须留着——那是真正待结/已结的上一期。
 * 周一 cron 会给空周写一张全 0 的 CLOSED，那种空单不能挡住回放，否则刚提前结完账，
 * 「上期」会跳到上周那张 0，刚封的数字只剩结清历史里能看见。
 */
export function shouldReplayLatestSettledAsLast(opts: {
  calendarStatus?: string | null;
  calendarBetFlow?: number;
  calendarHousePnl?: number;
  calendarSettlePay?: number;
}): boolean {
  if (opts.calendarStatus === 'SETTLED') return false;
  const n = (v?: number) => Number(v || 0);
  if (n(opts.calendarBetFlow) !== 0 || n(opts.calendarHousePnl) !== 0 || n(opts.calendarSettlePay) !== 0) {
    return false;
  }
  return true;
}

/** 空的日历上周 vs 最近已结单：后者 weekStart 不同就改指过去，不再跟 JS 日历午夜比时间戳 */
export function pickReplaySettledSheet<T extends { weekStart: Date; weekEnd: Date }>(opts: {
  calendarStatus?: string | null;
  calendarBetFlow?: number;
  calendarHousePnl?: number;
  calendarSettlePay?: number;
  calendarWeekStart?: Date | null;
  latestSettled: T | null;
}): T | null {
  if (!opts.latestSettled) return null;
  if (!shouldReplayLatestSettledAsLast(opts)) return null;
  if (
    opts.calendarWeekStart
    && opts.latestSettled.weekStart.getTime() === opts.calendarWeekStart.getTime()
  ) {
    return null;
  }
  return opts.latestSettled;
}

/**
 * 房间月费进哪一期结账。现金盘与信用盘同一套口径：
 *
 * 到期时间（Room.nextBillAt）的锚点是建房那一刻，建完立刻到期，
 * 所以第一次结账就先收一笔；之后每满一个自然月才再收一笔。
 * 1 月 1 日建的房，1 月最后一天结账时 2 月 1 日还没到，这期不收。
 *
 * asOf 一般用账期结束日；提前结账用当前时间。
 */
export function roomMonthlyFeeDue(
  monthlyFee: number,
  nextBillAt: Date | null | undefined,
  asOf: Date,
): { months: number; amount: number; nextDueAt: Date | null } {
  const fee = roundMoney(Math.max(0, Number(monthlyFee) || 0));
  if (fee <= 0) return { months: 0, amount: 0, nextDueAt: null };
  const { months, nextDueAt } = dueMonthsUntil(nextBillAt, asOf);
  return { months, amount: roundMoney(fee * months), nextDueAt };
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

/**
 * 给定账期起点，按该房周期算出对应的账期终点。
 *
 * 补结历史账期时不能一律 +7 天：月结 / 半月结的账期长度跟着自然月走，
 * 按周算会把区间截短，落在区间外的流水与轧差全部漏掉。
 */
export function settlePeriodEndFor(cycle: SettleCycle, periodStart: Date): Date {
  if (cycle === 'WEEKLY_MON') {
    return new Date(periodStart.getTime() + 7 * DAY_MS);
  }
  const p = shanghaiParts(periodStart);
  const points =
    cycle === 'MONTHLY_1'
      ? collectMonthly1Points(p.y, p.m, 2)
      : collectBiMonthlyPoints(p.y, p.m, 2);
  const startMs = periodStart.getTime();
  for (const pt of points) {
    if (pt > startMs) return new Date(pt);
  }
  /* 起点落在生成窗口之外（脏数据）：退到下个月 1 号，至少不会截成一周 */
  return new Date(Date.UTC(p.y, p.m + 1, 1) - SH_MS);
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

/** 直挂带平台总输赢；挂了总代的房是总代跟代理结，不列平台 */
export function roomSettleCsvHeader(
  agentShareLabel = '代理占成',
  opts?: { hasGeneral?: boolean },
) {
  if (opts?.hasGeneral) {
    return [
      '房间名',
      '房间号',
      '代理',
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
      '总代佣金',
      '代理佣金',
      '总代占成',
      '代理占成',
      '本期交割',
    ];
  }
  return [
    '房间名',
    '房间号',
    '代理',
    '账号',
    '盘口',
    '账单时间',
    '结账投注额',
    '派彩',
    '庄家盈亏',
    '上分',
    '下分',
    '佣金笔数',
    '佣金金额 · 已发',
    '玩家回水 · 已发',
    '推荐佣金 · 代理出',
    agentShareLabel,
    '平台总输赢',
    '代理总收益 · 占成减月费',
  ];
}

export function roomSettleCsvValues(
  s: {
    room: {
      name: string;
      roomNo: string;
      agent: { nickname: string; username: string } | null;
    };
    period: { fromText: string; toText: string };
    sheet: { payslip: Array<{ key: string; amount?: number; text?: string }> };
  },
  opts?: { hasGeneral?: boolean },
): Array<string | number> {
  const cell = (key: string) => s.sheet.payslip.find((i) => i.key === key);
  const textOf = (key: string) => cell(key)?.text ?? '';
  const numOf = (key: string) => cell(key)?.amount ?? 0;
  if (opts?.hasGeneral) {
    return [
      s.room.name,
      s.room.roomNo,
      s.room.agent?.nickname ?? '',
      s.room.agent?.username ?? '',
      textOf('book'),
      `${s.period.fromText} ~ ${s.period.toText}`,
      numOf('betFlow'),
      numOf('payout'),
      numOf('housePnl'),
      numOf('upAmount'),
      numOf('downAmount'),
      numOf('monthlyFee'),
      numOf('generalWage'),
      numOf('generalKeep'),
      numOf('wageAmount'),
      numOf('generalShare'),
      numOf('agentShare'),
      numOf('agentNet'),
    ];
  }
  return [
    s.room.name,
    s.room.roomNo,
    s.room.agent?.nickname ?? '',
    s.room.agent?.username ?? '',
    textOf('book'),
    `${s.period.fromText} ~ ${s.period.toText}`,
    numOf('betFlow'),
    numOf('payout'),
    numOf('housePnl'),
    numOf('upAmount'),
    numOf('downAmount'),
    numOf('wageCount'),
    numOf('wageAmount'),
    numOf('playerRebate'),
    numOf('upline'),
    numOf('agentShare'),
    numOf('platformNet'),
    numOf('agentNet'),
  ];
}

export function roomSettleCsvGeneralShare(s: {
  sheet: { payslip: Array<{ key: string; amount?: number }> };
}) {
  return s.sheet.payslip.find((i) => i.key === 'generalShare')?.amount ?? 0;
}

@Injectable()
export class RoomSettleService {
  private readonly logger = new Logger(RoomSettleService.name);
  private closing = false;

  constructor(
    private prisma: PrismaService,
    private adminLog: AdminLogService,
    private scope: ConsoleScopeService,
    private reports: ConsoleReportsService,
    private points: PointsService,
    private redis: RedisService,
    private risk: RiskService,
  ) {}

  private async loadCreditBook(
    room: Awaited<ReturnType<RoomSettleService['roomOrThrow']>>,
  ): Promise<CreditBookSnapshot | null> {
    if (room.bookMode !== 'CREDIT' || !room.ownerAgent) return null;
    const creditLimit = Number(room.creditLimit ?? 0);
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
      generalShareRate: this.roomShareRates(room).generalShareRate,
    });
  }

  /** 最近一张已结单，用来切「上次结清 → 现在」这段未结区间 */
  private lastSettledSheet(roomId: string) {
    return this.prisma.roomWeekSettle.findFirst({
      where: { roomId, status: 'SETTLED' },
      orderBy: { weekEnd: 'desc' },
      select: { weekStart: true, weekEnd: true, settledAt: true },
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
        nextBillAt: true,
        ownerAgent: {
          select: {
            id: true,
            userId: true,
            pointsQuota: true,
            user: { select: { uid: true, nickname: true, username: true } },
          },
        },
        generalAgent: {
          select: {
            shareRate: true,
            userId: true,
            user: { select: { nickname: true } },
          },
        },
      },
    });
    if (!room) throw new NotFoundException('房间不存在');
    return room;
  }

  private async sumRoomWeek(actor: ConsoleActor, roomId: string, from: Date, to: Date) {
    const [s, byHouse] = await Promise.all([
      this.reports.summary(actor, roomId, {
        from: toShanghaiOffsetIso(from),
        to: toShanghaiOffsetIso(to),
      }),
      this.reports.settledRoomAggByHouse([roomId], from, to),
    ]);
    const house = byHouse.get(roomId);
    const empty = { betFlow: 0, payout: 0, housePnl: 0, betCount: 0 };
    const agentFly = house?.agentFly ?? empty;
    return {
      /* 总代↔代理：代理全部飞盘（上台 + 飞到总代）。代理自己坐庄不进。 */
      betFlow: asMoney(agentFly.betFlow),
      payout: asMoney(agentFly.payout),
      housePnl: asMoney(agentFly.housePnl),
      betCount: Number(agentFly.betCount),
      playerPnl: asMoney(s.playerPnl ?? 0),
      upAmount: asMoney(s.upAmount ?? 0),
      upCount: Number(s.upCount ?? 0),
      downAmount: asMoney(s.downAmount ?? 0),
      downCount: Number(s.downCount ?? 0),
      commissionAmount: asMoney(s.commissionAmount ?? 0),
      commissionCount: Number(s.commissionCount ?? 0),
      activePlayers: Number(s.activePlayers ?? 0),
      byGame: Array.isArray(s.byGame) ? s.byGame : [],
      flown: house?.flown ?? empty,
      agentFly,
      generalSat: house?.generalSat ?? empty,
      closed: house?.closed ?? empty,
    };
  }

  /** 飞上台三段拆（总代表仍用这个） */
  private split(housePnl: number, agentShareRate: number, generalShareRate?: number | null) {
    return splitHouseShare(housePnl, agentShareRate, generalShareRate);
  }

  /** 总代↔代理：飞上台三段拆 + 总代坐庄只给代理占成 */
  private agentFlySplit(
    agg: Awaited<ReturnType<RoomSettleService['sumRoomWeek']>>,
    agentShareRate: number,
    generalShareRate?: number | null,
  ) {
    return splitAgentFlyingHouse(
      agg.flown.housePnl,
      agg.generalSat.housePnl,
      agentShareRate,
      generalShareRate,
    );
  }

  private roomShareRates(room: Awaited<ReturnType<RoomSettleService['roomOrThrow']>>) {
    const agentShareRate = Math.min(1, Math.max(0, Number(room.agentShareRate ?? 0)));
    const generalShareRate = room.generalAgent
      ? Math.min(1, Math.max(0, Number(room.generalAgent.shareRate ?? 0)))
      : null;
    return { agentShareRate, generalShareRate };
  }

  /**
   * 谁能跟这间房的代理清账。
   *
   * 挂了总代的房只能由那个总代结——平台跟总代按总代账期另算一张，
   * 管理越过总代直接跟代理结，会让同一段流水在两张单里各算一次。
   * 直挂房没有中间人，才由管理/总监结。
   *
   * 这里原先对管理/总监无条件放行，只靠前端把按钮藏起来，接口仍可直接调。
   */
  private async canActorSettleWithAgent(
    actor: ConsoleActor,
    room: Awaited<ReturnType<RoomSettleService['roomOrThrow']>>,
  ) {
    const generalUserId = room.generalAgent?.userId ?? null;
    if (actor.role === 'ADMIN' || actor.role === 'BRANCH') return !generalUserId;
    if (await this.scope.isGeneralSide(actor)) {
      return !!generalUserId && generalUserId === (await this.scope.generalRootId(actor));
    }
    return false;
  }

  /** 挂了总代的房：总代跟代理清账；直挂房：管理/总监跟代理清账。代理本人只看对账。 */
  private async assertCanSettleWithAgent(
    actor: ConsoleActor,
    room: Awaited<ReturnType<RoomSettleService['roomOrThrow']>>,
  ) {
    if (await this.canActorSettleWithAgent(actor, room)) return;
    if (actor.role === 'ADMIN' || actor.role === 'BRANCH') {
      throw new ForbiddenException('本房挂了总代，须由该总代跟代理清账；平台在总代账期里结');
    }
    if (await this.scope.isGeneralSide(actor)) {
      throw new ForbiddenException('只能给自己名下的房间代理清账');
    }
    throw new ForbiddenException('仅管理员/总监/总代可清账；代理只可查看对账');
  }

  private housePartyLabel(room: Awaited<ReturnType<RoomSettleService['roomOrThrow']>>) {
    return room.generalAgent?.userId ? '总代' : '平台';
  }

  /**
   * 账期内的流水佣金与回水，按「本房代理飞盘注单」归集（上台 + 飞到总代）。
   *
   * 从注单反查佣金流水，而不是扫代理账户：代理名下可能不止一间房，
   * 扫账户会把别的房的整包算进这张单；而且挂了总代的房，代理那份是走
   * 「总代下发」入账的，只认 flow_rebate_agent_in_ 会漏掉整笔。
   */
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

    type LegRow = { leg: string; amt: unknown; cnt: number };
    type SumRow = { amt: unknown; cnt: number };
    type AccRow = { accrued: unknown };

    const [wageRows, uplineRows, accRows] = await Promise.all([
      this.prisma.$queryRaw<LegRow[]>`
        SELECT
          CASE
            WHEN l."idempotencyKey" LIKE 'flow_rebate_general_in_%' THEN 'PLATFORM_TO_GENERAL'
            WHEN l."idempotencyKey" LIKE 'flow_rebate_agent_in_%'   THEN 'PLATFORM_TO_AGENT'
            WHEN l."idempotencyKey" LIKE 'flow_rebate_down_in_%'    THEN 'GENERAL_TO_AGENT'
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
          AND (
            b.payload->'fly'->>'flying' = 'true'
            OR b.payload->'fly'->>'sitting' = 'GENERAL'
          )
          AND NULLIF(b.payload->'fly'->>'roomId', '') = ${roomId}
        GROUP BY 1
      `,
      this.prisma.$queryRaw<SumRow[]>`
        SELECT COALESCE(SUM(c.amount), 0) AS amt, COUNT(*)::int AS cnt
        FROM "CommissionRecord" c
        WHERE c."settledAt" >= ${from}
          AND c."settledAt" < ${to}
          AND c."sourceRoundId" IN (
            SELECT DISTINCT b."roundId"
            FROM "Bet" b
            WHERE b."settledAt" >= ${from}
              AND b."settledAt" < ${to}
              AND (
                b.payload->'fly'->>'flying' = 'true'
                OR b.payload->'fly'->>'sitting' = 'GENERAL'
              )
              AND NULLIF(b.payload->'fly'->>'roomId', '') = ${roomId}
          )
      `,
      this.prisma.$queryRaw<AccRow[]>`
        SELECT COALESCE(SUM(
          b."validFlow" * COALESCE(NULLIF(b.payload->'fly'->>'P', '')::numeric, 0)
        ), 0) AS accrued
        FROM "Bet" b
        WHERE b."settledAt" >= ${from}
          AND b."settledAt" < ${to}
          AND b.status IN ('WON', 'LOST')
          AND b."validFlow" > 0
          AND (
            b.payload->'fly'->>'flying' = 'true'
            OR b.payload->'fly'->>'sitting' = 'GENERAL'
          )
          AND NULLIF(b.payload->'fly'->>'roomId', '') = ${roomId}
      `,
    ]);

    const legOf = (key: string) => {
      const row = wageRows.find((r) => r.leg === key);
      return { amount: asMoney(row?.amt ?? 0), count: Number(row?.cnt ?? 0) };
    };
    const platformToGeneral = legOf('PLATFORM_TO_GENERAL');
    const platformToAgent = legOf('PLATFORM_TO_AGENT');
    const generalToAgent = legOf('GENERAL_TO_AGENT');
    const uplineCommission = {
      amount: asMoney(uplineRows[0]?.amt ?? 0),
      count: Number(uplineRows[0]?.cnt ?? 0),
    };

    let playerRebateClaimed = 0;
    let playerRebateCount = 0;
    if (playerIds.length) {
      const rebateAgg = await this.prisma.dailyRebateSettlement.aggregate({
        where: {
          playerId: { in: playerIds },
          roomId,
          claimedAt: { gte: from, lt: to },
        },
        _sum: { amount: true },
        _count: true,
      });
      playerRebateClaimed = asMoney(rebateAgg._sum.amount ?? 0);
      playerRebateCount = Number(rebateAgg._count ?? 0);
    }
    const playerRebateAccrued = asMoney(accRows[0]?.accrued ?? 0);

    return {
      /** 代理本期收到的整包净额（平台直发 + 总代下发，已扣玩家 P） */
      flyRebateToAgent: roundMoney(platformToAgent.amount + generalToAgent.amount),
      platformToGeneral,
      platformToAgent,
      generalToAgent,
      uplineCommission,
      playerRebateClaimed,
      playerRebateCount,
      /** 飞盘注单计提的玩家回水（含未领） */
      playerRebateAccrued,
      /** 平台本期为流水佣金付出的合计（整包净额，不含玩家回水） */
      platformWageOut: roundMoney(platformToGeneral.amount + platformToAgent.amount),
    };
  }

  /**
   * 结账对账单（给代理确认用）：流水/派彩/占成/佣金/信用轧差逐项列清，
   * 并给出最终「平台付代理 / 代理付平台」净额。
   */
  async statement(
    actor: ConsoleActor,
    roomId: string,
    opts?: {
      period?: 'current' | 'last' | 'early';
      weekStart?: string;
      /** 总代表导出：按总代账期起止拉房间单，不跟各房自己的周期切 */
      rangeStart?: string;
      rangeEnd?: string;
    },
  ) {
    const room = await this.roomOrThrow(actor, roomId);
    const cycle = normalizeSettleCycle(room.settleCycle);
    const { agentShareRate: share, generalShareRate } = this.roomShareRates(room);
    const isCredit = room.bookMode === 'CREDIT';
    const periodKey = opts?.period === 'last' ? 'last' : opts?.period === 'early' ? 'early' : 'current';

    let periodStart: Date;
    let periodEnd: Date;
    let periodLabel: string;
    if (opts?.rangeStart && opts?.rangeEnd) {
      periodStart = new Date(opts.rangeStart);
      periodEnd = new Date(opts.rangeEnd);
      if (Number.isNaN(periodStart.getTime()) || Number.isNaN(periodEnd.getTime())) {
        throw new BadRequestException('账期时间无效');
      }
      periodLabel = periodKey === 'current' ? '本期进行中' : '上期账期';
    } else if (periodKey === 'early') {
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
      periodLabel = '上期账期';
      if (opts?.weekStart) {
        const ws = new Date(opts.weekStart);
        if (!Number.isNaN(ws.getTime())) {
          periodStart = ws;
          /* 提前结账封的不是整周，按单子上记的收尾时间取，别把区间拉到周末去 */
          const sheet = await this.prisma.roomWeekSettle.findUnique({
            where: { roomId_weekStart: { roomId, weekStart: ws } },
            select: {
              weekStart: true, weekEnd: true, status: true,
              betFlow: true, housePnl: true, settlePay: true,
            },
          });
          /*
           * 前端会把 overview.lastWeek.weekStart 原样传回来。
           * 只要钉死的是 cron 全 0 关账单，就改指最近已结单。
           * 不拿 ws 去跟 shanghaiSettleBounds 的午夜比相等——Prisma 无时区列会差 8 小时。
           */
          const replay = pickReplaySettledSheet({
            calendarStatus: sheet?.status,
            calendarBetFlow: sheet ? Number(sheet.betFlow) : undefined,
            calendarHousePnl: sheet ? Number(sheet.housePnl) : undefined,
            calendarSettlePay: sheet ? Number(sheet.settlePay) : undefined,
            calendarWeekStart: sheet?.weekStart ?? ws,
            latestSettled: await this.lastSettledSheet(roomId),
          });
          if (replay) {
            periodStart = replay.weekStart;
            periodEnd = replay.weekEnd;
          } else {
            periodEnd = sheet?.weekEnd
              ?? (ws.getTime() === last.periodStart.getTime()
                ? last.periodEnd
                : settlePeriodEndFor(cycle, ws));
          }
        }
      } else {
        /*
         * 「上一期」按日历取常常是空的：提前结账封的那一段落在本期里。
         * 日历上周若只是 cron 写的全 0 关账单，改成回放最近一张已结单。
         * 不再拿 JS 上海午夜去跟 Prisma 时间戳比相等——时区差 8 小时会让回放永远打不着。
         */
        const onCalendar = await this.prisma.roomWeekSettle.findUnique({
          where: { roomId_weekStart: { roomId, weekStart: last.periodStart } },
          select: {
            weekStart: true, weekEnd: true, status: true,
            betFlow: true, housePnl: true, settlePay: true,
          },
        });
        const replay = pickReplaySettledSheet({
          calendarStatus: onCalendar?.status,
          calendarBetFlow: onCalendar ? Number(onCalendar.betFlow) : undefined,
          calendarHousePnl: onCalendar ? Number(onCalendar.housePnl) : undefined,
          calendarSettlePay: onCalendar ? Number(onCalendar.settlePay) : undefined,
          calendarWeekStart: onCalendar?.weekStart ?? last.periodStart,
          latestSettled: await this.lastSettledSheet(roomId),
        });
        if (replay) {
          periodStart = replay.weekStart;
          periodEnd = replay.weekEnd;
        }
      }
    } else {
      /*
       * 「本期」= 上次结清之后还没结的那一段。
       * 不这么切的话，刚提前结完账，本期会把已经封进单子的流水再显示一遍。
       */
      const current = shanghaiSettleBounds(cycle, 0);
      const lastSettled = await this.lastSettledSheet(roomId);
      periodStart =
        lastSettled && lastSettled.weekEnd.getTime() > current.periodStart.getTime()
          ? lastSettled.weekEnd
          : current.periodStart;
      periodEnd = current.periodEnd;
      periodLabel = '本期进行中';
    }

    const settledSheet = await this.prisma.roomWeekSettle.findFirst({
      where: { roomId, status: 'SETTLED', weekStart: periodStart },
      select: { settledAt: true, monthlyFeePeriod: true },
    });

    const agentUserId = room.ownerAgent?.userId ?? null;
    const [agg, side, creditBook, agentBalanceRaw, unsettledDebt] = await Promise.all([
      this.sumRoomWeek(actor, roomId, periodStart, periodEnd),
      this.periodSideMoney(roomId, agentUserId ?? undefined, periodStart, periodEnd),
      this.loadCreditBook(room),
      agentUserId
        ? this.prisma.pointsAccount.findFirst({
            where: { ownerType: 'AGENT', ownerId: agentUserId, roomId: '' },
            select: { balance: true },
          })
        : Promise.resolve(null),
      isCredit && agentUserId
        ? sumUnsettledCreditDebt(
            this.prisma,
            roomCreditDebtFilter({
              agentUserId,
              generalUserId: room.generalAgent?.userId ?? null,
              roomId,
            }),
          )
        : Promise.resolve(0),
    ]);
    const agentBalance = asMoney(agentBalanceRaw?.balance ?? 0);

    /*
     * 总代↔代理按代理全部飞盘（上台 + 飞到总代）算占成。
     * 飞上台仍三段拆；总代坐庄那截平台拿 0，总代留下减掉代理占成的。
     * 跟平台结的另结/总表仍只用 flown。
     */
    const flying = this.agentFlySplit(agg, share, generalShareRate);
    const flownSplit = this.split(agg.flown.housePnl, share, generalShareRate);
    const split = flying;
    const commission = side.flyRebateToAgent;
    const creditGrossPay = netCreditSettlePay(
      creditAgentFlyPayToAgent(flying),
      commission,
    );
    const settleBasis = {
      mode: 'BET_HOUSE_PNL' as const,
      label: '代理飞盘庄家盈亏 × 占成',
      housePnl: flying.housePnl,
      agentShareAmount: flying.agentShareAmount,
      generalShareAmount: flying.generalShareAmount,
      platformShareAmount: flying.platformShareAmount,
      platformPayToAgent: isCredit
        ? creditGrossPay
        : cashFlownPayToAgent(flying.agentShareAmount),
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
    const restoreDelta = isCredit && creditBook
      ? creditQuotaRestoreDelta({
          creditLimit: creditBook.creditLimit,
          pointsQuota: creditBook.pointsQuota,
          playerBalances: creditBook.playerBalances,
          csBalances: creditBook.csBalances,
        })
      : 0;
    const monthlyFeeContract = asMoney(room.monthlyFee);
    /** 提前结账用「现在」看到期没到期；上期/本期用账期结束日 */
    const feeAsOf = periodKey === 'early' ? new Date() : periodEnd;
    const monthlyFeeDue = roomMonthlyFeeDue(monthlyFeeContract, room.nextBillAt, feeAsOf);
    /*
     * 已经封成单子的账期回放单子上的数：到期时间早就推到下个月了，
     * 照着现在的到期时间重算，这一期的月费会变成 0，跟结清历史对不上。
     */
    const monthlyFeePeriod = settledSheet
      ? asMoney(settledSheet.monthlyFeePeriod)
      : monthlyFeeDue.amount;
    const monthlyFeeMonths = monthlyFeeContract > 0
      ? Math.round(monthlyFeePeriod / monthlyFeeContract)
      : 0;
    /** 月费由代理付给上家 → 交割净额减（上家应付↓ / 代理应付↑） */
    const monthlyFeeSettle = roundMoney(-monthlyFeePeriod);

    const lines: Line[] = [
      /* 代理飞盘：上台 + 飞到总代。代理自己坐庄不进。 */
      { key: 'betFlow', group: '经营', label: '结账投注额', amount: agg.agentFly.betFlow, kind: 'info' },
      { key: 'payout', group: '经营', label: '派彩', amount: agg.agentFly.payout, kind: 'info' },
      { key: 'betHousePnl', group: '经营', label: '庄家输赢', amount: agg.agentFly.housePnl, kind: 'info' },
      {
        key: 'playerPnl',
        group: '经营',
        label: '玩家盈亏',
        amount: roundMoney(-agg.agentFly.housePnl),
        kind: 'info',
      },

      { key: 'upAmount', group: '上下分', label: '上分合计', amount: agg.upAmount, kind: 'info' },
      { key: 'downAmount', group: '上下分', label: '下分合计', amount: agg.downAmount, kind: 'info' },
      { key: 'upCount', group: '上下分', label: '上分笔数', amount: agg.upCount, kind: 'info' },
      { key: 'downCount', group: '上下分', label: '下分笔数', amount: agg.downCount, kind: 'info' },

      {
        key: 'flyRebate',
        group: '流水佣金',
        label: '代理整包净额',
        amount: side.flyRebateToAgent,
        kind: 'info',
        note: '代理自己的回水，当场进盘分',
      },
      ...(side.platformToGeneral.amount
        ? [{
            key: 'generalWage',
            group: '流水佣金',
            label: '总代整包',
            amount: side.platformToGeneral.amount,
            kind: 'info' as const,
            note: '平台当场打到总代盘分',
          }]
        : []),
      {
        key: 'playerRebate',
        group: '流水佣金',
        label: '玩家回水',
        amount: side.playerRebateAccrued,
        kind: 'info',
        note: side.playerRebateClaimed
          ? `整包里留给玩家的点；已领 ${side.playerRebateClaimed}`
          : '整包里留给玩家的点，未领也计入本期',
      },
      {
        key: 'commission',
        group: '流水佣金',
        label: '挂靠佣金',
        amount: side.uplineCommission.amount,
        kind: 'info',
        note: '代理出，付给玩家的上级代理',
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
        label: '代理盘分',
        amount: isCredit ? agentBalance : 0,
        kind: 'info',
        note: isCredit ? '与现金盘同一本盘分；整包结账时从这里抽走' : undefined,
      },

      {
        key: 'settleBase',
        group: '占成',
        label: '交割基数',
        amount: settleBasis.housePnl,
        kind: 'info',
      },
      {
        key: 'agentShare',
        group: '占成',
        label: '代理份额',
        amount: settleBasis.agentShareAmount,
        kind: 'info',
      },
      /* 两种盘都可能挂总代，成数差都要列出来备查 */
      ...(split.generalShareAmount
        ? [{
            key: 'generalShare',
            group: '占成',
            label: '总代成数差',
            amount: split.generalShareAmount,
            kind: 'info' as const,
            note: '代理按本行上方的份额与总代结；这一截由总代与平台单独交割，不影响代理应付',
          }]
        : []),
      ...(isCredit
        ? [
            {
              key: 'creditFlyPay',
              group: '占成',
              label: '飞盘上缴',
              amount: creditAgentFlyPayToAgent(flying),
              kind: 'settle' as const,
              note: '庄家盈亏减去代理占成，付给上家',
            },
            {
              key: 'creditCommission',
              group: '占成',
              label: '加：已发代理佣金',
              amount: commission,
              kind: 'settle' as const,
              note: '佣金已进盘分，结账加回现金交割',
            },
            {
              key: 'issueDebtLeft',
              group: '占成',
              label: '未结上分',
              amount: unsettledDebt,
              kind: 'info' as const,
              note: '合同额度往来，不进这期现金。人不干了再扣',
            },
            {
              key: 'quotaRestore',
              group: '占成',
              label: restoreDelta >= 0 ? '结账充额度' : '结账扣额度',
              amount: restoreDelta,
              kind: 'info' as const,
              note: '结账才动。结账前涨的那截可以飞',
            },
          ]
        : [{
            key: 'platformSharePay',
            group: '占成',
            label: '占成应付',
            amount: grossPay,
            kind: 'settle' as const,
          }]),
      {
        key: 'monthlyFee',
        group: '占成',
        label: monthlyFeeMonths > 1 ? `减：本期月费 ×${monthlyFeeMonths}` : '减：本期月费',
        amount: monthlyFeeSettle,
        kind: 'settle',
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
    const house = this.housePartyLabel(room);
    const netLabel =
      netDirection === 'PLATFORM_PAYS_AGENT'
        ? `${house}需付给代理 ${platformToAgent}`
        : netDirection === 'AGENT_PAYS_PLATFORM'
          ? `代理需付给${house} ${agentToPlatform}`
          : '双方互不找补（交割净额为 0）';

    const agent = room.ownerAgent?.user;

    /*
     * 三方对账表：一张表写清流水、输赢、管理/总代/代理各分多少、最后谁付谁。
     * 占成三段拆两本账共用同一公式，信用盘的总代成数差也就一并显示出来了。
     * 代理↔上家那笔就是本单交割；总代↔平台那笔在总代账期结，这里只标出来备查。
     */
    const hasGeneral = !!room.generalAgent?.userId;
    const displaySplit = flying;
    const agentLabel = agent?.nickname || agent?.username || '代理';
    const generalLabel = room.generalAgent?.user?.nickname || '总代';
    const pct = (n: number) => Math.round(n * 1000) / 10;

    const partyRows = [
      {
        key: 'AGENT' as const,
        role: '代理',
        name: agentLabel,
        sharePct: pct(share),
        amount: displaySplit.agentShareAmount,
        note: '按本房代理占成',
      },
      ...(hasGeneral
        ? [
            {
              key: 'GENERAL' as const,
              role: '总代',
              name: generalLabel,
              sharePct: pct(displaySplit.generalShareRate - share),
              amount: displaySplit.generalShareAmount,
              note: '飞上台拿成数差；自己坐庄拿庄家盈亏减去代理占成',
            },
          ]
        : []),
      {
        key: 'PLATFORM' as const,
        role: '平台',
        name: '管理',
        sharePct: pct(1 - displaySplit.generalShareRate),
        amount: displaySplit.platformShareAmount,
        note: '只算飞上台的，总代关盘后不进',
      },
    ];

    const upstreamLabel = hasGeneral ? '总代' : '平台';
    const transferOf = (
      key: string,
      amount: number,
      payer: string,
      payee: string,
      scope: '本单' | '另结',
      note: string,
    ) => {
      const v = roundMoney(amount);
      const even = Math.abs(v) < 1e-9;
      return {
        key,
        scope,
        note,
        amount: Math.abs(v),
        from: even ? null : v > 0 ? payer : payee,
        to: even ? null : v > 0 ? payee : payer,
        label: even
          ? '互不找补'
          : v > 0
            ? `${payer} 付给 ${payee} ${Math.abs(v)}`
            : `${payee} 付给 ${payer} ${Math.abs(v)}`,
      };
    };

    /* 本单：netAmount 为正=上家付代理 */
    const transfers = [
      transferOf(
        'ROOM',
        netAmount,
        upstreamLabel,
        '代理',
        '本单',
        isCredit
          ? '本次结账实际交割金额（飞盘上缴加已发佣金）'
          : '本次结账实际交割金额（占成应付）',
      ),
    ];
    if (hasGeneral) {
      const generalLeg = isCredit
        ? creditRoomPayToPlatform(flownSplit.platformShareAmount, commission)
        : cashFlownPayToPlatform(
            flownSplit.agentShareAmount,
            flownSplit.generalShareAmount,
          );
      transfers.push(
        transferOf(
          'GENERAL_PLATFORM',
          generalLeg,
          '总代',
          '平台',
          '另结',
          '在总代账期一并结算，不含在本单金额里',
        ),
      );
    }

    /*
     * 流水佣金：按有效流水另算，下注当场就发了，跟占成是两笔钱。
     * 两盘都已进代理盘分，不再进本次交割。
     */
    const wageRows = [
      ...(side.platformToGeneral.amount
        ? [{
            key: 'PLATFORM_TO_GENERAL',
            label: '总代整包',
            from: '平台',
            to: '总代',
            amount: side.platformToGeneral.amount,
            count: side.platformToGeneral.count,
          }]
        : []),
      ...(side.generalToAgent.amount
        ? [{
            key: 'GENERAL_TO_AGENT',
            label: '代理整包（总代下发）',
            from: '总代',
            to: '代理',
            amount: side.generalToAgent.amount,
            count: side.generalToAgent.count,
          }]
        : []),
      ...(side.platformToAgent.amount
        ? [{
            key: 'PLATFORM_TO_AGENT',
            label: '代理整包',
            from: '平台',
            to: '代理',
            amount: side.platformToAgent.amount,
            count: side.platformToAgent.count,
          }]
        : []),
      ...(side.playerRebateAccrued
        ? [{
            key: 'PLAYER_REBATE',
            label: '玩家回水',
            from: '平台',
            to: '玩家',
            amount: side.playerRebateAccrued,
            count: side.playerRebateCount,
          }]
        : []),
      ...(side.uplineCommission.amount
        ? [{
            key: 'UPLINE',
            label: '挂靠佣金',
            from: '代理',
            to: '上级代理',
            amount: side.uplineCommission.amount,
            count: side.uplineCommission.count,
          }]
        : []),
    ];

    /*
     * 工资条：一行项目名、一行金额横排下去。页面与导出的 CSV 共用这一份，
     * 避免两边各摆各的顺序，对账时看到的东西不一样。
     * 平台占了几成不列——单子是给代理和总代看的，他们只关心自己那几成和最后实付。
     */
    type Slip = {
      key: string;
      label: string;
      kind: 'text' | 'money' | 'count';
      amount?: number;
      text?: string;
      emphasis?: boolean;
    };
    const money = (key: string, label: string, amount: number): Slip =>
      ({ key, label, kind: 'money', amount: roundMoney(amount) });
    const count = (key: string, label: string, amount: number): Slip =>
      ({ key, label, kind: 'count', amount });
    const text = (key: string, label: string, value: string): Slip =>
      ({ key, label, kind: 'text', text: value });

    /** 平台最终落到手的：庄家赢的减去分给下家的占成，再减平台自己掏的整包和玩家回水 */
    const platformNet = roundMoney(
      settleBasis.housePnl -
        displaySplit.agentShareAmount -
        displaySplit.generalShareAmount -
        side.platformWageOut -
        side.playerRebateAccrued,
    );
    const wageCount = side.platformToAgent.count + side.generalToAgent.count;

    const payslip: Slip[] = [
      text('roomName', '房间名', room.name),
      text('roomNo', '房间号', room.roomNo),
      text('agent', '代理', agent ? `${agent.nickname}/${agent.username}` : '—'),
      ...(hasGeneral ? [text('general', '总代', generalLabel)] : []),
      text('book', '盘口', isCredit ? 'B 信用盘' : 'A 现金盘'),
      text('period', '账单时间', `${fmtSh(periodStart)} ～ ${fmtSh(periodEnd)}`),

      money('betFlow', '结账投注额', agg.agentFly.betFlow),
      money('payout', '派彩', agg.agentFly.payout),
      money('housePnl', '庄家盈亏', settleBasis.housePnl),
      money('upAmount', '上分', agg.upAmount),
      money('downAmount', '下分', agg.downAmount),
      money('monthlyFee', '房间月费', monthlyFeePeriod),

      /* 标「已发」：这几笔下注当场就结掉了，不在实付里 */
      ...(hasGeneral
        ? [
            money(
              'generalWage',
              '整包佣金',
              roundMoney(side.platformWageOut + side.playerRebateAccrued),
            ),
            money(
              'generalKeep',
              '总代佣金',
              roundMoney(side.platformToGeneral.amount - side.generalToAgent.amount),
            ),
            money('wageAmount', '代理佣金', side.flyRebateToAgent),
          ]
        : [
            count('wageCount', '佣金笔数', wageCount),
            money('wageAmount', '佣金金额·已发', side.flyRebateToAgent),
            money('playerRebate', '玩家回水', side.playerRebateAccrued),
            money('upline', '挂靠佣金·代理出', side.uplineCommission.amount),
          ]),

      ...(isCredit
        ? [
            money('creditQuota', '剩余额度', creditBook?.pointsQuota ?? 0),
            money('creditPlayers', '玩家余额', creditBook?.playerBalances ?? 0),
            money('creditCs', '客服额度', creditBook?.csBalances ?? 0),
            money('creditExcess', '超出', creditBook?.excess ?? 0),
            money('agentPocket', '代理盘分', agentBalance),
          ]
        : []),

      ...(hasGeneral
        ? [
            money('generalShare', '成数差', displaySplit.generalShareAmount),
          ]
        : []),
      money(
        'agentShare',
        hasGeneral ? '代理占成' : `代理 ${pct(share)}%`,
        displaySplit.agentShareAmount,
      ),
      ...(isCredit
        ? [
            money('sharePay', '飞盘上缴', creditAgentFlyPayToAgent(flying)),
            money('creditCommission', '加：已发代理佣金', commission),
            money('issueDebtLeft', '未结上分', unsettledDebt),
            money(restoreDelta >= 0 ? 'quotaRestore' : 'quotaDeduct', restoreDelta >= 0 ? '结账充额度' : '结账扣额度', restoreDelta),
          ]
        : [money('sharePay', '占成应付', grossPay)]),

      /* 挂了总代：这张单是总代跟代理结，收口两边盈亏；平台总输赢只在总代表 */
      ...(hasGeneral
        ? [
            { ...money('generalPnl', '总代盈亏', displaySplit.generalShareAmount), emphasis: true },
            { ...money('agentNet', '代理盈亏', netAmount), emphasis: true },
          ]
        : [
            { ...money('platformNet', '平台总输赢', platformNet), emphasis: true },
            { ...money('agentNet', '代理总收益·占成减月费', netAmount), emphasis: true },
          ]),
    ];

    const sheet = {
      basisLabel: '代理飞盘部分',
      betFlow: agg.agentFly.betFlow,
      payout: agg.agentFly.payout,
      housePnl: settleBasis.housePnl,
      platformNet,
      payslip,
      parties: partyRows,
      transfers,
      wages: {
        rows: wageRows,
        /** 平台为流水佣金付出的合计（整包 + 玩家回水） */
        platformOut: roundMoney(side.platformWageOut + side.playerRebateAccrued),
        /** 总代拿整包差价 */
        generalKeep: roundMoney(
          side.platformToGeneral.amount - side.generalToAgent.amount,
        ),
        agentGet: side.flyRebateToAgent,
        note: '整包净额当场进盘分；玩家回水留池，未领也计入本期，不再进本次交割',
      },
    };

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
        generalUserId: room.generalAgent?.userId ?? null,
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
        /** 这一段是否已经封成账单；只有未结的区间才允许结账 */
        settled: !!settledSheet,
        settledAt: settledSheet?.settledAt?.toISOString() ?? null,
      },
      /* 与账单同口径：代理全部飞盘 */
      ops: {
        betFlow: agg.agentFly.betFlow,
        payout: agg.agentFly.payout,
        betCount: agg.agentFly.betCount,
        housePnl: agg.agentFly.housePnl,
        playerPnl: roundMoney(-agg.agentFly.housePnl),
        upAmount: agg.upAmount,
        upCount: agg.upCount,
        downAmount: agg.downAmount,
        downCount: agg.downCount,
        activePlayers: agg.activePlayers,
        byGame: agg.byGame,
      },
      fees: {
        commissionAmount: side.uplineCommission.amount,
        commissionCount: side.uplineCommission.count,
        flyRebateToAgent: side.flyRebateToAgent,
        playerRebateClaimed: side.playerRebateClaimed,
        playerRebateAccrued: side.playerRebateAccrued,
        playerRebateCount: side.playerRebateCount,
        /** 合同月费（整月） */
        monthlyFee: monthlyFeeContract,
        /** 本期该收几个月 × 合同月费；到期时间锚在建房那一刻 */
        monthlyFeePeriod,
        monthlyFeeMonths,
        nextBillAt: room.nextBillAt?.toISOString?.() ?? room.nextBillAt ?? null,
      },
      creditBook,
      share: settleBasis,
      /** 三方对账：流水/输赢/各家分成/谁付谁，对账时看这一张就够 */
      sheet,
      lines,
      settlement: {
        platformToAgent,
        agentToPlatform,
        netAmount,
        netDirection,
        netLabel,
        alreadyPaidToAgent: roundMoney(
          side.uplineCommission.amount + (isCredit ? 0 : side.flyRebateToAgent),
        ),
        flyRebateOffset: 0,
        agentBalanceOffset: 0,
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
    const agentShare = s.sheet.payslip.find((i) => i.key === 'agentShare');
    const hasGeneral = !!s.room.generalUserId;
    const headers = roomSettleCsvHeader(agentShare?.label || `代理 ${s.room.agentSharePct}%`, {
      hasGeneral,
    });
    const values = roomSettleCsvValues(s, { hasGeneral });
    const day = (s.period.fromText || '').slice(0, 10) || 'settle';
    const csv = `\uFEFF${[csvRow(headers), csvRow(values)].join('\r\n')}`;
    return {
      filename: `${hasGeneral ? '工资条' : '对账单'}-${s.room.roomNo}-${day}-${s.period.key}.csv`,
      csv,
      statement: s,
    };
  }

  /**
   * 账期一到就把信用盘账本定格：记下当时的剩余信用、玩家持分、客服额度与超出。
   * 之后到实际对接之间的输赢留给下一期——账单数字不会因为对接晚了几小时而变。
   * 幂等：同一账期只封一次；已结清的不动。
   */
  @Cron('7 * * * *', { timeZone: 'Asia/Shanghai' })
  async cronCloseDuePeriods() {
    if (this.closing) return;
    this.closing = true;
    try {
      /* 封账会校准代理额度：取锁失败时宁可不跑，重跑会把额度算错 */
      await this.redis.runExclusive(
        'gamebox:cron:credit-close',
        20 * 60 * 1000,
        () => this.runCloseDuePeriods(),
        { onLockError: 'skip' },
      );
    } finally {
      this.closing = false;
    }
  }

  /**
   * 应付账龄巡检：把「已结账但线下一直没交割」的单子挑出来告警。
   *
   * 现金盘的占成交割是线下的——系统只生成一条应付记录，等人工确认收付。
   * 这不是代码缺陷，是流程风险：漏确认就等于漏付，而原先既没有账龄看板
   * 也没有超期提醒，全靠运营记性。金额越大、拖得越久，越难追回。
   *
   * 每天上海时间 10:00 跑一次，逾期的记进风控事件（后台风控页可见）。
   */
  @Cron('0 10 * * *', { timeZone: 'Asia/Shanghai' })
  async cronAgePayables() {
    await this.redis.runExclusive(
      'gamebox:cron:settle-aging',
      10 * 60 * 1000,
      () => this.runAgePayables(),
      { onLockError: 'skip' },
    );
  }

  /**
   * 应付账龄正体；也供后台手动查。
   *
   * `actor` 省略时查全站，只给定时巡检用。
   * 后台接口必须传 actor：总监只被授权部分房间，不收窄的话
   * 他能从这里看到未授权房间的房号、结账金额和欠付天数。
   */
  async agedPayables(overdueDays = SETTLE_OVERDUE_DAYS, actor?: ConsoleActor) {
    const cutoff = new Date(Date.now() - overdueDays * 86_400_000);
    const roomIds = actor ? await this.scope.grantedRoomIds(actor) : null;
    if (roomIds && !roomIds.length) return [];
    const rows = await this.prisma.roomWeekSettle.findMany({
      where: {
        status: 'SETTLED',
        paymentStatus: 'UNPAID',
        settledAt: { lt: cutoff },
        ...(roomIds ? { roomId: { in: roomIds } } : {}),
      },
      orderBy: { settledAt: 'asc' },
      take: 200,
      select: {
        id: true,
        roomId: true,
        weekStart: true,
        weekEnd: true,
        bookMode: true,
        settlePay: true,
        settledAt: true,
        room: { select: { roomNo: true, name: true } },
      },
    });
    const now = Date.now();
    return rows.map((r) => ({
      id: r.id,
      roomId: r.roomId,
      roomNo: r.room?.roomNo ?? '',
      roomName: r.room?.name ?? '',
      bookMode: r.bookMode,
      weekStart: r.weekStart.toISOString(),
      weekEnd: r.weekEnd.toISOString(),
      settledAt: r.settledAt?.toISOString() ?? null,
      settlePay: asMoney(r.settlePay),
      /** 结账至今多少天没交割 */
      ageDays: r.settledAt
        ? Math.floor((now - r.settledAt.getTime()) / 86_400_000)
        : null,
      /** 正=平台应付代理，负=代理应付平台 */
      direction: asMoney(r.settlePay) >= 0 ? 'PLATFORM_PAYS_AGENT' : 'AGENT_PAYS_PLATFORM',
    }));
  }

  private async runAgePayables() {
    const list = await this.agedPayables();
    if (!list.length) return;
    const total = roundMoney(list.reduce((s, r) => s + Math.abs(r.settlePay), 0));
    this.logger.warn(
      `应付超期 ${list.length} 单，合计 ${total}（超过 ${SETTLE_OVERDUE_DAYS} 天未线下交割）`,
    );
    for (const r of list) {
      await this.risk.record({
        type: 'SETTLE_OVERDUE',
        level: Math.abs(r.settlePay) >= 100_000 ? 'CRITICAL' : 'WARN',
        targetId: r.roomId,
        /* 同一单每天最多告一次，避免刷屏 */
        fingerprint: `settle_overdue:${r.id}`,
        dedupeMs: 20 * 3600_000,
        detail: {
          settleId: r.id,
          roomNo: r.roomNo,
          roomName: r.roomName,
          bookMode: r.bookMode,
          settlePay: r.settlePay,
          ageDays: r.ageDays,
          direction: r.direction,
          summary: `${r.roomName}（${r.roomNo}）结账 ${r.ageDays} 天未交割，应付 ${r.settlePay}`,
        },
      });
    }
  }

  /** 封账正体：抽出来是为了套分布式锁，逻辑未变 */
  private async runCloseDuePeriods() {
    try {
      const rooms = await this.prisma.room.findMany({
        where: { bookMode: 'CREDIT', status: { not: 'CLOSED' } },
        select: {
          id: true,
          settleCycle: true,
          creditLimit: true,
          ownerAgent: { select: { userId: true, pointsQuota: true } },
        },
        take: 500,
      });
      let closed = 0;
      for (const room of rooms) {
        if (!room.ownerAgent) continue;
        const cycle = normalizeSettleCycle(room.settleCycle);
        /* 刚结束的那一期 */
        const last = shanghaiSettleBounds(cycle, -1);
        const existing = await this.prisma.roomWeekSettle.findUnique({
          where: { roomId_weekStart: { roomId: room.id, weekStart: last.periodStart } },
          select: { id: true, status: true, closedAt: true },
        });
        if (existing?.closedAt || existing?.status === 'SETTLED') continue;

        const [playerBalances, csBalances] = await Promise.all([
          sumRoomPlayerBalances(this.prisma, room.id),
          sumAgentCsBalances(this.prisma, room.ownerAgent.userId),
        ]);
        const book = computeCreditBook({
          creditLimit: Number(room.creditLimit),
          pointsQuota: asMoney(room.ownerAgent.pointsQuota),
          playerBalances,
          csBalances,
          agentShareRate: 0,
        });
        const snapshot = {
          quotaAtClose: new Prisma.Decimal(book.pointsQuota.toFixed(2)),
          playerBalancesAtClose: new Prisma.Decimal(book.playerBalances.toFixed(2)),
          csBalancesAtClose: new Prisma.Decimal(book.csBalances.toFixed(2)),
          excessAtClose: new Prisma.Decimal(book.excess.toFixed(2)),
          closedAt: new Date(),
        };
        await this.prisma.roomWeekSettle.upsert({
          where: { roomId_weekStart: { roomId: room.id, weekStart: last.periodStart } },
          create: {
            roomId: room.id,
            weekStart: last.periodStart,
            weekEnd: last.periodEnd,
            bookMode: 'CREDIT',
            agentShareRate: 0,
            status: 'CLOSED',
            ...snapshot,
          },
          update: { status: existing?.status === 'OPEN' ? 'CLOSED' : undefined, ...snapshot },
        });
        closed++;
      }
      if (closed) this.logger.log(`credit period closed: ${closed} room(s)`);
    } catch (e) {
      this.logger.error(`cronCloseDuePeriods failed: ${(e as Error).message}`);
    }
  }

  async overview(actor: ConsoleActor, roomId: string) {
    const room = await this.roomOrThrow(actor, roomId);
    const cycle = normalizeSettleCycle(room.settleCycle);
    const current = shanghaiSettleBounds(cycle, 0);
    const last = shanghaiSettleBounds(cycle, -1);
    const { agentShareRate: share, generalShareRate } = this.roomShareRates(room);
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
    /*
     * 两个口径都按注单分账期算，跟 statement()/persistSettle() 同一套。
     *
     * 原先信用盘走 creditBook（额度差）：那是「此刻」的额度快照，没有账期概念，
     * 结果本期与上期显示同一个数，还跟结算单对不上。额度账本另有 creditBook 字段单独给。
     */
    const curSplit = this.agentFlySplit(curAgg, share, generalShareRate);
    const lastSplit = this.agentFlySplit(lastAgg, share, generalShareRate);

    /*
     * 日历上周若只是 cron 空关账单，指向最近那张更新的已结单
     * （提前结账封的那一段就落在本期里），否则「上期」全是 0。
     */
    const calendarLast = histMap.get(last.periodStart.toISOString())
      ?? history.find((h) => fmtSh(h.weekStart) === fmtSh(last.periodStart));
    const newestSettled = [...history]
      .filter((h) => h.status === 'SETTLED')
      .sort((a, b) => b.weekEnd.getTime() - a.weekEnd.getTime())[0] ?? null;
    const replay = pickReplaySettledSheet({
      calendarStatus: calendarLast?.status,
      calendarBetFlow: calendarLast ? Number(calendarLast.betFlow) : undefined,
      calendarHousePnl: calendarLast ? Number(calendarLast.housePnl) : undefined,
      calendarSettlePay: calendarLast ? Number(calendarLast.settlePay) : undefined,
      calendarWeekStart: calendarLast?.weekStart ?? last.periodStart,
      latestSettled: newestSettled,
    });
    const lastRow = replay ?? calendarLast ?? newestSettled;
    const lastFrom = lastRow?.weekStart ?? last.periodStart;
    const lastTo = lastRow?.weekEnd ?? last.periodEnd;
    const lastStatus = lastRow?.status
      ?? (Date.now() >= current.periodStart.getTime() ? 'CLOSED' : 'OPEN');
    const canSettleWithAgent = await this.canActorSettleWithAgent(actor, room);

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
        weekStart: lastFrom.toISOString(),
        weekEnd: lastTo.toISOString(),
        fromText: fmtSh(lastFrom),
        toText: fmtSh(lastTo),
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
              generalShareAmount: Number(lastRow.generalShareAmount ?? 0),
              platformShareAmount: Number(lastRow.platformShareAmount),
              housePnl: Number(lastRow.housePnl),
            }
          : lastSplit),
        canMarkSettled: lastStatus !== 'SETTLED' && canSettleWithAgent,
      },
      /** 挂了总代的房由总代提前结；直挂房由管理/总监提前结 */
      canEarlySettle: canSettleWithAgent,
      history: history.map((h) => ({
        id: h.id,
        weekStart: h.weekStart.toISOString(),
        weekEnd: h.weekEnd.toISOString(),
        fromText: fmtSh(h.weekStart),
        toText: fmtSh(h.weekEnd),
        bookMode: h.bookMode,
        agentShareRate: h.agentShareRate,
        generalShareRate: h.generalShareRate ?? h.agentShareRate,
        betFlow: Number(h.betFlow),
        housePnl: Number(h.housePnl),
        agentShareAmount: Number(h.agentShareAmount),
        generalShareAmount: Number(h.generalShareAmount ?? 0),
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
   * 提前结账：把「上次结清 → 现在」锁成一张单。
   * 现金盘按代理飞盘占成落账；信用盘上缴飞盘差额、加回已发佣金，额度加回合同。
   */
  async earlySettle(
    actor: ConsoleActor,
    roomId: string,
    body?: { note?: string },
  ) {
    const room = await this.roomOrThrow(actor, roomId);
    await this.assertCanSettleWithAgent(actor, room);
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
    const room = await this.roomOrThrow(actor, roomId);
    await this.assertCanSettleWithAgent(actor, room);
    const cycle = normalizeSettleCycle(room.settleCycle);
    const last = shanghaiSettleBounds(cycle, -1);
    let weekStart = last.periodStart;
    let weekEnd = last.periodEnd;
    if (body?.weekStart) {
      const ws = new Date(body.weekStart);
      if (Number.isNaN(ws.getTime())) throw new BadRequestException('weekStart 无效');
      weekStart = ws;
      weekEnd =
        ws.getTime() === last.periodStart.getTime()
          ? last.periodEnd
          : settlePeriodEndFor(cycle, ws);
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
    const side = await this.periodSideMoney(
      roomId,
      room.ownerAgent?.userId,
      weekStart,
      weekEnd,
    );
    const { agentShareRate: share, generalShareRate } = this.roomShareRates(room);
    const bookMode = room.bookMode === 'CREDIT' ? 'CREDIT' : 'CASH';
    const flying = this.agentFlySplit(agg, share, generalShareRate);
    const commission = side.flyRebateToAgent;
    /* 落库记代理全部飞盘；平台那份仍只含上台 */
    const settledBetFlow = agg.agentFly.betFlow;

    const noteParts = [early ? '提前结账' : null, note?.trim() || null].filter(Boolean);

    let creditRestored = false;
    let settledHousePnl = flying.housePnl;
    let agentShareAmount = 0;
    let generalShareAmount = 0;
    let settledGeneralShareRate = generalShareRate ?? share;
    let platformShareAmount = 0;
    let settleGrossPay = 0;
    let settlePocket = 0;
    let settleFee = 0;
    let settlePay = 0;
    let paymentStatus = 'NONE';
    const creditHold: { book: CreditBookSnapshot | null } = { book: null };

    if (bookMode === 'CASH') {
      settledHousePnl = flying.housePnl;
      agentShareAmount = flying.agentShareAmount;
      generalShareAmount = flying.generalShareAmount;
      settledGeneralShareRate = flying.generalShareRate;
      platformShareAmount = flying.platformShareAmount;
      settleGrossPay = cashFlownPayToAgent(flying.agentShareAmount);
    }

    const row = await this.prisma.$transaction(async (tx) => {
      const existing = await tx.roomWeekSettle.findUnique({
        where: { roomId_weekStart: { roomId, weekStart } },
      });
      if (existing?.status === 'SETTLED') {
        throw new BadRequestException('该账期已标记结清');
      }

      /*
       * 信用盘要动额度，仍旧按「先代理后房间」加行锁。
       * 现金盘只读房间那几列、靠下面的 CAS 推进到期时间，不必占着这两把锁——
       * 占了就会跟并发的开奖派彩抢同一批代理行，实测能撞出死锁。
       */
      if (bookMode === 'CREDIT') {
        if (room.ownerAgent) {
          await lockAgentRowInTx(tx, room.ownerAgent.userId);
        }
        await tx.$queryRaw`SELECT id FROM "Room" WHERE "id" = ${roomId} FOR UPDATE`;
      }
      const roomLocked = await tx.room.findUnique({
        where: { id: roomId },
        select: {
          monthlyFee: true,
          nextBillAt: true,
          creditLimit: true,
          ownerAgentId: true,
        },
      });
      if (!roomLocked) throw new BadRequestException('房间不存在');

      /*
       * 月费：现金盘与信用盘同一套。到期时间锚在建房那一刻，
       * 第一次结账先收一笔，之后每满一个自然月收一笔；隔了几个月没结就一次补齐。
       */
      const feeAsOf = early ? new Date() : weekEnd;
      const feeDue = roomMonthlyFeeDue(
        asMoney(roomLocked.monthlyFee),
        roomLocked.nextBillAt,
        feeAsOf,
      );
      settleFee = feeDue.amount;
      if (feeDue.amount > 0 && feeDue.nextDueAt) {
        /* CAS：到期时间还停在算账用的那个值时才推进，并发下不会把同一笔收两次 */
        const advanced = await tx.room.updateMany({
          where: { id: roomId, nextBillAt: roomLocked.nextBillAt },
          data: { lastBilledAt: feeAsOf, nextBillAt: feeDue.nextDueAt },
        });
        if (advanced.count === 0) settleFee = 0;
      }

      if (bookMode === 'CASH') {
        settlePay = roundMoney(settleGrossPay - settleFee);
        if (settleFee > 0) {
          noteParts.push(
            feeDue.months > 1 ? `减月费${settleFee}（${feeDue.months}个月）` : `减月费${settleFee}`,
          );
        }
      }

      if (bookMode === 'CREDIT') {
        settledHousePnl = flying.housePnl;
        agentShareAmount = flying.agentShareAmount;
        generalShareAmount = flying.generalShareAmount;
        settledGeneralShareRate = flying.generalShareRate;
        platformShareAmount = flying.platformShareAmount;

        const grossPay = netCreditSettlePay(creditAgentFlyPayToAgent(flying), commission);

        if (room.ownerAgent) {
          const otherCredit = await tx.room.count({
            where: {
              ownerAgentId: room.ownerAgent.id,
              bookMode: 'CREDIT',
              id: { not: roomId },
              status: { not: 'CLOSED' },
            },
          });
          if (otherCredit > 0) {
            throw new BadRequestException('该代理有多间信用房，额度会串，不能在这里结账加回');
          }

          const [playerBalances, csBalances, agentRow] = await Promise.all([
            sumRoomPlayerBalances(tx, roomId),
            sumAgentCsBalances(tx, room.ownerAgent.userId),
            tx.agent.findUnique({
              where: { userId: room.ownerAgent.userId },
              select: { pointsQuota: true },
            }),
          ]);
          const creditLimit = asMoney(roomLocked.creditLimit);
          const pointsQuota = asMoney(agentRow?.pointsQuota ?? 0);
          /*
           * 额度加回按「封账那一刻」的账本算，不用点结账那一刻的实时余额。
           *
           * 账期是 00:00 自动切的，人第二天才来对账。这中间新一期已经在下注：
           * 实时余额里混着新一期的输赢，还混着已扣本金、未派彩的在飞注单
           * （下注即扣分，派彩要等开奖）。拿它算加回，等于把下一期的钱结进上一期。
           *
           * 快照就是为这件事存的（见 schema 注释），此前一直写了没读。
           * 加回额 = −封账超出；再叠加到实时额度上，封账后的输赢原样留给下一期。
           *
           * 提前结账没有快照，那一刻的「现在」就是账期终点，仍按实时值算。
           */
          const closeSnap = !early && existing?.closedAt ? existing : null;
          if (!early && !closeSnap && Date.now() - weekEnd.getTime() < CLOSE_SNAPSHOT_GRACE_MS) {
            throw new BadRequestException(
              '本期尚未封账（每小时 :07 自动封账），等封账后再结，否则额度会按当前余额算错。',
            );
          }
          const restoreDelta = closeSnap
            ? roundMoney(-asMoney(closeSnap.excessAtClose))
            : creditQuotaRestoreDelta({
                creditLimit,
                pointsQuota,
                playerBalances,
                csBalances,
              });
          const newQuota = roundMoney(pointsQuota + restoreDelta);
          creditHold.book = computeCreditBook({
            creditLimit,
            pointsQuota: closeSnap ? asMoney(closeSnap.quotaAtClose) : pointsQuota,
            playerBalances: closeSnap ? asMoney(closeSnap.playerBalancesAtClose) : playerBalances,
            csBalances: closeSnap ? asMoney(closeSnap.csBalancesAtClose) : csBalances,
            agentShareRate: share,
            generalShareRate: flying.generalShareRate,
          });
          if (restoreDelta !== 0) {
            const restoreRef = `${roomId}:${weekStart.toISOString()}`;
            await adjustCashDiskInTx(tx, this.points, {
              agentUserId: room.ownerAgent.userId,
              bookMode: 'CREDIT',
              delta: restoreDelta,
              bizType: 'SETTLE',
              remark: restoreDelta > 0
                ? `信用结账充额度 ${restoreDelta}`
                : `信用结账扣额度 ${roundMoney(-restoreDelta)}`,
              refType: 'room_week_settle',
              refId: restoreRef,
              idempotencyKey: `credit_restore:${restoreRef}`,
            });
            /* 飞上台的分在平台账上，加回/扣回必须同一笔对掉，否则会凭空多出一截可飞 */
            await this.points.creditInTx(
              tx,
              'PLATFORM',
              PLATFORM_OWNER_ID,
              roundMoney(-restoreDelta),
              'ADJUST',
              {
                remark: restoreDelta > 0
                  ? `信用结账加回代理额度 ${restoreDelta}`
                  : `信用结账收回代理额度 ${roundMoney(-restoreDelta)}`,
                refType: 'room_week_settle',
                refId: restoreRef,
                idempotencyKey: `credit_restore_plat:${restoreRef}`,
              },
            );
          }
          creditHold.book = {
            ...creditHold.book,
            newQuota,
          };
          creditRestored = true;
          settlePocket = restoreDelta;
        }

        const monthlyFeePeriod = settleFee;

        const unsettled = room.ownerAgent
          ? await sumUnsettledCreditDebt(
              tx,
              roomCreditDebtFilter({
                agentUserId: room.ownerAgent.userId,
                generalUserId: room.generalAgent?.userId ?? null,
                roomId,
              }),
            )
          : 0;

        const pay = roundMoney(grossPay - monthlyFeePeriod);
        settleGrossPay = grossPay;
        settlePay = pay;
        paymentStatus = Math.abs(pay) < 1e-9 ? 'EVEN' : 'UNPAID';

        noteParts.push(
          `上缴${creditAgentFlyPayToAgent(flying)}`,
          commission > 0 ? `加佣金${commission}` : null,
          settlePocket !== 0
            ? (settlePocket > 0 ? `充额度${settlePocket}` : `扣额度${roundMoney(-settlePocket)}`)
            : null,
          unsettled > 0 ? `欠款${unsettled}不冲` : null,
          monthlyFeePeriod > 0 ? `减月费${monthlyFeePeriod}` : null,
          pay === 0
            ? '互不找补'
            : pay > 0
              ? `实付·上家付代理${pay}（待线下交割）`
              : `实付·代理付上家${roundMoney(-pay)}（待线下交割）`,
        );
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
          generalShareRate: settledGeneralShareRate,
          betFlow: new Prisma.Decimal(roundMoney(settledBetFlow)),
          housePnl: new Prisma.Decimal(roundMoney(settledHousePnl)),
          agentShareAmount: new Prisma.Decimal(roundMoney(agentShareAmount)),
          generalShareAmount: new Prisma.Decimal(roundMoney(generalShareAmount)),
          platformShareAmount: new Prisma.Decimal(roundMoney(platformShareAmount)),
          ...settleFields,
          status: 'SETTLED',
          settledAt: new Date(),
          settledById: actor.id,
          creditRestored,
          note: noteText,
        },
        update: {
          betFlow: new Prisma.Decimal(roundMoney(settledBetFlow)),
          housePnl: new Prisma.Decimal(roundMoney(settledHousePnl)),
          agentShareAmount: new Prisma.Decimal(roundMoney(agentShareAmount)),
          generalShareAmount: new Prisma.Decimal(roundMoney(generalShareAmount)),
          platformShareAmount: new Prisma.Decimal(roundMoney(platformShareAmount)),
          ...settleFields,
          bookMode,
          agentShareRate: share,
          generalShareRate: settledGeneralShareRate,
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
      generalShareAmount,
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
    const room = await this.roomOrThrow(actor, roomId);
    await this.assertCanSettleWithAgent(actor, room);

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
