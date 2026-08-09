import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { sscFfcPayTable } from '../lottery/games/ffc.game';
import { LOTTERY_INTERVALS } from '../lottery/lottery-intervals';
import { RETIRED_GAME_CODES, isRetiredGameCode } from './retired-games';

/** 从 payTable 剥离 weight / awardWeights / rtp 等敏感字段，只保留展示信息 */
function stripWeights(payTable: unknown): unknown {
  if (Array.isArray(payTable)) {
    return payTable.map((row) => {
      if (!row || typeof row !== 'object') return row;
      const { weight: _w, awardWeights: _aw, ...rest } = row as Record<string, unknown>;
      return rest;
    });
  }
  if (payTable && typeof payTable === 'object') {
    const o = { ...(payTable as Record<string, unknown>) };
    delete o.weight;
    delete o.awardWeights;
    delete o.weights;
    return o;
  }
  return payTable;
}

@Injectable()
export class GamesService {
  constructor(private prisma: PrismaService) {}

  /**
   * 大厅目录：上架 + 维护（下架不返回）。
   * 维护态前端可见但不可进；只返回展示字段，不暴露爆率权重。
   * 退役码硬过滤：旧库残留行被误改回 ONLINE 也不该出现在大厅。
   */
  async listOnline() {
    const games = await this.prisma.game.findMany({
      where: {
        status: { in: ['ONLINE', 'MAINTENANCE'] },
        code: { notIn: [...RETIRED_GAME_CODES] },
      },
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
      id: g.id,
      code: g.code,
      name: g.name,
      category: g.category,
      status: g.status,
      sortOrder: g.sortOrder,
      minBet: g.minBet,
      maxBet: g.maxBet,
      configs: g.configs.map(c => ({
        version: c.version,
        /* 公开接口不返回 rtp / 权重 */
        payTable: stripWeights(c.payTable),
      })),
    }));
  }

  /** 获取单个游戏详情（不暴露爆率权重；仅上架可查） */
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
    if (!game || game.status !== 'ONLINE' || isRetiredGameCode(code)) {
      throw new NotFoundException(`游戏 ${code} 不存在或已下架`);
    }
    return {
      id: game.id,
      code: game.code,
      name: game.name,
      category: game.category,
      status: game.status,
      sortOrder: game.sortOrder,
      minBet: game.minBet,
      maxBet: game.maxBet,
      configs: game.configs.map(c => ({
        version: c.version,
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
