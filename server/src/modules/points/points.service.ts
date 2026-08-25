import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { asMoney, roundMoney } from '@gamebox/shared';
import { PrismaService } from '../../prisma/prisma.service';
import {
  PLATFORM_FLOOR_HIT_MARKER,
  PlatformEmergencyService,
} from './platform-emergency.service';

export type { OwnerType, BizType } from './points.types';
import type { OwnerType, BizType } from './points.types';
import { ownerFloor } from './points-floor';

export interface LedgerOpts {
  refType?: string;
  refId?: string;
  remark?: string;
  operatorId?: string;
  idempotencyKey?: string;
  /**
   * 账户分房键：PLAYER 必填运营房间 id；其余忽略（固定 ''）。
   * 也可在 transfer 的 from/to.roomId 上传递。
   */
  roomId?: string;
}

/** 账户引用：PLAYER 必须带 roomId */
export type AccountRef = {
  type: OwnerType;
  id: string;
  roomId?: string;
  idempotencyKey?: string;
  remark?: string;
};

export const PLATFORM_OWNER_ID = 'PLATFORM';
/** 非玩家账户的 roomId 哨兵（空串，配合复合唯一） */
export const NO_ROOM = '';

/** PLAYER 必须带运营房间；其余固定 '' */
export function resolveAccountRoomId(ownerType: OwnerType, roomId?: string | null): string {
  if (ownerType === 'PLAYER') {
    const rid = String(roomId || '').trim();
    if (!rid) throw new BadRequestException('玩家积分必须指定房间');
    return rid;
  }
  return NO_ROOM;
}

/**
 * 积分账本 —— 全平台积分变动的唯一入口。
 * 规则：
 *   1. 任何余额变动必须经此服务，且必须写一条 PointsLedger
 *   2. 转账 = 同一事务内 出账 + 入账 两条流水
 *   3. 所有写入用 $transaction，禁止事务外更新 balance
 *   4. idempotencyKey 幂等，防重复扣/派彩
 *   5. PLATFORM 账户允许为负，但不得跌破 platformFloor()；其余账户禁止透支
 *   6. 【加锁顺序】PLATFORM/ROOM 资金池那一侧恒定放最后动，把热行持锁时间压到最短
 *   7. 【多房】PLAYER 按 (ownerType, ownerId, roomId) 分账；跨房余额互不可用
 */
/** 合并写缓冲里的一条：账本行已落库，只差把余额加上去 */
interface PooledWrite {
  accountId: string;
  ledgerId: string;
  delta: number;
}

interface PoolBuffer {
  /** 按发生顺序，flush 时要靠这个顺序倒推每条流水的 balanceAfter */
  writes: PooledWrite[];
  /** ownerType:ownerId:roomId → accountId，省掉重复查账户 */
  accountIds: Map<string, string>;
  ownerTypes: Map<string, OwnerType>;
}

@Injectable()
export class PointsService {
  constructor(
    private prisma: PrismaService,
    private platformEmergency: PlatformEmergencyService,
  ) {}

  /**
   * 开启了合并写的事务。用 WeakMap 挂在 tx 对象上，事务结束即随之回收，
   * 不需要显式清理，也不会串到别的事务。
   */
  private readonly poolBuffers = new WeakMap<Prisma.TransactionClient, PoolBuffer>();

  accountWhere(
    ownerType: OwnerType,
    ownerId: string,
    roomId?: string | null,
  ): Prisma.PointsAccountWhereUniqueInput {
    const rid = resolveAccountRoomId(ownerType, roomId);
    return {
      ownerType_ownerId_roomId: {
        ownerType: ownerType as never,
        ownerId,
        roomId: rid,
      },
    };
  }

  async getPlayerBalance(playerId: string, roomId: string): Promise<number> {
    const rid = resolveAccountRoomId('PLAYER', roomId);
    const account = await this.prisma.pointsAccount.findUnique({
      where: this.accountWhere('PLAYER', playerId, rid),
      select: { balance: true },
    });
    return asMoney(account?.balance ?? 0);
  }

  /**
   * 取账户 id：只读不加锁，账户不存在才建。
   *
   * 和 upsert 的区别是「不碰已存在的那一行」——记账路径要的就是这一点，
   * 任何对平台那一行的写操作都会把它变成瓶颈。
   */
  private async accountIdInTx(
    tx: Prisma.TransactionClient,
    ownerType: OwnerType,
    ownerId: string,
    roomId: string,
  ): Promise<string> {
    const where = this.accountWhere(ownerType, ownerId, roomId);
    const found = await tx.pointsAccount.findUnique({ where, select: { id: true } });
    if (found) return found.id;
    try {
      const made = await tx.pointsAccount.create({
        data: { ownerType: ownerType as never, ownerId, roomId },
        select: { id: true },
      });
      return made.id;
    } catch {
      /* 并发首建：另一方已插入，重读即可 */
      const again = await tx.pointsAccount.findUnique({ where, select: { id: true } });
      if (!again) throw new BadRequestException('账户创建失败');
      return again.id;
    }
  }

  /** 平台侧余额是否走「先记账、后合并」；置 0 可回退到当场改余额的老行为 */
  private journalEnabled(): boolean {
    return String(process.env.PLATFORM_JOURNAL ?? '1') !== '0';
  }

  /**
   * 平台账户还没合并进余额的金额合计。
   *
   * 判断平台有没有跌破下限必须用「余额 + 这个数」，不能只看余额——
   * 否则合并工人一旦停摆，账继续记而余额不动，红线就会失灵。
   */
  async platformPendingSum(): Promise<number> {
    const agg = await this.prisma.platformApplyQueue.aggregate({ _sum: { amount: true } });
    return asMoney(agg._sum.amount ?? 0);
  }

  /** 平台真实余额 = 已落账的余额 + 还在队列里等合并的金额 */
  async platformEffectiveBalance(): Promise<number> {
    const [acc, pending] = await Promise.all([
      this.prisma.pointsAccount.findUnique({
        where: this.accountWhere('PLATFORM', PLATFORM_OWNER_ID),
        select: { balance: true },
      }),
      this.platformPendingSum(),
    ]);
    return roundMoney(asMoney(acc?.balance ?? 0) + pending);
  }

  /**
   * PostgreSQL 事务级 advisory lock 把同一幂等键串行化。
   * 必须在任何余额变动前加锁，避免先改余额、写流水撞 P2002 后再在 aborted tx 中重读。
   */
  private async lockIdempotencyKeyInTx(tx: Prisma.TransactionClient, key?: string) {
    if (!key) return;
    await tx.$queryRaw<{ locked: string }[]>`
      SELECT pg_advisory_xact_lock(hashtextextended(${`points:${key}`}, 0))::text AS locked
    `;
  }

  /**
   * 多账户同事务时先按 (ownerId, roomId) 排序加行锁，再改余额。
   */
  async lockOwnersInTx(
    tx: Prisma.TransactionClient,
    owners: Array<{ type: OwnerType; id: string; roomId?: string }>,
  ) {
    const uniq = new Map<string, { type: OwnerType; id: string; roomId: string }>();
    for (const o of owners) {
      if (!o.id) continue;
      const roomId = resolveAccountRoomId(o.type, o.roomId);
      uniq.set(`${o.type}:${o.id}:${roomId}`, { type: o.type, id: o.id, roomId });
    }
    const sorted = [...uniq.values()].sort((a, b) => {
      const ka = `${a.id}:${a.roomId}`;
      const kb = `${b.id}:${b.roomId}`;
      return ka < kb ? -1 : ka > kb ? 1 : 0;
    });
    for (const o of sorted) {
      await tx.pointsAccount.upsert({
        where: this.accountWhere(o.type, o.id, o.roomId),
        update: {},
        create: {
          ownerType: o.type as never,
          ownerId: o.id,
          roomId: o.roomId,
        },
      });
      await tx.$queryRaw`
        SELECT id FROM "PointsAccount"
        WHERE "ownerType" = ${o.type}::"AccountOwnerType"
          AND "ownerId" = ${o.id}
          AND "roomId" = ${o.roomId}
        FOR UPDATE
      `;
    }
  }

  /**
   * 事务内转账：固定把 PLATFORM/ROOM 资金池那一侧放到最后动，其余按 ownerId 排序。
   * 顺序全局一致，既避免死锁，又把全站共享的池子热行的持锁时间压到最短。
   */
  async transferInTx(
    tx: Prisma.TransactionClient,
    from: AccountRef,
    to: AccountRef,
    amount: number,
    opts: LedgerOpts & { bizType: BizType; bizTypeIn?: BizType } = { bizType: 'ADJUST' },
  ) {
    amount = roundMoney(amount);
    if (amount <= 0) throw new BadRequestException('转账金额必须 > 0');
    const bizOut = opts.bizType;
    const bizIn = opts.bizTypeIn ?? opts.bizType;
    const debit = () =>
      this.creditInTx(tx, from.type, from.id, -amount, bizOut, {
        ...opts,
        remark: from.remark ?? opts.remark,
        idempotencyKey: from.idempotencyKey,
        roomId: from.roomId ?? opts.roomId,
      });
    const credit = () =>
      this.creditInTx(tx, to.type, to.id, amount, bizIn, {
        ...opts,
        remark: to.remark ?? opts.remark,
        idempotencyKey: to.idempotencyKey,
        roomId: to.roomId ?? opts.roomId,
      });

    /*
     * 资金池那一侧放到最后动。
     *
     * PLATFORM 是全站唯一一行，每一笔飞盘下注和派彩都要更新它。行锁一旦拿到就必须
     * 持有到事务提交，所以「先动池子」等于让池子的锁覆盖整笔事务剩下的全部往返
     * （玩家账户 upsert、余额更新、两条账本、以及调用方后续的回水与飞盘额度）。
     * 那会把全站下注吞吐压在「一笔事务耗时」的倒数上。放到最后，持锁时间缩短到
     * 一条 UPDATE 加提交。
     *
     * 死锁安全性不变：死锁需要两笔事务以相反顺序拿同两把锁。这里的规则依然是全局
     * 一致的偏序——池子恒定排在最后，两侧都是池子时退回按键排序，所以不存在环。
     */
    const isPool = (t: OwnerType) => t === 'PLATFORM' || t === 'ROOM';
    const bothPool = isPool(from.type) && isPool(to.type);
    if (!bothPool) {
      if (isPool(from.type)) {
        /* from 是池子 → 先给对手方入账，最后再扣池子 */
        const inn = await credit();
        return { out: await debit(), in: inn };
      }
      if (isPool(to.type)) return { out: await debit(), in: await credit() };
    }
    const fromKey = `${from.id}:${resolveAccountRoomId(from.type, from.roomId)}`;
    const toKey = `${to.id}:${resolveAccountRoomId(to.type, to.roomId)}`;
    if (fromKey <= toKey) return { out: await debit(), in: await credit() };
    const inn = await credit();
    return { out: await debit(), in: inn };
  }

  async credit(
    ownerType: OwnerType,
    ownerId: string,
    amount: number,
    bizType: BizType,
    opts: LedgerOpts = {},
  ) {
    amount = roundMoney(amount);
    if (amount === 0) throw new BadRequestException('金额不能为 0');
    return this.prisma.$transaction((tx) =>
      this.creditInTx(tx, ownerType, ownerId, amount, bizType, opts),
    );
  }

  /** 复用外部事务（供结算/分润批量调用） */
  async creditInTx(
    tx: Prisma.TransactionClient,
    ownerType: OwnerType,
    ownerId: string,
    amount: number,
    bizType: BizType,
    opts: LedgerOpts = {},
  ) {
    amount = roundMoney(amount);
    if (opts.idempotencyKey) {
      await this.lockIdempotencyKeyInTx(tx, opts.idempotencyKey);
      const existed = await tx.pointsLedger.findUnique({
        where: { idempotencyKey: opts.idempotencyKey },
      });
      if (existed) return existed;
    }

    const roomId = resolveAccountRoomId(ownerType, opts.roomId);

    /*
     * 平台账户：只写账本 + 排队，不动余额。
     *
     * 平台是全站唯一一行，每笔飞盘下注和派彩都要动它。当场改余额就得拿这一行的
     * 独占锁并持到提交，全站下注因此串成一条队（实测封顶 337 笔/秒，尾延迟到 1.3 秒）。
     * 改成只插账本之后，这条路上对平台那一行只剩外键的共享锁，并发之间互不冲突
     * （实测 2225 笔/秒，且不再有硬上限）。余额由 PlatformBalanceMerger 批量补上。
     *
     * 钱不会因此丢：这条账本和对手方的余额变动在同一个事务里，要么都成要么都没有。
     * 余额那一列退化成派生缓存，工人停摆只会让它变旧，不会让账少一笔。
     * 代价是平台余额有不到 1 秒的延迟，以及下限判断从「当场拦」改成看门狗
     * （见 platformEffectiveBalance —— 它把队列里的钱一起算，所以工人挂了红线依然准）。
     */
    if (ownerType === 'PLATFORM' && amount !== 0 && this.journalEnabled()) {
      const accountId = await this.accountIdInTx(tx, ownerType, ownerId, roomId);
      const ledger = await tx.pointsLedger.create({
        data: {
          accountId,
          bizType: bizType as never,
          amount: new Prisma.Decimal(amount.toFixed(2)),
          /* 占位；合并时按队列顺序回填真值 */
          balanceAfter: new Prisma.Decimal('0'),
          refType: opts.refType,
          refId: opts.refId,
          remark: opts.remark,
          operatorId: opts.operatorId,
          idempotencyKey: opts.idempotencyKey,
        },
      });
      await tx.platformApplyQueue.create({
        data: {
          accountId,
          ledgerId: ledger.id,
          amount: new Prisma.Decimal(amount.toFixed(2)),
        },
      });
      return ledger;
    }

    const account = await tx.pointsAccount.upsert({
      where: this.accountWhere(ownerType, ownerId, roomId),
      update: {},
      create: {
        ownerType: ownerType as never,
        ownerId,
        roomId,
      },
    });

    const floor = ownerFloor(ownerType);
    const amountSql = new Prisma.Decimal(amount.toFixed(2));
    const floorSql = new Prisma.Decimal(roundMoney(floor ?? 0).toFixed(2));
    const guard =
      amount < 0 && floor != null
        ? Prisma.sql`AND "balance" + ${amountSql} >= ${floorSql}`
        : Prisma.empty;
    const rows = await tx.$queryRaw<{ balance: unknown }[]>`
      UPDATE "PointsAccount"
      SET "balance" = "balance" + ${amountSql}, "updatedAt" = NOW()
      WHERE "id" = ${account.id}
        ${guard}
      RETURNING "balance"
    `;
    if (rows.length === 0) {
      if (ownerType === 'PLATFORM') {
        this.platformEmergency.scheduleEnterOnPlatformFloor(floor ?? 0);
        throw new BadRequestException(
          `${PLATFORM_FLOOR_HIT_MARKER}: 平台账户已触及下限 ${floor}，全部游戏进入维护`,
        );
      }
      if (ownerType === 'ROOM' || ownerType === 'AGENT') {
        throw new BadRequestException(
          `${ownerType} 账户已触及下限 ${floor}，本次变动被拒绝`,
        );
      }
      throw new BadRequestException(
        ownerType === 'PLAYER'
          ? `该房间账户余额不足`
          : `账户余额不足：${ownerType}/${ownerId}`,
      );
    }
    const newBalance = asMoney(rows[0].balance);

    return tx.pointsLedger.create({
      data: {
        accountId: account.id,
        bizType: bizType as never,
        amount: amountSql,
        balanceAfter: new Prisma.Decimal(newBalance.toFixed(2)),
        refType: opts.refType,
        refId: opts.refId,
        remark: opts.remark,
        operatorId: opts.operatorId,
        idempotencyKey: opts.idempotencyKey,
      },
    });
  }

  /** 标准转账：A 扣，B 加，同事务两条流水（加锁顺序与 transferInTx 一致） */
  async transfer(
    from: { type: OwnerType; id: string; roomId?: string },
    to: { type: OwnerType; id: string; roomId?: string },
    amount: number,
    opts: LedgerOpts & { bizTypeOut?: BizType; bizTypeIn?: BizType } = {},
  ) {
    amount = roundMoney(amount);
    if (amount <= 0) throw new BadRequestException('转账金额必须 > 0');
    if (
      from.id === to.id &&
      resolveAccountRoomId(from.type, from.roomId) === resolveAccountRoomId(to.type, to.roomId)
    ) {
      throw new BadRequestException('不能转给自己');
    }
    const bizOut = opts.bizTypeOut ?? 'TRANSFER_OUT';
    const bizIn = opts.bizTypeIn ?? 'TRANSFER_IN';
    return this.prisma.$transaction(async (tx) => {
      const outKey = opts.idempotencyKey ? `${opts.idempotencyKey}:OUT` : undefined;
      const inKey = opts.idempotencyKey ? `${opts.idempotencyKey}:IN` : undefined;
      return this.transferInTx(
        tx,
        { type: from.type, id: from.id, roomId: from.roomId, idempotencyKey: outKey, remark: opts.remark },
        { type: to.type, id: to.id, roomId: to.roomId, idempotencyKey: inKey, remark: opts.remark },
        amount,
        { ...opts, bizType: bizOut, bizTypeIn: bizIn },
      );
    });
  }

  /**
   * 下分冻结：balance → frozen（可花余额减少，审核通过再出账）
   * 必须指定运营房间。
   */
  async freezeInTx(
    tx: Prisma.TransactionClient,
    playerId: string,
    amount: number,
    opts: LedgerOpts = {},
  ) {
    amount = roundMoney(amount);
    if (amount <= 0) throw new BadRequestException('冻结金额必须 > 0');
    const roomId = resolveAccountRoomId('PLAYER', opts.roomId);
    if (opts.idempotencyKey) {
      await this.lockIdempotencyKeyInTx(tx, opts.idempotencyKey);
      const existed = await tx.pointsLedger.findUnique({
        where: { idempotencyKey: opts.idempotencyKey },
      });
      if (existed) return existed;
    }
    const account = await tx.pointsAccount.upsert({
      where: this.accountWhere('PLAYER', playerId, roomId),
      update: {},
      create: { ownerType: 'PLAYER', ownerId: playerId, roomId },
    });
    const amountSql = new Prisma.Decimal(amount.toFixed(2));
    const rows = await tx.$queryRaw<{ balance: unknown; frozen: unknown }[]>`
      UPDATE "PointsAccount"
      SET "balance" = "balance" - ${amountSql},
          "frozen" = "frozen" + ${amountSql},
          "updatedAt" = NOW()
      WHERE "id" = ${account.id}
        AND "balance" >= ${amountSql}
      RETURNING "balance", "frozen"
    `;
    if (rows.length === 0) {
      throw new BadRequestException('该房间账户余额不足');
    }
    const newBalance = asMoney(rows[0].balance);
    return tx.pointsLedger.create({
      data: {
        accountId: account.id,
        bizType: 'WITHDRAW',
        amount: new Prisma.Decimal((-amount).toFixed(2)),
        balanceAfter: new Prisma.Decimal(newBalance.toFixed(2)),
        refType: opts.refType,
        refId: opts.refId,
        remark: opts.remark ?? '下分冻结待审',
        operatorId: opts.operatorId,
        idempotencyKey: opts.idempotencyKey,
      },
    });
  }

  /** 拒绝下分：frozen → balance */
  async unfreezeToBalanceInTx(
    tx: Prisma.TransactionClient,
    playerId: string,
    amount: number,
    opts: LedgerOpts = {},
  ) {
    amount = roundMoney(amount);
    if (amount <= 0) throw new BadRequestException('解冻金额必须 > 0');
    const roomId = resolveAccountRoomId('PLAYER', opts.roomId);
    if (opts.idempotencyKey) {
      await this.lockIdempotencyKeyInTx(tx, opts.idempotencyKey);
      const existed = await tx.pointsLedger.findUnique({
        where: { idempotencyKey: opts.idempotencyKey },
      });
      if (existed) return existed;
    }
    const account = await tx.pointsAccount.findUnique({
      where: this.accountWhere('PLAYER', playerId, roomId),
    });
    if (!account) throw new BadRequestException('账户不存在');
    const amountSql = new Prisma.Decimal(amount.toFixed(2));
    const rows = await tx.$queryRaw<{ balance: unknown }[]>`
      UPDATE "PointsAccount"
      SET "balance" = "balance" + ${amountSql},
          "frozen" = "frozen" - ${amountSql},
          "updatedAt" = NOW()
      WHERE "id" = ${account.id}
        AND "frozen" >= ${amountSql}
      RETURNING "balance"
    `;
    if (rows.length === 0) {
      throw new BadRequestException('冻结额不足，无法退回');
    }
    const newBalance = asMoney(rows[0].balance);
    return tx.pointsLedger.create({
      data: {
        accountId: account.id,
        bizType: 'ADJUST',
        amount: amountSql,
        balanceAfter: new Prisma.Decimal(newBalance.toFixed(2)),
        refType: opts.refType,
        refId: opts.refId,
        remark: opts.remark ?? '下分驳回解冻',
        operatorId: opts.operatorId,
        idempotencyKey: opts.idempotencyKey,
      },
    });
  }

  /** 通过下分：仅消费 frozen（钱已不在 balance） */
  async consumeFrozenInTx(
    tx: Prisma.TransactionClient,
    playerId: string,
    amount: number,
    roomId?: string,
  ) {
    amount = roundMoney(amount);
    if (amount <= 0) return;
    const rid = resolveAccountRoomId('PLAYER', roomId);
    const account = await tx.pointsAccount.findUnique({
      where: this.accountWhere('PLAYER', playerId, rid),
    });
    if (!account) throw new BadRequestException('账户不存在');
    const amountSql = new Prisma.Decimal(amount.toFixed(2));
    const rows = await tx.$queryRaw<{ id: string }[]>`
      UPDATE "PointsAccount"
      SET "frozen" = "frozen" - ${amountSql},
          "updatedAt" = NOW()
      WHERE "id" = ${account.id}
        AND "frozen" >= ${amountSql}
      RETURNING "id"
    `;
    if (rows.length === 0) {
      throw new BadRequestException('冻结额不足，无法完成下分');
    }
  }
}
