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

/** 所有可执行控奖的游戏（含别名 longhu） */
export const CONTROL_EXECUTABLE_CODES = [
  ...CONTROL_LOTTERY_CODES,
  ...CONTROL_TABLE_CODES,
  'longhu',
  ...CONTROL_ARCADE_CODES,
] as const;

/** 前端游戏清单 */
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

/** 运营不再手调深度：生效策略统一用此候选次数 */
export const CONTROL_FIXED_CANDIDATE_TRIES = 12;

/** @deprecated */
export function controlCandidateTries(_strength?: number): number {
  return CONTROL_FIXED_CANDIDATE_TRIES;
}

export const CONTROL_MIN_BET_COUNT = 1;

export const CONTROL_TARGET_TYPE = 'HOUSE_HOLD_RATIO' as const;

export const CONTROL_SAFETY_MAX_DAYS = 30;
