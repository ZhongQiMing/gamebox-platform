import { NotFoundException } from '@nestjs/common';
import { LotteryService } from './lottery.service';

/**
 * 游戏内 /snapshot 每 2 秒被每个在线玩家拉一次，负载跟人数走。
 * 这里锁住三件事：并发塌成一次查询、TTL 到期会重查、以及倒计时字段必须是绝对时间戳
 * （一旦有人改成服务端算好的剩余秒数，缓存就会把倒计时冻住）。
 */
function makePrisma() {
  return {
    game: { findUnique: jest.fn(async () => ({ id: 'g1', code: 'ssc' })) },
    lotteryIssue: {
      findFirst: jest.fn(async () => ({
        id: 'i2',
        issueNo: '2026081702',
        status: 'OPEN',
        openAt: new Date('2026-08-17T10:00:00.000Z'),
        lockAt: new Date('2026-08-17T09:59:30.000Z'),
        serverSeedHash: 'hash',
      })),
      findMany: jest.fn(async (_args: { take?: number }) => [
        { id: 'i1', issueNo: '2026081701' },
      ]),
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

describe('彩票快照缓存', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('同一游戏的并发轮询只落一组查询', async () => {
    const prisma = makePrisma();
    const svc = makeService(prisma);

    const results = await Promise.all(
      Array.from({ length: 20 }, () => svc.snapshot('ssc', 20)),
    );

    expect(results).toHaveLength(20);
    /* currentIssue + history 各查一次 game 行，合起来就是这个接口的全部查询 */
    expect(prisma.game.findUnique).toHaveBeenCalledTimes(2);
    expect(prisma.lotteryIssue.findFirst).toHaveBeenCalledTimes(1);
    expect(prisma.lotteryIssue.findMany).toHaveBeenCalledTimes(1);
  });

  it('TTL 内直接命中缓存，过期后重新查库', async () => {
    const prisma = makePrisma();
    const svc = makeService(prisma);
    const now = jest.spyOn(Date, 'now');

    now.mockReturnValue(1_000_000);
    await svc.snapshot('ssc', 20);
    expect(prisma.lotteryIssue.findFirst).toHaveBeenCalledTimes(1);

    /* 同一秒内再来两次：不应该再碰数据库 */
    now.mockReturnValue(1_000_600);
    await svc.snapshot('ssc', 20);
    await svc.snapshot('ssc', 20);
    expect(prisma.lotteryIssue.findFirst).toHaveBeenCalledTimes(1);

    now.mockReturnValue(1_001_500);
    await svc.snapshot('ssc', 20);
    expect(prisma.lotteryIssue.findFirst).toHaveBeenCalledTimes(2);
  });

  it('limit 不同不能互相串数据', async () => {
    const prisma = makePrisma();
    const svc = makeService(prisma);

    await svc.snapshot('ssc', 20);
    await svc.snapshot('ssc', 80);

    expect(prisma.lotteryIssue.findMany).toHaveBeenCalledTimes(2);
    expect(prisma.lotteryIssue.findMany.mock.calls[0][0]).toMatchObject({ take: 20 });
    expect(prisma.lotteryIssue.findMany.mock.calls[1][0]).toMatchObject({ take: 80 });
  });

  it('不存在的游戏不会写进缓存，也不会拖累后续正常请求', async () => {
    const prisma = makePrisma();
    prisma.game.findUnique.mockResolvedValue(null as never);
    const svc = makeService(prisma);

    await expect(svc.snapshot('not-a-game', 20)).rejects.toBeInstanceOf(NotFoundException);
    /* 失败的 promise 不落缓存：再来一次仍会真的去查，而不是复用一个已 reject 的结果 */
    await expect(svc.snapshot('not-a-game', 20)).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.game.findUnique).toHaveBeenCalledTimes(4);
  });

  it('倒计时依据必须是绝对时间戳，否则缓存会冻住倒计时', async () => {
    const prisma = makePrisma();
    const svc = makeService(prisma);

    const snap = (await svc.snapshot('ssc', 20)) as {
      current: { openAt: Date; lockAt: Date } | null;
    };

    expect(snap.current?.openAt).toBeInstanceOf(Date);
    expect(snap.current?.lockAt).toBeInstanceOf(Date);
    expect(JSON.stringify(snap)).not.toMatch(/secondsLeft|remainSec|countdown/i);
  });
});
