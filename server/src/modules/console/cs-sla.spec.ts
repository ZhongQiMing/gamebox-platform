import { CsSlaService, shanghaiDayKey } from './cs-sla.service';

/**
 * 客服响应考核。这套逻辑直接决定扣客服多少钱，判错一次就是一次争议，
 * 所以把「看了不算回复」「连发只算一轮」「宽限期」这几条钉死在测试里。
 */

type AnyFn = jest.Mock;

/** 所有假方法都要返回 Promise：服务里对返回值链了 .catch，返回 undefined 会假报错 */
function fn(value: unknown = undefined) {
  return jest.fn().mockResolvedValue(value);
}

function makePrisma() {
  return {
    csSlaPolicy: { findUnique: fn(null), upsert: fn({}) },
    csSlaEvent: {
      findFirst: fn(null),
      findMany: fn([]),
      create: fn({}),
      update: fn({}),
      findUnique: fn(null),
    },
    csDutySpan: { findFirst: fn(null), findMany: fn([]), create: fn({}), update: fn({}) },
    csStaff: { findUnique: fn(null), update: fn({}), findMany: fn([]) },
    csWageBill: { aggregate: fn({ _sum: { wageAmount: 0 } }), findFirst: fn(null), create: fn({}) },
    user: { update: fn({}), findMany: fn([]) },
  };
}

function makeService(prisma: ReturnType<typeof makePrisma>) {
  const redis = { runExclusive: jest.fn(async (_k: string, _t: number, fn: () => Promise<void>) => fn()) };
  const adminLog = { log: jest.fn() };
  return new CsSlaService(prisma as never, redis as never, adminLog as never);
}

describe('客服响应考核', () => {
  let prisma: ReturnType<typeof makePrisma>;
  let svc: CsSlaService;

  beforeEach(() => {
    prisma = makePrisma();
    svc = makeService(prisma);
    prisma.csSlaPolicy.findUnique.mockResolvedValue(null); // 用默认规则：180 / 480
  });

  it('默认规则是 3 分钟提醒、8 分钟踢下线', async () => {
    const p = await svc.getPolicy('agent-1');
    expect(p.remindSec).toBe(180);
    expect(p.kickSec).toBe(480);
    expect(p.enabled).toBe(true);
  });

  it('踢下线时限必须大于提醒时限', async () => {
    await expect(
      svc.savePolicy('agent-1', { remindSec: 300, kickSec: 120 }),
    ).rejects.toThrow('踢下线时限必须大于提醒时限');
  });

  it('玩家连发多条只开一轮，不重复罚', async () => {
    prisma.csSlaEvent.findFirst.mockResolvedValue({ id: 'ev-1' }); // 已有未结轮次
    await svc.openRound({
      csUserId: 'cs-1',
      agentUserId: 'agent-1',
      playerId: 'p-1',
      askMessageId: 'm-2',
      askedAt: new Date(),
    });
    expect(prisma.csSlaEvent.create).not.toHaveBeenCalled();
  });

  it('会话派回代理本人时不考核客服', async () => {
    await svc.openRound({
      csUserId: 'agent-1',
      agentUserId: 'agent-1',
      playerId: 'p-1',
      askMessageId: 'm-1',
      askedAt: new Date(),
    });
    expect(prisma.csSlaEvent.findFirst).not.toHaveBeenCalled();
    expect(prisma.csSlaEvent.create).not.toHaveBeenCalled();
  });

  it('30 秒宽限内回复算及时，不罚款', async () => {
    const askedAt = new Date('2026-08-18T10:00:00Z');
    prisma.csSlaEvent.findMany.mockResolvedValue([
      { id: 'ev-1', agentUserId: 'agent-1', askedAt, kickedAt: null },
    ]);
    /* 200 秒 > 180，但没超过 180+30 的宽限 */
    await svc.closeRound('p-1', new Date(askedAt.getTime() + 200_000));
    const arg = (prisma.csSlaEvent.update as AnyFn).mock.calls[0][0];
    expect(arg.data.level).toBe('ON_TIME');
    expect(arg.data.fineAmount).toBe(0);
  });

  it('超过提醒时限加宽限才算超时，按规则罚款', async () => {
    const askedAt = new Date('2026-08-18T10:00:00Z');
    prisma.csSlaEvent.findMany.mockResolvedValue([
      { id: 'ev-1', agentUserId: 'agent-1', askedAt, kickedAt: null },
    ]);
    await svc.closeRound('p-1', new Date(askedAt.getTime() + 240_000));
    const arg = (prisma.csSlaEvent.update as AnyFn).mock.calls[0][0];
    expect(arg.data.level).toBe('LATE');
    expect(arg.data.fineAmount).toBe(10);
    expect(arg.data.responseSec).toBe(240);
  });

  it('已经被踢过的轮次，事后补回复仍记漏接并叠加罚款', async () => {
    const askedAt = new Date('2026-08-18T10:00:00Z');
    prisma.csSlaEvent.findMany.mockResolvedValue([
      {
        id: 'ev-1',
        agentUserId: 'agent-1',
        askedAt,
        kickedAt: new Date(askedAt.getTime() + 480_000),
      },
    ]);
    await svc.closeRound('p-1', new Date(askedAt.getTime() + 900_000));
    const arg = (prisma.csSlaEvent.update as AnyFn).mock.calls[0][0];
    expect(arg.data.level).toBe('MISSED');
    /* 漏接 = 超时罚 10 + 漏接罚 50 */
    expect(arg.data.fineAmount).toBe(60);
  });

  it('值班时长把上一段结掉再开新的一段', async () => {
    const startedAt = new Date('2026-08-18T10:00:00Z');
    prisma.csDutySpan.findFirst.mockResolvedValue({ id: 'sp-1', startedAt });
    const at = new Date(startedAt.getTime() + 3_600_000);
    await svc.onWorkStatusChanged('cs-1', 'REST', at);

    const closed = (prisma.csDutySpan.update as AnyFn).mock.calls[0][0];
    expect(closed.where.id).toBe('sp-1');
    expect(closed.data.seconds).toBe(3600);

    const opened = (prisma.csDutySpan.create as AnyFn).mock.calls[0][0];
    expect(opened.data.status).toBe('REST');
    expect(opened.data.startedAt).toBe(at);
  });

  it('今日时长把还没结束的那一段按此刻实时补上', async () => {
    const now = new Date('2026-08-18T12:00:00Z');
    prisma.csDutySpan.findMany.mockResolvedValue([
      { status: 'IDLE', startedAt: new Date('2026-08-18T09:00:00Z'), endedAt: new Date('2026-08-18T10:00:00Z'), seconds: 3600 },
      { status: 'REST', startedAt: new Date('2026-08-18T11:30:00Z'), endedAt: null, seconds: 0 },
    ]);
    const duty = await svc.dutyToday('cs-1', now);
    expect(duty.idleSec).toBe(3600);
    expect(duty.restSec).toBe(1800);
  });

  it('规则关掉时只统计不踢人', async () => {
    prisma.csSlaPolicy.findUnique.mockResolvedValue({ enabled: false, remindSec: 180, kickSec: 480 });
    const askedAt = new Date(Date.now() - 3_600_000);
    prisma.csSlaEvent.findMany.mockResolvedValue([
      { id: 'ev-1', csUserId: 'cs-1', agentUserId: 'agent-1', askedAt, remindedAt: null, kickedAt: null },
    ]);
    await svc.scanOverdue();
    expect(prisma.csSlaEvent.update).not.toHaveBeenCalled();
    expect(prisma.csStaff.update).not.toHaveBeenCalled();
  });

  it('超过踢下线时限：记漏接、强制休息、锁号并作废令牌', async () => {
    const askedAt = new Date(Date.now() - 3_600_000);
    prisma.csSlaEvent.findMany.mockResolvedValue([
      { id: 'ev-1', csUserId: 'cs-1', agentUserId: 'agent-1', askedAt, remindedAt: null, kickedAt: null },
    ]);
    prisma.csStaff.findUnique.mockResolvedValue({ userId: 'cs-1', workStatus: 'IDLE' });
    prisma.csDutySpan.findFirst.mockResolvedValue(null);

    await svc.scanOverdue();

    const levels = (prisma.csSlaEvent.update as AnyFn).mock.calls.map((c) => c[0].data.level);
    expect(levels).toContain('MISSED');

    /* 罚款要在踢的当下就落定：一直没人回的会话最该罚，不能挂着 0 元等回复 */
    const kickCall = (prisma.csSlaEvent.update as AnyFn).mock.calls
      .map((c) => c[0].data)
      .find((d) => d.level === 'MISSED');
    expect(kickCall.fineAmount).toBe(60);

    const lock = (prisma.csStaff.update as AnyFn).mock.calls.at(-1)![0];
    expect(lock.data.workStatus).toBe('REST');
    expect(lock.data.slaLockedAt).toBeInstanceOf(Date);

    /* 作废令牌 = 把人踢下线 */
    expect(prisma.user.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { tokenVersion: { increment: 1 } } }),
    );
  });

  it('锁住的客服再登录会被拦下', async () => {
    prisma.csStaff.findUnique.mockResolvedValue({
      slaLockedAt: new Date(),
      slaLockReason: '漏接玩家消息超过 8 分钟',
    });
    await expect(svc.assertNotLocked('cs-1')).rejects.toThrow('账号已锁定');
  });

  it('代理免除后，这一次不计入罚款合计', async () => {
    prisma.csStaff.findMany.mockResolvedValue([
      { userId: 'cs-1', workStatus: 'IDLE', slaLockedAt: null, slaLockReason: null,
        user: { id: 'cs-1', nickname: '客服A', username: 'kefu1', status: 'ACTIVE' } },
    ]);
    prisma.csSlaEvent.findMany.mockResolvedValue([
      { csUserId: 'cs-1', level: 'LATE', fineAmount: 10, waived: false },
      { csUserId: 'cs-1', level: 'MISSED', fineAmount: 60, waived: true },
      { csUserId: 'cs-1', level: 'ON_TIME', fineAmount: 0, waived: false },
    ]);
    prisma.csDutySpan.findMany.mockResolvedValue([]);

    const { list } = await svc.statsByAgent('agent-1', new Date(0), new Date());
    expect(list[0].rounds).toBe(3);
    expect(list[0].onTime).toBe(1);
    expect(list[0].fine).toBe(10); // 被免除的 60 不算
    expect(list[0].waivedCount).toBe(1);
  });

  it('日结罚款不超过当日佣金的封顶比例', async () => {
    prisma.csSlaEvent.findMany.mockResolvedValue([
      { csUserId: 'cs-1', agentUserId: 'agent-1', level: 'LATE', fineAmount: 10, waived: false, dayKey: '2026-08-18' },
      { csUserId: 'cs-1', agentUserId: 'agent-1', level: 'MISSED', fineAmount: 60, waived: false, dayKey: '2026-08-18' },
    ]);
    /* 当日佣金 40，封顶 50% → 最多罚 20，而不是原始的 70 */
    prisma.csWageBill.aggregate.mockResolvedValue({ _sum: { wageAmount: 40 } });

    await svc.settleDay('2026-08-18');

    const bill = (prisma.csWageBill.create as AnyFn).mock.calls[0][0];
    expect(bill.data.kind).toBe('SLA_FINE');
    expect(Number(bill.data.wageAmount)).toBe(-20);
  });

  it('同一天重复结算不会重复记账', async () => {
    prisma.csSlaEvent.findMany.mockResolvedValue([
      { csUserId: 'cs-1', agentUserId: 'agent-1', level: 'LATE', fineAmount: 10, waived: false, dayKey: '2026-08-18' },
    ]);
    prisma.csWageBill.aggregate.mockResolvedValue({ _sum: { wageAmount: 1000 } });
    prisma.csWageBill.findFirst.mockResolvedValue({ id: 'already' });

    await svc.settleDay('2026-08-18');
    expect(prisma.csWageBill.create).not.toHaveBeenCalled();
  });

  it('全被免除时当天不产生任何账单', async () => {
    prisma.csSlaEvent.findMany.mockResolvedValue([
      { csUserId: 'cs-1', agentUserId: 'agent-1', level: 'MISSED', fineAmount: 60, waived: true, dayKey: '2026-08-18' },
    ]);
    prisma.csWageBill.aggregate.mockResolvedValue({ _sum: { wageAmount: 500 } });

    await svc.settleDay('2026-08-18');
    expect(prisma.csWageBill.create).not.toHaveBeenCalled();
  });

  it('日期键按上海时区切日', () => {
    /* UTC 8/17 16:30 = 上海 8/18 00:30，应归到 8/18 */
    expect(shanghaiDayKey(new Date('2026-08-17T16:30:00Z'))).toBe('2026-08-18');
    expect(shanghaiDayKey(new Date('2026-08-17T15:30:00Z'))).toBe('2026-08-17');
  });
});
