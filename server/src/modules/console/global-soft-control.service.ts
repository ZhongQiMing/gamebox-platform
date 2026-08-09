/**
 * 全站全局软控：
 * - 共盘（彩票+牌桌）：上海自然日 F/G/C/R + 小时模式
 * - 街机/电子：每个游戏独立长期资金池（余额=流水−派彩），房间偏置不参与
 */
import {
  BadRequestException, ForbiddenException, Injectable, Logger,
} from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { asMoney, roundMoney } from '@gamebox/shared';
import { shanghaiRangeBounds } from '../../common/shanghai-range';
import { PrismaService } from '../../prisma/prisma.service';
import { RedisService } from '../../redis/redis.service';
import { AdminLogService } from '../admin/admin-log.service';
import { ConsoleScopeService, type ConsoleActor } from './console-scope.service';
import {
  ARCADE_POOL_STATIC_CODES,
  SOFT_CONTROL_GAME_CODES,
  CONTROL_PROGRESS_BASE_CODES,
  GEAR_ENTER_RECOVER_PCT,
  GEAR_ENTER_STRONG_PCT,
  GEAR_EXIT_PCT,
  GEAR_MIN_CYCLE_FLOW,
  PERIOD_CYCLE_HOURS,
  controlGameCodeMatchList,
  periodGuardParams,
  type PeriodGearLevel,
  type PeriodGearMode,
  type PeriodGuardParams,
} from './control.constants';
import {
  normalizeSoftBiasKind,
  type SoftBiasKind,
} from './control-pick.util';

const log = new Logger('GlobalSoftControl');

/** 街机池聚合短缓存（秒），避免每 spin 全表扫 */
const ARCADE_POOL_CACHE_TTL_SEC = 10;

export type GlobalSoftControlConfig = {
  enabled: boolean;
  minFlowToControl: number;
  targetNetPct: number;
  bandLowPct: number;
  bandHighPct: number;
  maxPeriodWinPct: number;
  maxPeriodLossPct: number;
  /** 只读：来自回水规则·回水总额，不落 GlobalSoftControl 表 */
  commissionRatePct: number;
  /** STEER 试号：仅共盘，街机走 arcadeCandidateTries */
  candidateTries: number;
  /** HALT 偏热回拉试号 */
  candidateTriesHalt: number;
  candidateTriesBoost: number;
  playerBrakeEnabled: boolean;
  playerBrakeMultiple: number;
  /** 街机+电子池目标返还率 0~1 */
  arcadeRtpTarget: number;
  /** 街机池试号（与共盘解耦） */
  arcadeCandidateTries: number;
  /** 街机池统计窗口天数；窗口外盈亏永久落袋 */
  arcadePoolWindowDays: number;
  /** @deprecated 控后冷却已停用：冷却期会让出防爆权 */
  cooldownEnabled: boolean;
  /** 慢性失血档位开关 */
  gearMode: PeriodGearMode;
};

export type GlobalSoftControlMode = 'IDLE' | 'STEER' | 'BOOST' | 'HALT' | 'OFF';

/** 开奖结果落库后才提交：mark=写入冷却，consume=清除冷却 */
export type SoftDrawCommit = 'none' | 'mark' | 'consume';

export type SoftBiasRef = {
  id: string;
  kind: SoftBiasKind;
  roomId: string;
  playerId: string | null;
  /** 剩余目标金额（房间回血/放水、玩家偏赢/偏输） */
  goalAmount: number | null;
};

/** 共盘日账：仅彩票+牌桌 */
const SOFT_CONTROL_CODES: string[] = [...SOFT_CONTROL_GAME_CODES];

/** 同时启用中的偏置上限（与开奖加载 take 一致） */
const MAX_ACTIVE_SOFT_BIAS = 10;

export type ArcadePoolDrawRuntime = {
  enabled: boolean;
  needPick: boolean;
  tries: number;
  gameCode: string;
  poolStake: number;
  poolPayout: number;
  /** 池余额 = 流水 − 派彩（庄家视角净赢） */
  poolBalance: number;
  poolRtp: number | null;
  targetRtp: number;
  cooldownActive: boolean;
};

export type GlobalSoftDrawRuntime = {
  enabled: boolean;
  mode: GlobalSoftControlMode;
  needPick: boolean;
  /** 当日流水未达开盘门槛 → 日账层不参与；单期防爆不受此限 */
  underMinFlow: boolean;
  tries: number;
  dayF: number;
  dayG: number;
  dayC: number;
  dayR: number | null;
  targetNetPct: number;
  maxPeriodWinPct: number;
  maxPeriodLossPct: number;
  commissionRatePct: number;
  cooldownActive: boolean;
  /** STEER/BOOST/HALT 时日账主控；IDLE 仅偏置 */
  daySteer: boolean;
  playerBrakeEnabled: boolean;
  playerBrakeMultiple: number;
  biases: SoftBiasRef[];
  /** 慢性失血档位（已含手动开关结果） */
  gear: PeriodGearLevel;
  /** 该游戏周期（48h）庄家净盈利，单期金额门用 */
  cycleProfit: number;
  cycleStake: number;
  cycleR: number | null;
  /** 档位对应的单期门槛参数 */
  periodGuard: PeriodGuardParams;
};

const BIAS_KINDS: SoftBiasKind[] = ['ROOM_RECOVER', 'ROOM_RELEASE', 'PLAYER_WIN', 'PLAYER_LOSE'];
const BIAS_KIND_LABEL: Record<SoftBiasKind, string> = {
  ROOM_RECOVER: '房间回血',
  ROOM_RELEASE: '房间放水',
  PLAYER_WIN: '玩家偏赢',
  PLAYER_LOSE: '玩家偏输',
};

/** 表行默认值（不含佣金率——佣金率只读自回水规则） */
const ROW_DEFAULTS = {
  enabled: false,
  minFlowToControl: 50000,
  targetNetPct: 4,
  bandLowPct: 2,
  bandHighPct: 6,
  maxPeriodWinPct: 40,
  /** 单期亏损触发线兼候选硬顶：自然亏超此%才挑号；候选亏超此%判非法 */
  maxPeriodLossPct: 50,
  candidateTries: 8,
  candidateTriesHalt: 16,
  candidateTriesBoost: 20,
  playerBrakeEnabled: true,
  playerBrakeMultiple: 4,
  arcadeRtpTarget: 0.92,
  arcadeCandidateTries: 3,
  arcadePoolWindowDays: 14,
  cooldownEnabled: true,
};

function clampArcadeRtp(v: unknown, fallback = ROW_DEFAULTS.arcadeRtpTarget): number {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(0.99, Math.max(0.3, Math.round(n * 1000) / 1000));
}

function clampInt(v: unknown, fallback: number, min: number, max: number): number {
  const n = Math.floor(Number(v));
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

/** 街机池窗口上下限：1 天起（当日盘），365 天封顶（再长等于全历史） */
const ARCADE_WINDOW_MIN_DAYS = 1;
const ARCADE_WINDOW_MAX_DAYS = 365;

const MODE_LABEL: Record<GlobalSoftControlMode, string> = {
  OFF: '已关闭',
  IDLE: '空闲',
  STEER: '轻度调控',
  BOOST: '加强调控',
  HALT: '过热回拉',
};

function num(v: unknown, fallback: number) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function shanghaiHourKey(now = new Date()): { ymd: string; hour: string } {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    hour12: false,
  });
  const parts = Object.fromEntries(
    fmt.formatToParts(now).filter((p) => p.type !== 'literal').map((p) => [p.type, p.value]),
  ) as Record<string, string>;
  const ymd = `${parts.year}-${parts.month}-${parts.day}`;
  const hour = (parts.hour || '00').padStart(2, '0');
  return { ymd, hour };
}

function cooldownKey(gameCode: string) {
  return `gsc:cooldown:${gameCode}`;
}

function gearKey(gameCode: string) {
  return `gsc:gear:${gameCode}`;
}

/** 周期账短缓存（秒）：一期一算会把 48h 聚合打爆 */
const CYCLE_BOOK_CACHE_TTL_SEC = 60;

/** 档位缓存 TTL：滞回状态靠它记住上一档 */
const GEAR_CACHE_TTL_SEC = 3600;

function normalizeGearMode(v: unknown): PeriodGearMode {
  const s = String(v || '').toUpperCase();
  if (s === 'FORCE_NORMAL' || s === 'FORCE_RECOVER') return s;
  return 'AUTO';
}

/**
 * 档位滞回：进档看 −10%/−25%，退档要回到 −5% 以上。
 * 只用一条线会在阈值附近来回跳，玩家看到的松紧一天变好几次。
 */
export function resolveGearLevel(opts: {
  prev: PeriodGearLevel;
  cycleR: number | null;
  cycleStake: number;
  minCycleFlow?: number;
}): PeriodGearLevel {
  const minFlow = opts.minCycleFlow ?? GEAR_MIN_CYCLE_FLOW;
  if (opts.cycleR == null || opts.cycleStake < minFlow) return 'NORMAL';
  const r = opts.cycleR;
  if (r < GEAR_ENTER_STRONG_PCT) return 'STRONG';
  if (r < GEAR_ENTER_RECOVER_PCT) return opts.prev === 'STRONG' ? 'STRONG' : 'RECOVER';
  if (r < GEAR_EXIT_PCT) return opts.prev === 'NORMAL' ? 'NORMAL' : 'RECOVER';
  return 'NORMAL';
}

function modeCacheKey(ymd: string, hour: string) {
  return `gsc:mode:${ymd}:${hour}`;
}

/** 距下一上海整点小时的秒数（用于模式缓存 TTL，进新小时必重核） */
function secondsUntilNextShanghaiHour(now = new Date()): number {
  const fmt = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Shanghai',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
  const parts = Object.fromEntries(
    fmt.formatToParts(now).filter((p) => p.type !== 'literal').map((p) => [p.type, p.value]),
  ) as Record<string, string>;
  const minute = Number(parts.minute || 0);
  const second = Number(parts.second || 0);
  const remain = 3600 - (minute * 60 + second);
  return Math.max(30, Math.min(3600, remain || 3600));
}

@Injectable()
export class GlobalSoftControlService {
  constructor(
    private prisma: PrismaService,
    private redis: RedisService,
    private adminLog: AdminLogService,
    private scope: ConsoleScopeService,
  ) {}

  /**
   * 软控 Redis 只承载模式缓存/冷却；失败时不得阻断开奖。
   * 返回 undefined = 读失败（调用方应降级自然开奖）。
   */
  private async redisGetSafe(key: string): Promise<string | null | undefined> {
    try {
      return await this.redis.get(key);
    } catch (e) {
      log.warn(`gsc redis get 失败 key=${key}: ${(e as Error)?.message || e}`);
      return undefined;
    }
  }

  /** 写失败只打日志，不抛给开奖/保存主路径 */
  private async redisSetSafe(key: string, value: string, ttlSec?: number): Promise<boolean> {
    try {
      await this.redis.set(key, value, ttlSec);
      return true;
    } catch (e) {
      log.warn(`gsc redis set 失败 key=${key}: ${(e as Error)?.message || e}`);
      return false;
    }
  }

  private async redisDelSafe(...keys: string[]): Promise<boolean> {
    try {
      await this.redis.del(...keys);
      return true;
    } catch (e) {
      log.warn(`gsc redis del 失败 keys=${keys.join(',')}: ${(e as Error)?.message || e}`);
      return false;
    }
  }

  private async ensureRow() {
    return this.prisma.globalSoftControl.upsert({
      where: { id: 1 },
      create: { id: 1, ...ROW_DEFAULTS },
      update: {},
    });
  }

  private toConfig(
    row: Awaited<ReturnType<GlobalSoftControlService['ensureRow']>>,
    commissionRatePct: number,
  ): GlobalSoftControlConfig {
    const arcadeRtpTarget = clampArcadeRtp(
      (row as { arcadeRtpTarget?: number }).arcadeRtpTarget,
      ROW_DEFAULTS.arcadeRtpTarget,
    );
    return {
      enabled: !!row.enabled,
      minFlowToControl: row.minFlowToControl,
      targetNetPct: row.targetNetPct,
      bandLowPct: row.bandLowPct,
      bandHighPct: row.bandHighPct,
      maxPeriodWinPct: row.maxPeriodWinPct,
      maxPeriodLossPct: row.maxPeriodLossPct,
      commissionRatePct,
      candidateTries: row.candidateTries,
      candidateTriesHalt: Math.max(1, Math.floor(Number(row.candidateTriesHalt || ROW_DEFAULTS.candidateTriesHalt))),
      candidateTriesBoost: row.candidateTriesBoost,
      playerBrakeEnabled: !!row.playerBrakeEnabled,
      playerBrakeMultiple: row.playerBrakeMultiple,
      arcadeRtpTarget,
      arcadeCandidateTries: clampInt(
        (row as { arcadeCandidateTries?: number }).arcadeCandidateTries,
        ROW_DEFAULTS.arcadeCandidateTries,
        1,
        50,
      ),
      arcadePoolWindowDays: clampInt(
        (row as { arcadePoolWindowDays?: number }).arcadePoolWindowDays,
        ROW_DEFAULTS.arcadePoolWindowDays,
        ARCADE_WINDOW_MIN_DAYS,
        ARCADE_WINDOW_MAX_DAYS,
      ),
      cooldownEnabled: (row as { cooldownEnabled?: boolean }).cooldownEnabled === true,
      gearMode: normalizeGearMode((row as { gearMode?: string }).gearMode),
    };
  }

  /**
   * 该游戏周期账（默认 48h）：庄家净盈利 = 流水 − 派彩。
   * 单期金额门用它判断「这一枪扛不扛得住」，两天一轮不会一天小亏就收紧。
   */
  private async cycleBook(gameCode: string): Promise<{
    stake: number;
    payout: number;
    profit: number;
    netPct: number | null;
  }> {
    const code = String(gameCode || '').trim();
    const empty = { stake: 0, payout: 0, profit: 0, netPct: null };
    if (!code) return empty;

    const cacheKey = `gsc:cycle:${code}`;
    const cached = await this.redisGetSafe(cacheKey);
    if (cached) {
      try {
        const parsed = JSON.parse(cached) as { stake: number };
        if (parsed && typeof parsed.stake === 'number') {
          return parsed as { stake: number; payout: number; profit: number; netPct: number | null };
        }
      } catch { /* fallthrough */ }
    }

    const since = new Date(Date.now() - PERIOD_CYCLE_HOURS * 60 * 60 * 1000);
    const codes = controlGameCodeMatchList(code);
    const games = await this.prisma.game.findMany({
      where: { code: { in: codes } },
      select: { id: true },
    });
    if (!games.length) return empty;
    const agg = await this.prisma.bet.aggregate({
      where: {
        gameId: { in: games.map((g) => g.id) },
        status: { in: ['WON', 'LOST'] },
        settledAt: { gte: since },
      },
      _sum: { amount: true, payout: true },
    });
    const stake = asMoney(agg._sum.amount ?? 0);
    const payout = asMoney(agg._sum.payout ?? 0);
    const profit = roundMoney(stake - payout);
    const netPct = stake > 0 ? roundMoney((profit / stake) * 100) : null;
    const book = { stake, payout, profit, netPct };
    await this.redisSetSafe(cacheKey, JSON.stringify(book), CYCLE_BOOK_CACHE_TTL_SEC);
    return book;
  }

  /** 档位：手动开关优先；AUTO 按周期账滞回定档 */
  private async resolveGear(
    gameCode: string,
    mode: PeriodGearMode,
    cycleR: number | null,
    cycleStake: number,
  ): Promise<PeriodGearLevel> {
    if (mode === 'FORCE_NORMAL') return 'NORMAL';
    if (mode === 'FORCE_RECOVER') return 'RECOVER';
    if (!gameCode) return 'NORMAL';

    const key = gearKey(gameCode);
    const cached = await this.redisGetSafe(key);
    const prev: PeriodGearLevel = cached === 'RECOVER' || cached === 'STRONG'
      ? cached
      : 'NORMAL';
    const next = resolveGearLevel({ prev, cycleR, cycleStake });
    if (next !== prev || cached == null) {
      await this.redisSetSafe(key, next, GEAR_CACHE_TTL_SEC);
    }
    return next;
  }

  /** 街机/电子游戏 code：静态街机 + 库内全部 SLOT */
  private async arcadePoolCodes(): Promise<string[]> {
    const slots = await this.prisma.game.findMany({
      where: { category: 'SLOT' },
      select: { code: true },
    });
    return [...new Set([
      ...ARCADE_POOL_STATIC_CODES,
      ...slots.map((g) => g.code),
    ])];
  }

  /**
   * 单游戏长期资金池（不清零）：
   * F=累计流水，P=累计派彩，余额=F−P（庄家净赢）。
   * 短缓存减轻高频 spin 压力。
   */
  private async arcadePoolBook(gameCode: string, windowDays: number): Promise<{
    gameCode: string;
    stake: number;
    payout: number;
    balance: number;
    rtp: number | null;
    betCount: number;
  }> {
    const code = String(gameCode || '').trim();
    const days = clampInt(
      windowDays,
      ROW_DEFAULTS.arcadePoolWindowDays,
      ARCADE_WINDOW_MIN_DAYS,
      ARCADE_WINDOW_MAX_DAYS,
    );
    const cacheKey = `gsc:arcade-pool:${code || '_'}:${days}`;
    const cached = await this.redisGetSafe(cacheKey);
    if (cached) {
      try {
        const parsed = JSON.parse(cached) as {
          gameCode: string;
          stake: number;
          payout: number;
          balance: number;
          rtp: number | null;
          betCount: number;
        };
        if (parsed && typeof parsed.stake === 'number') return parsed;
      } catch { /* fallthrough */ }
    }

    /*
     * 只统计窗口内注单：窗口之外的盈亏永久落袋，不再被挑号吐回去。
     * 先取 gameId 再按 (gameId, createdAt) 过滤，才能吃到该复合索引；
     * 用 game:{code} 关联查会退化成全历史扫这个游戏的注单。
     */
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    const game = code
      ? await this.prisma.game.findUnique({ where: { code }, select: { id: true } })
      : null;
    const agg = game
      ? await this.prisma.bet.aggregate({
          where: {
            gameId: game.id,
            createdAt: { gte: since },
            status: { in: ['WON', 'LOST'] },
          },
          _sum: { amount: true, payout: true },
          _count: true,
        })
      : { _sum: { amount: 0, payout: 0 }, _count: 0 };
    const stake = asMoney(agg._sum.amount ?? 0);
    const payout = asMoney(agg._sum.payout ?? 0);
    const balance = roundMoney(stake - payout);
    const rtp = stake > 0 ? roundMoney(payout / stake) : null;
    const book = { gameCode: code, stake, payout, balance, rtp, betCount: agg._count };
    await this.redisSetSafe(cacheKey, JSON.stringify(book), ARCADE_POOL_CACHE_TTL_SEC);
    return book;
  }

  /** 后台：各游戏资金池一览 */
  private async listArcadePoolBooks(): Promise<Array<{
    gameCode: string;
    name: string;
    stake: number;
    payout: number;
    balance: number;
    rtp: number | null;
    betCount: number;
    targetBalance: number;
  }>> {
    const codes = await this.arcadePoolCodes();
    const games = await this.prisma.game.findMany({
      where: { code: { in: codes } },
      select: { code: true, name: true },
    });
    const nameMap = new Map(games.map((g) => [g.code, g.name]));
    const row = await this.ensureRow();
    const commissionRatePct = await this.resolveCommissionRatePct();
    const config = this.toConfig(row, commissionRatePct);
    const keep = 1 - config.arcadeRtpTarget;
    const out = [];
    for (const code of codes) {
      const book = await this.arcadePoolBook(code, config.arcadePoolWindowDays);
      out.push({
        gameCode: code,
        name: nameMap.get(code) || code,
        stake: book.stake,
        payout: book.payout,
        balance: book.balance,
        rtp: book.rtp,
        betCount: book.betCount,
        targetBalance: roundMoney(book.stake * keep),
      });
    }
    return out;
  }

  /**
   * 单游戏开奖运行时：盯该游戏资金池余额；无房间偏置、无共盘铁律、无控后冷却。
   */
  async getArcadeDrawRuntime(gameCode: string): Promise<ArcadePoolDrawRuntime> {
    const code = String(gameCode || '').trim();
    const row = await this.ensureRow();
    const commissionRatePct = await this.resolveCommissionRatePct();
    const config = this.toConfig(row, commissionRatePct);
    const pool = await this.arcadePoolBook(code, config.arcadePoolWindowDays);
    const needPick = config.enabled && !!code;
    /* 街机自己的试号数：调共盘轻微调节不应连带改街机爆率 */
    const tries = Math.max(1, config.arcadeCandidateTries);

    return {
      enabled: config.enabled,
      needPick,
      tries,
      gameCode: code,
      poolStake: pool.stake,
      poolPayout: pool.payout,
      poolBalance: pool.balance,
      poolRtp: pool.rtp,
      targetRtp: config.arcadeRtpTarget,
      cooldownActive: false,
    };
  }

  /** 佣金估算率只读：与「回水规则 · 回水总额」一致，不在软控里单独改 */
  private async resolveCommissionRatePct(): Promise<number> {
    const row = await this.prisma.rebatePolicy.findUnique({ where: { id: 1 } });
    const rate = Number(row?.totalRate ?? 0.05);
    if (!Number.isFinite(rate) || rate < 0) return 5;
    return Math.round(rate * 10000) / 100; /* 0.05 → 5 */
  }

  /**
   * 上海自然日账：F 流水、G 庄家盈亏、C 成本（仅彩票+牌桌）。
   * C 一律按「回水规则·回水总额」× F 估算，不与挂靠 COMMISSION 流水混算。
   */
  private async dayBook(commissionRatePct: number) {
    const [from, to] = shanghaiRangeBounds('today');
    const agg = await this.prisma.bet.aggregate({
      where: {
        status: { in: ['WON', 'LOST'] },
        settledAt: { gte: from, lt: to },
        game: { code: { in: SOFT_CONTROL_CODES } },
      },
      _sum: { amount: true, payout: true },
      _count: true,
    });
    const stake = asMoney(agg._sum.amount ?? 0);
    const payout = asMoney(agg._sum.payout ?? 0);
    const house = roundMoney(stake - payout);
    const commissionEst = roundMoney(stake * (commissionRatePct / 100));
    const commission = commissionEst;
    const commissionActual = 0;
    const netPct = stake > 0 ? roundMoney(((house - commission) / stake) * 100) : null;
    return {
      from: from.toISOString(),
      to: to.toISOString(),
      stake,
      payout,
      house,
      commission,
      commissionActual,
      commissionEst,
      netPct,
      betCount: agg._count,
    };
  }

  resolveMode(cfg: GlobalSoftControlConfig, dayF: number, dayR: number | null): GlobalSoftControlMode {
    if (!cfg.enabled) return 'OFF';
    if (dayF < cfg.minFlowToControl || dayR == null) return 'IDLE';
    if (dayR < 0) return 'BOOST';
    if (dayR < cfg.bandLowPct) return 'STEER';
    if (dayR > cfg.bandHighPct) return 'HALT';
    return 'IDLE';
  }

  /**
   * 调控模式小时兜底：
   * - 进上海新小时（或本小时尚未核过）：用库里现算的 F/R 定档并写入缓存；
   * - 本小时内：沿用该档，避免刷分把模式每期抖来抖去；
   * - 界面流水/佣金仍可每次刷新现算，与档位缓存分离。
   * redisOk=false：缓存读失败 → 模式按日账即时算（展示），开奖侧 needPick=false。
   */
  private async resolveModeHourly(
    cfg: GlobalSoftControlConfig,
    dayF: number,
    dayR: number | null,
  ): Promise<{ mode: GlobalSoftControlMode; redisOk: boolean; modeHour: string }> {
    const { ymd, hour } = shanghaiHourKey();
    const modeHour = `${ymd} ${hour}时`;
    if (!cfg.enabled) return { mode: 'OFF', redisOk: true, modeHour };
    const key = modeCacheKey(ymd, hour);
    const cached = await this.redisGetSafe(key);
    if (cached === undefined) {
      return { mode: this.resolveMode(cfg, dayF, dayR), redisOk: false, modeHour };
    }
    if (
      cached === 'IDLE'
      || cached === 'STEER'
      || cached === 'BOOST'
      || cached === 'HALT'
      || cached === 'OFF'
    ) {
      return { mode: cached, redisOk: true, modeHour };
    }
    /* 本小时首次（或缓存失效）：用当前库账 F/R 重核定档 */
    const mode = this.resolveMode(cfg, dayF, dayR);
    const ttl = secondsUntilNextShanghaiHour();
    await this.redisSetSafe(key, mode, ttl);
    return { mode, redisOk: true, modeHour };
  }

  /**
   * 开奖路径：日账 + 小时模式 + 周期档位。
   *
   * needPick 不再看模式/开盘门槛/冷却：单期防爆必须一直在岗。
   * 「这期到底动不动」交给 decidePeriodGuard 按本期总账判；
   * 日账与偏置仍受 underMinFlow / mode 约束，只做次级排序。
   * Redis 不可用 → 降级自然开奖（needPick=false），不抛错。
   */
  async getDrawRuntime(gameCode?: string): Promise<GlobalSoftDrawRuntime> {
    const row = await this.ensureRow();
    const commissionRatePct = await this.resolveCommissionRatePct();
    const config = this.toConfig(row, commissionRatePct);
    const book = await this.dayBook(config.commissionRatePct);
    const { mode, redisOk } = await this.resolveModeHourly(
      config,
      book.stake,
      book.netPct,
    );

    const cycle = gameCode ? await this.cycleBook(gameCode) : {
      stake: 0, payout: 0, profit: 0, netPct: null as number | null,
    };
    const gear = config.enabled
      ? await this.resolveGear(gameCode || '', config.gearMode, cycle.netPct, cycle.stake)
      : 'NORMAL';

    const underMinFlow = book.stake < config.minFlowToControl;
    const biases = config.enabled ? await this.listActiveBiasRefs() : [];
    const steering = mode === 'STEER' || mode === 'BOOST' || mode === 'HALT';
    const needPick = config.enabled && redisOk;
    const tries = mode === 'BOOST'
      ? Math.max(1, config.candidateTriesBoost)
      : mode === 'HALT'
        ? Math.max(1, config.candidateTriesHalt)
        : Math.max(1, config.candidateTries);

    if (!redisOk) {
      log.warn(
        `gsc redis 降级自然开奖 game=${gameCode || '-'} mode=${mode}`,
      );
    }

    return {
      enabled: config.enabled,
      mode,
      needPick,
      underMinFlow,
      tries,
      dayF: book.stake,
      dayG: book.house,
      dayC: book.commission,
      dayR: book.netPct,
      targetNetPct: config.targetNetPct,
      maxPeriodWinPct: config.maxPeriodWinPct,
      maxPeriodLossPct: config.maxPeriodLossPct,
      commissionRatePct: config.commissionRatePct,
      cooldownActive: false,
      /* 日账主控仍要过开盘门槛，避免清淡时段被少量流水带着跑 */
      daySteer: steering && !underMinFlow,
      playerBrakeEnabled: config.playerBrakeEnabled,
      playerBrakeMultiple: config.playerBrakeMultiple,
      biases: redisOk && !underMinFlow ? biases : [],
      gear,
      cycleProfit: cycle.profit,
      cycleStake: cycle.stake,
      cycleR: cycle.netPct,
      periodGuard: periodGuardParams(gear),
    };
  }

  /** 启用中条数已满则拒（新建/再开） */
  private async assertActiveBiasSlot(extra = 1): Promise<void> {
    const n = await this.prisma.globalSoftBias.count({ where: { enabled: true } });
    if (n + extra > MAX_ACTIVE_SOFT_BIAS) {
      throw new BadRequestException(
        `启用中偏置最多 ${MAX_ACTIVE_SOFT_BIAS} 条，请先停用或删除旧策略`,
      );
    }
  }

  /** 开奖用：启用中的软偏置（未达标才参与） */
  async listActiveBiasRefs(): Promise<SoftBiasRef[]> {
    const rows = await this.prisma.globalSoftBias.findMany({
      where: { enabled: true },
      orderBy: { createdAt: 'asc' },
      take: MAX_ACTIVE_SOFT_BIAS,
    });
    const out: SoftBiasRef[] = [];
    for (const r of rows) {
      const kind = normalizeSoftBiasKind(r.kind);
      if (!kind) continue;
      const goal = r.goalAmount != null ? asMoney(r.goalAmount) : 0;
      const prog = asMoney(r.progressAmount ?? 0);
      if (!(goal > 0) || prog + 1e-9 >= goal) continue;
      const remain = roundMoney(Math.max(0, goal - prog));
      out.push({
        id: r.id,
        kind,
        roomId: r.roomId,
        playerId: r.playerId,
        goalAmount: remain,
      });
    }
    return out;
  }

  /**
   * 结算后增量刷新偏置进度（只碰本局涉及的房/人）。
   * 房间回血 += 下注−派彩；房间放水 += 派彩−下注；
   * 玩家偏赢 += 派彩−下注；玩家偏输 += 下注−派彩。
   * 满 goalAmount 后自动停用。街机/电子勿调用。
   */
  async applySoftBiasProgress(
    touches: Array<{ roomId: string; playerId: string; stake: number; payout: number }>,
  ): Promise<void> {
    if (!touches.length) return;

    const byRoom = new Map<string, { stake: number; payout: number }>();
    const byPlayer = new Map<string, { roomId: string; playerId: string; stake: number; payout: number }>();
    for (const t of touches) {
      const roomId = String(t.roomId || '').trim();
      const playerId = String(t.playerId || '').trim();
      if (!roomId || !playerId) continue;
      const stake = asMoney(t.stake);
      const payout = asMoney(t.payout);
      if (stake <= 0 && payout <= 0) continue;
      const rb = byRoom.get(roomId) || { stake: 0, payout: 0 };
      rb.stake = roundMoney(rb.stake + stake);
      rb.payout = roundMoney(rb.payout + payout);
      byRoom.set(roomId, rb);
      const pk = `${roomId}|${playerId}`;
      const pb = byPlayer.get(pk) || { roomId, playerId, stake: 0, payout: 0 };
      pb.stake = roundMoney(pb.stake + stake);
      pb.payout = roundMoney(pb.payout + payout);
      byPlayer.set(pk, pb);
    }
    if (!byRoom.size) return;

    const roomIds = [...byRoom.keys()];
    const playerIds = [...new Set([...byPlayer.values()].map((x) => x.playerId))];
    const rows = await this.prisma.globalSoftBias.findMany({
      where: {
        enabled: true,
        goalAmount: { not: null },
        OR: [
          { kind: { in: ['ROOM_RECOVER', 'ROOM_RELEASE'] }, roomId: { in: roomIds } },
          {
            kind: { in: ['PLAYER_WIN', 'PLAYER_LOSE'] },
            roomId: { in: roomIds },
            playerId: { in: playerIds },
          },
        ],
      },
      take: 80,
    });
    if (!rows.length) return;

    for (const r of rows) {
      const kind = normalizeSoftBiasKind(r.kind);
      if (!kind || r.goalAmount == null) continue;
      const goal = asMoney(r.goalAmount);
      if (!(goal > 0)) continue;

      let delta: number;
      if (kind === 'ROOM_RECOVER' || kind === 'ROOM_RELEASE') {
        const book = byRoom.get(r.roomId);
        if (!book) continue;
        const house = roundMoney(book.stake - book.payout);
        delta = kind === 'ROOM_RECOVER' ? house : -house;
      } else {
        if (!r.playerId) continue;
        const book = byPlayer.get(`${r.roomId}|${r.playerId}`);
        if (!book) continue;
        const playerNet = roundMoney(book.payout - book.stake);
        delta = kind === 'PLAYER_WIN' ? playerNet : -playerNet;
      }
      if (Math.abs(delta) < 1e-9) continue;

      const prev = asMoney(r.progressAmount ?? 0);
      const prog = roundMoney(prev + delta);
      const done = prog + 1e-9 >= goal;
      await this.prisma.globalSoftBias.update({
        where: { id: r.id },
        data: {
          progressAmount: prog,
          ...(done ? { enabled: false } : {}),
        },
      });
      if (done && r.createdById) {
        await this.adminLog.log(r.createdById, 'CONTROL_SOFT_BIAS', r.id, {
          action: 'exhausted',
          kind,
          roomId: r.roomId,
          playerId: r.playerId,
          goalAmount: goal,
          progressAmount: prog,
          auto: true,
        });
      }
    }
  }

  /**
   * @deprecated 全量重算已停用；请用 applySoftBiasProgress（本局增量）。
   * 保留空实现以免旧调用方炸开奖。
   */
  async refreshPlayerBiasProgress(): Promise<void> {
    /* no-op：避免街机/旧路径误触发全表扫 */
  }

  /** 本期实际采纳了软控结果 → 该游戏下一局强制自然（写失败不抛；街机勿调） */
  async markSteered(gameCode: string): Promise<void> {
    if (!gameCode) return;
    const row = await this.ensureRow();
    if ((row as { cooldownEnabled?: boolean }).cooldownEnabled === false) return;
    await this.redisSetSafe(cooldownKey(gameCode), '1', 86400);
  }

  /** 冷却局已自然开过 → 清除（写失败不抛） */
  async consumeCooldown(gameCode: string): Promise<void> {
    if (!gameCode) return;
    await this.redisDelSafe(cooldownKey(gameCode));
  }

  /**
   * 开奖结果已成功落库后再提交冷却副作用。
   * mark = 本局采纳了软控；consume = 本局因冷却走了自然并已落库。
   */
  async commitSoftDraw(
    gameCode: string,
    action: SoftDrawCommit,
  ): Promise<void> {
    if (!gameCode || !action || action === 'none') return;
    if (action === 'mark') {
      await this.markSteered(gameCode);
      return;
    }
    if (action === 'consume') {
      await this.consumeCooldown(gameCode);
    }
  }

  /**
   * 按房缓刹：该房净赢 ≥ 该房净带入 × 倍数。
   * 返回键：`${roomId}|${playerId}`（共盘多房多人各自判定）。
   */
  async playersNeedingBrake(
    targets: Array<{ playerId: string; roomId: string }>,
    multiple: number,
  ): Promise<Set<string>> {
    const pairs = new Map<string, { playerId: string; roomId: string }>();
    for (const t of targets) {
      const playerId = String(t.playerId || '').trim();
      const roomId = String(t.roomId || '').trim();
      if (!playerId || !roomId) continue;
      pairs.set(`${roomId}|${playerId}`, { playerId, roomId });
    }
    const out = new Set<string>();
    if (!pairs.size || !(multiple > 0)) return out;

    const playerIds = [...new Set([...pairs.values()].map((p) => p.playerId))];
    const roomIds = [...new Set([...pairs.values()].map((p) => p.roomId))];

    const [ups, downs, bals] = await Promise.all([
      this.prisma.rechargeOrder.groupBy({
        by: ['playerId', 'roomId'],
        where: {
          playerId: { in: playerIds },
          roomId: { in: roomIds },
          status: 'APPROVED',
          type: 'UP',
        },
        _sum: { amount: true },
      }),
      this.prisma.rechargeOrder.groupBy({
        by: ['playerId', 'roomId'],
        where: {
          playerId: { in: playerIds },
          roomId: { in: roomIds },
          status: 'APPROVED',
          type: 'DOWN',
        },
        _sum: { amount: true },
      }),
      this.prisma.pointsAccount.findMany({
        where: {
          ownerType: 'PLAYER',
          ownerId: { in: playerIds },
          roomId: { in: roomIds },
        },
        select: { ownerId: true, roomId: true, balance: true },
      }),
    ]);

    const upMap = new Map<string, number>();
    for (const r of ups) {
      if (!r.roomId) continue;
      upMap.set(`${r.roomId}|${r.playerId}`, asMoney(r._sum.amount ?? 0));
    }
    const downMap = new Map<string, number>();
    for (const r of downs) {
      if (!r.roomId) continue;
      downMap.set(`${r.roomId}|${r.playerId}`, asMoney(r._sum.amount ?? 0));
    }
    const balMap = new Map<string, number>();
    for (const r of bals) {
      balMap.set(`${r.roomId}|${r.ownerId}`, asMoney(r.balance));
    }

    for (const [key] of pairs) {
      const netIn = roundMoney((upMap.get(key) ?? 0) - (downMap.get(key) ?? 0));
      if (netIn <= 0) continue;
      const bal = balMap.get(key) ?? 0;
      const netWin = roundMoney(bal - netIn);
      if (netWin >= netIn * multiple) out.add(key);
    }
    return out;
  }

  /** 共盘游戏冷却快照（街机无冷却；正式 code，不含 longhu 别名） */
  private async listCooldownSnapshot(enabled: boolean): Promise<{
    enabled: boolean;
    redisOk: boolean;
    activeGameCodes: string[];
    games: Array<{ gameCode: string; name: string; active: boolean }>;
  }> {
    const codes = [...CONTROL_PROGRESS_BASE_CODES];
    const gamesMeta = await this.prisma.game.findMany({
      where: { code: { in: codes } },
      select: { code: true, name: true },
    });
    const nameMap = new Map(gamesMeta.map((g) => [g.code, g.name]));

    const resolveActive = async (code: string): Promise<{ active: boolean; redisOk: boolean }> => {
      /* 别名共用冷却：dragon-tiger ↔ longhu 任一命中即冷却中 */
      const keys = controlGameCodeMatchList(code);
      let redisOk = true;
      let active = false;
      for (const k of keys) {
        const v = await this.redisGetSafe(cooldownKey(k));
        if (v === undefined) {
          redisOk = false;
          continue;
        }
        if (v === '1') active = true;
      }
      return { active, redisOk };
    };

    if (!enabled) {
      return {
        enabled: false,
        redisOk: true,
        activeGameCodes: [],
        games: codes.map((code) => ({
          gameCode: code,
          name: nameMap.get(code) || code,
          active: false,
        })),
      };
    }

    let redisOk = true;
    const games: Array<{ gameCode: string; name: string; active: boolean }> = [];
    const activeGameCodes: string[] = [];
    for (const code of codes) {
      const st = await resolveActive(code);
      if (!st.redisOk) redisOk = false;
      if (st.active) activeGameCodes.push(code);
      games.push({
        gameCode: code,
        name: nameMap.get(code) || code,
        active: st.active,
      });
    }
    return { enabled: true, redisOk, activeGameCodes, games };
  }

  /** 后台：各共盘游戏的 48h 周期账与当前档位 */
  private async listGearSnapshot(mode: PeriodGearMode): Promise<{
    cycleHours: number;
    games: Array<{
      gameCode: string;
      name: string;
      stake: number;
      profit: number;
      netPct: number | null;
      gear: PeriodGearLevel;
    }>;
  }> {
    const codes = [...CONTROL_PROGRESS_BASE_CODES];
    const rows = await this.prisma.game.findMany({
      where: { code: { in: codes } },
      select: { code: true, name: true },
    });
    const nameMap = new Map(rows.map((g) => [g.code, g.name]));
    const games = [];
    for (const code of codes) {
      const cycle = await this.cycleBook(code);
      const gear = await this.resolveGear(code, mode, cycle.netPct, cycle.stake);
      games.push({
        gameCode: code,
        name: nameMap.get(code) || code,
        stake: cycle.stake,
        profit: cycle.profit,
        netPct: cycle.netPct,
        gear,
      });
    }
    return { cycleHours: PERIOD_CYCLE_HOURS, games };
  }

  async getOverview(actor: ConsoleActor) {
    if (!this.scope.canManageControl(actor)) throw new ForbiddenException('仅管理员可查看全局软控');
    const row = await this.ensureRow();
    const commissionRatePct = await this.resolveCommissionRatePct();
    const config = this.toConfig(row, commissionRatePct);
    const book = await this.dayBook(config.commissionRatePct);
    const { mode, modeHour } = await this.resolveModeHourly(config, book.stake, book.netPct);
    const arcadePools = await this.listArcadePoolBooks();
    const cooldown = await this.listCooldownSnapshot(config.cooldownEnabled);
    const gearSnapshot = await this.listGearSnapshot(config.gearMode);
    const targetNet = book.stake > 0
      ? roundMoney(book.stake * (config.targetNetPct / 100) + book.commission)
      : 0;
    return {
      config,
      stats: {
        from: book.from,
        to: book.to,
        stake: book.stake,
        payout: book.payout,
        house: book.house,
        commission: book.commission,
        commissionActual: book.commissionActual,
        commissionEst: book.commissionEst,
        netPct: book.netPct,
        betCount: book.betCount,
        targetHouseNet: targetNet,
        gapToTarget: roundMoney(targetNet - book.house),
        minFlowToControl: config.minFlowToControl,
        underMinFlow: book.stake < config.minFlowToControl,
      },
      /** 每个街机/电子游戏一口池；只看窗口内注单，窗口外盈亏已落袋 */
      arcadePools: arcadePools.map((p) => ({
        ...p,
        targetRtp: config.arcadeRtpTarget,
        /** 正=池比目标厚，负=偏薄 */
        balanceGap: roundMoney(p.balance - p.targetBalance),
        windowDays: config.arcadePoolWindowDays,
      })),
      mode,
      modeLabel: MODE_LABEL[mode],
      /** 上海整点小时档；本小时内开奖沿用，界面流水仍刷新现算 */
      modeHour,
      modeHourNote:
        '调控档约每上海整点小时用库账重核一次（兜底，防刷分乱抖）；流水/佣金数字刷新即现算',
      /** @deprecated 控后冷却已停用，保留字段避免旧前端报错 */
      cooldown,
      /** 慢性失血档位：48h 周期账定档，只收紧单期门槛 */
      gear: {
        mode: config.gearMode,
        ...gearSnapshot,
        params: {
          normal: periodGuardParams('NORMAL'),
          recover: periodGuardParams('RECOVER'),
          strong: periodGuardParams('STRONG'),
        },
        enterRecoverPct: GEAR_ENTER_RECOVER_PCT,
        enterStrongPct: GEAR_ENTER_STRONG_PCT,
        exitPct: GEAR_EXIT_PCT,
        minCycleFlow: GEAR_MIN_CYCLE_FLOW,
      },
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  /** 校验当前管理员登录密码（用于解锁敏感参数） */
  async verifyAdminPassword(actor: ConsoleActor, password: string) {
    if (!this.scope.canManageControl(actor)) throw new ForbiddenException('仅管理员可操作');
    const pwd = String(password || '');
    if (!pwd) throw new BadRequestException('请输入管理员密码');
    const u = await this.prisma.user.findUnique({
      where: { id: actor.id },
      select: { id: true, role: true, passwordHash: true },
    });
    if (!u || u.role !== 'ADMIN' || !u.passwordHash) {
      throw new ForbiddenException('无权操作');
    }
    const ok = await bcrypt.compare(pwd, u.passwordHash);
    if (!ok) throw new BadRequestException('管理员密码错误');
    return { ok: true };
  }

  async update(
    actor: ConsoleActor,
    body: Partial<GlobalSoftControlConfig> & { enabled?: boolean; adminPassword?: string },
  ) {
    if (!this.scope.canManageControl(actor)) throw new ForbiddenException('仅管理员可配置全局软控');
    await this.ensureRow();

    const patch: Record<string, unknown> = {};
    if (body.enabled != null) patch.enabled = !!body.enabled;

    const intFields: Array<keyof GlobalSoftControlConfig> = [
      'candidateTries', 'candidateTriesHalt', 'candidateTriesBoost',
      'arcadeCandidateTries', 'arcadePoolWindowDays',
    ];
    for (const k of intFields) {
      if (body[k] == null) continue;
      const v = Math.floor(num(body[k], NaN));
      if (!Number.isFinite(v)) throw new BadRequestException(`${k} 无效`);
      patch[k] = v;
    }

    const floatFields: Array<keyof GlobalSoftControlConfig> = [
      'minFlowToControl', 'targetNetPct', 'bandLowPct', 'bandHighPct',
      'maxPeriodWinPct', 'maxPeriodLossPct',
      'playerBrakeMultiple', 'arcadeRtpTarget',
    ];
    for (const k of floatFields) {
      if (body[k] == null) continue;
      const v = num(body[k], NaN);
      if (!Number.isFinite(v)) throw new BadRequestException(`${k} 无效`);
      patch[k] = k === 'arcadeRtpTarget' ? clampArcadeRtp(v) : v;
    }
    if (body.playerBrakeEnabled != null) patch.playerBrakeEnabled = !!body.playerBrakeEnabled;
    if (body.cooldownEnabled != null) patch.cooldownEnabled = !!body.cooldownEnabled;
    if (body.gearMode != null) patch.gearMode = normalizeGearMode(body.gearMode);
    const turningCooldownOff = body.cooldownEnabled === false;

    /* 改参数（非仅开关）必须校验管理员密码 */
    const patchKeys = Object.keys(patch);
    const onlyToggle = patchKeys.length === 1 && patchKeys[0] === 'enabled';
    if (!onlyToggle && patchKeys.length > 0) {
      await this.verifyAdminPassword(actor, String(body.adminPassword || ''));
    }

    if (patch.minFlowToControl != null) {
      const v = patch.minFlowToControl as number;
      if (v < 0 || v > 10_000_000) throw new BadRequestException('开盘流水门槛须在 0～1000万');
    }
    if (patch.targetNetPct != null) {
      const t = patch.targetNetPct as number;
      if (t < 0 || t > 30) throw new BadRequestException('目标中轴须在 0～30%');
    }
    /* 中轴须落在目标带内，否则 STEER/HALT 会往带外拉 */
    if (
      patch.targetNetPct != null
      || patch.bandLowPct != null
      || patch.bandHighPct != null
    ) {
      const cur = await this.ensureRow();
      const low = (patch.bandLowPct as number | undefined) ?? cur.bandLowPct;
      const high = (patch.bandHighPct as number | undefined) ?? cur.bandHighPct;
      const mid = (patch.targetNetPct as number | undefined) ?? cur.targetNetPct;
      if (low >= high) throw new BadRequestException('目标带下限须 < 上限');
      if (mid + 1e-9 < low || mid - 1e-9 > high) {
        throw new BadRequestException(
          `目标中轴须落在目标带内（当前 ${low}%～${high}%，中轴 ${mid}%）`,
        );
      }
    }
    if (patch.maxPeriodWinPct != null) {
      const v = patch.maxPeriodWinPct as number;
      if (v < 5 || v > 100) throw new BadRequestException('单期吃水上限须在 5～100%');
    }
    if (patch.maxPeriodLossPct != null) {
      const v = patch.maxPeriodLossPct as number;
      if (v < 1 || v > 100) throw new BadRequestException('单期亏损触发线须在 1～100%');
    }
    if (patch.candidateTries != null) {
      const n = patch.candidateTries as number;
      if (n < 1 || n > 50) throw new BadRequestException('轻微调节试号须在 1～50');
    }
    if (patch.candidateTriesHalt != null) {
      const n = patch.candidateTriesHalt as number;
      if (n < 1 || n > 80) throw new BadRequestException('偏热回拉试号须在 1～80');
    }
    if (patch.candidateTriesBoost != null) {
      const n = patch.candidateTriesBoost as number;
      if (n < 1 || n > 80) throw new BadRequestException('加强调节试号须在 1～80');
    }
    if (patch.playerBrakeMultiple != null) {
      const m = patch.playerBrakeMultiple as number;
      if (m < 1 || m > 20) throw new BadRequestException('单人缓刹倍数须在 1～20');
    }
    if (patch.arcadeRtpTarget != null) {
      const t = patch.arcadeRtpTarget as number;
      if (t < 0.3 || t > 0.99) throw new BadRequestException('街机目标返还率须在 0.3～0.99');
    }
    if (patch.arcadeCandidateTries != null) {
      const n = patch.arcadeCandidateTries as number;
      if (n < 1 || n > 50) throw new BadRequestException('街机试号须在 1～50');
    }
    if (patch.arcadePoolWindowDays != null) {
      const n = patch.arcadePoolWindowDays as number;
      if (n < ARCADE_WINDOW_MIN_DAYS || n > ARCADE_WINDOW_MAX_DAYS) {
        throw new BadRequestException(
          `街机池统计窗口须在 ${ARCADE_WINDOW_MIN_DAYS}～${ARCADE_WINDOW_MAX_DAYS} 天`,
        );
      }
    }

    const row = await this.prisma.globalSoftControl.update({
      where: { id: 1 },
      data: patch,
    });
    /* 参数变更后清掉本小时模式缓存与各游戏街机池缓存 */
    const { ymd, hour } = shanghaiHourKey();
    const poolCodes = await this.arcadePoolCodes();
    /* 池缓存键带窗口天数；改窗口后旧键无人再读，10 秒 TTL 自然过期 */
    const poolDays = clampInt(
      (row as { arcadePoolWindowDays?: number }).arcadePoolWindowDays,
      ROW_DEFAULTS.arcadePoolWindowDays,
      ARCADE_WINDOW_MIN_DAYS,
      ARCADE_WINDOW_MAX_DAYS,
    );
    const clearKeys = [
      modeCacheKey(ymd, hour),
      ...poolCodes.map((c) => `gsc:arcade-pool:${c}:${poolDays}`),
    ];
    if (turningCooldownOff) {
      clearKeys.push(...SOFT_CONTROL_CODES.map((c) => cooldownKey(c)));
    }
    /* 改档位开关：清滞回状态，别让旧档粘着 */
    if (patch.gearMode != null) {
      clearKeys.push(...SOFT_CONTROL_CODES.map((c) => gearKey(c)));
    }
    await this.redisDelSafe(...clearKeys);

    await this.adminLog.log(actor.id, 'CONTROL_GLOBAL_SOFT', 'global-soft', {
      ...patch,
    });
    return this.getOverview(actor).then((o) => ({ ...o, saved: true, updatedAt: row.updatedAt.toISOString() }));
  }

  async listBiases(actor: ConsoleActor) {
    if (!this.scope.canManageControl(actor)) throw new ForbiddenException('仅管理员可查看偏置策略');
    const rows = await this.prisma.globalSoftBias.findMany({
      orderBy: [{ enabled: 'desc' }, { createdAt: 'desc' }],
      take: 100,
      include: {
        room: { select: { id: true, name: true, roomNo: true } },
      },
    });
    const playerIds = [...new Set(rows.map((r) => r.playerId).filter(Boolean))] as string[];
    const players = playerIds.length
      ? await this.prisma.user.findMany({
          where: { id: { in: playerIds } },
          select: { id: true, nickname: true, username: true, uid: true },
        })
      : [];
    const playerMap = new Map(players.map((p) => [p.id, p]));
    return rows.map((r) => {
      const kind = normalizeSoftBiasKind(r.kind) || (r.kind as SoftBiasKind);
      const goalAmount = r.goalAmount != null ? asMoney(r.goalAmount) : null;
      const progressAmount = asMoney(r.progressAmount ?? 0);
      const shownProg = Math.max(0, progressAmount);
      const progressPct = goalAmount && goalAmount > 0
        ? Math.min(100, Math.round((shownProg / goalAmount) * 1000) / 10)
        : null;
      const exhausted = !!goalAmount && progressAmount + 1e-9 >= goalAmount && !r.enabled;
      return {
        id: r.id,
        kind,
        kindLabel: BIAS_KIND_LABEL[kind] || r.kind,
        roomId: r.roomId,
        room: r.room,
        playerId: r.playerId,
        player: r.playerId ? playerMap.get(r.playerId) ?? null : null,
        biasPct: null,
        biasPctLabel: null,
        goalAmount,
        progressAmount: shownProg,
        progressPct,
        strengthLabel: goalAmount != null ? `${shownProg}/${goalAmount} 元` : '—',
        exhausted,
        enabled: r.enabled,
        remark: r.remark,
        createdAt: r.createdAt.toISOString(),
        updatedAt: r.updatedAt.toISOString(),
      };
    });
  }

  async createBias(
    actor: ConsoleActor,
    body: {
      kind: string;
      roomId: string;
      playerId?: string | null;
      biasPct?: number;
      goalAmount?: number;
      /** @deprecated 兼容旧前端 LIGHT/MEDIUM */
      weight?: string;
      remark?: string;
      enabled?: boolean;
    },
  ) {
    if (!this.scope.canManageControl(actor)) throw new ForbiddenException('仅管理员可配置偏置策略');
    const kind = normalizeSoftBiasKind(String(body.kind || ''));
    if (!kind || !BIAS_KINDS.includes(kind)) {
      throw new BadRequestException('偏置类型无效（房间回血/放水/玩家偏赢/偏输）');
    }
    const roomId = body.roomId?.trim();
    if (!roomId) throw new BadRequestException('请指定目标房间');
    const room = await this.prisma.room.findUnique({
      where: { id: roomId },
      select: { id: true },
    });
    if (!room) throw new BadRequestException('房间不存在');

    const isPlayer = kind === 'PLAYER_WIN' || kind === 'PLAYER_LOSE';
    let playerId: string | null = null;
    if (isPlayer) {
      playerId = body.playerId?.trim() || null;
      if (!playerId) throw new BadRequestException('请指定目标玩家');
      const member = await this.prisma.roomMember.findFirst({
        where: { roomId, playerId, status: 'APPROVED' },
        select: { id: true },
      });
      if (!member) throw new BadRequestException('该玩家不在本房或未通过审核');
    }

    const amt = Number(body.goalAmount);
    if (!Number.isFinite(amt) || amt <= 0) {
      throw new BadRequestException('请填写目标金额（大于 0）');
    }
    if (amt > 10_000_000) throw new BadRequestException('目标金额过大');
    const goalAmount = roundMoney(amt);
    const biasPct = 0;
    const willEnable = body.enabled !== false;
    if (willEnable) await this.assertActiveBiasSlot(1);

    const now = new Date();
    const row = await this.prisma.globalSoftBias.create({
      data: {
        kind,
        roomId,
        playerId,
        biasPct,
        goalAmount,
        progressFrom: now,
        progressAmount: 0,
        enabled: willEnable,
        remark: body.remark?.trim() || null,
        createdById: actor.id,
      },
    });
    await this.adminLog.log(actor.id, 'CONTROL_SOFT_BIAS', row.id, {
      action: 'create',
      kind,
      roomId,
      playerId,
      goalAmount,
    });
    return this.listBiases(actor);
  }

  async setBiasEnabled(actor: ConsoleActor, id: string, enabled: boolean) {
    if (!this.scope.canManageControl(actor)) throw new ForbiddenException('仅管理员可配置偏置策略');
    if (typeof enabled !== 'boolean') {
      throw new BadRequestException('enabled 须为 true/false');
    }
    const row = await this.prisma.globalSoftBias.findUnique({ where: { id } });
    if (!row) throw new BadRequestException('偏置策略不存在');
    if (enabled && !row.enabled) await this.assertActiveBiasSlot(1);
    /* 再次启用：进度清零重算 */
    await this.prisma.globalSoftBias.update({
      where: { id },
      data: enabled
        ? { enabled: true, progressFrom: new Date(), progressAmount: 0 }
        : { enabled: false },
    });
    await this.adminLog.log(actor.id, 'CONTROL_SOFT_BIAS', id, {
      action: 'enable', enabled,
    });
    return this.listBiases(actor);
  }

  async removeBias(actor: ConsoleActor, id: string) {
    if (!this.scope.canManageControl(actor)) throw new ForbiddenException('仅管理员可配置偏置策略');
    const row = await this.prisma.globalSoftBias.findUnique({ where: { id } });
    if (!row) throw new BadRequestException('偏置策略不存在');
    await this.prisma.globalSoftBias.delete({ where: { id } });
    await this.adminLog.log(actor.id, 'CONTROL_SOFT_BIAS', id, {
      action: 'delete', kind: row.kind, roomId: row.roomId,
    });
    return { ok: true };
  }
}
