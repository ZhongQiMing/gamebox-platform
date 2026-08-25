/**
 * 八种盘口 × 飞盘/关盘 全链路验收（真库）。
 *
 * 覆盖用户点名的全部组合：
 *   直挂现金房 / 直挂信用房
 *   现金总代×现金房 / 现金总代×信用房
 *   信用总代×现金房 / 信用总代×信用房
 * 每种再跑三种坐庄：飞上台 / 总代坐庄 / 代理关盘。
 *
 * 走真实链路：用 FlyDiskService.resolveHouse 判坐庄，用 PointsService 走账，
 * 再用 ConsoleReportsService 按结账口径（开奖时间）聚合，最后核对三张单的钱。
 */
import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { FlyDiskService } from '../src/modules/console/fly-disk.service';
import { ConsoleReportsService } from '../src/modules/console/console-reports.service';
import { PLATFORM_OWNER_ID } from '../src/modules/points/points.service';
import { splitHouseShare, splitAgentFlyingHouse } from '../src/modules/console/share-split.helper';
import { flowViewFor } from '../src/modules/console/flow-scope.helper';
import type { PrismaService } from '../src/prisma/prisma.service';
import type { ConsoleScopeService } from '../src/modules/console/console-scope.service';
import {
  createPointsService,
  createTestPrisma,
  makeUser,
  seedPlayerBalance,
  wipeMoneyTables,
} from './db/money-test-kit';

type BookMode = 'CASH' | 'CREDIT';
type Sitting = 'PLATFORM' | 'GENERAL' | 'AGENT';

/** 一注多少钱，三种坐庄各下一注，数字取整好核对 */
const STAKE = 1_000;
/** 代理成数 50%，总代成数 70% —— 成数差 20% 归总代 */
const AGENT_RATE = 0.5;
const GENERAL_RATE = 0.7;

describe('八种盘口 × 飞盘关盘 全链路', () => {
  let prisma: PrismaClient;
  let fly: FlyDiskService;
  let reports: ConsoleReportsService;
  let gameId: string;
  let roomNoSeq = 300_000;

  beforeAll(async () => {
    prisma = createTestPrisma();
    const points = createPointsService(prisma);
    fly = new FlyDiskService(prisma as unknown as PrismaService, points);
    /* settledRoomAggByHouse 只用 prisma，scope 给个空壳即可 */
    reports = new ConsoleReportsService(
      prisma as unknown as PrismaService,
      {} as unknown as ConsoleScopeService,
    );
    /* 测试库是空库，没有游戏目录；wipeMoneyTables 不动 Game，建一次即可 */
    const game = await prisma.game.upsert({
      where: { code: 'e2e_ssc' },
      update: {},
      create: {
        code: 'e2e_ssc',
        name: '验收彩',
        category: 'LOTTERY',
        status: 'ONLINE',
        drawIntervalSec: 60,
      },
      select: { id: true },
    });
    gameId = game.id;
  });

  afterAll(async () => {
    await wipeMoneyTables(prisma);
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    await wipeMoneyTables(prisma);
  });

  /** 给代理/总代备好盘分：余额与额度同步，可飞额度才算得出来 */
  async function fundAgent(userId: string, amount: number) {
    await prisma.agent.update({
      where: { userId },
      data: { pointsQuota: amount },
    });
    await prisma.pointsAccount.upsert({
      where: {
        ownerType_ownerId_roomId: { ownerType: 'AGENT', ownerId: userId, roomId: '' },
      },
      update: { balance: amount },
      create: { ownerType: 'AGENT', ownerId: userId, roomId: '', balance: amount },
    });
  }

  /**
   * 搭一套完整场景：总代（可选）→ 代理 → 房间 → 玩家。
   * 盘分给足，保证「飞上台」那一注两层都够飞。
   */
  async function scene(opts: { general: BookMode | null; room: BookMode }) {
    roomNoSeq += 1;
    let generalUserId: string | undefined;
    let generalAgentId: string | undefined;

    if (opts.general) {
      generalUserId = await makeUser(prisma, 'GENERAL');
      const g = await prisma.agent.create({
        data: {
          userId: generalUserId,
          bookMode: opts.general,
          pointsQuota: 0,
          shareRate: GENERAL_RATE,
          creditLimit: opts.general === 'CREDIT' ? 1_000_000 : 0,
        },
        select: { id: true },
      });
      generalAgentId = g.id;
      await fundAgent(generalUserId, 500_000);
    }

    const agentUserId = await makeUser(prisma, 'AGENT');
    const agent = await prisma.agent.create({
      data: {
        userId: agentUserId,
        bookMode: opts.room,
        pointsQuota: 0,
        shareRate: AGENT_RATE,
        creditLimit: opts.room === 'CREDIT' ? 500_000 : 0,
      },
      select: { id: true },
    });
    await fundAgent(agentUserId, 200_000);

    const room = await prisma.room.create({
      data: {
        roomNo: String(roomNoSeq),
        name: `验收房${roomNoSeq}`,
        bookMode: opts.room,
        ownerAgentId: agent.id,
        generalAgentId: generalAgentId ?? null,
        agentShareRate: AGENT_RATE,
        generalFlyEnabled: true,
        status: 'OPEN',
      },
      select: { id: true },
    });

    const playerId = await makeUser(prisma);
    await prisma.roomMember.create({
      data: { playerId, roomId: room.id, status: 'APPROVED', flyEnabled: true },
    });
    await seedPlayerBalance(prisma, playerId, room.id, 50_000);

    return { generalUserId, agentUserId, roomId: room.id, playerId, ...opts };
  }

  /** 切换坐庄：靠真实开关，不直接改注单 */
  async function setSitting(
    s: Awaited<ReturnType<typeof scene>>,
    want: Sitting,
  ) {
    await prisma.roomMember.updateMany({
      where: { playerId: s.playerId, roomId: s.roomId },
      data: { flyEnabled: want !== 'AGENT' },
    });
    await prisma.room.update({
      where: { id: s.roomId },
      data: { generalFlyEnabled: want !== 'GENERAL' },
    });
  }

  /**
   * 下一注并开奖。won=true 表示玩家赢（庄家输）。
   * payout 直接写死，方便核对；settledAt 决定它归哪一期。
   */
  async function betAndSettle(
    s: Awaited<ReturnType<typeof scene>>,
    won: boolean,
    settledAt: Date,
  ) {
    const house = await fly.resolveHouse(s.playerId, s.roomId, STAKE, { requireRoom: true });
    const payout = won ? STAKE * 2 : 0;
    await prisma.bet.create({
      data: {
        betNo: `t${randomUUID().slice(0, 20)}`,
        playerId: s.playerId,
        gameId,
        amount: STAKE,
        payout,
        odds: won ? 2 : 0,
        validFlow: STAKE,
        status: won ? 'WON' : 'LOST',
        settledAt,
        payload: {
          fly: {
            type: house.type,
            id: house.id,
            flying: house.flying,
            sitting: house.sitting,
            roomId: house.roomId,
            agentUserId: house.agentUserId,
            generalUserId: house.generalUserId,
            bookMode: house.bookMode,
          },
        } as never,
      },
    });
    return house;
  }

  /** 账期：昨天一整天 */
  const PERIOD_FROM = new Date('2026-08-22T16:00:00.000Z');
  const PERIOD_TO = new Date('2026-08-23T16:00:00.000Z');
  const IN_PERIOD = new Date('2026-08-23T04:00:00.000Z');
  const AFTER_PERIOD = new Date('2026-08-23T20:00:00.000Z');

  /* ── 1. 坐庄判定：八种组合都要判对 ────────────────────────── */

  const combos: Array<{ label: string; general: BookMode | null; room: BookMode }> = [
    { label: '直挂现金房', general: null, room: 'CASH' },
    { label: '直挂信用房', general: null, room: 'CREDIT' },
    { label: '现金总代×现金房', general: 'CASH', room: 'CASH' },
    { label: '现金总代×信用房', general: 'CASH', room: 'CREDIT' },
    { label: '信用总代×现金房', general: 'CREDIT', room: 'CASH' },
    { label: '信用总代×信用房', general: 'CREDIT', room: 'CREDIT' },
  ];

  describe.each(combos)('$label', ({ general, room }) => {
    it('飞盘全开 → 飞上台，平台坐庄', async () => {
      const s = await scene({ general, room });
      await setSitting(s, 'PLATFORM');
      const house = await fly.resolveHouse(s.playerId, s.roomId, STAKE, { requireRoom: true });
      expect(house.flying).toBe(true);
      expect(house.sitting).toBe('PLATFORM');
      expect(house.id).toBe(PLATFORM_OWNER_ID);
      expect(house.roomId).toBe(s.roomId);
      expect(house.bookMode).toBe(room);
    });

    it('代理关盘 → 代理坐庄', async () => {
      const s = await scene({ general, room });
      await setSitting(s, 'AGENT');
      const house = await fly.resolveHouse(s.playerId, s.roomId, STAKE, { requireRoom: true });
      expect(house.flying).toBe(false);
      expect(house.sitting).toBe('AGENT');
      expect(house.id).toBe(s.agentUserId);
    });

    it(
      general ? '总代整房关盘 → 总代坐庄' : '无总代时关整房仍是代理坐庄',
      async () => {
        const s = await scene({ general, room });
        await setSitting(s, 'GENERAL');
        const house = await fly.resolveHouse(s.playerId, s.roomId, STAKE, { requireRoom: true });
        if (general) {
          expect(house.flying).toBe(false);
          expect(house.sitting).toBe('GENERAL');
          expect(house.id).toBe(s.generalUserId);
        } else {
          /* 没挂总代，generalFlyEnabled 这个开关不起作用，照样飞上台 */
          expect(house.flying).toBe(true);
          expect(house.sitting).toBe('PLATFORM');
        }
      },
    );
  });

  /* ── 2. 三种坐庄各下一注，核对三只桶与三张单 ──────────────── */

  describe.each(combos.filter((c) => c.general))('$label · 结账三张单', ({ general, room }) => {
    it('飞上台进总表，飞到总代只进房间单，代理关盘哪张都不进', async () => {
      const s = await scene({ general, room });

      /* A 飞上台：庄家赢（玩家输） */
      await setSitting(s, 'PLATFORM');
      const hA = await betAndSettle(s, false, IN_PERIOD);
      expect(hA.sitting).toBe('PLATFORM');

      /* B 总代坐庄 */
      await setSitting(s, 'GENERAL');
      const hB = await betAndSettle(s, false, IN_PERIOD);
      expect(hB.sitting).toBe('GENERAL');

      /* C 代理关盘 */
      await setSitting(s, 'AGENT');
      const hC = await betAndSettle(s, false, IN_PERIOD);
      expect(hC.sitting).toBe('AGENT');

      const byHouse = await reports.settledRoomAggByHouse([s.roomId], PERIOD_FROM, PERIOD_TO);
      const h = byHouse.get(s.roomId)!;

      /* 飞上台只有 A */
      expect(h.flown.betFlow).toBe(STAKE);
      /* 代理飞出去 = A + B */
      expect(h.agentFly.betFlow).toBe(STAKE * 2);
      /* 总代坐庄那截 = B */
      expect(h.generalSat.betFlow).toBe(STAKE);
      /* 关盘（相对平台）= B + C */
      expect(h.closed.betFlow).toBe(STAKE * 2);

      /* 三注全是庄家赢，盈亏＝流水 */
      expect(h.flown.housePnl).toBe(STAKE);
      expect(h.agentFly.housePnl).toBe(STAKE * 2);

      /*
       * 总表只收飞上台：庄家赢 1000，代理 50% 拿 500，总代成数差 20% 拿 200，平台 30% 拿 300。
       * 期望值写死整数——用 1000*(0.7-0.5) 这种算式自己就有浮点误差，反而测不出真错。
       */
      const generalBill = splitHouseShare(h.flown.housePnl, AGENT_RATE, GENERAL_RATE);
      expect(generalBill.agentShareAmount).toBe(500);
      expect(generalBill.generalShareAmount).toBe(200);
      expect(generalBill.platformShareAmount).toBe(300);

      /* 房间单收代理飞出去的：飞上台三段拆 + 总代坐庄那截平台拿 0 */
      const roomBill = splitAgentFlyingHouse(
        h.flown.housePnl,
        h.generalSat.housePnl,
        AGENT_RATE,
        GENERAL_RATE,
      );
      expect(roomBill.housePnl).toBe(2_000);
      /* 代理两截都拿自己的 50% */
      expect(roomBill.agentShareAmount).toBe(1_000);
      /* 平台只在飞上台那截拿 30% */
      expect(roomBill.platformShareAmount).toBe(300);
    });
  });

  /* ── 3. 三方看到的数字必须对得上 ──────────────────────────── */

  it('三级账本各管各的：每一级飞出去的 = 上一级接到的', async () => {
    const s = await scene({ general: 'CASH', room: 'CASH' });
    await setSitting(s, 'PLATFORM');
    await betAndSettle(s, false, IN_PERIOD);
    await setSitting(s, 'GENERAL');
    await betAndSettle(s, false, IN_PERIOD);
    await setSitting(s, 'AGENT');
    await betAndSettle(s, false, IN_PERIOD);

    const h = (await reports.settledRoomAggByHouse([s.roomId], PERIOD_FROM, PERIOD_TO)).get(
      s.roomId,
    )!;
    const buckets = {
      flown: h.flown.betFlow,
      agentFly: h.agentFly.betFlow,
      all: h.flown.betFlow + h.closed.betFlow,
    };

    const admin = flowViewFor('PLATFORM', buckets);
    const generalView = flowViewFor('GENERAL', buckets);
    const agentView = flowViewFor('AGENT', buckets);

    expect(admin.total).toBe(STAKE);
    expect(admin.closed).toBe(0);

    /* 三级账本各管各的：代理自己关盘那注是代理的账，不进总代的表 */
    expect(generalView.total).toBe(STAKE * 2);
    expect(generalView.flying).toBe(STAKE);
    expect(generalView.closed).toBe(STAKE);

    expect(agentView.total).toBe(STAKE * 3);
    expect(agentView.flying).toBe(STAKE * 2);
    expect(agentView.closed).toBe(STAKE);

    /* 每一级：飞出去 + 自己坐庄 = 接到的 */
    expect(generalView.flying + generalView.closed).toBe(generalView.total);
    expect(agentView.flying + agentView.closed).toBe(agentView.total);
    /* 贯穿链路：每一级飞出去的 = 上一级接到的 */
    expect(agentView.flying).toBe(generalView.total);
    expect(generalView.flying).toBe(admin.total);
  });

  /* ── 4. 归期：派完奖才算这一期 ────────────────────────────── */

  it('跨点未开奖的注落到它开奖的那一期，两期不重不漏', async () => {
    const s = await scene({ general: 'CASH', room: 'CASH' });
    await setSitting(s, 'PLATFORM');

    /* 期内开奖 */
    await betAndSettle(s, false, IN_PERIOD);
    /* 期末下注、次期开奖 */
    await betAndSettle(s, false, AFTER_PERIOD);

    const thisPeriod = (
      await reports.settledRoomAggByHouse([s.roomId], PERIOD_FROM, PERIOD_TO)
    ).get(s.roomId)!;
    const nextPeriod = (
      await reports.settledRoomAggByHouse([s.roomId], PERIOD_TO, new Date('2026-08-24T16:00:00.000Z'))
    ).get(s.roomId)!;

    expect(thisPeriod.flown.betFlow).toBe(STAKE);
    expect(nextPeriod.flown.betFlow).toBe(STAKE);
    /* 两期加起来正好是全部，不重不漏 */
    expect(thisPeriod.flown.betFlow + nextPeriod.flown.betFlow).toBe(STAKE * 2);
  });

  it('还没开奖的注（settledAt 为空）任何一期都不算，结账不会被它卡住', async () => {
    const s = await scene({ general: 'CASH', room: 'CASH' });
    await setSitting(s, 'PLATFORM');
    await betAndSettle(s, false, IN_PERIOD);

    const house = await fly.resolveHouse(s.playerId, s.roomId, STAKE, { requireRoom: true });
    await prisma.bet.create({
      data: {
        betNo: `t${randomUUID().slice(0, 20)}`,
        playerId: s.playerId,
        gameId,
        amount: STAKE,
        payout: 0,
        validFlow: 0,
        status: 'PENDING',
        settledAt: null,
        payload: { fly: { ...house } } as never,
      },
    });

    const h = (await reports.settledRoomAggByHouse([s.roomId], PERIOD_FROM, PERIOD_TO)).get(
      s.roomId,
    )!;
    /* 只认已开奖那一注 */
    expect(h.flown.betFlow).toBe(STAKE);
  });

  /* ── 5. 玩家赢的方向也要对 ───────────────────────────────── */

  it('玩家赢时庄家盈亏为负，占成同方向', async () => {
    const s = await scene({ general: 'CASH', room: 'CASH' });
    await setSitting(s, 'PLATFORM');
    await betAndSettle(s, true, IN_PERIOD);

    const h = (await reports.settledRoomAggByHouse([s.roomId], PERIOD_FROM, PERIOD_TO)).get(
      s.roomId,
    )!;
    /* 下注 1000、派彩 2000 → 庄家亏 1000 */
    expect(h.flown.betFlow).toBe(STAKE);
    expect(h.flown.payout).toBe(STAKE * 2);
    expect(h.flown.housePnl).toBe(-STAKE);

    const split = splitHouseShare(h.flown.housePnl, AGENT_RATE, GENERAL_RATE);
    expect(split.agentShareAmount).toBe(-500);
    expect(split.platformShareAmount).toBe(-300);
  });
});
