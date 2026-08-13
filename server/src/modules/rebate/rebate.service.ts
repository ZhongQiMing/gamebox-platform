import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { Prisma } from '@prisma/client';
import { asMoney, formatMoney, roundMoney } from '@gamebox/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { PLATFORM_OWNER_ID, PointsService, type OwnerType } from '../points/points.service';
import { FlyDiskService, type FlyHouse } from '../console/fly-disk.service';
import {
  adjustCashDiskInTx,
  payCreditDiskToPlayerInTx,
} from '../console/player-fund.helper';
import {
  calcRebateFromFlows,
  resolveRebateRate,
  type GameRebateFlow,
} from './rebate-rates';
import { shanghaiRangeBounds, type TimeRangeKey } from '../../common/shanghai-range';

/**
 * 旧版笔结留下的「这笔已发过回水」标记。
 *
 * 现行自助回水靠 periodEnd 游标去重，不再写这个字段——所以新库里它永远是 false。
 * 保留只为老库：那边可能还有带标记的历史注单，删掉这层过滤会把它们重新算进池子，
 * 等于给同一笔流水发两次回水。别当死代码删。
 */
function isFlowRebatePaid(payload: Prisma.JsonValue | null | undefined) {
  return !!(payload as { flowRebatePaid?: boolean } | null)?.flowRebatePaid;
}

const TZ_OFFSET_MS = 8 * 3600 * 1000;
const SCAN_DAYS = 30;
const RATE_CACHE_MS = 5 * 60 * 1000;
/** 单次领取最多结算的注单数（超出部分留到下次领取） */
const CLAIM_BET_LIMIT = 5000;

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

function rebateDateKey(rebateDate: Date) {
  return dateKeyFromParts({
    y: rebateDate.getUTCFullYear(),
    m: rebateDate.getUTCMonth() + 1,
    day: rebateDate.getUTCDate(),
  });
}

interface UnclaimedSlice {
  date: string;
  validFlow: number;
  amount: number;
  rate: number;
  games: GameRebateFlow[];
}

function rebateRoomId(payload: Prisma.JsonValue | null | undefined): string {
  return String((payload as { fly?: { roomId?: string } } | null)?.fly?.roomId || '').trim();
}

/** 新注单持久化下注时 P；历史注单没有时才回退到当前房间配置。 */
function persistedPlayerRate(payload: Prisma.JsonValue | null | undefined): number | null {
  const raw = (payload as { fly?: { P?: unknown } } | null)?.fly?.P;
  return typeof raw === 'number' && Number.isFinite(raw) && raw > 0 && raw <= 1
    ? raw
    : null;
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

  private sliceFromBets(
    bets: Array<{
      validFlow: Prisma.Decimal | number;
      gameId: string;
      payload?: Prisma.JsonValue | null;
    }>,
    roomFallbackP: number,
  ): Omit<UnclaimedSlice, 'date'> | null {
    const gameMap = new Map<string, number>();
    for (const b of bets) {
      const rate = persistedPlayerRate(b.payload) ?? roomFallbackP;
      const key = `${b.gameId}:${rate}`;
      gameMap.set(key, roundMoney((gameMap.get(key) ?? 0) + asMoney(b.validFlow)));
    }
    const items = [...gameMap.entries()].map(([key, validFlow]) => {
      const splitAt = key.lastIndexOf(':');
      const gameId = key.slice(0, splitAt);
      const rate = Number(key.slice(splitAt + 1));
      const meta = this.rateMap.get(gameId);
      return {
        gameCode: meta?.code ?? gameId,
        gameName: meta?.name ?? '未知游戏',
        validFlow,
        rate,
      };
    });
    const calc = calcRebateFromFlows(items);
    if (calc.amount <= 0) return null;
    return calc;
  }

  /**
   * 未领回水：按「该自然日上次领取的 periodEnd」之后的新流水累计进池。
   * 玩家可随时手动领（含今日 0–6 点）；06:00 自动只发昨日及更早未领。
   */
  private async buildUnclaimedMap(playerId: string): Promise<Map<string, UnclaimedSlice>> {
    await this.ensureRateMap();
    const todayKey = dateKeyFromParts(shanghaiParts());
    const oldestKey = shiftDateKey(todayKey, -SCAN_DAYS);
    const [rangeStart] = boundsForDateKey(oldestKey);
    const now = new Date();

    const [settlements, bets] = await Promise.all([
      this.prisma.dailyRebateSettlement.findMany({
        where: {
          playerId,
          rebateDate: { gte: dateAtUtcMidnight(oldestKey) },
        },
        select: { rebateDate: true, roomId: true, periodEnd: true },
        orderBy: { periodEnd: 'asc' },
      }),
      this.prisma.bet.findMany({
        where: {
          playerId,
          status: { in: ['WON', 'LOST'] },
          validFlow: { gt: 0 },
          settledAt: { gte: rangeStart, lte: now },
        },
        select: { validFlow: true, gameId: true, settledAt: true, payload: true },
      }),
    ]);

    const legacyPeriodEndByDate = new Map<string, Date>();
    const lastPeriodEndByDateRoom = new Map<string, Date>();
    for (const s of settlements) {
      const dateKey = rebateDateKey(s.rebateDate);
      const roomId = String(s.roomId || '').trim();
      const map = roomId ? lastPeriodEndByDateRoom : legacyPeriodEndByDate;
      const key = roomId ? `${dateKey}:${roomId}` : dateKey;
      const prev = map.get(key);
      if (!prev || s.periodEnd > prev) map.set(key, s.periodEnd);
    }

    const betsByDateRoom = new Map<
      string,
      Map<string, Array<(typeof bets)[number]>>
    >();
    for (const b of bets) {
      if (!b.settledAt) continue;
      /* 历史笔结已发过的注单，不再进自助池 */
      if (isFlowRebatePaid(b.payload)) continue;
      const dateKey = dateKeyFromDate(b.settledAt);
      const roomId = rebateRoomId(b.payload);
      /* 无房间的历史异常流水无法安全入任一房账本，不展示为可领 */
      if (!roomId) continue;
      const roomCursor = lastPeriodEndByDateRoom.get(`${dateKey}:${roomId}`);
      const legacyCursor = legacyPeriodEndByDate.get(dateKey);
      const since =
        roomCursor && legacyCursor
          ? (roomCursor > legacyCursor ? roomCursor : legacyCursor)
          : roomCursor ?? legacyCursor;
      if (since && b.settledAt <= since) continue;

      let roomMap = betsByDateRoom.get(dateKey);
      if (!roomMap) {
        roomMap = new Map();
        betsByDateRoom.set(dateKey, roomMap);
      }
      const roomBets = roomMap.get(roomId) ?? [];
      roomBets.push(b);
      roomMap.set(roomId, roomBets);
    }

    const result = new Map<string, UnclaimedSlice>();
    for (const [dateKey, roomMap] of betsByDateRoom) {
      const roomSlices: Array<Omit<UnclaimedSlice, 'date'>> = [];
      for (const [roomId, roomBets] of roomMap) {
        const needsFallback = roomBets.some((bet) => persistedPlayerRate(bet.payload) == null);
        const fallbackP = needsFallback
          ? (await this.flyDisk.resolvePlayerRate(playerId, roomId)).P
          : 0;
        const calc = this.sliceFromBets(roomBets, fallbackP);
        if (calc) roomSlices.push(calc);
      }
      if (!roomSlices.length) continue;
      const validFlow = roundMoney(roomSlices.reduce((sum, slice) => sum + slice.validFlow, 0));
      const amount = roundMoney(roomSlices.reduce((sum, slice) => sum + slice.amount, 0));
      result.set(dateKey, {
        date: dateKey,
        validFlow,
        amount,
        rate: validFlow > 0 ? amount / validFlow : 0,
        games: roomSlices.flatMap((slice) => slice.games),
      });
    }
    return result;
  }

  async claimDate(playerId: string, dateKey: string, claimType: 'AUTO' | 'MANUAL') {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) {
      throw new BadRequestException('回水日期无效');
    }
    const todayKey = dateKeyFromParts(shanghaiParts());
    if (dateKey > todayKey) {
      throw new BadRequestException('不能领取未来日期的回水');
    }

    await this.ensureRateMap();
    const [dayStart, dayEnd] = boundsForDateKey(dateKey);

    return this.prisma.$transaction(async (tx) => {
      /* 串行化同一玩家领取，避免并发双发 */
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`rebate:${playerId}`}))`;

      const periodEnd = new Date();
      const until = periodEnd < dayEnd ? periodEnd : new Date(dayEnd.getTime() - 1);
      /*
       * 游标按 (玩家, 日期, 房间) 取；roomId=null 的迁移前记录是跨房共享历史游标，
       * 对所有房间继续生效，避免升级后重复发放。SQL 在库内先排除已领流水，
       * 不会因某房大量历史注单占满 take 而饿死另一房的新流水。
       */
      const rawBets = await tx.$queryRaw<
        Array<{
          validFlow: Prisma.Decimal;
          gameId: string;
          payload: Prisma.JsonValue | null;
          settledAt: Date;
        }>
      >`
        SELECT b."validFlow", b."gameId", b."payload", b."settledAt"
        FROM "Bet" b
        WHERE b."playerId" = ${playerId}
          AND b."status" IN ('WON'::"BetStatus", 'LOST'::"BetStatus")
          AND b."validFlow" > 0
          AND b."settledAt" >= ${dayStart}
          AND b."settledAt" <= ${until}
          AND b."settledAt" < ${dayEnd}
          AND COALESCE(b."payload" #>> '{fly,roomId}', '') <> ''
          AND COALESCE(b."payload" #>> '{flowRebatePaid}', 'false') <> 'true'
          AND b."settledAt" > COALESCE((
            SELECT MAX(s."periodEnd")
            FROM "DailyRebateSettlement" s
            WHERE s."playerId" = ${playerId}
              AND s."rebateDate" = ${dateAtUtcMidnight(dateKey)}::date
              AND (
                s."roomId" = b."payload" #>> '{fly,roomId}'
                OR s."roomId" IS NULL
              )
          ), ${new Date(dayStart.getTime() - 1)})
        ORDER BY b."settledAt" ASC
        LIMIT ${CLAIM_BET_LIMIT}
      `;
      /* 游标只允许推进到“已完整取完”的时间戳；同毫秒边界必须整组纳入。 */
      let pagedBets = rawBets;
      let claimEnd = until;
      if (rawBets.length === CLAIM_BET_LIMIT) {
        const lastAt = rawBets[rawBets.length - 1]!.settledAt;
        if (lastAt) {
          const boundaryBets = await tx.$queryRaw<typeof rawBets>`
            SELECT b."validFlow", b."gameId", b."payload", b."settledAt"
            FROM "Bet" b
            WHERE b."playerId" = ${playerId}
              AND b."status" IN ('WON'::"BetStatus", 'LOST'::"BetStatus")
              AND b."validFlow" > 0
              AND b."settledAt" = ${lastAt}
              AND b."settledAt" >= ${dayStart}
              AND b."settledAt" <= ${until}
              AND b."settledAt" < ${dayEnd}
              AND COALESCE(b."payload" #>> '{fly,roomId}', '') <> ''
              AND COALESCE(b."payload" #>> '{flowRebatePaid}', 'false') <> 'true'
              AND b."settledAt" > COALESCE((
                SELECT MAX(s."periodEnd")
                FROM "DailyRebateSettlement" s
                WHERE s."playerId" = ${playerId}
                  AND s."rebateDate" = ${dateAtUtcMidnight(dateKey)}::date
                  AND (
                    s."roomId" = b."payload" #>> '{fly,roomId}'
                    OR s."roomId" IS NULL
                  )
              ), ${new Date(dayStart.getTime() - 1)})
          `;
          pagedBets = [
            ...rawBets.filter((bet) => bet.settledAt < lastAt),
            ...boundaryBets,
          ];
          claimEnd = lastAt;
        }
      }
      const bets = pagedBets.filter((b) => !isFlowRebatePaid(b.payload));
      const betsByRoom = new Map<string, typeof bets>();
      for (const bet of bets) {
        const roomId = rebateRoomId(bet.payload);
        if (!roomId) continue;
        const roomBets = betsByRoom.get(roomId) ?? [];
        roomBets.push(bet);
        betsByRoom.set(roomId, roomBets);
      }
      if (!betsByRoom.size) throw new BadRequestException('当前无可领取的回水');

      let totalAmount = 0;
      const rows = [];
      for (const [claimRoomId, roomBets] of betsByRoom) {
        const needsFallback = roomBets.some((bet) => persistedPlayerRate(bet.payload) == null);
        const fallbackP = needsFallback
          ? (await this.flyDisk.resolvePlayerRate(playerId, claimRoomId)).P
          : 0;
        const slice = this.sliceFromBets(roomBets, fallbackP);
        if (!slice) continue;
        const house = await this.flyDisk.resolveHouse(playerId, claimRoomId);
        const payerParts = this.splitRebatePayersFromBets(
          roomBets,
          slice.amount,
          slice.validFlow,
          house,
        );
        const row = await tx.dailyRebateSettlement.create({
          data: {
            playerId,
            roomId: claimRoomId,
            rebateDate: dateAtUtcMidnight(dateKey),
            validFlow: slice.validFlow,
            rate: slice.rate,
            amount: slice.amount,
            claimType,
            periodEnd: claimEnd,
            gameDetail: slice.games as unknown as Prisma.InputJsonValue,
          },
        });
        const idem = `daily_rebate_${row.id}`;
        let lastLedgerId: string | undefined;
        for (let i = 0; i < payerParts.length; i++) {
          const part = payerParts[i]!;
          if (part.amount <= 0) continue;
          const ledger = await this.payClaimPartInTx(tx, {
            part,
            playerId,
            house,
            dateKey,
            idem,
            index: i,
            settlementId: row.id,
          });
          if (ledger?.id) lastLedgerId = ledger.id;
        }
        if (!lastLedgerId) throw new BadRequestException('回水出资金额异常');
        rows.push(
          await tx.dailyRebateSettlement.update({
            where: { id: row.id },
            data: { ledgerId: lastLedgerId },
          }),
        );
        totalAmount = roundMoney(totalAmount + slice.amount);
      }
      if (!rows.length) throw new BadRequestException('当前无可领取的回水');
      return { ...rows[0]!, amount: new Prisma.Decimal(totalAmount), settlements: rows };
    });
  }

  /** 自助领取落账：飞盘→平台；关盘→代理盘分/剩余信用 */
  private async payClaimPartInTx(
    tx: Prisma.TransactionClient,
    opts: {
      part: { type: OwnerType; id: string; amount: number; label: string };
      playerId: string;
      house: FlyHouse;
      dateKey: string;
      idem: string;
      index: number;
      settlementId: string;
    },
  ) {
    const { part, playerId, house, dateKey, idem, index, settlementId } = opts;
    const remarkPlayer = `${dateKey} 自助回水`;
    const remarkPayer = `${dateKey} 回水出资(${part.label})`;
    const playerKey = index === 0 ? idem : `${idem}_${part.label}`;

    const playerRoomId = String(house.roomId || '').trim();
    if (!playerRoomId) {
      throw new BadRequestException('回水入账缺少房间');
    }

    if (part.type === 'PLATFORM') {
      const { in: ledger } = await this.points.transferInTx(
        tx,
        {
          type: 'PLATFORM',
          id: PLATFORM_OWNER_ID,
          remark: remarkPayer,
          idempotencyKey: `payer_${idem}_${part.label}`,
        },
        {
          type: 'PLAYER',
          id: playerId,
          roomId: playerRoomId,
          remark: remarkPlayer,
          idempotencyKey: playerKey,
        },
        part.amount,
        { bizType: 'REBATE', refType: 'daily_rebate', refId: settlementId },
      );
      return ledger;
    }

    const agentId = part.id;
    const isCredit = house.bookMode === 'CREDIT';
    if (isCredit) {
      return payCreditDiskToPlayerInTx(tx, this.points, {
        agentUserId: agentId,
        playerId,
        amount: part.amount,
        bizType: 'REBATE',
        remark: remarkPlayer,
        refType: 'daily_rebate',
        refId: settlementId,
        idemPlayer: playerKey,
        roomId: playerRoomId,
      });
    }

    /* 现金关盘：扣代理盘分（余额+上盘额度），加玩家 */
    await adjustCashDiskInTx(tx, this.points, {
      agentUserId: agentId,
      delta: -part.amount,
      bizType: 'REBATE',
      remark: remarkPayer,
      refType: 'daily_rebate',
      refId: settlementId,
      idempotencyKey: `payer_${idem}_${part.label}`,
    });
    return this.points.creditInTx(tx, 'PLAYER', playerId, part.amount, 'REBATE', {
      remark: remarkPlayer,
      refType: 'daily_rebate',
      refId: settlementId,
      idempotencyKey: playerKey,
      roomId: playerRoomId,
    });
  }

  async getStatus(playerId: string, range: RangeKey = 'today') {
    const todayKey = dateKeyFromParts(shanghaiParts());
    const unclaimedMap = await this.buildUnclaimedMap(playerId);

    /* 池内可领合计（含今日）；06:00 自动只发昨日及更早 */
    const claimable = [...unclaimedMap.values()]
      .filter((c) => c.amount > 0)
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
      date: rebateDateKey(r.rebateDate),
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
    /* 不传日期 = 提前领光池内全部（含今日 0–6 点） */
    if (!dateKey) {
      const all = await this.claimAll(playerId, 'MANUAL');
      return {
        ok: all.ok,
        amount: all.amount,
        date: all.dates[all.dates.length - 1] ?? dateKeyFromParts(shanghaiParts()),
        dates: all.dates,
        message: all.message,
      };
    }
    const row = await this.claimDate(playerId, dateKey, 'MANUAL');
    const amount = asMoney(row.amount);
    return {
      ok: true,
      amount,
      date: dateKey,
      dates: [dateKey],
      message: amount > 0 ? `已领取 ${formatMoney(amount)} 积分回水` : '无可领回水',
    };
  }

  /** 可领摘要：待领合计 + 今日预计（供代理回水设置列表） */
  async getClaimableBrief(playerId: string) {
    const todayKey = dateKeyFromParts(shanghaiParts());
    const unclaimedMap = await this.buildUnclaimedMap(playerId);
    const claimableTotal = roundMoney(
      [...unclaimedMap.values()].reduce((s, c) => s + (c.amount > 0 ? c.amount : 0), 0),
    );
    const todayEstimated = roundMoney(unclaimedMap.get(todayKey)?.amount ?? 0);
    return { playerId, claimableTotal, todayEstimated };
  }

  async getClaimableBriefs(playerIds: string[]) {
    const ids = [...new Set(playerIds.map((id) => String(id || '').trim()).filter(Boolean))];
    const list = [];
    for (const id of ids) {
      list.push(await this.getClaimableBrief(id));
    }
    return { list };
  }

  /**
   * 一次领完全部可领日期（含今日，含当日 0–6 点）。
   * 玩家提前领 / 代理代领用 MANUAL；06:00 自动只跑昨日及更早。
   */
  async claimAll(playerId: string, claimType: 'AUTO' | 'MANUAL' = 'MANUAL') {
    const unclaimed = await this.buildUnclaimedMap(playerId);
    const dates = [...unclaimed.values()]
      .filter((c) => c.amount > 0)
      .sort((a, b) => (a.date < b.date ? -1 : 1))
      .map((c) => c.date);
    if (!dates.length) {
      throw new BadRequestException('当前无可领取的回水');
    }
    let total = 0;
    const claimed: string[] = [];
    for (const dateKey of dates) {
      const row = await this.claimDate(playerId, dateKey, claimType);
      total = roundMoney(total + asMoney(row.amount));
      claimed.push(dateKey);
    }
    return {
      ok: true,
      amount: total,
      dates: claimed,
      message: total > 0 ? `已领取 ${formatMoney(total)} 积分回水` : '无可领回水',
    };
  }

  /**
   * 每日 06:00（上海）：自动发放「昨日及更早」仍未手动领的回水。
   * 不含今日（含今日 0–6 点）——该段次日 06:00 才自动发；玩家可随时手动提前领光。
   */
  @Cron('0 6 * * *', { timeZone: 'Asia/Shanghai' })
  async autoSettleYesterday() {
    const todayKey = dateKeyFromParts(shanghaiParts());
    const oldestKey = shiftDateKey(todayKey, -SCAN_DAYS);
    const [rangeStart] = boundsForDateKey(oldestKey);
    const [, todayStart] = boundsForDateKey(shiftDateKey(todayKey, -1));

    const players = await this.prisma.bet.findMany({
      where: {
        status: { in: ['WON', 'LOST'] },
        settledAt: { gte: rangeStart, lt: todayStart },
        validFlow: { gt: 0 },
      },
      distinct: ['playerId'],
      select: { playerId: true },
    });

    let ok = 0;
    let attempts = 0;
    for (const p of players) {
      try {
        const unclaimed = await this.buildUnclaimedMap(p.playerId);
        const dates = [...unclaimed.keys()]
          .filter((d) => d < todayKey && (unclaimed.get(d)?.amount ?? 0) > 0)
          .sort();
        for (const dateKey of dates) {
          attempts++;
          await this.claimDate(p.playerId, dateKey, 'AUTO');
          ok++;
        }
      } catch (e) {
        this.log.warn(`auto rebate failed player=${p.playerId}: ${(e as Error).message}`);
      }
    }
    this.log.log(`daily rebate auto: settled ${ok}/${attempts} slices for ${players.length} players`);
  }

  /**
   * 玩家回水一律由本房代理出（整包 5% 里含给玩家的点）。
   */
  private splitRebatePayersFromBets(
    bets: Array<{ payload: Prisma.JsonValue | null; validFlow: Prisma.Decimal | number }>,
    totalAmount: number,
    _totalFlow: number,
    house: FlyHouse,
  ): Array<{ type: OwnerType; id: string; amount: number; label: string }> {
    if (totalAmount <= 0) return [];
    const agentId = house.agentUserId || (house.type === 'AGENT' ? house.id : '');
    if (agentId) {
      return [{ type: 'AGENT', id: agentId, amount: totalAmount, label: 'agent' }];
    }
    return [{ type: 'PLATFORM', id: PLATFORM_OWNER_ID, amount: totalAmount, label: 'fly' }];
  }
}
