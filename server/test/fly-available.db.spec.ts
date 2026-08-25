/**
 * 上盘可飞额度：代理盘分 + 客服未发出 + 名下房间玩家持分。
 *
 * 用例逐步照抄业务方给的两个盘的完整流程（现金盘含超发、信用盘含重新授信），
 * 每一步都断言可飞额度。这条公式的价值就在于「上分/下分/关盘输赢都不该改变它，
 * 只有飞盘输赢和代理买分/提现才该改变它」，所以每一步都要钉住。
 */
import { PrismaClient } from '@prisma/client';
import { createTestPrisma, makeUser, wipeMoneyTables } from './db/money-test-kit';
import {
  agentFlyAvailable,
  generalRoomBalance,
  generalTreeFlyAvailable,
} from '../src/modules/console/credit-settle.helper';

describe('上盘可飞额度', () => {
  let prisma: PrismaClient;

  beforeAll(() => {
    prisma = createTestPrisma();
  });

  afterAll(async () => {
    await wipeMoneyTables(prisma);
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    await wipeMoneyTables(prisma);
  });

  /** 建一个代理 + 一间他名下的房 + 一个已通过审核的玩家 */
  async function scene(bookMode: 'CASH' | 'CREDIT') {
    const agentUserId = await makeUser(prisma, 'AGENT');
    const agent = await prisma.agent.create({
      data: { userId: agentUserId, bookMode, pointsQuota: 0 },
      select: { id: true },
    });
    const room = await prisma.room.create({
      data: {
        roomNo: String(200_000 + Math.floor(Math.random() * 700_000)),
        name: '飞盘测试房',
        bookMode,
        ownerAgentId: agent.id,
      },
      select: { id: true },
    });
    const playerId = await makeUser(prisma);
    await prisma.roomMember.create({
      data: { playerId, roomId: room.id, status: 'APPROVED' },
    });
    return { agentUserId, roomId: room.id, playerId, bookMode };
  }

  /** 信用盘日常也是余额+额度同步，和现金盘同一套盘分 */

  /** 直接设账面值：测的是公式，不是走业务路径。现金盘余额与额度同步 */
  async function setAgentDisk(agentUserId: string, amount: number) {
    await prisma.agent.update({
      where: { userId: agentUserId },
      data: { pointsQuota: amount },
    });
    await prisma.pointsAccount.upsert({
      where: {
        ownerType_ownerId_roomId: { ownerType: 'AGENT', ownerId: agentUserId, roomId: '' },
      },
      update: { balance: amount },
      create: { ownerType: 'AGENT', ownerId: agentUserId, roomId: '', balance: amount },
    });
  }

  async function setPlayerBalance(playerId: string, roomId: string, amount: number) {
    await prisma.pointsAccount.upsert({
      where: {
        ownerType_ownerId_roomId: { ownerType: 'PLAYER', ownerId: playerId, roomId },
      },
      update: { balance: amount },
      create: { ownerType: 'PLAYER', ownerId: playerId, roomId, balance: amount },
    });
  }

  const fly = (s: { agentUserId: string; bookMode: 'CASH' | 'CREDIT' }) =>
    agentFlyAvailable(prisma, s.agentUserId, s.bookMode);

  const W = 10_000; // 「万」，让下面的数字和业务方的说法一一对应

  it('现金盘完整流程（含超发）', async () => {
    const s = await scene('CASH');

    /* 代理交 20 万给平台 */
    await setAgentDisk(s.agentUserId, 20 * W);
    await setPlayerBalance(s.playerId, s.roomId, 0);
    expect(await fly(s)).toBe(20 * W);

    /* 玩家给代理 100 万，代理上分 100 万 → 盘分 −80 万，玩家 100 万 */
    await setAgentDisk(s.agentUserId, -80 * W);
    await setPlayerBalance(s.playerId, s.roomId, 100 * W);
    /* 上分只是把分从代理挪到玩家，额度不变，仍等于他真交的 20 万 */
    expect(await fly(s)).toBe(20 * W);

    /* 飞盘，玩家赢 20 万 → 平台掏分进玩家账，额度增加 */
    await setPlayerBalance(s.playerId, s.roomId, 120 * W);
    expect(await fly(s)).toBe(40 * W);

    /* 玩家下分 120 万 → 分回到代理，额度不变 */
    await setAgentDisk(s.agentUserId, 40 * W);
    await setPlayerBalance(s.playerId, s.roomId, 0);
    expect(await fly(s)).toBe(40 * W);

    /* 代理找平台下分 40 万 → 额度归零 */
    await setAgentDisk(s.agentUserId, 0);
    expect(await fly(s)).toBe(0);
  });

  it('现金盘：玩家赢 20 万后又输 30 万', async () => {
    const s = await scene('CASH');
    await setAgentDisk(s.agentUserId, -80 * W);
    await setPlayerBalance(s.playerId, s.roomId, 120 * W);
    expect(await fly(s)).toBe(40 * W);

    /* 飞盘再输 30 万 → 分交给平台，额度跟着掉 */
    await setPlayerBalance(s.playerId, s.roomId, 90 * W);
    expect(await fly(s)).toBe(10 * W);

    /* 玩家下分 90 万 → 额度不变 */
    await setAgentDisk(s.agentUserId, 10 * W);
    await setPlayerBalance(s.playerId, s.roomId, 0);
    expect(await fly(s)).toBe(10 * W);
  });

  it('超发到玩家把真钱那部分输光时归零，之后只能关盘', async () => {
    const s = await scene('CASH');
    /* 垫 20 万发出 100 万 */
    await setAgentDisk(s.agentUserId, -80 * W);
    await setPlayerBalance(s.playerId, s.roomId, 100 * W);
    expect(await fly(s)).toBe(20 * W);

    /* 飞盘输掉 20 万 → 归零 → 关盘 */
    await setPlayerBalance(s.playerId, s.roomId, 80 * W);
    expect(await fly(s)).toBe(0);

    /* 剩下 80 万是假分：关盘输赢在代理与玩家之间挪，额度始终是 0 */
    await setAgentDisk(s.agentUserId, -80 * W + 30 * W);
    await setPlayerBalance(s.playerId, s.roomId, 50 * W);
    expect(await fly(s)).toBe(0);
  });

  it('信用盘完整流程（含结账后重新授信）', async () => {
    const s = await scene('CREDIT');

    /* 平台给 20 万授信（盘分同步） */
    await setAgentDisk(s.agentUserId, 20 * W);
    await setPlayerBalance(s.playerId, s.roomId, 0);
    expect(await fly(s)).toBe(20 * W);

    /* 代理上分 20 万给玩家 → 额度不变 */
    await setAgentDisk(s.agentUserId, 0);
    await setPlayerBalance(s.playerId, s.roomId, 20 * W);
    expect(await fly(s)).toBe(20 * W);

    /* 飞盘玩家输光 → 归零 → 关盘 */
    await setPlayerBalance(s.playerId, s.roomId, 0);
    expect(await fly(s)).toBe(0);

    /* 结账后平台重新给 20 万授信 → 恢复 */
    await setAgentDisk(s.agentUserId, 20 * W);
    expect(await fly(s)).toBe(20 * W);

    /* 上分 20 万 → 不变；飞盘赢 20 万 → 涨到 40 万 */
    await setAgentDisk(s.agentUserId, 0);
    await setPlayerBalance(s.playerId, s.roomId, 40 * W);
    expect(await fly(s)).toBe(40 * W);

    /* 玩家下分 40 万 → 不变 */
    await setAgentDisk(s.agentUserId, 40 * W);
    await setPlayerBalance(s.playerId, s.roomId, 0);
    expect(await fly(s)).toBe(40 * W);
  });

  it('信用盘整包进盘分后能继续飞', async () => {
    const s = await scene('CREDIT');
    /* 授信 5 万 + 整包 100 万，已经并在同一本盘分里 */
    await setAgentDisk(s.agentUserId, 105 * W);
    await setPlayerBalance(s.playerId, s.roomId, 0);
    expect(await fly(s)).toBe(105 * W);
  });

  it('客服手上未发出的额度算进可飞', async () => {
    const s = await scene('CASH');
    await setAgentDisk(s.agentUserId, 10 * W);
    await setPlayerBalance(s.playerId, s.roomId, 0);

    const csUserId = await makeUser(prisma);
    await prisma.user.update({
      where: { id: csUserId },
      data: { role: 'CS', parentId: s.agentUserId },
    });
    await prisma.pointsAccount.create({
      data: { ownerType: 'CS', ownerId: csUserId, roomId: '', balance: 3 * W },
    });

    expect(await fly(s)).toBe(13 * W);
  });

  it('只算自己名下房间的玩家，不串到别的代理', async () => {
    const mine = await scene('CASH');
    const other = await scene('CASH');
    await setAgentDisk(mine.agentUserId, 0);
    await setAgentDisk(other.agentUserId, 0);
    await setPlayerBalance(mine.playerId, mine.roomId, 7 * W);
    await setPlayerBalance(other.playerId, other.roomId, 999 * W);

    expect(await fly(mine)).toBe(7 * W);
    expect(await fly(other)).toBe(999 * W);
  });

  /*
   * 总代那一层。要钉住两件事：
   *   1. A 代理的可飞额度里绝不包含总代余额（不能占用别人的额度）
   *   2. 总代坐庄赔钱时，钱从总代那一支挪到 A 那一支，两边一减一加，
   *      整棵树的总额不变 —— 所以 A 的额度上涨不是「凭空」，是总代真掏了钱
   */
  describe('总代层', () => {
    async function treeScene() {
      const generalUserId = await makeUser(prisma, 'AGENT');
      const general = await prisma.agent.create({
        data: { userId: generalUserId, bookMode: 'CASH', pointsQuota: 0 },
        select: { id: true },
      });
      const agentUserId = await makeUser(prisma, 'AGENT');
      const agent = await prisma.agent.create({
        data: { userId: agentUserId, bookMode: 'CASH', pointsQuota: 0 },
        select: { id: true },
      });
      const room = await prisma.room.create({
        data: {
          roomNo: String(300_000 + Math.floor(Math.random() * 600_000)),
          name: '总代树测试房',
          bookMode: 'CASH',
          ownerAgentId: agent.id,
          generalAgentId: general.id,
        },
        select: { id: true },
      });
      const playerId = await makeUser(prisma);
      await prisma.roomMember.create({
        data: { playerId, roomId: room.id, status: 'APPROVED' },
      });
      return { generalUserId, agentUserId, roomId: room.id, playerId };
    }

    it('A 的可飞额度不含总代余额', async () => {
      const t = await treeScene();
      /* 总代手上 100 万，A 一分没有 */
      await setAgentDisk(t.generalUserId, 100 * W);
      await setAgentDisk(t.agentUserId, 0);
      await setPlayerBalance(t.playerId, t.roomId, 0);

      /* A 只能看自己那一支：0 */
      expect(await agentFlyAvailable(prisma, t.agentUserId, 'CASH')).toBe(0);
      /* 总代自己那一支是 100 万 */
      expect(await agentFlyAvailable(prisma, t.generalUserId, 'CASH')).toBe(100 * W);
    });

    it('总代划分给 A：两支之和不变', async () => {
      const t = await treeScene();
      await setAgentDisk(t.generalUserId, 50 * W);
      await setAgentDisk(t.agentUserId, 50 * W);
      await setPlayerBalance(t.playerId, t.roomId, 0);

      const a = await agentFlyAvailable(prisma, t.agentUserId, 'CASH');
      const g = await agentFlyAvailable(prisma, t.generalUserId, 'CASH');
      expect(a).toBe(50 * W);
      expect(g).toBe(50 * W);
      expect(a + g).toBe(100 * W);
    });

    it('整棵树 = 总代那一格 + 各代理那一支', async () => {
      const t = await treeScene();
      await setAgentDisk(t.generalUserId, 40 * W);
      await setAgentDisk(t.agentUserId, 10 * W);
      await setPlayerBalance(t.playerId, t.roomId, 50 * W);

      expect(await generalTreeFlyAvailable(prisma, t.generalUserId)).toBe(100 * W);
      /* 房间余额只含代理那一支，不含总代自己手上的 40 万 */
      expect(await generalRoomBalance(prisma, t.generalUserId)).toBe(60 * W);
    });

    /*
     * 总代超发时，代理那一支的数字会被抬高到超过树里的真钱。
     * 平台只认树里的真钱，所以这时候整棵树要停飞——否则平台就在替
     * 没人付过钱的分当庄（玩家输了平台收到白纸，玩家赢了平台掏真钱）。
     */
    it('总代超发：代理那一支虚高，但整棵树如实反映真钱', async () => {
      const t = await treeScene();
      /* 总代赔到自己变负 */
      await setAgentDisk(t.generalUserId, -19_750);
      await setAgentDisk(t.agentUserId, 500);
      await setPlayerBalance(t.playerId, t.roomId, 100 * W);

      const a = await agentFlyAvailable(prisma, t.agentUserId, 'CASH');
      const tree = await generalTreeFlyAvailable(prisma, t.generalUserId);
      expect(a).toBe(100 * W + 500);
      expect(tree).toBe(100 * W + 500 - 19_750);
      /* 代理那一支比整棵树还多，多出来的就是没背书的部分 */
      expect(a).toBeGreaterThan(tree);
    });

    it('一棵树里现金房和信用房混着，各按各自盘种算', async () => {
      const t = await treeScene();
      /* 总代与平台是信用盘：盘分已经并成一本 */
      await prisma.agent.update({
        where: { userId: t.generalUserId },
        data: { bookMode: 'CREDIT' },
      });
      await setAgentDisk(t.generalUserId, 35 * W);
      /* 代理那间房仍是现金盘 */
      await setAgentDisk(t.agentUserId, 10 * W);
      await setPlayerBalance(t.playerId, t.roomId, 20 * W);

      /*
       * 总代那一格 35 万 + 代理 10 万 + 玩家 20 万
       */
      expect(await generalTreeFlyAvailable(prisma, t.generalUserId)).toBe(65 * W);
    });

    it('信用盘代理整包进盘分后算进可飞额度', async () => {
      const t = await treeScene();
      await prisma.agent.update({
        where: { userId: t.agentUserId },
        data: { bookMode: 'CREDIT' },
      });
      await prisma.room.update({
        where: { id: t.roomId },
        data: { bookMode: 'CREDIT' },
      });
      await setAgentDisk(t.agentUserId, 5 * W);
      await setPlayerBalance(t.playerId, t.roomId, 1 * W);

      /* 盘分 5 万 + 玩家持分 1 万 */
      expect(await agentFlyAvailable(prisma, t.agentUserId, 'CREDIT')).toBe(6 * W);
    });

    it('总代坐庄赔 20 万：A 涨 20 万、总代降 20 万，树总额不变', async () => {
      const t = await treeScene();
      /* 起点：总代 50 万，A 已把 50 万全发给玩家 */
      await setAgentDisk(t.generalUserId, 50 * W);
      await setAgentDisk(t.agentUserId, 0);
      await setPlayerBalance(t.playerId, t.roomId, 50 * W);
      const before =
        (await agentFlyAvailable(prisma, t.agentUserId, 'CASH')) +
        (await agentFlyAvailable(prisma, t.generalUserId, 'CASH'));
      expect(before).toBe(100 * W);

      /* 总代坐庄，玩家赢 20 万：扣总代余额、涨玩家余额 */
      await setAgentDisk(t.generalUserId, 30 * W);
      await setPlayerBalance(t.playerId, t.roomId, 70 * W);

      const a = await agentFlyAvailable(prisma, t.agentUserId, 'CASH');
      const g = await agentFlyAvailable(prisma, t.generalUserId, 'CASH');
      expect(a).toBe(70 * W);
      expect(g).toBe(30 * W);
      /* 整棵树没有凭空多出钱：A 涨的正是总代降的 */
      expect(a + g).toBe(before);
    });
  });

  it('结果不会是负数', async () => {
    const s = await scene('CASH');
    await setAgentDisk(s.agentUserId, -50 * W);
    await setPlayerBalance(s.playerId, s.roomId, 0);
    expect(await fly(s)).toBe(0);
  });
});
