import { LotteryService } from './lottery.service';

/**
 * 预创期号的队列长度必须按「现有未来待开期」补足，不能每次都在最远一期后面再铺 ahead 期。
 *
 * 这个方法每 15s 被 scheduler 调一次。曾经的写法是无条件铺 ahead 期，于是每分钟把队列
 * 往未来推 4×ahead 期，永远追不上：实测一天堆出 12 万行空期号、最远排到 15 天后，
 * 既白占库又拖慢每 2s 一次的待开期扫描，还把期号提前钉死（改开奖间隔后全部作废）。
 */
const INTERVAL_SEC = 60;

function makePrisma(opts: { aheadCount: number; lastOpenAt: Date | null }) {
  const created: Array<{ issueNo: string; openAt: Date }> = [];
  return {
    created,
    game: {
      findUnique: jest.fn(async () => ({
        id: 'g1',
        code: 'ssc',
        status: 'ONLINE',
        configs: [{ version: 1 }],
      })),
    },
    lotteryIssue: {
      /* 周期/封盘窗校验那段：给空数组，走不到 rebuild */
      findMany: jest.fn(async () => []),
      findFirst: jest.fn(async () =>
        opts.lastOpenAt ? { id: 'last', openAt: opts.lastOpenAt } : null,
      ),
      count: jest.fn(async () => opts.aheadCount),
      deleteMany: jest.fn(async () => ({ count: 0 })),
      update: jest.fn(async () => ({})),
      upsert: jest.fn(async (args: { create: { issueNo: string; openAt: Date } }) => {
        created.push({ issueNo: args.create.issueNo, openAt: args.create.openAt });
        return {};
      }),
    },
  };
}

function makeService(prisma: ReturnType<typeof makePrisma>) {
  return new LotteryService(
    prisma as never,
    undefined as never,
    undefined as never,
    undefined as never,
    undefined as never,
    undefined as never,
    undefined as never,
  );
}

describe('彩票预创期号队列', () => {
  it('队列已满时一期都不再铺', async () => {
    const prisma = makePrisma({
      aheadCount: 5,
      lastOpenAt: new Date(Date.now() + 5 * INTERVAL_SEC * 1000),
    });
    const svc = makeService(prisma);

    await svc.preCreateIssues('ssc', INTERVAL_SEC, 5);

    expect(prisma.lotteryIssue.upsert).not.toHaveBeenCalled();
  });

  it('队列超出目标时也不再往未来推（防止 15s 一次的失控堆积）', async () => {
    const prisma = makePrisma({
      aheadCount: 17_000,
      lastOpenAt: new Date(Date.now() + 15 * 86_400_000),
    });
    const svc = makeService(prisma);

    await svc.preCreateIssues('ssc', INTERVAL_SEC, 5);

    expect(prisma.lotteryIssue.upsert).not.toHaveBeenCalled();
  });

  it('只补足差额：已有 3 期、目标 5 期时只铺 2 期', async () => {
    const lastOpenAt = new Date(Date.now() + 3 * INTERVAL_SEC * 1000);
    const prisma = makePrisma({ aheadCount: 3, lastOpenAt });
    const svc = makeService(prisma);

    await svc.preCreateIssues('ssc', INTERVAL_SEC, 5);

    expect(prisma.lotteryIssue.upsert).toHaveBeenCalledTimes(2);
    /* 仍要接在最远一期后面，保持期号连续 */
    expect(prisma.created.map((r) => r.openAt.getTime())).toEqual([
      lastOpenAt.getTime() + INTERVAL_SEC * 1000,
      lastOpenAt.getTime() + 2 * INTERVAL_SEC * 1000,
    ]);
  });

  it('停机后待开期全在过去：照常补 ahead 期以追平期号', async () => {
    const lastOpenAt = new Date(Date.now() - 3600_000);
    const prisma = makePrisma({ aheadCount: 0, lastOpenAt });
    const svc = makeService(prisma);

    await svc.preCreateIssues('ssc', INTERVAL_SEC, 5);

    expect(prisma.lotteryIssue.upsert).toHaveBeenCalledTimes(5);
  });

  it('维护/下架期间不预创', async () => {
    const prisma = makePrisma({ aheadCount: 0, lastOpenAt: null });
    prisma.game.findUnique = jest.fn(async () => ({
      id: 'g1',
      code: 'ssc',
      status: 'MAINTENANCE',
      configs: [{ version: 1 }],
    }));
    const svc = makeService(prisma);

    await svc.preCreateIssues('ssc', INTERVAL_SEC, 5);

    expect(prisma.lotteryIssue.upsert).not.toHaveBeenCalled();
    expect(prisma.lotteryIssue.count).not.toHaveBeenCalled();
  });
});
