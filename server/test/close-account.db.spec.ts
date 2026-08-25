/**
 * 玩家自助注销（连真实 Postgres）。
 *
 * 注销不可逆，且直接关系到「玩家的钱还在不在平台里」，
 * 所以每一条拦截规则都要钉死：余额、冻结、待审单、未结注单、未领回水。
 */
import * as bcrypt from 'bcrypt';
import type { PrismaClient } from '@prisma/client';
import { UsersService } from '../src/modules/users/users.service';
import { PLATFORM_OWNER_ID } from '../src/modules/points/points.service';
import type { PrismaService } from '../src/prisma/prisma.service';
import type { RebateService } from '../src/modules/rebate/rebate.service';
import {
  createPointsService,
  createTestPrisma,
  drainPlatformQueue,
  ledgerSum,
  makeUser,
  readBalance,
  seedPlayerBalance,
  wipeMoneyTables,
} from './db/money-test-kit';

const ROOM = 'room-close-test';
const PASSWORD = 'pw123456';

let prisma: PrismaClient;
let users: UsersService;
let claimable = 0;

const rebateStub = {
  getClaimableBrief: (playerId: string) =>
    Promise.resolve({ playerId, claimableTotal: claimable, todayEstimated: 0 }),
} as unknown as RebateService;

/** 建一个能通过密码校验的玩家 */
async function makePlayer(): Promise<string> {
  const id = await makeUser(prisma);
  await prisma.user.update({
    where: { id },
    data: { passwordHash: await bcrypt.hash(PASSWORD, 10) },
  });
  return id;
}

beforeAll(async () => {
  prisma = createTestPrisma();
  users = new UsersService(
    prisma as unknown as PrismaService,
    rebateStub,
    createPointsService(prisma),
  );
  await wipeMoneyTables(prisma);
});

beforeEach(() => {
  claimable = 0;
});

afterAll(async () => {
  await wipeMoneyTables(prisma);
  await prisma.$disconnect();
});

describe('注销前置检查', () => {
  it('干净账号可以注销', async () => {
    const id = await makePlayer();
    const check = await users.closeAccountCheck(id);
    expect(check.closable).toBe(true);
    expect(check.blockers).toEqual([]);
  });

  it('有余额只警告不拦：下分最低 500，拦住会让小额玩家永远注销不了', async () => {
    const id = await makePlayer();
    await seedPlayerBalance(prisma, id, ROOM, 88.5);

    const check = await users.closeAccountCheck(id);

    expect(check.closable).toBe(true);
    expect(check.warnings.map((w) => w.code)).toContain('BALANCE');
    expect(check.warnings.find((w) => w.code === 'BALANCE')?.message).toContain('88.50');
  });

  it('多房余额要合起来算，不能只看一个房', async () => {
    const id = await makePlayer();
    await seedPlayerBalance(prisma, id, 'room-a', 10);
    await seedPlayerBalance(prisma, id, 'room-b', 5);

    const check = await users.closeAccountCheck(id);

    expect(check.balance).toBe(15);
  });

  it('钱卡在下分审核里也要拦', async () => {
    const id = await makePlayer();
    const account = await prisma.pointsAccount.create({
      data: { ownerType: 'PLAYER', ownerId: id, roomId: ROOM, balance: 0, frozen: 50 },
      select: { id: true },
    });
    expect(account.id).toBeTruthy();

    const check = await users.closeAccountCheck(id);

    expect(check.blockers.map((b) => b.code)).toContain('FROZEN');
  });

  it('有未领回水时提醒会作废，但不拦', async () => {
    const id = await makePlayer();
    claimable = 12.34;

    const check = await users.closeAccountCheck(id);

    expect(check.closable).toBe(true);
    expect(check.warnings.map((w) => w.code)).toContain('REBATE');
  });

  it('代理和客服不能自助注销', async () => {
    const id = await makeUser(prisma, 'AGENT');
    const check = await users.closeAccountCheck(id);
    expect(check.closable).toBe(false);
    expect(check.blockers[0]?.code).toBe('ROLE');
  });
});

describe('注销执行', () => {
  it('密码不对不给注销', async () => {
    const id = await makePlayer();
    await expect(users.closeAccount(id, 'wrong-password')).rejects.toThrow('密码不正确');
    const after = await prisma.user.findUnique({ where: { id }, select: { status: true } });
    expect(after?.status).toBe('ACTIVE');
  });

  it('残额清零后转回平台池，不进代理口袋，两侧都记账', async () => {
    const id = await makePlayer();
    const accountId = await seedPlayerBalance(prisma, id, ROOM, 20);
    const platformBefore = await readBalance(prisma, 'PLATFORM', PLATFORM_OWNER_ID);

    const res = await users.closeAccount(id, PASSWORD);

    expect(res.forfeited).toBe(20);
    expect(await readBalance(prisma, 'PLAYER', id, ROOM)).toBe(0);
    /* 平台侧是先记账、余额由合并工人补，所以先排空队列再读 */
    await drainPlatformQueue(prisma);
    expect(await readBalance(prisma, 'PLATFORM', PLATFORM_OWNER_ID)).toBe(platformBefore + 20);
    /* 对账不变量：玩家侧流水合计仍等于余额 0 */
    expect(await ledgerSum(prisma, accountId)).toBe(0);
  });

  it('多房都有钱时逐个清零，合计对得上', async () => {
    const id = await makePlayer();
    await seedPlayerBalance(prisma, id, 'room-x', 30);
    await seedPlayerBalance(prisma, id, 'room-y', 12.5);

    const res = await users.closeAccount(id, PASSWORD);

    expect(res.forfeited).toBe(42.5);
    expect(await readBalance(prisma, 'PLAYER', id, 'room-x')).toBe(0);
    expect(await readBalance(prisma, 'PLAYER', id, 'room-y')).toBe(0);
  });

  it('冻结中的钱仍然拦住注销，代理可能马上要打款', async () => {
    const id = await makePlayer();
    await prisma.pointsAccount.create({
      data: { ownerType: 'PLAYER', ownerId: id, roomId: ROOM, balance: 0, frozen: 600 },
    });

    await expect(users.closeAccount(id, PASSWORD)).rejects.toThrow('下分审核');

    const after = await prisma.user.findUnique({ where: { id }, select: { status: true } });
    expect(after?.status).toBe('ACTIVE');
  });

  it('注销后置为 CLOSED、清个人信息、顶掉登录态', async () => {
    const id = await makePlayer();
    const before = await prisma.user.findUnique({
      where: { id },
      select: { username: true, tokenVersion: true },
    });

    await users.closeAccount(id, PASSWORD);

    const after = await prisma.user.findUnique({
      where: { id },
      select: {
        status: true, username: true, nickname: true,
        avatar: true, lastLoginIp: true, promoCode: true, tokenVersion: true,
      },
    });
    expect(after?.status).toBe('CLOSED');
    expect(after?.avatar).toBeNull();
    expect(after?.lastLoginIp).toBeNull();
    expect(after?.promoCode).toBeNull();
    expect(after?.nickname).toMatch(/^已注销/);
    /* 账号名保留占用：注销过的号不能被人拿去重开 */
    expect(after?.username).toBe(before?.username);
    /* tokenVersion 变了，手机上那张旧 JWT 下一次请求就失效 */
    expect(after?.tokenVersion).toBe((before?.tokenVersion ?? 0) + 1);
  });

  it('旧账目一条都不删，只多一条注销凭证', async () => {
    const id = await makePlayer();
    const accountId = await seedPlayerBalance(prisma, id, ROOM, 0);
    const ledgerBefore = await prisma.pointsLedger.count({ where: { accountId } });

    const res = await users.closeAccount(id, PASSWORD);

    expect(await prisma.pointsLedger.count({ where: { accountId } })).toBe(ledgerBefore + 1);
    expect(await prisma.user.count({ where: { id } })).toBe(1);

    const mark = await prisma.pointsLedger.findFirst({
      where: { accountId, refType: 'account_close' },
      select: { amount: true, refId: true, remark: true },
    });
    expect(mark?.refId).toBe(res.orderNo);
    expect(Number(mark?.amount)).toBe(0);
    expect(mark?.remark).toContain(res.orderNo);
  });

  it('注销凭证金额为 0，不破坏「流水合计等于余额」', async () => {
    const id = await makePlayer();
    const accountId = await seedPlayerBalance(prisma, id, ROOM, 0);

    await users.closeAccount(id, PASSWORD);

    const [sum, account] = await Promise.all([
      prisma.pointsLedger.aggregate({ where: { accountId }, _sum: { amount: true } }),
      prisma.pointsAccount.findUnique({ where: { id: accountId }, select: { balance: true } }),
    ]);
    expect(Number(sum._sum.amount ?? 0)).toBe(Number(account?.balance));
  });

  it('不能重复注销', async () => {
    const id = await makePlayer();
    await users.closeAccount(id, PASSWORD);
    await expect(users.closeAccount(id, PASSWORD)).rejects.toThrow('已注销');
  });
});
