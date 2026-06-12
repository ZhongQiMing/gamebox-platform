/**
 * 电子/街机类游戏结算引擎（SlotEngine）
 *
 * 资金流向（账目守恒）：
 *   下注：PLAYER -bet → PLATFORM +bet     （玩家把钱押入平台池）
 *   派彩：PLATFORM -payout → PLAYER +payout（平台池派彩给玩家）
 *   抽水：平台池里的利润自然留存（无需额外划账，payout < bet × 期望 → 平台净赚）
 *   佣金：PLATFORM -commission → 各级代理  （从平台池里分给代理链）
 *   回水：PLATFORM -rebate → PLAYER        （按有效流水返还一小部分给玩家）
 *
 * 每次 spin = placeBet + settle（合并，客户端一次调用）。
 */
import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { PointsService, PLATFORM_OWNER_ID } from '../points/points.service';
import { CommissionService } from '../agents/commission.service';
import { genServerSeed, deriveRandom, weightedPick } from './fairness.util';
import type { IGameEngine, PlaceBetInput, SettlementSummary } from './types';

interface PayItem { label: string; multiplier: number; weight: number; }

/** 默认回水率（有效流水的 0.5%） */
const REBATE_RATE = 0.005;

@Injectable()
export class SlotEngine implements IGameEngine {
  readonly category = 'SLOT' as const;

  constructor(
    private prisma: PrismaService,
    private points: PointsService,
    private commission: CommissionService,
  ) {}

  async placeBet(input: PlaceBetInput): Promise<{ betId: string; roundId: string }> {
    const { playerId, gameCode, amount, clientSeed = 'default' } = input;
    if (!Number.isInteger(amount) || amount < 1) throw new BadRequestException('下注额无效');

    const game = await this.prisma.game.findUnique({
      where: { code: gameCode },
      include: { configs: { where: { active: true }, take: 1 } },
    });
    if (!game || game.status !== 'ONLINE') throw new NotFoundException('游戏不存在或已下架');
    if (amount < game.minBet || amount > game.maxBet) {
      throw new BadRequestException(`下注额须在 ${game.minBet}~${game.maxBet} 之间`);
    }

    const { seed: serverSeed, hash: serverSeedHash } = genServerSeed();

    return this.prisma.$transaction(async (tx) => {
      // 玩家押注 → 平台池
      await this.points.creditInTx(tx, 'PLAYER', playerId, -amount, 'BET', {
        refType: 'round', remark: `下注 ${game.name}`,
      });
      await this.points.creditInTx(tx, 'PLATFORM', PLATFORM_OWNER_ID, amount, 'BET', {
        refType: 'round', remark: `${game.name} 注资`,
      });

      const roundNo = `R${Date.now()}${Math.floor(Math.random() * 1000).toString().padStart(3, '0')}`;
      const round = await tx.gameRound.create({
        data: {
          roundNo, gameId: game.id, category: 'SLOT',
          playerId, configVer: game.configs[0]?.version ?? 1,
          state: 'PLAYING', serverSeed, serverSeedHash, clientSeed, nonce: 1,
        },
      });

      const bet = await tx.bet.create({
        data: {
          betNo: `B${Date.now()}`,
          playerId, gameId: game.id, roundId: round.id,
          amount, betType: 'SPIN', status: 'PENDING',
        },
      });

      return { betId: bet.id, roundId: round.id };
    });
  }

  async settle(roundId: string): Promise<SettlementSummary> {
    const round = await this.prisma.gameRound.findUnique({
      where: { id: roundId },
      include: {
        bets: true,
        game: { include: { configs: { where: { active: true }, take: 1 } } },
      },
    });
    if (!round) throw new NotFoundException('局不存在');
    if (round.state !== 'PLAYING') throw new BadRequestException('该局已结算');

    const config = round.game.configs[0];
    if (!config) throw new BadRequestException('游戏未配置 payTable');
    const payTable = config.payTable as unknown as PayItem[];
    const weights = payTable.map(p => p.weight);

    const rnd = deriveRandom(round.serverSeed!, round.clientSeed ?? 'default', round.nonce);
    const idx = weightedPick(weights, rnd);
    const prize = payTable[idx];

    const totalFlow = round.bets.reduce((s, b) => s + b.amount, 0);

    // 取玩家信息（用于佣金分润）
    const player = round.playerId
      ? await this.prisma.user.findUnique({
          where: { id: round.playerId },
          select: { id: true, agentPath: true },
        })
      : null;

    const betResults = await this.prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const results = [];

      for (const bet of round.bets) {
        const payout = Math.floor(bet.amount * prize.multiplier);
        const won = payout > 0;

        if (won) {
          // 平台池 → 玩家
          await this.points.creditInTx(tx, 'PLATFORM', PLATFORM_OWNER_ID, -payout, 'WIN', {
            refType: 'round', refId: roundId,
            idempotencyKey: `win_plat_${bet.id}`,
          });
          await this.points.creditInTx(tx, 'PLAYER', bet.playerId, payout, 'WIN', {
            refType: 'round', refId: roundId,
            remark: `${round.game.name} 命中 ${prize.label}`,
            idempotencyKey: `win_player_${bet.id}`,
          });
        }

        // 回水（平台池 → 玩家，按有效流水百分比）
        const rebateAmt = Math.floor(bet.amount * REBATE_RATE);
        if (rebateAmt > 0) {
          await this.points.creditInTx(tx, 'PLATFORM', PLATFORM_OWNER_ID, -rebateAmt, 'REBATE', {
            refType: 'round', refId: roundId,
            idempotencyKey: `rebate_plat_${bet.id}`,
          });
          const rebateLedger = await this.points.creditInTx(tx, 'PLAYER', bet.playerId, rebateAmt, 'REBATE', {
            refType: 'round', refId: roundId,
            remark: '游戏回水',
            idempotencyKey: `rebate_player_${bet.id}`,
          });
          await tx.rebateRecord.create({
            data: {
              playerId: bet.playerId,
              sourceRoundId: roundId,
              personalFlow: bet.amount,
              rate: REBATE_RATE,
              amount: rebateAmt,
              ledgerId: rebateLedger.id,
            },
          });
        }

        await tx.bet.update({
          where: { id: bet.id },
          data: {
            status: won ? 'WON' : 'LOST',
            payout,
            multiplier: prize.multiplier,
            odds: prize.multiplier,
            validFlow: bet.amount,
            settledAt: new Date(),
          },
        });

        results.push({
          betId: bet.id, playerId: bet.playerId,
          amount: bet.amount, payout, multiplier: prize.multiplier,
          odds: prize.multiplier, won, validFlow: bet.amount,
        });
      }

      // 多级代理佣金（在同一事务内）
      if (player?.agentPath) {
        await this.commission.distributeInTx(tx, player, totalFlow, roundId);
      }

      // 更新局状态，公布种子（可证明公平验证用）
      await tx.gameRound.update({
        where: { id: roundId },
        data: {
          state: 'SETTLED', endedAt: new Date(), totalFlow,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          outcome: { prize, index: idx, rnd: rnd.toFixed(8) } as any,
        },
      });

      return results;
    });

    return {
      gameCode: round.game.code,
      category: 'SLOT',
      refType: 'round',
      refId: roundId,
      totalFlow,
      outcome: { prize, index: idx },
      bets: betResults,
      serverSeed: round.serverSeed ?? undefined,
      serverSeedHash: round.serverSeedHash ?? undefined,
    };
  }
}
