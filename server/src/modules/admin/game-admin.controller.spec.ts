import { GameAdminController } from './game-admin.controller';

describe('GameAdminController 游戏列表契约', () => {
  it('将 Prisma Decimal 限红序列化为 number', async () => {
    const prisma = {
      game: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'game-1',
            code: 'baccarat',
            minBet: { toString: () => '10.50' },
            maxBet: { toString: () => '50000.25' },
            configs: [{ version: 1, rtp: 0.95, active: true }],
          },
        ]),
      },
    };
    const controller = new GameAdminController(
      prisma as never,
      {} as never,
      {} as never,
      {} as never,
    );

    const result = await controller.list();
    const serialized = JSON.parse(JSON.stringify(result));

    expect(serialized[0]).toMatchObject({
      minBet: 10.5,
      maxBet: 50000.25,
      configs: [{ version: 1, rtp: 0.95, active: true }],
    });
    expect(typeof serialized[0].minBet).toBe('number');
    expect(typeof serialized[0].maxBet).toBe('number');
  });
});
