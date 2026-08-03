import { Injectable, Logger } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import type { RiskLevel } from './risk.types';

export interface RiskEventInput {
  type: string;
  level?: RiskLevel;
  targetId?: string;
  detail?: Record<string, unknown>;
  /** 去重指纹；同 type+target+fingerprint 在窗口内只记一次 */
  fingerprint?: string;
  /** 去重窗口毫秒，默认 6 小时 */
  dedupeMs?: number;
}

@Injectable()
export class RiskService {
  private readonly logger = new Logger(RiskService.name);

  constructor(private prisma: PrismaService) {}

  async record(input: RiskEventInput): Promise<void> {
    try {
      await this.recordInTx(this.prisma, input);
    } catch (error) {
      // 风控写入不能破坏资金主事务，但必须留下可观测日志。
      this.logger.error('写入风控事件失败', error instanceof Error ? error.stack : String(error));
    }
  }

  async recordInTx(
    tx: Prisma.TransactionClient | PrismaService,
    input: RiskEventInput,
  ): Promise<void> {
    if (input.fingerprint && input.targetId) {
      const since = new Date(Date.now() - (input.dedupeMs ?? 6 * 3600_000));
      const exists = await tx.riskEvent.findFirst({
        where: {
          type: input.type,
          targetId: input.targetId,
          createdAt: { gte: since },
          detail: {
            path: ['fingerprint'],
            equals: input.fingerprint,
          },
        },
        select: { id: true },
      });
      if (exists) return;
    }

    const detail = {
      ...(input.detail ?? {}),
      ...(input.fingerprint ? { fingerprint: input.fingerprint } : {}),
    };

    await tx.riskEvent.create({
      data: {
        type: input.type,
        level: input.level ?? 'INFO',
        targetId: input.targetId,
        detail: detail as Prisma.InputJsonValue,
      },
    });
  }
}
