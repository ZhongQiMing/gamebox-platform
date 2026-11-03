import { BadRequestException, ForbiddenException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { asMoney } from '@gamebox/shared';
import { PrismaService } from '../../prisma/prisma.service';
import {
  isTimeRangeKey,
  SHANGHAI_TZ_OFFSET_MS,
  shanghaiRangeBounds,
  type TimeRangeKey,
} from '../../common/shanghai-range';
import { csvRow } from '../../common/utils/csv';
import { ConsoleScopeService, type ConsoleActor } from './console-scope.service';
import { roleEarning, splitHouseShare } from './share-split.helper';
import { flowViewFor, flowViewerSide, type FlowViewerSide } from './flow-scope.helper';
import { keepClosedRoomInPeriodList } from './open-room.where';
import {
  GENERAL_SHARE_SCHEDULE_SELECT,
  ROOM_AGENT_SHARE_SCHEDULE_SELECT,
  effectiveGeneralShareRate,
  scheduleFromAgent,
  scheduleFromRoom,
} from './general-share-rate.helper';
import { ADMIN_ACTION_META } from '../admin/admin-log.labels';

function formatShanghaiDt(d: Date): string {
  const sh = new Date(d.getTime() + SHANGHAI_TZ_OFFSET_MS);
  const y = sh.getUTCFullYear();
  const m = String(sh.getUTCMonth() + 1).padStart(2, '0');
  const day = String(sh.getUTCDate()).padStart(2, '0');
  const hh = String(sh.getUTCHours()).padStart(2, '0');
  const mm = String(sh.getUTCMinutes()).padStart(2, '0');
  const ss = String(sh.getUTCSeconds()).padStart(2, '0');
  return `${y}-${m}-${day} ${hh}:${mm}:${ss}`;
}

@Injectable()
export class ConsoleReportsService {
  constructor(
    private prisma: PrismaService,
    private scope: ConsoleScopeService,
  ) {}

  /**
   * 三级账本：每一级只统计「我接到的单」，与 flowViewFor 的 total 同源。
   *
   *   代理接到全部（含自己关盘） → agentFly 飞给总代 → flown 飞给平台
   *
   * 全站取数只认这一个映射。曾经并存的 reportBetHouse 只有 flown/all 两档、
   * 分不出总代那一档，会把代理自己关盘的钱算进总代的表，已删除。
   *
   * 飞盘整包：平台打给总代、打给代理的流水返水，加上注单上计提的玩家回水。
   * 总代再转给代理的那一截不重复加。
   */
  private async rebateBreakdown(from: Date, to: Date, roomIds: string[]) {
    const empty = { generalKeep: 0, agentWage: 0, playerRebate: 0, packageTotal: 0 };
    if (!roomIds.length) return empty;
    const roomFilter = Prisma.sql`AND NULLIF(b.payload->'fly'->>'roomId', '') IN (${Prisma.join(roomIds)})`;
    type LegRow = { leg: string; amt: unknown };
    type AccRow = { accrued: unknown };
    const [legs, accs] = await Promise.all([
      this.prisma.$queryRaw<LegRow[]>`
        SELECT
          CASE
            WHEN l."idempotencyKey" LIKE 'flow_rebate_general_in_%' THEN 'PLATFORM_TO_GENERAL'
            WHEN l."idempotencyKey" LIKE 'flow_rebate_agent_in_%' THEN 'PLATFORM_TO_AGENT'
            WHEN l."idempotencyKey" LIKE 'flow_rebate_down_in_%' THEN 'GENERAL_TO_AGENT'
            ELSE 'OTHER'
          END AS leg,
          COALESCE(SUM(l.amount), 0) AS amt
        FROM "PointsLedger" l
        JOIN "Bet" b ON b."id" = l."refId"
        WHERE l."refType" = 'bet'
          AND l."bizType" = 'REBATE'
          AND l.amount > 0
          AND (
            l."idempotencyKey" LIKE 'flow_rebate_general_in_%'
            OR l."idempotencyKey" LIKE 'flow_rebate_agent_in_%'
            OR l."idempotencyKey" LIKE 'flow_rebate_down_in_%'
          )
          AND b."settledAt" >= ${from}
          AND b."settledAt" < ${to}
          AND b.payload->'fly'->>'flying' = 'true'
          ${roomFilter}
        GROUP BY 1
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
          AND b.payload->'fly'->>'flying' = 'true'
          ${roomFilter}
      `,
    ]);
    const leg = (name: string) => asMoney(legs.find((row) => row.leg === name)?.amt ?? 0);
    const generalKeep = asMoney(leg('PLATFORM_TO_GENERAL') - leg('GENERAL_TO_AGENT'));
    const agentWage = asMoney(leg('PLATFORM_TO_AGENT') + leg('GENERAL_TO_AGENT'));
    const playerRebate = asMoney(accs[0]?.accrued ?? 0);
    return {
      generalKeep,
      agentWage,
      playerRebate,
      packageTotal: asMoney(generalKeep + agentWage + playerRebate),
    };
  }

  private ledgerHouse(side: FlowViewerSide): 'all' | 'flown' | 'agentFly' {
    if (side === 'PLATFORM') return 'flown';
    if (side === 'GENERAL') return 'agentFly';
    return 'all';
  }

  /**
   * 玩家上下分按房间归集：代理/客服直接上分走账本，不写充值审核单。
   * 只认玩家房账上的转入/充值、转出/下分，不含下注派彩回水。
   */
  async playerFundByRoom(roomIds: string[], from: Date, to: Date) {
    type Row = { room_id: string; up_amt: unknown; up_cnt: number; down_amt: unknown; down_cnt: number };
    const empty = { upAmount: 0, upCount: 0, downAmount: 0, downCount: 0 };
    const out = new Map<string, typeof empty>();
    if (!roomIds.length) return out;
    const rows = await this.prisma.$queryRaw<Row[]>`
      SELECT
        a."roomId" AS room_id,
        COALESCE(SUM(CASE
          WHEN l.amount > 0 AND l."bizType" IN ('TRANSFER_IN', 'RECHARGE') THEN l.amount
          ELSE 0 END), 0) AS up_amt,
        COUNT(*) FILTER (
          WHERE l.amount > 0 AND l."bizType" IN ('TRANSFER_IN', 'RECHARGE')
        )::int AS up_cnt,
        COALESCE(SUM(CASE
          WHEN l.amount < 0 AND l."bizType" IN ('TRANSFER_OUT', 'WITHDRAW') THEN -l.amount
          ELSE 0 END), 0) AS down_amt,
        COUNT(*) FILTER (
          WHERE l.amount < 0 AND l."bizType" IN ('TRANSFER_OUT', 'WITHDRAW')
        )::int AS down_cnt
      FROM "PointsLedger" l
      JOIN "PointsAccount" a ON a.id = l."accountId"
      WHERE a."ownerType" = 'PLAYER'
        AND a."roomId" IN (${Prisma.join(roomIds)})
        AND l."createdAt" >= ${from}
        AND l."createdAt" < ${to}
      GROUP BY a."roomId"
    `;
    for (const r of rows) {
      if (!r.room_id) continue;
      out.set(r.room_id, {
        upAmount: asMoney(r.up_amt),
        upCount: Number(r.up_cnt || 0),
        downAmount: asMoney(r.down_amt),
        downCount: Number(r.down_cnt || 0),
      });
    }
    return out;
  }

  /** 无房间范围时按玩家账本汇总（管理看全站 / 代理看名下玩家） */
  private async playerFundByPlayers(playerIds: string[] | null, from: Date, to: Date) {
    type Row = { up_amt: unknown; up_cnt: number; down_amt: unknown; down_cnt: number };
    const empty = { upAmount: 0, upCount: 0, downAmount: 0, downCount: 0 };
    const out = new Map<string, typeof empty>();
    if (playerIds && !playerIds.length) return out;
    const playerFilter = playerIds
      ? Prisma.sql`AND a."ownerId" IN (${Prisma.join(playerIds)})`
      : Prisma.empty;
    const rows = await this.prisma.$queryRaw<Row[]>`
      SELECT
        COALESCE(SUM(CASE
          WHEN l.amount > 0 AND l."bizType" IN ('TRANSFER_IN', 'RECHARGE') THEN l.amount
          ELSE 0 END), 0) AS up_amt,
        COUNT(*) FILTER (
          WHERE l.amount > 0 AND l."bizType" IN ('TRANSFER_IN', 'RECHARGE')
        )::int AS up_cnt,
        COALESCE(SUM(CASE
          WHEN l.amount < 0 AND l."bizType" IN ('TRANSFER_OUT', 'WITHDRAW') THEN -l.amount
          ELSE 0 END), 0) AS down_amt,
        COUNT(*) FILTER (
          WHERE l.amount < 0 AND l."bizType" IN ('TRANSFER_OUT', 'WITHDRAW')
        )::int AS down_cnt
      FROM "PointsLedger" l
      JOIN "PointsAccount" a ON a.id = l."accountId"
      WHERE a."ownerType" = 'PLAYER'
        AND l."createdAt" >= ${from}
        AND l."createdAt" < ${to}
        ${playerFilter}
    `;
    const r = rows[0];
    if (r) {
      out.set('_all', {
        upAmount: asMoney(r.up_amt),
        upCount: Number(r.up_cnt || 0),
        downAmount: asMoney(r.down_amt),
        downCount: Number(r.down_cnt || 0),
      });
    }
    return out;
  }

  private sumPlayerFund(rows: Iterable<{ upAmount: number; upCount: number; downAmount: number; downCount: number }>) {
    let upAmount = 0;
    let upCount = 0;
    let downAmount = 0;
    let downCount = 0;
    for (const r of rows) {
      upAmount = asMoney(upAmount + r.upAmount);
      upCount += r.upCount;
      downAmount = asMoney(downAmount + r.downAmount);
      downCount += r.downCount;
    }
    return { upAmount, upCount, downAmount, downCount };
  }

  private flownPrismaFilter() {
    return {
      OR: [
        { payload: { path: ['fly', 'flying'], equals: true } },
        { payload: { path: ['fly', 'flying'], equals: 'true' } },
      ],
    };
  }

  /**
   * 三级账本的 Prisma 版过滤（走 Bet 表直查、拿不到 roomBetAgg 的地方用）：
   * 平台只认飞上来的，总代认代理飞上来的（飞上台 + 自己坐庄），代理认全部。
   */
  private ledgerPrismaFilter(side: FlowViewerSide) {
    if (side === 'AGENT') return null;
    const flown = this.flownPrismaFilter().OR;
    if (side === 'PLATFORM') return { OR: flown };
    return { OR: [...flown, { payload: { path: ['fly', 'sitting'], equals: 'GENERAL' } }] };
  }

  private resolveRange(opts?: { range?: string; from?: string; to?: string }): {
    from: Date;
    to: Date;
    rangeKey: string;
  } {
    if (opts?.from && opts?.to) {
      const f = new Date(opts.from);
      const t = new Date(opts.to);
      if (Number.isNaN(f.getTime()) || Number.isNaN(t.getTime()) || t <= f) {
        throw new BadRequestException('时间范围无效');
      }
      return { from: f, to: t, rangeKey: 'custom' };
    }
    const key = isTimeRangeKey(opts?.range) ? opts!.range! : 'today';
    const [from, to] = shanghaiRangeBounds(key as TimeRangeKey);
    return { from, to, rangeKey: key };
  }

  private rangeMeta(from: Date, to: Date, rangeKey: string) {
    return {
      rangeKey,
      range: {
        from: from.toISOString(),
        to: to.toISOString(),
        fromText: formatShanghaiDt(from),
        toText: formatShanghaiDt(to),
        timezone: 'Asia/Shanghai',
      },
    };
  }

  /**
   * 房间注单归因：优先 payload.fly.roomId；无标记旧单按 APPROVED 成员兜底。
   * 经营 KPI 仅计 WON/LOST；PENDING 另计。
   */
  /**
   * 房间列表今日投注：飞上台 / 代理飞盘 / 全部，已结算 + 未开奖分开。
   * 三方各取自己该看的那一截，盈亏仍只用已开奖。
   */
  async roomDayHouseAgg(roomIds: string[], from: Date, to: Date) {
    const empty = { flow: 0, pendingFlow: 0, payout: 0, housePnl: 0, count: 0, players: new Set<string>() };
    if (!roomIds.length) return new Map<string, { flown: typeof empty; agentFly: typeof empty; all: typeof empty }>();
    /*
     * 全站两把尺，各自贯彻，不在同一个字段上混：
     * - 流水（flow / pendingFlow / count）按**下注时间**，含未开奖 —— 看今天打了多少，要实时
     * - 盈亏（payout / housePnl）按**开奖时间** —— 输赢开奖才存在，且必须跟结算单对得上
     * 所以下面已结算那组用 settledAt 取，未开奖那组仍用 createdAt。
     */
    const [flownS, flyS, allS, flownP, flyP, allP, flownW, flyW, allW] = await Promise.all([
      this.roomBetAgg(roomIds, from, to, ['WON', 'LOST'], 'flown'),
      this.roomBetAgg(roomIds, from, to, ['WON', 'LOST'], 'agentFly'),
      this.roomBetAgg(roomIds, from, to, ['WON', 'LOST'], 'all'),
      this.roomBetAgg(roomIds, from, to, ['PENDING'], 'flown'),
      this.roomBetAgg(roomIds, from, to, ['PENDING'], 'agentFly'),
      this.roomBetAgg(roomIds, from, to, ['PENDING'], 'all'),
      this.roomBetAgg(roomIds, from, to, ['WON', 'LOST'], 'flown', 'settledAt'),
      this.roomBetAgg(roomIds, from, to, ['WON', 'LOST'], 'agentFly', 'settledAt'),
      this.roomBetAgg(roomIds, from, to, ['WON', 'LOST'], 'all', 'settledAt'),
    ]);
    const pack = (
      s?: { flow: number; payout: number; count: number; players: Set<string> },
      p?: { flow: number; payout: number; count: number; players: Set<string> },
      /** 按开奖时间归期的那一份，只用来出盈亏 */
      w?: { flow: number; payout: number },
    ) => {
      const settledFlow = asMoney(s?.flow ?? 0);
      const pendingFlow = asMoney(p?.flow ?? 0);
      const drawnFlow = asMoney(w?.flow ?? 0);
      const payout = asMoney(w?.payout ?? 0);
      return {
        flow: asMoney(settledFlow + pendingFlow),
        pendingFlow,
        payout,
        housePnl: asMoney(drawnFlow - payout),
        count: (s?.count ?? 0) + (p?.count ?? 0),
        players: new Set<string>([...(s?.players ?? []), ...(p?.players ?? [])]),
      };
    };
    const byRoom = new Map<string, { flown: ReturnType<typeof pack>; agentFly: ReturnType<typeof pack>; all: ReturnType<typeof pack> }>();
    for (const roomId of roomIds) {
      byRoom.set(roomId, {
        flown: pack(flownS.byRoom.get(roomId), flownP.byRoom.get(roomId), flownW.byRoom.get(roomId)),
        agentFly: pack(flyS.byRoom.get(roomId), flyP.byRoom.get(roomId), flyW.byRoom.get(roomId)),
        all: pack(allS.byRoom.get(roomId), allP.byRoom.get(roomId), allW.byRoom.get(roomId)),
      });
    }
    return byRoom;
  }

  /**
   * 按房间拆飞上台 / 代理飞盘 / 关盘。结账专用。
   * flown：平台坐庄，总表占成用这个。
   * agentFly：代理飞上台或飞到总代，总代↔代理结账用这个。
   * 代理自己坐庄不进上面两本。
   *
   * 按**开奖时间**归期：输赢在开奖那一刻才定，派完彩这一期才算完。
   * 跨点未开奖的注不会卡在这一期，等开完奖自动落进它开奖的那一期。
   */
  async settledRoomAggByHouse(roomIds: string[], from: Date, to: Date) {
    const [flown, agentFly, all] = await Promise.all([
      this.roomBetAgg(roomIds, from, to, ['WON', 'LOST'], 'flown', 'settledAt'),
      this.roomBetAgg(roomIds, from, to, ['WON', 'LOST'], 'agentFly', 'settledAt'),
      this.roomBetAgg(roomIds, from, to, ['WON', 'LOST'], 'all', 'settledAt'),
    ]);
    const pick = (agg?: { flow: number; payout: number; count: number }) => {
      const betFlow = asMoney(agg?.flow ?? 0);
      const payout = asMoney(agg?.payout ?? 0);
      return {
        betFlow,
        payout,
        housePnl: asMoney(betFlow - payout),
        betCount: Number(agg?.count ?? 0),
      };
    };
    const byRoom = new Map<string, {
      flown: ReturnType<typeof pick>;
      agentFly: ReturnType<typeof pick>;
      generalSat: ReturnType<typeof pick>;
      closed: ReturnType<typeof pick>;
    }>();
    for (const roomId of roomIds) {
      const f = pick(flown.byRoom.get(roomId));
      const af = pick(agentFly.byRoom.get(roomId));
      const a = pick(all.byRoom.get(roomId));
      byRoom.set(roomId, {
        flown: f,
        agentFly: af,
        generalSat: {
          betFlow: asMoney(af.betFlow - f.betFlow),
          payout: asMoney(af.payout - f.payout),
          housePnl: asMoney(af.housePnl - f.housePnl),
          betCount: af.betCount - f.betCount,
        },
        closed: {
          betFlow: asMoney(a.betFlow - f.betFlow),
          payout: asMoney(a.payout - f.payout),
          housePnl: asMoney(a.housePnl - f.housePnl),
          betCount: a.betCount - f.betCount,
        },
      });
    }
    return byRoom;
  }

  private async roomBetAgg(
    roomIds: string[],
    from: Date,
    to: Date,
    statuses: Array<'WON' | 'LOST' | 'PENDING'>,
    /** flown=平台坐庄；agentFly=代理飞盘（上台或飞到总代）；all=含代理自己坐庄 */
    house: 'all' | 'flown' | 'agentFly' = 'all',
    /**
     * 注单归到哪一期：
     * - createdAt：按下注时间（经营看板用，「今天打了多少」）
     * - settledAt：按开奖时间（结账用，输赢在开奖那刻才定，派完彩这一期才算完）
     */
    timeField: 'createdAt' | 'settledAt' = 'createdAt',
  ): Promise<{
    byRoom: Map<string, { flow: number; payout: number; count: number; players: Set<string> }>;
    byGame: Array<{ gameId: string; flow: number; payout: number; count: number }>;
    total: { flow: number; payout: number; count: number };
    activePlayers: number;
    /** 注单没写房间号，认不到归属：不进任何一间房，单列出来供核对 */
    unattributed: { flow: number; payout: number; count: number };
  }> {
    const empty = {
      byRoom: new Map<string, { flow: number; payout: number; count: number; players: Set<string> }>(),
      byGame: [] as Array<{ gameId: string; flow: number; payout: number; count: number }>,
      total: { flow: 0, payout: 0, count: 0 },
      activePlayers: 0,
      unattributed: { flow: 0, payout: 0, count: 0 },
    };
    if (!roomIds.length || !statuses.length) return empty;

    type RoomRow = {
      room_id: string;
      player_id: string;
      flow: unknown;
      payout: unknown;
      cnt: number;
    };
    type GameRow = {
      game_id: string;
      flow: unknown;
      payout: unknown;
      cnt: number;
    };
    type ActiveRow = { cnt: number };

    const statusList = Prisma.join(statuses);
    const roomList = Prisma.join(roomIds);
    /* fly.flying 由下注时写入；缺字段的历史单不算飞盘 */
    const houseFilter =
      house === 'flown'
        ? Prisma.sql`AND b.payload->'fly'->>'flying' = 'true'`
        : house === 'agentFly'
          ? Prisma.sql`AND (
              b.payload->'fly'->>'flying' = 'true'
              OR b.payload->'fly'->>'sitting' = 'GENERAL'
            )`
          : Prisma.empty;

    /*
     * 归属只认注单自带的 fly.roomId，和结账口径完全一致。
     * 早先这里在缺字段时回退到「该玩家最近一次通过审核的房」，
     * 结果是：老注单在报表里有、在账单里没有；玩家换房还会改动历史报表。
     * 认不到房的注单改为单独归到 unattributed，明面上摆出来。
     */
    /*
     * 归期时间列：结账用开奖时间，经营用下注时间。
     * 未开奖的注 settledAt 为空，按开奖时间取数时天然落不进任何账期，
     * 等开完奖自动进那一期——「派完彩这一期才算完」。
     */
    const timeCol =
      timeField === 'settledAt' ? Prisma.sql`b."settledAt"` : Prisma.sql`b."createdAt"`;

    const [roomRows, gameRows, activeRows, orphanRows] = await Promise.all([
      this.prisma.$queryRaw<RoomRow[]>`
        SELECT
          NULLIF(b.payload->'fly'->>'roomId', '') AS room_id,
          b."playerId" AS player_id,
          COALESCE(SUM(b.amount), 0) AS flow,
          COALESCE(SUM(b.payout), 0) AS payout,
          COUNT(*)::int AS cnt
        FROM "Bet" b
        WHERE ${timeCol} >= ${from}
          AND ${timeCol} < ${to}
          AND b.status::text IN (${statusList})
          ${houseFilter}
          AND NULLIF(b.payload->'fly'->>'roomId', '') IN (${roomList})
        GROUP BY 1, 2
      `,
      this.prisma.$queryRaw<GameRow[]>`
        SELECT
          b."gameId" AS game_id,
          COALESCE(SUM(b.amount), 0) AS flow,
          COALESCE(SUM(b.payout), 0) AS payout,
          COUNT(*)::int AS cnt
        FROM "Bet" b
        WHERE ${timeCol} >= ${from}
          AND ${timeCol} < ${to}
          AND b.status::text IN (${statusList})
          ${houseFilter}
          AND NULLIF(b.payload->'fly'->>'roomId', '') IN (${roomList})
        GROUP BY b."gameId"
        ORDER BY SUM(b.amount) DESC NULLS LAST
        LIMIT 20
      `,
      this.prisma.$queryRaw<ActiveRow[]>`
        SELECT COUNT(DISTINCT b."playerId")::int AS cnt
        FROM "Bet" b
        WHERE ${timeCol} >= ${from}
          AND ${timeCol} < ${to}
          AND b.status::text IN (${statusList})
          ${houseFilter}
          AND NULLIF(b.payload->'fly'->>'roomId', '') IN (${roomList})
      `,
      this.prisma.$queryRaw<{ flow: unknown; payout: unknown; cnt: number }[]>`
        SELECT
          COALESCE(SUM(b.amount), 0) AS flow,
          COALESCE(SUM(b.payout), 0) AS payout,
          COUNT(*)::int AS cnt
        FROM "Bet" b
        WHERE ${timeCol} >= ${from}
          AND ${timeCol} < ${to}
          AND b.status::text IN (${statusList})
          ${houseFilter}
          AND NULLIF(b.payload->'fly'->>'roomId', '') IS NULL
          AND EXISTS (
            SELECT 1
            FROM "RoomMember" rm
            WHERE rm."playerId" = b."playerId"
              AND rm.status = 'APPROVED'
              AND rm."roomId" IN (${roomList})
          )
      `,
    ]);

    const byRoom = new Map<string, { flow: number; payout: number; count: number; players: Set<string> }>();
    let flow = 0;
    let payout = 0;
    let count = 0;
    for (const r of roomRows) {
      if (!r.room_id || !roomIds.includes(r.room_id)) continue;
      let agg = byRoom.get(r.room_id);
      if (!agg) {
        agg = { flow: 0, payout: 0, count: 0, players: new Set() };
        byRoom.set(r.room_id, agg);
      }
      const f = asMoney(r.flow);
      const p = asMoney(r.payout);
      const c = Number(r.cnt) || 0;
      agg.flow = asMoney(agg.flow + f);
      agg.payout = asMoney(agg.payout + p);
      agg.count += c;
      agg.players.add(r.player_id);
      flow = asMoney(flow + f);
      payout = asMoney(payout + p);
      count += c;
    }

    return {
      byRoom,
      byGame: gameRows.map((g) => ({
        gameId: g.game_id,
        flow: asMoney(g.flow),
        payout: asMoney(g.payout),
        count: Number(g.cnt) || 0,
      })),
      total: { flow, payout, count },
      activePlayers: Number(activeRows[0]?.cnt) || 0,
      unattributed: {
        flow: asMoney(orphanRows[0]?.flow ?? 0),
        payout: asMoney(orphanRows[0]?.payout ?? 0),
        count: Number(orphanRows[0]?.cnt) || 0,
      },
    };
  }

  /** 解析显式勾选的房间；未传则 null（沿用旧的全量/管辖口径） */
  private async resolveExplicitRoomIds(
    actor: ConsoleActor,
    opts?: { roomId?: string; roomIds?: string[] },
  ): Promise<string[] | null> {
    const raw = [
      ...(opts?.roomIds ?? []),
      ...(opts?.roomId ? [opts.roomId] : []),
    ]
      .flatMap((s) => String(s).split(','))
      .map((s) => s.trim())
      .filter(Boolean);
    if (!raw.length) return null;
    const ids = [...new Set(raw)];
    for (const id of ids) {
      await this.scope.assertRoomAccess(actor, id);
    }
    return ids;
  }

  async summary(
    actor: ConsoleActor,
    roomId?: string,
    opts?: { range?: string; from?: string; to?: string; roomIds?: string[] },
  ) {
    const { from, to, rangeKey } = this.resolveRange(opts);
    const explicitRoomIds = await this.resolveExplicitRoomIds(actor, {
      roomId,
      roomIds: opts?.roomIds,
    });

    const grantedRoomIds = explicitRoomIds ?? (await this.scope.grantedRoomIds(actor));
    /* 取数口径与下面的占成拆分共用同一个身份判定，避免两处判得不一样 */
    const generalSide = await this.scope.isGeneralSide(actor);
    const isPlatformSide = actor.role === 'ADMIN' || actor.role === 'BRANCH';

    /**
     * 注单归因房间范围：
     * - 显式 roomId(s) → 这些房间
     * - 房主 → 必须按 RoomOwnerGrant 授权房间（未授权房不进流水/盈亏）
     * - 超管无显式 → null（全站按玩家口径）
     * - 代理端无显式 → null（走管辖玩家口径）
     */
    const roomScopedIds: string[] | null =
      explicitRoomIds ??
      (actor.role === 'BRANCH'
        ? Array.isArray(grantedRoomIds)
          ? grantedRoomIds
          : []
        : null);

    // 玩家范围：房间作用域 → 成员并集；否则非超管按管辖树；超管全站不限
    const playerWhere = await this.scope.playerWhere(actor);
    let playerIds: string[] | null = null;

    if (roomScopedIds) {
      if (!roomScopedIds.length) {
        return {
          ...this.rangeMeta(from, to, rangeKey),
          roomCount: 0,
          betFlow: 0,
          payout: 0,
          housePnl: 0,
          playerPnl: 0,
          betCount: 0,
          flownBetFlow: 0,
          flownPayout: 0,
          flownHousePnl: 0,
          flownBetCount: 0,
          upAmount: 0,
          upCount: 0,
          downAmount: 0,
          downCount: 0,
          pendingUp: 0,
          pendingDown: 0,
          pendingBetFlow: 0,
          pendingBetCount: 0,
          activePlayers: 0,
          playerCount: 0,
          commissionAmount: 0,
          commissionCount: 0,
          platformShareAmount: 0,
          netChange: 0,
          netPnl: 0,
          rebatePackage: 0,
          realNetEarning: 0,
          byGame: [],
        };
      }
      const members = await this.prisma.roomMember.findMany({
        where: { roomId: { in: roomScopedIds }, status: 'APPROVED' },
        select: { playerId: true },
      });
      playerIds = [...new Set(members.map((m) => m.playerId))];
    } else if (actor.role !== 'ADMIN') {
      const players = await this.prisma.user.findMany({
        where: playerWhere,
        select: { id: true },
        take: 50_000,
      });
      playerIds = players.map((p) => p.id);
    }

    // 挂靠佣金=代理支出：下级玩家流水打给「玩家推荐人」；按产生流水的玩家范围统计
    const commissionWhere: Record<string, unknown> = {
      settledAt: { gte: from, lt: to },
      beneficiary: { role: 'PLAYER' },
    };
    if (playerIds) {
      commissionWhere.sourceUserId = {
        in: playerIds.length ? playerIds : ['__none__'],
      };
    }

    let betFlow = 0;
    let payout = 0;
    /** 按开奖时间归期的投注额，只用来配 payout 出盈亏 */
    let drawnFlow = 0;
    let betCount = 0;
    /* 下面 if/else 两个分支都会赋值，这里不给初值避免掩盖漏赋值 */
    let pendingBetFlow: number;
    let pendingBetCount: number;
    let activePlayers: number;
    /* 注单没写房间号：不摊进任何一间房，单独摆出来提示排查 */
    let unattributedBetFlow = 0;
    let unattributedBetCount = 0;
    let byGame: Array<{
      gameCode: string;
      gameName: string;
      betCount: number;
      betFlow: number;
      payout: number;
      housePnl: number;
    }>;

    if (roomScopedIds) {
      const house = this.ledgerHouse(
        flowViewerSide({ isPlatformSide, isGeneralSide: generalSide }),
      );
      /* 流水按下注时间（含未开奖），盈亏按开奖时间——与 roomDayHouseAgg 同一套规矩 */
      const [settled, pending, drawn] = await Promise.all([
        this.roomBetAgg(roomScopedIds, from, to, ['WON', 'LOST'], house),
        this.roomBetAgg(roomScopedIds, from, to, ['PENDING'], house),
        this.roomBetAgg(roomScopedIds, from, to, ['WON', 'LOST'], house, 'settledAt'),
      ]);
      betFlow = settled.total.flow;
      payout = drawn.total.payout;
      drawnFlow = drawn.total.flow;
      betCount = settled.total.count;
      pendingBetFlow = pending.total.flow;
      pendingBetCount = pending.total.count;
      activePlayers = settled.activePlayers;
      unattributedBetFlow = asMoney(settled.unattributed.flow + pending.unattributed.flow);
      unattributedBetCount = settled.unattributed.count + pending.unattributed.count;
      const gameIds = settled.byGame.map((g) => g.gameId);
      const games = gameIds.length
        ? await this.prisma.game.findMany({
            where: { id: { in: gameIds } },
            select: { id: true, code: true, name: true },
          })
        : [];
      const gameMap = new Map(games.map((g) => [g.id, g]));
      byGame = settled.byGame.map((g) => {
        const meta = gameMap.get(g.gameId);
        return {
          gameCode: meta?.code ?? g.gameId,
          gameName: meta?.name ?? meta?.code ?? g.gameId,
          betCount: g.count,
          betFlow: g.flow,
          payout: g.payout,
          housePnl: asMoney(g.flow - g.payout),
        };
      });
    } else {
      /* 与 roomScoped 分支同一套账本口径，总代不能再落到「全部」 */
      const flownOnly = this.ledgerPrismaFilter(
        flowViewerSide({ isPlatformSide, isGeneralSide: generalSide }),
      );
      const settledWhere: Record<string, unknown> = {
        createdAt: { gte: from, lt: to },
        status: { in: ['WON', 'LOST'] },
        ...(flownOnly ? { AND: [flownOnly] } : {}),
      };
      const pendingWhere: Record<string, unknown> = {
        createdAt: { gte: from, lt: to },
        status: 'PENDING',
        ...(flownOnly ? { AND: [flownOnly] } : {}),
      };
      /* 盈亏那一份按开奖时间归期，与 roomScoped 分支同一套规矩 */
      const drawnWhere: Record<string, unknown> = {
        settledAt: { gte: from, lt: to },
        status: { in: ['WON', 'LOST'] },
        ...(flownOnly ? { AND: [flownOnly] } : {}),
      };
      if (playerIds) {
        const filter = { in: playerIds.length ? playerIds : ['__none__'] };
        settledWhere['playerId'] = filter;
        pendingWhere['playerId'] = filter;
        drawnWhere['playerId'] = filter;
      }

      const [bets, pendingAgg, activeRaw, byGameRaw, drawnAgg] = await Promise.all([
        this.prisma.bet.groupBy({
          by: ['status'],
          where: settledWhere,
          _sum: { amount: true, payout: true },
          _count: true,
        }),
        this.prisma.bet.aggregate({
          where: pendingWhere,
          _sum: { amount: true },
          _count: true,
        }),
        this.prisma.bet.findMany({
          where: settledWhere,
          select: { playerId: true },
          distinct: ['playerId'],
        }),
        this.prisma.bet.groupBy({
          by: ['gameId'],
          where: settledWhere,
          _sum: { amount: true, payout: true },
          _count: true,
          orderBy: { _sum: { amount: 'desc' } },
          take: 20,
        }),
        this.prisma.bet.aggregate({
          where: drawnWhere,
          _sum: { amount: true, payout: true },
        }),
      ]);

      for (const b of bets) {
        betFlow += asMoney(b._sum.amount ?? 0);
        betCount += b._count;
      }
      drawnFlow = asMoney(drawnAgg._sum.amount ?? 0);
      payout = asMoney(drawnAgg._sum.payout ?? 0);
      pendingBetFlow = asMoney(pendingAgg._sum.amount ?? 0);
      pendingBetCount = pendingAgg._count;
      activePlayers = activeRaw.length;

      const gameIds = byGameRaw.map((g) => g.gameId);
      const games = gameIds.length
        ? await this.prisma.game.findMany({
            where: { id: { in: gameIds } },
            select: { id: true, code: true, name: true },
          })
        : [];
      const gameMap = new Map(games.map((g) => [g.id, g]));
      byGame = byGameRaw.map((g) => {
        const sum = g._sum ?? { amount: 0, payout: 0 };
        const flow = asMoney(sum.amount ?? 0);
        const pay = asMoney(sum.payout ?? 0);
        const meta = gameMap.get(g.gameId);
        return {
          gameCode: meta?.code ?? g.gameId,
          gameName: meta?.name ?? meta?.code ?? g.gameId,
          betCount: typeof g._count === 'number' ? g._count : 0,
          betFlow: flow,
          payout: pay,
          housePnl: flow - pay,
        };
      });
    }

    /* 盈亏两边都按开奖时间，别拿下注时间的流水去减开奖时间的派彩 */
    const housePnl = asMoney(drawnFlow - payout);

    const fundRooms = roomScopedIds ?? [];
    const [fundByRoom, pendingUp, pendingDown, commissionAgg] = await Promise.all([
      fundRooms.length
        ? this.playerFundByRoom(fundRooms, from, to)
        : this.playerFundByPlayers(playerIds, from, to),
      this.prisma.rechargeOrder.count({
        where: {
          type: 'UP',
          status: 'PENDING',
          ...(playerIds ? { playerId: { in: playerIds.length ? playerIds : ['__none__'] } } : {}),
        },
      }),
      this.prisma.rechargeOrder.count({
        where: {
          type: 'DOWN',
          status: 'PENDING',
          ...(playerIds ? { playerId: { in: playerIds.length ? playerIds : ['__none__'] } } : {}),
        },
      }),
      this.prisma.commissionRecord.aggregate({
        where: commissionWhere,
        _sum: { amount: true },
        _count: true,
      }),
    ]);

    const roomCount =
      roomScopedIds != null
        ? roomScopedIds.length
        : grantedRoomIds === null
          ? await this.prisma.room.count()
          : grantedRoomIds.length;

    const fund = this.sumPlayerFund(fundByRoom.values());
    const upAmount = fund.upAmount;
    const downAmount = fund.downAmount;
    const playerPnl = payout - betFlow;
    const commissionAmount = asMoney(commissionAgg._sum.amount ?? 0);

    /*
     * 占成拆分（只算飞盘，关盘自负不进）：
     * - 管理/总监看平台那份（100% − 总代成数）
     * - 总代看自己的成数差（总代成数 − 代理成数），不是整房盈亏，否则数字比实收大一截
     * - 代理端按整房庄家盈亏，并扣掉挂靠佣金——那笔确实是他自己出的
     */
    let platformShareAmount = asMoney(housePnl);
    let netPnl = asMoney(housePnl - commissionAmount);

    const shareRoomIds =
      roomScopedIds ??
      (grantedRoomIds === null
        ? (
            await this.prisma.room.findMany({
              select: { id: true },
              take: 50_000,
            })
          ).map((r) => r.id)
        : grantedRoomIds);

    /*
     * 两套口径分开取，别混：
     * - 结账口径（flownShare / agentFlyShare）按开奖时间，跟账单一致；派完彩才算这一期。
     * - 经营口径（带 Live 后缀）按下注时间且含未开奖，跟房间列表「今日流水」一致。
     */
    const [
      flownLiveAgg,
      agentFlyLiveAgg,
      flownPending,
      agentFlyPending,
      flownShare,
      agentFlyShare,
      allShare,
    ] = shareRoomIds.length
      ? await Promise.all([
          this.roomBetAgg(shareRoomIds, from, to, ['WON', 'LOST'], 'flown'),
          this.roomBetAgg(shareRoomIds, from, to, ['WON', 'LOST'], 'agentFly'),
          this.roomBetAgg(shareRoomIds, from, to, ['PENDING'], 'flown'),
          this.roomBetAgg(shareRoomIds, from, to, ['PENDING'], 'agentFly'),
          this.roomBetAgg(shareRoomIds, from, to, ['WON', 'LOST'], 'flown', 'settledAt'),
          this.roomBetAgg(shareRoomIds, from, to, ['WON', 'LOST'], 'agentFly', 'settledAt'),
          /* 代理自己关盘那截 = all − agentFly，算代理净赚要用 */
          this.roomBetAgg(shareRoomIds, from, to, ['WON', 'LOST'], 'all', 'settledAt'),
        ])
      : [null, null, null, null, null, null, null];
    const flownBetFlow = asMoney(flownShare?.total.flow ?? 0);
    const flownPayout = asMoney(flownShare?.total.payout ?? 0);
    const flownHousePnl = asMoney(flownBetFlow - flownPayout);
    const flownBetCount = Number(flownShare?.total.count ?? 0);
    const agentFlyBetFlow = asMoney(agentFlyShare?.total.flow ?? 0);
    const agentFlyPayout = asMoney(agentFlyShare?.total.payout ?? 0);
    const agentFlyHousePnl = asMoney(agentFlyBetFlow - agentFlyPayout);
    const flownBetFlowLive = asMoney(
      asMoney(flownLiveAgg?.total.flow ?? 0) + asMoney(flownPending?.total.flow ?? 0),
    );
    const agentFlyBetFlowLive = asMoney(
      asMoney(agentFlyLiveAgg?.total.flow ?? 0) + asMoney(agentFlyPending?.total.flow ?? 0),
    );
    const allBetFlowLive = asMoney(betFlow + pendingBetFlow);
    /* 三方口径只有 flowViewFor 一个出处，页面与单测共用 */
    const closedBetFlow = flowViewFor(
      flowViewerSide({ isPlatformSide, isGeneralSide: generalSide }),
      { flown: flownBetFlowLive, agentFly: agentFlyBetFlowLive, all: allBetFlowLive },
    ).closed;

    /*
     * 三方净赚同一个出处：roleEarning。
     * 每个角色只认「自己坐庄那截 + 自己分到那份」，下家关盘的钱不进上家的账，
     * 三方净赚相加恒等于三种坐庄的输赢总和（有单测守着）。
     */
    const viewerSide = flowViewerSide({ isPlatformSide, isGeneralSide: generalSide });
    let satHousePnl = 0;
    let myShareAmount = 0;
    let myNetEarning = 0;
    if (flownShare && agentFlyShare && allShare) {
      const shareRooms = await this.prisma.room.findMany({
        where: { id: { in: shareRoomIds } },
        select: {
          id: true,
          ...ROOM_AGENT_SHARE_SCHEDULE_SELECT,
          generalAgent: { select: GENERAL_SHARE_SCHEDULE_SELECT },
        },
      });
      const houseOf = (
        agg?: { flow: number; payout: number },
      ) => asMoney(asMoney(agg?.flow ?? 0) - asMoney(agg?.payout ?? 0));
      const earning = roleEarning(
        viewerSide,
        shareRooms.map((room) => {
          const flownPnl = houseOf(flownShare.byRoom.get(room.id));
          const agentFlyPnl = houseOf(agentFlyShare.byRoom.get(room.id));
          const allPnl = houseOf(allShare.byRoom.get(room.id));
          return {
            flownHousePnl: flownPnl,
            generalSatHousePnl: asMoney(agentFlyPnl - flownPnl),
            agentSatHousePnl: asMoney(allPnl - agentFlyPnl),
            agentShareRate: effectiveGeneralShareRate(scheduleFromRoom(room), from),
            generalShareRate: room.generalAgent
              ? effectiveGeneralShareRate(scheduleFromAgent(room.generalAgent), from)
              : null,
          };
        }),
        commissionAmount,
      );
      satHousePnl = earning.satHousePnl;
      myShareAmount = earning.myShareAmount;
      myNetEarning = earning.netEarning;
    }

    if (isPlatformSide || generalSide) {
      platformShareAmount = myShareAmount;
      /*
       * 挂靠佣金由房间代理自己出，平台一分没掏，所以不从平台/总代这份里扣。
       * 它仍单独作为「代理支出」展示，见 commissionAmount。
       */
      netPnl = asMoney(platformShareAmount);
    }

    /*
     * 平台真正盈亏 = 飞盘庄家盈亏 − 整包返水。
     * 整包 = 总代实发 + 代理实发 + 玩家回水。玩家回水输掉会进庄家盈亏，
     * 减掉之后那一截对掉；总代和代理的返水留在他们账户上，是平台垫出去的。
     */
    const rebate = await this.rebateBreakdown(from, to, shareRoomIds);
    const rebatePackage = rebate.packageTotal;
    const rebateGeneral = rebate.generalKeep;
    const rebateAgent = rebate.agentWage;
    const rebatePlayer = rebate.playerRebate;
    const realNetEarning = isPlatformSide
      ? asMoney(satHousePnl - rebatePackage)
      : generalSide
        ? asMoney(myNetEarning + rebateGeneral)
        : myNetEarning;

    return {
      ...this.rangeMeta(from, to, rangeKey),
      roomCount,
      betFlow,
      payout,
      housePnl,
      playerPnl,
      betCount,
      /** 平台坐庄部分（占成基数）：关盘由代理/总代自负，不含在内 */
      flownBetFlow,
      flownPayout,
      flownHousePnl,
      flownBetCount,
      agentFlyBetFlow,
      /** 代理飞盘（上台 + 飞到总代）：房间结算单的口径 */
      agentFlyPayout,
      agentFlyHousePnl,
      /** 经营展示：已结 + 未开奖，跟房间列表今日流水对齐 */
      flownBetFlowLive,
      agentFlyBetFlowLive,
      closedBetFlow,
      upAmount,
      upCount: fund.upCount,
      downAmount,
      downCount: fund.downCount,
      pendingUp,
      pendingDown,
      /** 未结算注单（不计入流水/盈亏 KPI） */
      pendingBetFlow,
      pendingBetCount,
      /** 注单缺房间号，报表与账单都不认；>0 说明有单需要排查 */
      unattributedBetFlow,
      unattributedBetCount,
      activePlayers,
      playerCount: playerIds?.length ?? null,
      commissionAmount,
      commissionCount: commissionAgg._count,
      /** 管理/总监=平台那份；总代=自己的成数差；代理=整房庄家盈亏 */
      platformShareAmount,
      /* ── 三方统一口径：工作台/报表的「我的」那几格都读这三个 ── */
      /** 我自己坐庄那部分的毛输赢 */
      satHousePnl,
      /** 我分到的那份：平台=平台占成；总代=成数差+坐庄留存；代理=飞出去部分的占成 */
      myShareAmount,
      /** 我今日净赚：代理还要再扣挂靠佣金 */
      myNetEarning,
      /** 整包返水：总代实发 + 代理实发 + 玩家回水 */
      rebatePackage,
      /** 总代自己留下的返水 */
      rebateGeneral,
      /** 代理收到的返水 */
      rebateAgent,
      /** 玩家回水，含未领 */
      rebatePlayer,
      /** 平台：庄家盈亏 − 整包。总代：占成 + 自己的返水。代理仍是占成净赚 */
      realNetEarning,
      shareBasis:
        actor.role === 'ADMIN' || actor.role === 'BRANCH'
          ? ('PLATFORM' as const)
          : generalSide
            ? ('GENERAL_DIFF' as const)
            : ('HOUSE' as const),
      /** 资金净变动 ≈ 上分 - 下分 + 玩家盈亏 */
      netChange: asMoney(upAmount - downAmount + playerPnl),
      /** 各自口径的占成 − 代理佣金 */
      netPnl,
      byGame,
    };
  }

  /**
   * 房间注单明细（逐笔）：归因同 roomBetAgg。
   */
  async listRoomBets(
    actor: ConsoleActor,
    roomId: string,
    opts?: {
      range?: string;
      from?: string;
      to?: string;
      page?: number;
      pageSize?: number;
      playerId?: string;
      gameCode?: string;
    },
  ) {
    await this.scope.assertRoomAccess(actor, roomId);
    const { from, to, rangeKey } = this.resolveRange(opts);
    const page = Math.max(1, Number(opts?.page) || 1);
    const pageSize = Math.min(50, Math.max(1, Number(opts?.pageSize) || 30));
    const offset = (page - 1) * pageSize;
    const playerId = opts?.playerId?.trim() || '';
    const gameCode = opts?.gameCode?.trim() || '';
    if (playerId && actor.role !== 'ADMIN') {
      await this.scope.assertUserInScope(actor, playerId);
    }
    const playerFilter = playerId
      ? Prisma.sql`AND b."playerId" = ${playerId}`
      : Prisma.empty;
    const gameFilter = gameCode
      ? Prisma.sql`AND EXISTS (
          SELECT 1 FROM "Game" g
          WHERE g.id = b."gameId" AND g.code = ${gameCode}
        )`
      : Prisma.empty;
    /* 三级账本：总代只看代理飞上来的，别把代理自己关盘的注单也列出来 */
    const betsSide = flowViewerSide({
      isPlatformSide: actor.role === 'ADMIN' || actor.role === 'BRANCH',
      isGeneralSide: await this.scope.isGeneralSide(actor),
    });
    const houseFilter =
      betsSide === 'PLATFORM'
        ? Prisma.sql`AND b.payload->'fly'->>'flying' = 'true'`
        : betsSide === 'GENERAL'
          ? Prisma.sql`AND (
              b.payload->'fly'->>'flying' = 'true'
              OR b.payload->'fly'->>'sitting' = 'GENERAL'
            )`
          : Prisma.empty;

    type BetRow = {
      id: string;
      bet_no: string;
      player_id: string;
      game_id: string;
      bet_type: string | null;
      amount: unknown;
      payout: unknown;
      status: string;
      created_at: Date;
      settled_at: Date | null;
    };

    /*
     * 归属与状态都跟聚合、结算对齐：只认注单自带的 fly.roomId，且排除已取消。
     * 早先这里对缺 roomId 的单用 RoomMember 兜底、又不过滤 CANCELLED，
     * 于是同一间房的「注单明细」比「流水」多出一截，对账时永远差一点。
     */
    const [countRows, rows] = await Promise.all([
      this.prisma.$queryRaw<Array<{ cnt: number }>>`
        SELECT COUNT(*)::int AS cnt
        FROM "Bet" b
        WHERE b."createdAt" >= ${from}
          AND b."createdAt" < ${to}
          AND b.status <> 'CANCELLED'
          AND NULLIF(b.payload->'fly'->>'roomId', '') = ${roomId}
          ${playerFilter}
          ${gameFilter}
          ${houseFilter}
      `,
      this.prisma.$queryRaw<BetRow[]>`
        SELECT
          b.id,
          b."betNo" AS bet_no,
          b."playerId" AS player_id,
          b."gameId" AS game_id,
          b."betType" AS bet_type,
          b.amount,
          b.payout,
          b.status::text AS status,
          b."createdAt" AS created_at,
          b."settledAt" AS settled_at
        FROM "Bet" b
        WHERE b."createdAt" >= ${from}
          AND b."createdAt" < ${to}
          AND b.status <> 'CANCELLED'
          AND NULLIF(b.payload->'fly'->>'roomId', '') = ${roomId}
          ${playerFilter}
          ${gameFilter}
          ${houseFilter}
        ORDER BY b."createdAt" DESC
        LIMIT ${pageSize} OFFSET ${offset}
      `,
    ]);

    const total = Number(countRows[0]?.cnt ?? 0);
    const playerIds = [...new Set(rows.map((r) => r.player_id))];
    const gameIds = [...new Set(rows.map((r) => r.game_id))];
    const [players, games] = await Promise.all([
      playerIds.length
        ? this.prisma.user.findMany({
            where: { id: { in: playerIds } },
            select: { id: true, uid: true, nickname: true, username: true },
          })
        : Promise.resolve([]),
      gameIds.length
        ? this.prisma.game.findMany({
            where: { id: { in: gameIds } },
            select: { id: true, code: true, name: true },
          })
        : Promise.resolve([]),
    ]);
    const playerMap = new Map(players.map((p) => [p.id, p]));
    const gameMap = new Map(games.map((g) => [g.id, g]));

    return {
      ...this.rangeMeta(from, to, rangeKey),
      total,
      page,
      pageSize,
      list: rows.map((r) => {
        const amount = asMoney(r.amount);
        const payout = asMoney(r.payout);
        const player = playerMap.get(r.player_id);
        const game = gameMap.get(r.game_id);
        return {
          id: r.id,
          betNo: r.bet_no,
          playerId: r.player_id,
          playerNickname: player?.nickname ?? '—',
          playerUid: player?.uid ?? null,
          playerUsername: player?.username ?? null,
          gameCode: game?.code ?? r.game_id,
          gameName: game?.name ?? game?.code ?? r.game_id,
          betType: r.bet_type,
          amount,
          payout,
          playerPnl: asMoney(payout - amount),
          status: r.status,
          createdAt: r.created_at,
          settledAt: r.settled_at,
        };
      }),
    };
  }

  /**
   * 分房间报表：流水按 fly.roomId（旧单成员兜底）；上下分仍按房间成员；佣金按房主代理。
   * 流水/派彩/盈亏仅计已结算（WON/LOST）。
   */
  async byRoom(
    actor: ConsoleActor,
    opts?: { range?: string; from?: string; to?: string; roomId?: string; roomIds?: string[] },
  ) {
    const { from, to, rangeKey } = this.resolveRange(opts);
    const explicit = await this.resolveExplicitRoomIds(actor, opts);

    const granted = await this.scope.grantedRoomIds(actor);
    let roomIds: string[];
    if (explicit) {
      roomIds = explicit;
    } else if (granted === null) {
      const all = await this.prisma.room.findMany({
        select: { id: true },
        orderBy: { roomNo: 'asc' },
      });
      roomIds = all.map((r) => r.id);
    } else {
      roomIds = granted;
    }

    if (!roomIds.length) {
      return { ...this.rangeMeta(from, to, rangeKey), list: [] as const };
    }

    const rooms = await this.prisma.room.findMany({
      where: { id: { in: roomIds } },
      select: {
        id: true,
        roomNo: true,
        name: true,
        status: true,
        ...ROOM_AGENT_SHARE_SCHEDULE_SELECT,
        ownerAgent: {
          select: {
            userId: true,
            user: { select: { nickname: true, username: true } },
          },
        },
        /* 挂了总代就要三段拆，否则本表的平台占成会把成数差算进平台，与 summary 对不上 */
        generalAgent: { select: GENERAL_SHARE_SCHEDULE_SELECT },
      },
      orderBy: { roomNo: 'asc' },
    });

    const members = await this.prisma.roomMember.findMany({
      where: { roomId: { in: roomIds }, status: 'APPROVED' },
      select: { roomId: true, playerId: true },
    });
    const roomPlayers = new Map<string, string[]>();
    const allPlayerIds = new Set<string>();
    for (const m of members) {
      const arr = roomPlayers.get(m.roomId) ?? [];
      arr.push(m.playerId);
      roomPlayers.set(m.roomId, arr);
      allPlayerIds.add(m.playerId);
    }

    const playerIdList = [...allPlayerIds];
    const playerToRoom = new Map<string, string>();
    for (const m of members) {
      if (!playerToRoom.has(m.playerId)) playerToRoom.set(m.playerId, m.roomId);
    }

    const generalSide = await this.scope.isGeneralSide(actor);
    const byRoomSide = flowViewerSide({
      isPlatformSide: actor.role === 'ADMIN' || actor.role === 'BRANCH',
      isGeneralSide: generalSide,
    });
    const [dayHouse, flownBets, fundByRoom, commissions] = await Promise.all([
      /* 经营展示：按下注时间、含未开奖 */
      this.roomDayHouseAgg(roomIds, from, to),
      /* 占成基数：按开奖时间，跟结算单同一把尺 */
      this.roomBetAgg(roomIds, from, to, ['WON', 'LOST'], 'flown', 'settledAt'),
      this.playerFundByRoom(roomIds, from, to),
      // 挂靠佣金按产生流水的玩家归属房间（代理支出给玩家推荐人）
      playerIdList.length
        ? this.prisma.commissionRecord.groupBy({
            by: ['sourceUserId'],
            where: {
              settledAt: { gte: from, lt: to },
              sourceUserId: { in: playerIdList },
              beneficiary: { role: 'PLAYER' },
            },
            _sum: { amount: true },
            _count: true,
          })
        : Promise.resolve([] as { sourceUserId: string; _sum: { amount: unknown }; _count: number }[]),
    ]);
    const commissionByRoom = new Map<string, { amount: number; count: number }>();
    for (const c of commissions) {
      const rid = playerToRoom.get(c.sourceUserId);
      if (!rid) continue;
      const prev = commissionByRoom.get(rid) ?? { amount: 0, count: 0 };
      prev.amount = asMoney(prev.amount + asMoney(c._sum.amount ?? 0));
      prev.count += c._count;
      commissionByRoom.set(rid, prev);
    }

    const list = rooms.map((room) => {
      const pids = roomPlayers.get(room.id) ?? [];
      const houses = dayHouse.get(room.id);
      /* 与 view.total 同一口径：总代只统计代理飞上来的，代理自己关盘的不算进来 */
      const pick = houses?.[this.ledgerHouse(byRoomSide)];
      const betFlow = asMoney((pick?.flow ?? 0) - (pick?.pendingFlow ?? 0));
      const pendingBetFlow = asMoney(pick?.pendingFlow ?? 0);
      const payout = asMoney(pick?.payout ?? 0);
      const betCount = pick?.count ?? 0;
      /* 三方口径只有 flowViewFor 一个出处，页面与单测共用 */
      const view = flowViewFor(
        byRoomSide,
        {
          flown: asMoney(houses?.flown.flow ?? 0),
          agentFly: asMoney(houses?.agentFly.flow ?? 0),
          all: asMoney(houses?.all.flow ?? 0),
        },
      );
      const flownBetFlow = view.flying;
      const closedBetFlow = view.closed;
      const fund = fundByRoom.get(room.id) ?? { upAmount: 0, upCount: 0, downAmount: 0, downCount: 0 };
      const upAmount = fund.upAmount;
      const upCount = fund.upCount;
      const downAmount = fund.downAmount;
      const downCount = fund.downCount;
      const housePnl = asMoney(pick?.housePnl ?? betFlow - payout);
      const playerPnl = asMoney(payout - betFlow);
      const flownAgg = flownBets.byRoom.get(room.id);
      const flownHousePnl = asMoney(
        asMoney(flownAgg?.flow ?? 0) - asMoney(flownAgg?.payout ?? 0),
      );
      /* 与 summary()/结算单同一个拆分函数，避免同一间房在两张表上占成对不上 */
      const agentShareRate = effectiveGeneralShareRate(scheduleFromRoom(room), from);
      const { agentShareAmount, generalShareAmount, platformShareAmount } = splitHouseShare(
        flownHousePnl,
        agentShareRate,
        room.generalAgent
          ? effectiveGeneralShareRate(scheduleFromAgent(room.generalAgent), from)
          : null,
      );
      const commissionAmount = commissionByRoom.get(room.id)?.amount ?? 0;
      const commissionCount = commissionByRoom.get(room.id)?.count ?? 0;
      return {
        roomId: room.id,
        roomNo: room.roomNo,
        name: room.name,
        status: room.status,
        agentNickname: room.ownerAgent?.user?.nickname ?? null,
        agentUsername: room.ownerAgent?.user?.username ?? null,
        memberCount: pids.length,
        activePlayers: pick?.players.size ?? 0,
        betCount,
        betFlow,
        pendingBetFlow,
        payout,
        housePnl,
        playerPnl,
        flownBetFlow,
        closedBetFlow,
        flownHousePnl,
        agentShareRate,
        agentShareAmount,
        /** 挂总代时总代那份；直挂房恒为 0。三段相加 = flownHousePnl */
        generalShareAmount,
        platformShareAmount,
        upAmount,
        upCount,
        downAmount,
        downCount,
        commissionAmount,
        commissionCount,
        /** 平台净盈亏 = 平台占成；挂靠佣金是代理自己出的，不从这里扣 */
        netPnl: platformShareAmount,
        netChange: asMoney(upAmount - downAmount + playerPnl),
      };
    });

    const visible = list.filter(keepClosedRoomInPeriodList);

    // 有流水/资金的房间排前，其余按房号
    visible.sort((a, b) => {
      const score = (x: typeof a) => Math.abs(x.betFlow) + Math.abs(x.upAmount) + Math.abs(x.downAmount);
      const d = score(b) - score(a);
      if (d !== 0) return d;
      return a.roomNo.localeCompare(b.roomNo);
    });

    return {
      ...this.rangeMeta(from, to, rangeKey),
      list: visible,
    };
  }

  /**
   * 日对账快照（上海自然日）：
   * 期末余额 ≈ 期初余额 + 上分 - 下分 + 玩家游戏盈亏（派彩-流水）
   * 期初用账本在日界前的余额推算：期末 - 今日净变动。
   */
  async reconcile(actor: ConsoleActor) {
    const summary = await this.summary(actor);
    const playerWhere = await this.scope.playerWhere(actor);
    const players = await this.prisma.user.findMany({
      where: playerWhere,
      select: { id: true },
      take: 50_000,
    });
    const ids = players.map((p) => p.id);
    if (!ids.length) {
      return {
        playerCount: 0,
        balanceSum: 0,
        openingEstimate: 0,
        upAmount: 0,
        downAmount: 0,
        playerPnl: 0,
        closingCheck: 0,
        formula: 'opening + up - down + playerPnl ≈ closing',
      };
    }
    const accs = await this.prisma.pointsAccount.findMany({
      where: { ownerId: { in: ids }, ownerType: 'PLAYER' },
      select: { balance: true },
    });
    let balanceSum = 0;
    for (const a of accs) balanceSum += asMoney(a.balance);
    const upAmount = summary.upAmount;
    const downAmount = summary.downAmount;
    const playerPnl = summary.playerPnl;
    const openingEstimate = balanceSum - upAmount + downAmount - playerPnl;
    const closingCheck = openingEstimate + upAmount - downAmount + playerPnl;
    return {
      playerCount: ids.length,
      balanceSum,
      openingEstimate,
      upAmount,
      downAmount,
      playerPnl,
      closingCheck,
      drift: Math.round((closingCheck - balanceSum) * 100) / 100,
      formula: 'opening + up - down + playerPnl ≈ closing',
      range: summary.range,
    };
  }

  /** 导出中文可读 CSV（Excel 友好：UTF-8 BOM + 中文表头） */
  async exportSummaryCsv(
    actor: ConsoleActor,
    roomId?: string,
    opts?: { range?: string; from?: string; to?: string; roomIds?: string[] },
  ) {
    const [s, byRoom] = await Promise.all([
      this.summary(actor, roomId, opts),
      this.byRoom(actor, { ...opts, roomId }),
    ]);

    const fromText = s.range.fromText || s.range.from;
    const toText = s.range.toText || s.range.to;
    // 整段写进一格，避免 Excel 把日期拆到窄列里显示成 ######
    const lines = [
      csvRow(['报表区间（上海时间）', `${fromText} 至 ${toText}`]),
      csvRow([
        '说明',
        '只算飞盘（平台坐庄）。关盘自负，不进流水/派彩/盈亏/占成；净盈亏=平台占成，挂靠佣金由代理自己出、不从中扣',
      ]),
      '',
      csvRow([
        '房号',
        '房间名',
        '状态',
        '代理',
        '流水',
        '派彩',
        '庄家盈亏',
        '玩家盈亏',
        '代理佣金',
        '平台占成',
        '净盈亏',
        '注单数',
        '活跃玩家',
        '成员数',
      ]),
      csvRow([
        '合计',
        '',
        '',
        '',
        s.betFlow,
        s.payout,
        s.housePnl,
        s.playerPnl,
        s.commissionAmount,
        s.platformShareAmount ?? '',
        s.netPnl,
        s.betCount,
        s.activePlayers ?? '',
        s.playerCount ?? '',
      ]),
      ...byRoom.list.map((r) => {
        const statusMap: Record<string, string> = {
          OPEN: '营业',
          MAINTENANCE: '维护',
          FROZEN: '冻结',
          CLOSED: '关闭',
        };
        return csvRow([
          r.roomNo,
          r.name,
          statusMap[r.status] || r.status,
          r.agentNickname || r.agentUsername || '',
          r.betFlow,
          r.payout,
          r.housePnl,
          r.playerPnl,
          r.commissionAmount,
          r.platformShareAmount,
          r.netPnl,
          r.betCount,
          r.activePlayers,
          r.memberCount,
        ]);
      }),
    ];

    const day = (s.range.fromText || '').slice(0, 10) || new Date().toISOString().slice(0, 10);
    // BOM 让 Windows Excel 正确识别中文
    const csv = `\uFEFF${lines.join('\r\n')}`;
    return { filename: `报表-${day}.csv`, csv };
  }

  /**
   * 代理团队玩家有效流水榜（早茶对照用）。
   * 口径与回水一致：validFlow > 0 且 settledAt 落在上海日窗。
   *
   * 范围走 playerWhere，和玩家列表、玩家详情同一把尺：
   * 代理/子账号=管辖房间内在房玩家，客服=系统派给自己的玩家。
   * 早先按 agentPath 团队树取人，会把挂在树下却不在自己房里的玩家也列出来，
   * 客服更是能看到全部派单以外的人。
   */
  async playerFlow(
    actor: ConsoleActor,
    opts?: { range?: string; limit?: number; playerId?: string },
  ) {
    if (actor.role !== 'AGENT' && actor.role !== 'PROXY' && actor.role !== 'CS') {
      throw new ForbiddenException('仅代理/客服可查看玩家流水榜');
    }
    const rangeKey: TimeRangeKey = isTimeRangeKey(opts?.range)
      ? opts.range
      : 'today';
    const [from, to] = shanghaiRangeBounds(rangeKey);
    const limit = Math.min(Math.max(opts?.limit ?? 100, 1), 500);

    const playerWhere = (await this.scope.playerWhere(actor)) as Prisma.UserWhereInput;
    if (opts?.playerId?.trim()) {
      playerWhere.AND = [{ id: opts.playerId.trim() }];
    }

    const players = await this.prisma.user.findMany({
      where: playerWhere,
      select: { id: true, uid: true, nickname: true, username: true, avatar: true },
      take: 50_000,
    });
    if (!players.length) {
      return {
        range: rangeKey,
        from: from.toISOString(),
        to: to.toISOString(),
        list: [] as Array<{
          playerId: string;
          uid: string;
          nickname: string;
          username: string;
          avatar: string | null;
          validFlow: number;
          betCount: number;
        }>,
      };
    }

    const byId = new Map(players.map((p) => [p.id, p]));
    const playerIds = players.map((p) => p.id);

    const grouped = await this.prisma.bet.groupBy({
      by: ['playerId'],
      where: {
        playerId: { in: playerIds },
        validFlow: { gt: 0 },
        settledAt: { gte: from, lt: to },
      },
      _sum: { validFlow: true },
      _count: true,
      orderBy: { _sum: { validFlow: 'desc' } },
      take: opts?.playerId?.trim() ? 1 : limit,
    });

    /* 单人查询时即便无流水也回 0，便于审单对照 */
    if (opts?.playerId?.trim()) {
      const pid = opts.playerId.trim();
      const p = byId.get(pid);
      if (!p) throw new ForbiddenException('玩家不在管辖范围');
      const g = grouped[0];
      return {
        range: rangeKey,
        from: from.toISOString(),
        to: to.toISOString(),
        list: [
          {
            playerId: pid,
            uid: p.uid,
            nickname: p.nickname,
            username: p.username,
            avatar: p.avatar,
            validFlow: asMoney(g?._sum.validFlow ?? 0),
            betCount: g?._count ?? 0,
          },
        ],
      };
    }

    const list = grouped.map((g) => {
      const p = byId.get(g.playerId)!;
      return {
        playerId: g.playerId,
        uid: p.uid,
        nickname: p.nickname,
        username: p.username,
        avatar: p.avatar,
        validFlow: asMoney(g._sum.validFlow ?? 0),
        betCount: g._count,
      };
    });

    return {
      range: rangeKey,
      from: from.toISOString(),
      to: to.toISOString(),
      list,
    };
  }

  /** 工作台：汇总 + 对账 + 盘口/周结 + 游戏拆分 + 最近操作 */
  async dashboard(actor: ConsoleActor) {
    const [from, to] = shanghaiRangeBounds('today');
    const [weekFrom, weekTo] = shanghaiRangeBounds('thisweek');
    const [lastWeekFrom, lastWeekTo] = shanghaiRangeBounds('lastweek');
    /* 经营方视角：工作台多给一块本周汇总，平台侧看当日即可 */
    const isAgentSide = actor.role === 'AGENT' || actor.role === 'PROXY' || actor.role === 'GENERAL';

    const [summary, weekSummary, reconcile] = await Promise.all([
      this.summary(actor),
      isAgentSide ? this.summary(actor, undefined, { range: 'thisweek' }) : Promise.resolve(null),
      this.reconcile(actor),
    ]);

    const playerWhere = await this.scope.playerWhere(actor);
    const roomIds = await this.scope.grantedRoomIds(actor);

    const players = await this.prisma.user.findMany({
      where: playerWhere,
      select: { id: true },
      take: 50_000,
    });
    const playerIds = players.map((p) => p.id);

    /*
     * 工作台 TOP 游戏：口径跟 summary 一致——三级账本取自己那一桶，
     * 且这里出的是盈亏，按**开奖时间**归期。
     */
    const statusIn = ['WON', 'LOST'] as Array<'WON' | 'LOST'>;
    const dashSide = flowViewerSide({
      isPlatformSide: actor.role === 'ADMIN' || actor.role === 'BRANCH',
      isGeneralSide: await this.scope.isGeneralSide(actor),
    });
    const dashHouseFilter = this.ledgerPrismaFilter(dashSide);
    const betWhere: Record<string, unknown> = {
      settledAt: { gte: from, lt: to },
      status: { in: statusIn },
      ...(actor.role === 'ADMIN'
        ? {}
        : { playerId: { in: playerIds.length ? playerIds : ['__none__'] } }),
      ...(dashHouseFilter ? { AND: [dashHouseFilter] } : {}),
    };

    const roomWhere =
      roomIds === null
        ? { status: { not: 'CLOSED' } }
        : { id: { in: roomIds.length ? roomIds : ['__none__'] }, status: { not: 'CLOSED' } };

    const [activePlayers, byGameRaw, recentLogs, rooms, settledLastWeek] = await Promise.all([
      this.prisma.bet.findMany({
        where: betWhere,
        select: { playerId: true },
        distinct: ['playerId'],
      }),
      this.prisma.bet.groupBy({
        by: ['gameId'],
        where: betWhere,
        _sum: { amount: true, payout: true },
        _count: true,
        orderBy: { _sum: { amount: 'desc' } },
        take: 8,
      }),
      this.prisma.adminLog.findMany({
        where:
          actor.role === 'ADMIN'
            ? {}
            : actor.role === 'BRANCH'
              ? {
                  OR: [
                    { operatorId: actor.id },
                    ...(Array.isArray(roomIds) && roomIds.length
                      ? [{ target: { in: roomIds } }]
                      : []),
                  ],
                }
              : { operatorId: actor.id },
        orderBy: { createdAt: 'desc' },
        take: 10,
        select: {
          id: true,
          action: true,
          target: true,
          detail: true,
          createdAt: true,
          operator: { select: { nickname: true, username: true } },
        },
      }),
      this.prisma.room.findMany({
        where: roomWhere,
        select: {
          id: true,
          roomNo: true,
          name: true,
          bookMode: true,
          ...ROOM_AGENT_SHARE_SCHEDULE_SELECT,
          /* 周报占成要三段拆，挂了总代得扣掉成数差 */
          generalAgent: { select: GENERAL_SHARE_SCHEDULE_SELECT },
          createdAt: true,
        },
        take: 50_000,
        orderBy: { roomNo: 'asc' },
      }),
      this.prisma.roomWeekSettle.findMany({
        where: {
          weekStart: lastWeekFrom,
          status: 'SETTLED',
          ...(roomIds === null
            ? {}
            : { roomId: { in: roomIds.length ? roomIds : ['__none__'] } }),
        },
        select: { roomId: true },
      }),
    ]);

    const gameIds = byGameRaw.map((g) => g.gameId);
    const games = gameIds.length
      ? await this.prisma.game.findMany({
          where: { id: { in: gameIds } },
          select: { id: true, code: true, name: true },
        })
      : [];
    const gameMap = new Map(games.map((g) => [g.id, g]));

    const byGame = byGameRaw.map((g) => {
      const sum = g._sum ?? { amount: 0, payout: 0 };
      const flow = asMoney(sum.amount ?? 0);
      const payout = asMoney(sum.payout ?? 0);
      const meta = gameMap.get(g.gameId);
      return {
        gameCode: meta?.code ?? g.gameId,
        gameName: meta?.name ?? meta?.code ?? g.gameId,
        betCount: typeof g._count === 'number' ? g._count : 0,
        betFlow: flow,
        payout,
        housePnl: flow - payout,
      };
    });

    const roomCount = rooms.length;
    const cashRooms = rooms.filter((r) => r.bookMode !== 'CREDIT').length;
    const creditRooms = rooms.filter((r) => r.bookMode === 'CREDIT').length;
    const settledSet = new Set(settledLastWeek.map((r) => r.roomId));
    // 仅统计「上周账期内已存在」且尚未标记 SETTLED 的房间。
    // 本周新建房没有上周账期，不应出现在「上周未结账」待办里。
    const pendingRooms = rooms
      .filter((r) => r.createdAt.getTime() < lastWeekTo.getTime() && !settledSet.has(r.id))
      .map((r) => ({
        id: r.id,
        roomNo: r.roomNo,
        name: r.name,
        bookMode: r.bookMode,
      }));
    const lastWeekPending = pendingRooms.length;

    let shareRate: number | null = null;
    if (rooms.length === 1) {
      shareRate = effectiveGeneralShareRate(scheduleFromRoom(rooms[0]), lastWeekFrom);
    } else if (rooms.length > 1) {
      shareRate = rooms.reduce(
        (s, r) => s + effectiveGeneralShareRate(scheduleFromRoom(r), lastWeekFrom),
        0,
      ) / rooms.length;
    }
    /*
     * 占成预估与结算中心同口径：只算飞盘，否则代理会按含关盘的数字预期收付。
     * 拆分走统一的 splitHouseShare，别再手写乘法——挂了总代时要扣掉成数差，
     * 原先 `housePnl − 代理占成` 会把总代那截也算成代理要上缴给平台的。
     */
    const weekHousePnl = asMoney(weekSummary?.flownHousePnl ?? 0);
    const weekBetFlow = asMoney(weekSummary?.flownBetFlow ?? 0);
    const weekGeneralRate = rooms.length
      ? rooms.reduce((s, r) => s + (r.generalAgent
        ? effectiveGeneralShareRate(scheduleFromAgent(r.generalAgent), lastWeekFrom)
        : 0), 0) / rooms.length
      : 0;
    const weekSplit = splitHouseShare(
      weekHousePnl,
      shareRate ?? 0,
      rooms.some((r) => r.generalAgent) ? weekGeneralRate : null,
    );
    const weekAgentShare = shareRate == null ? 0 : weekSplit.agentShareAmount;
    /* 代理视角的「应上缴上家」＝ 庄家盈亏 − 自己那份，中间有总代也不能少付 */
    const weekPlatformShare = shareRate == null ? 0 : weekSplit.agentPayBase;

    const platformQuota = await this.sumPlatformQuotaToday(actor, from, to, roomIds);

    return {
      summary: {
        ...summary,
        activePlayers: activePlayers.length,
        playerCount: reconcile.playerCount,
        agentCount: roomCount,
        agentRoomCount: roomCount,
        roomCount,
        commissionAmount: asMoney(summary.commissionAmount ?? 0),
        commissionCount: summary.commissionCount ?? 0,
      },
      books: {
        roomCount,
        cashRooms,
        creditRooms,
      },
      settle: {
        lastWeekPending,
        lastWeekStart: lastWeekFrom.toISOString(),
        lastWeekEnd: lastWeekTo.toISOString(),
        thisWeekStart: weekFrom.toISOString(),
        thisWeekEnd: weekTo.toISOString(),
        /** 上周尚未标记结账的房间（工作台待办点进去用） */
        pendingRooms,
      },
      share: {
        rate: shareRate,
        ratePct: shareRate == null ? null : Math.round(shareRate * 1000) / 10,
        weekBetFlow,
        weekHousePnl,
        weekAgentShare,
        weekPlatformShare,
      },
      /** 平台侧今日给总代/代理的额度进出；不含总代给下级 */
      agentQuota: {
        issueAmount: platformQuota.issueAmount,
        issueCount: platformQuota.issueCount,
        recallAmount: platformQuota.recallAmount,
        recallCount: platformQuota.recallCount,
      },
      cashflow: {
        playerBalance: reconcile.balanceSum,
        upAmount: summary.upAmount,
        downAmount: summary.downAmount,
        playerPnl: summary.playerPnl,
        netChange: asMoney(
          summary.upAmount - summary.downAmount + summary.playerPnl,
        ),
      },
      reconcile,
      byGame,
      recentLogs: recentLogs.map((l) => ({
        id: l.id,
        action: l.action,
        actionLabel: ADMIN_ACTION_META[l.action]?.label ?? l.action,
        target: l.target,
        detail: l.detail,
        createdAt: l.createdAt,
        operator: l.operator?.nickname || l.operator?.username || '—',
      })),
      canReviewRecharge: actor.role === 'AGENT' || actor.role === 'CS',
    };
  }

  /** 管理员 / 房主工作台：近 N 日流水与庄家盈亏（按管辖范围） */
  async landlordTrend(actor: ConsoleActor, daysRaw = 7) {
    if (actor.role !== 'ADMIN' && actor.role !== 'BRANCH') {
      throw new ForbiddenException('无权查看');
    }
    const days = Math.min(Math.max(Math.floor(Number(daysRaw) || 7), 1), 30);
    const [today0] = shanghaiRangeBounds('today');
    const dayMs = 86400000;

    let playerIds: string[] | null = null;
    if (actor.role === 'BRANCH') {
      const players = await this.prisma.user.findMany({
        where: await this.scope.playerWhere(actor),
        select: { id: true },
        take: 50_000,
      });
      playerIds = players.map((p) => p.id);
    }

    const statusIn = ['WON', 'LOST'] as Array<'WON' | 'LOST'>;
    const result: Array<{ date: string; betFlow: number; pnl: number; newUsers: number }> = [];

    for (let i = days - 1; i >= 0; i--) {
      const from = new Date(today0.getTime() - i * dayMs);
      const to = new Date(from.getTime() + dayMs);
      /* 趋势图出的是盈亏，按开奖时间归期，跟报表/结账同一把尺 */
      const betWhere =
        playerIds === null
          ? {
              settledAt: { gte: from, lt: to },
              status: { in: statusIn },
              AND: [this.flownPrismaFilter()],
            }
          : {
              settledAt: { gte: from, lt: to },
              status: { in: statusIn },
              playerId: { in: playerIds.length ? playerIds : ['__none__'] },
              AND: [this.flownPrismaFilter()],
            };

      const [agg, newUsers] = await Promise.all([
        this.prisma.bet.aggregate({
          where: betWhere,
          _sum: { amount: true, payout: true },
        }),
        this.prisma.user.count({
          where:
            playerIds === null
              ? { role: 'PLAYER', createdAt: { gte: from, lt: to } }
              : {
                  role: 'PLAYER',
                  createdAt: { gte: from, lt: to },
                  id: { in: playerIds.length ? playerIds : ['__none__'] },
                },
        }),
      ]);

      const betFlow = asMoney(agg._sum.amount ?? 0);
      const payout = asMoney(agg._sum.payout ?? 0);
      const sh = new Date(from.getTime() + SHANGHAI_TZ_OFFSET_MS);
      const y = sh.getUTCFullYear();
      const m = String(sh.getUTCMonth() + 1).padStart(2, '0');
      const d = String(sh.getUTCDate()).padStart(2, '0');
      result.push({
        date: `${y}-${m}-${d}`,
        betFlow,
        pnl: betFlow - payout,
        newUsers,
      });
    }
    return result;
  }

  /**
   * 工作台「今日上分 / 今日下分」：
   *   只认管理、总监从平台池打给总代、代理的额度；
   *   总代给下级的不进（操作人不是管理/总监）。
   *   总监再按显示房间过滤：看不见的总代、看不见的房间主代理都不进。
   */
  private async sumPlatformQuotaToday(
    actor: ConsoleActor,
    from: Date,
    to: Date,
    visibleRoomIds: string[] | null,
  ) {
    const empty = { issueAmount: 0, issueCount: 0, recallAmount: 0, recallCount: 0 };
    if (actor.role !== 'ADMIN' && actor.role !== 'BRANCH') return empty;

    let allowedTargets: Set<string> | null = null;
    if (actor.role === 'BRANCH') {
      allowedTargets = new Set<string>();
      const rooms = await this.prisma.room.findMany({
        where: { id: { in: visibleRoomIds?.length ? visibleRoomIds : ['__none__'] } },
        select: {
          ownerAgent: { select: { userId: true } },
          generalAgent: { select: { userId: true } },
        },
      });
      for (const r of rooms) {
        if (r.ownerAgent?.userId) allowedTargets.add(r.ownerAgent.userId);
        if (r.generalAgent?.userId) allowedTargets.add(r.generalAgent.userId);
      }
      const generalIds = await this.scope.grantedGeneralAgentIds(actor);
      if (generalIds?.length) {
        const gens = await this.prisma.agent.findMany({
          where: { id: { in: generalIds } },
          select: { userId: true },
        });
        for (const g of gens) allowedTargets.add(g.userId);
      }
    }

    const quotaLogs = await this.prisma.adminLog.findMany({
      where: {
        action: { in: ['QUOTA_SELL', 'QUOTA_RECALL'] },
        createdAt: { gte: from, lt: to },
        /* 总代给代理的操作人是 GENERAL，这里直接排除 */
        operator: { role: { in: ['ADMIN', 'BRANCH'] } },
      },
      select: { action: true, target: true, detail: true },
      take: 20_000,
    });

    const targetIds = [...new Set(quotaLogs.map((l) => l.target).filter((id): id is string => !!id))];
    const roleById = new Map(
      (
        await this.prisma.user.findMany({
          where: { id: { in: targetIds.length ? targetIds : ['__none__'] } },
          select: { id: true, role: true },
        })
      ).map((u) => [u.id, u.role]),
    );

    let issueAmount = 0;
    let issueCount = 0;
    let recallAmount = 0;
    let recallCount = 0;
    for (const row of quotaLogs) {
      const tid = row.target;
      if (!tid) continue;
      const role = roleById.get(tid);
      if (role !== 'GENERAL' && role !== 'AGENT') continue;
      if (allowedTargets && !allowedTargets.has(tid)) continue;
      const amt = asMoney(Number((row.detail as { amount?: number } | null)?.amount ?? 0));
      if (amt <= 0) continue;
      if (row.action === 'QUOTA_SELL') {
        issueAmount = asMoney(issueAmount + amt);
        issueCount += 1;
      } else {
        recallAmount = asMoney(recallAmount + amt);
        recallCount += 1;
      }
    }
    return { issueAmount, issueCount, recallAmount, recallCount };
  }
}
