import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { closedDiskDebitBetInTx, closedDiskSettleWinInTx } from './player-fund.helper';

/**
 * 加锁顺序约定：同时动代理与玩家两个账户的地方，一律先锁代理行、再动玩家账户。
 *
 * 顺序相反会形成循环等待——结算握着玩家行等代理行，回水领取握着代理行等玩家行，
 * Postgres 检测到死锁后杀掉一方。上层虽然有重试兜住，但那是止血，不是根治。
 * 这条测试把顺序固定下来，防止以后有人改回去。
 */
describe('资金路径加锁顺序', () => {
  /** 记录事务里各步的先后：代理行锁 / 玩家入账 / 代理盘分 */
  function makeTx() {
    const order: string[] = [];
    const tx = {
      $queryRaw: jest.fn(async (parts: unknown) => {
        const sql = Array.isArray(parts) ? (parts as string[]).join('?') : String(parts);
        if (sql.includes('"Agent"')) order.push('lockAgent');
        return [{ id: 'agent-1' }];
      }),
      $executeRaw: jest.fn(async () => 1),
      room: { findUnique: jest.fn().mockResolvedValue({ bookMode: 'CASH' }) },
      agent: {
        findUnique: jest.fn().mockResolvedValue({ userId: 'a1', pointsQuota: 100000 }),
        update: jest.fn(async () => ({ userId: 'a1' })),
        create: jest.fn(async () => ({ userId: 'a1' })),
      },
      agentQuotaLedger: {
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest.fn(async () => ({ id: 'q1' })),
      },
      pointsLedger: { findUnique: jest.fn().mockResolvedValue(null) },
    };
    const points = {
      creditInTx: jest.fn(async (_tx: unknown, ownerType: string) => {
        order.push(ownerType === 'PLAYER' ? 'player' : 'agentPoints');
        return { id: 'l1' };
      }),
    };
    return { tx, points, order };
  }

  const base = {
    playerId: 'p1',
    agentUserId: 'a1',
    roomId: 'room-1',
    bookMode: 'CASH',
    remark: '测试',
    refType: 'round',
    refId: 'r1',
  };

  it('关盘下注：先锁代理行，再动玩家账户', async () => {
    const { tx, points, order } = makeTx();
    await closedDiskDebitBetInTx(tx as never, points as never, {
      ...base,
      amount: 100,
      idemPlayer: 'k_player',
      idemAgent: 'k_agent',
    });
    expect(order[0]).toBe('lockAgent');
    expect(order.indexOf('lockAgent')).toBeLessThan(order.indexOf('player'));
  });

  it('关盘派彩：先锁代理行，再动玩家账户', async () => {
    const { tx, points, order } = makeTx();
    await closedDiskSettleWinInTx(tx as never, points as never, {
      ...base,
      stake: 100,
      payout: 200,
      idemPlayer: 'k_player',
      idemAgent: 'k_agent',
    });
    expect(order[0]).toBe('lockAgent');
    expect(order.indexOf('lockAgent')).toBeLessThan(order.indexOf('player'));
  });

  it('源码里这条约定写在文件头，改动前能看见', () => {
    /* 约定只靠人记会失传，必须写在代码里 */
    const src = readFileSync(join(__dirname, 'player-fund.helper.ts'), 'utf8');
    expect(src).toContain('加锁顺序约定');
    expect(src).toContain('先锁代理行');
  });
});
