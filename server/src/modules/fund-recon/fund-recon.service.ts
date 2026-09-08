/**
 * 资金对账：核对「账面数字」与「流水/凭据」是否吻合。
 *
 * 系统里余额和流水是分开存的两份数据，正常情况下每改一次余额就写一条流水，
 * 两边永远一致。只要有一行代码图省事直接改了余额没写流水，两边就永久错开，
 * 而且不会报任何错——系统照常跑，只是账花了。等代理找上门说少了三万，
 * 既查不出什么时候没的，也分不清是系统 bug 还是他记错。这个服务就是替你盯着。
 *
 * **只查不改，而且刻意不提供任何「一键修平」的入口。**
 *
 * 曾经有两个「补流水」接口，只写一条流水让差额归零、不动余额。那等于把证据抹掉：
 * 若真相是「余额多了」，补完变成两边一起错，反而看不出差额。已删除。
 * 对不上就说明出过事，正确做法是查清原因，再走正常的上分/下分把钱调平——
 * 那条路会同时改余额和写流水，两边始终一致，也留下可追溯的资金流水。
 */
import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { Prisma } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { roundMoney } from '@gamebox/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { RedisService } from '../../redis/redis.service';
import { AdminLogService } from '../admin/admin-log.service';
import type { ReconCheck, ReconCheckKey, ReconReport, ReconRow } from './fund-recon.types';
import {
  activePayoutRelease,
  payoutGateStatus,
  type PayoutGateStatus,
} from './payout-gate.helper';

/** 明细最多带这么多行；bad 计数不受此限制 */
const MAX_ROWS = 200;
const CRON_LOCK_KEY = 'gamebox:fund-recon:cron';
/** 锁比预期耗时长得多，卡住的实例不会让下一天也跑不了（TTL 到点自动释放） */
const CRON_LOCK_TTL_MS = 30 * 60 * 1000;
/*
 * 出款闸门的时效阈值（26 小时）已随判定逻辑一起搬到 payout-gate.helper.ts，
 * 那里是出款路径真正调用的地方；这里不再留一份，免得两处数字打架。
 */
/** 单次人工放行的最长时效，避免「放一次就永久敞开」 */
const PAYOUT_GATE_MAX_RELEASE_HOURS = 24;
/** 平台余额合并积压告警阈值；合并间隔是 200ms，留足够余量避免抖动误报 */
const PLATFORM_BACKLOG_MAX_AGE_SEC = 60;
const PLATFORM_BACKLOG_MAX_ROWS = 50_000;

export type ReconTrigger = 'cron' | 'manual' | 'gate';

/**
 * 哪些检查项算「账本被破坏」，才有资格拦出款。
 *
 * 没进这个集合的项只告警：
 *  - credit_conservation：房间层恒等式，误伤会把全站出款停掉；不平先告警、再按房间查
 *  - frozen_orders：某一单审核流程卡住，是单点问题
 *  - swallowed_bets：是玩家损失，要立刻处理，但停掉全站出款并不能解决它
 * 拿正常波动去停全站出款，结果就是所有人天天点放行，闸门也就废了。
 */
const GATING_CHECKS = new Set<ReconCheckKey>([
  'points_sum',
  'quota_sum',
  'negative_balance',
  'bet_debit_voucher',
  'duplicate_payout',
  'global_ledger_net',
]);

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
      const report = await this.run('cron');
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

  /** 跑一遍全部检查，刷新缓存并落库 */
  async run(trigger: ReconTrigger = 'manual'): Promise<ReconReport> {
    if (this.running) throw new BadRequestException('对账正在进行中，请稍候');
    this.running = true;
    const startedAt = Date.now();
    try {
      const checks = [
        await this.checkPointsSum(),
        await this.checkQuotaSum(),
        await this.checkFrozenOrders(),
        await this.checkNegativeBalance(),
        await this.checkCreditConservation(),
        await this.checkGeneralHouseLedger(),
        /* 下面几条查的是「游戏结算有没有把钱吞掉或多派」，是最贴近玩家投诉的一类 */
        await this.checkSwallowedBets(),
        await this.checkBetDebitVoucher(),
        await this.checkDuplicatePayout(),
        await this.checkGlobalLedgerNet(),
        await this.checkBetWithoutRoom(),
        await this.checkPlatformApplyBacklog(),
      ];
      const totalBad = checks.reduce((n, c) => n + c.bad, 0);
      this.last = {
        checkedAt: new Date().toISOString(),
        durationMs: Date.now() - startedAt,
        ok: totalBad === 0,
        totalBad,
        checks,
      };
      await this.persist(trigger, this.last);
      return this.last;
    } finally {
      this.running = false;
    }
  }

  /**
   * 落库。
   *
   * 出款闸门要依赖「最近一次对账结论」，只放在进程内存里的话，刚重启的实例
   * 既无法放行也无法拦截。落库失败不能让对账本身失败，所以只记日志。
   */
  private async persist(trigger: ReconTrigger, report: ReconReport) {
    try {
      await this.prisma.fundReconRun.create({
        data: {
          trigger,
          ok: report.ok,
          totalBad: report.totalBad,
          durationMs: report.durationMs,
          report: report as unknown as Prisma.InputJsonValue,
        },
      });
    } catch (err) {
      this.logger.error(
        '对账结果落库失败（本次结论仅存在内存中）',
        err instanceof Error ? err.stack : String(err),
      );
    }
  }

  /** 最近一次落库的对账结论；进程重启后也能读到 */
  async getLastPersisted(): Promise<{
    ok: boolean;
    totalBad: number;
    trigger: string;
    checkedAt: Date;
    report: ReconReport;
  } | null> {
    const row = await this.prisma.fundReconRun.findFirst({
      orderBy: { createdAt: 'desc' },
    });
    if (!row) return null;
    return {
      ok: row.ok,
      totalBad: row.totalBad,
      trigger: row.trigger,
      checkedAt: row.createdAt,
      report: row.report as unknown as ReconReport,
    };
  }

  /** 历史列表（后台对账页用） */
  async history(opts: { page?: number; pageSize?: number } = {}) {
    const page = Math.max(1, Math.floor(Number(opts.page) || 1));
    const pageSize = Math.min(100, Math.max(1, Math.floor(Number(opts.pageSize) || 20)));
    const [total, rows] = await Promise.all([
      this.prisma.fundReconRun.count(),
      this.prisma.fundReconRun.findMany({
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        select: {
          id: true,
          trigger: true,
          ok: true,
          totalBad: true,
          durationMs: true,
          createdAt: true,
        },
      }),
    ]);
    return {
      total,
      page,
      pageSize,
      items: rows.map((r) => ({
        id: r.id,
        trigger: r.trigger,
        ok: r.ok,
        totalBad: r.totalBad,
        durationMs: r.durationMs,
        checkedAt: r.createdAt.toISOString(),
      })),
    };
  }

  // ── 检查项 ────────────────────────────────────────────────

  /**
   * A 积分账：逐账户 SUM(PointsLedger.amount) 必须等于 PointsAccount.balance。
   *
   * 平台账户要扣掉还在 PlatformApplyQueue 里等合并的部分——那些账已经记下、
   * 但按设计还没加进余额（见 PointsService.creditInTx 里的记账分支）。
   * 不扣就会把「正常的合并延迟」误报成账实不符。
   */
  private async checkPointsSum(): Promise<ReconCheck> {
    const rows = await this.prisma.$queryRaw<DriftQueryRow[]>`
      WITH pending AS (
        SELECT "accountId", SUM("amount") AS amt
        FROM "PlatformApplyQueue"
        GROUP BY "accountId"
      )
      SELECT a."id"                                   AS id,
             COALESCE(u."nickname", a."ownerId")
               || '（' || a."ownerType"
               || CASE WHEN a."roomId" <> '' THEN '·' || COALESCE(r."name", a."roomId") ELSE '' END
               || '）'                                AS label,
             a."balance"::float8                      AS actual,
             (COALESCE(SUM(l."amount"), 0) - COALESCE(p."amt", 0))::float8 AS expected
      FROM "PointsAccount" a
      LEFT JOIN "PointsLedger" l ON l."accountId" = a."id"
      LEFT JOIN pending p ON p."accountId" = a."id"
      LEFT JOIN "User" u ON u."id" = a."ownerId"
      LEFT JOIN "Room" r ON r."id" = a."roomId"
      GROUP BY a."id", a."ownerType", a."ownerId", a."roomId", a."balance",
               u."nickname", r."name", p."amt"
      HAVING a."balance" <> COALESCE(SUM(l."amount"), 0) - COALESCE(p."amt", 0)
      ORDER BY ABS(a."balance" - (COALESCE(SUM(l."amount"), 0) - COALESCE(p."amt", 0))) DESC
      LIMIT ${MAX_ROWS + 1}
    `;
    return this.pack({
      key: 'points_sum',
      label: '账户余额与账本流水不符',
      hint: '严重差异，须技术介入核查；不得直接调整余额或补记流水。',
      scope: 'ACCOUNT',
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
      label: '代理额度与额度流水不符',
      hint: '严重差异，须技术介入核查；不得以上下分冲抵。',
      scope: 'AGENT',
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
      label: '下分单挂起，资金冻结未释放',
      hint: '在「上下分审核」中通过或驳回该单即可释放冻结。',
      scope: 'NONE',
      rows,
    });
  }

  /**
   * 吞单：开奖/结算已经完成，注单却还挂在待结算。
   *
   * 这是玩家最直接的损失形态——钱扣了、奖开了，但那一注既没派彩也没退款，
   * 从此停在待结算里没人管。前面几条自洽性检查一条都发现不了它。
   */
  private async checkSwallowedBets(): Promise<ReconCheck> {
    const rows = await this.prisma.$queryRaw<DriftQueryRow[]>`
      SELECT b."id"                     AS id,
             COALESCE(g."name", '—')
               || ' ' || COALESCE(i."issueNo", r."roundNo", '—')
               || ' / ' || COALESCE(u."nickname", b."playerId") AS label,
             b."amount"::float8         AS actual,
             0::float8                  AS expected
      FROM "Bet" b
      LEFT JOIN "LotteryIssue" i ON i."id" = b."issueId"
      LEFT JOIN "GameRound"    r ON r."id" = b."roundId"
      LEFT JOIN "Game"         g ON g."id" = b."gameId"
      LEFT JOIN "User"         u ON u."id" = b."playerId"
      WHERE b."status" = 'PENDING'
        AND (
          i."status" = 'DRAWN'
          OR r."state" IN ('SETTLED', 'CANCELLED')
        )
      ORDER BY b."amount" DESC
      LIMIT ${MAX_ROWS + 1}
    `;
    return this.pack({
      key: 'swallowed_bets',
      label: '注单已开奖未结算',
      hint: '该批注单既未派彩也未退款，须技术补结算或退款。',
      scope: 'NONE',
      rows,
    });
  }

  /**
   * 注单缺少扣款凭证：有注单却找不到对应的扣款流水。
   * 说明钱没真扣就让人下了注，等于凭空给了本金。
   *
   * 两类幂等键都要认：
   *  - 牌桌/彩票按注单建键（`*_bet_player_<betId>`），一注一条扣款
   *  - 街机/电子按**局号**建键（`*_bet_player_<roundId>`），一局一条扣款覆盖该局全部注
   * 只按注单 id 匹配会把所有街机注单误报成缺凭证。
   */
  private async checkBetDebitVoucher(): Promise<ReconCheck> {
    const rows = await this.prisma.$queryRaw<DriftQueryRow[]>`
      SELECT b."id"                     AS id,
             COALESCE(g."name", '—')
               || ' / ' || COALESCE(u."nickname", b."playerId")
               || ' / ' || b."betNo"    AS label,
             0::float8                  AS actual,
             b."amount"::float8         AS expected
      FROM "Bet" b
      LEFT JOIN "Game" g ON g."id" = b."gameId"
      LEFT JOIN "User" u ON u."id" = b."playerId"
      WHERE b."status" <> 'CANCELLED'
        AND NOT EXISTS (
          SELECT 1 FROM "PointsLedger" l
          WHERE l."bizType" = 'BET'
            AND l."amount" < 0
            AND (
              l."idempotencyKey" LIKE '%' || b."id"
              OR (b."roundId" IS NOT NULL
                  AND l."refType" = 'round' AND l."refId" = b."roundId")
              OR (b."issueId" IS NOT NULL
                  AND l."refType" = 'issue' AND l."refId" = b."issueId")
            )
        )
      ORDER BY b."amount" DESC
      LIMIT ${MAX_ROWS + 1}
    `;
    return this.pack({
      key: 'bet_debit_voucher',
      label: '注单未扣款',
      hint: '严重差异，须技术介入核查；核实前不得放行出款。',
      scope: 'NONE',
      rows,
    });
  }

  /**
   * 重复派彩：同一笔注单出现两条以上派彩入账。
   * 幂等键有唯一索引挡着，正常不该出现；一旦出现就是真金白银多给了。
   */
  private async checkDuplicatePayout(): Promise<ReconCheck> {
    const rows = await this.prisma.$queryRaw<DriftQueryRow[]>`
      SELECT l."refId"                        AS id,
             '局 ' || COALESCE(l."refId", '—')
               || ' 共 ' || COUNT(*)::text || ' 条派彩' AS label,
             SUM(l."amount")::float8          AS actual,
             0::float8                        AS expected
      FROM "PointsLedger" l
      WHERE l."bizType" = 'WIN' AND l."amount" > 0
      GROUP BY l."refId", l."idempotencyKey"
      HAVING COUNT(*) > 1
      ORDER BY SUM(l."amount") DESC
      LIMIT ${MAX_ROWS + 1}
    `;
    return this.pack({
      key: 'duplicate_payout',
      label: '注单重复派彩',
      hint: '已发生超额派彩，须技术介入核查；核实前不得放行出款。',
      scope: 'NONE',
      rows,
    });
  }

  /**
   * 全站余额 vs 账本净额。
   *
   * 这是最后一道总闸：把所有账户余额加起来，必须等于所有流水的净额。
   * 前面按账户逐个比对能抓出单个账户的漂移，这条抓的是「总量」层面的漏洞，
   * 比如某类账户整体被漏算、或有余额从未产生任何流水。
   *
   * 同样要扣掉待合并队列，否则合并延迟期间这条总闸会一直报警。
   */
  private async checkGlobalLedgerNet(): Promise<ReconCheck> {
    const res = await this.prisma.$queryRaw<
      { balance: number; ledger: number; pending: number }[]
    >`
      SELECT (SELECT COALESCE(SUM("balance"), 0) FROM "PointsAccount")::float8      AS balance,
             (SELECT COALESCE(SUM("amount"), 0) FROM "PointsLedger")::float8        AS ledger,
             (SELECT COALESCE(SUM("amount"), 0) FROM "PlatformApplyQueue")::float8  AS pending
    `;
    const balance = roundMoney(Number(res[0]?.balance ?? 0));
    const ledger = roundMoney(Number(res[0]?.ledger ?? 0) - Number(res[0]?.pending ?? 0));
    /* 分币级容差：Decimal(18,2) 相加不会有浮点误差，但 float8 聚合会 */
    const drift = Math.abs(roundMoney(balance - ledger));
    return this.pack({
      key: 'global_ledger_net',
      label: '全平台总账不平',
      hint: '全站余额合计与账本流水合计不一致，须技术介入核查；核实前不得放行出款。',
      scope: 'NONE',
      rows: drift > 0.005
        ? [{ id: 'GLOBAL', label: '全站合计', actual: balance, expected: ledger }]
        : [],
    });
  }

  /**
   * 平台余额合并积压。
   *
   * 平台侧的账是先记账、余额由 PlatformBalanceMerger 每 200ms 补上的，所以队列里
   * 常态只有零星几条、存活不到一秒。积压变长只有一个原因：工人没在跑。
   *
   * 钱不会因此丢（账本是真账），但余额会一直是旧的，后台看到的平台数字会失真。
   * 所以这条只告警、不拦出款——拦了也修不了它，而且真账并没有坏。
   */
  private async checkPlatformApplyBacklog(): Promise<ReconCheck> {
    const res = await this.prisma.$queryRaw<
      { cnt: number; oldest_sec: number | null; amt: number }[]
    >`
      SELECT COUNT(*)::float8                                                   AS cnt,
             EXTRACT(EPOCH FROM (NOW() - MIN("createdAt")))::float8             AS oldest_sec,
             COALESCE(SUM("amount"), 0)::float8                                 AS amt
      FROM "PlatformApplyQueue"
    `;
    const cnt = Number(res[0]?.cnt ?? 0);
    const oldestSec = Number(res[0]?.oldest_sec ?? 0);
    const amt = roundMoney(Number(res[0]?.amt ?? 0));
    /* 阈值给得比合并间隔宽很多，避免正常抖动误报 */
    const stuck = oldestSec > PLATFORM_BACKLOG_MAX_AGE_SEC || cnt > PLATFORM_BACKLOG_MAX_ROWS;
    return this.pack({
      key: 'platform_apply_backlog',
      label: '平台余额合并队列积压',
      hint: '账本无差异，仅平台余额显示滞后；重启服务后一般自行恢复。',
      scope: 'NONE',
      rows: stuck
        ? [
            {
              id: 'BACKLOG',
              label: `积压 ${cnt} 条 · 最老 ${Math.round(oldestSec)} 秒 · 待入账 ${amt}`,
              actual: cnt,
              expected: 0,
            },
          ]
        : [],
    });
  }

  /**
   * 无主房间号的注单：payload 里缺 fly.roomId。
   *
   * 回水查询按房间归集，这类注单会被静默排除——它的流水永久领不到回水，
   * 玩家侧表现为「流水对不上回水」，而系统不报任何错。
   * 这里把它们捞出来，好回填 roomId 或人工补发。
   */
  private async checkBetWithoutRoom(): Promise<ReconCheck> {
    const rows = await this.prisma.$queryRaw<DriftQueryRow[]>`
      SELECT b."id"                     AS id,
             COALESCE(g."name", '—')
               || ' / ' || COALESCE(u."nickname", b."playerId")
               || ' / ' || b."betNo"    AS label,
             b."validFlow"::float8      AS actual,
             0::float8                  AS expected
      FROM "Bet" b
      LEFT JOIN "Game" g ON g."id" = b."gameId"
      LEFT JOIN "User" u ON u."id" = b."playerId"
      WHERE b."status" IN ('WON', 'LOST')
        AND b."validFlow" > 0
        AND COALESCE(b."payload" #>> '{fly,roomId}', '') = ''
      ORDER BY b."validFlow" DESC
      LIMIT ${MAX_ROWS + 1}
    `;
    return this.pack({
      key: 'bet_without_room',
      label: '注单缺失房间归属',
      hint: '该批流水不计回水，须技术回填房间号或按金额人工补发。',
      scope: 'NONE',
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
      label: '玩家余额为负',
      hint: '须技术核查异常扣款来源；不得以上分抹平。',
      scope: 'NONE',
      rows,
    });
  }

  /**
   * 总代坐庄的钱有没有真进他账。
   *
   *   总代盘分账里 BET + WIN 的净额  ==  他坐庄那些注单的（下注额 − 派彩）
   *
   * 左边是账本，右边是注单——两个独立来源，对不上就是有一笔输赢没落到他头上，
   * 或者落多了。这是房间层 credit_conservation 的同一套思路搬到总代这一层：
   * checkQuotaSum 只能证明「流水加起来等于余额」，证明不了流水金额本身对不对。
   *
   * 总代结账不校准 pointsQuota（与房间结账不同，见 general-settle 文件头注释），
   * 所以这里可以放心按全时段比，不需要切上次结清时间。
   */
  private async checkGeneralHouseLedger(): Promise<ReconCheck> {
    /* 与其它检查同口径：Decimal(18,2) 精算，1 元只为吸收极端进位 */
    const tolerance = 1;
    const rows = await this.prisma.$queryRaw<DriftQueryRow[]>`
      WITH sat_bets AS (
        /* 总代坐庄：注码进他口袋，派彩从他口袋出 */
        SELECT b.payload->'fly'->>'generalUserId'          AS gid,
               COALESCE(SUM(b."amount" - b."payout"), 0)   AS house_net
        FROM "Bet" b
        WHERE b."status" IN ('WON', 'LOST')
          AND b.payload->'fly'->>'sitting' = 'GENERAL'
          AND COALESCE(b.payload->'fly'->>'generalUserId', '') <> ''
        GROUP BY 1
      ),
      disk AS (
        /* 吃注 BET 为正、派彩 WIN 为负，净额就该等于坐庄净赢 */
        SELECT q."agentUserId"                    AS gid,
               COALESCE(SUM(q."delta"), 0)        AS disk_net
        FROM "AgentQuotaLedger" q
        WHERE q."bizType" IN ('BET', 'WIN')
        GROUP BY 1
      )
      SELECT u."id"                                        AS id,
             COALESCE(u."nickname", u."id")
               || '（' || COALESCE(u."uid", '—') || '）'    AS label,
             COALESCE(d.disk_net, 0)::float8               AS actual,
             COALESCE(s.house_net, 0)::float8              AS expected
      FROM "User" u
      LEFT JOIN sat_bets s ON s.gid = u."id"
      LEFT JOIN disk d     ON d.gid = u."id"
      WHERE u."role" = 'GENERAL'
        AND ABS(COALESCE(d.disk_net, 0) - COALESCE(s.house_net, 0)) > ${tolerance}
      ORDER BY ABS(COALESCE(d.disk_net, 0) - COALESCE(s.house_net, 0)) DESC
      LIMIT ${MAX_ROWS + 1}
    `;
    return this.pack({
      key: 'general_house_ledger',
      label: '总代坐庄盈亏未全额入账',
      hint: '总代坐庄注单的盈亏与其账户实际入账不符，须技术核对注单。',
      scope: 'AGENT',
      rows,
    });
  }

  /**
   * 信用盘守恒。完整口径是：
   *
   *   剩余信用 + 玩家持分 + 客服未发出
   *     = 合同额度 − 上家赢走的净额 + 已进盘分的整包/并账 + 平台打进本房的玩家回水
   *
   * 「上家」= 飞盘时的平台，或总代坐庄时的总代。这两种情况下注码进出的都是
   * 本房体系之外的口袋，所以左边会整体下降。
   *
   * 代理自己坐庄、上下分、划客服额度、挂靠佣金（代理出、本房玩家进）
   * 全都只是在体系内部挪，左边不动。
   *
   * 飞盘玩家回水不是内部挪：六点（或提前领）由平台打进玩家分，左边会涨。
   * 代理整包回水已经走 AgentQuotaLedger.REBATE，算在「整包/并账」里；
   * 玩家那一截若再漏掉，账面会比应有高出已领回水，对账项会一直红。
   *
   * 待开奖飞盘注：分已经从玩家扣走，派彩还是 0，必须算进「上家净额」，
   * 否则挂机未开奖期间会假红。
   *
   * 只算上次结清之后：结账会把剩余信用校准成「合同额度 − 玩家 − 客服」，
   * 再把老注单/老回水加进来就会重复。没结过账的从建房算起。
   */
  private async checkCreditConservation(): Promise<ReconCheck> {
    /*
     * 容差：金额都是 Decimal(18,2) 精确运算，实测两间房分到分吻合。
     * 留 1 元是为了吸收极端情况下的单分进位，不足以掩盖任何真实错账。
     */
    const tolerance = 1;
    const rows = await this.prisma.$queryRaw<DriftQueryRow[]>`
      WITH room_players AS (
        SELECT m."roomId",
               COALESCE(SUM(GREATEST(a."balance", 0)), 0) AS player_sum
        FROM "RoomMember" m
        JOIN "PointsAccount" a
          ON a."ownerId" = m."playerId"
         AND a."ownerType" = 'PLAYER'
         AND a."roomId" = m."roomId"
        WHERE m."status" = 'APPROVED'
        GROUP BY m."roomId"
      ),
      agent_cs AS (
        SELECT u."parentId" AS agent_user_id,
               COALESCE(SUM(GREATEST(a."balance", 0)), 0) AS cs_sum
        FROM "User" u
        JOIN "PointsAccount" a ON a."ownerId" = u."id" AND a."ownerType" = 'CS'
        WHERE u."role" = 'CS' AND u."parentId" IS NOT NULL
        GROUP BY u."parentId"
      ),
      last_settle AS (
        /* 上次结清的账期终点；没结过就从建房算起 */
        SELECT s."roomId", MAX(s."weekEnd") AS since
        FROM "RoomWeekSettle" s
        WHERE s."status" = 'SETTLED'
        GROUP BY s."roomId"
      ),
      disk_extra AS (
        /* 整包/并账进了盘分，合同恒等式右边要加上这一截。
         * 只计上次结清之后：结账已经把当时的整包折进额度，再把老分录加进来会重复。 */
        SELECT q."agentUserId" AS agent_user_id,
               COALESCE(SUM(q."delta"), 0) AS extra
        FROM "AgentQuotaLedger" q
        JOIN "Agent" agx ON agx."userId" = q."agentUserId"
        JOIN "Room" rx ON rx."ownerAgentId" = agx."id" AND rx."bookMode" = 'CREDIT'
        LEFT JOIN last_settle lsx ON lsx."roomId" = rx."id"
        WHERE (
            q."bizType" = 'REBATE'
            OR (q."bizType" = 'ADJUST' AND q."refType" = 'credit_disk_unify')
          )
          AND q."createdAt" >= COALESCE(lsx.since, rx."createdAt")
        GROUP BY q."agentUserId"
      ),
      player_in AS (
        /* 平台打进本房玩家的回水（飞盘六点 / 关盘已预扣后的领取）。
         * 代理盘分出的那一截已在 disk_extra 里（幂等键 :DISK），这里必须排除，否则左右各加一次。 */
        SELECT a."roomId",
               COALESCE(SUM(l.amount), 0) AS amt
        FROM "PointsLedger" l
        JOIN "PointsAccount" a
          ON a.id = l."accountId"
         AND a."ownerType" = 'PLAYER'
        JOIN "Room" r3 ON r3.id = a."roomId"
        LEFT JOIN last_settle ls3 ON ls3."roomId" = r3.id
        WHERE l."bizType" = 'REBATE'
          AND l.amount > 0
          AND l."createdAt" >= COALESCE(ls3.since, r3."createdAt")
          AND NOT EXISTS (
            SELECT 1 FROM "AgentQuotaLedger" q
            WHERE q."idempotencyKey" = l."idempotencyKey" || ':DISK'
          )
        GROUP BY a."roomId"
      ),
      outside_house AS (
        /*
         * 「上家」赢走的净额：只算飞盘与总代坐庄。
         * 代理自己坐庄时钱在体系内部挪，不影响守恒式，必须排除。
         * 老注单没写 sitting，按 flying 兜底推断。
         *
         * PENDING 派彩仍为 0，但注码已从玩家扣走，必须算进去。
         * 归期用 COALESCE(开奖时间, 下注时间)，否则待开奖行的 settledAt 为空会被整段丢掉。
         */
        SELECT r2."id" AS room_id,
               COALESCE(SUM(b."amount" - b."payout"), 0) AS house_net
        FROM "Room" r2
        LEFT JOIN last_settle ls ON ls."roomId" = r2."id"
        LEFT JOIN "Bet" b
          ON NULLIF(b.payload->'fly'->>'roomId', '') = r2."id"
         AND b."status" IN ('WON', 'LOST', 'PENDING')
         AND COALESCE(b."settledAt", b."createdAt") >= COALESCE(ls.since, r2."createdAt")
         AND COALESCE(
               b.payload->'fly'->>'sitting',
               CASE WHEN b.payload->'fly'->>'flying' = 'true' THEN 'PLATFORM' ELSE 'AGENT' END
             ) IN ('PLATFORM', 'GENERAL')
        WHERE r2."bookMode" = 'CREDIT' AND r2."status" <> 'CLOSED'
        GROUP BY r2."id"
      ),
      scored AS (
        SELECT r."id"                                          AS id,
               r."name" || '（' || r."roomNo" || '）'           AS label,
               (ag."pointsQuota"
                 + COALESCE(rp.player_sum, 0)
                 + COALESCE(cs.cs_sum, 0))::float8             AS actual,
               (r."creditLimit"
                 - COALESCE(oh.house_net, 0)
                 + COALESCE(ex.extra, 0)
                 + COALESCE(pi.amt, 0))::float8                AS expected
        FROM "Room" r
        JOIN "Agent" ag ON ag."id" = r."ownerAgentId"
        LEFT JOIN room_players rp ON rp."roomId" = r."id"
        LEFT JOIN agent_cs cs ON cs.agent_user_id = ag."userId"
        LEFT JOIN outside_house oh ON oh.room_id = r."id"
        LEFT JOIN disk_extra ex ON ex.agent_user_id = ag."userId"
        LEFT JOIN player_in pi ON pi."roomId" = r."id"
        WHERE r."bookMode" = 'CREDIT'
          AND r."status" <> 'CLOSED'
          AND r."creditLimit" > 0
      )
      SELECT id, label, actual, expected
      FROM scored
      WHERE ABS(actual - expected) > ${tolerance}
      ORDER BY ABS(actual - expected) DESC
      LIMIT ${MAX_ROWS + 1}
    `;
    return this.pack({
      key: 'credit_conservation',
      label: '信用盘额度与注单不符',
      hint: '代理侧合计（剩余额度＋玩家持分＋客服额度）与注单推算值不符。飞盘玩家回水、待开奖注已计入应有值；仍对不上须技术核对。',
      scope: 'NONE',
      rows,
    });
  }

  // ── 出款闸门 ──────────────────────────────────────────────

  /**
   * 出款闸门的当前状态。
   *
   * 判定顺序：
   *  1. 管理员显式放行且未过期 → 放行（但把放行信息带出来，后台要看得见）
   *  2. 从没对过账，或最近一次对账已经过期太久 → 按需现跑一次再判
   *  3. 最近一次结论不平 → 拦
   *
   * 「过期太久就现跑」这一条很关键：不然刚重启的实例读不到结论，
   * 要么把所有出款都拦死（生意停摆），要么全放过去（闸门形同虚设）。
   */
  async payoutGateStatus(opts: { autoRun?: boolean } = {}): Promise<PayoutGateStatus> {
    /*
     * 判定逻辑与出款路径共用同一份（payout-gate.helper），避免两处口径分叉——
     * 后台页显示「可以出款」而实际被拦，比拦错更难排查。
     */
    let st = await payoutGateStatus(this.prisma);
    /* 结论过期时后台可以要求现跑一次，出款路径不做这件事（不该让一笔下分等一次全量对账） */
    if (st.reason === 'stale' && opts.autoRun !== false) {
      try {
        await this.run('gate');
        st = await payoutGateStatus(this.prisma);
      } catch (err) {
        this.logger.warn(
          `按需对账失败：${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
    return st;
  }

  /** 当前生效的放行；过期或已撤销的不算 */
  private async activeRelease() {
    return activePayoutRelease(this.prisma);
  }

  /** 管理员知情放行：必须填原因，且有到期时间 */
  async releasePayoutGate(opts: {
    operatorId: string;
    reason: string;
    hours: number;
  }) {
    const reason = String(opts.reason || '').trim();
    if (reason.length < 4) throw new BadRequestException('请写明放行原因（至少 4 个字）');
    const hours = Math.min(
      PAYOUT_GATE_MAX_RELEASE_HOURS,
      Math.max(1, Math.floor(Number(opts.hours) || 0) || 2),
    );
    const expiresAt = new Date(Date.now() + hours * 3600_000);
    const row = await this.prisma.payoutGateRelease.create({
      data: { reason, createdById: opts.operatorId, expiresAt },
    });
    await this.adminLog.log(opts.operatorId, 'PAYOUT_GATE_RELEASE', row.id, {
      reason,
      hours,
      expiresAt: expiresAt.toISOString(),
    });
    this.logger.warn(`出款闸门被人工放行 ${hours} 小时：${reason}`);
    return { id: row.id, expiresAt: expiresAt.toISOString(), hours };
  }

  /** 撤销放行，立即恢复拦截 */
  async revokePayoutGateRelease(operatorId: string) {
    const active = await this.activeRelease();
    if (!active) throw new BadRequestException('当前没有生效中的放行');
    await this.prisma.payoutGateRelease.update({
      where: { id: active.id },
      data: { revokedAt: new Date() },
    });
    await this.adminLog.log(operatorId, 'PAYOUT_GATE_REVOKE', active.id, {
      reason: active.reason,
    });
    this.logger.warn('出款闸门放行已被撤销，恢复拦截');
    return { ok: true };
  }

  private pack(opts: {
    key: ReconCheck['key'];
    label: string;
    hint: string;
    scope: ReconRow['scope'];
    rows: DriftQueryRow[];
  }): ReconCheck {
    const gating = GATING_CHECKS.has(opts.key);
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
      gating,
    };
  }

}
