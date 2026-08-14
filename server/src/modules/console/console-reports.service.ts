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
          AND b.status::text IN (${statusList})
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
          AND b.status::text IN (${statusList})
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
          AND b.status::text IN (${statusList})
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
    let betCount = 0;
    /* 下面 if/else 两个分支都会赋值，这里不给初值避免掩盖漏赋值 */
    let pendingBetFlow: number;
    let pendingBetCount: number;
    let activePlayers: number;
    let byGame: Array<{
      gameCode: string;
      gameName: string;
      betCount: number;
      betFlow: number;
      payout: number;
      housePnl: number;
    }>;

    if (roomScopedIds) {
      const [settled, pending] = await Promise.all([
        this.roomBetAgg(roomScopedIds, from, to, ['WON', 'LOST']),
        this.roomBetAgg(roomScopedIds, from, to, ['PENDING']),
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
      roomScopedIds != null
        ? roomScopedIds.length
        : grantedRoomIds === null
          ? await this.prisma.room.count()
          : grantedRoomIds.length;

    const upAmount = asMoney(upAgg._sum.amount ?? 0);
    const downAmount = asMoney(downAgg._sum.amount ?? 0);
    const playerPnl = payout - betFlow;
    const commissionAmount = asMoney(commissionAgg._sum.amount ?? 0);

    // 管理/房主：按房间占成拆平台占成；代理端仍按庄家盈亏口径
    let platformShareAmount = asMoney(housePnl);
    let netPnl = asMoney(housePnl - commissionAmount);
    if (actor.role === 'ADMIN' || actor.role === 'BRANCH') {
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
      if (shareRoomIds.length) {
        const [shareRooms, settledShare] = await Promise.all([
          this.prisma.room.findMany({
            where: { id: { in: shareRoomIds } },
            select: { id: true, agentShareRate: true, generalAgent: { select: { shareRate: true } } },
          }),
          this.roomBetAgg(shareRoomIds, from, to, ['WON', 'LOST']),
        ]);
        let platformShare = 0;
        for (const room of shareRooms) {
          const agg = settledShare.byRoom.get(room.id);
          const roomHouse = asMoney((agg?.flow ?? 0) - (agg?.payout ?? 0));
          const agentRate = Math.min(1, Math.max(0, Number(room.agentShareRate) || 0));
          const g = room.generalAgent
            ? Math.min(1, Math.max(agentRate, Number(room.generalAgent.shareRate) || 0))
            : agentRate;
          platformShare = asMoney(platformShare + asMoney(roomHouse * (1 - g)));
        }
        platformShareAmount = asMoney(platformShare);
      }
      netPnl = asMoney(platformShareAmount - commissionAmount);
    }

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
      platformShareAmount,
      /** 资金净变动 ≈ 上分 - 下分 + 玩家盈亏 */
      netChange: asMoney(upAmount - downAmount + playerPnl),
      /** 管理/房主：平台占成 − 代理佣金；代理：庄家盈亏 − 代理佣金 */
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

    const [countRows, rows] = await Promise.all([
      this.prisma.$queryRaw<Array<{ cnt: number }>>`
        SELECT COUNT(*)::int AS cnt
        FROM "Bet" b
        LEFT JOIN LATERAL (
          SELECT rm."roomId"
          FROM "RoomMember" rm
          WHERE rm."playerId" = b."playerId"
            AND rm.status = 'APPROVED'
            AND rm."roomId" = ${roomId}
          ORDER BY rm."updatedAt" DESC NULLS LAST
          LIMIT 1
        ) m ON true
        WHERE b."createdAt" >= ${from}
          AND b."createdAt" < ${to}
          AND (
            NULLIF(b.payload->'fly'->>'roomId', '') = ${roomId}
            OR (
              NULLIF(b.payload->'fly'->>'roomId', '') IS NULL
              AND m."roomId" IS NOT NULL
            )
          )
          ${playerFilter}
          ${gameFilter}
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
        LEFT JOIN LATERAL (
          SELECT rm."roomId"
          FROM "RoomMember" rm
          WHERE rm."playerId" = b."playerId"
            AND rm.status = 'APPROVED'
            AND rm."roomId" = ${roomId}
          ORDER BY rm."updatedAt" DESC NULLS LAST
          LIMIT 1
        ) m ON true
        WHERE b."createdAt" >= ${from}
          AND b."createdAt" < ${to}
          AND (
            NULLIF(b.payload->'fly'->>'roomId', '') = ${roomId}
            OR (
              NULLIF(b.payload->'fly'->>'roomId', '') IS NULL
              AND m."roomId" IS NOT NULL
            )
          )
          ${playerFilter}
          ${gameFilter}
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
        agentShareRate: true,
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
    const playerToRoom = new Map<string, string>();
    for (const m of members) {
      if (!playerToRoom.has(m.playerId)) playerToRoom.set(m.playerId, m.roomId);
    }

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

    const upByPlayer = new Map(
      ups.map((u) => [u.playerId, { amount: asMoney(u._sum.amount ?? 0), count: u._count }]),
    );
    const downByPlayer = new Map(
      downs.map((d) => [d.playerId, { amount: asMoney(d._sum.amount ?? 0), count: d._count }]),
    );
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
      const agentShareRate = Math.min(1, Math.max(0, Number(room.agentShareRate) || 0));
      const agentShareAmount = asMoney(housePnl * agentShareRate);
      const platformShareAmount = asMoney(housePnl - agentShareAmount);
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
        activePlayers: betAgg?.players.size ?? 0,
        betCount,
        betFlow,
        payout,
        housePnl,
        playerPnl,
        agentShareRate,
        agentShareAmount,
        platformShareAmount,
        upAmount,
        upCount,
        downAmount,
        downCount,
        commissionAmount,
        commissionCount,
        /** 平台净盈亏 = 平台占成 − 代理佣金 */
        netPnl: asMoney(platformShareAmount - commissionAmount),
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

    const fromText = s.range.fromText || s.range.from;
    const toText = s.range.toText || s.range.to;
    // 整段写进一格，避免 Excel 把日期拆到窄列里显示成 ######
    const lines = [
      csvRow(['报表区间（上海时间）', `${fromText} 至 ${toText}`]),
      csvRow([
        '说明',
        '流水/盈亏仅含已结算注单；房间优先按 fly.roomId 归因；平台占成=庄家盈亏×(1-代理占成)；净盈亏=平台占成-代理佣金',
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
   * 口径与回水一致：validFlow > 0 且 settledAt 落在上海日窗；范围按 agentPath 团队树。
   */
  async playerFlow(
    actor: ConsoleActor,
    opts?: { range?: string; limit?: number; playerId?: string },
  ) {
    if (actor.role !== 'AGENT' && actor.role !== 'PROXY' && actor.role !== 'CS') {
      throw new ForbiddenException('仅代理/客服可查看玩家流水榜');
    }
    const rangeKey: TimeRangeKey = (
      ['today', 'yesterday', 'thisweek', 'lastweek', 'thismonth'] as const
    ).includes(opts?.range as TimeRangeKey)
      ? (opts!.range as TimeRangeKey)
      : 'today';
    const [from, to] = shanghaiRangeBounds(rangeKey);
    const limit = Math.min(Math.max(opts?.limit ?? 100, 1), 500);

    const rootId = await this.scope.scopeRootUserId(actor);
    const root = await this.prisma.user.findUnique({
      where: { id: rootId },
      select: { agentPath: true },
    });
    const prefix = `${root?.agentPath ?? '/'}${rootId}/`;

    const playerWhere: Prisma.UserWhereInput = {
      role: 'PLAYER',
      agentPath: { startsWith: prefix },
    };
    if (opts?.playerId?.trim()) {
      playerWhere.id = opts.playerId.trim();
    }

    const players = await this.prisma.user.findMany({
      where: playerWhere,
      select: { id: true, uid: true, nickname: true, avatar: true },
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
          agentShareRate: true,
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
      shareRate = Math.min(1, Math.max(0, Number(rooms[0].agentShareRate ?? 0.3)));
    } else if (rooms.length > 1) {
      shareRate = Math.min(
        1,
        Math.max(
          0,
          rooms.reduce((s, r) => s + Number(r.agentShareRate ?? 0.3), 0) / rooms.length,
        ),
      );
    }
    const weekHousePnl = asMoney(weekSummary?.housePnl ?? 0);
    const weekBetFlow = asMoney(weekSummary?.betFlow ?? 0);
    const weekAgentShare = shareRate == null ? 0 : asMoney(weekHousePnl * shareRate);
    const weekPlatformShare = shareRate == null ? 0 : asMoney(weekHousePnl - weekAgentShare);

    // 管理员/房主：今日给代理发额/回收（不看玩家上下分，避免 A 盘超发搅乱）
    let agentQuotaIssue = 0;
    let agentQuotaRecall = 0;
    let agentQuotaIssueCount = 0;
    let agentQuotaRecallCount = 0;
    if (actor.role === 'ADMIN' || actor.role === 'BRANCH') {
      const quotaWhere: Record<string, unknown> = {
        action: { in: ['QUOTA_SELL', 'QUOTA_RECALL'] },
        createdAt: { gte: from, lt: to },
      };
      if (actor.role === 'BRANCH') {
        const agentUserIds = [
          ...new Set(
            (
              await this.prisma.room.findMany({
                where: { id: { in: roomIds?.length ? roomIds : ['__none__'] } },
                select: { ownerAgent: { select: { userId: true } } },
              })
            )
              .map((r) => r.ownerAgent?.userId)
              .filter((id): id is string => !!id),
          ),
        ];
        quotaWhere.target = { in: agentUserIds.length ? agentUserIds : ['__none__'] };
      }
      const quotaLogs = await this.prisma.adminLog.findMany({
        where: quotaWhere,
        select: { action: true, detail: true },
        take: 20_000,
      });
      for (const row of quotaLogs) {
        const amt = asMoney(Number((row.detail as { amount?: number } | null)?.amount ?? 0));
        if (amt <= 0) continue;
        if (row.action === 'QUOTA_SELL') {
          agentQuotaIssue = asMoney(agentQuotaIssue + amt);
          agentQuotaIssueCount += 1;
        } else if (row.action === 'QUOTA_RECALL') {
          agentQuotaRecall = asMoney(agentQuotaRecall + amt);
          agentQuotaRecallCount += 1;
        }
      }
    }

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
      /** 平台/房主 → 代理额度进出（今日） */
      agentQuota: {
        issueAmount: agentQuotaIssue,
        issueCount: agentQuotaIssueCount,
        recallAmount: agentQuotaRecall,
        recallCount: agentQuotaRecallCount,
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
      const betWhere =
        playerIds === null
          ? { createdAt: { gte: from, lt: to }, status: { in: statusIn } }
          : {
              createdAt: { gte: from, lt: to },
              status: { in: statusIn },
              playerId: { in: playerIds.length ? playerIds : ['__none__'] },
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
}
