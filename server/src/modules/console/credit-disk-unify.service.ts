import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { PointsService } from '../points/points.service';
import { unifyCreditAgentDiskInTx } from './player-fund.helper';

/**
 * 启动时把旧信用盘「剩余信用 + 佣金袋」收成一本盘分。
 * 已同步的跳过；幂等键 credit_disk_unify:{userId}。
 */
@Injectable()
export class CreditDiskUnifyService implements OnModuleInit {
  private readonly logger = new Logger(CreditDiskUnifyService.name);

  constructor(
    private prisma: PrismaService,
    private points: PointsService,
  ) {}

  async onModuleInit() {
    const ids = new Set<string>();
    const [rooms, creditAgents] = await Promise.all([
      this.prisma.room.findMany({
        where: { bookMode: 'CREDIT' },
        select: {
          ownerAgent: { select: { userId: true } },
          generalAgent: { select: { userId: true } },
        },
      }),
      this.prisma.agent.findMany({
        where: { bookMode: 'CREDIT' },
        select: { userId: true },
      }),
    ]);
    for (const r of rooms) {
      if (r.ownerAgent?.userId) ids.add(r.ownerAgent.userId);
      if (r.generalAgent?.userId) ids.add(r.generalAgent.userId);
    }
    for (const a of creditAgents) ids.add(a.userId);
    if (!ids.size) return;

    let folded = 0;
    for (const userId of ids) {
      try {
        const changed = await this.prisma.$transaction((tx) =>
          unifyCreditAgentDiskInTx(tx, this.points, userId),
        );
        if (changed) folded += 1;
      } catch (err) {
        this.logger.error(`信用盘并账失败 ${userId}: ${(err as Error).message}`);
      }
    }
    if (folded) {
      this.logger.log(`信用盘并账完成：${folded}/${ids.size} 个账户把佣金袋并进盘分`);
    }
  }
}
