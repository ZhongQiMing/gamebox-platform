/**
 * 电子/街机类游戏结算引擎（SlotEngine）
 *
 * 资金流向（账目守恒）：
 *   下注：PLAYER -bet → PLATFORM +bet
 *   派彩：PLATFORM -payout → PLAYER +payout
 *   佣金：PLATFORM -commission → 各级代理
 *
 * 玩家回水进自助回水池（RebateService）；引擎内经 creditWinInTx 只发代理 A/挂靠。
 * 每次 spin = 单事务内完成下注 + 开奖 + 结算；placeBet/settle 保留以实现 IGameEngine 契约。
 */
import {
  Injectable, BadRequestException, NotFoundException,
  Optional, Inject, forwardRef,
} from '@nestjs/common';
import { asMoney, roundMoney, capWin } from '@gamebox/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { PointsService } from '../points/points.service';
import { CommissionService } from '../agents/commission.service';
import { GameConfigCache } from './game-config.cache';
import { genServerSeed, deriveRandom, weightedPick } from './fairness.util';
import type { IGameEngine, PlaceBetInput, SettlementSummary } from './types';
import { businessNo } from './business-id';
import { RiskService } from '../risk/risk.service';
import { SettlementKernel } from './settlement-kernel';
import { SoftControlAuditService } from '../console/soft-control-audit.service';
import { ConsoleControlService } from '../console/console-control.service';
import { GlobalSoftControlService } from '../console/global-soft-control.service';
import { FlyDiskService } from '../console/fly-disk.service';
import { pickSeedForArcadePool } from '../console/control-pick.util';
import { isRetiredGameCode } from '../games/retired-games';

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
    @Optional() @Inject(forwardRef(() => GlobalSoftControlService))
    private globalSoft?: GlobalSoftControlService,
    @Optional() private flyDisk?: FlyDiskService,
    @Optional() private softAudit?: SoftControlAuditService,
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

    if (isRetiredGameCode(gameCode)) throw new NotFoundException('游戏不存在或已下架');
    const game = await this.configCache.get(gameCode);
    if (!game || game.status !== 'ONLINE') throw new NotFoundException('游戏不存在或已下架');
    if (amount < asMoney(game.minBet) || amount > asMoney(game.maxBet)) {
      throw new BadRequestException(`下注额须在 ${asMoney(game.minBet)}~${asMoney(game.maxBet)} 之间`);
    }

    const config = game.configs[0];
    if (!config) throw new BadRequestException('游戏未配置 payTable');
    /*
     * payTable 形状不对就当没配。
     * 这里原来直接 .map()，非数组（例如街机那种 { awardWeights } 对象）会抛
     * TypeError 冒成 500，看起来像服务挂了；实际是这个游戏根本不该走 SLOT 引擎。
     */
    const payTable = config.payTable as unknown as PayItem[];
    if (!Array.isArray(payTable) || !payTable.length) {
      throw new BadRequestException('游戏未配置 payTable');
    }
    const weights = payTable.map(p => p.weight);

    const house = this.flyDisk
      ? await this.flyDisk.resolveHouse(
          playerId,
          await this.flyDisk.requireOpsRoomId(playerId, input.roomNo),
          amount,
          { requireRoom: true },
        )
      : null;
    const globalRt = this.globalSoft
      ? await this.globalSoft.getArcadeDrawRuntime(gameCode)
      : null;
    const softPick = pickSeedForArcadePool({
      runtime: globalRt,
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
    const { seed: serverSeed, hash: serverSeedHash, rnd, idx, prize } = softPick.result;
    /* 三个比例都在下注时定死：结算时才现算的话，中途改比例会把历史流水一起改掉 */
    const rates = this.flyDisk && house?.roomId
      ? await this.flyDisk.resolvePlayerRate(playerId, house.roomId, gameCode)
      : undefined;
    const flyPayload = house
      ? {
          type: house.type,
          id: house.id,
          flying: house.flying,
          roomId: house.roomId,
          agentUserId: house.agentUserId,
          generalUserId: house.generalUserId,
          sitting: house.sitting,
          bookMode: house.bookMode,
          P: rates?.P,
          agentPkg: rates?.agentPkg,
          generalPkg: rates?.generalPkg,
        }
      : undefined;

    const result = await this.prisma.$transaction(async (tx) => {
      const roundNo = businessNo('R');
      const round = await tx.gameRound.create({
        data: {
          roundNo, gameId: game.id, category: 'SLOT',
          playerId, configVer: config.version,
          state: 'PLAYING', serverSeed, serverSeedHash, clientSeed, nonce: 1,
        },
      });
      /* 介入留痕：只有 ADMIN 能查，写失败也不能拖累开奖 */
      if (softPick.steered && this.softAudit) {
        await this.softAudit.record({
          category: 'arcade',
          gameCode,
          refNo: roundNo,
          refId: round.id,
          reason: 'arcadePool',
          tries: softPick.tries,
          naturalDigest: `${softPick.natural.prize.label} x${softPick.natural.prize.multiplier}`,
          adoptedDigest: `${prize.label} x${prize.multiplier}`,
          stake: amount,
          estPayout: softPick.result.payout,
        });
      }
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
        house: house ?? undefined,
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
        house: house ?? undefined,
        gameCode,
        rateSnapshot: flyPayload,
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

      await tx.gameRound.update({
        where: { id: round.id },
        data: {
          state: 'SETTLED', endedAt: new Date(), totalFlow: amount,
           
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
    const balRoomId = String(house?.roomId || '').trim();
    return {
      ...result,
      balance: balRoomId ? await this.kernel.getBalance(playerId, balRoomId) : 0,
    };
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
    const balRoomId = String(
      (bet.payload as { fly?: { roomId?: string } } | null)?.fly?.roomId || '',
    ).trim();
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
      balance: balRoomId ? await this.kernel.getBalance(playerId, balRoomId) : 0,
    };
  }

  /**
   * @deprecated 两段式下注已废弃，禁止调用。
   *
   * 这段旧实现下注时**恒定把钱扣进平台池**，而 settle 会在派彩时重新解析房主。
   * 关盘（代理坐庄）的注单于是从错误的口袋出账：钱进了平台、赔的是代理，
   * 平台与代理之间发生一笔没有任何凭据的静默转移，对账也查不出来
   * （两边流水各自都是自洽的）。
   *
   * 对外只暴露单事务的 spin，这里保留签名只为满足 IGameEngine 契约。
   * 直接抛错，杜绝将来有人复用。
   */
  async placeBet(_input: PlaceBetInput): Promise<{ betId: string; roundId: string }> {
    throw new BadRequestException(
      '老虎机两段式下注已废弃（会走错资金口袋），请使用 spin',
    );
  }

  /**
   * @deprecated 两段式结算已废弃，禁止调用。
   *
   * 这段旧实现在派彩时**重新解析房主**，而配套的 placeBet 下注时恒定扣进平台池，
   * 两边口径不一致，关盘注单会从错误的口袋出账。对外只暴露单事务的 spin，
   * 这里保留签名只为满足 IGameEngine 契约。
   */
  async settle(_refId: string): Promise<SettlementSummary> {
    throw new BadRequestException(
      '老虎机两段式结算已废弃（会走错资金口袋），请使用 spin',
    );
  }
}
