/**
 * 飞盘流水返水：
 * - 飞盘：从 ROOM 即时划 agentShare=flow*(T-P) 给代理
 * - 玩家份额 flow*P 在领取自助回水时按注单上的 P/出资方划转（见 RebateService）
 */
import { Injectable, Logger } from '@nestjs/common';
import { roundMoney } from '@gamebox/shared';
import type { Prisma } from '@prisma/client';
import { PointsService } from '../points/points.service';
import { FlyDiskService } from './fly-disk.service';

@Injectable()
export class FlyRebateService {
  private readonly log = new Logger(FlyRebateService.name);

  constructor(
    private points: PointsService,
    private fly: FlyDiskService,
  ) {}

  /** 局结后给代理即时返水（仅飞盘流水） */
  async payAgentShareInTx(
    tx: Prisma.TransactionClient,
    opts: {
      betId: string;
      playerId: string;
      validFlow: number;
      flying: boolean;
      roomId?: string;
      agentUserId?: string;
    },
  ) {
    const flow = roundMoney(opts.validFlow);
    if (flow <= 0 || !opts.flying || !opts.roomId || !opts.agentUserId) return;

    const { A } = await this.fly.resolvePlayerRate(opts.playerId, opts.roomId);
    const agentShare = roundMoney(flow * A);
    if (agentShare <= 0) return;

    try {
      await this.points.transferInTx(
        tx,
        {
          type: 'ROOM',
          id: opts.roomId,
          idempotencyKey: `fly_rebate_agent_out_${opts.betId}`,
        },
        {
          type: 'AGENT',
          id: opts.agentUserId,
          idempotencyKey: `fly_rebate_agent_in_${opts.betId}`,
        },
        agentShare,
        {
          bizType: 'REBATE',
          refType: 'bet',
          refId: opts.betId,
          remark: `飞盘返水代理 ${(A * 100).toFixed(2)}%`,
        },
      );
    } catch (e) {
      this.log.warn(`agent rebate failed bet=${opts.betId}: ${(e as Error).message}`);
    }
  }
}
