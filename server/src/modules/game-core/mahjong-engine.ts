import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import {
  type MahjongActiveSessionDTO,
  type MahjongSpinRequestDTO,
  type MahjongSpinResultDTO,
} from '@gamebox/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { RiskService } from '../risk/risk.service';
import { businessNo } from './business-id';
import { deriveRandom, genServerSeed } from './fairness.util';
import { GameConfigCache } from './game-config.cache';
import { generateMahjongOutcome, type MahjongConfig } from './mahjong-math';
import { SettlementKernel } from './settlement-kernel';

const GAME_CODE = 'slots-mahjong';
const KEY = 'mahjong';

@Injectable()
export class MahjongEngine {
  constructor(
    private prisma: PrismaService,
    private configCache: GameConfigCache,
    private risk: RiskService,
    private settle: SettlementKernel,
  ) {}

  async spin(
    playerId: string,
    request: MahjongSpinRequestDTO,
  ): Promise<MahjongSpinResultDTO> {
    const clientRequestId = this.settle.assertClientRequestId(request.clientRequestId);

    const replay = await this.findReplay(playerId, clientRequestId);
    if (replay) return replay;

    const game = await this.configCache.get(GAME_CODE);
    const config = game?.configs[0];
    if (!game || game.status !== 'ONLINE' || !config) {
      throw new NotFoundException('麻将胡了未上线或未配置');
    }

    const feature = request.sessionId
      ? await this.prisma.slotFeatureSession.findUnique({ where: { id: request.sessionId } })
      : null;
    const isFree = Boolean(request.sessionId);
    if (isFree) {
      if (
        !feature ||
        feature.playerId !== playerId ||
        feature.gameId !== game.id ||
        feature.status !== 'ACTIVE' ||
        feature.spinsRemaining <= 0 ||
        feature.expiresAt <= new Date()
      ) {
        throw new BadRequestException('免费旋转会话无效或已结束');
      }
    } else {
      /* 付费局前若仍有未完成免费会话，禁止开新局，避免并存多个 ACTIVE */
      const activeFree = await this.prisma.slotFeatureSession.findFirst({
        where: {
          playerId,
          gameId: game.id,
          status: 'ACTIVE',
          spinsRemaining: { gt: 0 },
          expiresAt: { gt: new Date() },
        },
        select: { id: true },
      });
      if (activeFree) {
        throw new BadRequestException('请先完成免费旋转');
      }
    }

    const amount = isFree ? feature!.lockedBetAmount : request.amount;
    if (!Number.isInteger(amount) || amount < game.minBet || amount > game.maxBet) {
      throw new BadRequestException(`下注额须为 ${game.minBet}~${game.maxBet} 的整数`);
    }

    const { seed: serverSeed, hash: serverSeedHash } = genServerSeed();
    const clientSeed = request.clientSeed?.slice(0, 128) || clientRequestId;
    const generated = this.generateOutcome(
      serverSeed,
      clientSeed,
      amount,
      isFree,
      config.payTable as MahjongConfig,
    );
    const player = await this.prisma.user.findUnique({
      where: { id: playerId },
      select: { id: true, agentPath: true },
    });

    const result = await this.prisma.$transaction(async (tx) => {
      if (feature) {
        const claimed = await tx.slotFeatureSession.updateMany({
          where: {
            id: feature.id,
            playerId,
            status: 'ACTIVE',
            version: feature.version,
            spinsRemaining: { gt: 0 },
            expiresAt: { gt: new Date() },
          },
          data: {
            spinsRemaining: { decrement: 1 },
            version: { increment: 1 },
          },
        });
        if (claimed.count === 0) throw new BadRequestException('免费旋转已被使用，请刷新状态');
      }

      const round = await tx.gameRound.create({
        data: {
          roundNo: businessNo('MJR'),
          gameId: game.id,
          category: 'SLOT',
          playerId,
          configVer: config.version,
          state: 'PLAYING',
          serverSeed,
          serverSeedHash,
          clientSeed,
          nonce: generated.nonce,
        },
      });
      const bet = await tx.bet.create({
        data: {
          betNo: businessNo('MJB'),
          clientRequestId,
          playerId,
          gameId: game.id,
          roundId: round.id,
          betType: isFree ? 'FREE_SPIN' : 'SPIN',
          amount: isFree ? 0 : amount,
          status: 'PENDING',
        },
      });

      if (!isFree) {
        await this.settle.debitBetInTx(tx, {
          playerId,
          roundId: round.id,
          amount,
          gameName: game.name,
          keyPrefix: KEY,
        });
      }

      const { paid: totalWin } = await this.settle.creditWinInTx(tx, {
        playerId,
        roundId: round.id,
        betId: bet.id,
        amount: generated.totalWin,
        remark: `${game.name} 派彩`,
        keyPrefix: KEY,
        /* 免费局 amount 已是会话锁定注额，封顶线与付费局一致 */
        stake: amount,
      });

      if (!isFree) {
        await this.settle.applyCommissionInTx(tx, player, amount, round.id);
      }

      const freeSpin = await this.updateFeatureSession(
        tx,
        playerId,
        game.id,
        feature?.id,
        amount,
        generated.spinsAwarded,
        totalWin,
      );
      const spinType = isFree ? 'FREE' as const : 'BASE' as const;
      const outcome = {
        initialGrid: generated.initialGrid,
        cascades: generated.cascades,
        totalWin,
        spinType,
        chargedAmount: amount,
        freeSpin,
      };
      await tx.bet.update({
        where: { id: bet.id },
        data: {
          status: totalWin > 0 ? 'WON' : 'LOST',
          payout: totalWin,
          multiplier: amount > 0 ? totalWin / amount : 0,
          odds: amount > 0 ? totalWin / amount : 0,
          validFlow: isFree ? 0 : amount,
          settledAt: new Date(),
          payload: { sessionId: feature?.id, spinType: isFree ? 'FREE' : 'BASE' },
        },
      });
      await tx.gameRound.update({
        where: { id: round.id },
        data: {
          state: 'SETTLED',
          totalFlow: isFree ? 0 : amount,
          endedAt: new Date(),
          outcome: outcome as unknown as Prisma.InputJsonValue,
        },
      });
      return {
        roundId: round.id,
        betId: bet.id,
        ...outcome,
        chargedAmount: amount,
        serverSeed,
        serverSeedHash,
      };
    });

    const balance = await this.settle.getBalance(playerId);
    const full = { ...result, balance };

    if (full.totalWin >= Math.max(amount * 50, 100_000)) {
      await this.risk.record({
        type: 'BIG_WIN',
        level: full.totalWin >= 1_000_000 ? 'CRITICAL' : 'WARN',
        targetId: full.roundId,
        detail: { playerId, gameCode: GAME_CODE, amount, payout: full.totalWin },
      });
    }
    return full;
  }

  private async findReplay(
    playerId: string,
    clientRequestId: string,
  ): Promise<MahjongSpinResultDTO | null> {
    const bet = await this.settle.findSettledByClientRequestId(playerId, clientRequestId);
    if (!bet?.round?.outcome) return null;
    const outcome = bet.round.outcome as unknown as Omit<
      MahjongSpinResultDTO,
      'roundId' | 'betId' | 'balance' | 'serverSeed' | 'serverSeedHash'
    >;
    const chargedAmount =
      typeof (outcome as { chargedAmount?: number }).chargedAmount === 'number'
        ? (outcome as { chargedAmount: number }).chargedAmount
        : bet.amount;
    return {
      roundId: bet.round.id,
      betId: bet.id,
      balance: await this.settle.getBalance(playerId),
      serverSeed: bet.round.serverSeed ?? '',
      serverSeedHash: bet.round.serverSeedHash ?? '',
      ...outcome,
      chargedAmount,
    };
  }

  /** 恢复未完成的免费旋转会话（刷新续玩） */
  async getActiveSession(playerId: string): Promise<MahjongActiveSessionDTO | null> {
    const game = await this.configCache.get(GAME_CODE);
    if (!game) return null;
    const session = await this.prisma.slotFeatureSession.findFirst({
      where: {
        playerId,
        gameId: game.id,
        status: 'ACTIVE',
        spinsRemaining: { gt: 0 },
        expiresAt: { gt: new Date() },
      },
      orderBy: { updatedAt: 'desc' },
    });
    if (!session) return null;
    return {
      sessionId: session.id,
      spinsRemaining: session.spinsRemaining,
      sessionTotalWin: session.totalWin,
      lockedBetAmount: session.lockedBetAmount,
      expiresAt: session.expiresAt.toISOString(),
    };
  }

  private generateOutcome(
    serverSeed: string,
    clientSeed: string,
    amount: number,
    isFree: boolean,
    rawConfig: MahjongConfig,
  ) {
    let nonce = 0;
    const outcome = generateMahjongOutcome({
      amount,
      isFree,
      rawConfig,
      random: () => deriveRandom(serverSeed, clientSeed, ++nonce),
    });
    return { ...outcome, nonce };
  }

  private async updateFeatureSession(
    tx: Prisma.TransactionClient,
    playerId: string,
    gameId: string,
    sessionId: string | undefined,
    lockedBetAmount: number,
    spinsAwarded: number,
    spinWin: number,
  ) {
    if (!sessionId && spinsAwarded <= 0) return undefined;

    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
    let session;
    if (sessionId) {
      session = await tx.slotFeatureSession.update({
        where: { id: sessionId },
        data: {
          spinsRemaining: { increment: spinsAwarded },
          totalWin: { increment: spinWin },
          expiresAt,
        },
      });
    } else {
      /* 创建前收口其它 ACTIVE，保证每玩家每游戏最多一个有效免费会话 */
      await tx.slotFeatureSession.updateMany({
        where: { playerId, gameId, status: 'ACTIVE' },
        data: { status: 'COMPLETED' },
      });
      session = await tx.slotFeatureSession.create({
        data: {
          playerId,
          gameId,
          feature: 'FREE_SPIN',
          lockedBetAmount,
          spinsRemaining: spinsAwarded,
          totalWin: 0,
          expiresAt,
        },
      });
    }

    const completed = session.spinsRemaining <= 0
      ? await tx.slotFeatureSession.update({
          where: { id: session.id },
          data: { status: 'COMPLETED' },
        })
      : session;
    return {
      sessionId: completed.id,
      triggered: !sessionId && spinsAwarded > 0,
      retriggered: Boolean(sessionId && spinsAwarded > 0),
      spinsAwarded,
      spinsRemaining: completed.spinsRemaining,
      sessionTotalWin: completed.totalWin,
      lockedBetAmount: completed.lockedBetAmount,
    };
  }
}
