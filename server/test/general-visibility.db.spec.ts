/**
 * 总监 → 总代 可见性：按房的挂靠情况**二选一**，不是两道叠加的闸门。
 *
 *   挂了总代的房 → 只看总代级（GeneralOwnerGrant），房间级那份完全不参与
 *   直挂房       → 只看房间级（RoomOwnerGrant）
 *
 * 这套规则的价值全在「关掉之后是真的一点都看不到」。只藏房间不藏人是没用的：
 * 总代还在账号中心的名单里，挂靠关系、名下代理、盯盘页的实时注单照样露出来，
 * 而且总监还能把新房挂到那个总代名下，凭空造出一间自己都看不见的房。
 * 所以每一条出口都要单独钉一遍。
 */
import { PrismaClient } from '@prisma/client';
import { createTestPrisma, makeUser, wipeMoneyTables } from './db/money-test-kit';
import { ConsoleScopeService } from '../src/modules/console/console-scope.service';
import type { PrismaService } from '../src/prisma/prisma.service';

describe('总监看总代的可见性', () => {
  let prisma: PrismaClient;
  let scope: ConsoleScopeService;

  beforeAll(() => {
    prisma = createTestPrisma();
    scope = new ConsoleScopeService(prisma as unknown as PrismaService);
  });

  afterAll(async () => {
    await wipeMoneyTables(prisma);
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    await wipeMoneyTables(prisma);
    await prisma.generalOwnerGrant.deleteMany({});
    await prisma.roomOwnerGrant.deleteMany({});
    await prisma.room.deleteMany({});
  });

  /**
   * 一个总监 + 两个总代（A 授权可见、B 不授权），各带一间房。
   * 房间级授权两间都给，这样失败时能确定是总代级闸门在起作用。
   */
  async function scene() {
    const branchId = await makeUser(prisma, 'BRANCH');
    const mk = async (label: string) => {
      const generalUserId = await makeUser(prisma, 'GENERAL');
      const general = await prisma.agent.create({
        data: { userId: generalUserId },
        select: { id: true },
      });
      const agentUserId = await makeUser(prisma, 'AGENT');
      const agent = await prisma.agent.create({
        data: { userId: agentUserId },
        select: { id: true },
      });
      const room = await prisma.room.create({
        data: {
          roomNo: String(300_000 + Math.floor(Math.random() * 600_000)),
          name: `${label}房`,
          ownerAgentId: agent.id,
          generalAgentId: general.id,
        },
        select: { id: true },
      });
      /* 房间级一律授权，把变量只留总代级那一道 */
      await prisma.roomOwnerGrant.create({
        data: { roomId: room.id, ownerId: branchId },
      });
      return { generalUserId, generalAgentId: general.id, agentUserId, roomId: room.id };
    };
    const a = await mk('A');
    const b = await mk('B');
    /* 只授权 A */
    await prisma.generalOwnerGrant.create({
      data: { generalAgentId: a.generalAgentId, ownerId: branchId },
    });
    return { branchId, a, b };
  }

  const actorOf = (id: string) => ({ id, role: 'BRANCH' });

  it('未授权的总代，他名下房间不进可见房间列表', async () => {
    const s = await scene();
    const rooms = await scope.grantedRoomIds(actorOf(s.branchId));
    expect(rooms).toEqual([s.a.roomId]);
  });

  it('未授权的总代本人不可见', async () => {
    const s = await scene();
    await expect(
      scope.generalVisibleToBranch(actorOf(s.branchId), s.a.generalUserId),
    ).resolves.toBe(true);
    await expect(
      scope.generalVisibleToBranch(actorOf(s.branchId), s.b.generalUserId),
    ).resolves.toBe(false);
  });

  it('assertUserInScope：授权总代放过，未授权总代拦下', async () => {
    const s = await scene();
    await expect(
      scope.assertUserInScope(actorOf(s.branchId), s.a.generalUserId),
    ).resolves.toBeUndefined();
    await expect(
      scope.assertUserInScope(actorOf(s.branchId), s.b.generalUserId),
    ).rejects.toThrow('不在管辖范围');
  });

  it('未授权总代名下的代理也拦下（房间级已授权也不放行）', async () => {
    const s = await scene();
    await expect(
      scope.assertUserInScope(actorOf(s.branchId), s.a.agentUserId),
    ).resolves.toBeUndefined();
    await expect(
      scope.assertUserInScope(actorOf(s.branchId), s.b.agentUserId),
    ).rejects.toThrow('不在管辖范围');
  });

  it('未授权总代的子账号跟着一起隐身', async () => {
    const s = await scene();
    const proxyId = await makeUser(prisma, 'PROXY');
    await prisma.user.update({
      where: { id: proxyId },
      data: { parentId: s.b.generalUserId },
    });
    await expect(
      scope.assertUserInScope(actorOf(s.branchId), proxyId),
    ).rejects.toThrow('不在管辖范围');
  });

  it('授权总代的子账号可见', async () => {
    const s = await scene();
    const proxyId = await makeUser(prisma, 'PROXY');
    await prisma.user.update({
      where: { id: proxyId },
      data: { parentId: s.a.generalUserId },
    });
    await expect(
      scope.assertUserInScope(actorOf(s.branchId), proxyId),
    ).resolves.toBeUndefined();
  });

  it('未授权总代房里的玩家查不到', async () => {
    const s = await scene();
    const pa = await makeUser(prisma);
    const pb = await makeUser(prisma);
    await prisma.roomMember.create({
      data: { playerId: pa, roomId: s.a.roomId, status: 'APPROVED' },
    });
    await prisma.roomMember.create({
      data: { playerId: pb, roomId: s.b.roomId, status: 'APPROVED' },
    });

    const where = (await scope.playerWhere(actorOf(s.branchId))) as {
      id: { in: string[] };
    };
    expect(where.id.in).toContain(pa);
    expect(where.id.in).not.toContain(pb);
  });

  it('scopedUserIds 不含未授权总代及其子账号', async () => {
    const s = await scene();
    const proxyId = await makeUser(prisma, 'PROXY');
    await prisma.user.update({
      where: { id: proxyId },
      data: { parentId: s.b.generalUserId },
    });

    const ids = await scope.scopedUserIds(actorOf(s.branchId));
    expect(ids).toContain(s.a.generalUserId);
    expect(ids).not.toContain(s.b.generalUserId);
    expect(ids).not.toContain(proxyId);
  });

  it('不能把房挂到未授权的总代名下', async () => {
    const s = await scene();
    await expect(
      scope.assertGeneralAssignable(actorOf(s.branchId), s.a.generalUserId),
    ).resolves.toBeUndefined();
    await expect(
      scope.assertGeneralAssignable(actorOf(s.branchId), s.b.generalUserId),
    ).rejects.toThrow('无权把房间挂到该总代名下');
  });

  it('直挂房（不挂总代）不受总代级闸门影响', async () => {
    const s = await scene();
    const agentUserId = await makeUser(prisma, 'AGENT');
    const agent = await prisma.agent.create({
      data: { userId: agentUserId },
      select: { id: true },
    });
    const direct = await prisma.room.create({
      data: {
        roomNo: String(900_000 + Math.floor(Math.random() * 90_000)),
        name: '直挂房',
        ownerAgentId: agent.id,
        generalAgentId: null,
      },
      select: { id: true },
    });
    await prisma.roomOwnerGrant.create({
      data: { roomId: direct.id, ownerId: s.branchId },
    });

    const rooms = await scope.grantedRoomIds(actorOf(s.branchId));
    expect(rooms).toContain(direct.id);
    expect(rooms).not.toContain(s.b.roomId);
  });

  it('直挂房撤掉房间级授权就看不到了（这类房只认房间级）', async () => {
    const s = await scene();
    const agentUserId = await makeUser(prisma, 'AGENT');
    const agent = await prisma.agent.create({
      data: { userId: agentUserId },
      select: { id: true },
    });
    const direct = await prisma.room.create({
      data: {
        roomNo: String(950_000 + Math.floor(Math.random() * 40_000)),
        name: '直挂房2',
        ownerAgentId: agent.id,
        generalAgentId: null,
      },
      select: { id: true },
    });
    await prisma.roomOwnerGrant.create({
      data: { roomId: direct.id, ownerId: s.branchId },
    });
    expect(await scope.grantedRoomIds(actorOf(s.branchId))).toContain(direct.id);

    await prisma.roomOwnerGrant.deleteMany({
      where: { roomId: direct.id, ownerId: s.branchId },
    });
    expect(await scope.grantedRoomIds(actorOf(s.branchId))).not.toContain(direct.id);
  });

  it('管理不受任何一道闸门限制', async () => {
    const s = await scene();
    const admin = { id: 'admin-x', role: 'ADMIN' };
    await expect(scope.grantedRoomIds(admin)).resolves.toBeNull();
    await expect(scope.grantedGeneralAgentIds(admin)).resolves.toBeNull();
    await expect(
      scope.generalVisibleToBranch(admin, s.b.generalUserId),
    ).resolves.toBe(true);
  });

  /*
   * 挂总代的房，房间级那份名单必须完全不起作用——两个方向都要钉：
   * 撤掉房间级不影响可见（否则又变成「两个都要过」，会出现
   * 「看得见这个总代却一间房都打不开」的自相矛盾状态）；
   * 只有房间级也放不进来（否则总代级的屏蔽就被绕过去了）。
   */
  it('挂总代的房：撤掉房间级授权也照样可见（房间级对这类房不起作用）', async () => {
    const s = await scene();
    await prisma.roomOwnerGrant.deleteMany({
      where: { roomId: s.a.roomId, ownerId: s.branchId },
    });
    const rooms = await scope.grantedRoomIds(actorOf(s.branchId));
    expect(rooms).toContain(s.a.roomId);
  });

  it('挂总代的房：只有房间级授权、总代级没给，进不来', async () => {
    const s = await scene();
    /* B 的房间级授权是 scene 里给足的，总代级故意没给 */
    const roomGrant = await prisma.roomOwnerGrant.findFirst({
      where: { roomId: s.b.roomId, ownerId: s.branchId },
      select: { id: true },
    });
    expect(roomGrant).not.toBeNull();

    const rooms = await scope.grantedRoomIds(actorOf(s.branchId));
    expect(rooms).not.toContain(s.b.roomId);
  });

  it('总代可见 = 他名下每一间房都可见，不会漏掉后建的房', async () => {
    const s = await scene();
    /* 给 A 总代再加一间房，房间级一行授权都不写 */
    const agentUserId = await makeUser(prisma, 'AGENT');
    const agent = await prisma.agent.create({
      data: { userId: agentUserId },
      select: { id: true },
    });
    const extra = await prisma.room.create({
      data: {
        roomNo: String(400_000 + Math.floor(Math.random() * 90_000)),
        name: 'A的第二间房',
        ownerAgentId: agent.id,
        generalAgentId: s.a.generalAgentId,
      },
      select: { id: true },
    });

    const rooms = await scope.grantedRoomIds(actorOf(s.branchId));
    expect(rooms).toContain(extra.id);
    expect(rooms).toContain(s.a.roomId);
  });

  it('事后授权就能看见，撤销就立刻看不见', async () => {
    const s = await scene();
    await prisma.generalOwnerGrant.create({
      data: { generalAgentId: s.b.generalAgentId, ownerId: s.branchId },
    });
    let rooms = await scope.grantedRoomIds(actorOf(s.branchId));
    expect(rooms).toHaveLength(2);

    await prisma.generalOwnerGrant.deleteMany({
      where: { generalAgentId: s.b.generalAgentId, ownerId: s.branchId },
    });
    rooms = await scope.grantedRoomIds(actorOf(s.branchId));
    expect(rooms).toEqual([s.a.roomId]);
  });
});
