import { GamesService } from './games.service';

function decimal(value: string) {
  return {
    toString: () => value,
    valueOf: () => value,
  };
}

describe('GamesService 公开游戏契约', () => {
  const prisma = {
    game: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
    },
  };
  let service: GamesService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new GamesService(prisma as never);
  });

  it('列表将 Decimal 转为 number、补齐缺失 iconUrl，且不泄露 RTP 和权重', async () => {
    prisma.game.findMany.mockResolvedValue([
      {
        id: 'game-1',
        code: 'fruit-machine',
        name: '水果机',
        category: 'SLOT',
        status: 'ONLINE',
        sortOrder: 3,
        minBet: decimal('12.50'),
        maxBet: decimal('98765.43'),
        configs: [
          {
            version: 7,
            rtp: 0.96,
            params: { internalSeed: 'secret' },
            payTable: [
              {
                label: '苹果',
                multiplier: 2,
                weight: 30,
                rtp: 0.96,
                detail: { awardWeights: [1, 2], visible: true },
              },
            ],
          },
        ],
      },
    ]);

    const result = await service.listOnline();
    const serialized = JSON.parse(JSON.stringify(result));

    expect(serialized).toEqual([
      {
        id: 'game-1',
        code: 'fruit-machine',
        name: '水果机',
        category: 'SLOT',
        status: 'ONLINE',
        iconUrl: null,
        sortOrder: 3,
        minBet: 12.5,
        maxBet: 98765.43,
        configs: [
          {
            version: 7,
            payTable: [
              { label: '苹果', multiplier: 2, detail: { visible: true } },
            ],
          },
        ],
      },
    ]);
    expect(serialized[0].configs[0]).not.toHaveProperty('rtp');
    expect(serialized[0].configs[0]).not.toHaveProperty('params');
  });

  it('详情保持与列表相同的字段和数值类型', async () => {
    prisma.game.findUnique.mockResolvedValue({
      id: 'game-2',
      code: 'ssc',
      name: '时时彩',
      category: 'LOTTERY',
      status: 'ONLINE',
      iconUrl: '/images/ssc.webp',
      sortOrder: 4,
      minBet: decimal('1.00'),
      maxBet: decimal('100000.00'),
      configs: [{ version: 2, payTable: { big: 1.98, weights: [1, 2] } }],
    });

    const result = await service.getGame('ssc');

    expect(result).toMatchObject({
      iconUrl: '/images/ssc.webp',
      minBet: 1,
      maxBet: 100000,
      configs: [{ version: 2, payTable: { big: 1.98 } }],
    });
  });
});
