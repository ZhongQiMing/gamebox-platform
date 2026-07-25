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
        code: 'ffc', name: '1分时时彩', category: 'LOTTERY' as const,
        status: 'ONLINE' as const, sortOrder: 2, drawIntervalSec: 60,
        payTable: {
          big:    { multiplier: 1.995, desc: '总和 23-45' },
          small:  { multiplier: 1.995, desc: '总和 0-22' },
          odd:    { multiplier: 1.995, desc: '总和为奇数' },
          even:   { multiplier: 1.995, desc: '总和为偶数' },
          exact:  { multiplier: 9.95,  desc: '猜中个位数字' },
          ballSide: { multiplier: 1.995, desc: '定位两面' },
          position: { multiplier: 9.95, desc: '定位胆' },
          anyDigit: { multiplier: 3.6, desc: '不定位' },
          group3: { multiplier: 260, desc: '三星组三' },
          group6: { multiplier: 125, desc: '三星组六' },
          dragon: { multiplier: 1.99, desc: '龙（万>个）' },
          tiger: { multiplier: 1.99, desc: '虎（万<个）' },
          tie: { multiplier: 9, desc: '和（万=个）' },
          noNiu: { multiplier: 2.02, desc: '无牛' },
          niu: { multiplier: 9.22, desc: '牛1~牛9、牛牛' },
          niuSide: { multiplier: 1.98, desc: '牛大/小/单/双' },
          shape_豹子: { multiplier: 75, desc: '前中后·豹子' },
          shape_顺子: { multiplier: 14.5, desc: '前中后·顺子' },
          shape_对子: { multiplier: 3.3, desc: '前中后·对子' },
          shape_半顺: { multiplier: 2.5, desc: '前中后·半顺' },
          shape_杂六: { multiplier: 3, desc: '前中后·杂六' },
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
