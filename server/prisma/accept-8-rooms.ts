/**
 * 按真人流程验收 6 间房（直挂现金/信用 + 两个总代各带现金/信用房）。
 * 总监一个，能看见两条总代线和直挂房。
 *
 * 运行（开发库）：npx ts-node prisma/accept-8-rooms.ts
 */
import { randomUUID } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { AuthService } from '../src/modules/auth/auth.service';
import { RoomsService } from '../src/modules/rooms/rooms.service';
import { ConsoleRoomsService } from '../src/modules/console/console-rooms.service';
import { ConsolePlayersService } from '../src/modules/console/console-players.service';
import { ConsoleWalletService } from '../src/modules/console/console-wallet.service';
import { ConsoleReportsService } from '../src/modules/console/console-reports.service';
import { ConsoleLiveService } from '../src/modules/console/console-live.service';
import { RoomSettleService } from '../src/modules/console/room-settle.service';
import { GeneralSettleService } from '../src/modules/console/general-settle.service';
import { LotteryService } from '../src/modules/lottery/lottery.service';
import { FruitMachineEngine } from '../src/modules/game-core/fruit-machine-engine';
import { BcbmEngine } from '../src/modules/game-core/bcbm-engine';
import { TableService } from '../src/modules/table/table.service';
import { FundReconService } from '../src/modules/fund-recon/fund-recon.service';
import type { ConsoleActor } from '../src/modules/console/console-scope.service';

const OPS_PASS = 'Gamebox@2026';
const PLAYER_PASS = 'Player@2026';
const GENERAL_FUND = 10_000_000;
const ROOM_FUND = 1_000_000;
const PLAYER_FUND = 50_000;
const MONTHLY_FEE = 1200;
const STAKE = 20;
const PLAYERS_PER_ROOM = 5;

const LOTTERY_PLAYS: Record<string, Array<[string, string | undefined]>> = {
  ffc: [['big', undefined], ['small', undefined], ['odd', undefined]],
  ssc: [['big', undefined], ['small', undefined], ['even', undefined]],
  kuai3: [['big', undefined], ['sum', '10'], ['odd', undefined]],
  bjsc: [['top2big', undefined], ['champion', '1'], ['top2odd', undefined]],
  'speed-racing': [['top2big', undefined], ['champion', '3'], ['top2small', undefined]],
  'speed-boat': [['top2odd', undefined], ['runner', '5'], ['top2even', undefined]],
  lhc: [['big', undefined], ['odd', undefined], ['combo', '大单']],
};

const TABLE_SIDES: Record<string, string[]> = {
  'dragon-tiger': ['dragon', 'tiger'],
  baccarat: ['banker', 'player'],
  zhajinhua: ['banker', 'player'],
  douniu: ['banker', 'player'],
};

let checks = 0;
let failures = 0;
const failLog: string[] = [];
const notes: string[] = [];

function ok(label: string, cond: boolean, detail = '') {
  checks += 1;
  const line = `${cond ? '✔' : '✘'} ${label}${detail ? `  ${detail}` : ''}`;
  console.log(`  ${line}`);
  if (!cond) {
    failures += 1;
    failLog.push(line);
  }
}

const money = (v: unknown) => Math.round(Number(v) * 100) / 100 || 0;
const oid = () => `acc${randomUUID().replace(/-/g, '').slice(0, 20)}`;

type Scene = {
  key: string;
  label: string;
  bookMode: 'CASH' | 'CREDIT';
  generalUserId?: string;
  generalLabel?: string;
  roomId: string;
  roomNo: string;
  agentUserId: string;
  agentUsername: string;
  playerIds: string[];
  playerUsers: string[];
};

async function main() {
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error'] });
  const prisma = app.get(PrismaService);
  const auth = app.get(AuthService);
  const playerRooms = app.get(RoomsService);
  const rooms = app.get(ConsoleRoomsService);
  const players = app.get(ConsolePlayersService);
  const wallet = app.get(ConsoleWalletService);
  const reports = app.get(ConsoleReportsService);
  const live = app.get(ConsoleLiveService);
  const roomSettle = app.get(RoomSettleService);
  const generalSettle = app.get(GeneralSettleService);
  const lottery = app.get(LotteryService);
  const fruit = app.get(FruitMachineEngine);
  const bcbm = app.get(BcbmEngine);
  const table = app.get(TableService);
  const recon = app.get(FundReconService);

  const adminUser = await prisma.user.findFirst({ where: { role: 'ADMIN' } });
  if (!adminUser) throw new Error('没有管理员，先跑 seed');
  const admin: ConsoleActor = { id: adminUser.id, role: 'ADMIN', uid: adminUser.uid };

  const catalog = await prisma.game.findMany({
    where: { status: 'ONLINE' },
    select: { code: true, category: true, name: true },
    orderBy: { sortOrder: 'asc' },
  });
  ok('游戏目录在线', catalog.length >= 13, `共 ${catalog.length} 款`);

  console.log('\n=== 1. 建总监 ===');
  const director = await players.createAgent(admin, {
    username: 'director01',
    password: OPS_PASS,
    nickname: '总监',
    role: 'BRANCH',
  });
  ok('总监已建', !!director.id, director.username);
  const branch: ConsoleActor = { id: director.id, role: 'BRANCH', uid: String(director.uid || '') };

  console.log('\n=== 2. 直挂现金房 ===');
  const scenes: Scene[] = [];

  async function makeRoom(opts: {
    key: string;
    label: string;
    bookMode: 'CASH' | 'CREDIT';
    agentUsername: string;
    generalUserId?: string;
    generalLabel?: string;
    shareRate: number;
  }): Promise<Scene> {
    const created = await rooms.create(admin, {
      name: opts.label,
      bookMode: opts.bookMode,
      generalAgentUserId: opts.generalUserId,
      agentUsername: opts.agentUsername,
      agentPassword: OPS_PASS,
      agentNickname: opts.label.replace(/房$/, '代理'),
      agentShareRate: opts.shareRate,
      monthlyFee: MONTHLY_FEE,
      creditLimit: opts.bookMode === 'CREDIT' ? ROOM_FUND : undefined,
      ownerUserIds: opts.generalUserId ? undefined : [director.id],
    });
    const row = await prisma.room.findUnique({
      where: { id: created.id },
      select: {
        id: true,
        roomNo: true,
        monthlyFee: true,
        ownerAgent: { select: { userId: true, user: { select: { username: true } } } },
      },
    });
    if (!row?.ownerAgent) throw new Error(`建房失败 ${opts.label}`);
    ok(`${opts.label} 房费 1200`, money(row.monthlyFee) === MONTHLY_FEE);
    const scene: Scene = {
      key: opts.key,
      label: opts.label,
      bookMode: opts.bookMode,
      generalUserId: opts.generalUserId,
      generalLabel: opts.generalLabel,
      roomId: row.id,
      roomNo: row.roomNo,
      agentUserId: row.ownerAgent.userId,
      agentUsername: row.ownerAgent.user.username,
      playerIds: [],
      playerUsers: [],
    };
    scenes.push(scene);
    console.log(`  · ${opts.label} 房号=${scene.roomNo} 代理=${scene.agentUsername}`);
    return scene;
  }

  const dcash = await makeRoom({
    key: 'dcash',
    label: '直挂现金房',
    bookMode: 'CASH',
    agentUsername: 'agdcash01',
    shareRate: 0.3,
  });
  await wallet.issue(admin, dcash.agentUserId, ROOM_FUND, '直挂现金上分', oid());
  eqQuota(prisma, dcash.agentUserId, ROOM_FUND, '直挂现金代理额度');

  console.log('\n=== 3. 直挂信用房 ===');
  const dcred = await makeRoom({
    key: 'dcred',
    label: '直挂信用房',
    bookMode: 'CREDIT',
    agentUsername: 'agdcred01',
    shareRate: 0.3,
  });
  eqQuota(prisma, dcred.agentUserId, ROOM_FUND, '直挂信用代理额度');

  console.log('\n=== 4. 现金总代 ===');
  const cashGen = await players.createAgent(admin, {
    username: 'gencash01',
    password: OPS_PASS,
    nickname: '现金总代',
    role: 'GENERAL',
    bookMode: 'CASH',
    shareRate: 0.5,
    flowRate: 0.07,
    roomMonthlyFee: MONTHLY_FEE,
    ownerUserIds: [director.id],
  });
  await wallet.issue(admin, cashGen.id, GENERAL_FUND, '现金总代期初', oid());
  eqQuota(prisma, cashGen.id, GENERAL_FUND, '现金总代额度');
  const cashGenActor: ConsoleActor = { id: cashGen.id, role: 'GENERAL', uid: String(cashGen.uid || '') };

  console.log('\n=== 5. 现金总代 · 现金房 ===');
  const ccash = await makeRoom({
    key: 'ccash',
    label: '现金总代现金房',
    bookMode: 'CASH',
    agentUsername: 'agccash01',
    generalUserId: cashGen.id,
    generalLabel: '现金总代',
    shareRate: 0.2,
  });
  await wallet.issue(cashGenActor, ccash.agentUserId, ROOM_FUND, '总代转代理', oid());
  eqQuota(prisma, ccash.agentUserId, ROOM_FUND, '现金总代现金房代理额度');

  console.log('\n=== 6. 现金总代 · 信用房 ===');
  const ccred = await makeRoom({
    key: 'ccred',
    label: '现金总代信用房',
    bookMode: 'CREDIT',
    agentUsername: 'agccred01',
    generalUserId: cashGen.id,
    generalLabel: '现金总代',
    shareRate: 0.2,
  });
  eqQuota(prisma, ccred.agentUserId, ROOM_FUND, '现金总代信用房代理额度');

  console.log('\n=== 7. 信用总代 ===');
  const credGen = await players.createAgent(admin, {
    username: 'gencred01',
    password: OPS_PASS,
    nickname: '信用总代',
    role: 'GENERAL',
    bookMode: 'CREDIT',
    shareRate: 0.5,
    flowRate: 0.07,
    creditLimit: GENERAL_FUND,
    roomMonthlyFee: MONTHLY_FEE,
    ownerUserIds: [director.id],
  });
  eqQuota(prisma, credGen.id, GENERAL_FUND, '信用总代额度');
  const credGenActor: ConsoleActor = { id: credGen.id, role: 'GENERAL', uid: String(credGen.uid || '') };

  console.log('\n=== 8. 信用总代 · 现金房 ===');
  const xcash = await makeRoom({
    key: 'xcash',
    label: '信用总代现金房',
    bookMode: 'CASH',
    agentUsername: 'agxcash01',
    generalUserId: credGen.id,
    generalLabel: '信用总代',
    shareRate: 0.2,
  });
  await wallet.issue(credGenActor, xcash.agentUserId, ROOM_FUND, '总代转代理', oid());
  eqQuota(prisma, xcash.agentUserId, ROOM_FUND, '信用总代现金房代理额度');

  console.log('\n=== 9. 信用总代 · 信用房 ===');
  const xcred = await makeRoom({
    key: 'xcred',
    label: '信用总代信用房',
    bookMode: 'CREDIT',
    agentUsername: 'agxcred01',
    generalUserId: credGen.id,
    generalLabel: '信用总代',
    shareRate: 0.2,
  });
  eqQuota(prisma, xcred.agentUserId, ROOM_FUND, '信用总代信用房代理额度');

  console.log('\n=== 10. 每间房 5 个玩家：注册 → 申请进房 → 代理审核 → 上分 5 万 ===');
  for (const s of scenes) {
    const agent: ConsoleActor = { id: s.agentUserId, role: 'AGENT' };
    for (let i = 1; i <= PLAYERS_PER_ROOM; i++) {
      const username = `p${s.key}${i}`.padEnd(8, '0').slice(0, 12);
      const nick = `${s.label}玩家${i}`;
      const reg = await auth.register({ username, password: PLAYER_PASS, nickname: nick });
      const playerId = reg.user.id;
      await playerRooms.enter(playerId, s.roomNo);
      const pending = await prisma.roomMember.findFirst({
        where: { playerId, roomId: s.roomId, status: 'PENDING' },
        select: { id: true },
      });
      ok(`${s.label} ${username} 待审`, !!pending?.id);
      if (pending) await rooms.approveMember(agent, pending.id);
      await wallet.creditPlayer(agent, playerId, PLAYER_FUND, s.roomId, '玩家上分', oid());
      const bal = await prisma.pointsAccount.findUnique({
        where: {
          ownerType_ownerId_roomId: { ownerType: 'PLAYER', ownerId: playerId, roomId: s.roomId },
        },
        select: { balance: true },
      });
      ok(`${s.label} ${username} 上分 5 万`, money(bal?.balance) === PLAYER_FUND);
      s.playerIds.push(playerId);
      s.playerUsers.push(username);
    }
  }

  const rebate = await prisma.rebatePolicy.findUnique({ where: { id: 1 } });
  ok('回水政策存在', !!rebate);

  async function drawPending() {
    const rows = await prisma.bet.findMany({
      where: { status: 'PENDING', issueId: { not: null } },
      select: { issueId: true },
      distinct: ['issueId'],
    });
    const past = new Date(Date.now() - 2000);
    for (const r of rows) {
      if (!r.issueId) continue;
      await prisma.lotteryIssue.update({
        where: { id: r.issueId },
        data: { status: 'PENDING', openAt: past, lockAt: new Date(past.getTime() - 1000) },
      });
      try {
        await lottery.draw(r.issueId);
      } catch (e) {
        notes.push(`开奖失败 ${r.issueId}: ${errMsg(e)}`);
      }
    }
  }

  async function betLottery(s: Scene, playerId: string) {
    for (const [code, plays] of Object.entries(LOTTERY_PLAYS)) {
      if (!catalog.some((g) => g.code === code)) continue;
      for (const [betType, betValue] of plays) {
        try {
          await lottery.placeBet(playerId, code, betType, betValue, STAKE, oid(), s.roomNo);
        } catch (e) {
          notes.push(`${s.label} ${code}.${betType} ${errMsg(e)}`);
        }
      }
    }
  }

  async function betArcade(s: Scene, playerId: string) {
    try {
      const spun = await fruit.spin({
        playerId,
        gameCode: 'fruit-machine',
        bets: { apple: STAKE, orange: STAKE },
        clientRequestId: oid(),
        roomNo: s.roomNo,
      });
      const rid = (spun as { roundId?: string }).roundId;
      if (rid) {
        try {
          await fruit.reveal(playerId, rid);
        } catch {
          /* 有的局 spin 已入账 */
        }
      }
    } catch (e) {
      notes.push(`${s.label} 水果机 ${errMsg(e)}`);
    }
    try {
      await bcbm.spin({
        playerId,
        gameCode: 'bcbm',
        bets: { benz_red: STAKE, bmw_green: STAKE },
        clientRequestId: oid(),
        roomNo: s.roomNo,
      });
    } catch (e) {
      notes.push(`${s.label} 奔驰宝马 ${errMsg(e)}`);
    }
  }

  async function waitTableBetting(code: string) {
    const deadline = Date.now() + 25_000;
    while (Date.now() < deadline) {
      try {
        const snap = await table.getOrCreateRoom(code);
        if (snap.phase === 'BETTING' && Date.now() < snap.phaseEndsAt - 1500) return true;
      } catch {
        /* 下一轮再问 */
      }
      await sleep(1500);
    }
    return false;
  }

  async function betAllTables(phase: string) {
    for (const [code, sides] of Object.entries(TABLE_SIDES)) {
      if (!catalog.some((g) => g.code === code)) continue;
      const ready = await waitTableBetting(code);
      if (!ready) {
        notes.push(`${phase} ${code} 25 秒内没等到下注阶段`);
        continue;
      }
      let i = 0;
      for (const s of scenes) {
        for (const pid of s.playerIds) {
          try {
            await table.placeBet(pid, {
              roomId: code,
              side: sides[i++ % sides.length],
              amount: STAKE,
              clientKey: oid().slice(0, 24),
              roomNo: s.roomNo,
            });
          } catch (e) {
            notes.push(`${s.label} ${code} ${errMsg(e)}`);
          }
        }
      }
    }
  }

  async function runBets(phase: '飞盘' | '关盘') {
    console.log(`\n=== ${phase}：每间房 5 人 × 全部游戏 ===`);
    for (const s of scenes) {
      const agent: ConsoleActor = { id: s.agentUserId, role: 'AGENT' };
      await rooms.setRoomFly(agent, s.roomId, phase === '飞盘');
      for (const pid of s.playerIds) {
        await betLottery(s, pid);
        await betArcade(s, pid);
      }
    }
    await betAllTables(phase);
    await drawPending();
  }

  await runBets('飞盘');
  await runBets('关盘');
  await drawPending();

  console.log('\n=== 11. 玩家下分（余额 ≥ 500）===');
  for (const s of scenes) {
    const agent: ConsoleActor = { id: s.agentUserId, role: 'AGENT' };
    for (let i = 0; i < s.playerIds.length; i++) {
      const pid = s.playerIds[i];
      const acc = await prisma.pointsAccount.findUnique({
        where: {
          ownerType_ownerId_roomId: { ownerType: 'PLAYER', ownerId: pid, roomId: s.roomId },
        },
        select: { balance: true },
      });
      const bal = money(acc?.balance);
      if (bal >= 500) {
        try {
          await wallet.debitPlayer(agent, pid, bal, s.roomId, '测完下分', oid());
          ok(`${s.label} ${s.playerUsers[i]} 下分`, true, `额=${bal}`);
        } catch (e) {
          ok(`${s.label} ${s.playerUsers[i]} 下分`, false, errMsg(e));
        }
      } else {
        ok(`${s.label} ${s.playerUsers[i]} 余额不足 500 不下分`, true, `余=${bal}`);
      }
    }
  }

  console.log('\n=== 12. 三方账本 + 隔离 ===');
  const from = new Date(Date.now() - 12 * 3600_000);
  const to = new Date(Date.now() + 12 * 3600_000);

  const adminRooms = await rooms.list(admin, { includeClosed: false });
  ok('管理看见 6 间房', adminRooms.length === 6, `实际=${adminRooms.length}`);

  const branchRooms = await rooms.list(branch, { includeClosed: false });
  ok('总监看见 6 间房', branchRooms.length === 6, `实际=${branchRooms.length}`);

  const cashGenRooms = await rooms.list(cashGenActor, { includeClosed: false });
  ok('现金总代只见自己 2 间', cashGenRooms.length === 2, `实际=${cashGenRooms.length}`);
  ok(
    '现金总代看不到直挂/信用总代房',
    cashGenRooms.every((r) => r.id === ccash.roomId || r.id === ccred.roomId),
  );

  const credGenRooms = await rooms.list(credGenActor, { includeClosed: false });
  ok('信用总代只见自己 2 间', credGenRooms.length === 2, `实际=${credGenRooms.length}`);

  for (const s of scenes) {
    const ag: ConsoleActor = { id: s.agentUserId, role: 'AGENT' };
    const list = await rooms.list(ag, { includeClosed: false });
    ok(`${s.label} 代理只见自己 1 间`, list.length === 1 && list[0]?.id === s.roomId);

    const adminRow = adminRooms.find((r) => r.id === s.roomId);
    const adminFlow = money(adminRow?.todayStats?.betFlow);
    const adminClosed = money(adminRow?.todayStats?.closedBetFlow);
    ok(`${s.label} 管理关盘列为 0`, adminClosed === 0, `关=${adminClosed}`);

    if (s.generalUserId) {
      const gActor: ConsoleActor = { id: s.generalUserId, role: 'GENERAL' };
      const gList = await rooms.list(gActor, { includeClosed: false });
      const gRow = gList.find((r) => r.id === s.roomId);
      const aRow = list[0];
      ok(
        `${s.label} 链路 代理飞=总代接到`,
        money(aRow?.todayStats?.flownBetFlow) === money(gRow?.todayStats?.betFlow),
        `代理飞=${money(aRow?.todayStats?.flownBetFlow)} 总代合计=${money(gRow?.todayStats?.betFlow)}`,
      );
      ok(
        `${s.label} 链路 总代飞=管理接到`,
        money(gRow?.todayStats?.flownBetFlow) === adminFlow,
        `总代飞=${money(gRow?.todayStats?.flownBetFlow)} 管理=${adminFlow}`,
      );
    } else {
      const aRow = list[0];
      ok(
        `${s.label} 直挂 代理飞=管理接到`,
        money(aRow?.todayStats?.flownBetFlow) === adminFlow,
        `代理飞=${money(aRow?.todayStats?.flownBetFlow)} 管理=${adminFlow}`,
      );
    }

    const adminSum = await reports.summary(admin, s.roomId, {
      from: from.toISOString(),
      to: to.toISOString(),
    });
    const agentSum = await reports.summary(
      { id: s.agentUserId, role: 'AGENT' },
      s.roomId,
      { from: from.toISOString(), to: to.toISOString() },
    );
    ok(`${s.label} 管理报表有今日流水字段`, adminSum != null && 'betFlow' in (adminSum as object));
    ok(`${s.label} 代理报表有今日流水字段`, agentSum != null && 'betFlow' in (agentSum as object));
  }

  console.log('\n=== 13. 实时开奖隔离 ===');
  const adminLive = await live.list(admin);
  const cashGenLive = await live.list(cashGenActor);
  ok('管理实时开奖能拉到', Array.isArray(adminLive.games) && adminLive.games.length > 0);
  ok('总代实时开奖能拉到', Array.isArray(cashGenLive.games));

  console.log('\n=== 14. 结账单（本期预览 + 尝试结清）===');
  for (const s of scenes) {
    try {
      const st = await roomSettle.statement(admin, s.roomId, { period: 'current' });
      ok(`${s.label} 房间结账单能出`, !!st, `投注额=${money((st as { totals?: { betFlow?: number } })?.totals?.betFlow)}`);
    } catch (e) {
      ok(`${s.label} 房间结账单`, false, errMsg(e));
    }
    try {
      const res = await roomSettle.markSettled(admin, s.roomId, { early: true, note: '验收提前结' }) as {
        monthlyFeePeriod?: number;
      };
      ok(`${s.label} 提前结账`, true);
      ok(
        `${s.label} 第一次结账就收了月费 1200`,
        money(res.monthlyFeePeriod) === MONTHLY_FEE,
        `收到 ${money(res.monthlyFeePeriod)}`,
      );
    } catch (e) {
      notes.push(`${s.label} 提前结账: ${errMsg(e)}`);
      ok(`${s.label} 提前结账（未关账则记备注）`, true, errMsg(e));
    }
  }

  console.log('\n=== 14b. 结完账之后的账期视图 ===');
  for (const s of scenes) {
    const cur = await roomSettle.statement(admin, s.roomId, { period: 'current' }) as {
      period: { settled: boolean };
      ops: { betFlow: number };
      fees: { monthlyFeePeriod: number };
    };
    const last = await roomSettle.statement(admin, s.roomId, { period: 'last' }) as {
      period: { settled: boolean };
      ops: { betFlow: number };
    };
    ok(`${s.label} 本期不再重复已结流水`, money(cur.ops.betFlow) === 0, `本期流水 ${money(cur.ops.betFlow)}`);
    ok(`${s.label} 本期不重复收月费`, money(cur.fees.monthlyFeePeriod) === 0);
    ok(`${s.label} 上一期显示已结账单`, last.period.settled === true);
    ok(`${s.label} 上一期有流水`, money(last.ops.betFlow) > 0, `上期流水 ${money(last.ops.betFlow)}`);
  }
  for (const g of [
    { id: cashGen.id, label: '现金总代' },
    { id: credGen.id, label: '信用总代' },
  ]) {
    try {
      const st = await generalSettle.statement(admin, { generalUserId: g.id, period: 'current' });
      ok(`${g.label} 总表能出`, !!st);
    } catch (e) {
      ok(`${g.label} 总表`, false, errMsg(e));
    }
    try {
      await generalSettle.settle(admin, g.id, { period: 'current', note: '验收' });
      ok(`${g.label} 总表结清`, true);
    } catch (e) {
      notes.push(`${g.label} 总表结清: ${errMsg(e)}`);
      ok(`${g.label} 总表结清（未关账则记备注）`, true, errMsg(e));
    }
    const gLast = await generalSettle.statement(admin, { generalUserId: g.id, period: 'last' }) as {
      period: { status: string };
      totals: { betFlow: number; roomFee: number };
    };
    ok(`${g.label} 上一期显示已结账期`, gLast.period.status === 'SETTLED');
    ok(`${g.label} 上一期有流水`, money(gLast.totals.betFlow) > 0, `上期流水 ${money(gLast.totals.betFlow)}`);
    ok(
      `${g.label} 上一期收了名下两间房月费`,
      money(gLast.totals.roomFee) === MONTHLY_FEE * 2,
      `月费 ${money(gLast.totals.roomFee)}`,
    );
    const gCur = await generalSettle.statement(admin, { generalUserId: g.id, period: 'current' }) as {
      period: { reopenedAfterSettle?: boolean };
      totals: { betFlow: number; roomFee: number };
      canSettle: boolean;
    };
    ok(`${g.label} 本期不再重复已结流水`, money(gCur.totals.betFlow) === 0, `本期流水 ${money(gCur.totals.betFlow)}`);
    ok(`${g.label} 本期不重复收月费`, money(gCur.totals.roomFee) === 0);
    ok(`${g.label} 本期已结过不能再结`, gCur.canSettle === false);
  }

  console.log('\n=== 15. 资金对账 ===');
  try {
    const run = await recon.run();
    const bad = (run as { totalBad?: number }).totalBad ?? -1;
    ok('对账跑完', true, `不平项=${bad}`);
  } catch (e) {
    ok('对账', false, errMsg(e));
  }

  const betCount = await prisma.bet.count();
  const settled = await prisma.bet.count({ where: { status: { in: ['WON', 'LOST'] } } });
  const pending = await prisma.bet.count({ where: { status: 'PENDING' } });
  ok('有真实注单', betCount > 0, `共 ${betCount} 已结 ${settled} 未结 ${pending}`);

  const accounts = {
    passwordOps: OPS_PASS,
    passwordPlayer: PLAYER_PASS,
    admin: { username: 'admin', password: 'Admin@123456' },
    director: { username: 'director01', password: OPS_PASS },
    cashGeneral: { username: 'gencash01', password: OPS_PASS },
    creditGeneral: { username: 'gencred01', password: OPS_PASS },
    rooms: scenes.map((s) => ({
      label: s.label,
      roomNo: s.roomNo,
      bookMode: s.bookMode,
      agent: s.agentUsername,
      players: s.playerUsers,
    })),
  };
  const outFile = join(__dirname, 'accept-accounts.json');
  writeFileSync(outFile, JSON.stringify(accounts, null, 2), 'utf8');

  console.log('\n======== 账号 ========');
  console.log(JSON.stringify(accounts, null, 2));
  console.log(`\n已写入 ${outFile}`);
  console.log(`\n检查 ${checks}  失败 ${failures}`);
  if (failLog.length) {
    console.log('失败项：');
    for (const x of failLog) console.log(`  ${x}`);
  }
  if (notes.length) {
    console.log(`\n过程备注 ${notes.length} 条（游戏下不了/期号/结账未关账）：`);
    for (const n of notes.slice(0, 40)) console.log(`  - ${n}`);
    if (notes.length > 40) console.log(`  …另有 ${notes.length - 40} 条`);
  }

  await app.close();
  process.exit(failures ? 1 : 0);
}

async function eqQuota(
  prisma: PrismaService,
  userId: string,
  expect: number,
  label: string,
) {
  const a = await prisma.agent.findUnique({ where: { userId }, select: { pointsQuota: true } });
  ok(label, money(a?.pointsQuota) === expect, `实际=${money(a?.pointsQuota)}`);
}

function errMsg(e: unknown) {
  return e instanceof Error ? e.message : String(e);
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
