/**
 * 模拟真人操作全流程验收（跑在开发库上，跑完数据留着，可直接登后台肉眼核对）。
 *
 * 完整走一遍：
 *   管理建总代（现金/信用）→ 建房带出代理（4 种总代×房间组合 + 2 种直挂）
 *   → 平台给总代上分 → 总代给代理上分 → 玩家注册进房 → 代理给玩家上分
 *   → 三种坐庄各下注（飞上台 / 总代坐庄 / 代理关盘）→ 开奖派彩
 *   → 分别以管理 / 总代 / 代理身份读「房间中心」「报表中心」「实时开奖」
 *   → 逐项核对显示名称口径、三方数字、以及能不能看到别人的房
 *
 * 运行：pnpm --filter @gamebox/server exec ts-node prisma/e2e-real-flow.ts
 */
import { randomUUID } from 'node:crypto';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { ConsoleRoomsService } from '../src/modules/console/console-rooms.service';
import { ConsolePlayersService } from '../src/modules/console/console-players.service';
import { ConsoleWalletService } from '../src/modules/console/console-wallet.service';
import { ConsoleReportsService } from '../src/modules/console/console-reports.service';
import { ConsoleLiveService } from '../src/modules/console/console-live.service';
import { RoomSettleService } from '../src/modules/console/room-settle.service';
import { GeneralSettleService } from '../src/modules/console/general-settle.service';
import { FlyDiskService } from '../src/modules/console/fly-disk.service';
import { FundReconService } from '../src/modules/fund-recon/fund-recon.service';
import { LotteryService } from '../src/modules/lottery/lottery.service';
import type { ConsoleActor } from '../src/modules/console/console-scope.service';

const PASS = 'Gamebox@2026';
const STAKE = 1_000;

let checks = 0;
let failures = 0;
const failLog: string[] = [];

function ok(label: string, cond: boolean, detail = '') {
  checks += 1;
  if (cond) {
    console.log(`  ✔ ${label}${detail ? `  ${detail}` : ''}`);
  } else {
    failures += 1;
    failLog.push(`${label}${detail ? `  ${detail}` : ''}`);
    console.log(`  ✘ ${label}${detail ? `  ${detail}` : ''}`);
  }
}

/** Decimal 直接比会带精度尾巴，统一转成分为单位的数字再比 */
/** `|| 0` 是为了把 -0 归一，否则 Object.is(-0, 0) 会判不等 */
const asMoneyNum = (v: unknown) => Math.round(Number(v) * 100) / 100 || 0;
const roundTo2 = (n: number) => Math.round(n * 100) / 100 || 0;

/** summary() 在「没有任何房」时会走另一条返回分支，验收里只读交集之外的字段，统一窄化 */
type RepRow = Record<string, number | string | undefined>;
const asRep = (r: unknown) => r as RepRow;

function eq(label: string, actual: unknown, expected: unknown) {
  ok(label, Object.is(actual, expected), `实际=${String(actual)} 期望=${String(expected)}`);
}

async function main() {
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error'],
  });
  const prisma = app.get(PrismaService);
  const rooms = app.get(ConsoleRoomsService);
  const players = app.get(ConsolePlayersService);
  const wallet = app.get(ConsoleWalletService);
  const reports = app.get(ConsoleReportsService);
  const live = app.get(ConsoleLiveService);
  const roomSettle = app.get(RoomSettleService);
  const generalSettle = app.get(GeneralSettleService);
  const fly = app.get(FlyDiskService);
  const lottery = app.get(LotteryService);

  const adminUser = await prisma.user.findFirst({ where: { role: 'ADMIN' } });
  if (!adminUser) throw new Error('库里没有管理员，先跑 seed');
  const admin: ConsoleActor = { id: adminUser.id, role: 'ADMIN', uid: adminUser.uid };
  const tag = Date.now().toString(36).slice(-5);

  console.log('\n=== 1. 管理建总代（现金 / 信用）===');
  const cashGeneral = await players.createAgent(admin, {
    username: `gcash${tag}`,
    password: PASS,
    nickname: `现金总代${tag}`,
    role: 'GENERAL',
    bookMode: 'CASH',
    shareRate: 0.7,
    flowRate: 0.07,
  });
  const creditGeneral = await players.createAgent(admin, {
    username: `gcred${tag}`,
    password: PASS,
    nickname: `信用总代${tag}`,
    role: 'GENERAL',
    bookMode: 'CREDIT',
    creditLimit: 1_000_000,
    shareRate: 0.7,
    flowRate: 0.07,
  });
  ok('现金总代已建', !!cashGeneral?.id, `id=${cashGeneral?.id}`);
  ok('信用总代已建', !!creditGeneral?.id, `id=${creditGeneral?.id}`);

  console.log('\n=== 2. 平台给现金总代上分（信用总代靠合同额度，不需要上分）===');
  await wallet.issue(admin, cashGeneral.id, 500_000, '验收期初', `e2e-${randomUUID().slice(0, 12)}`);
  const cashGeneralAgent = await prisma.agent.findUnique({
    where: { userId: cashGeneral.id },
    select: { pointsQuota: true },
  });
  eq('现金总代额度到账', Number(cashGeneralAgent?.pointsQuota), 500_000);

  console.log('\n=== 2b. 信用总代上下分：跟现金盘同一套动作，差额记在欠款表 ===');
  const credDebt = async () =>
    asMoneyNum(
      (
        await prisma.creditIssueDebt.aggregate({
          where: {
            debtorUserId: creditGeneral.id,
            creditorKind: 'PLATFORM',
            roomId: null,
            remaining: { gt: 0 },
          },
          _sum: { remaining: true },
        })
      )._sum.remaining ?? 0,
    );
  const credQuota = async () =>
    asMoneyNum(
      (
        await prisma.agent.findUnique({
          where: { userId: creditGeneral.id },
          select: { pointsQuota: true },
        })
      )?.pointsQuota ?? 0,
    );

  /* 建号时那笔合同额度本身已经记成一笔欠款，所以基准不是 0，按增量看 */
  const debt0 = await credDebt();
  const quota0 = await credQuota();
  eq('开户合同额度已记为欠平台', debt0, 1_000_000);

  await wallet.issue(admin, creditGeneral.id, 80_000, '验收：信用上分', `e2e-${randomUUID().slice(0, 12)}`);
  eq('上分后额度到账（与现金盘同）', (await credQuota()) - quota0, 80_000);
  eq('上分后欠款同额增加', (await credDebt()) - debt0, 80_000);

  await wallet.recall(admin, creditGeneral.id, 30_000, '验收：信用下分', `e2e-${randomUUID().slice(0, 12)}`);
  eq('下分后额度退回', (await credQuota()) - quota0, 50_000);
  eq('下分冲抵欠款，净差额 50000', (await credDebt()) - debt0, 50_000);

  const credLimitNow = await prisma.agent.findUnique({
    where: { userId: creditGeneral.id },
    select: { creditLimit: true },
  });
  eq('合同额度是风控上限，不被上下分改动', asMoneyNum(credLimitNow?.creditLimit ?? 0), 1_000_000);

  console.log('\n=== 3. 建房（4 种总代组合 + 2 种直挂），建房自动带出代理账号 ===');
  type Scene = {
    label: string;
    roomId: string;
    roomNo: string;
    agentUserId: string;
    generalUserId?: string;
    bookMode: 'CASH' | 'CREDIT';
  };
  const scenes: Scene[] = [];

  async function makeRoom(
    label: string,
    bookMode: 'CASH' | 'CREDIT',
    generalUserId?: string,
  ): Promise<Scene> {
    const suffix = `${scenes.length + 1}`;
    const created = await rooms.create(admin, {
      name: `${label}${tag}`,
      bookMode,
      generalAgentUserId: generalUserId,
      agentUsername: `ag${suffix}${tag}`,
      agentPassword: PASS,
      agentNickname: `代理${suffix}${tag}`,
      agentShareRate: 0.5,
      agentFlowRate: 0.05,
      creditLimit: bookMode === 'CREDIT' ? 300_000 : undefined,
      enabledGames: ['ssc'],
    });
    const row = await prisma.room.findUnique({
      where: { id: created.id },
      select: { id: true, roomNo: true, ownerAgent: { select: { userId: true } } },
    });
    const s: Scene = {
      label,
      roomId: row!.id,
      roomNo: row!.roomNo,
      agentUserId: row!.ownerAgent!.userId,
      generalUserId,
      bookMode,
    };
    scenes.push(s);
    console.log(`  · ${label} 房号=${s.roomNo} 代理=${s.agentUserId.slice(0, 8)}`);
    return s;
  }

  await makeRoom('直挂现金房', 'CASH');
  await makeRoom('直挂信用房', 'CREDIT');
  await makeRoom('现金总代现金房', 'CASH', cashGeneral.id);
  await makeRoom('现金总代信用房', 'CREDIT', cashGeneral.id);
  await makeRoom('信用总代现金房', 'CASH', creditGeneral.id);
  await makeRoom('信用总代信用房', 'CREDIT', creditGeneral.id);
  eq('六种房建成', scenes.length, 6);

  console.log('\n=== 3b. 信用房：上分多少额度就是多少，结账按它算、结完补回它 ===');
  {
    const s = scenes.find((x) => x.label === '直挂信用房')!;
    const limitOf = async () =>
      asMoneyNum(
        (await prisma.room.findUnique({ where: { id: s.roomId }, select: { creditLimit: true } }))
          ?.creditLimit ?? 0,
      );
    eq('建房时给的额度', await limitOf(), 300_000);

    await rooms.bumpCreditLimitByAmount(admin, s.roomId, 100_000, '验收：再上十万', 'up', `e2e-${randomUUID().slice(0, 12)}`);
    eq('上分十万后额度', await limitOf(), 400_000);
    await rooms.bumpCreditLimitByAmount(admin, s.roomId, 100_000, '验收：又上十万', 'up', `e2e-${randomUUID().slice(0, 12)}`);
    eq('再上十万后额度=累计上分额', await limitOf(), 500_000);

    const st = await roomSettle.statement(admin, s.roomId, { period: 'current' });
    const book = st.creditBook!;
    eq('结账基准就是这个额度', asMoneyNum(book.creditLimit), 500_000);
    /* 超出 = 代理手上（盘分+玩家+客服）− 额度；庄家输赢 = −超出 */
    eq('超出=手上合计−额度', asMoneyNum(book.excess), roundTo2(book.sum - 500_000));
    eq('庄家输赢=−超出', asMoneyNum(book.housePnl), roundTo2(-book.excess));
    eq('结完账额度补回原点', roundTo2(book.newQuota + book.playerBalances + book.csBalances), 500_000);
  }

  console.log('\n=== 4. 给各房代理上分（现金房走平台/总代池，信用房建房已带额度）===');
  for (const s of scenes) {
    if (s.bookMode === 'CASH') {
      const payer: ConsoleActor = s.generalUserId
        ? { id: s.generalUserId, role: 'GENERAL' }
        : admin;
      await wallet.issue(
        payer,
        s.agentUserId,
        100_000,
        '验收期初',
        `e2e-${randomUUID().slice(0, 12)}`,
      );
    }
    const a = await prisma.agent.findUnique({
      where: { userId: s.agentUserId },
      select: { pointsQuota: true },
    });
    ok(`${s.label} 代理有盘分`, Number(a?.pointsQuota) > 0, `额度=${Number(a?.pointsQuota)}`);
  }

  console.log('\n=== 5. 玩家注册 → 进房 → 代理给玩家上分 ===');
  const gameSsc = await prisma.game.findUnique({ where: { code: 'ssc' }, select: { id: true } });
  for (const s of scenes) {
    const p = await prisma.user.create({
      data: {
        username: `p${scenes.indexOf(s)}${tag}`,
        passwordHash: 'x',
        uid: String(500_000_000 + scenes.indexOf(s) * 7919 + Number(tag.replace(/\D/g, '') || 1)),
        nickname: `玩家${scenes.indexOf(s)}${tag}`,
        role: 'PLAYER',
      },
      select: { id: true },
    });
    await prisma.roomMember.create({
      data: { playerId: p.id, roomId: s.roomId, status: 'APPROVED', flyEnabled: true },
    });
    const agentActor: ConsoleActor = { id: s.agentUserId, role: 'AGENT' };
    await wallet.creditPlayer(
      agentActor,
      p.id,
      50_000,
      s.roomId,
      '验收上分',
      `e2e${randomUUID().slice(0, 12)}`,
    );
    const bal = await prisma.pointsAccount.findUnique({
      where: {
        ownerType_ownerId_roomId: { ownerType: 'PLAYER', ownerId: p.id, roomId: s.roomId },
      },
      select: { balance: true },
    });
    eq(`${s.label} 玩家上分到账`, Number(bal?.balance), 50_000);
    (s as Scene & { playerId: string }).playerId = p.id;
  }

  console.log('\n=== 6. 真实下注（走 placeBet 扣款）× 三种坐庄，再真实开奖派彩 ===');
  const now = new Date();

  /**
   * 排程器就在这个进程里跑着，期号由它铺、也由它清。
   * 所以不自己造期，下完注从注单反查落在哪一期，再把那期拨到点开奖。
   */
  async function drawPendingIssues() {
    const rows = await prisma.bet.findMany({
      where: { gameId: gameSsc!.id, status: 'PENDING', issueId: { not: null } },
      select: { issueId: true },
      distinct: ['issueId'],
    });
    const past = new Date(Date.now() - 2000);
    for (const r of rows) {
      await prisma.lotteryIssue.update({
        where: { id: r.issueId! },
        data: { status: 'PENDING', openAt: past, lockAt: new Date(past.getTime() - 1000) },
      });
      await lottery.draw(r.issueId!);
    }
  }

  /** 下注按 sitting 需要的开关：玩家飞盘 / 房间整房飞总代 */
  async function setHouse(
    s: Scene & { playerId: string },
    want: 'PLATFORM' | 'GENERAL' | 'AGENT',
  ) {
    await prisma.roomMember.updateMany({
      where: { playerId: s.playerId, roomId: s.roomId },
      data: { flyEnabled: want !== 'AGENT' },
    });
    await prisma.room.update({
      where: { id: s.roomId },
      data: { generalFlyEnabled: want !== 'GENERAL' },
    });
    return fly.resolveHouse(s.playerId, s.roomId, STAKE, { requireRoom: true });
  }

  const sceneList = scenes as (Scene & { playerId: string })[];
  for (const want of ['PLATFORM', 'GENERAL', 'AGENT'] as const) {
    for (const s of sceneList) {
      const house = await setHouse(s, want);
      const expected = want === 'GENERAL' && !s.generalUserId ? 'PLATFORM' : want;
      eq(`${s.label} · ${want} 坐庄判定`, house.sitting, expected);
      await lottery.placeBet(
        s.playerId,
        'ssc',
        'big',
        undefined,
        STAKE,
        `e2e${randomUUID().replace(/-/g, '').slice(0, 24)}`,
        s.roomNo,
      );
    }
    await drawPendingIssues();
  }

  const settled = await prisma.bet.count({
    where: { gameId: gameSsc!.id, status: { in: ['WON', 'LOST'] } },
  });
  eq('18 注全部真实开奖结算', settled, 18);

  /* 账期：把今天整天算作一期 */
  const from = new Date(now.getTime() - 12 * 3600_000);
  const to = new Date(now.getTime() + 12 * 3600_000);

  console.log('\n=== 7. 三方看「房间中心」：项目名称口径 + 数字 + 隔离 ===');
  const withGeneral = (scenes as (Scene & { playerId: string })[]).filter((s) => s.generalUserId);
  const sample = withGeneral[0];

  const adminRooms = await rooms.list(admin, { includeClosed: false });
  eq('管理能看到全部 6 间房', adminRooms.length, 6);
  const adminRow = adminRooms.find((r) => r.id === sample.roomId)!;
  eq('管理·房间今日流水=只算飞上台', adminRow.todayStats.betFlow, STAKE);
  eq('管理·关盘列恒为 0', adminRow.todayStats.closedBetFlow, 0);

  const genActor: ConsoleActor = { id: sample.generalUserId!, role: 'GENERAL' };
  const genRooms = await rooms.list(genActor, { includeClosed: false });
  eq('总代只看到自己名下 2 间房', genRooms.length, 2);
  const genRow = genRooms.find((r) => r.id === sample.roomId)!;
  /* 三级账本各管各的：代理自己关盘那注是代理的账，不进总代的表 */
  eq('总代·合计=代理飞上来的', genRow.todayStats.betFlow, STAKE * 2);
  eq('总代·飞上台', genRow.todayStats.flownBetFlow, STAKE);
  eq('总代·关盘=只有自己坐庄那注', genRow.todayStats.closedBetFlow, STAKE);

  const agActor: ConsoleActor = { id: sample.agentUserId, role: 'AGENT' };
  const agRooms = await rooms.list(agActor, { includeClosed: false });
  eq('代理只看到自己 1 间房', agRooms.length, 1);
  const agRow = agRooms[0];
  eq('代理·合计=飞+关', agRow.todayStats.betFlow, STAKE * 3);
  eq('代理·飞盘含飞到总代', agRow.todayStats.flownBetFlow, STAKE * 2);
  eq('代理·关盘=自己坐庄', agRow.todayStats.closedBetFlow, STAKE);

  /* 三级账本的核心等式：每一级飞出去的，正好是上一级接到的 */
  eq('链路：代理飞出去的 = 总代接到的', agRow.todayStats.flownBetFlow, genRow.todayStats.betFlow);
  eq('链路：总代飞出去的 = 管理接到的', genRow.todayStats.flownBetFlow, adminRow.todayStats.betFlow);
  eq(
    '代理：飞出去 + 自己坐庄 = 接到的',
    roundTo2(agRow.todayStats.flownBetFlow + agRow.todayStats.closedBetFlow),
    agRow.todayStats.betFlow,
  );
  eq(
    '总代：飞出去 + 自己坐庄 = 接到的',
    roundTo2(genRow.todayStats.flownBetFlow + genRow.todayStats.closedBetFlow),
    genRow.todayStats.betFlow,
  );

  ok(
    '隔离：代理看不到别人的房',
    !agRooms.some((r) => r.id !== sample.roomId),
    `看到 ${agRooms.length} 间`,
  );
  ok(
    '隔离：总代看不到另一个总代的房',
    !genRooms.some((r) => r.general && r.general.userId !== sample.generalUserId),
  );

  console.log('\n=== 8. 三方看「报表中心」：结账口径 vs 经营口径 ===');
  const adminRep = asRep(
    await reports.summary(admin, sample.roomId, {
      from: from.toISOString(),
      to: to.toISOString(),
    }),
  );
  eq('管理·报表流水只算飞上台', adminRep.betFlow, STAKE);
  eq('管理·结账口径飞上台', adminRep.flownBetFlow, STAKE);
  eq('管理·关盘 0', adminRep.closedBetFlow, 0);

  const genRep = asRep(
    await reports.summary(genActor, sample.roomId, {
      from: from.toISOString(),
      to: to.toISOString(),
    }),
  );
  eq('总代·经营合计=代理飞上来的', genRep.betFlow, STAKE * 2);
  eq('总代·结账口径只飞上台', genRep.flownBetFlow, STAKE);
  eq('总代·成数差口径', genRep.shareBasis, 'GENERAL_DIFF');

  const agRep = asRep(
    await reports.summary(agActor, sample.roomId, {
      from: from.toISOString(),
      to: to.toISOString(),
    }),
  );
  eq('代理·经营合计含关盘', agRep.betFlow, STAKE * 3);
  eq('代理·结账口径=自己飞出去的', agRep.agentFlyBetFlow, STAKE * 2);
  eq('代理·占成基数口径', agRep.shareBasis, 'HOUSE');

  console.log('\n=== 8b. 同一个数在不同页面必须一致 ===');
  {
    const range = { from: from.toISOString(), to: to.toISOString() };
    const byRoom = await reports.byRoom(admin, { ...range, roomId: sample.roomId });
    const row = byRoom.list.find((r) => r.roomId === sample.roomId)!;
    const sum = asRep(await reports.summary(admin, sample.roomId, range));

    /* 报表「按房明细」与「汇总」是同一间房，占成必须逐项相等 */
    eq('按房明细·平台占成 = 汇总·平台占成', row.platformShareAmount, sum.platformShareAmount);
    eq(
      '三段拆之和 = 飞上台庄家盈亏',
      roundTo2(row.agentShareAmount + row.generalShareAmount + row.platformShareAmount),
      roundTo2(row.flownHousePnl),
    );
    ok(
      '挂总代的房，成数差不为 0 才说明真的三段拆了',
      row.generalShareAmount !== 0 || row.flownHousePnl === 0,
      `成数差=${row.generalShareAmount} 飞上台盈亏=${row.flownHousePnl}`,
    );

    /* 房间总览与结算单是同一期同一间房，庄家盈亏必须相等 */
    const ov = await roomSettle.overview(admin, sample.roomId);
    const st = await roomSettle.statement(admin, sample.roomId, { period: 'current' });
    eq('总览·本期庄家盈亏 = 结算单·交割基数', ov.currentWeek.housePnl, st.share.housePnl);
    ok(
      '总览的本期与上期不是同一个数（信用盘曾用同一份额度快照）',
      ov.currentWeek.housePnl !== ov.lastWeek.housePnl || ov.lastWeek.betFlow === 0,
      `本期=${ov.currentWeek.housePnl} 上期=${ov.lastWeek.housePnl}`,
    );

    /* 信用房同样要对齐 */
    const creditScene = sceneList.find((x) => x.label === '信用总代信用房')!;
    const ovC = await roomSettle.overview(admin, creditScene.roomId);
    const stC = await roomSettle.statement(admin, creditScene.roomId, { period: 'current' });
    eq('信用房·总览庄家盈亏 = 结算单交割基数', ovC.currentWeek.housePnl, stC.share.housePnl);
  }

  console.log('\n=== 8c. 三方各自「我今日净赚」，加起来不能多也不能少 ===');
  {
    const range = { from: from.toISOString(), to: to.toISOString() };
    const a = asRep(await reports.summary(admin, sample.roomId, range));
    const g = asRep(await reports.summary(genActor, sample.roomId, range));
    const ag = asRep(await reports.summary(agActor, sample.roomId, range));

    const num = (v: unknown) => asMoneyNum(v ?? 0);
    console.log(
      `  管理净赚=${num(a.myNetEarning)}  总代净赚=${num(g.myNetEarning)}  代理净赚=${num(ag.myNetEarning)}`,
    );

    /* 三方净赚之和 = 三种坐庄的输赢总和；多一分少一分都是有人的钱没落到位 */
    const total = roundTo2(
      num(a.myNetEarning) + num(g.myNetEarning) + num(ag.myNetEarning),
    );
    const allPnl = roundTo2(num(ag.housePnl));
    eq('三方净赚合计 = 整房输赢', total, allPnl);

    /* 每一方的净赚都不该把别人坐庄的钱算进来 */
    eq('管理·坐庄口径=飞上台', num(a.satHousePnl), num(a.flownHousePnl));
    ok(
      '代理净赚 = 我的占成 + 我坐庄输赢 − 挂靠佣金',
      roundTo2(num(ag.myShareAmount) + num(ag.satHousePnl) - num(ag.commissionAmount)) ===
        num(ag.myNetEarning),
      `占成=${num(ag.myShareAmount)} 坐庄=${num(ag.satHousePnl)} 佣金=${num(ag.commissionAmount)} 净赚=${num(ag.myNetEarning)}`,
    );
  }

  console.log('\n=== 9. 三方看「实时开奖」===');
  const adminLive = await live.list(admin);
  const genLive = await live.list(genActor);
  const agLive = await live.list(agActor);
  const sumToday = (p: { games: { todayBetAmount: number }[] }) =>
    p.games.reduce((n, g) => n + Number(g.todayBetAmount || 0), 0);
  ok('管理·实时开奖只统计飞上台', sumToday(adminLive) >= STAKE, `合计=${sumToday(adminLive)}`);
  ok('总代·实时开奖含关盘', sumToday(genLive) >= STAKE * 3, `合计=${sumToday(genLive)}`);
  ok('代理·实时开奖含关盘', sumToday(agLive) >= STAKE * 3, `合计=${sumToday(agLive)}`);

  console.log('\n=== 10. 结账：房间单 vs 总代总表 ===');
  const roomStmt = await roomSettle.statement(admin, sample.roomId, { period: 'current' });
  eq('房间单结账投注额=代理飞出去的', roomStmt.ops.betFlow, STAKE * 2);
  const genStmt = await generalSettle.statement(admin, {
    generalUserId: sample.generalUserId!,
    period: 'current',
  });
  const line = genStmt.rooms.find((r) => r.roomId === sample.roomId);
  eq('总表这一房只收飞上台', Number(line?.betFlow ?? -1), STAKE);

  console.log('\n=== 11. 越权检查 ===');
  let blocked = false;
  try {
    await generalSettle.statement(
      { id: sample.agentUserId, role: 'AGENT' },
      { generalUserId: sample.generalUserId! },
    );
  } catch {
    blocked = true;
  }
  ok('代理读不到平台↔总代总表', blocked);

  blocked = false;
  try {
    const other = withGeneral.find((s) => s.generalUserId !== sample.generalUserId)!;
    await rooms.detail(agActor, other.roomId);
  } catch {
    blocked = true;
  }
  ok('代理读不到别人的房间详情', blocked);

  blocked = false;
  try {
    await generalSettle.statement(genActor, {
      generalUserId: withGeneral.find((s) => s.generalUserId !== sample.generalUserId)!
        .generalUserId!,
    });
    /* 总代传别人 id 会被强制落回自己，不抛错——核对返回的是自己 */
    blocked = false;
  } catch {
    blocked = true;
  }
  const selfStmt = await generalSettle.statement(genActor, {
    generalUserId: withGeneral.find((s) => s.generalUserId !== sample.generalUserId)!.generalUserId!,
  });
  eq('总代传别人 id 也只能看到自己', selfStmt.general.userId, sample.generalUserId);

  console.log('\n=== 12. 资金对账：整条链路闭不闭环 ===');
  const recon = app.get(FundReconService);
  const report = await recon.run('manual');
  for (const c of report.checks) {
    ok(`对账·${c.label}`, c.bad === 0, c.bad === 0 ? '' : `异常 ${c.bad} 行`);
  }
  eq('对账总判定', report.ok, true);

  console.log('\n======== 结果 ========');
  console.log(`检查 ${checks} 项，失败 ${failures} 项`);
  if (failLog.length) {
    console.log('失败明细：');
    for (const f of failLog) console.log(`  - ${f}`);
  }
  console.log('\n数据已留在开发库，可直接登后台核对：');
  console.log(`  管理员 admin / Admin@123456`);
  console.log(`  现金总代 gcash${tag} / ${PASS}`);
  console.log(`  信用总代 gcred${tag} / ${PASS}`);
  scenes.forEach((s, i) => console.log(`  ${s.label} 房号 ${s.roomNo}，代理 ag${i + 1}${tag} / ${PASS}`));

  await app.close();
  process.exit(failures ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
