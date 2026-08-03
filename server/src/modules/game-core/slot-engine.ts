/**
 * 电子/街机类游戏结算引擎（SlotEngine）
 *
 * 资金流向（账目守恒）：
 *   下注：PLAYER -bet → PLATFORM +bet
 *   派彩：PLATFORM -payout → PLAYER +payout
 *   佣金：PLATFORM -commission → 各级代理
 *
 * 回水统一由 RebateService 按 Bet.validFlow 日结，引擎内不再发放。
 * 每次 spin = 单事务内完成下注 + 开奖 + 结算；placeBet/settle 保留以实现 IGameEngine 契约。
 */
import {
  Injectable, BadRequestException, NotFoundException,
  Optional, Inject, forwardRef,
} from '@nestjs/common';
import { asMoney, roundMoney, capWin } from '@gamebox/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { PointsService, PLATFORM_OWNER_ID } from '../points/points.service';
import { CommissionService } from '../agents/commission.service';
import { GameConfigCache } from './game-config.cache';
import { genServerSeed, deriveRandom, weightedPick } from './fairness.util';
import type { IGameEngine, PlaceBetInput, SettlementSummary } from './types';
import { businessNo } from './business-id';
import { RiskService } from '../risk/risk.service';
import { SettlementKernel } from './settlement-kernel';
import { ConsoleControlService } from '../console/console-control.service';
import { FlyDiskService } from '../console/fly-disk.service';
import { matchRoomHoldPolicy, pickSeedByHoldTarget } from '../console/control-pick.util';

interface PayItem { label: string; multiplier: number; weight: number; }

@Injectable()
export class SlotEngine implements IGameEngine {
  readonly category = 'SLOT' as const;

  constructor(
    private prisma: PrismaService,
    private points: PointsService,
    private commission: CommissionService,
    private configCache: GameConfigCache,
    private risk: RiskService,
    private kernel: SettlementKernel,
    @Optional() @Inject(forwardRef(() => ConsoleControlService))
    private control?: ConsoleControlService,
    @Optional() private flyDisk?: FlyDiskService,
  ) {}

  /**
   * 单事务 spin：下注 + 开奖 + 派彩 + 佣金一次完成。
   * 任一步失败整体回滚；clientRequestId 幂等回放。
   */
  async spin(input: PlaceBetInput): Promise<SettlementSummary & { roundId: string; balance?: number }> {
    const { playerId, gameCode, amount, clientSeed = 'default' } = input;
    const clientRequestId = this.kernel.assertClientRequestId(input.clientRequestId);
    if (!Number.isInteger(amount) || amount < 1) throw new BadRequestException('下注额无效');

    const replay = await this.replaySpinIfAny(playerId, clientRequestId);
    if (replay) return replay;

    const game = await this.configCache.get(gameCode);
    if (!game || game.status !== 'ONLINE') throw new NotFoundException('游戏不存在或已下架');
    if (amount < asMoney(game.minBet) || amount > asMoney(game.maxBet)) {
      throw new BadRequestException(`下注额须在 ${asMoney(game.minBet)}~${asMoney(game.maxBet)} 之间`);
    }

    const config = game.configs[0];
    if (!config) throw new BadRequestException('游戏未配置 payTable');
    const payTable = config.payTable as unknown as PayItem[];
    const weights = payTable.map(p => p.weight);

    const house = this.flyDisk
      ? await this.flyDisk.resolveHouse(playerId)
      : null;
    const policies = this.control
      ? await this.control.getActiveHoldPolicies(gameCode)
      : [];
    const policy = matchRoomHoldPolicy(policies, house?.roomId);
    const picked = pickSeedByHoldTarget({
      policy,
      stake: amount,
      gen: () => {
        const g = genServerSeed();
        return { seed: g.seed, hash: g.hash };
      },
      simulate: (seed) => {
        const rnd = deriveRandom(seed, clientSeed, 1);
        const idx = weightedPick(weights, rnd);
        const prize = payTable[idx]!;
        const rawPayout = roundMoney(amount * prize.multiplier);
        const payout = capWin(amount, rawPayout).win;
        return { payout, rnd, idx, prize };
      },
    });
    const { seed: serverSeed, hash: serverSeedHash, rnd, idx, prize } = picked;
    const flyPayload = house
      ? {
          type: house.type,
          id: house.id,
          flying: house.flying,
          roomId: house.roomId,
          agentUserId: house.agentUserId,
        }
      : undefined;

    const player = await this.prisma.user.findUnique({
      where: { id: playerId },
      select: { id: true, agentPath: true },
    });

    const result = await this.prisma.$transaction(async (tx) => {
      const roundNo = businessNo('R');
      const round = await tx.gameRound.create({
        data: {
          roundNo, gameId: game.id, category: 'SLOT',
          playerId, configVer: config.version,
          state: 'PLAYING', serverSeed, serverSeedHash, clientSeed, nonce: 1,
        },
      });
      const bet = await tx.bet.create({
        data: {
          betNo: businessNo('B'),
          clientRequestId,
          playerId, gameId: game.id, roundId: round.id,
          amount, betType: 'SPIN', status: 'PENDING',
          ...(flyPayload ? { payload: { fly: flyPayload } as never } : {}),
        },
      });

      await this.kernel.debitBetInTx(tx, {
        playerId,
        roundId: round.id,
        amount,
        gameName: game.name,
        keyPrefix: 'slot',
      });

      const rawPayout = roundMoney(amount * prize.multiplier);
      const { paid: payout } = await this.kernel.creditWinInTx(tx, {
        playerId,
        roundId: round.id,
        betId: bet.id,
        amount: rawPayout,
        remark: `${game.name} 命中 ${prize.label}`,
        keyPrefix: 'slot',
        stake: amount,
      });
      const won = payout > 0;

      await tx.bet.update({
        where: { id: bet.id },
        data: {
          status: won ? 'WON' : 'LOST', payout,
          multiplier: prize.multiplier, odds: prize.multiplier,
          validFlow: amount, settledAt: new Date(),
        },
      });

      await this.kernel.applyCommissionInTx(tx, player, amount, round.id);

      await tx.gameRound.update({
        where: { id: round.id },
        data: {
          state: 'SETTLED', endedAt: new Date(), totalFlow: amount,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          outcome: { prize, index: idx, rnd: rnd.toFixed(8) } as any,
        },
      });

      return {
        gameCode: game.code,
        category: 'SLOT' as const,
        refType: 'round' as const,
        refId: round.id,
        roundId: round.id,
        totalFlow: amount,
        outcome: { prize, index: idx },
        bets: [{
          betId: bet.id, playerId, amount, payout,
          multiplier: prize.multiplier, odds: prize.multiplier,
          won, validFlow: amount,
        }],
        serverSeed,
        serverSeedHash,
      };
    });
    const payout = result.bets[0]?.payout ?? 0;
    if (payout >= 100_000) {
      await this.risk.record({
        type: 'BIG_WIN',
        level: payout >= 1_000_000 ? 'CRITICAL' : 'WARN',
        targetId: playerId,
        fingerprint: `bw:${result.roundId}`,
        dedupeMs: 24 * 3600_000,
        detail: {
          playerId,
          gameCode,
          amount,
          payout,
          roundId: result.roundId,
          summary: `${gameCode} 派彩 ${payout}（下注 ${amount}）`,
        },
      });
    }
    try {
      if (this.control) await this.control.refreshGoalExhaustion(gameCode);
    } catch {
      /* 不影响开奖 */
    }
    return { ...result, balance: await this.kernel.getBalance(playerId) };
  }

  private async replaySpinIfAny(
    playerId: string,
    clientRequestId: string,
  ): Promise<(SettlementSummary & { roundId: string; balance: number }) | null> {
    const bet = await this.kernel.findSettledByClientRequestId(playerId, clientRequestId);
    if (!bet?.round?.outcome) return null;
    const outcome = bet.round.outcome as {
      prize?: PayItem;
      index?: number;
    };
    const prize = outcome.prize ?? { label: '?', multiplier: bet.multiplier ?? 0, weight: 0 };
    return {
      gameCode: bet.game?.code ?? '',
      category: 'SLOT',
      refType: 'round',
      refId: bet.round.id,
      roundId: bet.round.id,
      totalFlow: asMoney(bet.amount),
      outcome: { prize, index: outcome.index ?? 0 },
      bets: [{
        betId: bet.id,
        playerId,
        amount: asMoney(bet.amount),
        payout: asMoney(bet.payout),
        multiplier: bet.multiplier ?? prize.multiplier,
        odds: bet.odds ?? prize.multiplier,
        won: asMoney(bet.payout) > 0,
        validFlow: asMoney(bet.validFlow || bet.amount),
      }],
      serverSeed: bet.round.serverSeed ?? undefined,
      serverSeedHash: bet.round.serverSeedHash ?? undefined,
      balance: await this.kernel.getBalance(playerId),
    };
  }

  async placeBet(input: PlaceBetInput): Promise<{ betId: string; roundId: string }> {
    const { playerId, gameCode, amount, clientSeed = 'default' } = input;
    if (!Number.isInteger(amount) || amount < 1) throw new BadRequestException('下注额无效');

    const game = await this.prisma.game.findUnique({
      where: { code: gameCode },
      include: { configs: { where: { active: true }, take: 1 } },
    });
    if (!game || game.status !== 'ONLINE') throw new NotFoundException('游戏不存在或已下架');
    if (amount < asMoney(game.minBet) || amount > asMoney(game.maxBet)) {
      throw new BadRequestException(`下注额须在 ${asMoney(game.minBet)}~${asMoney(game.maxBet)} 之间`);
    }
    const config = game.configs[0];
    if (!config) throw new BadRequestException('游戏未配置');

    const { seed: serverSeed, hash: serverSeedHash } = genServerSeed();

    return this.prisma.$transaction(async (tx) => {
      const round = await tx.gameRound.create({
        data: {
          roundNo: businessNo('R'),
          gameId: game.id,
          category: 'SLOT',
          playerId,
          configVer: config.version,
          state: 'PLAYING',
          serverSeed,
          serverSeedHash,
          clientSeed,
          nonce: 1,
        },
      });
      const bet = await tx.bet.create({
        data: {
          betNo: businessNo('B'),
          playerId,
          gameId: game.id,
          roundId: round.id,
          amount,
          betType: 'SPIN',
          status: 'PENDING',
        },
      });
      await this.points.transferInTx(
        tx,
        {
          type: 'PLAYER', id: playerId,
          remark: `下注 ${game.name}`, idempotencyKey: `bet_player_${bet.id}`,
        },
        {
          type: 'PLATFORM', id: PLATFORM_OWNER_ID,
          remark: `${game.name} 注资`, idempotencyKey: `bet_plat_${bet.id}`,
        },
        amount,
        { bizType: 'BET', refType: 'round', refId: round.id },
      );
      return { betId: bet.id, roundId: round.id };
    });
  }

  async settle(refId: string): Promise<SettlementSummary> {
    const round = await this.prisma.gameRound.findUnique({
      where: { id: refId },
      include: {
        game: true,
        bets: { where: { status: 'PENDING' }, include: { player: { select: { id: true, agentPath: true } } } },
      },
    });
    if (!round) throw new NotFoundException('局不存在');
    if (round.state === 'SETTLED') throw new BadRequestException('局已结算');

    const config = await this.prisma.gameConfig.findUnique({
      where: { gameId_version: { gameId: round.gameId, version: round.configVer } },
    });
    if (!config) throw new BadRequestException('配置缺失');
    const payTable = config.payTable as unknown as PayItem[];
    const weights = payTable.map(p => p.weight);
    const clientSeed = round.clientSeed || 'default';
    const serverSeed = round.serverSeed!;
    const rnd = deriveRandom(serverSeed, clientSeed, round.nonce);
    const idx = weightedPick(weights, rnd);
    const prize = payTable[idx];

    const result = await this.prisma.$transaction(async (tx) => {
      const summaries: SettlementSummary['bets'] = [];
      let totalFlow = 0;
      for (const bet of round.bets) {
        const amt = asMoney(bet.amount);
        totalFlow = roundMoney(totalFlow + amt);
        const rawPayout = roundMoney(amt * prize.multiplier);
        const { paid: payout } = await this.kernel.creditWinInTx(tx, {
          playerId: bet.playerId,
          roundId: round.id,
          betId: bet.id,
          amount: rawPayout,
          remark: `${round.game.name} 命中 ${prize.label}`,
          keyPrefix: 'slot',
          stake: amt,
        });
        const won = payout > 0;
        await tx.bet.update({
          where: { id: bet.id },
          data: {
            status: won ? 'WON' : 'LOST',
            payout,
            odds: prize.multiplier,
            multiplier: prize.multiplier,
            validFlow: amt,
            settledAt: new Date(),
          },
        });
        if (bet.player?.agentPath) {
          await this.commission.distributeInTx(tx, bet.player, amt, round.id);
        }
        summaries.push({
          betId: bet.id,
          playerId: bet.playerId,
          amount: amt,
          payout,
          multiplier: prize.multiplier,
          odds: prize.multiplier,
          won,
          validFlow: amt,
        });
      }
      await tx.gameRound.update({
        where: { id: round.id },
        data: {
          state: 'SETTLED',
          endedAt: new Date(),
          totalFlow,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          outcome: { prize, index: idx, rnd: rnd.toFixed(8) } as any,
        },
      });
      return {
        gameCode: round.game.code,
        category: 'SLOT' as const,
        refType: 'round' as const,
        refId: round.id,
        totalFlow,
        outcome: { prize, index: idx },
        bets: summaries,
        serverSeed,
        serverSeedHash: round.serverSeedHash ?? undefined,
      };
    });
    return result;
  }
}
