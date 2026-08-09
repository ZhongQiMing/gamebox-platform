import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { asMoney, roundMoney } from '@gamebox/shared';
import { PrismaService } from '../../prisma/prisma.service';
import {
  PLATFORM_FLOOR_HIT_MARKER,
  PlatformEmergencyService,
} from './platform-emergency.service';

/** 唯一键冲突（幂等键并发撞车） */
function isUniqueConflict(e: unknown): boolean {
  return (e as { code?: string })?.code === 'P2002';
}

export type OwnerType = 'PLATFORM' | 'BRANCH' | 'AGENT' | 'PROXY' | 'CS' | 'PLAYER' | 'ROOM';
export type BizType =
  | 'RECHARGE'
  | 'WITHDRAW'
  | 'TRANSFER_OUT'
  | 'TRANSFER_IN'
  | 'BET'
  | 'WIN'
  | 'FEE'
  | 'COMMISSION'
  | 'REBATE'
  | 'ACTIVITY'
  | 'ADJUST';

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

/**
 * 平台账户余额下限。
 * 平台侧允许为负（代表已下发到生态的积分总量），但不能无底线——
 * 一旦跌破说明赔率配置或风控出了问题，此时拒绝继续派彩并让事务回滚，
 * 比闷声亏到底更容易被发现。可用 PLATFORM_BALANCE_FLOOR 覆盖。
 */
const DEFAULT_PLATFORM_FLOOR = -100_000_000;

function platformFloor(): number {
  const raw = Number(process.env.PLATFORM_BALANCE_FLOOR);
  return Number.isFinite(raw) ? raw : DEFAULT_PLATFORM_FLOOR;
}

/** 代理欠账下限（飞盘关闭后玩家继续赢） */
const DEFAULT_AGENT_FLOOR = -100_000_000;
/** 历史 ROOM 分桶下限（已废弃，结算走平台池；保留兼容旧账户） */
const DEFAULT_ROOM_FLOOR = -100_000_000;

function ownerFloor(ownerType: OwnerType): number | null {
  if (ownerType === 'PLATFORM') return platformFloor();
  if (ownerType === 'AGENT') {
    const raw = Number(process.env.AGENT_BALANCE_FLOOR);
    return Number.isFinite(raw) ? raw : DEFAULT_AGENT_FLOOR;
  }
  if (ownerType === 'ROOM') {
    const raw = Number(process.env.ROOM_BALANCE_FLOOR);
    return Number.isFinite(raw) ? raw : DEFAULT_ROOM_FLOOR;
  }
  return 0;
}

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
 *   6. 【加锁顺序】一笔转账必须先动 PLATFORM 侧再动对手方
 *   7. 【多房】PLAYER 按 (ownerType, ownerId, roomId) 分账；跨房余额互不可用
 */
@Injectable()
export class PointsService {
  constructor(
    private prisma: PrismaService,
    private platformEmergency: PlatformEmergencyService,
  ) {}

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
   * 事务内转账：自动保证「PLATFORM/ROOM 侧先加锁」，其余按 ownerId 排序。
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

    const poolFirst = (t: OwnerType) => t === 'PLATFORM' || t === 'ROOM';
    if (poolFirst(from.type)) return { out: await debit(), in: await credit() };
    if (poolFirst(to.type)) {
      const inn = await credit();
      return { out: await debit(), in: inn };
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
      const existed = await tx.pointsLedger.findUnique({
        where: { idempotencyKey: opts.idempotencyKey },
      });
      if (existed) return existed;
    }

    const roomId = resolveAccountRoomId(ownerType, opts.roomId);
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

    try {
      return await tx.pointsLedger.create({
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
    } catch (e) {
      /*
       * 两个请求同时越过上面那次 findUnique 时，后一个会撞唯一键。
       * 唯一键本身保证了不会重复加钱，但如果把 P2002 抛出去，
       * 整个外层事务（结算/分润可能已经写了别的行）会一起回滚——
       * 明明幂等生效了，结果表现成一次失败。这里按 key 重读返回既有那条。
       */
      if (isUniqueConflict(e) && opts.idempotencyKey) {
        const existed = await tx.pointsLedger.findUnique({
          where: { idempotencyKey: opts.idempotencyKey },
        });
        if (existed) return existed;
      }
      throw e;
    }
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
