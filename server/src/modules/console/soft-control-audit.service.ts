/**
 * 软控介入留痕。
 *
 * 背景：牌桌改成独立候选种子之后，开奖结果里已经不存在任何「被改过」的指纹——
 * 对外查不出来正是我们要的，但内部也查不出来就成了另一个问题：事后既无法自证清白，
 * 也无法排查是否有人拿软控做手脚。这张表就是那份内部痕迹。
 *
 * 三条纪律：
 *  1. **只有 ADMIN 能读**，任何对外接口（含玩家端验算、代理端报表、大厅快照）都不得返回本表字段。
 *  2. 只在「放弃了自然结果」时写一行。分母（总局数）从 GameRound / LotteryIssue 拿，
 *     介入率照样算得出来，行数不会被每一次转轮撑爆。
 *  3. 写留痕**绝不能影响开奖**。留痕失败只记日志，不往游戏链路抛异常。
 */
import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { roundMoney } from '@gamebox/shared';
import { PrismaService } from '../../prisma/prisma.service';

export type SoftAuditCategory = 'lottery' | 'table' | 'arcade';

export interface SoftAuditEntry {
  category: SoftAuditCategory;
  gameCode: string;
  /** 期号/局号；街机再赌用 `局号:gamble` 区分同局两次挑选 */
  refNo: string;
  refId?: string | null;
  /** period | dayNet | bias | brake | arcadePool，多个用 + 连接 */
  reason: string;
  tries?: number;
  /** 被放弃的自然结果摘要 */
  naturalDigest?: string | null;
  /** 实际采用的结果摘要 */
  adoptedDigest?: string | null;
  stake?: number;
  estPayout?: number;
}

@Injectable()
export class SoftControlAuditService {
  private readonly logger = new Logger('SoftControlAudit');

  constructor(private prisma: PrismaService) {}

  /**
   * 记一次介入。同一局重复写会撞唯一键，直接当成已记过——
   * 结算重放和崩溃续跑都不会产生重复留痕。
   */
  async record(entry: SoftAuditEntry): Promise<void> {
    const refNo = String(entry.refNo || '').trim();
    if (!refNo) {
      this.logger.warn(`软控留痕缺少局号 game=${entry.gameCode}`);
      return;
    }
    try {
      await this.prisma.softControlAudit.create({
        data: {
          category: entry.category,
          gameCode: entry.gameCode,
          refNo,
          refId: entry.refId ?? null,
          reason: entry.reason || 'unknown',
          tries: Math.max(0, Math.floor(Number(entry.tries) || 0)),
          naturalDigest: entry.naturalDigest ?? null,
          adoptedDigest: entry.adoptedDigest ?? null,
          stake: new Prisma.Decimal(roundMoney(entry.stake ?? 0).toFixed(2)),
          estPayout: new Prisma.Decimal(roundMoney(entry.estPayout ?? 0).toFixed(2)),
        },
      });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') return;
      /* 留痕失败不能拖累开奖，但必须留下噪音让人看见 */
      this.logger.error(
        `软控留痕写入失败 ${entry.category}/${entry.gameCode} ${refNo}`,
        err instanceof Error ? err.stack : String(err),
      );
    }
  }

  /** 后台查询（仅 ADMIN 调用方保证） */
  async list(opts: {
    category?: SoftAuditCategory;
    gameCode?: string;
    from?: Date;
    to?: Date;
    page?: number;
    pageSize?: number;
  }) {
    const page = Math.max(1, Math.floor(Number(opts.page) || 1));
    const pageSize = Math.min(200, Math.max(1, Math.floor(Number(opts.pageSize) || 50)));
    const where: Prisma.SoftControlAuditWhereInput = {
      ...(opts.category ? { category: opts.category } : {}),
      ...(opts.gameCode ? { gameCode: opts.gameCode } : {}),
      ...(opts.from || opts.to
        ? {
            createdAt: {
              ...(opts.from ? { gte: opts.from } : {}),
              ...(opts.to ? { lt: opts.to } : {}),
            },
          }
        : {}),
    };
    const [total, items] = await Promise.all([
      this.prisma.softControlAudit.count({ where }),
      this.prisma.softControlAudit.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);
    return {
      total,
      page,
      pageSize,
      items: items.map((r) => ({
        id: r.id,
        category: r.category,
        gameCode: r.gameCode,
        refNo: r.refNo,
        reason: r.reason,
        tries: r.tries,
        naturalDigest: r.naturalDigest,
        adoptedDigest: r.adoptedDigest,
        stake: Number(r.stake),
        estPayout: Number(r.estPayout),
        createdAt: r.createdAt.toISOString(),
      })),
    };
  }

  /**
   * 介入率概览：分母取同期实际开出的局数，所以「只在介入时写一行」也能算出比率。
   */
  async summary(opts: { from: Date; to: Date }) {
    const { from, to } = opts;
    const [byGame, lotteryDrawn, tableSettled, arcadeRounds] = await Promise.all([
      this.prisma.softControlAudit.groupBy({
        by: ['category', 'gameCode', 'reason'],
        where: { createdAt: { gte: from, lt: to } },
        _count: true,
        _sum: { stake: true, estPayout: true },
      }),
      this.prisma.lotteryIssue.groupBy({
        by: ['gameId'],
        where: { status: 'DRAWN', drawnAt: { gte: from, lt: to } },
        _count: true,
      }),
      this.prisma.gameRound.groupBy({
        by: ['gameId'],
        where: { category: 'TABLE', state: 'SETTLED', startedAt: { gte: from, lt: to } },
        _count: true,
      }),
      this.prisma.gameRound.groupBy({
        by: ['gameId'],
        where: {
          category: { in: ['SLOT', 'ARCADE'] },
          startedAt: { gte: from, lt: to },
        },
        _count: true,
      }),
    ]);

    const games = await this.prisma.game.findMany({ select: { id: true, code: true } });
    const codeById = new Map(games.map((g) => [g.id, g.code]));
    const denom = new Map<string, number>();
    const addDenom = (rows: { gameId: string; _count: number }[]) => {
      for (const r of rows) {
        const code = codeById.get(r.gameId);
        if (!code) continue;
        denom.set(code, (denom.get(code) ?? 0) + Number(r._count));
      }
    };
    addDenom(lotteryDrawn as never);
    addDenom(tableSettled as never);
    addDenom(arcadeRounds as never);

    const rows = byGame.map((r) => {
      const total = denom.get(r.gameCode) ?? 0;
      const steered = Number(r._count);
      return {
        category: r.category,
        gameCode: r.gameCode,
        reason: r.reason,
        steered,
        totalRounds: total,
        steeredPct: total > 0 ? Math.round((steered / total) * 10000) / 100 : null,
        stake: Number(r._sum.stake ?? 0),
        estPayout: Number(r._sum.estPayout ?? 0),
      };
    });
    rows.sort((a, b) => b.steered - a.steered);
    return {
      from: from.toISOString(),
      to: to.toISOString(),
      totalSteered: rows.reduce((s, r) => s + r.steered, 0),
      rows,
    };
  }
}
