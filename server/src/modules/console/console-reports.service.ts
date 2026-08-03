import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { asMoney } from '@gamebox/shared';
import { PrismaService } from '../../prisma/prisma.service';
import {
  isTimeRangeKey,
  SHANGHAI_TZ_OFFSET_MS,
  shanghaiRangeBounds,
  type TimeRangeKey,
} from '../../common/shanghai-range';
import { ConsoleScopeService, type ConsoleActor } from './console-scope.service';

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
  private async roomBetAgg(
    roomIds: string[],
    from: Date,
    to: Date,
    statuses: Array<'WON' | 'LOST' | 'PENDING'>,
  ): Promise<{
    byRoom: Map<string, { flow: number; payout: number; count: number; players: Set<string> }>;
    byGame: Array<{ gameId: string; flow: number; payout: number; count: number }>;
    total: { flow: number; payout: number; count: number };
    activePlayers: number;
  }> {
    const empty = {
      byRoom: new Map<string, { flow: number; payout: number; count: number; players: Set<string> }>(),
      byGame: [] as Array<{ gameId: string; flow: number; payout: number; count: number }>,
      total: { flow: 0, payout: 0, count: 0 },
      activePlayers: 0,
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

    const [roomRows, gameRows, activeRows] = await Promise.all([
      this.prisma.$queryRaw<RoomRow[]>`
        SELECT
          COALESCE(NULLIF(b.payload->'fly'->>'roomId', ''), m."roomId") AS room_id,
          b."playerId" AS player_id,
          COALESCE(SUM(b.amount), 0) AS flow,
          COALESCE(SUM(b.payout), 0) AS payout,
          COUNT(*)::int AS cnt
        FROM "Bet" b
        LEFT JOIN LATERAL (
          SELECT rm."roomId"
          FROM "RoomMember" rm
          WHERE rm."playerId" = b."playerId"
            AND rm.status = 'APPROVED'
            AND rm."roomId" IN (${roomList})
          ORDER BY rm."updatedAt" DESC NULLS LAST
          LIMIT 1
        ) m ON true
        WHERE b."createdAt" >= ${from}
          AND b."createdAt" < ${to}
          AND b.status IN (${statusList})
          AND (
            NULLIF(b.payload->'fly'->>'roomId', '') IN (${roomList})
            OR (
              NULLIF(b.payload->'fly'->>'roomId', '') IS NULL
              AND m."roomId" IS NOT NULL
            )
          )
        GROUP BY 1, 2
      `,
      this.prisma.$queryRaw<GameRow[]>`
        SELECT
          b."gameId" AS game_id,
          COALESCE(SUM(b.amount), 0) AS flow,
          COALESCE(SUM(b.payout), 0) AS payout,
          COUNT(*)::int AS cnt
        FROM "Bet" b
        LEFT JOIN LATERAL (
          SELECT rm."roomId"
          FROM "RoomMember" rm
          WHERE rm."playerId" = b."playerId"
            AND rm.status = 'APPROVED'
            AND rm."roomId" IN (${roomList})
          ORDER BY rm."updatedAt" DESC NULLS LAST
          LIMIT 1
        ) m ON true
        WHERE b."createdAt" >= ${from}
          AND b."createdAt" < ${to}
          AND b.status IN (${statusList})
          AND (
            NULLIF(b.payload->'fly'->>'roomId', '') IN (${roomList})
            OR (
              NULLIF(b.payload->'fly'->>'roomId', '') IS NULL
              AND m."roomId" IS NOT NULL
            )
          )
        GROUP BY b."gameId"
        ORDER BY SUM(b.amount) DESC NULLS LAST
        LIMIT 20
      `,
      this.prisma.$queryRaw<ActiveRow[]>`
        SELECT COUNT(DISTINCT b."playerId")::int AS cnt
        FROM "Bet" b
        LEFT JOIN LATERAL (
          SELECT rm."roomId"
          FROM "RoomMember" rm
          WHERE rm."playerId" = b."playerId"
            AND rm.status = 'APPROVED'
            AND rm."roomId" IN (${roomList})
          ORDER BY rm."updatedAt" DESC NULLS LAST
          LIMIT 1
        ) m ON true
        WHERE b."createdAt" >= ${from}
          AND b."createdAt" < ${to}
          AND b.status IN (${statusList})
          AND (
            NULLIF(b.payload->'fly'->>'roomId', '') IN (${roomList})
            OR (
              NULLIF(b.payload->'fly'->>'roomId', '') IS NULL
              AND m."roomId" IS NOT NULL
            )
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

    // 玩家范围：勾选房间 → 成员并集；否则非超管按管辖树；超管全站不限
    const playerWhere = await this.scope.playerWhere(actor);
    let playerIds: string[] | null = null;
    let commissionAgentIds: string[] | null = null;

    if (explicitRoomIds) {
      if (!explicitRoomIds.length) {
        return {
          ...this.rangeMeta(from, to, rangeKey),
          roomCount: 0,
          betFlow: 0,
          payout: 0,
          housePnl: 0,
          playerPnl: 0,
          betCount: 0,
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
          netChange: 0,
          netPnl: 0,
          byGame: [],
        };
      }
      const [members, rooms] = await Promise.all([
        this.prisma.roomMember.findMany({
          where: { roomId: { in: explicitRoomIds }, status: 'APPROVED' },
          select: { playerId: true },
        }),
        this.prisma.room.findMany({
          where: { id: { in: explicitRoomIds } },
          select: { ownerAgent: { select: { userId: true } } },
        }),
      ]);
      playerIds = [...new Set(members.map((m) => m.playerId))];
      commissionAgentIds = [
        ...new Set(
          rooms
            .map((r) => r.ownerAgent?.userId)
            .filter((id): id is string => !!id),
        ),
      ];
    } else if (actor.role !== 'ADMIN') {
      const players = await this.prisma.user.findMany({
        where: playerWhere,
        select: { id: true },
        take: 50_000,
      });
      playerIds = players.map((p) => p.id);
    }

    // 佣金：勾选房间看绑定代理；否则沿用管辖范围
    let commissionWhere: Record<string, unknown> = {
      settledAt: { gte: from, lt: to },
    };
    if (explicitRoomIds) {
      commissionWhere.beneficiaryId = {
        in: commissionAgentIds?.length ? commissionAgentIds : ['__none__'],
      };
    } else if (actor.role === 'AGENT' || actor.role === 'PROXY') {
      // PROXY 佣金记在主代理名下
      commissionWhere.beneficiaryId = await this.scope.scopeRootUserId(actor);
    } else if (actor.role === 'BRANCH') {
      const me = await this.prisma.user.findUnique({
        where: { id: actor.id },
        select: { agentPath: true },
      });
      const prefix = `${me?.agentPath ?? '/'}${actor.id}/`;
      const agents = await this.prisma.user.findMany({
        where: {
          role: { in: ['AGENT', 'PROXY'] },
          OR: [{ parentId: actor.id }, { agentPath: { startsWith: prefix } }],
        },
        select: { id: true },
        take: 50_000,
      });
      commissionWhere.beneficiaryId = { in: agents.length ? agents.map((a) => a.id) : ['__none__'] };
    }

    let betFlow = 0;
    let payout = 0;
    let betCount = 0;
    let pendingBetFlow = 0;
    let pendingBetCount = 0;
    let activePlayers = 0;
    let byGame: Array<{
      gameCode: string;
      gameName: string;
      betCount: number;
      betFlow: number;
      payout: number;
      housePnl: number;
    }> = [];

    if (explicitRoomIds) {
      const [settled, pending] = await Promise.all([
        this.roomBetAgg(explicitRoomIds, from, to, ['WON', 'LOST']),
        this.roomBetAgg(explicitRoomIds, from, to, ['PENDING']),
      ]);
      betFlow = settled.total.flow;
      payout = settled.total.payout;
      betCount = settled.total.count;
      pendingBetFlow = pending.total.flow;
      pendingBetCount = pending.total.count;
      activePlayers = settled.activePlayers;
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
      const settledWhere: Record<string, unknown> = {
        createdAt: { gte: from, lt: to },
        status: { in: ['WON', 'LOST'] },
      };
      const pendingWhere: Record<string, unknown> = {
        createdAt: { gte: from, lt: to },
        status: 'PENDING',
      };
      if (playerIds) {
        const filter = { in: playerIds.length ? playerIds : ['__none__'] };
        settledWhere['playerId'] = filter;
        pendingWhere['playerId'] = filter;
      }

      const [bets, pendingAgg, activeRaw, byGameRaw] = await Promise.all([
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
      ]);

      for (const b of bets) {
        betFlow += asMoney(b._sum.amount ?? 0);
        payout += asMoney(b._sum.payout ?? 0);
        betCount += b._count;
      }
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

    const housePnl = betFlow - payout; // 庄家视角

    const upWhere: Record<string, unknown> = {
      type: 'UP',
      status: 'APPROVED',
      reviewedAt: { gte: from, lt: to },
    };
    const downWhere: Record<string, unknown> = {
      type: 'DOWN',
      status: 'APPROVED',
      reviewedAt: { gte: from, lt: to },
    };
    if (playerIds) {
      upWhere['playerId'] = { in: playerIds.length ? playerIds : ['__none__'] };
      downWhere['playerId'] = { in: playerIds.length ? playerIds : ['__none__'] };
    }

    const [upAgg, downAgg, pendingUp, pendingDown, commissionAgg] = await Promise.all([
      this.prisma.rechargeOrder.aggregate({ where: upWhere, _sum: { amount: true }, _count: true }),
      this.prisma.rechargeOrder.aggregate({ where: downWhere, _sum: { amount: true }, _count: true }),
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
      explicitRoomIds != null
        ? explicitRoomIds.length
        : grantedRoomIds === null
          ? await this.prisma.room.count()
          : grantedRoomIds.length;

    const upAmount = asMoney(upAgg._sum.amount ?? 0);
    const downAmount = asMoney(downAgg._sum.amount ?? 0);
    const playerPnl = payout - betFlow;
    const commissionAmount = asMoney(commissionAgg._sum.amount ?? 0);

    return {
      ...this.rangeMeta(from, to, rangeKey),
      roomCount,
      betFlow,
      payout,
      housePnl,
      playerPnl,
      betCount,
      upAmount,
      upCount: upAgg._count,
      downAmount,
      downCount: downAgg._count,
      pendingUp,
      pendingDown,
      /** 未结算注单（不计入流水/盈亏 KPI） */
      pendingBetFlow,
      pendingBetCount,
      activePlayers,
      playerCount: playerIds?.length ?? null,
      commissionAmount,
      commissionCount: commissionAgg._count,
      /** 资金净变动 ≈ 上分 - 下分 + 玩家盈亏 */
      netChange: asMoney(upAmount - downAmount + playerPnl),
      /** 净盈亏 = 庄家盈亏 − 代理佣金 */
      netPnl: asMoney(housePnl - commissionAmount),
      byGame,
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
        ownerAgent: {
          select: {
            userId: true,
            user: { select: { nickname: true, username: true } },
          },
        },
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
    const playerFilter = { in: playerIdList.length ? playerIdList : ['__none__'] };
    const agentIds = rooms
      .map((r) => r.ownerAgent?.userId)
      .filter((id): id is string => !!id);

    const [settledBets, ups, downs, commissions] = await Promise.all([
      this.roomBetAgg(roomIds, from, to, ['WON', 'LOST']),
      this.prisma.rechargeOrder.groupBy({
        by: ['playerId'],
        where: {
          type: 'UP',
          status: 'APPROVED',
          reviewedAt: { gte: from, lt: to },
          playerId: playerFilter,
        },
        _sum: { amount: true },
        _count: true,
      }),
      this.prisma.rechargeOrder.groupBy({
        by: ['playerId'],
        where: {
          type: 'DOWN',
          status: 'APPROVED',
          reviewedAt: { gte: from, lt: to },
          playerId: playerFilter,
        },
        _sum: { amount: true },
        _count: true,
      }),
      agentIds.length
        ? this.prisma.commissionRecord.groupBy({
            by: ['beneficiaryId'],
            where: {
              settledAt: { gte: from, lt: to },
              beneficiaryId: { in: agentIds },
            },
            _sum: { amount: true },
            _count: true,
          })
        : Promise.resolve([] as { beneficiaryId: string; _sum: { amount: unknown }; _count: number }[]),
    ]);

    const upByPlayer = new Map(
      ups.map((u) => [u.playerId, { amount: asMoney(u._sum.amount ?? 0), count: u._count }]),
    );
    const downByPlayer = new Map(
      downs.map((d) => [d.playerId, { amount: asMoney(d._sum.amount ?? 0), count: d._count }]),
    );
    const commissionByAgent = new Map(
      commissions.map((c) => [
        c.beneficiaryId,
        { amount: asMoney(c._sum.amount ?? 0), count: c._count },
      ]),
    );

    const list = rooms.map((room) => {
      const pids = roomPlayers.get(room.id) ?? [];
      const betAgg = settledBets.byRoom.get(room.id);
      const betFlow = betAgg?.flow ?? 0;
      const payout = betAgg?.payout ?? 0;
      const betCount = betAgg?.count ?? 0;
      let upAmount = 0;
      let upCount = 0;
      let downAmount = 0;
      let downCount = 0;
      for (const pid of pids) {
        const u = upByPlayer.get(pid);
        if (u) {
          upAmount += u.amount;
          upCount += u.count;
        }
        const d = downByPlayer.get(pid);
        if (d) {
          downAmount += d.amount;
          downCount += d.count;
        }
      }
      upAmount = asMoney(upAmount);
      downAmount = asMoney(downAmount);
      const housePnl = asMoney(betFlow - payout);
      const playerPnl = asMoney(payout - betFlow);
      const agentUserId = room.ownerAgent?.userId;
      const commissionAmount = agentUserId
        ? (commissionByAgent.get(agentUserId)?.amount ?? 0)
        : 0;
      const commissionCount = agentUserId
        ? (commissionByAgent.get(agentUserId)?.count ?? 0)
        : 0;
      return {
        roomId: room.id,
        roomNo: room.roomNo,
        name: room.name,
        status: room.status,
        agentNickname: room.ownerAgent?.user?.nickname ?? null,
        agentUsername: room.ownerAgent?.user?.username ?? null,
        memberCount: pids.length,
        activePlayers: betAgg?.players.size ?? 0,
        betCount,
        betFlow,
        payout,
        housePnl,
        playerPnl,
        upAmount,
        upCount,
        downAmount,
        downCount,
        commissionAmount,
        commissionCount,
        netPnl: asMoney(housePnl - commissionAmount),
        netChange: asMoney(upAmount - downAmount + playerPnl),
      };
    });

    // 有流水/资金的房间排前，其余按房号
    list.sort((a, b) => {
      const score = (x: typeof a) => Math.abs(x.betFlow) + Math.abs(x.upAmount) + Math.abs(x.downAmount);
      const d = score(b) - score(a);
      if (d !== 0) return d;
      return a.roomNo.localeCompare(b.roomNo);
    });

    return {
      ...this.rangeMeta(from, to, rangeKey),
      list,
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

    const csvCell = (v: string | number | null | undefined) => {
      const raw = v == null ? '' : String(v);
      if (/[",\n\r]/.test(raw)) return `"${raw.replace(/"/g, '""')}"`;
      return raw;
    };
    const row = (cols: Array<string | number | null | undefined>) =>
      cols.map(csvCell).join(',');

    const fromText = s.range.fromText || s.range.from;
    const toText = s.range.toText || s.range.to;
    // 整段写进一格，避免 Excel 把日期拆到窄列里显示成 ######
    const lines = [
      row(['报表区间（上海时间）', `${fromText} 至 ${toText}`]),
      row(['说明', '流水/盈亏仅含已结算注单；房间优先按 fly.roomId 归因；净盈亏=庄家盈亏-代理佣金']),
      '',
      row([
        '房号',
        '房间名',
        '状态',
        '代理',
        '流水',
        '派彩',
        '庄家盈亏',
        '玩家盈亏',
        '代理佣金',
        '净盈亏',
        '注单数',
        '活跃玩家',
        '成员数',
      ]),
      row([
        '合计',
        '',
        '',
        '',
        s.betFlow,
        s.payout,
        s.housePnl,
        s.playerPnl,
        s.commissionAmount,
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
        return row([
          r.roomNo,
          r.name,
          statusMap[r.status] || r.status,
          r.agentNickname || r.agentUsername || '',
          r.betFlow,
          r.payout,
          r.housePnl,
          r.playerPnl,
          r.commissionAmount,
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

  /** 工作台：汇总 + 对账 + 人数/游戏拆分 + 最近操作 */
  async dashboard(actor: ConsoleActor) {
    const [from, to] = shanghaiRangeBounds('today');
    const summary = await this.summary(actor);
    const reconcile = await this.reconcile(actor);

    const playerWhere = await this.scope.playerWhere(actor);
    const roomIds = await this.scope.grantedRoomIds(actor);

    const players = await this.prisma.user.findMany({
      where: playerWhere,
      select: { id: true },
      take: 50_000,
    });
    const playerIds = players.map((p) => p.id);

    // 一房一代理：代理房间数用 roomCount；另查今日佣金（PROXY 看主代理）
    let commissionBeneficiaryFilter: string[] | null = null;
    if (actor.role === 'AGENT' || actor.role === 'PROXY') {
      commissionBeneficiaryFilter = [await this.scope.scopeRootUserId(actor)];
    } else if (actor.role === 'BRANCH') {
      const me = await this.prisma.user.findUnique({
        where: { id: actor.id },
        select: { agentPath: true },
      });
      const prefix = `${me?.agentPath ?? '/'}${actor.id}/`;
      const agents = await this.prisma.user.findMany({
        where: {
          role: { in: ['AGENT', 'PROXY'] },
          OR: [{ parentId: actor.id }, { agentPath: { startsWith: prefix } }],
        },
        select: { id: true },
        take: 50_000,
      });
      commissionBeneficiaryFilter = agents.map((a) => a.id);
    }

    // 工作台 TOP 游戏：仅已结算（与 summary 流水口径一致）
    const statusIn = ['WON', 'LOST'] as Array<'WON' | 'LOST'>;
    const betWhere =
      actor.role === 'ADMIN'
        ? { createdAt: { gte: from, lt: to }, status: { in: statusIn } }
        : {
            createdAt: { gte: from, lt: to },
            status: { in: statusIn },
            playerId: { in: playerIds.length ? playerIds : ['__none__'] },
          };

    const commissionWhere =
      commissionBeneficiaryFilter === null
        ? { settledAt: { gte: from, lt: to } }
        : commissionBeneficiaryFilter.length
          ? {
              settledAt: { gte: from, lt: to },
              beneficiaryId: { in: commissionBeneficiaryFilter },
            }
          : { settledAt: { gte: from, lt: to }, beneficiaryId: '__none__' };

    const [activePlayers, byGameRaw, roomPoolAccs, recentLogs, commissionAgg] = await Promise.all([
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
      roomIds === null
        ? this.prisma.pointsAccount.findMany({
            where: { ownerType: 'ROOM' },
            select: { ownerId: true, balance: true },
          })
        : roomIds.length
          ? this.prisma.pointsAccount.findMany({
              where: { ownerType: 'ROOM', ownerId: { in: roomIds } },
              select: { ownerId: true, balance: true },
            })
          : Promise.resolve([] as { ownerId: string; balance: unknown }[]),
      this.prisma.adminLog.findMany({
        where:
          actor.role === 'ADMIN'
            ? {}
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
      this.prisma.commissionRecord.aggregate({
        where: commissionWhere,
        _sum: { amount: true },
        _count: true,
      }),
    ]);

    let roomPoolTotal = 0;
    for (const a of roomPoolAccs) roomPoolTotal += asMoney(a.balance);

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

    const commissionAmount = asMoney(commissionAgg._sum.amount ?? 0);
    // 一房一代理：房间数即代理线数量
    const agentRoomCount =
      summary.roomCount ??
      (roomIds === null ? 0 : roomIds.length);

    return {
      summary: {
        ...summary,
        activePlayers: activePlayers.length,
        playerCount: reconcile.playerCount,
        agentCount: agentRoomCount,
        agentRoomCount,
        roomPoolTotal,
        commissionAmount,
        commissionCount: commissionAgg._count,
      },
      // 资金变动：只展示实际发生的数，不做「期初估算」
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
        target: l.target,
        detail: l.detail,
        createdAt: l.createdAt,
        operator: l.operator?.nickname || l.operator?.username || '—',
      })),
      canReviewRecharge: actor.role === 'AGENT' || actor.role === 'PROXY',
    };
  }
}
