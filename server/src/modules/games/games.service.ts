import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { sscFfcPayTable } from '../lottery/games/ffc.game';
import { LOTTERY_INTERVALS } from '../lottery/lottery-intervals';

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

  /**
   * 初始化默认游戏（供 seed 调用）。
   * 时时彩赔率/间隔与 prisma/seed、sscFfcPayTable 同源，禁止再内嵌旧数字。
   */
  async seed() {
    const SSC_FFC_PAY = { ...sscFfcPayTable };
    const defaults = [
      {
        code: 'ffc',
        name: '1分时时彩',
        category: 'LOTTERY' as const,
        status: 'ONLINE' as const,
        sortOrder: 2,
        drawIntervalSec: LOTTERY_INTERVALS.ffc,
        payTable: SSC_FFC_PAY,
        rtp: 0.95,
      },
      {
        code: 'ssc',
        name: '快乐时时彩',
        category: 'LOTTERY' as const,
        status: 'ONLINE' as const,
        sortOrder: 4,
        drawIntervalSec: LOTTERY_INTERVALS.ssc,
        payTable: SSC_FFC_PAY,
        rtp: 0.95,
      },
    ];

    for (const d of defaults) {
      const { payTable, rtp, ...gameData } = d;
      const game = await this.prisma.game.upsert({
        where: { code: d.code },
        update: {
          status: d.status,
          name: d.name,
          sortOrder: d.sortOrder,
          drawIntervalSec: d.drawIntervalSec,
        },
        create: gameData,
      });
      const existing = await this.prisma.gameConfig.findFirst({
        where: { gameId: game.id, active: true },
      });
      if (!existing) {
        await this.prisma.gameConfig.create({
          data: { gameId: game.id, version: 1, active: true, rtp, payTable },
        });
      } else {
        await this.prisma.gameConfig.update({
          where: { id: existing.id },
          data: { rtp, payTable },
        });
      }
    }
    return { ok: true, seeded: defaults.length };
  }
}
