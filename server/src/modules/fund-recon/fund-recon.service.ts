/**
 * 资金对账：核对「账面数字」与「流水/凭据」是否吻合。
 *
 * 系统里余额和流水是分开存的两份数据，正常情况下每改一次余额就写一条流水，
 * 两边永远一致。只要有一行代码图省事直接改了余额没写流水，两边就永久错开，
 * 而且不会报任何错——系统照常跑，只是账花了。等代理找上门说少了三万，
 * 既查不出什么时候没的，也分不清是系统 bug 还是他记错。这个服务就是替你盯着。
 *
 * 只查不改。发现差额后的修复要人工确认原因，走 fixPointsDrift / fixQuotaDrift。
 */
import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { Prisma } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { asMoney, roundMoney } from '@gamebox/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { RedisService } from '../../redis/redis.service';
import { AdminLogService } from '../admin/admin-log.service';
import type { ReconCheck, ReconReport, ReconRow } from './fund-recon.types';

/** 明细最多带这么多行；bad 计数不受此限制 */
const MAX_ROWS = 200;
const CRON_LOCK_KEY = 'gamebox:fund-recon:cron';
/** 锁比预期耗时长得多，卡住的实例不会让下一天也跑不了（TTL 到点自动释放） */
const CRON_LOCK_TTL_MS = 30 * 60 * 1000;

interface DriftQueryRow {
  id: string;
  label: string;
  actual: number;
  expected: number;
}

@Injectable()
export class FundReconService {
  private readonly logger = new Logger(FundReconService.name);
  private last: ReconReport | null = null;
  private running = false;

  constructor(
    private prisma: PrismaService,
    private redis: RedisService,
    private adminLog: AdminLogService,
  ) {}

  /** 最近一次对账结果；服务刚起还没跑过时为 null */
  getLast(): ReconReport | null {
    return this.last;
  }

  /**
   * 每天 05:00（上海）跑一次，落在既有的 04:00–06:00 维护窗内，玩家无感。
   * 四条检查都是全表聚合，流水上千万行后单次要数秒到数十秒。
   */
  @Cron('0 5 * * *', { timeZone: 'Asia/Shanghai' })
  async cronRun() {
    const token = randomUUID();
    /* 多实例只让一个跑：查询本身只读，但重复跑白烧 CPU、告警也会重复 */
    if (!(await this.redis.tryLock(CRON_LOCK_KEY, token, CRON_LOCK_TTL_MS))) return;
    try {
      const report = await this.run();
      if (!report.ok) {
        this.logger.error(
          `资金对账发现 ${report.totalBad} 处异常：` +
            report.checks
              .filter((c) => c.bad > 0)
              .map((c) => `${c.label} ${c.bad} 条`)
              .join('；'),
        );
      } else {
        this.logger.log(`资金对账通过（${report.durationMs}ms）`);
      }
    } catch (err) {
      this.logger.error('资金对账执行失败', err instanceof Error ? err.stack : String(err));
    } finally {
      await this.redis.releaseLock(CRON_LOCK_KEY, token);
    }
  }

  /** 跑一遍全部检查并刷新缓存 */
  async run(): Promise<ReconReport> {
    if (this.running) throw new BadRequestException('对账正在进行中，请稍候');
    this.running = true;
    const startedAt = Date.now();
    try {
      const checks = [
        await this.checkPointsSum(),
        await this.checkQuotaSum(),
        await this.checkFrozenOrders(),
        await this.checkNegativeBalance(),
      ];
      const totalBad = checks.reduce((n, c) => n + c.bad, 0);
      this.last = {
        checkedAt: new Date().toISOString(),
        durationMs: Date.now() - startedAt,
        ok: totalBad === 0,
        totalBad,
        checks,
      };
      return this.last;
    } finally {
      this.running = false;
    }
  }

  // ── 检查项 ────────────────────────────────────────────────

  /** A 积分账：逐账户 SUM(PointsLedger.amount) 必须等于 PointsAccount.balance */
  private async checkPointsSum(): Promise<ReconCheck> {
    const rows = await this.prisma.$queryRaw<DriftQueryRow[]>`
      SELECT a."id"                                   AS id,
             COALESCE(u."nickname", a."ownerId")
               || '（' || a."ownerType"
               || CASE WHEN a."roomId" <> '' THEN '·' || COALESCE(r."name", a."roomId") ELSE '' END
               || '）'                                AS label,
             a."balance"::float8                      AS actual,
             COALESCE(SUM(l."amount"), 0)::float8     AS expected
      FROM "PointsAccount" a
      LEFT JOIN "PointsLedger" l ON l."accountId" = a."id"
      LEFT JOIN "User" u ON u."id" = a."ownerId"
      LEFT JOIN "Room" r ON r."id" = a."roomId"
      GROUP BY a."id", a."ownerType", a."ownerId", a."roomId", a."balance", u."nickname", r."name"
      HAVING a."balance" <> COALESCE(SUM(l."amount"), 0)
      ORDER BY ABS(a."balance" - COALESCE(SUM(l."amount"), 0)) DESC
      LIMIT ${MAX_ROWS + 1}
    `;
    return this.pack({
      key: 'points_sum',
      label: '积分账（余额 vs 流水）',
      hint: '有代码绕开 PointsService 直接改了余额，或流水被删过',
      scope: 'ACCOUNT',
      fixable: true,
      rows,
    });
  }

  /** C 盘分账：逐代理 SUM(AgentQuotaLedger.delta) 必须等于 Agent.pointsQuota */
  private async checkQuotaSum(): Promise<ReconCheck> {
    const rows = await this.prisma.$queryRaw<DriftQueryRow[]>`
      SELECT ag."userId"                              AS id,
             COALESCE(u."nickname", ag."userId")
               || '（' || COALESCE(u."uid", '—') || '）' AS label,
             ag."pointsQuota"::float8                 AS actual,
             COALESCE(SUM(l."delta"), 0)::float8      AS expected
      FROM "Agent" ag
      LEFT JOIN "AgentQuotaLedger" l ON l."agentUserId" = ag."userId"
      LEFT JOIN "User" u ON u."id" = ag."userId"
      GROUP BY ag."userId", ag."pointsQuota", u."nickname", u."uid"
      HAVING ag."pointsQuota" <> COALESCE(SUM(l."delta"), 0)
      ORDER BY ABS(ag."pointsQuota" - COALESCE(SUM(l."delta"), 0)) DESC
      LIMIT ${MAX_ROWS + 1}
    `;
    return this.pack({
      key: 'quota_sum',
      label: '盘分账（上盘额度 vs 流水）',
      hint: '有代码绕开 writeAgentQuotaInTx 直接改了 pointsQuota',
      scope: 'AGENT',
      fixable: true,
      rows,
    });
  }

  /**
   * 冻结额：玩家 frozen 必须等于其待审下分单金额之和。
   * 对不上意味着有钱卡在冻结里没人认领——玩家花不掉，报表也看不见。
   */
  private async checkFrozenOrders(): Promise<ReconCheck> {
    const rows = await this.prisma.$queryRaw<DriftQueryRow[]>`
      WITH pending AS (
        SELECT o."playerId", COALESCE(o."roomId", '') AS "roomId", SUM(o."amount") AS amt
        FROM "RechargeOrder" o
        WHERE o."type" = 'DOWN' AND o."status" = 'PENDING'
        GROUP BY o."playerId", COALESCE(o."roomId", '')
      )
      SELECT a."id"                                   AS id,
             COALESCE(u."nickname", a."ownerId")
               || '（' || COALESCE(r."name", '无房') || '）' AS label,
             a."frozen"::float8                       AS actual,
             COALESCE(p.amt, 0)::float8               AS expected
      FROM "PointsAccount" a
      LEFT JOIN pending p ON p."playerId" = a."ownerId" AND p."roomId" = a."roomId"
      LEFT JOIN "User" u ON u."id" = a."ownerId"
      LEFT JOIN "Room" r ON r."id" = a."roomId"
      WHERE a."ownerType" = 'PLAYER'
        AND a."frozen" <> COALESCE(p.amt, 0)
      ORDER BY ABS(a."frozen" - COALESCE(p.amt, 0)) DESC
      LIMIT ${MAX_ROWS + 1}
    `;
    return this.pack({
      key: 'frozen_orders',
      label: '冻结额（冻结 vs 待审下分单）',
      hint: '下分单审核流程中断，钱卡在冻结里；需按单人工通过或驳回',
      scope: 'NONE',
      fixable: false,
      rows,
    });
  }

  /** 玩家余额与冻结额不得为负；为负说明扣款下限保护被击穿（代理盘分可负，不在此列） */
  private async checkNegativeBalance(): Promise<ReconCheck> {
    const rows = await this.prisma.$queryRaw<DriftQueryRow[]>`
      SELECT a."id"                                   AS id,
             COALESCE(u."nickname", a."ownerId")
               || '（' || a."ownerType" || '）'        AS label,
             LEAST(a."balance", a."frozen")::float8   AS actual,
             0::float8                                AS expected
      FROM "PointsAccount" a
      LEFT JOIN "User" u ON u."id" = a."ownerId"
      WHERE a."ownerType" = 'PLAYER' AND (a."balance" < 0 OR a."frozen" < 0)
      ORDER BY LEAST(a."balance", a."frozen") ASC
      LIMIT ${MAX_ROWS + 1}
    `;
    return this.pack({
      key: 'negative_balance',
      label: '负数哨兵（玩家余额/冻结）',
      hint: '扣款的下限保护被击穿；先查是哪条扣款路径，再决定怎么补',
      scope: 'NONE',
      fixable: false,
      rows,
    });
  }

  private pack(opts: {
    key: ReconCheck['key'];
    label: string;
    hint: string;
    scope: ReconRow['scope'];
    fixable: boolean;
    rows: DriftQueryRow[];
  }): ReconCheck {
    /* 多查一行用来判断是否被 LIMIT 截断，展示时丢掉 */
    const truncated = opts.rows.length > MAX_ROWS;
    const rows = opts.rows.slice(0, MAX_ROWS).map<ReconRow>((r) => ({
      scope: opts.scope,
      id: r.id,
      label: r.label,
      actual: roundMoney(r.actual),
      expected: roundMoney(r.expected),
      drift: roundMoney(r.actual - r.expected),
    }));
    return {
      key: opts.key,
      label: opts.label,
      hint: truncated ? `${opts.hint}（明细超过 ${MAX_ROWS} 条，此处只列前 ${MAX_ROWS} 条）` : opts.hint,
      bad: opts.rows.length,
      rows,
      fixable: opts.fixable,
    };
  }

  // ── 差错调整 ──────────────────────────────────────────────

  /**
   * 补记积分账差错调整：写一条流水把差额记上，**不动余额**。
   *
   * 账面余额是玩家实际能花的钱，是既成事实；补流水是给这笔既成事实补一个说明。
   * 至于钱该不该退给谁，是另一个业务决定，走正常上下分，那笔会自己留痕。
   * 直接把余额改成流水合计等于凭空吞掉玩家的钱，绝不能做。
   */
  async fixPointsDrift(operatorId: string, accountId: string, reason: string) {
    const note = this.assertReason(reason);
    return this.prisma.$transaction(async (tx) => {
      const [account] = await tx.$queryRaw<
        { id: string; balance: unknown; ownerType: string; ownerId: string }[]
      >`
        SELECT "id", "balance", "ownerType", "ownerId"
        FROM "PointsAccount" WHERE "id" = ${accountId} FOR UPDATE
      `;
      if (!account) throw new NotFoundException('账户不存在');

      const agg = await tx.pointsLedger.aggregate({
        where: { accountId },
        _sum: { amount: true },
      });
      const actual = asMoney(account.balance);
      const expected = asMoney(agg._sum.amount ?? 0);
      const drift = roundMoney(actual - expected);
      if (drift === 0) throw new BadRequestException('该账户已无差额，无需调整');

      await tx.pointsLedger.create({
        data: {
          accountId,
          bizType: 'ADJUST',
          amount: new Prisma.Decimal(drift.toFixed(2)),
          balanceAfter: new Prisma.Decimal(actual.toFixed(2)),
          refType: 'recon_fix',
          refId: accountId,
          remark: `对账差错调整：${note}`,
          operatorId,
          idempotencyKey: `recon_fix:points:${accountId}:${randomUUID()}`,
        },
      });
      await this.adminLog.logInTx(tx, operatorId, 'RECON_FIX', accountId, {
        kind: 'points',
        ownerType: account.ownerType,
        ownerId: account.ownerId,
        drift,
        balance: actual,
        ledgerSum: expected,
        reason: note,
      });
      return { ok: true, drift, balance: actual };
    });
  }

  /** 补记盘分账差错调整：写一条盘分流水记上差额，不动 pointsQuota。口径同上。 */
  async fixQuotaDrift(operatorId: string, agentUserId: string, reason: string) {
    const note = this.assertReason(reason);
    return this.prisma.$transaction(async (tx) => {
      const [agent] = await tx.$queryRaw<{ userId: string; pointsQuota: unknown }[]>`
        SELECT "userId", "pointsQuota" FROM "Agent" WHERE "userId" = ${agentUserId} FOR UPDATE
      `;
      if (!agent) throw new NotFoundException('代理不存在');

      const agg = await tx.agentQuotaLedger.aggregate({
        where: { agentUserId },
        _sum: { delta: true },
      });
      const actual = asMoney(agent.pointsQuota);
      const expected = asMoney(agg._sum.delta ?? 0);
      const drift = roundMoney(actual - expected);
      if (drift === 0) throw new BadRequestException('该代理已无差额，无需调整');

      const room = await tx.room.findFirst({
        where: { ownerAgent: { userId: agentUserId }, bookMode: 'CREDIT' },
        select: { id: true },
      });
      await tx.agentQuotaLedger.create({
        data: {
          agentUserId,
          bookMode: room ? 'CREDIT' : 'CASH',
          bizType: 'ADJUST',
          delta: new Prisma.Decimal(drift.toFixed(2)),
          quotaAfter: new Prisma.Decimal(actual.toFixed(2)),
          refType: 'recon_fix',
          refId: agentUserId,
          remark: `对账差错调整：${note}`,
          idempotencyKey: `recon_fix:quota:${agentUserId}:${randomUUID()}`,
        },
      });
      await this.adminLog.logInTx(tx, operatorId, 'RECON_FIX', agentUserId, {
        kind: 'quota',
        drift,
        pointsQuota: actual,
        ledgerSum: expected,
        reason: note,
      });
      return { ok: true, drift, pointsQuota: actual };
    });
  }

  /** 原因必填：这条调整以后是唯一能解释差额的东西，写「调账」等于没写 */
  private assertReason(raw: string): string {
    const note = String(raw || '').trim().slice(0, 200);
    if (note.length < 4) throw new BadRequestException('请写清差额原因（至少 4 个字）');
    return note;
  }
}
