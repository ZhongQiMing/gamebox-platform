import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { Prisma } from '@prisma/client';
import { asMoney, formatMoney, roundMoney } from '@gamebox/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { PLATFORM_OWNER_ID, PointsService, type OwnerType } from '../points/points.service';
import { FlyDiskService } from '../console/fly-disk.service';
import {
  calcRebateFromFlows,
  resolveRebateRate,
  type GameRebateFlow,
} from './rebate-rates';
import { shanghaiRangeBounds, type TimeRangeKey } from '../../common/shanghai-range';

const TZ_OFFSET_MS = 8 * 3600 * 1000;
const SCAN_DAYS = 30;
const RATE_CACHE_MS = 5 * 60 * 1000;

type RangeKey = TimeRangeKey;

function shanghaiParts(d = new Date()) {
  const t = d.getTime() + TZ_OFFSET_MS;
  const u = new Date(t);
  return {
    y: u.getUTCFullYear(),
    m: u.getUTCMonth() + 1,
    day: u.getUTCDate(),
  };
}

function dateKeyFromParts(p: { y: number; m: number; day: number }) {
  return `${p.y}-${String(p.m).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`;
}

function dateKeyFromDate(d: Date) {
  const t = d.getTime() + TZ_OFFSET_MS;
  const u = new Date(t);
  return dateKeyFromParts({
    y: u.getUTCFullYear(),
    m: u.getUTCMonth() + 1,
    day: u.getUTCDate(),
  });
}

function shiftDateKey(key: string, deltaDays: number) {
  const [y, m, d] = key.split('-').map(Number);
  const utc = Date.UTC(y, m - 1, d + deltaDays);
  const u = new Date(utc);
  return dateKeyFromParts({ y: u.getUTCFullYear(), m: u.getUTCMonth() + 1, day: u.getUTCDate() });
}

function boundsForDateKey(key: string): [Date, Date] {
  const [y, m, d] = key.split('-').map(Number);
  const start = new Date(Date.UTC(y, m - 1, d, 0, 0, 0) - TZ_OFFSET_MS);
  const end = new Date(Date.UTC(y, m - 1, d + 1, 0, 0, 0) - TZ_OFFSET_MS);
  return [start, end];
}

function dateAtUtcMidnight(key: string) {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

interface UnclaimedSlice {
  date: string;
  validFlow: number;
  amount: number;
  rate: number;
  games: GameRebateFlow[];
}

@Injectable()
export class RebateService {
  private readonly log = new Logger(RebateService.name);
  private rateMap = new Map<string, { code: string; name: string; rate: number }>();
  /** 回水率缓存有效期：后台改 GameConfig 后无需重启即可生效 */
  private rateMapExpiresAt = 0;

  constructor(
    private prisma: PrismaService,
    private points: PointsService,
    private flyDisk: FlyDiskService,
  ) {}

  private async ensureRateMap() {
    if (this.rateMap.size && Date.now() < this.rateMapExpiresAt) return;
    const games = await this.prisma.game.findMany({
      include: { configs: { where: { active: true }, take: 1 } },
    });
    this.rateMap.clear();
    for (const g of games) {
      const params = g.configs[0]?.params;
      this.rateMap.set(g.id, {
        code: g.code,
        name: g.name,
        rate: resolveRebateRate(g.code, g.category, params),
      });
    }
    this.rateMapExpiresAt = Date.now() + RATE_CACHE_MS;
  }

  /** 批量计算各日未领回水（内存聚合，避免逐日查库） */
  private async buildUnclaimedMap(playerId: string): Promise<Map<string, UnclaimedSlice>> {
    await this.ensureRateMap();
    const todayKey = dateKeyFromParts(shanghaiParts());
    const oldestKey = shiftDateKey(todayKey, -SCAN_DAYS);
    const [rangeStart] = boundsForDateKey(oldestKey);
    const [, rangeEnd] = boundsForDateKey(todayKey);

    const [settlements, bets] = await Promise.all([
      this.prisma.dailyRebateSettlement.findMany({
        where: {
          playerId,
          rebateDate: { gte: dateAtUtcMidnight(oldestKey) },
        },
        select: { rebateDate: true, periodEnd: true },
        orderBy: { periodEnd: 'asc' },
      }),
      this.prisma.bet.findMany({
        where: {
          playerId,
          status: { in: ['WON', 'LOST'] },
          validFlow: { gt: 0 },
          settledAt: { gte: rangeStart, lt: rangeEnd },
        },
        select: { validFlow: true, gameId: true, settledAt: true, payload: true },
      }),
    ]);

    const { P: defaultP } = await this.flyDisk.resolvePlayerRate(playerId);

    /* 一日一领：已有结算的日期整日不再进待领（避免领完仍显示、点领取却报「已领取」） */
    const claimedDates = new Set<string>();
    for (const s of settlements) {
      claimedDates.add(
        dateKeyFromParts({
          y: s.rebateDate.getUTCFullYear(),
          m: s.rebateDate.getUTCMonth() + 1,
          day: s.rebateDate.getUTCDate(),
        }),
      );
    }

    const flowByDateGame = new Map<string, Map<string, number>>();
    for (const b of bets) {
      if (!b.settledAt) continue;
      const dateKey = dateKeyFromDate(b.settledAt);
      if (claimedDates.has(dateKey)) continue;

      let gameMap = flowByDateGame.get(dateKey);
      if (!gameMap) {
        gameMap = new Map();
        flowByDateGame.set(dateKey, gameMap);
      }
      gameMap.set(b.gameId, roundMoney((gameMap.get(b.gameId) ?? 0) + asMoney(b.validFlow)));
    }

    const result = new Map<string, UnclaimedSlice>();
    for (const [dateKey, gameMap] of flowByDateGame) {
      const items = [...gameMap.entries()].map(([gameId, validFlow]) => {
        const meta = this.rateMap.get(gameId);
        return {
          gameCode: meta?.code ?? gameId,
          gameName: meta?.name ?? '未知游戏',
          validFlow,
          rate: defaultP,
        };
      });
      const calc = calcRebateFromFlows(items);
      if (calc.amount > 0) {
        result.set(dateKey, { date: dateKey, ...calc });
      }
    }
    return result;
  }

  async claimDate(playerId: string, dateKey: string, claimType: 'AUTO' | 'MANUAL') {
    const todayKey = dateKeyFromParts(shanghaiParts());
    /* T+1 结算：当日流水次日才可领，否则领取后新增的流水会因唯一约束永远领不到 */
    if (dateKey >= todayKey) {
      throw new BadRequestException('今日回水将于明日结算');
    }

    const unclaimed = await this.buildUnclaimedMap(playerId);
    const slice = unclaimed.get(dateKey);
    if (!slice || slice.amount <= 0) {
      throw new BadRequestException('当前无可领取的回水');
    }

    const periodEnd = new Date();
    /* 幂等键不含时间戳：同一玩家同一天的领取动作只认一次，重试不会重复到账 */
    const idem = `daily_rebate_${playerId}_${dateKey}`;

    try {
      return await this.prisma.$transaction(async (tx) => {
        /* 先抢占当日结算记录，唯一约束把并发请求挡在扣款之前 */
        const row = await tx.dailyRebateSettlement.create({
          data: {
            playerId,
            rebateDate: dateAtUtcMidnight(dateKey),
            validFlow: slice.validFlow,
            rate: slice.rate,
            amount: slice.amount,
            claimType,
            periodEnd,
            gameDetail: slice.games as unknown as Prisma.InputJsonValue,
          },
        });

        const payer = await this.resolveRebatePayer(playerId, dateKey);
        const { in: ledger } = await this.points.transferInTx(
          tx,
          {
            type: payer.type,
            id: payer.id,
            remark: `${dateKey} 回水出资`,
            idempotencyKey: `payer_${idem}`,
          },
          {
            type: 'PLAYER',
            id: playerId,
            remark: `${dateKey} 自助回水`,
            idempotencyKey: idem,
          },
          slice.amount,
          { bizType: 'REBATE', refType: 'daily_rebate', refId: dateKey },
        );

        return tx.dailyRebateSettlement.update({
          where: { id: row.id },
          data: { ledgerId: ledger.id },
        });
      });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw new BadRequestException(`${dateKey} 的回水已领取`);
      }
      throw e;
    }
  }

  async getStatus(playerId: string, range: RangeKey = 'today') {
    const todayKey = dateKeyFromParts(shanghaiParts());
    const unclaimedMap = await this.buildUnclaimedMap(playerId);

    /* 今日流水只作预估展示，次日才进可领列表（与 UI「今日累计·明日结算」一致） */
    const claimable = [...unclaimedMap.values()]
      .filter((c) => c.date < todayKey)
      .sort((a, b) => (a.date < b.date ? 1 : -1));
    const claimableTotal = roundMoney(claimable.reduce((s, c) => s + c.amount, 0));
    const todaySlice = unclaimedMap.get(todayKey) ?? {
      date: todayKey,
      validFlow: 0,
      amount: 0,
      rate: 0,
      games: [] as GameRebateFlow[],
    };

    const [from, to] = shanghaiRangeBounds(range);
    const historyRows = await this.prisma.dailyRebateSettlement.findMany({
      where: {
        playerId,
        claimedAt: { gte: from, lt: to },
      },
      orderBy: { claimedAt: 'desc' },
      take: 200,
    });

    const history = historyRows.map((r) => ({
      id: r.id,
      date: dateKeyFromParts({
        y: r.rebateDate.getUTCFullYear(),
        m: r.rebateDate.getUTCMonth() + 1,
        day: r.rebateDate.getUTCDate(),
      }),
      validFlow: asMoney(r.validFlow),
      amount: asMoney(r.amount),
      claimType: r.claimType as 'AUTO' | 'MANUAL',
      claimedAt: r.claimedAt.toISOString(),
      games: (r.gameDetail as GameRebateFlow[] | null) ?? [],
    }));

    return {
      claimableTotal,
      today: {
        date: todayKey,
        validFlow: todaySlice.validFlow,
        estimatedRebate: todaySlice.amount,
        games: todaySlice.games,
      },
      claimable: claimable.map((c) => ({
        date: c.date,
        validFlow: c.validFlow,
        amount: c.amount,
        games: c.games,
      })),
      history,
    };
  }

  async claim(playerId: string, dateKey?: string) {
    const target = dateKey ?? shiftDateKey(dateKeyFromParts(shanghaiParts()), -1);
    const row = await this.claimDate(playerId, target, 'MANUAL');
    const amount = asMoney(row.amount);
    return {
      ok: true,
      amount,
      date: target,
      message: amount > 0 ? `已领取 ${formatMoney(amount)} 积分回水` : '无可领回水',
    };
  }

  @Cron('0 6 * * *', { timeZone: 'Asia/Shanghai' })
  async autoSettleYesterday() {
    const yesterdayKey = shiftDateKey(dateKeyFromParts(shanghaiParts()), -1);
    const [start, end] = boundsForDateKey(yesterdayKey);
    const players = await this.prisma.bet.findMany({
      where: {
        status: { in: ['WON', 'LOST'] },
        settledAt: { gte: start, lt: end },
        validFlow: { gt: 0 },
      },
      distinct: ['playerId'],
      select: { playerId: true },
    });

    let ok = 0;
    for (const p of players) {
      try {
        const unclaimed = await this.buildUnclaimedMap(p.playerId);
        if (!unclaimed.has(yesterdayKey)) continue;
        await this.claimDate(p.playerId, yesterdayKey, 'AUTO');
        ok++;
      } catch (e) {
        this.log.warn(`auto rebate failed player=${p.playerId}: ${(e as Error).message}`);
      }
    }
    this.log.log(`daily rebate ${yesterdayKey}: settled ${ok}/${players.length} players`);
  }

  /** 领取出资方：当日若有飞盘注单则从 ROOM 出，否则从房间代理出 */
  private async resolveRebatePayer(
    playerId: string,
    dateKey: string,
  ): Promise<{ type: OwnerType; id: string }> {
    const [from, to] = boundsForDateKey(dateKey);
    const bets = await this.prisma.bet.findMany({
      where: {
        playerId,
        status: { in: ['WON', 'LOST'] },
        validFlow: { gt: 0 },
        settledAt: { gte: from, lt: to },
      },
      select: { payload: true },
      take: 500,
    });
    for (const b of bets) {
      const fly = (b.payload as {
        fly?: { flying?: boolean; roomId?: string };
      } | null)?.fly;
      if (fly?.flying && fly.roomId) return { type: 'ROOM', id: fly.roomId };
    }
    const house = await this.flyDisk.resolveHouse(playerId);
    if (house.agentUserId) return { type: 'AGENT', id: house.agentUserId };
    if (house.type !== 'PLATFORM') return { type: house.type, id: house.id };
    return { type: 'PLATFORM', id: PLATFORM_OWNER_ID };
  }
}
