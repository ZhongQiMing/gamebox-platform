import { Inject, Injectable, forwardRef } from '@nestjs/common';
import { BetStatus, Prisma } from '@prisma/client';
import {
  asMoney,
  BCBM_AWARD_LABELS,
  FRUIT_AWARD_LABELS,
  FRUIT_RING,
  shanghaiDayOf,
} from '@gamebox/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { RedisService } from '../../redis/redis.service';
import { TableService } from '../table/table.service';
import { RETIRED_GAME_CODES } from '../games/retired-games';
import type { ConsoleActor } from './console-scope.service';
import { ConsoleScopeService } from './console-scope.service';
import {
  GAME_OPS_SCHEDULE,
  dailyMaintDisabled,
  dailyMaintRemainSec,
  inDailyMaintWindow,
} from '../admin/game-ops.scheduler';

/** 与报表 ledgerHouse 同一套三级账本口径 */
type LiveHouse = 'all' | 'flown' | 'agentFly';

export type LiveDrawGame = {
  code: string;
  name: string;
  category: string;
  status: string;
  phase: string;
  phaseLabel: string;
  issueNo: string;
  remainSec: number;
  lastDraw: string;
  lastIssueNo: string;
  currentBetAmount: number;
  currentBetCount: number;
  todayBetAmount: number;
  todayBetCount: number;
  todayPayout: number;
  sortOrder: number;
};

const PHASE_LABEL: Record<string, string> = {
  BETTING: '投注中',
  PENDING: '投注中',
  LOCKED: '封盘',
  DRAWING: '开奖中',
  SETTLED: '已开',
  DRAWN: '已开',
  PAUSED: '暂停',
  IDLE: '待机',
  OFFLINE: '下架',
  MAINTENANCE: '维护中',
};

const TABLE_WIN: Record<string, string> = {
  DRAGON: '龙',
  TIGER: '虎',
  TIE: '和',
  BANKER: '庄',
  PLAYER: '闲',
  LONG: '龙',
  HU: '虎',
};

@Injectable()
export class ConsoleLiveService {
  constructor(
    private prisma: PrismaService,
    private scope: ConsoleScopeService,
    private redis: RedisService,
    @Inject(forwardRef(() => TableService))
    private table: TableService,
  ) {}

  async list(actor: ConsoleActor): Promise<{
    ts: number;
    maint: {
      windowActive: boolean;
      disabled: boolean;
      window: string;
      timezone: string;
      remainSec: number;
    };
    games: LiveDrawGame[];
  }> {
    const roomIds = await this.liveRoomScope(actor);
    const house = await this.liveHouse(actor);
    const scopeKey = roomIds ? [...roomIds].sort().join(',') : 'all';
    const cacheKey = `gamebox:live-draws:${scopeKey}:${house}`;
    try {
      const hit = await this.redis.get(cacheKey);
      if (hit) return JSON.parse(hit) as Awaited<ReturnType<ConsoleLiveService['list']>>;
    } catch {
      /* Redis 挂了就当场算，不挡盯盘 */
    }
    const payload = await this.buildList(roomIds, house);
    this.redis.set(cacheKey, JSON.stringify(payload), 2).catch(() => undefined);
    return payload;
  }

  /** 与报表 ledgerHouse 同一套：平台=flown，总代=agentFly，代理=all */
  private async liveHouse(actor: ConsoleActor): Promise<LiveHouse> {
    if (actor.role === 'ADMIN' || actor.role === 'BRANCH') return 'flown';
    if (await this.scope.isGeneralSide(actor)) return 'agentFly';
    return 'all';
  }

  private async buildList(roomIds: string[] | null, house: LiveHouse) {
    const games = await this.prisma.game.findMany({
      where: { code: { notIn: [...RETIRED_GAME_CODES] } },
      orderBy: [{ sortOrder: 'asc' }, { code: 'asc' }],
      select: {
        id: true,
        code: true,
        name: true,
        category: true,
        status: true,
        sortOrder: true,
      },
    });
    const { dayStartMs } = shanghaiDayOf(Date.now());
    const dayStart = new Date(dayStartMs);
    const now = Date.now();
    const nowDate = new Date(now);
    const windowActive = inDailyMaintWindow(nowDate);
    const maintRemain = dailyMaintRemainSec(nowDate);
    const maint = {
      windowActive,
      disabled: dailyMaintDisabled(),
      window: GAME_OPS_SCHEDULE.maintWindow,
      timezone: GAME_OPS_SCHEDULE.timezone,
      remainSec: maintRemain,
    };

    /* 投注额按下注时间（盯盘要实时），派彩按开奖时间（跟报表/结账同尺） */
    const todayWhere = this.betScope(
      { createdAt: { gte: dayStart }, status: { not: BetStatus.CANCELLED } },
      roomIds,
      house,
    );
    const todayPayoutWhere = this.betScope(
      { settledAt: { gte: dayStart }, status: { in: [BetStatus.WON, BetStatus.LOST] } },
      roomIds,
      house,
    );
    const [todayRows, todayPayoutRows] = await Promise.all([
      this.prisma.bet.groupBy({
        by: ['gameId'],
        where: todayWhere,
        _sum: { amount: true },
        _count: true,
      }),
      this.prisma.bet.groupBy({
        by: ['gameId'],
        where: todayPayoutWhere,
        _sum: { payout: true },
      }),
    ]);
    const todayPayoutMap = new Map(
      todayPayoutRows.map((r) => [r.gameId, asMoney(r._sum.payout ?? 0)]),
    );
    const todayMap = new Map(
      todayRows.map((r) => [
        r.gameId,
        {
          amount: asMoney(r._sum?.amount ?? 0),
          payout: todayPayoutMap.get(r.gameId) ?? 0,
          count: Number(r._count ?? 0),
        },
      ]),
    );

    const lotteryGames = games.filter((g) => g.category === 'LOTTERY');
    const tableGames = games.filter((g) => g.category === 'TABLE');
    const instantGames = games.filter((g) => g.category === 'ARCADE' || g.category === 'SLOT');

    const lotteryLive = await this.loadLottery(lotteryGames, roomIds, now, house);
    const tableLive = await this.loadTable(tableGames, roomIds, house);
    const instantLive = await this.loadInstant(instantGames, roomIds, house);

    const extra = new Map<string, Partial<LiveDrawGame>>();
    for (const row of [...lotteryLive, ...tableLive, ...instantLive]) {
      extra.set(row.code, row);
    }

    const list: LiveDrawGame[] = games.map((g) => {
      const today = todayMap.get(g.id) ?? { amount: 0, payout: 0, count: 0 };
      const more = extra.get(g.code) ?? {};
      const offline = g.status === 'OFFLINE';
      const inMaint = !offline && (g.status === 'MAINTENANCE' || windowActive);
      const phase = offline ? 'OFFLINE' : inMaint ? 'MAINTENANCE' : (more.phase || 'IDLE');
      return {
        code: g.code,
        name: g.name,
        category: g.category,
        status: g.status,
        phase,
        phaseLabel: PHASE_LABEL[phase] || phase,
        issueNo: more.issueNo || '',
        remainSec: inMaint || offline ? 0 : (more.remainSec ?? 0),
        lastDraw: more.lastDraw || '',
        lastIssueNo: more.lastIssueNo || '',
        currentBetAmount: more.currentBetAmount ?? 0,
        currentBetCount: more.currentBetCount ?? 0,
        todayBetAmount: today.amount,
        todayBetCount: today.count,
        todayPayout: today.payout,
        sortOrder: g.sortOrder,
      };
    });

    return { ts: now, maint, games: list };
  }

  /**
   * 水果机猜大小会另开一局 SETTLED，outcome 只有点数没有停格。
   * 盯盘要看转盘停在哪，所以往前翻几局，先拿带 stopIndex 的那一转。
   */
  private async lastInstantRound(
    game: { id: string; code: string },
    roomIds: string[] | null,
    house: LiveHouse = 'all',
  ) {
    const where = {
      gameId: game.id,
      state: 'SETTLED' as const,
      ...(roomIds || house === 'flown'
        ? {
            bets: {
              some: this.betScope(
                { status: { not: BetStatus.CANCELLED } },
                roomIds,
                house,
              ),
            },
          }
        : {}),
    };
    const select = {
      gameId: true,
      roundNo: true,
      totalFlow: true,
      outcome: true,
      endedAt: true,
    };
    if (game.code !== 'fruit-machine') {
      return this.prisma.gameRound.findFirst({
        where,
        orderBy: { endedAt: 'desc' },
        select,
      });
    }
    const recent = await this.prisma.gameRound.findMany({
      where,
      orderBy: { endedAt: 'desc' },
      take: 16,
      select,
    });
    return (
      recent.find((r) => {
        const o = r.outcome as Record<string, unknown> | null;
        return o && typeof o.stopIndex === 'number';
      }) ?? recent[0] ?? null
    );
  }

  /**
   * 实时开奖的房间口径：
   * - 管理：看全平台，不按房隔离
   * - 总监：按授权房间（总代级 + 房间级两道闸门）
   * - 总代：名下全部房间
   * - 代理及子账号：自己绑定的房间
   *
   * null = 不隔离，只有管理是这样。
   *
   * 总监原先在这里放开成全平台，理由是「盯盘是平台视角」。但那等于开了个后门：
   * 屏蔽掉某个总代之后，他名下房间的实时注单、开奖结果照样在这一页上滚，
   * 房号、玩家昵称、金额全都露出来，可见性形同虚设。盯盘也得按管辖范围盯。
   */
  private async liveRoomScope(actor: ConsoleActor): Promise<string[] | null> {
    if (actor.role === 'ADMIN') return null;
    return this.scope.grantedRoomIds(actor);
  }

  private betScope(
    base: Prisma.BetWhereInput,
    roomIds: string[] | null,
    house: LiveHouse = 'all',
  ): Prisma.BetWhereInput {
    /* 三级账本：平台只认飞上来的，总代认代理飞上来的（含自己坐庄），代理认全部 */
    const flownOnly: Prisma.BetWhereInput[] = [
      { payload: { path: ['fly', 'flying'], equals: true } },
      { payload: { path: ['fly', 'flying'], equals: 'true' } },
    ];
    const flown: Prisma.BetWhereInput | undefined =
      house === 'flown'
        ? { OR: flownOnly }
        : house === 'agentFly'
          ? { OR: [...flownOnly, { payload: { path: ['fly', 'sitting'], equals: 'GENERAL' } }] }
          : undefined;
    if (roomIds && !roomIds.length) {
      return { ...base, id: { equals: '__none__' } };
    }
    const roomFilter: Prisma.BetWhereInput | undefined = roomIds
      ? {
          OR: roomIds.map((id) => ({
            payload: { path: ['fly', 'roomId'], equals: id },
          })),
        }
      : undefined;
    const extra = [roomFilter, flown].filter(Boolean) as Prisma.BetWhereInput[];
    if (!extra.length) return base;
    return { AND: [base, ...extra] };
  }

  private async loadLottery(
    games: Array<{ id: string; code: string }>,
    roomIds: string[] | null,
    now: number,
    house: LiveHouse = 'all',
  ): Promise<Array<Partial<LiveDrawGame> & { code: string }>> {
    if (!games.length) return [];
    const ids = games.map((g) => g.id);
    const current = await this.prisma.lotteryIssue.findMany({
      where: { gameId: { in: ids }, status: { in: ['PENDING', 'LOCKED'] } },
      orderBy: { openAt: 'asc' },
      select: {
        id: true,
        gameId: true,
        issueNo: true,
        status: true,
        openAt: true,
        lockAt: true,
      },
    });
    const currentByGame = new Map<string, (typeof current)[number]>();
    for (const row of current) {
      if (!currentByGame.has(row.gameId)) currentByGame.set(row.gameId, row);
    }

    const lastDrawn = await Promise.all(
      games.map((g) =>
        this.prisma.lotteryIssue.findFirst({
          where: { gameId: g.id, status: 'DRAWN' },
          orderBy: { openAt: 'desc' },
          select: { gameId: true, issueNo: true, drawNumbers: true },
        }),
      ),
    );
    const lastByGame = new Map(
      lastDrawn.filter(Boolean).map((r) => [r!.gameId, r!]),
    );

    const issueIds = [...currentByGame.values()].map((r) => r.id);
      const currentBets = issueIds.length
      ? await this.prisma.bet.groupBy({
          by: ['issueId'],
          where: this.betScope(
            { issueId: { in: issueIds }, status: { not: BetStatus.CANCELLED } },
            roomIds,
            house,
          ),
          _sum: { amount: true },
          _count: true,
        })
      : [];
    const betByIssue = new Map(
      currentBets.map((r) => [
        r.issueId || '',
        { amount: asMoney(r._sum?.amount ?? 0), count: Number(r._count ?? 0) },
      ]),
    );

    return games.map((g) => {
      const cur = currentByGame.get(g.id);
      const last = lastByGame.get(g.id);
      const bets = cur ? betByIssue.get(cur.id) : undefined;
      const remain = cur
        ? Math.max(
            0,
            Math.floor(
              ((cur.status === 'LOCKED' ? cur.openAt : cur.lockAt).getTime() - now) / 1000,
            ),
          )
        : 0;
      return {
        code: g.code,
        phase: cur?.status === 'LOCKED' ? 'LOCKED' : cur ? 'BETTING' : last ? 'SETTLED' : 'IDLE',
        issueNo: cur?.issueNo || '',
        remainSec: remain,
        lastDraw: formatLotteryDraw(last?.drawNumbers ?? null),
        lastIssueNo: last?.issueNo || '',
        currentBetAmount: bets?.amount ?? 0,
        currentBetCount: bets?.count ?? 0,
      };
    });
  }

  /**
   * 牌桌类：期号、倒计时、开出结果是同一局的全局事实，人人看到的一样；
   * 但「当期下注」得按各自房间重算，否则代理会看到别家房间的投注热度。
   */
  private async loadTable(
    games: Array<{ code: string }>,
    roomIds: string[] | null,
    house: LiveHouse = 'all',
  ): Promise<Array<Partial<LiveDrawGame> & { code: string }>> {
    const rows = await Promise.all(
      games.map(async (g) => {
        try {
          const snap = await this.table.snapshot(g.code);
          const last = snap.history?.[0];
          const cur = await this.roundBetsInScope(snap.roundNo, roomIds, house);
          return {
            code: g.code,
            phase: snap.phase || 'IDLE',
            issueNo: snap.roundNo || '',
            remainSec: Math.max(0, Math.floor(Number(snap.secondsLeft || 0))),
            lastDraw: formatTableOutcome(last?.outcome),
            lastIssueNo: last?.roundNo || '',
            currentBetAmount: cur.amount,
            currentBetCount: cur.count,
          };
        } catch {
          return { code: g.code, phase: 'IDLE' };
        }
      }),
    );
    return rows;
  }

  /** 某一局在指定房间范围内的下注合计 */
  private async roundBetsInScope(
    roundNo: string | undefined,
    roomIds: string[] | null,
    house: LiveHouse = 'all',
  ) {
    const no = String(roundNo || '').trim();
    if (!no) return { amount: 0, count: 0 };
    if (roomIds && !roomIds.length) return { amount: 0, count: 0 };
    const round = await this.prisma.gameRound.findUnique({
      where: { roundNo: no },
      select: { id: true },
    });
    if (!round) return { amount: 0, count: 0 };
    const agg = await this.prisma.bet.aggregate({
      where: this.betScope(
        { roundId: round.id, status: { not: BetStatus.CANCELLED } },
        roomIds,
        house,
      ),
      _sum: { amount: true },
      _count: true,
    });
    return {
      amount: asMoney(agg._sum?.amount ?? 0),
      count: Number(agg._count ?? 0),
    };
  }

  /**
   * 电子/街机：每一局都是某个玩家自己转的，
   * 收窄范围时只回放本房玩家转出来的最后一局，别把别家房间的结果摆出来。
   */
  private async loadInstant(
    games: Array<{ id: string; code: string }>,
    roomIds: string[] | null,
    house: LiveHouse = 'all',
  ): Promise<Array<Partial<LiveDrawGame> & { code: string }>> {
    if (!games.length) return [];
    const lastRounds = await Promise.all(
      games.map((g) => this.lastInstantRound(g, roomIds, house)),
    );
    return games.map((g, i) => {
      const last = lastRounds[i];
      return {
        code: g.code,
        phase: 'SETTLED',
        issueNo: '',
        remainSec: 0,
        lastDraw: formatInstantOutcome(g.code, last?.outcome),
        lastIssueNo: last?.roundNo || '',
        currentBetAmount: 0,
        currentBetCount: 0,
      };
    });
  }
}

function formatLotteryDraw(raw: string | null): string {
  if (!raw) return '';
  try {
    const v = JSON.parse(raw) as unknown;
    if (Array.isArray(v)) return v.map((n) => String(n)).join('  ');
    if (v && typeof v === 'object') {
      const o = v as Record<string, unknown>;
      if (Array.isArray(o.numbers)) return o.numbers.map((n) => String(n)).join('  ');
      if (Array.isArray(o.balls)) return o.balls.map((n) => String(n)).join('  ');
    }
    return String(raw);
  } catch {
    return String(raw);
  }
}

function formatTableOutcome(outcome?: Record<string, unknown>): string {
  if (!outcome) return '';
  const winner = String(outcome.winner || outcome.result || outcome.side || '').toUpperCase();
  if (TABLE_WIN[winner]) return TABLE_WIN[winner];
  if (winner) return winner;
  try {
    return JSON.stringify(outcome);
  } catch {
    return '';
  }
}

function formatInstantOutcome(gameCode: string, outcome: unknown): string {
  if (!outcome || typeof outcome !== 'object') return '';
  const o = outcome as Record<string, unknown>;
  if (gameCode === 'fruit-machine') {
    const idx = Number(o.stopIndex);
    const cell = Number.isInteger(idx) ? FRUIT_RING[idx] : undefined;
    const kind = cell?.kind || '';
    const award =
      typeof o.awardType === 'string' && o.awardType !== 'normal'
        ? FRUIT_AWARD_LABELS[o.awardType as keyof typeof FRUIT_AWARD_LABELS] || ''
        : '';
    if (kind || award) return [kind, award].filter(Boolean).join('  ');
    /* 猜大小局：没有停格，只回点数 */
    if (o.choice === 'big' || o.choice === 'small') {
      const pick = o.choice === 'big' ? '押大' : '押小';
      const roll = typeof o.roll === 'number' ? `开${o.roll}` : '';
      const res = o.result === 'win' ? '赢' : o.result === 'lose' ? '输' : o.result === 'push' ? '和' : '';
      return [pick, roll, res].filter(Boolean).join('  ');
    }
    return '';
  }
  if (gameCode === 'bcbm') {
    const kind = String(o.kind || '');
    const award =
      typeof o.awardType === 'string' && o.awardType !== 'normal'
        ? BCBM_AWARD_LABELS[o.awardType as keyof typeof BCBM_AWARD_LABELS] || ''
        : '';
    return [kind, award].filter(Boolean).join('  ');
  }
  if (typeof o.label === 'string') return o.label;
  if (typeof o.result === 'string') return o.result;
  return '';
}
