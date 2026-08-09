/**
 * 玩家上下分 / 关盘（两本账：盘分 + 玩家；现金/信用同一套）
 * - 盘分账：现金=余额+上盘额度(pointsQuota)；信用=剩余信用(pointsQuota)；可为负=超分
 * - 玩家账：玩家持分
 * - 上分：扣盘分 → 加玩家（盘分不够也允许，变负）
 * - 下分：扣玩家 → 加回盘分
 * - 飞盘：只动玩家↔平台，单笔输赢不改盘分
 * - 关盘：下注吃进盘分；派彩从盘分出；输则盘分留下
 */
import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { asMoney, roundMoney } from '@gamebox/shared';
import type { PointsService } from '../points/points.service';

/** 资金单订单号（前端生成的 clientRequestId，兼作展示订单号与幂等键锚点） */
export function assertFundOrderNo(raw?: string): string {
  const id = String(raw || '').trim().slice(0, 64);
  if (id.length < 8) throw new BadRequestException('请提供订单号');
  if (!/^[A-Za-z0-9_-]{8,64}$/.test(id)) {
    throw new BadRequestException('订单号格式无效');
  }
  return id;
}

export function withOrderRemark(orderNo: string, remark?: string, fallback = ''): string {
  const note = (remark || '').trim() || fallback;
  return note ? `订单号 ${orderNo}｜${note}` : `订单号 ${orderNo}`;
}

export async function findAgentRoomForPlayer(
  tx: Prisma.TransactionClient,
  playerId: string,
  agentUserId: string,
  preferredRoomId?: string | null,
) {
  const roomSelect = {
    id: true,
    overIssueUsed: true,
    bookMode: true,
    creditLimit: true,
    overIssueEnabled: true,
  } as const;
  if (preferredRoomId) {
    const member = await tx.roomMember.findFirst({
      where: {
        playerId,
        roomId: preferredRoomId,
        status: 'APPROVED',
        room: { ownerAgent: { userId: agentUserId } },
      },
      select: { room: { select: roomSelect } },
    });
    if (!member?.room) {
      throw new BadRequestException('玩家不在该房间，或房间不属于当前代理');
    }
    return member.room;
  }
  const member = await tx.roomMember.findFirst({
    where: {
      playerId,
      status: 'APPROVED',
      room: { ownerAgent: { userId: agentUserId } },
    },
    select: { room: { select: roomSelect } },
    orderBy: { updatedAt: 'desc' },
  });
  return member?.room ?? null;
}

function isCreditRoom(room: { bookMode?: string | null } | null | undefined) {
  return room?.bookMode === 'CREDIT';
}

/** 锁 Agent 行，防止剩余信用并发超发 / 与结账交错 */
export async function lockAgentRowInTx(
  tx: Prisma.TransactionClient,
  agentUserId: string,
) {
  await tx.$queryRaw`SELECT id FROM "Agent" WHERE "userId" = ${agentUserId} FOR UPDATE`;
}

async function resolveClosedBookMode(
  tx: Prisma.TransactionClient,
  roomId: string | undefined,
  bookMode?: string,
): Promise<'CREDIT' | 'CASH'> {
  if (bookMode === 'CREDIT' || bookMode === 'CASH') return bookMode;
  if (!roomId) return 'CASH';
  const room = await tx.room.findUnique({
    where: { id: roomId },
    select: { bookMode: true },
  });
  return room?.bookMode === 'CREDIT' ? 'CREDIT' : 'CASH';
}

/**
 * 关盘押注：扣玩家 + 注码吃进代理盘分（庄家收注）。
 * 现金/信用同一套；盘分允许变负。
 */
export async function closedDiskDebitBetInTx(
  tx: Prisma.TransactionClient,
  points: PointsService,
  opts: {
    playerId: string;
    agentUserId: string;
    roomId?: string;
    bookMode?: string;
    amount: number;
    remark: string;
    refType: string;
    refId: string;
    idemPlayer: string;
    idemAgent: string;
  },
) {
  const amount = roundMoney(opts.amount);
  if (amount <= 0) return;
  if (!opts.roomId) throw new BadRequestException('关盘扣注缺少房间');
  if (!opts.agentUserId) throw new BadRequestException('关盘扣注缺少代理');
  const mode = await resolveClosedBookMode(tx, opts.roomId, opts.bookMode);
  await points.creditInTx(tx, 'PLAYER', opts.playerId, -amount, 'BET', {
    remark: opts.remark,
    refType: opts.refType,
    refId: opts.refId,
    idempotencyKey: opts.idemPlayer,
    roomId: opts.roomId,
  });
  await adjustAgentDiskInTx(tx, points, {
    agentUserId: opts.agentUserId,
    bookMode: mode,
    delta: amount,
    bizType: 'BET',
    remark: `${opts.remark}·吃注进盘分`,
    refType: opts.refType,
    refId: opts.refId,
    idempotencyKey: opts.idemAgent,
  });
}

/**
 * 关盘派彩：加玩家 + 从代理盘分赔出（庄家赔付）。
 * stake 仅作备注/对账，盘分按 payout 全额扣（注码已在下注时吃进）。
 */
export async function closedDiskSettleWinInTx(
  tx: Prisma.TransactionClient,
  points: PointsService,
  opts: {
    playerId: string;
    agentUserId: string;
    roomId?: string;
    bookMode?: string;
    stake: number;
    payout: number;
    remark: string;
    refType: string;
    refId: string;
    idemPlayer: string;
    idemAgent: string;
    idemOverIssue?: string;
  },
) {
  const payout = roundMoney(Math.max(0, opts.payout));
  if (payout <= 0) return;
  if (!opts.roomId) throw new BadRequestException('关盘派彩缺少房间');
  if (!opts.agentUserId) throw new BadRequestException('关盘派彩缺少代理');
  const mode = await resolveClosedBookMode(tx, opts.roomId, opts.bookMode);

  await points.creditInTx(tx, 'PLAYER', opts.playerId, payout, 'WIN', {
    remark: opts.remark,
    refType: opts.refType,
    refId: opts.refId,
    idempotencyKey: opts.idemPlayer,
    roomId: opts.roomId,
  });
  await adjustAgentDiskInTx(tx, points, {
    agentUserId: opts.agentUserId,
    bookMode: mode,
    delta: -payout,
    bizType: 'WIN',
    remark: `${opts.remark}·盘分派彩`,
    refType: opts.refType,
    refId: opts.refId,
    idempotencyKey: opts.idemAgent,
  });
}

/** 关盘退注：加回玩家 + 从盘分吐出原先吃进的注 */
export async function closedDiskRefundBetInTx(
  tx: Prisma.TransactionClient,
  points: PointsService,
  opts: {
    playerId: string;
    agentUserId: string;
    roomId?: string;
    bookMode?: string;
    amount: number;
    remark: string;
    refType: string;
    refId: string;
    idemPlayer: string;
    idemAgent: string;
  },
) {
  const amount = roundMoney(opts.amount);
  if (amount <= 0) return;
  if (!opts.roomId) throw new BadRequestException('关盘退注缺少房间');
  if (!opts.agentUserId) throw new BadRequestException('关盘退注缺少代理');
  const mode = await resolveClosedBookMode(tx, opts.roomId, opts.bookMode);
  await points.creditInTx(tx, 'PLAYER', opts.playerId, amount, 'ADJUST', {
    remark: opts.remark,
    refType: opts.refType,
    refId: opts.refId,
    idempotencyKey: opts.idemPlayer,
    roomId: opts.roomId,
  });
  await adjustAgentDiskInTx(tx, points, {
    agentUserId: opts.agentUserId,
    bookMode: mode,
    delta: -amount,
    bizType: 'ADJUST',
    remark: `${opts.remark}·退注出盘分`,
    refType: opts.refType,
    refId: opts.refId,
    idempotencyKey: opts.idemAgent,
  });
}

export async function applyAgentCreditToPlayerInTx(
  tx: Prisma.TransactionClient,
  points: PointsService,
  opts: {
    agentUserId: string;
    playerId: string;
    amount: number;
    operatorId: string;
    remark?: string;
    refType: string;
    refId: string;
    idemOut: string;
    idemIn: string;
    playerBizType?: 'TRANSFER_IN' | 'RECHARGE';
    /** 必填：上分落入该运营房间的玩家账本 */
    roomId: string;
  },
): Promise<{ real: number; overIssue: number; fromBalance: number; roomId: string | null }> {
  const amount = roundMoney(opts.amount);
  const room = await findAgentRoomForPlayer(
    tx,
    opts.playerId,
    opts.agentUserId,
    opts.roomId,
  );
  if (!room) throw new BadRequestException('玩家未绑定房间');

  await lockAgentRowInTx(tx, opts.agentUserId);
  await points.lockOwnersInTx(tx, [
    { type: 'AGENT', id: opts.agentUserId },
    { type: 'PLAYER', id: opts.playerId, roomId: room.id },
  ]);

  const agent = await tx.agent.findUnique({ where: { userId: opts.agentUserId } });
  if (!agent) throw new BadRequestException('代理账户不存在');

  // ── B 信用盘：扣盘分(剩余信用) → 加玩家；不够则盘分变负（超分）──
  if (isCreditRoom(room)) {
    const quota = asMoney(agent.pointsQuota);
    const overIssue = roundMoney(Math.max(0, amount - Math.max(0, quota)));
    const real = roundMoney(amount - overIssue);
    await writeAgentQuotaInTx(tx, {
      agentUserId: opts.agentUserId,
      bookMode: 'CREDIT',
      delta: -amount,
      usedDelta: amount,
      bizType: 'TRANSFER_OUT',
      remark: opts.remark ?? (overIssue > 0 ? '上分(信用·超分)' : '上分(信用)'),
      refType: opts.refType,
      refId: opts.refId,
      idempotencyKey: `${opts.idemIn}:QUOTA`,
    });
    await points.creditInTx(
      tx,
      'PLAYER',
      opts.playerId,
      amount,
      opts.playerBizType ?? 'TRANSFER_IN',
      {
        operatorId: opts.operatorId,
        remark: opts.remark ?? (overIssue > 0 ? '上分(信用·超分)' : '上分(信用)'),
        refType: opts.refType,
        refId: opts.refId,
        idempotencyKey: opts.idemIn,
        roomId: room.id,
      },
    );
    return { real, overIssue, fromBalance: 0, roomId: room.id };
  }

  // ── A 现金盘：扣盘分（余额+上盘额度）→ 加玩家；不够则变负（超分）──
  const acc = await tx.pointsAccount.findUnique({
    where: points.accountWhere('AGENT', opts.agentUserId),
  });
  const bal = asMoney(acc?.balance ?? 0);
  const quota = asMoney(agent.pointsQuota);
  const disk = roundMoney(Math.min(bal, quota));
  const overIssue = roundMoney(Math.max(0, amount - Math.max(0, disk)));
  const real = roundMoney(amount - overIssue);
  await points.transferInTx(
    tx,
    {
      type: 'AGENT',
      id: opts.agentUserId,
      remark: opts.remark ?? (overIssue > 0 ? '上分(盘分·超分)' : '上分(盘分)'),
      idempotencyKey: opts.idemOut,
    },
    {
      type: 'PLAYER',
      id: opts.playerId,
      roomId: room.id,
      remark: opts.remark ?? (overIssue > 0 ? '上分(盘分·超分)' : '上分(盘分)'),
      idempotencyKey: opts.idemIn,
    },
    amount,
    {
      bizType: 'TRANSFER_OUT',
      bizTypeIn: opts.playerBizType ?? 'TRANSFER_IN',
      operatorId: opts.operatorId,
      refType: opts.refType,
      refId: opts.refId,
    },
  );
  await writeAgentQuotaInTx(tx, {
    agentUserId: opts.agentUserId,
    bookMode: 'CASH',
    delta: -amount,
    bizType: 'TRANSFER_OUT',
    remark: opts.remark ?? (overIssue > 0 ? '上分(盘分·超分)' : '上分(盘分)'),
    refType: opts.refType,
    refId: opts.refId,
    idempotencyKey: `${opts.idemOut}:QUOTA`,
  });

  return { real, overIssue, fromBalance: real, roomId: room.id };
}

/**
 * 下分结算到代理（玩家分已扣）：盘分加回。
 * - CREDIT：加回剩余信用
 * - CASH：加回盘分（余额+上盘额度）
 */
export async function settlePlayerDebitToAgentInTx(
  tx: Prisma.TransactionClient,
  points: PointsService,
  opts: {
    agentUserId: string;
    playerId: string;
    amount: number;
    operatorId: string;
    remark?: string;
    refType: string;
    refId: string;
    idemAgent: string;
    roomId: string;
  },
): Promise<{ coverBack: number; overIssueBack: number; realPart: number; roomId: string | null }> {
  const amount = roundMoney(opts.amount);
  const room = await findAgentRoomForPlayer(
    tx,
    opts.playerId,
    opts.agentUserId,
    opts.roomId,
  );

  if (!room) {
    const creditOwned = await tx.room.findFirst({
      where: { ownerAgent: { userId: opts.agentUserId }, bookMode: 'CREDIT' },
      select: { id: true },
    });
    if (creditOwned) {
      throw new BadRequestException('玩家未加入该信用盘房间，无法下分');
    }
  }

  if (isCreditRoom(room)) {
    await writeAgentQuotaInTx(tx, {
      agentUserId: opts.agentUserId,
      bookMode: 'CREDIT',
      delta: amount,
      usedDelta: -amount,
      bizType: 'TRANSFER_IN',
      remark: opts.remark ?? '下分回收剩余信用',
      refType: opts.refType,
      refId: opts.refId,
      idempotencyKey: `${opts.idemAgent}:QUOTA`,
    });
    return { coverBack: 0, overIssueBack: 0, realPart: amount, roomId: room?.id ?? null };
  }

  // 现金：代理向玩家买回分 → 盘分加回
  await adjustCashDiskInTx(tx, points, {
    agentUserId: opts.agentUserId,
    delta: amount,
    bizType: 'ADJUST',
    remark: opts.remark ?? '下分买回盘分',
    refType: opts.refType,
    refId: opts.refId,
    idempotencyKey: opts.idemAgent,
  });
  return { coverBack: amount, overIssueBack: 0, realPart: amount, roomId: room?.id ?? null };
}

export async function applyCsCreditToPlayerInTx(
  tx: Prisma.TransactionClient,
  points: PointsService,
  opts: {
    csUserId: string;
    agentUserId: string;
    playerId: string;
    amount: number;
    operatorId: string;
    remark?: string;
    refType: string;
    refId: string;
    idemOut: string;
    idemIn: string;
    wageRate: number;
    roomId: string;
  },
): Promise<{ real: number; wage: number }> {
  const amount = roundMoney(opts.amount);
  const room = await findAgentRoomForPlayer(
    tx,
    opts.playerId,
    opts.agentUserId,
    opts.roomId,
  );
  if (!room) throw new BadRequestException('玩家未绑定房间');
  const credit = isCreditRoom(room);
  if (credit) {
    await lockAgentRowInTx(tx, opts.agentUserId);
  }
  await points.lockOwnersInTx(tx, [
    { type: 'CS', id: opts.csUserId },
    { type: 'AGENT', id: opts.agentUserId },
    { type: 'PLAYER', id: opts.playerId, roomId: room.id },
  ]);

  const csAcc = await tx.pointsAccount.findUnique({
    where: points.accountWhere('CS', opts.csUserId),
  });
  const csBal = asMoney(csAcc?.balance ?? 0);
  if (csBal + 1e-9 < amount) {
    throw new BadRequestException(`客服额度不足（可用 ${csBal}）`);
  }

  await points.creditInTx(tx, 'CS', opts.csUserId, -amount, 'TRANSFER_OUT', {
    operatorId: opts.operatorId,
    remark: opts.remark ?? '客服上分',
    refType: opts.refType,
    refId: opts.refId,
    idempotencyKey: opts.idemOut,
  });

  const agent = await tx.agent.findUnique({ where: { userId: opts.agentUserId } });
  if (!agent) throw new BadRequestException('主代理不存在');

  // 客服上分：扣客服额度、加玩家持分（现金盘额度已在划拨时分到客服桌，此处不再扣上盘额度）
  await points.creditInTx(tx, 'PLAYER', opts.playerId, amount, 'TRANSFER_IN', {
    operatorId: opts.operatorId,
    remark: opts.remark ?? (credit ? '客服上分(信用)' : '客服上分(房间)'),
    refType: opts.refType,
    refId: opts.refId,
    idempotencyKey: opts.idemIn,
    roomId: room.id,
  });

  let wage = 0;
  const rate = Number(opts.wageRate) || 0;
  // 现金/信用：本金已成功；佣金写账单，来源够则当场结清，不够记未结
  // 现金来源=盘分；信用来源=剩余信用
  if (rate > 0) {
    wage = roundMoney(amount * rate);
    if (wage > 0) {
      await createAndMaybeSettleWageBillInTx(tx, points, {
        bookMode: credit ? 'CREDIT' : 'CASH',
        csUserId: opts.csUserId,
        agentUserId: opts.agentUserId,
        playerId: opts.playerId,
        kind: 'UP',
        fundAmount: amount,
        wageAmount: wage,
        wageRate: rate,
        operatorId: opts.operatorId,
        refType: opts.refType,
        refId: opts.refId,
        diskIdem: `${opts.idemOut}:WAGE_DISK`,
        wageIdem: `${opts.idemIn}:WAGE`,
        wageRemark: '上分佣金',
        diskRemark: `客服上分佣金 ${rate * 100}%`,
      });
    }
  }

  return { real: amount, wage };
}

export async function settleCsPlayerDebitInTx(
  tx: Prisma.TransactionClient,
  points: PointsService,
  opts: {
    csUserId: string;
    agentUserId: string;
    playerId: string;
    amount: number;
    operatorId: string;
    remark?: string;
    refType: string;
    refId: string;
    idemCs: string;
    wageRate: number;
    roomId: string;
  },
): Promise<{ coverBack: number; wage: number }> {
  const amount = roundMoney(opts.amount);
  const room = await findAgentRoomForPlayer(
    tx,
    opts.playerId,
    opts.agentUserId,
    opts.roomId,
  );

  await points.creditInTx(tx, 'CS', opts.csUserId, amount, 'TRANSFER_IN', {
    operatorId: opts.operatorId,
    remark: opts.remark ?? '客服下分收回',
    refType: opts.refType,
    refId: opts.refId,
    idempotencyKey: opts.idemCs,
  });

  // 现金/信用：下分只回客服额度（现金盘额度在收回客服→代理时再加回上盘）
  const coverBack = 0;

  let wage = 0;
  const rate = Number(opts.wageRate) || 0;
  if (rate > 0) {
    wage = roundMoney(amount * rate);
    if (wage > 0) {
      const credit = isCreditRoom(room);
      await createAndMaybeSettleWageBillInTx(tx, points, {
        bookMode: credit ? 'CREDIT' : 'CASH',
        csUserId: opts.csUserId,
        agentUserId: opts.agentUserId,
        playerId: opts.playerId,
        kind: 'DOWN',
        fundAmount: amount,
        wageAmount: wage,
        wageRate: rate,
        operatorId: opts.operatorId,
        refType: opts.refType,
        refId: opts.refId,
        diskIdem: `${opts.idemCs}:WAGE_DISK`,
        wageIdem: `${opts.idemCs}:WAGE_IN`,
        wageRemark: '下分佣金',
        diskRemark: `客服下分佣金 ${rate * 100}%`,
      });
    }
  }

  return { coverBack, wage };
}

/**
 * 客服佣金账单：先写 PENDING；来源够则当场入客服并标已结，不够保持未结（不抛错、不回滚本金）。
 * - CASH：扣代理盘分
 * - CREDIT：扣剩余信用
 */
export async function createAndMaybeSettleWageBillInTx(
  tx: Prisma.TransactionClient,
  points: PointsService,
  opts: {
    bookMode: 'CASH' | 'CREDIT';
    csUserId: string;
    agentUserId: string;
    playerId: string;
    kind: 'UP' | 'DOWN';
    fundAmount: number;
    wageAmount: number;
    wageRate: number;
    operatorId: string;
    refType?: string;
    refId?: string;
    diskIdem: string;
    wageIdem: string;
    wageRemark: string;
    diskRemark: string;
  },
): Promise<{ billId: string; settled: boolean }> {
  const wage = roundMoney(opts.wageAmount);
  const bill = await tx.csWageBill.create({
    data: {
      csUserId: opts.csUserId,
      agentUserId: opts.agentUserId,
      playerId: opts.playerId,
      kind: opts.kind,
      fundAmount: opts.fundAmount,
      wageAmount: wage,
      wageRate: opts.wageRate,
      status: 'PENDING',
      refType: opts.refType,
      refId: opts.refId,
    },
  });
  const paid = await tryPayWageBillInTx(tx, points, {
    bookMode: opts.bookMode,
    billId: bill.id,
    csUserId: opts.csUserId,
    agentUserId: opts.agentUserId,
    wageAmount: wage,
    operatorId: opts.operatorId,
    refType: opts.refType,
    refId: opts.refId ?? bill.id,
    diskIdem: opts.diskIdem,
    wageIdem: opts.wageIdem,
    wageRemark: opts.wageRemark,
    diskRemark: opts.diskRemark,
  });
  return { billId: bill.id, settled: paid };
}

/** @deprecated 使用 createAndMaybeSettleWageBillInTx */
export const createAndMaybeSettleCashWageBillInTx = (
  tx: Prisma.TransactionClient,
  points: PointsService,
  opts: Omit<Parameters<typeof createAndMaybeSettleWageBillInTx>[2], 'bookMode'>,
) => createAndMaybeSettleWageBillInTx(tx, points, { ...opts, bookMode: 'CASH' });

/** 结清一笔未结佣金；来源不够返回 false（不抛错） */
export async function tryPayWageBillInTx(
  tx: Prisma.TransactionClient,
  points: PointsService,
  opts: {
    bookMode: 'CASH' | 'CREDIT';
    billId: string;
    csUserId: string;
    agentUserId: string;
    wageAmount: number;
    operatorId: string;
    refType?: string;
    refId: string;
    diskIdem: string;
    wageIdem: string;
    wageRemark: string;
    diskRemark: string;
  },
): Promise<boolean> {
  const need = roundMoney(opts.wageAmount);

  /** PENDING → SETTLED 只会成功一次，并发重复结清在这里被挡住 */
  const claimBill = async () => {
    const claimed = await tx.csWageBill.updateMany({
      where: { id: opts.billId, status: 'PENDING' },
      data: { status: 'SETTLED', settledAt: new Date() },
    });
    return claimed.count > 0;
  };

  if (need <= 0) {
    await claimBill();
    return true;
  }
  await lockAgentRowInTx(tx, opts.agentUserId);

  /* 余额判定先于抢单：不够时原样返回 false，账单要留在 PENDING 等下次结 */
  const agent = await tx.agent.findUnique({ where: { userId: opts.agentUserId } });
  const quota = asMoney(agent?.pointsQuota ?? 0);
  if (opts.bookMode === 'CREDIT') {
    if (quota + 1e-9 < need) return false;
  } else {
    const acc = await tx.pointsAccount.findUnique({
      where: points.accountWhere('AGENT', opts.agentUserId),
    });
    const bal = asMoney(acc?.balance ?? 0);
    if (Math.min(bal, quota) + 1e-9 < need) return false;
  }

  /* 已被并发的另一笔结清：直接收手，不能再付一遍 */
  if (!(await claimBill())) return true;

  if (opts.bookMode === 'CREDIT') {
    await writeAgentQuotaInTx(tx, {
      agentUserId: opts.agentUserId,
      bookMode: 'CREDIT',
      delta: -need,
      usedDelta: need,
      bizType: 'TRANSFER_OUT',
      remark: opts.diskRemark,
      refType: opts.refType,
      refId: opts.refId,
      idempotencyKey: opts.diskIdem,
    });
  } else {
    await adjustCashDiskInTx(tx, points, {
      agentUserId: opts.agentUserId,
      delta: -need,
      bizType: 'ADJUST',
      remark: opts.diskRemark,
      refType: opts.refType,
      refId: opts.refId,
      idempotencyKey: opts.diskIdem,
    });
  }

  const ledger = await points.creditInTx(tx, 'CS', opts.csUserId, need, 'TRANSFER_IN', {
    operatorId: opts.operatorId,
    remark: opts.wageRemark,
    refType: opts.refType,
    refId: opts.refId,
    idempotencyKey: opts.wageIdem,
  });
  await tx.csWageBill.update({
    where: { id: opts.billId },
    data: { settleLedgerId: ledger?.id ?? null },
  });
  return true;
}

/** @deprecated 使用 tryPayWageBillInTx */
export async function tryPayCashWageBillInTx(
  tx: Prisma.TransactionClient,
  points: PointsService,
  opts: Omit<Parameters<typeof tryPayWageBillInTx>[2], 'bookMode'>,
): Promise<boolean> {
  return tryPayWageBillInTx(tx, points, { ...opts, bookMode: 'CASH' });
}

/** @deprecated */
export const restoreAgentAfterPlayerDebitInTx = settlePlayerDebitToAgentInTx;

/**
 * OPEN=建号期初 TRANSFER_IN=盘分流入（平台卖分/下分买回）
 * TRANSFER_OUT=盘分流出（上分/划给客服） SETTLE=结账校准
 */
export type DiskBizType =
  | SyncedDiskBizType
  | 'OPEN'
  | 'TRANSFER_IN'
  | 'TRANSFER_OUT'
  | 'SETTLE';

/**
 * 余额与额度同步变动的场景，bizType 会一并写进 PointsLedger，
 * 因此只能取 PointsService 认识的那几个值。
 */
type SyncedDiskBizType = 'REBATE' | 'COMMISSION' | 'ADJUST' | 'BET' | 'WIN';

/**
 * 盘分调整的唯一落地点：改 Agent.pointsQuota / pointsUsed 并写 AgentQuotaLedger。
 *
 * 全平台改 pointsQuota 都必须走这里，否则 sum(AgentQuotaLedger.delta) 对不上
 * Agent.pointsQuota，对账任务就没有基准，代理喊「我额度少了」时查无可查。
 *
 * 幂等闸门放在这里而不是各调用方，原因是 PointsService.creditInTx 命中幂等键时
 * 会提前返回、余额不变，若调用方仍无条件改额度，两者就会永久错开。
 * 先加 Agent 行锁再动手，保证并发的第二笔一定能看到第一笔已提交的流水；
 * 调用方通常已持锁，这里重复加是同事务内的空操作。
 *
 * @returns 真正落账返回 true；命中幂等键跳过返回 false
 */
export async function writeAgentQuotaInTx(
  tx: Prisma.TransactionClient,
  opts: {
    agentUserId: string;
    bookMode: 'CASH' | 'CREDIT';
    /** 增量口径；与 quotaTo 二选一 */
    delta?: number;
    /** 校准到绝对值（结账、调合同额度）；流水里仍记算出的增量 */
    quotaTo?: number;
    /** pointsUsed 增量，结果夹在 0 以上；与 usedTo 二选一，都不传则不动 */
    usedDelta?: number;
    usedTo?: number;
    bizType: DiskBizType;
    remark: string;
    refType?: string;
    refId?: string;
    idempotencyKey: string;
    /** Agent 行可能尚未创建（平台首次卖分给子账号） */
    createIfMissing?: boolean;
    /** 现金盘在改额度前还要动余额 */
    beforeQuota?: () => Promise<void>;
  },
): Promise<boolean> {
  const done = await tx.agentQuotaLedger.findUnique({
    where: { idempotencyKey: opts.idempotencyKey },
    select: { id: true },
  });
  if (done) return false;

  await lockAgentRowInTx(tx, opts.agentUserId);
  if (opts.beforeQuota) await opts.beforeQuota();

  const before = await tx.agent.findUnique({
    where: { userId: opts.agentUserId },
    select: { pointsQuota: true, pointsUsed: true },
  });
  if (!before && !opts.createIfMissing) throw new BadRequestException('代理账户不存在');

  const quotaBefore = asMoney(before?.pointsQuota ?? 0);
  const usedBefore = asMoney(before?.pointsUsed ?? 0);
  const delta = roundMoney(
    opts.quotaTo !== undefined ? opts.quotaTo - quotaBefore : (opts.delta ?? 0),
  );
  const quotaAfter = roundMoney(quotaBefore + delta);
  /* pointsUsed 是「已发出去多少」的计数而非账，沿用旧口径夹在 0 以上 */
  let usedAfter = usedBefore;
  if (opts.usedTo !== undefined) usedAfter = roundMoney(Math.max(0, opts.usedTo));
  else if (opts.usedDelta !== undefined) {
    usedAfter = roundMoney(Math.max(0, usedBefore + opts.usedDelta));
  }

  const data = {
    pointsQuota: new Prisma.Decimal(quotaAfter.toFixed(2)),
    pointsUsed: new Prisma.Decimal(usedAfter.toFixed(2)),
  };
  if (before) {
    await tx.agent.update({ where: { userId: opts.agentUserId }, data });
  } else {
    await tx.agent.create({ data: { userId: opts.agentUserId, ...data } });
  }

  await tx.agentQuotaLedger.create({
    data: {
      agentUserId: opts.agentUserId,
      bookMode: opts.bookMode,
      bizType: opts.bizType,
      delta: new Prisma.Decimal(delta.toFixed(2)),
      quotaAfter: new Prisma.Decimal(quotaAfter.toFixed(2)),
      refType: opts.refType,
      refId: opts.refId,
      remark: opts.remark,
      idempotencyKey: opts.idempotencyKey,
    },
  });
  return true;
}

/**
 * 现金盘分账：余额与上盘额度同步增减。
 * 允许变负（超分 / 关盘赔付）；挂靠佣金等「不够不赊」须在调用方先判断。
 */
export async function adjustCashDiskInTx(
  tx: Prisma.TransactionClient,
  points: PointsService,
  opts: {
    agentUserId: string;
    delta: number;
    bizType: SyncedDiskBizType;
    remark: string;
    refType?: string;
    refId?: string;
    idempotencyKey: string;
  },
) {
  const delta = roundMoney(opts.delta);
  if (delta === 0) return;
  await lockAgentRowInTx(tx, opts.agentUserId);
  await writeAgentQuotaInTx(tx, {
    agentUserId: opts.agentUserId,
    bookMode: 'CASH',
    delta,
    bizType: opts.bizType,
    remark: opts.remark,
    refType: opts.refType,
    refId: opts.refId,
    idempotencyKey: opts.idempotencyKey,
    beforeQuota: async () => {
      await points.creditInTx(tx, 'AGENT', opts.agentUserId, delta, opts.bizType, {
        remark: opts.remark,
        refType: opts.refType,
        refId: opts.refId,
        idempotencyKey: opts.idempotencyKey,
      });
    },
  });
}

/**
 * 按盘种调整代理盘分：现金=余额+额度；信用=只动 pointsQuota（佣金账户不动）。
 */
export async function adjustAgentDiskInTx(
  tx: Prisma.TransactionClient,
  points: PointsService,
  opts: {
    agentUserId: string;
    bookMode: 'CASH' | 'CREDIT';
    delta: number;
    bizType: SyncedDiskBizType;
    remark: string;
    refType?: string;
    refId?: string;
    idempotencyKey: string;
  },
) {
  const delta = roundMoney(opts.delta);
  if (delta === 0) return;
  if (opts.bookMode === 'CREDIT') {
    await lockAgentRowInTx(tx, opts.agentUserId);
    await writeAgentQuotaInTx(tx, {
      agentUserId: opts.agentUserId,
      bookMode: 'CREDIT',
      delta,
      bizType: opts.bizType,
      remark: opts.remark,
      refType: opts.refType,
      refId: opts.refId,
      idempotencyKey: opts.idempotencyKey,
    });
    return;
  }
  await adjustCashDiskInTx(tx, points, {
    agentUserId: opts.agentUserId,
    delta,
    bizType: opts.bizType,
    remark: opts.remark,
    refType: opts.refType,
    refId: opts.refId,
    idempotencyKey: opts.idempotencyKey,
  });
}

/**
 * 信用盘分账 → 玩家：扣剩余信用、加玩家分（合计不变）。
 * 佣金账户（代理余额）不动。
 */
export async function payCreditDiskToPlayerInTx(
  tx: Prisma.TransactionClient,
  points: PointsService,
  opts: {
    agentUserId: string;
    playerId: string;
    amount: number;
    bizType: 'REBATE' | 'COMMISSION';
    remark: string;
    refType?: string;
    refId?: string;
    idemPlayer: string;
    roomId: string;
  },
) {
  const amount = roundMoney(opts.amount);
  if (amount <= 0) return null;
  if (!opts.roomId) throw new BadRequestException('入账缺少房间');
  await lockAgentRowInTx(tx, opts.agentUserId);
  /* 先认玩家入账这条锚点：原先是「先扣额度再入账」，重放会白扣代理信用而玩家收不到钱 */
  const existed = await tx.pointsLedger.findUnique({
    where: { idempotencyKey: opts.idemPlayer },
  });
  if (existed) return existed;

  await writeAgentQuotaInTx(tx, {
    agentUserId: opts.agentUserId,
    bookMode: 'CREDIT',
    delta: -amount,
    bizType: opts.bizType,
    remark: opts.remark,
    refType: opts.refType,
    refId: opts.refId,
    idempotencyKey: `${opts.idemPlayer}:QUOTA`,
  });
  return points.creditInTx(tx, 'PLAYER', opts.playerId, amount, opts.bizType, {
    remark: opts.remark,
    refType: opts.refType,
    refId: opts.refId,
    idempotencyKey: opts.idemPlayer,
    roomId: opts.roomId,
  });
}
