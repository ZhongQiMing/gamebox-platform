import { ConflictException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { RechargeService } from './recharge.service';

function makeService() {
  return new RechargeService(
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
  );
}

function makeTx(overrides: Partial<{ amount: number; roomId: string; channel: string }> = {}) {
  const order = {
    id: 'order-1',
    orderNo: 'REQUEST_123',
    playerId: 'player-1',
    type: 'UP',
    amount: new Prisma.Decimal(overrides.amount ?? 500),
    roomId: overrides.roomId ?? 'room-1',
    channel: overrides.channel ?? '人工',
  };
  return {
    $queryRaw: jest.fn().mockResolvedValue([{ locked: '1' }]),
    roomMember: {
      findFirst: jest.fn().mockResolvedValue({ roomId: 'room-1' }),
    },
    rechargeOrder: {
      findUnique: jest.fn().mockResolvedValue(order),
      create: jest.fn(),
    },
  };
}

describe('RechargeService 幂等不可变参数', () => {
  it('规范化后参数一致时返回旧单', async () => {
    const tx = makeTx();
    const result = await makeService().applyRechargeInTx(
      tx as never,
      'player-1',
      500,
      '  人工 ',
      { roomId: 'room-1', clientRequestId: 'REQUEST_123' },
    );
    expect(result.id).toBe('order-1');
    expect(tx.rechargeOrder.create).not.toHaveBeenCalled();
  });

  it.each([
    [{ amount: 600 }, '金额'],
    [{ roomId: 'room-2' }, '房间'],
    [{ channel: '银行卡' }, '渠道'],
  ])('同 key 的%s不同返回 409', async (override, _label) => {
    const tx = makeTx(override);
    await expect(
      makeService().applyRechargeInTx(tx as never, 'player-1', 500, '人工', {
        roomId: 'room-1',
        clientRequestId: 'REQUEST_123',
      }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(tx.rechargeOrder.create).not.toHaveBeenCalled();
  });
});
