import { Injectable, Logger } from '@nestjs/common';
import { asMoney } from '@gamebox/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { isPrivateOrLocalIp } from '../../common/utils/client-ip';
import { oppositeHedgeSides } from '../table/table-risk';
import { RiskService } from './risk.service';
import { RISK_TYPES } from './risk.types';

@Injectable()
export class RiskDetectorService {
  private readonly logger = new Logger(RiskDetectorService.name);

  constructor(
    private prisma: PrismaService,
    private risk: RiskService,
  ) {}

  /** 登录后：写 lastLoginIp，并检测同公网 IP 多玩家号 */
  async onPlayerLogin(userId: string, ip: string | null): Promise<void> {
    try {
      if (!ip) {
        await this.prisma.user.update({
          where: { id: userId },
          data: { lastLoginAt: new Date() },
        });
        return;
      }

      await this.prisma.user.update({
        where: { id: userId },
        data: { lastLoginAt: new Date(), lastLoginIp: ip },
      });

      if (isPrivateOrLocalIp(ip)) return;

      const me = await this.prisma.user.findUnique({
        where: { id: userId },
        select: { id: true, role: true, uid: true, nickname: true },
      });
      if (!me || me.role !== 'PLAYER') return;

      const peers = await this.prisma.user.findMany({
        where: {
          role: 'PLAYER',
          lastLoginIp: ip,
          id: { not: userId },
          status: { not: 'DISABLED' },
        },
        select: { id: true, uid: true, nickname: true, lastLoginAt: true },
        take: 20,
        orderBy: { lastLoginAt: 'desc' },
      });
      if (peers.length === 0) return;

      const level = peers.length >= 3 ? 'CRITICAL' : 'WARN';
      await this.risk.record({
        type: RISK_TYPES.SAME_IP,
        level,
        targetId: userId,
        fingerprint: `ip:${ip}`,
        dedupeMs: 24 * 3600_000,
        detail: {
          ip,
          player: { id: me.id, uid: me.uid, nickname: me.nickname },
          peerCount: peers.length,
          peers: peers.map((p) => ({
            id: p.id,
            uid: p.uid,
            nickname: p.nickname,
            lastLoginAt: p.lastLoginAt,
          })),
          summary: `IP ${ip} 另有 ${peers.length} 个玩家号近期登录`,
        },
      });
    } catch (e) {
      this.logger.warn(`onPlayerLogin 风控失败: ${e instanceof Error ? e.message : e}`);
    }
  }

  /**
   * 玩家下分后：上分→低流水→快速下分 ⇒ 疑似刷分/套额度
   * 上分来源：控制台上分 + 审核通过的上分申请
   */
  async onPlayerDebit(playerId: string, debitAmount: number): Promise<void> {
    try {
      const windowMs = 2 * 3600_000;
      const since = new Date(Date.now() - windowMs);

      const [consoleCredits, rechargeUps] = await Promise.all([
        this.prisma.adminLog.findMany({
          where: {
            action: 'CONSOLE_CREDIT',
            target: playerId,
            createdAt: { gte: since },
          },
          select: { detail: true, createdAt: true },
          orderBy: { createdAt: 'asc' },
          take: 50,
        }),
        this.prisma.rechargeOrder.findMany({
          where: {
            playerId,
            type: 'UP',
            status: 'APPROVED',
            reviewedAt: { gte: since },
          },
          select: { amount: true, reviewedAt: true, createdAt: true },
          orderBy: { reviewedAt: 'asc' },
          take: 50,
        }),
      ]);

      const creditEvents: Array<{ amount: number; at: Date }> = [];
      for (const c of consoleCredits) {
        const d = c.detail as { amount?: number } | null;
        creditEvents.push({ amount: Number(d?.amount ?? 0), at: c.createdAt });
      }
      for (const r of rechargeUps) {
        creditEvents.push({
          amount: asMoney(r.amount),
          at: r.reviewedAt ?? r.createdAt,
        });
      }
      creditEvents.sort((a, b) => a.at.getTime() - b.at.getTime());
      if (!creditEvents.length) return;

      let creditSum = 0;
      for (const c of creditEvents) creditSum += c.amount;
      creditSum = asMoney(creditSum);
      if (creditSum <= 0) return;

      const firstCreditAt = creditEvents[0]!.at;
      const flowAgg = await this.prisma.bet.aggregate({
        where: {
          playerId,
          createdAt: { gte: firstCreditAt },
          status: { in: ['WON', 'LOST', 'PENDING'] },
        },
        _sum: { validFlow: true, amount: true },
      });
      const validFlow = asMoney(flowAgg._sum.validFlow ?? flowAgg._sum.amount ?? 0);
      const flowRatio = creditSum > 0 ? validFlow / creditSum : 0;
      const debitRatio = debitAmount / creditSum;

      // 下分 ≥ 上分 40%，且流水不足上分 20%
      if (debitRatio < 0.4 || flowRatio >= 0.2) return;

      const level = flowRatio < 0.05 && debitRatio >= 0.7 ? 'CRITICAL' : 'WARN';
      const player = await this.prisma.user.findUnique({
        where: { id: playerId },
        select: { uid: true, nickname: true },
      });

      await this.risk.record({
        type: RISK_TYPES.SUSPECT_WASH,
        level,
        targetId: playerId,
        fingerprint: `wash:${playerId}:${firstCreditAt.toISOString().slice(0, 13)}`,
        dedupeMs: 6 * 3600_000,
        detail: {
          player: { id: playerId, uid: player?.uid, nickname: player?.nickname },
          creditSum,
          debitAmount,
          validFlow,
          flowRatio: Number(flowRatio.toFixed(4)),
          windowHours: 2,
          summary: `近2小时上分 ${creditSum}，流水仅 ${validFlow}（${(flowRatio * 100).toFixed(1)}%），本次下分 ${debitAmount}`,
        },
      });
    } catch (e) {
      this.logger.warn(`onPlayerDebit 风控失败: ${e instanceof Error ? e.message : e}`);
    }
  }

  /**
   * 桌台下注后：同局对立边、金额接近的不同玩家 ⇒ 疑似对刷
   */
  async onTableBet(input: {
    roundId: string;
    playerId: string;
    side: string;
    amount: number;
    gameCode: string;
    roundNo?: string;
  }): Promise<void> {
    try {
      const opp = oppositeHedgeSides(input.gameCode, input.side);
      if (!opp.length) return;

      const peers = await this.prisma.bet.findMany({
        where: {
          roundId: input.roundId,
          playerId: { not: input.playerId },
          betType: { in: opp },
          status: { in: ['PENDING', 'WON', 'LOST'] },
        },
        select: {
          playerId: true,
          amount: true,
          betType: true,
          player: { select: { uid: true, nickname: true, lastLoginIp: true } },
        },
        take: 30,
      });
      if (!peers.length) return;

      const amount = asMoney(input.amount);
      const hits = peers.filter((p) => {
        const a = asMoney(p.amount);
        if (a <= 0 || amount <= 0) return false;
        const ratio = a > amount ? a / amount : amount / a;
        return ratio <= 2; // 金额相差不超过 2 倍
      });
      if (!hits.length) return;

      const me = await this.prisma.user.findUnique({
        where: { id: input.playerId },
        select: { uid: true, nickname: true, lastLoginIp: true },
      });

      // 取最接近的一条
      hits.sort((a, b) => {
        const da = Math.abs(asMoney(a.amount) - amount);
        const db = Math.abs(asMoney(b.amount) - amount);
        return da - db;
      });
      const peer = hits[0]!;
      const peerAmt = asMoney(peer.amount);
      const sameIp =
        !!me?.lastLoginIp &&
        !!peer.player.lastLoginIp &&
        me.lastLoginIp === peer.player.lastLoginIp &&
        !isPrivateOrLocalIp(me.lastLoginIp);

      const level = sameIp || Math.abs(peerAmt - amount) / Math.max(amount, peerAmt) < 0.1
        ? 'CRITICAL'
        : 'WARN';

      const pairKey = [input.playerId, peer.playerId].sort().join(':');
      await this.risk.record({
        type: RISK_TYPES.COLLUSION,
        level,
        targetId: input.playerId,
        fingerprint: `col:${input.roundId}:${pairKey}`,
        dedupeMs: 24 * 3600_000,
        detail: {
          gameCode: input.gameCode,
          roundId: input.roundId,
          roundNo: input.roundNo,
          sameIp,
          ip: sameIp ? me?.lastLoginIp : undefined,
          a: {
            id: input.playerId,
            uid: me?.uid,
            nickname: me?.nickname,
            side: input.side,
            amount,
          },
          b: {
            id: peer.playerId,
            uid: peer.player.uid,
            nickname: peer.player.nickname,
            side: peer.betType,
            amount: peerAmt,
          },
          summary: `同局对押：${me?.nickname || me?.uid}(${input.side}/${amount}) vs ${peer.player.nickname}(${peer.betType}/${peerAmt})${sameIp ? '，且同 IP' : ''}`,
        },
      });
    } catch (e) {
      this.logger.warn(`onTableBet 风控失败: ${e instanceof Error ? e.message : e}`);
    }
  }
}
