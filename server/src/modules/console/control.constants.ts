/** 控奖已接入：彩票 */
export const CONTROL_LOTTERY_CODES = [
  'ffc',
  'ssc',
  'kuai3',
  'bjsc',
  'speed-racing',
  'speed-boat',
  'lhc',
] as const;

/** 控奖已接入：牌桌 */
export const CONTROL_TABLE_CODES = [
  'baccarat',
  'dragon-tiger',
  'douniu',
  'zhajinhua',
] as const;

/** 控奖已接入：电玩/街机 */
export const CONTROL_ARCADE_CODES = [
  'fruit-machine',
  'bcbm',
] as const;

/**
 * 电子老虎机（SlotEngine）：按 Game.category=SLOT 动态发现在线游戏，
 * 不写死 code；引擎须走 pickSeedForArcadeControl（留存+单人）。
 */
export const CONTROL_SLOT_CATEGORY = 'SLOT' as const;

/**
 * 共盘软控日账（彩票+牌桌，含 longhu 别名）。
 * 街机/电子不进此账，另走街机资金池。
 */
export const SOFT_CONTROL_GAME_CODES = [
  ...CONTROL_LOTTERY_CODES,
  ...CONTROL_TABLE_CODES,
  'longhu',
] as const;

/**
 * 街机/电子资金池静态名单；SLOT 在运行时按 category 动态并入。
 * 每个 gameCode 独立一口池（长期累计，互不影响）。
 */
export const ARCADE_POOL_STATIC_CODES = [
  ...CONTROL_ARCADE_CODES,
] as const;

/** 所有可执行控奖的静态名单（含别名 longhu）；SLOT 另见 category */
export const CONTROL_EXECUTABLE_CODES = [
  ...CONTROL_LOTTERY_CODES,
  ...CONTROL_TABLE_CODES,
  'longhu',
  ...CONTROL_ARCADE_CODES,
] as const;

/** 进度汇总用 canonical code（去掉 longhu 别名；偏置只跟共盘日账） */
export const CONTROL_PROGRESS_BASE_CODES = [
  ...CONTROL_LOTTERY_CODES,
  ...CONTROL_TABLE_CODES,
] as const;

/** 前端静态游戏清单（SLOT 含已知 code；在线列表仍可由接口动态追加） */
export const CONTROL_ALL_GAME_CODES = [
  ...CONTROL_LOTTERY_CODES,
  'baccarat',
  'dragon-tiger',
  'longhu',
  'douniu',
  'zhajinhua',
  'fruit-machine',
  'bcbm',
] as const;

export function normalizeControlGameCode(code: string | null | undefined): string | null {
  if (!code) return null;
  const c = code.trim();
  if (!c) return null;
  if (c === 'longhu') return 'dragon-tiger';
  return c;
}

/** 查询策略时兼容别名（longhu ↔ dragon-tiger） */
export function controlGameCodeMatchList(gameCode: string): string[] {
  const n = normalizeControlGameCode(gameCode) || gameCode;
  if (n === 'dragon-tiger') return ['dragon-tiger', 'longhu'];
  return [n];
}

export function isControlExecutableCode(code: string | null | undefined): boolean {
  if (!code) return false;
  const n = normalizeControlGameCode(code) || code;
  return (CONTROL_EXECUTABLE_CODES as readonly string[]).includes(n)
    || (CONTROL_EXECUTABLE_CODES as readonly string[]).includes(code);
}

/** @deprecated 用 isControlExecutableCode */
export function isControlLotteryCode(code: string | null | undefined): boolean {
  if (!code) return false;
  return (CONTROL_LOTTERY_CODES as readonly string[]).includes(code);
}

/** gameCode=null 表示该房全部已接入游戏 */
export function isControlPolicyGameOk(code: string | null | undefined): boolean {
  if (code == null || code === '') return true;
  return isControlExecutableCode(code);
}

/** 运营不再手调深度：生效策略统一用此候选次数（同种子翻页挑最接近留存） */
export const CONTROL_FIXED_CANDIDATE_TRIES = 30;

/** @deprecated */
export function controlCandidateTries(_strength?: number): number {
  return CONTROL_FIXED_CANDIDATE_TRIES;
}

export const CONTROL_MIN_BET_COUNT = 1;

export const CONTROL_TARGET_TYPE = 'HOUSE_HOLD_RATIO' as const;

export const CONTROL_SAFETY_MAX_DAYS = 30;

/**
 * 单人偏赢时：同局该房「真人总注 − 真人总派彩」不得低于此值。
 * 0 = 本局该房庄家至少不亏，避免照顾一人拖垮整房。
 * 电玩一人一局无旁人，不套此底线。
 */
export const CONTROL_PLAYER_WIN_HOUSE_FLOOR = 0;

/**
 * 单期总账软控参数（只看本期 F/派彩/人数，不认玩法）。
 *
 * 之所以不按玩法写规则：几百人几千玩法穷举不完，补丁只会越堆越多。
 * 所有玩法都折进「本期总注 F、候选总派彩 C」两个数里。
 */
export type PeriodGuardParams = {
  /** 开档线：自然结果庄家亏 > 此% 才介入 */
  openLossPct: number;
  /** 软着陆目标亏损%（负数=希望庄家小赢） */
  targetLossPct: number;
  /** 通杀判定：候选派彩 ≤ 此% × F（即庄家赢走 ≥80% 流水） */
  wipeoutPayoutPct: number;
  /** 自然亏损额低于此值：认赔，不挑号 */
  smallLossAmount: number;
  /** 自然亏损额达到此值才可能动用通杀 */
  bigLossAmount: number;
  /** 亏损 ≤ 此% × 周期盈利：认赔 */
  cycleLossPctOfProfit: number;
  /** 周期盈利低于此值：不通杀（本来就没赚，别硬追） */
  cycleProfitFloor: number;
  /** 小盘保护：本期有效下注人数下限 */
  minPlayers: number;
  /** 小盘保护：本期总注下限 */
  minStake: number;
};

/** 慢性失血档位：只收紧单期门槛，不直接挑号 */
export type PeriodGearLevel = 'NORMAL' | 'RECOVER' | 'STRONG';

export const PERIOD_GUARD_BASE: PeriodGuardParams = {
  openLossPct: 50,
  targetLossPct: 30,
  wipeoutPayoutPct: 20,
  smallLossAmount: 5000,
  bigLossAmount: 10000,
  cycleLossPctOfProfit: 20,
  cycleProfitFloor: 10000,
  minPlayers: 5,
  minStake: 5000,
};

/** 档位覆盖项；未列出的沿用 PERIOD_GUARD_BASE */
export const PERIOD_GEAR_OVERRIDES: Record<PeriodGearLevel, Partial<PeriodGuardParams>> = {
  NORMAL: {},
  RECOVER: {
    openLossPct: 30,
    targetLossPct: 0,
    smallLossAmount: 3000,
    bigLossAmount: 5000,
  },
  STRONG: {
    openLossPct: 15,
    targetLossPct: -10,
    smallLossAmount: 2000,
    bigLossAmount: 3000,
  },
};

export const PERIOD_GEAR_LABEL: Record<PeriodGearLevel, string> = {
  NORMAL: '正常',
  RECOVER: '回收',
  STRONG: '强回收',
};

export function periodGuardParams(gear: PeriodGearLevel): PeriodGuardParams {
  return { ...PERIOD_GUARD_BASE, ...PERIOD_GEAR_OVERRIDES[gear] };
}

/** 周期账窗口：两天一轮，避免一天内小亏就开始天天收紧 */
export const PERIOD_CYCLE_HOURS = 48;

/** 档位进出线（周期净留存 R%）；进出不同值形成滞回，防抖 */
export const GEAR_ENTER_RECOVER_PCT = -10;
export const GEAR_ENTER_STRONG_PCT = -25;
export const GEAR_EXIT_PCT = -5;

/** 周期流水不足此值不进回收档：样本太小，别把小盘收死 */
export const GEAR_MIN_CYCLE_FLOW = 50000;

/** 档位手动开关三态 */
export type PeriodGearMode = 'AUTO' | 'FORCE_NORMAL' | 'FORCE_RECOVER';
