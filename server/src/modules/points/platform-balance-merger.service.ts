/**
 * 平台账户余额合并工人。
 *
 * 下注与派彩只往 PlatformApplyQueue 排队、不动平台余额（见 PointsService.creditInTx），
 * 这里定时把排队的金额加总，一次性补进余额，并回填每条账本的 balanceAfter。
 *
 * ── 为什么这样是安全的 ──
 *
 * 真账是 PointsLedger，它和对手方的余额变动写在同一个事务里，所以钱不会丢。
 * 这个工人只负责把已经记好的金额抄进余额那一列：它停摆只会让余额变旧，
 * 重启后接着合并就补齐了，不需要人工干预。
 *
 * 不会重复加钱：领取与落账在同一个事务里——先把队列行删掉，用删除返回的行求和，
 * 再改余额。两个工人同时跑时，第二个一行都删不到（删除会互斥），所以拿不到金额。
 * 事务失败则删除一起回滚，队列行原样留着等下一轮。
 *
 * ── 需要盯的指标 ──
 *
 * 积压条数与最老一条的积压时长。积压再多也能追平（一轮就是一条 UPDATE），
 * 但持续积压说明工人没在跑，对账巡检会据此报警。
 */
import { Injectable, Logger } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { Prisma } from '@prisma/client';
import { asMoney, roundMoney } from '@gamebox/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { RedisService } from '../../redis/redis.service';
import { PlatformEmergencyService } from './platform-emergency.service';
import { platformFloor } from './points-floor';

/** 合并间隔：余额最多旧这么久 */
const MERGE_INTERVAL_MS = 200;
/** 一轮最多领多少条，防止积压很大时单个事务过长 */
const MERGE_BATCH = Math.max(1, Math.floor(Number(process.env.PLATFORM_MERGE_BATCH ?? 2000)));
const LOCK_KEY = 'gamebox:points:platform-merge';

@Injectable()
export class PlatformBalanceMergerService {
  private readonly logger = new Logger(PlatformBalanceMergerService.name);
  private running = false;

  constructor(
    private prisma: PrismaService,
    private redis: RedisService,
    private emergency: PlatformEmergencyService,
  ) {}

  @Interval(MERGE_INTERVAL_MS)
  async tick(): Promise<void> {
    /* 上一轮还没跑完就跳过：间隔很短，重入会互相抢同一批队列行 */
    if (this.running) return;
    this.running = true;
    try {
      /*
       * 多实例只让一个跑。锁的 TTL 要大于一轮耗时，但也别太长，
       * 否则实例崩掉之后要等锁自然过期才有人接手。
       */
      await this.redis.runExclusive(
        LOCK_KEY,
        5_000,
        () => this.mergeOnce().then(() => undefined),
        { onLockError: 'skip' },
      );
    } catch (e) {
      this.logger.error(`平台余额合并失败：${(e as Error).message}`);
    } finally {
      this.running = false;
    }
  }

  /**
   * 合并一轮，返回处理条数。
   *
   * 红线检查必须放在事务**提交之后**：事务内用 this.prisma 查队列走的是另一条连接，
   * 看不到本事务里刚删掉的那些行，会把同一批钱算两遍。
   */
  async mergeOnce(limit = MERGE_BATCH): Promise<number> {
    const handled = await this.claimAndApply(limit);
    if (handled > 0) await this.checkFloor();
    return handled;
  }

  private async claimAndApply(limit: number): Promise<number> {
    return this.prisma.$transaction(async (tx) => {
      /*
       * 领取即删除：DELETE 天然互斥，所以同一条队列行不可能被两个工人同时拿到。
       * 按 (createdAt, id) 取，保证 balanceAfter 按发生顺序回填。
       */
      const claimed = await tx.$queryRaw<
        Array<{ ledgerId: string; accountId: string; amount: unknown }>
      >`
        DELETE FROM "PlatformApplyQueue"
        WHERE "id" IN (
          SELECT "id" FROM "PlatformApplyQueue"
          ORDER BY "createdAt", "id"
          LIMIT ${limit}
        )
        RETURNING "ledgerId", "accountId", "amount"
      `;
      if (!claimed.length) return 0;

      const byAccount = new Map<string, Array<{ ledgerId: string; delta: number }>>();
      for (const row of claimed) {
        const list = byAccount.get(row.accountId) ?? [];
        list.push({ ledgerId: row.ledgerId, delta: asMoney(row.amount) });
        byAccount.set(row.accountId, list);
      }

      /* 账户 id 排序：多账户时加锁顺序全局一致 */
      for (const accountId of [...byAccount.keys()].sort()) {
        await this.applyAccount(tx, accountId, byAccount.get(accountId)!);
      }
      return claimed.length;
    });
  }

  /** 某个账户这一批的净额落进余额，并回填这批账本的 balanceAfter */
  private async applyAccount(
    tx: Prisma.TransactionClient,
    accountId: string,
    entries: Array<{ ledgerId: string; delta: number }>,
  ): Promise<void> {
    const net = roundMoney(entries.reduce((s, e) => s + e.delta, 0));
    const rows = await tx.$queryRaw<{ balance: unknown }[]>`
      UPDATE "PointsAccount"
      SET "balance" = "balance" + ${new Prisma.Decimal(net.toFixed(2))}, "updatedAt" = NOW()
      WHERE "id" = ${accountId}
      RETURNING "balance"
    `;
    if (!rows.length) throw new Error(`平台账户不存在 accountId=${accountId}`);

    /*
     * 从落地后的余额往前倒推每条的 balanceAfter，结果与「逐笔改余额」时一致。
     * 这里不做下限拦截：账已经记下了，拦也拦不掉，硬拦只会让队列永远排不掉。
     * 跌破下限由 checkFloor 负责停机。
     */
    let running = asMoney(rows[0].balance);
    const pairs: Array<{ id: string; balance: number }> = [];
    for (let i = entries.length - 1; i >= 0; i--) {
      pairs.push({ id: entries[i].ledgerId, balance: running });
      running = roundMoney(running - entries[i].delta);
    }
    const values = Prisma.join(
      pairs.map(
        (p) => Prisma.sql`(${p.id}::text, ${new Prisma.Decimal(p.balance.toFixed(2))}::numeric)`,
      ),
    );
    await tx.$executeRaw`
      UPDATE "PointsLedger" AS l
      SET "balanceAfter" = v.bal
      FROM (VALUES ${values}) AS v(id, bal)
      WHERE l."id" = v.id
    `;
  }

  /**
   * 红线看门狗：余额 + 还在队列里的金额跌破下限就全站进维护。
   *
   * 算上队列的原因是工人可能停摆——那时余额是旧的，只看余额会漏报。
   * 返回算出来的实际余额，方便测试与排查时核对。
   */
  async checkFloor(): Promise<{ effective: number; tripped: boolean }> {
    const floor = platformFloor();
    const [accounts, queued] = await Promise.all([
      this.prisma.pointsAccount.aggregate({
        where: { ownerType: 'PLATFORM' },
        _sum: { balance: true },
      }),
      this.prisma.platformApplyQueue.aggregate({ _sum: { amount: true } }),
    ]);
    const effective = roundMoney(
      asMoney(accounts._sum.balance ?? 0) + asMoney(queued._sum.amount ?? 0),
    );
    if (effective >= floor) return { effective, tripped: false };
    this.logger.error(`平台账户实际余额 ${effective} 已跌破下限 ${floor}`);
    this.emergency.scheduleEnterOnPlatformFloor(floor);
    return { effective, tripped: true };
  }
}
