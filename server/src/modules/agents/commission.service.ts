import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Prisma } from '@prisma/client';
import { roundMoney } from '@gamebox/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { PointsService, PLATFORM_OWNER_ID } from '../points/points.service';

/**
 * 多级代理分润。
 * 当一笔有效流水产生后，沿玩家的代理链向上逐级分润：
 *   玩家 → 直属代理(level1) → 上级(level2) → ... 直到 COMMISSION_MAX_LEVEL
 * 每级按其佣金率从平台账户出账，写 CommissionRecord + 账本流水（幂等）。
 *
 * 代理链来源：User.agentPath（物化路径，形如 "/p_id/b_id/a_id/"）。
 */
@Injectable()
export class CommissionService {
  constructor(
    private prisma: PrismaService,
    private points: PointsService,
    private cfg: ConfigService,
  ) {}

  /** 解析 agentPath 得到从直属到顶层的祖先 userId 列表 */
  private parseAncestors(agentPath: string): string[] {
    return agentPath.split('/').filter(Boolean).reverse(); // 直属在前
  }

  /**
   * 对一笔有效流水分润（在结算事务内调用）。
   * @param tx        外部事务
   * @param sourceUser 产生流水的下线（含 agentPath）
   * @param validFlow  有效流水
   * @param refRoundId 关联 GameRound（可空，外键约束仅接受 GameRound id）
   * @param idemScope  幂等作用域；彩票等非 GameRound 来源必须传唯一值（如 bet.id），
   *                   否则同一玩家的后续分润会被幂等机制跳过
   */
  async distributeInTx(
    tx: Prisma.TransactionClient,
    sourceUser: { id: string; agentPath: string },
    validFlow: number,
    refRoundId?: string,
    idemScope?: string,
  ): Promise<void> {
    if (validFlow <= 0) return;
    const maxLevel = Number(this.cfg.get('COMMISSION_MAX_LEVEL') ?? 5);
    const ancestors = this.parseAncestors(sourceUser.agentPath).slice(0, maxLevel);

    const scope = idemScope ?? refRoundId;
    if (!scope) {
      throw new Error('distributeInTx 需要 refRoundId 或 idemScope 之一作为幂等作用域');
    }
    if (ancestors.length === 0) return;

    // 批量预查整条代理链的 agent 与 role，消除逐级 N+1 往返
    const [agents, users] = await Promise.all([
      tx.agent.findMany({
        where: { userId: { in: ancestors } },
        select: { userId: true, commissionRate: true },
      }),
      tx.user.findMany({
        where: { id: { in: ancestors } },
        select: { id: true, role: true },
      }),
    ]);
    const agentMap = new Map(agents.map((a) => [a.userId, a]));
    const roleMap = new Map(users.map((u) => [u.id, u.role]));
    const maxTotalRate = Number(this.cfg.get('COMMISSION_MAX_RATE') ?? 0.2);
    let lowerLevelRate = 0;

    for (let i = 0; i < ancestors.length; i++) {
      const beneficiaryUserId = ancestors[i];
      const agent = agentMap.get(beneficiaryUserId);
      if (!agent || agent.commissionRate <= 0) continue;

      const configuredRate = Math.min(agent.commissionRate, maxTotalRate);
      const differentialRate = Math.max(0, configuredRate - lowerLevelRate);
      lowerLevelRate = Math.max(lowerLevelRate, configuredRate);
      const amount = roundMoney(validFlow * differentialRate);
      if (amount <= 0) continue;

      const key = `commission:${scope}:${sourceUser.id}:${beneficiaryUserId}`;
      const ownerType = this.roleToOwnerType(roleMap.get(beneficiaryUserId));
      // 平台出账 → 代理入账（transferInTx 保证平台侧先加锁）
      const { in: ledger } = await this.points.transferInTx(
        tx,
        { type: 'PLATFORM', id: PLATFORM_OWNER_ID, idempotencyKey: `${key}:OUT` },
        { type: ownerType, id: beneficiaryUserId, idempotencyKey: `${key}:IN` },
        amount,
        { bizType: 'COMMISSION', refType: 'round', refId: refRoundId },
      );

      // 幂等命中（重复结算）时账本未新增，对应记录也必须跳过，否则记录与钱不一致
      const recordExists = await tx.commissionRecord.findFirst({ where: { ledgerId: ledger.id } });
      if (recordExists) continue;

      await tx.commissionRecord.create({
        data: {
          beneficiaryId: beneficiaryUserId,
          sourceUserId: sourceUser.id,
          level: i + 1,
          sourceRoundId: refRoundId,
          baseFlow: validFlow,
          rate: differentialRate,
          amount,
          ledgerId: ledger.id,
        },
      });
    }
  }

  private roleToOwnerType(role?: string): 'BRANCH' | 'AGENT' | 'PROXY' | 'PLAYER' {
    if (role === 'BRANCH') return 'BRANCH';
    if (role === 'PROXY') return 'PROXY';
    if (role === 'PLAYER') return 'PLAYER';
    return 'AGENT';
  }
}
