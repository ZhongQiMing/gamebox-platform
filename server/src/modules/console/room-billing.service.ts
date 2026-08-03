/**
 * 代理房间月费：按小时扫描到期房间（支持精确到分的扣费时间）。
 * - 代理余额足够 → 扣至平台账户，推进 nextBillAt（保留原时分）——同事务
 * - 不足 → 房间改为 FROZEN，写 AdminLog 作「欠费通知」；不推进账期，下轮重试
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
      if (fee <= 0 || !room.ownerAgent) {
        skip += 1;
        continue;
      }
      const agentUserId = room.ownerAgent.userId;
      const periodKey = room.nextBillAt?.toISOString().slice(0, 10) ?? now.toISOString().slice(0, 10);
      const idemBase = `room_bill_${room.id}_${periodKey}`;

      try {
        const result = await this.prisma.$transaction(async (tx) => {
          const acc = await tx.pointsAccount.findUnique({
            where: { ownerId: agentUserId },
          });
          const bal = asMoney(acc?.balance ?? 0);
          if (bal < fee) {
            return { kind: 'insufficient' as const, balance: bal };
          }

          await this.points.transferInTx(
            tx,
            {
              type: 'AGENT',
              id: agentUserId,
              remark: `房间月费「${room.name}」`,
              idempotencyKey: `${idemBase}:OUT`,
            },
            {
              type: 'PLATFORM',
              id: PLATFORM_OWNER_ID,
              remark: `房间月费「${room.name}」`,
              idempotencyKey: `${idemBase}:IN`,
            },
            fee,
            {
              bizType: 'FEE',
              refType: 'room_monthly',
              refId: room.id,
              remark: `房间月费「${room.name}」`,
            },
          );

          const billedAt = now;
          const next = computeNextBillAt(
            billedAt,
            room.billingDay,
            room.nextBillAt ?? billedAt,
          );
          await tx.room.update({
            where: { id: room.id },
            data: {
              lastBilledAt: billedAt,
              nextBillAt: next,
              status: room.status === 'FROZEN' ? 'OPEN' : room.status,
            },
          });

          if (sysOp) {
            await this.adminLog.logInTx(tx, sysOp, 'ROOM_BILL_OK', room.id, {
              roomNo: room.roomNo,
              fee,
              agentUserId,
              nextBillAt: next,
              unfroze: room.status === 'FROZEN',
            });
          }

          return { kind: 'ok' as const, next };
        });

        if (result.kind === 'insufficient') {
          if (room.status !== 'FROZEN') {
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
