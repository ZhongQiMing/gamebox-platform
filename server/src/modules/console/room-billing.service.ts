/**
 * 代理房间月费：按小时扫描到期房间（支持精确到分的扣费时间）。
 * - 代理余额足够 → 同事务：占住账期 → 扣至平台 → 推进 nextBillAt（保留原时分）
 * - 不足 → 房间改为 FROZEN，写 AdminLog；不推进账期，下轮重试
 * - 欠费冻结后若补足成功 → 自动恢复 OPEN
 */
import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { asMoney } from '@gamebox/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { PointsService, PLATFORM_OWNER_ID } from '../points/points.service';
import { AdminLogService } from '../admin/admin-log.service';

function computeNextBillAt(from: Date, billingDay: number, keepTimeFrom?: Date): Date {
  const day = Math.min(28, Math.max(1, billingDay));
  const src = keepTimeFrom ?? from;
  const y = from.getFullYear();
  const m = from.getMonth();
  const h = src.getHours();
  const mi = src.getMinutes();
  const s = src.getSeconds();
  let candidate = new Date(y, m, day, h, mi, s, 0);
  if (candidate.getTime() <= from.getTime()) {
    candidate = new Date(y, m + 1, day, h, mi, s, 0);
  }
  return candidate;
}

@Injectable()
export class RoomBillingService {
  private readonly log = new Logger(RoomBillingService.name);
  private busy = false;

  constructor(
    private prisma: PrismaService,
    private points: PointsService,
    private adminLog: AdminLogService,
  ) {}

  /** 每小时整点扫描，匹配「下次扣费」里的时间 */
  @Cron('5 * * * *', { timeZone: 'Asia/Shanghai' })
  async hourlyBill() {
    if (this.busy) return;
    this.busy = true;
    try {
      const n = await this.runDueBills();
      if (n.ok || n.frozen) {
        this.log.log(`room billing: ok=${n.ok} frozen=${n.frozen} skip=${n.skip}`);
      }
    } catch (e) {
      this.log.warn(`room billing failed: ${(e as Error).message}`);
    } finally {
      this.busy = false;
    }
  }

  /** 供手动触发 / 测试 */
  async runDueBills() {
    const now = new Date();
    const due = await this.prisma.room.findMany({
      where: {
        monthlyFee: { gt: 0 },
        nextBillAt: { lte: now },
        status: { not: 'CLOSED' },
        ownerAgentId: { not: null },
        /** 信用盘不走余额月费（代理余额恒为 0） */
        bookMode: { not: 'CREDIT' },
      },
      include: {
        ownerAgent: { select: { id: true, userId: true } },
      },
      take: 500,
    });

    let ok = 0;
    let frozen = 0;
    let skip = 0;
    const sysOp = await this.systemOperatorId();

    for (const room of due) {
      const fee = asMoney(room.monthlyFee);
      if (fee <= 0 || !room.ownerAgent || room.bookMode === 'CREDIT' || !room.nextBillAt) {
        skip += 1;
        continue;
      }
      const agentUserId = room.ownerAgent.userId;
      /** 幂等键绑定本账期 nextBillAt 全文，避免同日多期撞键 */
      const periodKey = room.nextBillAt.toISOString();
      const idemBase = `room_bill_${room.id}_${periodKey}`;
      const dueAt = room.nextBillAt;

      try {
        const result = await this.prisma.$transaction(async (tx) => {
          /* 行锁 + 再读：防止多实例同时扣同一账期 */
          await tx.$executeRaw`SELECT 1 FROM "Room" WHERE id = ${room.id} FOR UPDATE`;
          const fresh = await tx.room.findUnique({
            where: { id: room.id },
            select: {
              id: true,
              name: true,
              roomNo: true,
              status: true,
              billingDay: true,
              monthlyFee: true,
              nextBillAt: true,
              bookMode: true,
            },
          });
          if (
            !fresh
            || fresh.bookMode === 'CREDIT'
            || asMoney(fresh.monthlyFee) <= 0
            || !fresh.nextBillAt
            || fresh.nextBillAt.getTime() > now.getTime()
            || fresh.nextBillAt.getTime() !== dueAt.getTime()
            || fresh.status === 'CLOSED'
          ) {
            return { kind: 'skip' as const };
          }

          const billFee = asMoney(fresh.monthlyFee);
          const acc = await tx.pointsAccount.findUnique({
            where: this.points.accountWhere('AGENT', agentUserId),
          });
          const bal = asMoney(acc?.balance ?? 0);
          if (bal < billFee) {
            return { kind: 'insufficient' as const, balance: bal, status: fresh.status };
          }

          await this.points.transferInTx(
            tx,
            {
              type: 'AGENT',
              id: agentUserId,
              remark: `房间月费「${fresh.name}」`,
              idempotencyKey: `${idemBase}:OUT`,
            },
            {
              type: 'PLATFORM',
              id: PLATFORM_OWNER_ID,
              remark: `房间月费「${fresh.name}」`,
              idempotencyKey: `${idemBase}:IN`,
            },
            billFee,
            {
              bizType: 'FEE',
              refType: 'room_monthly',
              refId: fresh.id,
              remark: `房间月费「${fresh.name}」`,
            },
          );

          const billedAt = now;
          const next = computeNextBillAt(billedAt, fresh.billingDay, fresh.nextBillAt);
          /* CAS：仅当账期仍是本轮占住的 nextBillAt 时推进 */
          const advanced = await tx.room.updateMany({
            where: { id: fresh.id, nextBillAt: dueAt },
            data: {
              lastBilledAt: billedAt,
              nextBillAt: next,
              status: fresh.status === 'FROZEN' ? 'OPEN' : fresh.status,
            },
          });
          if (advanced.count === 0) {
            throw new Error('账期已被其他实例推进，回滚本笔月费');
          }

          if (sysOp) {
            await this.adminLog.logInTx(tx, sysOp, 'ROOM_BILL_OK', fresh.id, {
              roomNo: fresh.roomNo,
              fee: billFee,
              agentUserId,
              nextBillAt: next,
              unfroze: fresh.status === 'FROZEN',
              periodKey,
            });
          }

          return { kind: 'ok' as const, next };
        });

        if (result.kind === 'skip') {
          skip += 1;
          continue;
        }

        if (result.kind === 'insufficient') {
          if (result.status !== 'FROZEN') {
            await this.prisma.room.update({
              where: { id: room.id },
              data: { status: 'FROZEN' },
            });
          }
          if (sysOp) {
            await this.adminLog.log(sysOp, 'ROOM_BILL_FREEZE', room.id, {
              roomNo: room.roomNo,
              name: room.name,
              fee,
              balance: result.balance,
              agentUserId,
              message: '代理账户余额不足，房间已冻结；请充值后系统将自动扣费并解冻',
            });
          }
          frozen += 1;
          continue;
        }

        ok += 1;
      } catch (e) {
        this.log.warn(`bill room=${room.id}: ${(e as Error).message}`);
        skip += 1;
      }
    }

    return { ok, frozen, skip };
  }

  private async systemOperatorId() {
    const admin = await this.prisma.user.findFirst({
      where: { role: 'ADMIN', status: 'ACTIVE' },
      select: { id: true },
      orderBy: { createdAt: 'asc' },
    });
    return admin?.id ?? null;
  }
}
