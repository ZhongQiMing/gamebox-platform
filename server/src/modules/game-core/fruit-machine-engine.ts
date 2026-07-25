/**
 * 经典水果机（玛丽机）引擎。
 *
 * 玩法：24 格跑灯 + 8 仓位多符号下注；开奖可为单格或特殊大奖多格命中。
 * 本引擎是该类街机的标准实现，不套用其它游戏结构。
 */
import { Injectable, BadRequestException, Logger, NotFoundException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { PointsService, PLATFORM_OWNER_ID } from '../points/points.service';
import { CommissionService } from '../agents/commission.service';
import { GameConfigCache } from './game-config.cache';
import { SettlementKernel } from './settlement-kernel';
import { genServerSeed, deriveRandom, weightedPick } from './fairness.util';
import {
  FRUIT_RING,
  FRUIT_BET_SYMBOLS,
  FRUIT_DEFAULT_AWARD_WEIGHTS,
  FRUIT_AWARD_TYPES,
  allocateCappedWins,
  capWin,
  fruitAppleIndexes,
  fruitBigIndexes,
  fruitLuckIndexes,
  fruitNonLuckIndexes,
  isFruitBetSymbolId,
  type FruitAwardType,
  type FruitBetSymbolId,
} from '@gamebox/shared';
import { businessNo } from './business-id';
import { RiskService } from '../risk/risk.service';

const GAME_CODE = 'fruit-machine';
const KEY = 'fruit';
const log = new Logger('FruitMachineEngine');

interface FruitConfigPayTable {
  awardWeights?: Partial<Record<FruitAwardType, number>>;
}

export interface FruitSpinInput {
  playerId: string;
  gameCode?: string;
  /** 符号仓位 → 押注额 */
  bets: Record<string, number>;
  clientSeed?: string;
  clientRequestId: string;
}

export interface FruitWinLine {
  symbol: FruitBetSymbolId;
  mult: number;
  amount: number;
  cellIndex: number;
}

/** 写在 GameRound.outcome 上，供猜大小绑定当局赢分 */
interface FruitRoundOutcome {
  awardType: FruitAwardType;
  stopIndex: number;
  hitIndexes: number[];
  wins: FruitWinLine[];
  totalPayout: number;
  /** 当前可再赌金额；0 表示不可赌 */
  pendingGambleAmount: number;
}

@Injectable()
export class FruitMachineEngine {
  constructor(
    private prisma: PrismaService,
    private points: PointsService,
    private commission: CommissionService,
    private configCache: GameConfigCache,
    private risk: RiskService,
    private settle: SettlementKernel,
  ) {}

  async spin(input: FruitSpinInput) {
    const clientRequestId = this.settle.assertClientRequestId(input.clientRequestId);
    const replay = await this.replayIfAny(input.playerId, clientRequestId);
    if (replay) return replay;

    const { playerId, bets } = input;
    const clientSeed = input.clientSeed?.slice(0, 128) || clientRequestId;
    const gameCode = input.gameCode || GAME_CODE;

    if (Object.keys(bets ?? {}).length > FRUIT_BET_SYMBOLS.length) {
      throw new BadRequestException('押注仓位数量超限');
    }
    const entries = Object.entries(bets ?? {}).filter(([, amt]) => amt > 0);
    if (entries.length === 0) throw new BadRequestException('请至少押一个符号');
    for (const [sym, amt] of entries) {
      if (!isFruitBetSymbolId(sym)) throw new BadRequestException(`无效仓位：${sym}`);
      if (!Number.isInteger(amt) || amt < 1) throw new BadRequestException('押注额必须是正整数');
    }
    const totalAmount = entries.reduce((s, [, amt]) => s + amt, 0);
    const betMap = Object.fromEntries(entries) as Record<FruitBetSymbolId, number>;

    const game = await this.configCache.get(gameCode);
    if (!game || game.status !== 'ONLINE') throw new NotFoundException('游戏不存在或已下架');
    if (game.category !== 'ARCADE') throw new BadRequestException('该游戏不是街机品类');
    const config = game.configs[0];
    if (!config) throw new BadRequestException('游戏未配置');
    if (totalAmount < game.minBet || totalAmount > game.maxBet) {
      throw new BadRequestException(`总押注须在 ${game.minBet}~${game.maxBet} 之间`);
    }

    const payCfg = (config.payTable ?? {}) as FruitConfigPayTable;
    const awardWeights = { ...FRUIT_DEFAULT_AWARD_WEIGHTS, ...(payCfg.awardWeights ?? {}) };

    const { seed: serverSeed, hash: serverSeedHash } = genServerSeed();
    /* 每一次取随机都递增 nonce，玩家拿到 seed 后可以逐步复算 */
    let nonce = 0;
    const random = () => deriveRandom(serverSeed, clientSeed, ++nonce);

    const awardType = pickAwardType(awardWeights, random());
    const { stopIndex, hitIndexes } = resolveHits(awardType, random);
    const wins = settleWins(hitIndexes, betMap);
    const totalPayout = wins.reduce((s, w) => s + w.amount, 0);

    const player = await this.prisma.user.findUnique({
      where: { id: playerId },
      select: { id: true, agentPath: true },
    });

    const result = await this.prisma.$transaction(async (tx) => {
      // 新开一局即放弃上一把未再赌的当局赢分资格
      await this.clearPendingGambleInTx(tx, playerId, game.id);

      const round = await tx.gameRound.create({
        data: {
          roundNo: businessNo('FRU'),
          gameId: game.id,
          category: 'ARCADE',
          playerId,
          configVer: config.version,
          state: 'PLAYING',
          serverSeed,
          serverSeedHash,
          clientSeed,
          nonce: 1,
        },
      });

      await this.settle.debitBetInTx(tx, {
        playerId,
        roundId: round.id,
        amount: totalAmount,
        gameName: game.name,
        keyPrefix: KEY,
      });

      /* 整局封顶后按仓拆分，避免多线各自再吃一遍封顶额度 */
      const rawByPos = entries.map(([pos]) => {
        const sym = pos as FruitBetSymbolId;
        return wins.filter((w) => w.symbol === sym).reduce((s, w) => s + w.amount, 0);
      });
      const allocated = allocateCappedWins(totalAmount, rawByPos);
      if (allocated.capped) {
        log.error(`水果机整局派彩触顶 原始=${totalPayout} 封顶=${allocated.total}`);
      }

      const betResults: Array<{ position: string; amount: number; payout: number; won: boolean }> =
        [];
      let first = true;
      for (let i = 0; i < entries.length; i++) {
        const [pos, amt] = entries[i]!;
        const sym = pos as FruitBetSymbolId;
        const symWins = wins.filter((w) => w.symbol === sym);
        const payout = allocated.wins[i] ?? 0;
        const mult = symWins.length ? symWins.reduce((s, w) => s + w.mult, 0) : 0;
        const won = payout > 0;

        const bet = await tx.bet.create({
          data: {
            betNo: businessNo('FR'),
            clientRequestId: first ? clientRequestId : undefined,
            playerId,
            gameId: game.id,
            roundId: round.id,
            betType: pos,
            amount: amt,
            status: won ? 'WON' : 'LOST',
            payout,
            multiplier: mult,
            odds: mult,
            validFlow: amt,
            settledAt: new Date(),
          },
        });
        first = false;

        await this.settle.creditWinInTx(tx, {
          playerId,
          roundId: round.id,
          betId: bet.id,
          amount: payout,
          remark: `${game.name} 命中 ${sym}`,
          keyPrefix: KEY,
          skipCap: true,
        });

        betResults.push({ position: pos, amount: amt, payout, won });
      }

      await this.settle.applyCommissionInTx(tx, player, totalAmount, round.id);

      const paidTotal = allocated.total;
      const outcome: FruitRoundOutcome = {
        awardType,
        stopIndex,
        hitIndexes,
        wins,
        totalPayout: paidTotal,
        pendingGambleAmount: paidTotal > 0 ? paidTotal : 0,
      };
      await tx.gameRound.update({
        where: { id: round.id },
        data: {
          state: 'SETTLED',
          endedAt: new Date(),
          totalFlow: totalAmount,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          outcome: outcome as any,
        },
      });

      return { roundId: round.id, betResults, totalPayout: paidTotal };
    });

    if (result.totalPayout >= Math.max(totalAmount * 50, 100_000)) {
      await this.risk.record({
        type: 'BIG_WIN',
        level: 'WARN',
        targetId: result.roundId,
        detail: { playerId, totalAmount, totalPayout: result.totalPayout, gameCode },
      });
    }

    const balance = await this.settle.getBalance(playerId);
    return {
      gameCode,
      roundId: result.roundId,
      awardType,
      stopIndex,
      hitIndexes,
      wins,
      bets: result.betResults,
      totalBet: totalAmount,
      totalWin: result.totalPayout,
      totalPayout: result.totalPayout,
      balance,
      serverSeed,
      serverSeedHash,
    };
  }

  private async replayGambleIfAny(playerId: string, clientRequestId: string) {
    const bet = await this.settle.findSettledByClientRequestId(playerId, clientRequestId);
    if (!bet?.round?.outcome) return null;
    const o = bet.round.outcome as {
      choice?: 'big' | 'small';
      roll?: number;
      result?: 'win' | 'lose' | 'push';
      payout?: number;
      pendingGambleAmount?: number;
    };
    if (typeof o.roll !== 'number' || !o.choice || !o.result) return null;
    return {
      roll: o.roll,
      choice: o.choice,
      result: o.result,
      amount: bet.amount,
      payout: typeof o.payout === 'number' ? o.payout : bet.payout,
      pendingGambleAmount:
        typeof o.pendingGambleAmount === 'number' ? o.pendingGambleAmount : 0,
      balance: await this.settle.getBalance(playerId),
      roundId: bet.round.id,
      betId: bet.id,
      serverSeed: bet.round.serverSeed ?? '',
      serverSeedHash: bet.round.serverSeedHash ?? '',
    };
  }

  private async replayIfAny(playerId: string, clientRequestId: string) {
    const bet = await this.settle.findSettledByClientRequestId(playerId, clientRequestId);
    if (!bet?.round?.outcome) return null;
    const o = bet.round.outcome as unknown as FruitRoundOutcome;
    const roundBets = await this.prisma.bet.findMany({
      where: { roundId: bet.round.id },
      select: { betType: true, amount: true, payout: true },
    });
    const balance = await this.settle.getBalance(playerId);
    const totalBet = roundBets.reduce((s, b) => s + b.amount, 0);
    const totalPayout = o.totalPayout ?? roundBets.reduce((s, b) => s + b.payout, 0);
    return {
      gameCode: bet.game.code,
      roundId: bet.round.id,
      awardType: o.awardType,
      stopIndex: o.stopIndex,
      hitIndexes: o.hitIndexes,
      wins: o.wins ?? [],
      bets: roundBets.map((b) => ({
        position: b.betType ?? '',
        amount: b.amount,
        payout: b.payout,
        won: b.payout > 0,
      })),
      totalBet,
      totalWin: totalPayout,
      totalPayout,
      balance,
      serverSeed: bet.round.serverSeed ?? '',
      serverSeedHash: bet.round.serverSeedHash ?? '',
    };
  }

  /**
   * 当局赢分「大 / 小」再赌：点数 1–6 小、8–13 大、7 和（退回本金）。
   * 金额必须等于最近一局水果机未消耗的 pendingGambleAmount，禁止用任意余额再赌。
   */
  async gamble(input: {
    playerId: string;
    amount: number;
    choice: 'big' | 'small';
    clientRequestId: string;
  }) {
    const { playerId, amount, choice } = input;
    const clientRequestId = this.settle.assertClientRequestId(input.clientRequestId);
    if (!Number.isInteger(amount) || amount < 1) {
      throw new BadRequestException('再赌金额无效');
    }
    if (choice !== 'big' && choice !== 'small') {
      throw new BadRequestException('请选择大或小');
    }

    const replay = await this.replayGambleIfAny(playerId, clientRequestId);
    if (replay) return replay;

    const game = await this.configCache.get(GAME_CODE);
    const config = game?.configs[0];
    if (!game || game.status !== 'ONLINE' || !config) {
      throw new NotFoundException('水果机未上线或未配置');
    }

    const { seed, hash } = genServerSeed();
    const clientSeed = `${playerId}:${amount}:${businessNo('FGS')}`;
    const rnd = deriveRandom(seed, clientSeed, 1);
    const roll = 1 + Math.floor(rnd * 13); // 1..13
    let result: 'win' | 'lose' | 'push' = 'push';
    if (roll === 7) result = 'push';
    else if (roll <= 6) result = choice === 'small' ? 'win' : 'lose';
    else result = choice === 'big' ? 'win' : 'lose';

    // 净结算：win +amount / lose -amount / push 0；赢侧走 capWin，续赌额度同步封顶。
    const rawBack = result === 'win' ? amount * 2 : result === 'push' ? amount : 0;
    const { win: payoutBack, capped: gambleCapped } = capWin(amount, rawBack);
    if (gambleCapped) {
      log.error(`水果机再赌派彩触顶 amount=${amount} 原始=${rawBack} 封顶=${payoutBack}`);
    }
    const nextPending = result === 'lose' ? 0 : payoutBack;
    const audit = await this.prisma.$transaction(async (tx) => {
      const source = await this.findPendingGambleRoundInTx(tx, playerId, game.id);
      if (!source) {
        throw new BadRequestException('没有可再赌的当局赢分');
      }
      const sourceOutcome = source.outcome as unknown as FruitRoundOutcome;
      if (amount !== sourceOutcome.pendingGambleAmount) {
        throw new BadRequestException(
          `再赌金额须等于当局赢分（${sourceOutcome.pendingGambleAmount}）`,
        );
      }

      // 条件占用：仅当 pending 仍等于当局赢分时清零，防并发双赌
      const claimed = await tx.$executeRaw`
        UPDATE "GameRound"
        SET outcome = jsonb_set(COALESCE(outcome, '{}'::jsonb), '{pendingGambleAmount}', '0'::jsonb, true)
        WHERE id = ${source.id}
          AND COALESCE((outcome->>'pendingGambleAmount')::int, 0) = ${amount}
      `;
      if (Number(claimed) === 0) {
        throw new BadRequestException('没有可再赌的当局赢分');
      }

      const round = await tx.gameRound.create({
        data: {
          roundNo: businessNo('FGR'),
          gameId: game.id,
          category: 'ARCADE',
          playerId,
          configVer: config.version,
          state: 'PLAYING',
          serverSeed: seed,
          serverSeedHash: hash,
          clientSeed,
          nonce: 1,
        },
      });
      const bet = await tx.bet.create({
        data: {
          betNo: businessNo('FGB'),
          clientRequestId,
          playerId,
          gameId: game.id,
          roundId: round.id,
          betType: `GAMBLE_${choice.toUpperCase()}`,
          amount,
          status: 'PENDING',
          payload: { sourceRoundId: source.id, choice, roll, result },
        },
      });
      await this.points.transferInTx(
        tx,
        {
          type: 'PLAYER',
          id: playerId,
          remark: `水果机大小再赌 ${choice} 押注`,
          idempotencyKey: `fruit_gamble_stake_${bet.id}`,
        },
        {
          type: 'PLATFORM',
          id: PLATFORM_OWNER_ID,
          idempotencyKey: `fruit_gamble_stake_plat_${bet.id}`,
        },
        amount,
        { bizType: 'BET', refType: 'round', refId: round.id },
      );
      if (payoutBack > 0) {
        await this.points.transferInTx(
          tx,
          {
            type: 'PLATFORM',
            id: PLATFORM_OWNER_ID,
            idempotencyKey: `fruit_gamble_plat_${bet.id}`,
          },
          {
            type: 'PLAYER',
            id: playerId,
            remark: `水果机大小再赌 ${choice} 点数${roll}`,
            idempotencyKey: `fruit_gamble_${bet.id}`,
          },
          payoutBack,
          { bizType: 'WIN', refType: 'round', refId: round.id },
        );
      }
      await tx.bet.update({
        where: { id: bet.id },
        data: {
          status: result === 'lose' ? 'LOST' : 'WON',
          payout: payoutBack,
          odds: payoutBack / amount,
          multiplier: payoutBack / amount,
          /* 猜大小是 0 边缘玩法（6赢/6输/1和），不产生有效流水，
             否则玩家可以零成本刷佣金 */
          validFlow: 0,
          settledAt: new Date(),
          payload: { sourceRoundId: source.id, choice, roll, result },
        },
      });
      /* 同上：0 边缘玩法不计流水，也就不参与分佣 */
      await tx.gameRound.update({
        where: { id: round.id },
        data: {
          state: 'SETTLED',
          totalFlow: 0,
          endedAt: new Date(),
          outcome: {
            choice,
            roll,
            result,
            payout: payoutBack,
            sourceRoundId: source.id,
            pendingGambleAmount: nextPending,
          },
        },
      });
      // 赢/和：把可续赌金额写回源局，供下一次 gamble 绑定
      if (nextPending > 0) {
        await tx.gameRound.update({
          where: { id: source.id },
          data: {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            outcome: { ...sourceOutcome, pendingGambleAmount: nextPending } as any,
          },
        });
      }
      return { roundId: round.id, betId: bet.id, pendingGambleAmount: nextPending };
    });

    const after = await this.prisma.pointsAccount.findUnique({
      where: { ownerId: playerId },
      select: { balance: true },
    });

    return {
      roll,
      choice,
      result,
      amount,
      payout: payoutBack,
      pendingGambleAmount: audit.pendingGambleAmount,
      balance: after?.balance ?? 0,
      roundId: audit.roundId,
      betId: audit.betId,
      serverSeed: seed,
      serverSeedHash: hash,
    };
  }

  private async clearPendingGambleInTx(
    tx: Prisma.TransactionClient,
    playerId: string,
    gameId: string,
  ) {
    const pending = await this.findPendingGambleRoundInTx(tx, playerId, gameId);
    if (!pending) return;
    const outcome = pending.outcome as unknown as FruitRoundOutcome;
    await tx.gameRound.update({
      where: { id: pending.id },
      data: {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        outcome: { ...outcome, pendingGambleAmount: 0 } as any,
      },
    });
  }

  private async findPendingGambleRoundInTx(
    tx: Prisma.TransactionClient,
    playerId: string,
    gameId: string,
  ) {
    // 最近若干局内找仍有 pendingGambleAmount 的水果局（含续赌后写回源局）
    const recent = await tx.gameRound.findMany({
      where: {
        playerId,
        gameId,
        state: 'SETTLED',
        category: 'ARCADE',
      },
      orderBy: { endedAt: 'desc' },
      take: 20,
      select: { id: true, outcome: true, roundNo: true },
    });
    for (const row of recent) {
      const outcome = row.outcome as unknown as FruitRoundOutcome | null;
      if (
        outcome &&
        typeof outcome.pendingGambleAmount === 'number' &&
        outcome.pendingGambleAmount > 0 &&
        Array.isArray(outcome.hitIndexes)
      ) {
        return row;
      }
    }
    return null;
  }
}

function pickAwardType(
  weights: Record<FruitAwardType, number>,
  rnd: number,
): FruitAwardType {
  const list = FRUIT_AWARD_TYPES.map((t) => Math.max(0, weights[t] ?? 0));
  const idx = weightedPick(list, rnd);
  return FRUIT_AWARD_TYPES[idx];
}

function pickWeightedIndex(
  indexes: number[],
  weights: number[],
  random: () => number,
): number {
  if (indexes.length === 0) {
    throw new Error('pickWeightedIndex: 候选索引不能为空');
  }
  const w = indexes.map((i) => Math.max(0, weights[i] ?? 1));
  const pick = weightedPick(w, random());
  return indexes[pick];
}

/**
 * 开奖命中解析。random 每次调用消耗一个派生随机数，
 * 保证送灯多格、大三元多格都可被 seed+nonce 逐步复算。
 */
function resolveHits(
  awardType: FruitAwardType,
  random: () => number,
): { stopIndex: number; hitIndexes: number[] } {
  const luckIdx = fruitLuckIndexes();
  const nonLuck = fruitNonLuckIndexes();
  const cellWeights = FRUIT_RING.map((c) => Math.max(0, c.weight));

  if (awardType === 'luck_eat') {
    const stopIndex = pickWeightedIndex(luckIdx, cellWeights, random);
    return { stopIndex, hitIndexes: [] };
  }

  if (awardType === 'luck_send') {
    const stopIndex = pickWeightedIndex(luckIdx, cellWeights, random);
    const count = 1 + Math.floor(random() * 5); // 1~5
    const hits = pickDistinct(nonLuck, count, cellWeights, random);
    return { stopIndex, hitIndexes: hits };
  }

  if (awardType === 'train') {
    const start = pickWeightedIndex(nonLuck, cellWeights, random);
    const len = 4 + Math.floor(random() * 3); // 4~6
    const hits: number[] = [];
    for (let i = 0; i < len; i++) {
      const idx = (start + i) % FRUIT_RING.length;
      if (FRUIT_RING[idx].size !== 'luck') hits.push(idx);
    }
    return { stopIndex: start, hitIndexes: hits };
  }

  if (awardType === 'big3') {
    const hits = [
      pickOne(fruitBigIndexes('seven'), random),
      pickOne(fruitBigIndexes('star'), random),
      pickOne(fruitBigIndexes('melon'), random),
    ];
    return { stopIndex: hits[0], hitIndexes: hits };
  }

  if (awardType === 'small3') {
    const hits = [
      pickOne(fruitBigIndexes('bell'), random),
      pickOne(fruitBigIndexes('lemon'), random),
      pickOne(fruitBigIndexes('orange'), random),
    ];
    return { stopIndex: hits[0], hitIndexes: hits };
  }

  if (awardType === 'four') {
    const hits = fruitAppleIndexes();
    return { stopIndex: hits[0] ?? 0, hitIndexes: hits };
  }

  if (awardType === 'slam') {
    return { stopIndex: nonLuck[0] ?? 0, hitIndexes: [...nonLuck] };
  }

  // normal
  const stopIndex = pickWeightedIndex(
    [...Array(FRUIT_RING.length).keys()],
    cellWeights,
    random,
  );
  if (FRUIT_RING[stopIndex].size === 'luck') {
    // 普通奖抽到 LUCK 格时，改为送灯 1~3
    const count = 1 + Math.floor(random() * 3);
    const hits = pickDistinct(nonLuck, count, cellWeights, random);
    return { stopIndex, hitIndexes: hits };
  }
  return { stopIndex, hitIndexes: [stopIndex] };
}

function pickOne(indexes: number[], random: () => number): number {
  if (indexes.length === 0) {
    throw new Error('pickOne: 候选索引不能为空');
  }
  return indexes[Math.floor(random() * indexes.length) % indexes.length];
}

/** 无放回加权抽样；每格独立消耗一次 random，避免旧 LCG 递推退化 */
function pickDistinct(
  pool: number[],
  count: number,
  weights: number[],
  random: () => number,
): number[] {
  const left = [...pool];
  const out: number[] = [];
  const n = Math.min(count, left.length);
  for (let i = 0; i < n; i++) {
    const w = left.map((idx) => Math.max(0, weights[idx] ?? 1));
    const pick = weightedPick(w, random());
    out.push(left[pick]);
    left.splice(pick, 1);
  }
  return out;
}

function settleWins(
  hitIndexes: number[],
  betMap: Record<FruitBetSymbolId, number>,
): FruitWinLine[] {
  const wins: FruitWinLine[] = [];
  for (const cellIndex of hitIndexes) {
    const cell = FRUIT_RING[cellIndex];
    if (!cell?.symbol || cell.mult <= 0) continue;
    const betAmt = betMap[cell.symbol] ?? 0;
    if (betAmt <= 0) continue;
    wins.push({
      symbol: cell.symbol,
      mult: cell.mult,
      amount: Math.floor(betAmt * cell.mult),
      cellIndex,
    });
  }
  return wins;
}

/** 供前端展示用的静态赔率表（也写入 seed 注释） */
export function fruitBetPayRows() {
  return FRUIT_BET_SYMBOLS.map((s) => ({
    id: s.id,
    label: s.label,
    bigMult: s.bigMult,
    smallMult: s.smallMult,
  }));
}
