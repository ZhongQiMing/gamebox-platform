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
import { resolveTimeWindow } from '../../common/shanghai-range';
import {
  asMoney, capWin, highOddsBetCap, isValidMoney, parsePlayLimits, resolvePlayBetRange, roundMoney,
} from '@gamebox/shared';
import { businessNo } from '../game-core/business-id';
import { RoomChatService } from '../rooms/room-chat.service';
import type { RoomChatPlayLine } from '../rooms/room-chat.types';
import { formatLotteryPlayLabel } from './play-label';
import { lotteryPlayLimitKey } from './play-limit-key';
import { assertAmountInPlayRange } from '../games/game-play-catalog';
import { lotteryPrepSec } from './lottery-intervals';
import { ConsoleControlService } from '../console/console-control.service';
import { GlobalSoftControlService } from '../console/global-soft-control.service';
import {
  CONTROL_PLAYER_WIN_HOUSE_FLOOR,
} from '../console/control.constants';
import {
  decidePeriodGuard,
  globalDayNetScore,
  isBetterSoftGlobalPick,
  periodCandidateLegal,
  periodLossScore,
  softBiasScore,
  type SoftPickRank,
} from '../console/control-pick.util';
import { FlyDiskService } from '../console/fly-disk.service';
import { FlyRebateService } from '../console/fly-rebate.service';
import { SoftControlAuditService } from '../console/soft-control-audit.service';
import { withTxRetry } from '../../prisma/tx-retry';
import {
  closedDiskDebitBetInTx,
  closedDiskHouseUserId,
  closedDiskRefundBetInTx,
  closedDiskSettleWinInTx,
} from '../console/player-fund.helper';
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

/** 开奖号码摘要：给人看的一行字，用来事后核对「本来会开什么、最后开了什么」 */
function drawDigest(d: { numbers?: number[]; sum?: number } | null | undefined): string {
  if (!d) return '';
  const nums = Array.isArray(d.numbers) ? d.numbers.join(',') : '';
  return `${nums}${d.sum != null ? ` 和=${d.sum}` : ''}`.slice(0, 120);
}

function genSeedPair() {
  const serverSeed = randomBytes(16).toString('hex');
  const serverSeedHash = createHash('sha256').update(serverSeed).digest('hex');
  return { serverSeed, serverSeedHash };
}

@Injectable()
export class LotteryService {
  private readonly logger = new Logger(LotteryService.name);

  /**
   * 游戏内快照缓存。
   *
   * H5 每 2 秒拉一次 /snapshot，内容对同一游戏的所有玩家完全一样（没有按人区分的字段），
   * 但原来每个请求都实打实走 4 条查询——currentIssue 和 history 各自又查了一遍 game 行。
   * 一个游戏 500 人在线就是 1000 查询/秒，而且负载是跟人数走的，这是上线后最大的单点。
   *
   * TTL 取 1 秒：倒计时用的是 openAt / lockAt 绝对时间戳、由前端本地推算，缓存不会让它卡住；
   * 1 秒也短于一个轮询间隔，开奖结果最多迟一秒露出，同时已经把并发塌成每秒一次查询。
   */
  private static readonly SNAPSHOT_TTL_MS = 1_000;
  private readonly snapshotCache = new Map<string, { at: number; data: unknown }>();
  private readonly snapshotInflight = new Map<string, Promise<unknown>>();

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
    @Optional() @Inject(forwardRef(() => GlobalSoftControlService))
    private globalSoft?: GlobalSoftControlService,
    @Optional() private flyDisk?: FlyDiskService,
    @Optional() private flyRebate?: FlyRebateService,
    @Optional() private softAudit?: SoftControlAuditService,
  ) {}

  private async houseForPlayer(
    playerId: string,
    stakeAmount: number | undefined,
    roomNo?: string | null,
  ) {
    if (!this.flyDisk) {
      return { type: 'PLATFORM' as OwnerType, id: PLATFORM_OWNER_ID, flying: false };
    }
    const opsRoomId = await this.flyDisk.requireOpsRoomId(playerId, roomNo);
    return this.flyDisk.resolveHouse(playerId, opsRoomId, stakeAmount, { requireRoom: true });
  }

  // ─── 期号管理 ─────────────────────────────────────────

  /**
   * 预创期号，保证队列里始终有 N 期待开（scheduler 每 15s 调用）
   * @param gameCode  游戏 code
   * @param intervalSec  开奖间隔秒数
   * @param ahead  未来待开期目标条数，不足才补（默认 3）
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

    /*
     * ahead 是「队列里要留几期未来待开」，不是「每次再铺几期」。
     *
     * 原先无条件从最远一期后面再铺 ahead 期，而本方法每 15s 被调一次，于是每分钟把
     * 队列往未来推 4×ahead 期，永远追不上也永远不停：实测一天堆出 12 万行空期号、
     * 最远排到 15 天后。除了白占库和拖慢每 2s 一次的待开期扫描，期号和开奖时间还被
     * 提前钉死，改动开奖间隔后这些期全部作废。这里只补足差额。
     */
    const aheadCount = await this.prisma.lotteryIssue.count({
      where: {
        gameId: game.id,
        status: { in: ['PENDING', 'LOCKED'] },
        openAt: { gt: new Date() },
      },
    });
    const need = ahead - aheadCount;
    if (need <= 0) return;

    let nextOpen = last
      ? new Date(last.openAt.getTime() + intervalSec * 1000)
      : this._nextAlignedTime(intervalSec);

    for (let i = 0; i < need; i++) {
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
   * 封盘：lockAt → LOCKED，推封盘线 + 注单核对；
   * 预生成开奖号码并推结果卡供动画，但注单/积分仍待 openAt 再结算。
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
      try {
        await this.prepareDraw(issue.id);
      } catch (e) {
        this.logger.error(`prepare-after-lock[${issue.issueNo}] failed: ${(e as Error).message}`);
      }
    }
  }

  /**
   * 封盘后预开奖：写入号码供仪式动画，状态保持 LOCKED，不派彩、不改注单。
   */
  async prepareDraw(issueId: string) {
    const issue = await this.prisma.lotteryIssue.findUnique({
      where: { id: issueId },
      include: { game: true },
    });
    if (!issue || issue.status === 'DRAWN' || issue.status === 'CANCELLED') return;

    let nums: number[] | null = null;
    if (issue.drawNumbers) {
      try {
        const parsed = JSON.parse(issue.drawNumbers);
        if (Array.isArray(parsed)) nums = parsed.map(Number);
      } catch { /* ignore */ }
    }

    if (!nums) {
      const gameDef = this.registry.get(issue.game.code);
      if (!gameDef || !issue.serverSeed) return;

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
      const picked = await this.pickDrawWithControl(
        issue.game.code,
        issue.serverSeed,
        gameDef,
        payTable,
        pendingBets,
      );
      const { result: drawResult, nonce: drawNonce, softCommit } = picked;

      const claimed = await this.prisma.lotteryIssue.updateMany({
        where: {
          id: issue.id,
          status: { in: ['PENDING', 'LOCKED'] },
          drawNumbers: null,
        },
        data: {
          status: 'LOCKED',
          drawNumbers: JSON.stringify(drawResult.numbers),
          nonce: drawNonce,
        },
      });
      if (claimed.count === 0) {
        const again = await this.prisma.lotteryIssue.findUnique({
          where: { id: issue.id },
          select: { drawNumbers: true },
        });
        if (!again?.drawNumbers) return;
        try {
          const parsed = JSON.parse(again.drawNumbers);
          if (Array.isArray(parsed)) nums = parsed.map(Number);
        } catch { return; }
      } else {
        nums = drawResult.numbers.map(Number);
        /* 仅赢家提交冷却副作用，避免 CAS 失败空烧/误清冷却 */
        try {
          if (this.globalSoft) {
            await this.globalSoft.commitSoftDraw(issue.game.code, softCommit);
          }
        } catch {
          /* 冷却失败不影响开奖 */
        }
        /* 介入留痕：只有 ADMIN 能查，写失败也不能拖累开奖 */
        if (picked.audit && this.softAudit) {
          await this.softAudit.record({
            category: 'lottery',
            gameCode: issue.game.code,
            refNo: issue.issueNo,
            refId: issue.id,
            ...picked.audit,
          });
        }
      }
    }

    if (!nums?.length) return;
    try {
      await this.roomChat.fanOutIssueResult(issue.game.code, issue.issueNo, nums);
    } catch {
      /* 聊天失败不影响预开奖 */
    }
  }

  /**
   * openAt 到期后正式结算：派彩入账 + DRAWN + 中奖核对。
   * openAt 未到时只做 prepareDraw（供封盘动画），不改积分。
   */
  async draw(issueId: string) {
    let issue = await this.prisma.lotteryIssue.findUnique({
      where: { id: issueId },
      include: { game: true },
    });
    if (!issue || issue.status === 'DRAWN' || issue.status === 'CANCELLED') return;

    const now = new Date();
    if (issue.openAt.getTime() > now.getTime()) {
      await this.prepareDraw(issueId);
      return;
    }

    if (!issue.drawNumbers) {
      await this.prepareDraw(issueId);
      issue = await this.prisma.lotteryIssue.findUnique({
        where: { id: issueId },
        include: { game: true },
      });
      if (!issue || issue.status === 'DRAWN' || issue.status === 'CANCELLED') return;
    }

    const gameDef = this.registry.get(issue.game.code);
    if (!gameDef || !issue.serverSeed) return;

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
    const drawNonce = issue.nonce && issue.nonce > 0 ? issue.nonce : 1;
    const drawResult = gameDef.draw(issue.serverSeed, 'server', drawNonce);

    const bigWins: Array<{ betId: string; playerId: string; amount: number; payout: number }> = [];
    const biasTouches: Array<{ roomId: string; playerId: string; stake: number; payout: number }> = [];
    /*
     * 在事务内结算所有注单。
     * 死锁自动重试：与回水领取撞车时 Postgres 会杀掉一方，
     * 不重试就表现为「整期开奖失败」。回滚是完整的，重放不会重复派彩。
     */
    await withTxRetry(() => this.prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      // CAS 抢占：事务第一条语句拿下期号行锁并推进状态，
      // 并发 draw 只有一个能抢到（count=1），其余直接返回，根治双开奖。
      const claimed = await tx.lotteryIssue.updateMany({
        where: { id: issue.id, status: { in: ['PENDING', 'LOCKED'] } },
        data: {
          status: 'DRAWN',
          drawNumbers: JSON.stringify(drawResult.numbers),
          drawnAt: new Date(),
          nonce: drawNonce,
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
        const { payout, odds, raw, capped } = this.lotterySettleMath(amt, hitKey, payTable);
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
          type?: string; id?: string; flying?: boolean; agentUserId?: string;
          generalUserId?: string; sitting?: 'PLATFORM' | 'GENERAL' | 'AGENT';
          roomId?: string; bookMode?: string;
          agentPkg?: number; generalPkg?: number;
        } } | null)?.fly;
        const touchRoomId = String(flyMeta?.roomId || '').trim();
        if (touchRoomId && !isRefund) {
          biasTouches.push({
            roomId: touchRoomId,
            playerId: bet.playerId,
            stake: amt,
            payout,
          });
        }
        const houseType = (flyMeta?.type as OwnerType) || 'PLATFORM';
        const flying = !!flyMeta?.flying;

        if (won && (flying || houseType !== 'AGENT')) {
          const winRoomId = String(flyMeta?.roomId || '').trim();
          if (!winRoomId) {
            throw new BadRequestException(`派彩缺少房间快照 bet=${bet.id}`);
          }
          await this.points.transferInTx(
            tx,
            {
              type: 'PLATFORM',
              id: PLATFORM_OWNER_ID,
              idempotencyKey: `win_house_${bet.id}`,
            },
            {
              type: 'PLAYER',
              id: bet.playerId,
              roomId: winRoomId,
              remark: `${issue.game.name} ${issue.issueNo} 开奖`,
              idempotencyKey: `win_player_${bet.id}`,
            },
            payout,
            { bizType: 'WIN', refType: 'issue', refId: issue.id },
          );
        }

        if (!flying && houseType === 'AGENT') {
          /* 关盘：含和局退本；现金只动玩家持分 */
          await closedDiskSettleWinInTx(tx, this.points, {
            playerId: bet.playerId,
            agentUserId: closedDiskHouseUserId(flyMeta),
            roomId: flyMeta?.roomId,
            bookMode: flyMeta?.bookMode,
            stake: amt,
            payout: won ? payout : 0,
            remark: `${issue.game.name} ${issue.issueNo} 开奖(关盘)`,
            refType: 'issue',
            refId: issue.id,
            idemPlayer: `win_player_${bet.id}`,
            idemAgent: `win_agent_${bet.id}`,
          });
        }
        if (this.flyRebate && !isRefund) {
          await this.flyRebate.payBetFlowInTx(tx, {
            betId: bet.id,
            playerId: bet.playerId,
            validFlow: amt,
            flying,
            roomId: flyMeta?.roomId,
            agentUserId: flyMeta?.agentUserId,
            generalUserId: flyMeta?.generalUserId,
            sitting: flyMeta?.sitting,
            bookMode: flyMeta?.bookMode,
            gameCode: issue.game.code,
            /* 用下注当时定死的整包比例结算，而不是开奖这一刻的现值 */
            rateSnapshot: flyMeta,
          });
        }
      }

      await tx.lotteryIssue.update({
        where: { id: issue.id },
        data: { totalFlow: settledFlow },
      });
    }), { label: `彩票开奖 ${issue.game.code} ${issue.issueNo}` });

    /* 事务成功后：补封盘线（若跳过 LOCKED）+ 结果卡（若未预推）+ 中奖核对 */
    try {
      const nums = Array.isArray(drawResult.numbers) ? drawResult.numbers.map(Number) : [];
      await this.roomChat.fanOutIssueLocked(issue.game.code, issue.issueNo);
      await this.roomChat.fanOutIssueResult(issue.game.code, issue.issueNo, nums);
      await this.roomChat.fanOutIssueWinVerify(issue.game.code, issue.issueNo, nums);
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
    try {
      if (this.globalSoft && biasTouches.length) {
        await this.globalSoft.applySoftBiasProgress(biasTouches);
      }
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

    const batchPayTable = (game.configs[0]?.payTable || {}) as unknown as LotteryPayTable;
    for (const b of bets) {
      if (!isValidMoney(b.amount, 1)) throw new BadRequestException('投注额无效');
      if (!gameDef.validateBet(b.betType, b.betValue)) {
        throw new BadRequestException(`玩法参数无效: ${b.betType}`);
      }
      this.assertLotteryPlayAmount(game, gameDef, batchPayTable, b);
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
    /* 整批按合计额判断能否飞；不足则整批关盘、代理坐庄；必须带 roomNo */
    const batchHouse = await this.houseForPlayer(playerId, totalAmount, opts?.roomNo);
    /* 三个比例都在下注这一刻定死，开奖结算时按快照发放，不受期间调整影响 */
    const batchP: { P: number; agentPkg?: number; generalPkg?: number } = this.flyDisk
      ? await this.flyDisk.resolvePlayerRate(playerId, batchHouse.roomId, gameCode)
      : { P: 0.018 };

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
        const house = batchHouse;
        const { P, agentPkg, generalPkg } = batchP;
        const payload: LotteryBetPayload & { fly?: object } = {
          betType: b.betType, value: b.betValue,
          fly: {
            type: house.type, id: house.id, flying: house.flying,
            roomId: house.roomId, agentUserId: house.agentUserId,
            generalUserId: house.generalUserId, sitting: house.sitting,
            bookMode: house.bookMode, P, agentPkg, generalPkg,
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
        if (house.flying || house.type !== 'AGENT') {
          const betRoomId = String(house.roomId || '').trim();
          if (!betRoomId) throw new BadRequestException('下注缺少房间');
          await this.points.transferInTx(
            tx,
            {
              type: 'PLAYER',
              id: playerId,
              roomId: betRoomId,
              remark: `投注 ${b.betType}`,
              idempotencyKey: `lottery_bet_player_${bet.id}`,
            },
            {
              type: 'PLATFORM',
              id: PLATFORM_OWNER_ID,
              idempotencyKey: `lottery_bet_house_${bet.id}`,
            },
            b.amount,
            { bizType: 'BET', refType: 'issue', refId: issue.id },
          );
        } else {
          await closedDiskDebitBetInTx(tx, this.points, {
            playerId,
            agentUserId: closedDiskHouseUserId(house),
            roomId: house.roomId,
            bookMode: house.bookMode,
            amount: b.amount,
            remark: `投注 ${b.betType}(关盘)`,
            refType: 'issue',
            refId: issue.id,
            idemPlayer: `lottery_bet_player_${bet.id}`,
            idemAgent: `lottery_bet_agent_${bet.id}`,
          });
        }
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
    roomNo?: string | null,
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

    const gameDef = this.registry.get(gameCode);
    if (!gameDef) throw new BadRequestException('游戏类型不支持');
    if (!gameDef.validateBet(betType, betValue)) throw new BadRequestException('玩法参数无效');
    this.assertLotteryPlayAmount(
      game,
      gameDef,
      (game.configs[0]?.payTable || {}) as unknown as LotteryPayTable,
      { betType, betValue, amount },
    );

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

      const house = await this.houseForPlayer(playerId, amount, roomNo);
      /* 三个比例都在下注这一刻定死，开奖结算时按快照发放，不受期间调整影响 */
      const rates: { P: number; agentPkg?: number; generalPkg?: number } = this.flyDisk
        ? await this.flyDisk.resolvePlayerRate(playerId, house.roomId, gameCode)
        : { P: 0.018 };
      const payloadWithFly = {
        ...payload,
        fly: {
          type: house.type,
          id: house.id,
          flying: house.flying,
          roomId: house.roomId,
          agentUserId: house.agentUserId,
          generalUserId: house.generalUserId,
          sitting: house.sitting,
          bookMode: house.bookMode,
          P: rates.P,
          agentPkg: rates.agentPkg,
          generalPkg: rates.generalPkg,
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

      if (house.flying || house.type !== 'AGENT') {
        const betRoomId = String(house.roomId || '').trim();
        if (!betRoomId) throw new BadRequestException('下注缺少房间');
        await this.points.transferInTx(
          tx,
          {
            type: 'PLAYER',
            id: playerId,
            roomId: betRoomId,
            remark: `投注 ${betType}`,
            idempotencyKey: `lottery_bet_player_${bet.id}`,
          },
          {
            type: 'PLATFORM',
            id: PLATFORM_OWNER_ID,
            idempotencyKey: `lottery_bet_house_${bet.id}`,
          },
          amount,
          { bizType: 'BET', refType: 'issue', refId: issue.id },
        );
      } else {
        await closedDiskDebitBetInTx(tx, this.points, {
          playerId,
          agentUserId: closedDiskHouseUserId(house),
          roomId: house.roomId,
          bookMode: house.bookMode,
          amount,
          remark: `投注 ${betType}(关盘)`,
          refType: 'issue',
          refId: issue.id,
          idemPlayer: `lottery_bet_player_${bet.id}`,
          idemAgent: `lottery_bet_agent_${bet.id}`,
        });
      }

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

        const cFly = (bet.payload as {
          fly?: {
            type?: OwnerType;
            id?: string;
            flying?: boolean;
            agentUserId?: string;
            roomId?: string;
            bookMode?: string;
          };
        } | null)?.fly;
        const amt = asMoney(bet.amount);
        if (cFly?.flying || cFly?.type !== 'AGENT') {
          const cancelRoomId = String(cFly?.roomId || '').trim();
          if (!cancelRoomId) {
            throw new BadRequestException(`取消投注缺少房间 bet=${bet.id}`);
          }
          await this.points.transferInTx(
            tx,
            {
              type: 'PLATFORM',
              id: PLATFORM_OWNER_ID,
              idempotencyKey: `lottery_cancel_house_${bet.id}`,
            },
            {
              type: 'PLAYER',
              id: playerId,
              roomId: cancelRoomId,
              idempotencyKey: `lottery_cancel_player_${bet.id}`,
            },
            amt,
            {
              bizType: 'ADJUST',
              refType: 'issue',
              refId: issue.id,
              remark: `取消投注退回 ${bet.betType}`,
            },
          );
        } else {
          await closedDiskRefundBetInTx(tx, this.points, {
            playerId,
            agentUserId: closedDiskHouseUserId(cFly),
            roomId: cFly?.roomId,
            bookMode: cFly?.bookMode,
            amount: amt,
            remark: `取消投注退回 ${bet.betType}(关盘)`,
            refType: 'issue',
            refId: issue.id,
            idemPlayer: `lottery_cancel_player_${bet.id}`,
            idemAgent: `lottery_cancel_agent_${bet.id}`,
          });
        }
        refunded = roundMoney(refunded + amt);
        count += 1;
      }
      if (!count) throw new BadRequestException('当前期无可取消注单');

      return { issueNo: issue.issueNo, count, refunded };
    });
  }


  /**
   * 全站软控统一挑号（只看本期总账，不认玩法）：
   *
   * 1. 自然结果庄家亏没过开档线 → 不动。覆盖打法（买 9 个漏 1 个）
   *    亏损比例本来就低，进不了这层，不会出现「专开你没买的号」。
   * 2. 过线 → 在「亏不过线」的候选里朝目标亏损靠；同分优先赢家人数多的。
   * 3. 只剩通杀候选时才看金额门：小额认赔、小盘不杀、周期赚够也认赔。
   */
  private async pickDrawWithControl(
    gameCode: string,
    serverSeed: string,
    gameDef: LotteryGameDef,
    payTable: LotteryPayTable,
    pendingBets: { amount: unknown; payload: unknown; playerId?: string }[],
  ): Promise<{
    result: DrawResult;
    nonce: number;
    softCommit: 'none' | 'mark' | 'consume';
    /** 介入时的留痕素材；未介入为空 */
    audit?: {
      reason: string;
      tries: number;
      naturalDigest: string;
      adoptedDigest: string;
      stake: number;
      estPayout: number;
    };
  }> {
    const natural = gameDef.draw(serverSeed, 'server', 1);
    const globalRt = this.globalSoft
      ? await this.globalSoft.getDrawRuntime(gameCode)
      : null;

    if (!globalRt?.needPick) {
      return {
        result: natural,
        nonce: 1,
        softCommit: globalRt?.cooldownActive ? 'consume' : 'none',
      };
    }

    type RoomBucket = { roomId: string; bets: typeof pendingBets; stake: number };
    const byRoom = new Map<string, RoomBucket>();
    let periodStake = 0;
    for (const b of pendingBets) {
      const amt = asMoney(b.amount);
      periodStake = roundMoney(periodStake + amt);
      const rid = (b.payload as { fly?: { roomId?: string } } | null)?.fly?.roomId;
      if (!rid) continue;
      let bucket = byRoom.get(rid);
      if (!bucket) {
        bucket = { roomId: rid, bets: [], stake: 0 };
        byRoom.set(rid, bucket);
      }
      bucket.bets.push(b);
      bucket.stake = roundMoney(bucket.stake + amt);
    }

    /* 空注/零流水：自然开奖，不占冷却 */
    if (periodStake <= 1e-9) {
      return { result: natural, nonce: 1, softCommit: 'none' };
    }

    let brakeKeys = new Set<string>();
    if (globalRt.playerBrakeEnabled && this.globalSoft) {
      const brakeTargets: Array<{ playerId: string; roomId: string }> = [];
      for (const b of pendingBets) {
        if (!b.playerId) continue;
        const rid = String(
          (b.payload as { fly?: { roomId?: string } } | null)?.fly?.roomId || '',
        ).trim();
        if (!rid) continue;
        brakeTargets.push({ playerId: b.playerId, roomId: rid });
      }
      brakeKeys = await this.globalSoft.playersNeedingBrake(
        brakeTargets,
        globalRt.playerBrakeMultiple,
      );
    }
    const brakeFirst = brakeKeys.size > 0;
    const biases = globalRt.biases || [];

    const naturalPay = this.estimatePayout(gameDef, payTable, natural, pendingBets);
    const playerCount = new Set(
      pendingBets.map((b) => b.playerId).filter(Boolean) as string[],
    ).size;
    const guard = decidePeriodGuard({
      periodStake,
      naturalPayout: naturalPay,
      playerCount,
      cycleProfit: globalRt.cycleProfit,
      params: globalRt.periodGuard,
    });

    /* 正常开奖：单期没超亏、无偏置、无缓刹 → 一号不挑 */
    if (!guard.steer && biases.length === 0 && !brakeFirst) {
      return { result: natural, nonce: 1, softCommit: 'none' };
    }

    const tries = Math.max(1, globalRt.tries);
    const periodCommission = roundMoney(periodStake * (globalRt.commissionRatePct / 100));
    const dayTol = Math.max(1, periodStake * 0.001 + globalRt.dayF * 0.0005);

    let best = natural;
    let bestNonce = 1;
    /* 被采用候选的预估派彩，只用于介入留痕 */
    let bestPay = 0;
    let bestRank: SoftPickRank = {
      valid: false,
      day: Number.POSITIVE_INFINITY,
      bias: Number.POSITIVE_INFINITY,
      brake: Number.POSITIVE_INFINITY,
      period: Number.POSITIVE_INFINITY,
      winners: -1,
    };
    let sawLegal = false;

    for (let nonce = 1; nonce <= tries; nonce++) {
      const cand = nonce === 1 ? natural : gameDef.draw(serverSeed, 'server', nonce);
      /* 每注单独估一次，总派彩/分房/分人/赢家数共用这一趟 */
      const betPays = pendingBets.map(
        (b) => this.estimatePayout(gameDef, payTable, cand, [b]),
      );
      let periodPay = 0;
      for (const p of betPays) periodPay = roundMoney(periodPay + p);

      if (guard.steer && !periodCandidateLegal({
        periodStake,
        periodPayout: periodPay,
        decision: guard,
      })) continue;
      sawLegal = true;

      /* IDLE 仅偏置：不算日账主分，避免「开一条偏置全站隐性轻控」 */
      const day = globalRt.daySteer
        ? globalDayNetScore({
          dayF: globalRt.dayF,
          dayG: globalRt.dayG,
          dayC: globalRt.dayC,
          periodStake,
          periodPayout: periodPay,
          periodCommission,
          targetNetPct: globalRt.targetNetPct,
        })
        : 0;

      const period = guard.steer
        ? periodLossScore({
          periodStake,
          periodPayout: periodPay,
          targetLossPct: guard.targetLossPct,
        })
        : 0;

      const roomBooks = new Map<string, { stake: number; payout: number }>();
      const playerPayouts = new Map<string, number>();
      const winnerIds = new Set<string>();
      let brake = 0;
      for (let i = 0; i < pendingBets.length; i++) {
        const b = pendingBets[i];
        const pay = betPays[i];
        if (pay > 1e-9 && b.playerId) winnerIds.add(b.playerId);
        const rid = String(
          (b.payload as { fly?: { roomId?: string } } | null)?.fly?.roomId || '',
        ).trim();
        if (!rid) continue;
        const bucket = byRoom.get(rid);
        const book = roomBooks.get(rid) || { stake: bucket?.stake ?? 0, payout: 0 };
        book.payout = roundMoney(book.payout + pay);
        roomBooks.set(rid, book);
        if (!b.playerId) continue;
        const key = `${rid}|${b.playerId}`;
        playerPayouts.set(key, roundMoney((playerPayouts.get(key) ?? 0) + pay));
        if (brakeKeys.has(key)) brake = roundMoney(brake + pay);
      }
      const biasRes = softBiasScore({
        biases,
        roomBooks,
        playerPayouts,
        houseFloor: CONTROL_PLAYER_WIN_HOUSE_FLOOR,
      });
      if (!biasRes.valid) continue;

      const rank: SoftPickRank = {
        valid: true,
        day,
        bias: biasRes.score,
        brake,
        period,
        winners: winnerIds.size,
      };
      if (isBetterSoftGlobalPick(rank, bestRank, dayTol, {
        brakeFirst,
        periodFirst: guard.steer,
      })) {
        bestRank = rank;
        best = cand;
        bestNonce = nonce;
        bestPay = periodPay;
      }
    }

    if (!sawLegal || !bestRank.valid) {
      this.logger.log(
        `control global game=${gameCode} gear=${globalRt.gear} fallback=natural ` +
          `biasN=${biases.length} steer=${guard.steer} why=${guard.reason} ` +
          `dayR=${globalRt.dayR ?? 'n/a'}`,
      );
      return { result: natural, nonce: 1, softCommit: 'none' };
    }

    const sameAsNatural = bestNonce === 1;
    /* 触发来源：留痕要能回答「为什么改」，不能只留一个布尔 */
    const reasons: string[] = [];
    if (guard.steer) reasons.push('period');
    if (globalRt.daySteer) reasons.push('dayNet');
    if (biases.length) reasons.push('bias');
    if (brakeFirst) reasons.push('brake');
    this.logger.log(
      `control global game=${gameCode} mode=${globalRt.mode} gear=${globalRt.gear} ` +
        `tries=${tries} nonce=${bestNonce} steer=${guard.steer} ` +
        `wipeout=${guard.allowWipeout} why=${guard.reason} ` +
        `winners=${bestRank.winners} period~=${Math.round(bestRank.period ?? 0)} ` +
        `day~=${Math.round(bestRank.day)} bias~=${Math.round(bestRank.bias)} ` +
        `biasN=${biases.length} brakeN=${brakeKeys.size} brakeFirst=${brakeFirst} ` +
        `soft=${sameAsNatural ? 'none' : 'mark'}`,
    );
    return {
      result: best,
      nonce: bestNonce,
      softCommit: sameAsNatural ? 'none' : 'mark',
      audit: sameAsNatural
        ? undefined
        : {
            reason: reasons.length ? reasons.join('+') : 'unknown',
            tries,
            naturalDigest: drawDigest(natural),
            adoptedDigest: drawDigest(best),
            stake: periodStake,
            estPayout: bestPay,
          },
    };
  }

  /**
   * 按玩法限红。单独配过的用后台那条；没配则游戏默认限红，
   * 高赔玩法再叠一层默认硬顶（四全中这类）。
   */
  private assertLotteryPlayAmount(
    game: { minBet: unknown; maxBet: unknown; playLimits?: unknown },
    gameDef: LotteryGameDef,
    payTable: LotteryPayTable,
    bet: { betType: string; betValue?: string | number; amount: number },
  ): void {
    const key = lotteryPlayLimitKey(bet.betType, bet.betValue, payTable);
    const payload: LotteryBetPayload = { betType: bet.betType, value: bet.betValue };
    const odds = gameDef.maxOdds
      ? gameDef.maxOdds(payload, payTable)
      : (payTable[bet.betType]?.multiplier ?? 0);
    const limits = parsePlayLimits(game.playLimits);
    const extraMax = limits[key] ? null : highOddsBetCap(odds);
    const range = resolvePlayBetRange({
      gameMin: asMoney(game.minBet),
      gameMax: asMoney(game.maxBet),
      playLimits: limits,
      playKey: key,
      extraMax,
    });
    assertAmountInPlayRange(bet.amount, range);
  }

  /**
   * 与 draw() 入账同一套赔付数学：refund 缺表项按 1 倍退本 + capWin 封顶。
   * 软控估派必须走此函数，禁止另算裸倍率。
   */
  private lotterySettleMath(
    amount: number,
    hitKey: string | null | undefined,
    payTable: LotteryPayTable,
  ): { payout: number; odds: number; raw: number; capped: boolean } {
    if (!hitKey) return { payout: 0, odds: 0, raw: 0, capped: false };
    const odds = hitKey === 'refund'
      ? (payTable[hitKey]?.multiplier ?? 1)
      : (payTable[hitKey]?.multiplier ?? 0);
    const raw = roundMoney(amount * odds);
    /* 挂牌赔率高于 5000 倍的玩法（六合彩四全中 9000）按赔率放行，只留绝对额封顶 */
    const { win: payout, capped } = capWin(amount, raw, odds);
    return { payout, odds, raw, capped };
  }

  /** 软控挑号用：逐注累加，口径 = 真实结算派彩 */
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
      const amt = asMoney(b.amount);
      total = roundMoney(total + this.lotterySettleMath(amt, hit, payTable).payout);
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

  /**
   * 当前期 + 历史开奖合并（游戏内高频轮询入口）。
   *
   * 未知 gameCode 会让底层抛 NotFound，promise 走 reject、不落缓存，
   * 所以拿随便编的 code 刷不出缓存条目；键的规模就是「有效游戏数 × limit」，有界。
   */
  async snapshot(gameCode: string, limit: number) {
    const key = `${gameCode}:${limit}`;
    /*
     * now 是客户端校时的唯一基准，必须逐次现取。
     * 它一旦跟着 current/history 进缓存，命中缓存的那一秒内所有玩家拿到的都是同一个
     * 旧时刻，校出来的偏移最多差一整个 TTL，倒计时反而更不准。
     */
    const hit = this.snapshotCache.get(key);
    if (hit && Date.now() - hit.at < LotteryService.SNAPSHOT_TTL_MS) {
      return { ...(hit.data as object), now: Date.now() };
    }

    /* 缓存刚过期的瞬间会有一批请求同时落到 DB，这里把它们并到同一次查询上 */
    const running = this.snapshotInflight.get(key);
    if (running) return { ...((await running) as object), now: Date.now() };

    const promise = (async () => {
      const [current, history] = await Promise.all([
        this.currentIssue(gameCode),
        this.history(gameCode, Math.min(limit, 80)),
      ]);
      return { current, history };
    })();
    this.snapshotInflight.set(key, promise);
    try {
      const data = await promise;
      this.snapshotCache.set(key, { at: Date.now(), data });
      return { ...data, now: Date.now() };
    } finally {
      if (this.snapshotInflight.get(key) === promise) this.snapshotInflight.delete(key);
    }
  }

  /**
   * 历史开奖（最近 N 期）。
   *
   * **不返回 nonce**：彩票的候选是「同一把种子的第 N 页」，nonce>1 就等于公开宣布
   * 这一期放弃了自然结果。种子与指纹照常公布，玩家仍能用 seed:server:nonce 复算——
   * 只是那个 nonce 由后台留痕持有，不再挂在公开接口上。
   * 牌桌已在改独立候选种子时堵掉同类泄漏，这里补齐彩票这一侧。
   */
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

  /** 玩家自己的投注记录（可按期号或时间窗过滤） */
  async myBets(
    playerId: string,
    gameCode: string,
    page = 1,
    pageSize = 20,
    issueNo?: string,
    window?: { range?: string; fromMs?: number; toMs?: number },
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
    } else if (window) {
      /*
       * 只在没指定期号时套时间窗：按期号查是「核对这一期」的动作，
       * 不该被界面上残留的日期筛选清空成空列表。
       */
      const bounds = resolveTimeWindow({
        range: window.range,
        fromMs: window.fromMs,
        toMs: window.toMs,
      });
      if (bounds) where.createdAt = { gte: bounds[0], lt: bounds[1] };
    }

    const take = Math.min(Math.max(pageSize, 1), wantIssue ? 100 : 50);
    const [total, list] = await this.prisma.$transaction([
      this.prisma.bet.count({ where }),
      this.prisma.bet.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: wantIssue ? 0 : (page - 1) * take,
        take,
        include: {
          issue: {
            select: { issueNo: true, drawNumbers: true, openAt: true, status: true },
          },
        },
      }),
    ]);
    /*
     * 开奖中（LOCKED）号码已预生成供动画，注单接口仍对玩家隐藏，避免偷看结果。
     *
     * 金额一律转成数字：Decimal 直接序列化会变成字符串，前端把「累计投注额」
     * 写成 sum += b.amount 时就成了字符串拼接，注单页出现
     * 「500,005,000.005,00…」这种越滚越长的数字。
     */
    const safeList = list.map((b) => {
      const money = {
        amount: asMoney(b.amount),
        payout: asMoney(b.payout),
        validFlow: asMoney(b.validFlow),
      };
      if (b.issue?.status === 'DRAWN') return { ...b, ...money };
      return {
        ...b,
        ...money,
        issue: b.issue
          ? { ...b.issue, drawNumbers: null as string | null }
          : b.issue,
      };
    });
    return { total, page, pageSize: take, list: safeList };
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
