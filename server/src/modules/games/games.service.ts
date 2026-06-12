import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

/** 从 payTable 剥离 weight 字段，只保留展示信息 */
function stripWeights(payTable: unknown): unknown {
  if (!Array.isArray(payTable)) return payTable;
  return payTable.map(({ weight: _w, ...rest }: Record<string, unknown>) => rest);
}

@Injectable()
export class GamesService {
  constructor(private prisma: PrismaService) {}

  /** 获取上架游戏列表（只返回展示用字段，不暴露爆率权重） */
  async listOnline() {
    const games = await this.prisma.game.findMany({
      where: { status: 'ONLINE' },
      orderBy: { sortOrder: 'asc' },
      include: {
        configs: {
          where: { active: true },
          select: { version: true, rtp: true, payTable: true, params: true },
          take: 1,
        },
      },
    });
    return games.map(g => ({
      ...g,
      configs: g.configs.map(c => ({
        ...c,
        payTable: stripWeights(c.payTable),
      })),
    }));
  }

  /** 获取单个游戏详情（不暴露爆率权重） */
  async getGame(code: string) {
    const game = await this.prisma.game.findUnique({
      where: { code },
      include: {
        configs: {
          where: { active: true },
          select: { version: true, rtp: true, payTable: true, params: true },
          take: 1,
        },
      },
    });
    if (!game) throw new NotFoundException(`游戏 ${code} 不存在或已下架`);
    return {
      ...game,
      configs: game.configs.map(c => ({
        ...c,
        payTable: stripWeights(c.payTable),
      })),
    };
  }

  /** 初始化默认游戏（供 seed 调用） */
  async seed() {
    const defaults = [
      {
        code: 'lucky-wheel', name: '幸运转盘', category: 'SLOT' as const,
        status: 'ONLINE' as const, sortOrder: 1,
        payTable: [
          { label: '谢谢参与', multiplier: 0,   weight: 40 },
          { label: '×1',      multiplier: 1,   weight: 25 },
          { label: '×2',      multiplier: 2,   weight: 15 },
          { label: '×5',      multiplier: 5,   weight: 10 },
          { label: '×10',     multiplier: 10,  weight: 6  },
          { label: '×20',     multiplier: 20,  weight: 3  },
          { label: '×50',     multiplier: 50,  weight: 1  },
        ],
        rtp: 0.95,
      },
      {
        code: 'ffc', name: '分分彩', category: 'LOTTERY' as const,
        status: 'ONLINE' as const, sortOrder: 2, drawIntervalSec: 60,
        payTable: {
          big:    { multiplier: 1.98, desc: '总和 11-18' },
          small:  { multiplier: 1.98, desc: '总和 3-10' },
          odd:    { multiplier: 1.98, desc: '总和为奇数' },
          even:   { multiplier: 1.98, desc: '总和为偶数' },
          exact:  { multiplier: 9.0,  desc: '猜中个位数字' },
        },
        rtp: 0.95,
      },
    ];

    for (const d of defaults) {
      const { payTable, rtp, ...gameData } = d;
      const game = await this.prisma.game.upsert({
        where: { code: d.code },
        update: {},
        create: gameData,
      });
      // 如果没有激活配置，创建一个
      const existing = await this.prisma.gameConfig.findFirst({
        where: { gameId: game.id, active: true },
      });
      if (!existing) {
        await this.prisma.gameConfig.create({
          data: { gameId: game.id, version: 1, active: true, rtp, payTable },
        });
      }
    }
    return { ok: true, seeded: defaults.length };
  }
}
