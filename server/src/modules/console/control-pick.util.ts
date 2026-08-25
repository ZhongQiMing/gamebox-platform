import {
  CONTROL_FIXED_CANDIDATE_TRIES,
  CONTROL_PLAYER_WIN_HOUSE_FLOOR,
  type PeriodGuardParams,
} from './control.constants';

export type HoldPolicyRef = { roomId: string; holdRatio: number };

export type PlayerBiasDirection = 'WIN' | 'LOSE';

/** 单房策略：目标派彩 = 总下注 × (1 − 留存%) */
export function holdTargetPayout(stake: number, holdRatio: number): number {
  return stake * (1 - holdRatio);
}

/** 加权误差：越偏离目标、注额越大，分越高（挑最小） */
export function holdScore(payout: number, targetPayout: number, stake: number): number {
  return Math.abs(payout - targetPayout) * Math.max(stake, 1);
}

/**
 * 全局软控日账：开完本期后，当日净留存 R=(G−C)/F 相对目标中轴的加权偏差（越小越好）。
 */
export function globalDayNetScore(opts: {
  dayF: number;
  dayG: number;
  dayC: number;
  periodStake: number;
  periodPayout: number;
  /** 本期佣金增量（通常 periodStake × rate%） */
  periodCommission: number;
  targetNetPct: number;
}): number {
  const F = opts.dayF + opts.periodStake;
  if (F <= 1e-9) return 0;
  const G = opts.dayG + (opts.periodStake - opts.periodPayout);
  const C = opts.dayC + opts.periodCommission;
  const R = ((G - C) / F) * 100;
  return Math.abs(R - opts.targetNetPct) * F;
}

/** 本期庄家亏损比例%（正数=亏；负数=庄家赢） */
export function periodLossPct(periodStake: number, periodPayout: number): number {
  const f = periodStake;
  if (f <= 1e-9) return 0;
  return ((periodPayout - f) / f) * 100;
}

/**
 * 单期铁律：只拦「庄家亏太多」的候选。
 *
 * 早先两头都拦（庄家赢超过 maxWin% 也判非法），结果一期只有一两注时全军覆没：
 * 单注 50 元，玩家没中是庄家赢 100%（超上限）、中了是亏几千倍（也超上限），
 * 候选全非法 → 每期都回退自然开奖，软控形同虚设。
 * 庄家本期赢多少不该由这条管——那是日账/三日账该管的事。
 */
export function periodIronLegal(opts: {
  periodStake: number;
  periodPayout: number;
  maxPeriodLossPct: number;
}): boolean {
  const f = opts.periodStake;
  if (f <= 1e-9) return true;
  return periodLossPct(f, opts.periodPayout) <= opts.maxPeriodLossPct + 1e-9;
}

/**
 * 本期要不要挑号：自然结果的亏损没到触发线就别动，正常开奖不干预。
 * 到线了才挑，目标是把亏损压回 targetLossPct 附近（离散结果只能逼近）。
 */
export function periodNeedsSteer(opts: {
  periodStake: number;
  naturalPayout: number;
  triggerLossPct: number;
}): boolean {
  if (opts.periodStake <= 1e-9) return false;
  return periodLossPct(opts.periodStake, opts.naturalPayout) > opts.triggerLossPct + 1e-9;
}

/** 离目标亏损率的加权偏差（越小越好）；注额越大越重视 */
export function periodLossScore(opts: {
  periodStake: number;
  periodPayout: number;
  targetLossPct: number;
}): number {
  const pct = periodLossPct(opts.periodStake, opts.periodPayout);
  return Math.abs(pct - opts.targetLossPct) * Math.max(opts.periodStake, 1);
}

export type PeriodGuardDecision = {
  /** 本期是否介入挑号 */
  steer: boolean;
  /** 是否允许采用「通杀」候选（庄家赢走绝大部分流水） */
  allowWipeout: boolean;
  /** 候选合法上限：亏损% 超过即弃 */
  maxLossPct: number;
  /** 软着陆目标亏损% */
  targetLossPct: number;
  /** 通杀判定：派彩 ≤ 此% × F */
  wipeoutPayoutPct: number;
  /** 自然结果的庄家亏损额（正=亏） */
  naturalLoss: number;
  reason: string;
};

const NO_STEER = (reason: string, params: PeriodGuardParams, naturalLoss: number)
: PeriodGuardDecision => ({
  steer: false,
  allowWipeout: false,
  maxLossPct: params.openLossPct,
  targetLossPct: params.targetLossPct,
  wipeoutPayoutPct: params.wipeoutPayoutPct,
  naturalLoss,
  reason,
});

/**
 * 单期总账决策：只看本期总注 F、自然总派彩 C、有效人数、周期盈利。
 *
 * 顺序：
 *   1. 亏没超开档线 → 不动（9 盖 1、8 盖 2 这类覆盖打法在这层就被放行）
 *   2. 超线 → 介入，尽量把亏压到目标带
 *   3. 只剩通杀时才看金额门：小额认赔、小盘不杀、周期赚够也认赔
 */
export function decidePeriodGuard(opts: {
  periodStake: number;
  naturalPayout: number;
  /** 本期有效下注人数（去重） */
  playerCount: number;
  /** 该游戏周期（默认 48h）庄家净盈利 */
  cycleProfit: number;
  params: PeriodGuardParams;
}): PeriodGuardDecision {
  const p = opts.params;
  const F = opts.periodStake;
  const naturalLoss = opts.naturalPayout - F;
  if (F <= 1e-9) return NO_STEER('空注', p, 0);

  const r = periodLossPct(F, opts.naturalPayout);
  if (r <= p.openLossPct + 1e-9) {
    return NO_STEER(`亏${r.toFixed(1)}% 未过开档线`, p, naturalLoss);
  }

  /* 小盘：人少或流水小，宁可认赔也不做成「老开你没买的那个」 */
  const smallPool = opts.playerCount < p.minPlayers || F < p.minStake;

  let allowWipeout = true;
  let reason = '超开档线，允许通杀防爆';
  if (naturalLoss < p.smallLossAmount) {
    allowWipeout = false;
    reason = `亏${Math.round(naturalLoss)}元 未达认赔门`;
  } else if (smallPool) {
    allowWipeout = false;
    reason = `小盘保护（${opts.playerCount}人/${Math.round(F)}元）`;
  } else if (naturalLoss < p.bigLossAmount) {
    allowWipeout = false;
    reason = `亏${Math.round(naturalLoss)}元 未达防爆门`;
  } else if (opts.cycleProfit < p.cycleProfitFloor) {
    allowWipeout = false;
    reason = '周期盈利过薄，不硬追';
  } else if (naturalLoss <= (p.cycleLossPctOfProfit / 100) * opts.cycleProfit + 1e-9) {
    allowWipeout = false;
    reason = '周期已赚够，认赔';
  }

  return {
    steer: true,
    allowWipeout,
    maxLossPct: p.openLossPct,
    targetLossPct: p.targetLossPct,
    wipeoutPayoutPct: p.wipeoutPayoutPct,
    naturalLoss,
    reason,
  };
}

/** 候选是否可用：亏不过线；通杀候选须获授权 */
export function periodCandidateLegal(opts: {
  periodStake: number;
  periodPayout: number;
  decision: PeriodGuardDecision;
}): boolean {
  const F = opts.periodStake;
  if (F <= 1e-9) return true;
  const d = opts.decision;
  if (periodLossPct(F, opts.periodPayout) > d.maxLossPct + 1e-9) return false;
  if (d.allowWipeout) return true;
  return opts.periodPayout > (d.wipeoutPayoutPct / 100) * F + 1e-9;
}

export type SoftBiasKind = 'ROOM_RECOVER' | 'ROOM_RELEASE' | 'PLAYER_WIN' | 'PLAYER_LOSE';

export type SoftBiasRef = {
  kind: SoftBiasKind;
  roomId: string;
  playerId?: string | null;
  /** 剩余目标金额（元）：房间回血/放水、玩家偏赢/偏输共用 */
  goalAmount?: number | null;
};

function clampGoalAmount(v?: number | null): number {
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) return 100;
  return Math.min(10_000_000, n);
}

/** 兼容迁移前旧 kind */
export function normalizeSoftBiasKind(kind: string): SoftBiasKind | null {
  const k = String(kind || '').toUpperCase();
  if (k === 'ROOM_PRESS' || k === 'ROOM_RECOVER') return 'ROOM_RECOVER';
  if (k === 'ROOM_FAVOR' || k === 'ROOM_RELEASE') return 'ROOM_RELEASE';
  if (k === 'PLAYER_WIN' || k === 'PLAYER_LOSE') return k;
  return null;
}

/**
 * 软偏置分（越小越好）。
 * 房间/玩家一律按「剩余目标金额」加权：每期尽量朝目标方向偏，不保证单期赚满。
 * ROOM_RECOVER：该房庄家多赢；ROOM_RELEASE：该房庄家少赢。
 * PLAYER_WIN/LOSE：该玩家多/少派彩；偏赢须该房庄家不低于底线。
 * 单期大赢大输由铁律过滤。
 */
export function softBiasScore(opts: {
  biases: SoftBiasRef[];
  /** roomId → 本期该房 stake/payout */
  roomBooks: Map<string, { stake: number; payout: number }>;
  /** `${roomId}|${playerId}` → 本期该玩家派彩 */
  playerPayouts: Map<string, number>;
  houseFloor?: number;
}): { score: number; valid: boolean } {
  const floor = opts.houseFloor ?? CONTROL_PLAYER_WIN_HOUSE_FLOOR;
  let score = 0;
  let valid = true;
  for (const raw of opts.biases) {
    const kind = normalizeSoftBiasKind(raw.kind);
    if (!kind) continue;
    const book = opts.roomBooks.get(raw.roomId);
    const remain = Math.max(1, clampGoalAmount(raw.goalAmount));
    const w = 1 + Math.min(10, remain / 1000);
    if (kind === 'ROOM_RECOVER') {
      if (!book || book.stake <= 1e-9) continue;
      const house = book.stake - book.payout;
      score += -house * w;
      continue;
    }
    if (kind === 'ROOM_RELEASE') {
      if (!book || book.stake <= 1e-9) continue;
      const house = book.stake - book.payout;
      score += house * w;
      continue;
    }
    if (!raw.playerId) continue;
    const key = `${raw.roomId}|${raw.playerId}`;
    const pay = opts.playerPayouts.get(key) ?? 0;
    if (kind === 'PLAYER_WIN') {
      if (book) {
        const housePnl = book.stake - book.payout;
        if (housePnl + 1e-9 < floor) valid = false;
      }
      score += -pay * w;
    } else if (kind === 'PLAYER_LOSE') {
      score += pay * w;
    }
  }
  return { score, valid };
}

export type SoftPickRank = {
  day: number;
  bias: number;
  brake: number;
  valid: boolean;
  /** 单期亏损离目标的加权偏差（越小越好） */
  period?: number;
  /** 本期有返奖人数（越多越好，同分时用来避免一刀切） */
  winners?: number;
};

/** 单期分并列容差：差得不多就当平手，交给赢家人数决定 */
const PERIOD_TIE_RATIO = 0.05;

/**
 * 共盘挑号排序（候选须已过单期决策，禁止为缓刹「全杀」）。
 * - 单期超亏触发：先压单期亏损目标；分接近时优先赢家人数多的。
 * - 有人碰缓刹线：先压碰线玩家合计派彩，再单期/日账/偏置。
 * - 无人碰线且非单期触发：日账优先，再偏置，再缓刹。
 */
export function isBetterSoftGlobalPick(
  a: SoftPickRank,
  b: SoftPickRank,
  dayTol: number,
  opts?: { brakeFirst?: boolean; periodFirst?: boolean },
): boolean {
  if (a.valid !== b.valid) return a.valid;
  const ap = a.period ?? 0;
  const bp = b.period ?? 0;
  const aw = a.winners ?? 0;
  const bw = b.winners ?? 0;
  /* 同一量级的单期分算平手：再纠结几个点没意义，不如多留几个赢家 */
  const periodTol = Math.max(ap, bp) * PERIOD_TIE_RATIO;
  const periodBetter = (): boolean | null => {
    if (ap < bp - periodTol) return true;
    if (bp < ap - periodTol) return false;
    if (aw > bw) return true;
    if (bw > aw) return false;
    return null;
  };
  if (opts?.brakeFirst) {
    if (a.brake < b.brake - 1e-9) return true;
    if (b.brake < a.brake - 1e-9) return false;
    if (opts.periodFirst) {
      const r = periodBetter();
      if (r != null) return r;
    }
    if (a.day < b.day - dayTol) return true;
    if (b.day < a.day - dayTol) return false;
    return a.bias < b.bias;
  }
  if (opts?.periodFirst) {
    const r = periodBetter();
    if (r != null) return r;
  }
  if (a.day < b.day - dayTol) return true;
  if (b.day < a.day - dayTol) return false;
  if (a.bias < b.bias - 1e-9) return true;
  if (b.bias < a.bias - 1e-9) return false;
  return a.brake < b.brake;
}

export function matchPlayerPolicy<T extends { roomId: string; playerId: string }>(
  policies: T[],
  roomId: string | null | undefined,
  playerId: string | null | undefined,
): T | null {
  if (!roomId || !playerId) return null;
  return policies.find((p) => p.roomId === roomId && p.playerId === playerId) ?? null;
}

/** 单游戏长期资金池挑号运行时（余额=流水−派彩；无房间偏置/铁律） */
export type ArcadePoolPickRuntime = {
  needPick: boolean;
  tries: number;
  /** 统计窗口内该游戏的累计流水与派彩 */
  poolStake: number;
  poolPayout: number;
  targetRtp: number;
};

/**
 * 池余额偏离目标返还率的程度（越小越好）。
 * 把本局并进池子后再算返还率，与目标比。
 */
export function arcadePoolBalanceScore(opts: {
  poolStake: number;
  poolPayout: number;
  periodStake: number;
  periodPayout: number;
  targetRtp: number;
}): number {
  const stake = opts.poolStake + opts.periodStake;
  if (stake <= 1e-9) return 0;
  const rtp = (opts.poolPayout + opts.periodPayout) / stake;
  return Math.abs(rtp - opts.targetRtp) * Math.max(stake, 1);
}

/**
 * 单游戏资金池：按池余额贴近目标留存挑 seed。
 * 不套共盘铁律、不套房间/玩家偏置——街机是一人一局，没有旁人可比。
 */
export function pickSeedForArcadePool<T extends { payout: number }>(opts: {
  runtime: ArcadePoolPickRuntime | null | undefined;
  stake: number;
  gen: () => { seed: string; hash: string };
  simulate: (seed: string, hash: string) => T;
}): {
  result: T & { seed: string; hash: string };
  steered: boolean;
  /** 被放弃的自然结果：介入留痕要能回答「本来会开什么」 */
  natural: T & { seed: string; hash: string };
  tries: number;
} {
  const first = opts.gen();
  const firstBody = opts.simulate(first.seed, first.hash);
  const natural = { ...firstBody, seed: first.seed, hash: first.hash };
  const rt = opts.runtime;
  if (!rt?.needPick) {
    return { result: natural, steered: false, natural, tries: 1 };
  }

  const tries = Math.max(1, rt.tries);
  let best = natural;
  let bestScore = arcadePoolBalanceScore({
    poolStake: rt.poolStake,
    poolPayout: rt.poolPayout,
    periodStake: opts.stake,
    periodPayout: natural.payout,
    targetRtp: rt.targetRtp,
  });

  for (let i = 1; i < tries; i++) {
    const candSeed = opts.gen();
    const body = opts.simulate(candSeed.seed, candSeed.hash);
    const score = arcadePoolBalanceScore({
      poolStake: rt.poolStake,
      poolPayout: rt.poolPayout,
      periodStake: opts.stake,
      periodPayout: body.payout,
      targetRtp: rt.targetRtp,
    });
    if (score < bestScore) {
      bestScore = score;
      best = { ...body, seed: candSeed.seed, hash: candSeed.hash };
    }
  }

  return { result: best, steered: best.seed !== natural.seed, natural, tries };
}
