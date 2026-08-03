/**
 * LotteryService：彩票核心业务逻辑
 *
 * 职责：
 *   1. 预创期号（由 scheduler 每批次调用）
 *   2. 封盘（到 lockAt 时设 LOCKED）
 *   3. 开奖（到 openAt 时摇号 → 结算所有 PENDING 注单）
 *   4. 投注（前置校验 + 写 Bet + 扣分）
 *   5. 查询（当前期 / 历史）
 */
import {
  Injectable, BadRequestException, NotFoundException, Logger, Inject, forwardRef, Optional,
} from '@nestjs/common';
import { createHash, randomBytes } from 'node:crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { PointsService, PLATFORM_OWNER_ID } from '../points/points.service';
import { CommissionService } from '../agents/commission.service';
import { GameConfigCache } from '../game-core/game-config.cache';
import { LotteryGameRegistry } from './lottery-game.registry';
import type { LotteryBetPayload, LotteryPayTable } from './lottery.types';
import type { Prisma } from '@prisma/client';
import { asMoney, capWin, isValidMoney, roundMoney } from '@gamebox/shared';
import { businessNo } from '../game-core/business-id';
import { RoomChatService } from '../rooms/room-chat.service';
import type { RoomChatPlayLine } from '../rooms/room-chat.types';
import { formatLotteryPlayLabel } from './play-label';
import { lotteryPrepSec } from './lottery-intervals';
import { ConsoleControlService } from '../console/console-control.service';
import { CONTROL_FIXED_CANDIDATE_TRIES, CONTROL_MIN_BET_COUNT } from '../console/control.constants';
import { FlyDiskService } from '../console/fly-disk.service';
import { FlyRebateService } from '../console/fly-rebate.service';
import { RiskService } from '../risk/risk.service';
import type { OwnerType } from '../points/points.service';
import type { DrawResult, LotteryGameDef } from './lottery.types';

/** 期号：上海日历 月日 + 当日序号（6 位），如 0802000285；每日 00:00 重置。
 *  赛车三房曾用连续短号，上线日切后清掉未下注的旧短号待开期。
 */
const RACING_DAY_RESET_GAMES = new Set(['bjsc', 'speed-racing', 'speed-boat']);

/** Asia/Shanghai 日历日切（MMDD + 当日序号） */
function shanghaiDayParts(openAt: Date): { md: string; dayStartMs: number } {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(openAt);
  const get = (type: string) => parts.find((p) => p.type === type)?.value || '01';
  const y = get('year');
  const m = get('month');
  const d = get('day');
  return {
    md: `${m}${d}`,
    dayStartMs: Date.parse(`${y}-${m}-${d}T00:00:00+08:00`),
  };
}

function genIssueNo(openAt: Date, intervalSec: number, _gameCode?: string): string {
  const intervalMs = intervalSec * 1000;
  const { md, dayStartMs } = shanghaiDayParts(openAt);
  const seq = Math.floor((openAt.getTime() - dayStartMs) / intervalMs) + 1;
  return `${md}${Math.max(1, seq).toString().padStart(6, '0')}`;
}

function genSeedPair() {
  const serverSeed = randomBytes(16).toString('hex');
  const serverSeedHash = createHash('sha256').update(serverSeed).digest('hex');
  return { serverSeed, serverSeedHash };
}

@Injectable()
export class LotteryService {
  private readonly logger = new Logger(LotteryService.name);

  constructor(
    private prisma: PrismaService,
    private points: PointsService,
    private commission: CommissionService,
    private registry: LotteryGameRegistry,
    private configCache: GameConfigCache,
    private roomChat: RoomChatService,
    private risk: RiskService,
    @Optional() @Inject(forwardRef(() => ConsoleControlService))
    private control?: ConsoleControlService,
    @Optional() private flyDisk?: FlyDiskService,
    @Optional() private flyRebate?: FlyRebateService,
  ) {}

  private async houseForPlayer(playerId: string) {
    if (!this.flyDisk) {
      return { type: 'PLATFORM' as OwnerType, id: PLATFORM_OWNER_ID, flying: false };
    }
    return this.flyDisk.resolveHouse(playerId);
  }

  // ─── 期号管理 ─────────────────────────────────────────

  /**
   * 预创今后 N 期期号（scheduler 每分钟调用，保证总有待开期）
   * @param gameCode  游戏 code
   * @param intervalSec  开奖间隔秒数
   * @param ahead  预创多少期（默认 3）
   */
  async preCreateIssues(gameCode: string, intervalSec: number, ahead = 3) {
    const game = await this.prisma.game.findUnique({
      where: { code: gameCode },
      include: { configs: { where: { active: true }, take: 1 } },
    });
    const activeConfig = game?.configs[0];
    // 下架 / 维护不再预创期号
    if (!game || game.status !== 'ONLINE' || !activeConfig) return;

    const prepSec = lotteryPrepSec(gameCode);
    const prepMs = prepSec * 1000;
    const intervalMs = intervalSec * 1000;

    // 赛车日切：期号必须是 MMDD+6 位（10 位）；旧连续短号待开期一律清掉重铺
    let racingStaleCleared = false;
    if (RACING_DAY_RESET_GAMES.has(gameCode)) {
      const pending = await this.prisma.lotteryIssue.findMany({
        where: { gameId: game.id, status: { in: ['PENDING', 'LOCKED'] } },
        select: { id: true, issueNo: true, _count: { select: { bets: true } } },
      });
      const dayIssue = /^\d{10}$/;
      const staleIds = pending
        .filter((r) => !dayIssue.test(r.issueNo) && r._count.bets === 0)
        .map((r) => r.id);
      if (staleIds.length) {
        await this.prisma.lotteryIssue.deleteMany({ where: { id: { in: staleIds } } });
        racingStaleCleared = true;
        this.logger.warn(
          `${gameCode}: cleared ${staleIds.length} legacy short-issue pending rows for day-reset`,
        );
      }
    }

    // 周期/封盘窗变更：清掉未下注待开期，避免旧间隔/旧 lock 窗口残留
    {
      const pending = await this.prisma.lotteryIssue.findMany({
        where: { gameId: game.id, status: { in: ['PENDING', 'LOCKED'] } },
        select: {
          id: true,
          openAt: true,
          lockAt: true,
          _count: { select: { bets: true } },
        },
        orderBy: { openAt: 'asc' },
      });
      let rebuild = false;
      if (pending.length >= 2) {
        const gap = pending[1].openAt.getTime() - pending[0].openAt.getTime();
        if (Math.abs(gap - intervalMs) > 2000) rebuild = true;
      }
      if (!rebuild) {
        for (const row of pending) {
          const wantLock = row.openAt.getTime() - prepMs;
          if (Math.abs(row.lockAt.getTime() - wantLock) > 1000) {
            rebuild = true;
            break;
          }
        }
      }
      if (rebuild) {
        const emptyIds = pending.filter((r) => r._count.bets === 0).map((r) => r.id);
        if (emptyIds.length) {
          await this.prisma.lotteryIssue.deleteMany({ where: { id: { in: emptyIds } } });
        }
      } else {
        for (const row of pending) {
          if (row._count.bets > 0) continue;
          const wantLock = new Date(row.openAt.getTime() - prepMs);
          if (Math.abs(row.lockAt.getTime() - wantLock.getTime()) > 500) {
            await this.prisma.lotteryIssue.update({
              where: { id: row.id },
              data: { lockAt: wantLock },
            });
          }
        }
      }
    }

    // 找最晚一期的 openAt；清过旧短号后必须从对齐墙钟重铺，勿接在旧连续号时间轴后面
    const last = racingStaleCleared
      ? null
      : await this.prisma.lotteryIssue.findFirst({
          where: { gameId: game.id, status: { in: ['PENDING', 'LOCKED'] } },
          orderBy: { openAt: 'desc' },
        });

    let nextOpen = last
      ? new Date(last.openAt.getTime() + intervalSec * 1000)
      : this._nextAlignedTime(intervalSec);

    for (let i = 0; i < ahead; i++) {
      const lockAt = new Date(nextOpen.getTime() - prepMs);
      const issueNo = genIssueNo(nextOpen, intervalSec, gameCode);
      const { serverSeed, serverSeedHash } = genSeedPair();

      await this.prisma.lotteryIssue.upsert({
        where: { gameId_issueNo: { gameId: game.id, issueNo } },
        /* 已存在的待开期也刷新 lockAt，避免封盘窗变更后仍沿用旧 lock */
        update: { lockAt },
        create: {
          gameId: game.id, configVer: activeConfig.version, issueNo, status: 'PENDING',
          openAt: nextOpen, lockAt, serverSeed, serverSeedHash,
        },
      });
      nextOpen = new Date(nextOpen.getTime() + intervalSec * 1000);
    }
  }

  /** 获取下一个整点对齐时间 */
  private _nextAlignedTime(intervalSec: number): Date {
    const now = Date.now();
    const intervalMs = intervalSec * 1000;
    return new Date(Math.ceil(now / intervalMs) * intervalMs);
  }

  /**
   * 封盘：lockAt 已到仍 PENDING → LOCKED，并立即推封盘线 + 注单核对，
   * 随即开奖结算（不再干等 openAt，把 lock→open 窗口留给前端开奖仪式）。
   */
  async lockDueIssues() {
    const now = new Date();
    const due = await this.prisma.lotteryIssue.findMany({
      where: { status: 'PENDING', lockAt: { lte: now }, openAt: { gt: now } },
      include: { game: { select: { code: true } } },
      orderBy: { lockAt: 'asc' },
      take: 80,
    });
    for (const issue of due) {
      const claimed = await this.prisma.lotteryIssue.updateMany({
        where: { id: issue.id, status: 'PENDING' },
        data: { status: 'LOCKED' },
      });
      if (claimed.count === 0) continue;
      try {
        await this.roomChat.fanOutIssueLocked(issue.game.code, issue.issueNo);
      } catch {
        /* 聊天失败不影响封盘状态 */
      }
      /* 封盘后立刻开奖：号码与派彩就绪，聊天结果卡由客户端延时 1s 后播长仪式 */
      try {
        await this.draw(issue.id);
      } catch (e) {
        this.logger.error(`draw-after-lock[${issue.issueNo}] failed: ${(e as Error).message}`);
      }
    }
  }

  /**
   * 执行开奖（scheduler 检查到期的 PENDING/LOCKED 期号后调用）
   */
  async draw(issueId: string) {
    const issue = await this.prisma.lotteryIssue.findUnique({
      where: { id: issueId },
      include: { game: true },
    });
    if (!issue || issue.status === 'DRAWN' || issue.status === 'CANCELLED') return;

    const gameDef = this.registry.get(issue.game.code);
    if (!gameDef) return;

    const config = await this.prisma.gameConfig.findUnique({
      where: {
        gameId_version: {
          gameId: issue.gameId,
          version: issue.configVer,
        },
      },
    });
    if (!config) return;

    const payTable = config.payTable as unknown as LotteryPayTable;
    const pendingBets = await this.prisma.bet.findMany({
      where: { issueId: issue.id, status: 'PENDING' },
      select: { amount: true, payload: true, playerId: true },
    });
    const drawResult = await this.pickDrawWithControl(
      issue.game.code,
      issue.serverSeed!,
      gameDef,
      payTable,
      pendingBets,
    );

    const bigWins: Array<{ betId: string; playerId: string; amount: number; payout: number }> = [];
    // 在事务内结算所有注单
    await this.prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      // CAS 抢占：事务第一条语句拿下期号行锁并推进状态，
      // 并发 draw 只有一个能抢到（count=1），其余直接返回，根治双开奖。
      const claimed = await tx.lotteryIssue.updateMany({
        where: { id: issue.id, status: { in: ['PENDING', 'LOCKED'] } },
        data: {
          status: 'DRAWN',
          drawNumbers: JSON.stringify(drawResult.numbers),
          drawnAt: new Date(),
        },
      });
      if (claimed.count === 0) return;

      const bets = await tx.bet.findMany({
        where: { issueId: issue.id, status: 'PENDING' },
        include: { player: { select: { id: true, agentPath: true } } },
      });

      let settledFlow = 0;
      for (const bet of bets) {
        const payload = bet.payload as unknown as LotteryBetPayload;
        const amt = asMoney(bet.amount);
        const hitKey = gameDef.judge(payload, drawResult, payTable);
        /* 和局退本：即使库内 payTable 尚未写入 refund，也按 1 倍退本 */
        const odds = hitKey
          ? (hitKey === 'refund'
              ? (payTable[hitKey]?.multiplier ?? 1)
              : (payTable[hitKey]?.multiplier ?? 0))
          : 0;
        const raw = hitKey ? roundMoney(amt * odds) : 0;
        const { win: payout, capped } = capWin(amt, raw);
        if (capped) {
          this.logger.error(
            `派彩触顶 ${issue.game.code} bet=${bet.id} 玩法=${bet.betType} 原始=${raw} 封顶=${payout}`,
          );
        }
        const won = payout > 0;
        /* 和局退本（如六合彩 49 六肖）本金原路返回，不算有效流水 */
        const isRefund = hitKey === 'refund';

        /* 先 CAS 占住 PENDING，避免与「取消退本」并发导致退本后又派彩 */
        const settled = await tx.bet.updateMany({
          where: { id: bet.id, status: 'PENDING' },
          data: {
            status: won ? 'WON' : 'LOST',
            payout,
            odds,
            validFlow: isRefund ? 0 : amt,
            settledAt: new Date(),
          },
        });
        if (settled.count === 0) continue;

        settledFlow = roundMoney(settledFlow + amt);
        if (!isRefund && payout >= Math.max(amt * 50, 100_000)) {
          bigWins.push({ betId: bet.id, playerId: bet.playerId, amount: amt, payout });
        }

        const flyMeta = (bet.payload as { fly?: {
          type?: string; id?: string; flying?: boolean; agentUserId?: string; roomId?: string;
        } } | null)?.fly;
        const houseType = (flyMeta?.type as OwnerType) || 'PLATFORM';
        const houseId = flyMeta?.id || PLATFORM_OWNER_ID;
        const flying = !!flyMeta?.flying;

        if (won) {
          await this.points.transferInTx(
            tx,
            {
              type: houseType,
              id: houseId,
              idempotencyKey: `win_house_${bet.id}`,
            },
            {
              type: 'PLAYER',
              id: bet.playerId,
              remark: `${issue.game.name} ${issue.issueNo} 开奖`,
              idempotencyKey: `win_player_${bet.id}`,
            },
            payout,
            { bizType: 'WIN', refType: 'issue', refId: issue.id },
          );
        }

        if (this.flyDisk && !isRefund) {
          await this.flyDisk.applyFlyLossInTx(tx, flyMeta?.agentUserId, flying, amt, payout);
        }
        if (this.flyRebate && !isRefund) {
          await this.flyRebate.payAgentShareInTx(tx, {
            betId: bet.id,
            playerId: bet.playerId,
            validFlow: amt,
            flying,
            roomId: flyMeta?.roomId,
            agentUserId: flyMeta?.agentUserId,
          });
        }

        // 多级代理佣金（idemScope 用 bet.id 保证每注独立分润）
        if (bet.player?.agentPath && !isRefund) {
          await this.commission.distributeInTx(tx, bet.player, amt, undefined, `lottery_${bet.id}`);
        }
      }

      await tx.lotteryIssue.update({
        where: { id: issue.id },
        data: { totalFlow: settledFlow },
      });
    });

    /* 事务成功后写入房间公共聊天（开奖结果 + 中奖核对） */
    try {
      const nums = Array.isArray(drawResult.numbers) ? drawResult.numbers.map(Number) : [];
      /* 若调度落后跳过 LOCKED，补写封盘/注单核对（appendSystemOnce 防重） */
      await this.roomChat.fanOutIssueLocked(issue.game.code, issue.issueNo);
      await this.roomChat.fanOutIssueDrawn(issue.game.code, issue.issueNo, nums);
    } catch {
      /* 聊天失败不影响开奖 */
    }

    for (const w of bigWins) {
      await this.risk.record({
        type: 'BIG_WIN',
        level: w.payout >= 1_000_000 ? 'CRITICAL' : 'WARN',
        targetId: w.playerId,
        fingerprint: `bw:lottery:${w.betId}`,
        dedupeMs: 24 * 3600_000,
        detail: {
          playerId: w.playerId,
          totalAmount: w.amount,
          totalPayout: w.payout,
          gameCode: issue.game.code,
          issueId: issue.id,
          issueNo: issue.issueNo,
          betId: w.betId,
          summary: `${issue.game.code} 派彩 ${w.payout}（下注 ${w.amount}）`,
        },
      });
    }

    /* 控奖目标回血金额：结算后检查是否达成并自动结束 */
    try {
      if (this.control) await this.control.refreshGoalExhaustion(issue.game.code);
    } catch {
      /* 不影响开奖 */
    }
  }

  private assertClientRequestId(id?: string): string {
    if (!id || id.length < 8 || id.length > 100) {
      throw new BadRequestException('clientRequestId 无效');
    }
    return id;
  }

  /**
   * 下注事务内锁定期号行：与 draw 的 CAS 互斥，
   * 避免「开奖已结算 → 迟到 PENDING 注单无人赔付」。
   */
  private async lockIssueForBet(tx: Prisma.TransactionClient, issueId: string) {
    await tx.$queryRaw`SELECT id FROM "LotteryIssue" WHERE id = ${issueId} FOR UPDATE`;
    const fresh = await tx.lotteryIssue.findUnique({
      where: { id: issueId },
      select: { status: true, lockAt: true },
    });
    if (!fresh || fresh.status !== 'PENDING' || fresh.lockAt <= new Date()) {
      throw new BadRequestException('本期已封盘，请等待下期');
    }
  }

  /** 批量幂等键：`${base}:0` … `${base}:n-1` */
  private batchBetRequestId(base: string, index: number): string {
    const id = `${base}:${index}`;
    if (id.length > 100) {
      throw new BadRequestException('clientRequestId 过长');
    }
    return id;
  }

  /**
   * 批量投注：同一事务内全部成功或全部失败，避免多注串行半成功扣款。
   */
  async placeBetsBatch(
    playerId: string,
    gameCode: string,
    bets: Array<{ betType: string; betValue?: string; amount: number }>,
    opts?: {
      clientRequestId?: string;
      roomNo?: string;
      chatText?: string;
      plays?: RoomChatPlayLine[];
    },
  ) {
    if (!Array.isArray(bets) || !bets.length) throw new BadRequestException('注单不能为空');
    if (bets.length > 50) throw new BadRequestException('单次最多 50 注');
    const clientRequestId = this.assertClientRequestId(opts?.clientRequestId);
    /* 批次键为 base:index，预留后缀空间 */
    if (clientRequestId.length > 96) {
      throw new BadRequestException('clientRequestId 过长');
    }

    const replay = await this.replayBatchIfAny(playerId, clientRequestId, bets.length);
    if (replay) {
      return this.attachChatPosted(replay, playerId, gameCode, bets, opts);
    }

    const game = await this.configCache.get(gameCode);
    if (!game || game.status !== 'ONLINE') throw new NotFoundException('游戏未上架');
    const gameDef = this.registry.get(gameCode);
    if (!gameDef) throw new BadRequestException('游戏类型不支持');

    for (const b of bets) {
      if (!isValidMoney(b.amount, 1)) throw new BadRequestException('投注额无效');
      const minBet = asMoney(game.minBet);
      const maxBet = asMoney(game.maxBet);
      if (b.amount < minBet || b.amount > maxBet) {
        throw new BadRequestException(`投注额须在 ${minBet}~${maxBet} 之间`);
      }
      if (!gameDef.validateBet(b.betType, b.betValue)) {
        throw new BadRequestException(`玩法参数无效: ${b.betType}`);
      }
    }

    const now = new Date();
    const issue = await this.prisma.lotteryIssue.findFirst({
      where: {
        gameId: game.id,
        status: 'PENDING',
        lockAt: { gt: now },
        openAt: { gt: now },
      },
      orderBy: { openAt: 'asc' },
    });
    if (!issue) throw new BadRequestException('当前无可投注期，请等待下期');

    const totalAmount = bets.reduce((s, b) => s + b.amount, 0);

    return this.prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      await this.lockIssueForBet(tx, issue.id);

      const results: Array<{
        betId: string;
        betType: string;
        betValue?: string;
        amount: number;
      }> = [];

      for (let i = 0; i < bets.length; i++) {
        const b = bets[i]!;
        const house = await this.houseForPlayer(playerId);
        const { P } = this.flyDisk
          ? await this.flyDisk.resolvePlayerRate(playerId, house.roomId)
          : { P: 0.018 };
        const payload: LotteryBetPayload & { fly?: object } = {
          betType: b.betType, value: b.betValue,
          fly: {
            type: house.type, id: house.id, flying: house.flying,
            roomId: house.roomId, agentUserId: house.agentUserId, P,
          },
        };
        const bet = await tx.bet.create({
          data: {
            betNo: businessNo('LB'),
            clientRequestId: this.batchBetRequestId(clientRequestId, i),
            playerId,
            gameId: game.id,
            issueId: issue.id,
            betType: b.betType,
            payload: payload as never,
            amount: b.amount,
            status: 'PENDING',
          },
        });
        await this.points.transferInTx(
          tx,
          {
            type: 'PLAYER',
            id: playerId,
            remark: `投注 ${b.betType}`,
            idempotencyKey: `lottery_bet_player_${bet.id}`,
          },
          {
            type: (payload as { fly?: { type: OwnerType; id: string } }).fly?.type || 'PLATFORM',
            id: (payload as { fly?: { type: OwnerType; id: string } }).fly?.id || PLATFORM_OWNER_ID,
            idempotencyKey: `lottery_bet_house_${bet.id}`,
          },
          b.amount,
          { bizType: 'BET', refType: 'issue', refId: issue.id },
        );
        results.push({
          betId: bet.id,
          betType: b.betType,
          betValue: b.betValue,
          amount: b.amount,
        });
      }

      return {
        issueNo: issue.issueNo,
        openAt: issue.openAt,
        gameCode,
        count: results.length,
        totalAmount,
        bets: results,
      };
    }).then((res) => this.attachChatPosted(res, playerId, gameCode, bets, opts));
  }

  private async replayBatchIfAny(
    playerId: string,
    clientRequestId: string,
    expectedCount: number,
  ) {
    const first = await this.prisma.bet.findUnique({
      where: { clientRequestId: this.batchBetRequestId(clientRequestId, 0) },
      include: { issue: { select: { issueNo: true, openAt: true } } },
    });
    if (!first) return null;
    if (first.playerId !== playerId) {
      throw new BadRequestException('clientRequestId 已被占用');
    }
    const rows = await this.prisma.bet.findMany({
      where: {
        playerId,
        clientRequestId: { startsWith: `${clientRequestId}:` },
      },
      orderBy: { createdAt: 'asc' },
      select: {
        id: true,
        betType: true,
        amount: true,
        payload: true,
        clientRequestId: true,
      },
    });
    if (rows.length !== expectedCount) {
      throw new BadRequestException('clientRequestId 批次状态异常，请更换后重试');
    }
    const sorted = [...rows].sort((a, b) => {
      const ai = Number(String(a.clientRequestId).split(':').pop());
      const bi = Number(String(b.clientRequestId).split(':').pop());
      return ai - bi;
    });
    return {
      issueNo: first.issue?.issueNo ?? '',
      openAt: first.issue?.openAt ?? new Date(0),
      gameCode: '',
      count: sorted.length,
      totalAmount: sorted.reduce((s, r) => s + asMoney(r.amount), 0),
      bets: sorted.map((r) => {
        const payload = r.payload as { value?: string } | null;
        return {
          betId: r.id,
          betType: r.betType,
          betValue: payload?.value,
          amount: asMoney(r.amount),
        };
      }),
      replayed: true as const,
    };
  }

  private async attachChatPosted<T extends { issueNo: string; totalAmount: number; gameCode: string }>(
    res: T,
    playerId: string,
    gameCode: string,
    bets: Array<{ betType: string; betValue?: string; amount: number }>,
    opts?: { roomNo?: string; chatText?: string; plays?: RoomChatPlayLine[] },
  ) {
    /* 幂等回放不再重复写聊天 */
    if ((res as { replayed?: boolean }).replayed) {
      return { ...res, gameCode: res.gameCode || gameCode, chatPosted: true };
    }
    const labeled = bets.map((b) => ({
      play: formatLotteryPlayLabel(gameCode, b.betType, b.betValue),
      amount: b.amount,
      betType: b.betType,
      betValue: b.betValue,
    }));
    const chatText =
      (opts?.chatText && String(opts.chatText).trim()) ||
      labeled.map((p) => `${p.play}/${p.amount}`).join(' ');
    const fromChat = (() => {
      if (!opts?.chatText) return null;
      const out: RoomChatPlayLine[] = [];
      for (const part of String(opts.chatText).trim().split(/\s+/)) {
        if (!part) continue;
        const m = part.match(/^(.+)\/(\d+)$/);
        if (!m) return null;
        out.push({ play: m[1], amount: Number(m[2]) });
      }
      return out.length ? out : null;
    })();
    const plays = fromChat || opts?.plays || labeled;
    let chatPosted = false;
    const chatPayload = {
      playerId,
      roomNo: opts?.roomNo,
      gameCode,
      issueNo: res.issueNo,
      chatText,
      plays,
      totalAmount: res.totalAmount,
    };
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        const row = await this.roomChat.appendPlayerBet(chatPayload);
        chatPosted = row != null || !opts?.roomNo;
        if (row != null) break;
        if (!opts?.roomNo) break;
        this.logger.warn(
          `room chat bet skipped (no room): player=${playerId} game=${gameCode} issue=${res.issueNo}`,
        );
        break;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        this.logger.warn(
          `room chat bet write failed (attempt ${attempt}/2): player=${playerId} game=${gameCode} issue=${res.issueNo} err=${msg}`,
        );
        if (attempt < 2) {
          await new Promise((r) => setTimeout(r, 120));
          continue;
        }
        chatPosted = false;
      }
    }
    return { ...res, gameCode: res.gameCode || gameCode, chatPosted };
  }

  async placeBet(
    playerId: string,
    gameCode: string,
    betType: string,
    betValue: string | undefined,
    amount: number,
    clientRequestIdRaw?: string,
  ) {
    const clientRequestId = this.assertClientRequestId(clientRequestIdRaw);
    if (!isValidMoney(amount, 1)) throw new BadRequestException('投注额无效');

    const existing = await this.prisma.bet.findUnique({
      where: { clientRequestId },
      include: { issue: { select: { issueNo: true, openAt: true } }, game: { select: { code: true } } },
    });
    if (existing) {
      if (existing.playerId !== playerId) {
        throw new BadRequestException('clientRequestId 已被占用');
      }
      return {
        betId: existing.id,
        issueNo: existing.issue?.issueNo ?? '',
        openAt: existing.issue?.openAt ?? new Date(0),
        gameCode: existing.game?.code ?? gameCode,
        betType: existing.betType,
        betValue,
        amount: existing.amount,
        replayed: true as const,
      };
    }

    const game = await this.configCache.get(gameCode);
    if (!game || game.status !== 'ONLINE') throw new NotFoundException('游戏未上架');
    if (amount < asMoney(game.minBet) || amount > asMoney(game.maxBet)) {
      throw new BadRequestException(`投注额须在 ${asMoney(game.minBet)}~${asMoney(game.maxBet)} 之间`);
    }

    const gameDef = this.registry.get(gameCode);
    if (!gameDef) throw new BadRequestException('游戏类型不支持');
    if (!gameDef.validateBet(betType, betValue)) throw new BadRequestException('玩法参数无效');

    // 找当前可投注期号（PENDING + lockAt 未到）
    const now = new Date();
    const issue = await this.prisma.lotteryIssue.findFirst({
      where: {
        gameId: game.id,
        status: 'PENDING',
        lockAt: { gt: now },
        openAt: { gt: now },
      },
      orderBy: { openAt: 'asc' },
    });
    if (!issue) throw new BadRequestException('当前无可投注期，请等待下期');

    const payload: LotteryBetPayload = { betType, value: betValue };

    // 写注单 + 扣款 + 平台入账（事务；FOR UPDATE 堵开奖竞态）
    return this.prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      await this.lockIssueForBet(tx, issue.id);

      const house = await this.houseForPlayer(playerId);
      const { P } = this.flyDisk
        ? await this.flyDisk.resolvePlayerRate(playerId, house.roomId)
        : { P: 0.018 };
      const payloadWithFly = {
        ...payload,
        fly: {
          type: house.type,
          id: house.id,
          flying: house.flying,
          roomId: house.roomId,
          agentUserId: house.agentUserId,
          P,
        },
      };

      const bet = await tx.bet.create({
        data: {
          betNo: businessNo('LB'),
          clientRequestId,
          playerId, gameId: game.id,
          issueId: issue.id,
          betType, payload: payloadWithFly as never,
          amount, status: 'PENDING',
        },
      });

      await this.points.transferInTx(
        tx,
        {
          type: 'PLAYER',
          id: playerId,
          remark: `投注 ${betType}`,
          idempotencyKey: `lottery_bet_player_${bet.id}`,
        },
        {
          type: house.type,
          id: house.id,
          idempotencyKey: `lottery_bet_house_${bet.id}`,
        },
        amount,
        { bizType: 'BET', refType: 'issue', refId: issue.id },
      );

      return {
        betId: bet.id,
        issueNo: issue.issueNo,
        openAt: issue.openAt,
        gameCode,
        betType,
        betValue,
        amount,
      };
    });
  }

  /**
   * 取消当前可投注期内、本人全部 PENDING 注单并退回积分。
   * 仅 PENDING 且未封盘时可取消。
   */
  async cancelCurrentBets(playerId: string, gameCode: string) {
    const game = await this.configCache.get(gameCode);
    if (!game || game.status !== 'ONLINE') throw new NotFoundException('游戏未上架');

    const now = new Date();
    const issue = await this.prisma.lotteryIssue.findFirst({
      where: {
        gameId: game.id,
        status: 'PENDING',
        lockAt: { gt: now },
        openAt: { gt: now },
      },
      orderBy: { openAt: 'asc' },
    });
    if (!issue) throw new BadRequestException('当前期无可取消注单');

    return this.prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      /* 与下注/开奖互斥，避免封盘瞬间「退本 + 派彩」双付 */
      await tx.$queryRaw`SELECT id FROM "LotteryIssue" WHERE id = ${issue.id} FOR UPDATE`;

      const fresh = await tx.lotteryIssue.findUnique({
        where: { id: issue.id },
        select: { status: true, lockAt: true },
      });
      if (!fresh || fresh.status !== 'PENDING' || fresh.lockAt <= new Date()) {
        throw new BadRequestException('当前期无可取消注单');
      }

      const bets = await tx.bet.findMany({
        where: { issueId: issue.id, playerId, status: 'PENDING' },
      });
      if (!bets.length) throw new BadRequestException('当前期无可取消注单');

      let refunded = 0;
      let count = 0;
      for (const bet of bets) {
        const claimed = await tx.bet.updateMany({
          where: { id: bet.id, status: 'PENDING' },
          data: { status: 'CANCELLED', settledAt: new Date() },
        });
        if (claimed.count === 0) continue;

        const cFly = (bet.payload as { fly?: { type?: OwnerType; id?: string } } | null)?.fly;
        await this.points.transferInTx(
          tx,
          {
            type: cFly?.type || 'PLATFORM',
            id: cFly?.id || PLATFORM_OWNER_ID,
            idempotencyKey: `lottery_cancel_house_${bet.id}`,
          },
          {
            type: 'PLAYER',
            id: playerId,
            idempotencyKey: `lottery_cancel_player_${bet.id}`,
          },
          asMoney(bet.amount),
          {
            bizType: 'ADJUST',
            refType: 'issue',
            refId: issue.id,
            remark: `取消投注退回 ${bet.betType}`,
          },
        );
        refunded = roundMoney(refunded + asMoney(bet.amount));
        count += 1;
      }
      if (!count) throw new BadRequestException('当前期无可取消注单');

      return { issueNo: issue.issueNo, count, refunded };
    });
  }


  /**
   * 控奖：按「单房+单游戏+本局总下注」庄家留存比例，在 N 个候选开奖中
   * 挑「该房派彩最接近 总下注×(1-留存%)」的结果。
   * 该房该局无注单则跳过；仅一笔也控。多房同时控时按各房误差×下注额加权折中。
   */
  private async pickDrawWithControl(
    gameCode: string,
    serverSeed: string,
    gameDef: LotteryGameDef,
    payTable: LotteryPayTable,
    pendingBets: { amount: unknown; payload: unknown; playerId?: string }[],
  ): Promise<DrawResult> {
    const policies = this.control
      ? await this.control.getActiveHoldPolicies(gameCode)
      : [];
    const tries = policies.length ? CONTROL_FIXED_CANDIDATE_TRIES : 1;

    type RoomBucket = { roomId: string; bets: typeof pendingBets; stake: number };
    const byRoom = new Map<string, RoomBucket>();
    for (const b of pendingBets) {
      const fly = (b.payload as { fly?: { roomId?: string } } | null)?.fly;
      const rid = fly?.roomId;
      if (!rid) continue;
      let bucket = byRoom.get(rid);
      if (!bucket) {
        bucket = { roomId: rid, bets: [], stake: 0 };
        byRoom.set(rid, bucket);
      }
      bucket.bets.push(b);
      bucket.stake += asMoney(b.amount);
    }

    const active = policies
      .map((p) => {
        const bucket = byRoom.get(p.roomId);
        if (!bucket || bucket.bets.length < CONTROL_MIN_BET_COUNT) return null;
        const targetPayout = roundMoney(bucket.stake * (1 - p.holdRatio));
        return { policy: p, bucket, targetPayout };
      })
      .filter((x): x is NonNullable<typeof x> => !!x);

    if (!active.length) {
      return gameDef.draw(serverSeed, 'server', 1);
    }

    let best = gameDef.draw(serverSeed, 'server', 1);
    let bestScore = Number.POSITIVE_INFINITY;
    for (let nonce = 1; nonce <= tries; nonce++) {
      const cand = nonce === 1 ? best : gameDef.draw(serverSeed, 'server', nonce);
      let score = 0;
      for (const a of active) {
        const pay = this.estimatePayout(gameDef, payTable, cand, a.bucket.bets);
        const err = Math.abs(pay - a.targetPayout);
        score += err * Math.max(a.bucket.stake, 1);
      }
      if (score < bestScore) {
        bestScore = score;
        best = cand;
      }
    }

    this.logger.log(
      `control hold game=${gameCode} rooms=${active.length} tries=${tries} score~=${Math.round(bestScore)}`,
    );
    return best;
  }

  private estimatePayout(
    gameDef: LotteryGameDef,
    payTable: LotteryPayTable,
    draw: DrawResult,
    pendingBets: { amount: unknown; payload: unknown }[],
  ) {
    let total = 0;
    for (const b of pendingBets) {
      const payload = (b.payload || {}) as LotteryBetPayload;
      const hit = gameDef.judge(payload, draw, payTable);
      if (!hit) continue;
      const mult = payTable[hit]?.multiplier ?? 0;
      total += asMoney(b.amount) * mult;
    }
    return total;
  }

  // ─── 查询 ─────────────────────────────────────────────

  /** 当前期信息（不暴露 serverSeed） */
  async currentIssue(gameCode: string) {
    const game = await this.prisma.game.findUnique({ where: { code: gameCode } });
    if (!game) throw new NotFoundException('游戏不存在');

    const now = new Date();
    const issue = await this.prisma.lotteryIssue.findFirst({
      where: { gameId: game.id, openAt: { gt: now } },
      orderBy: { openAt: 'asc' },
      select: { id: true, issueNo: true, status: true, openAt: true, lockAt: true, serverSeedHash: true },
    });
    return issue;
  }

  /** 历史开奖（最近 N 期） */
  async history(gameCode: string, limit = 10) {
    const game = await this.prisma.game.findUnique({ where: { code: gameCode } });
    if (!game) throw new NotFoundException('游戏不存在');

    return this.prisma.lotteryIssue.findMany({
      where: { gameId: game.id, status: 'DRAWN' },
      orderBy: { openAt: 'desc' },
      take: limit,
      select: {
        id: true, issueNo: true, drawNumbers: true, drawnAt: true,
        openAt: true, serverSeed: true, serverSeedHash: true, totalFlow: true,
      },
    });
  }

  /** 玩家自己的投注记录（可按期号过滤） */
  async myBets(
    playerId: string,
    gameCode: string,
    page = 1,
    pageSize = 20,
    issueNo?: string,
  ) {
    const game = await this.prisma.game.findUnique({ where: { code: gameCode } });
    if (!game) throw new NotFoundException('游戏不存在');

    const wantIssue = issueNo != null ? String(issueNo).trim() : '';
    const where: Prisma.BetWhereInput = { playerId, gameId: game.id };

    // 按期号核对时：必须命中本游戏该期；期号不存在则直接空列表（禁止退化成全历史）
    if (wantIssue) {
      const issue = await this.prisma.lotteryIssue.findUnique({
        where: { gameId_issueNo: { gameId: game.id, issueNo: wantIssue } },
        select: { id: true },
      });
      if (!issue) {
        return { total: 0, page: 1, pageSize: 0, list: [] };
      }
      where.issueId = issue.id;
    }

    const take = Math.min(Math.max(pageSize, 1), wantIssue ? 100 : 50);
    const [total, list] = await this.prisma.$transaction([
      this.prisma.bet.count({ where }),
      this.prisma.bet.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: wantIssue ? 0 : (page - 1) * take,
        take,
        include: { issue: { select: { issueNo: true, drawNumbers: true, openAt: true } } },
      }),
    ]);
    return { total, page, pageSize: take, list };
  }

  /** 活跃赔率表：与结算同一份 GameConfig.payTable */
  async getPayTable(gameCode: string) {
    const game = await this.configCache.get(gameCode);
    if (!game || !game.configs[0]) throw new NotFoundException('游戏不存在或未配置');
    return {
      gameCode,
      payTable: (game.configs[0].payTable || {}) as unknown as LotteryPayTable,
    };
  }
}
