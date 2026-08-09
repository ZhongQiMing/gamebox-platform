/** RoomGameConfig.robotPlan 规范化（控制台写入 + 聊天托人读取共用） */

export type RobotBetStyle = 'follow' | 'random' | 'hedge';

export type RobotFundTalkPlan = {
  enabled: boolean;
  upAmounts: number[];
  downAmounts: number[];
};

export type RobotTimingPlan = {
  /** 开盘线后多少秒才开始刷注 */
  startAfterOpenSec: number;
  /** 封盘前多少秒停止刷注 */
  stopBeforeLockSec: number;
  /** 两条氛围注最短间隔（秒）；实际会按人数压缩 */
  intervalSec: number;
};

/** 一天内按时段托人数（上海时区） */
export type RobotDaySlot = {
  key: 'morning' | 'afternoon' | 'peak' | 'night';
  /** 起始小时 0–23 */
  startHour: number;
  /** 结束小时 1–24（不含；24=当天结束） */
  endHour: number;
  count: number;
};

export type NormalizedRobotPlan = {
  scheme: string;
  betStyle: RobotBetStyle;
  intensity: number;
  winBias: number;
  robotCount: number;
  remark?: string;
  amounts: number[];
  plays: string[];
  timing: RobotTimingPlan;
  fundTalk: RobotFundTalkPlan;
  daySlots: RobotDaySlot[];
};

export const ROBOT_AMOUNT_CHOICES = [
  10, 20, 30, 50, 80, 100, 150, 200, 300, 500, 800, 1000, 2000, 5000,
] as const;

export const DEFAULT_ROBOT_AMOUNTS = [20, 30, 50, 80, 100, 150, 200, 300, 500];

export const DEFAULT_ROBOT_TIMING: RobotTimingPlan = {
  startAfterOpenSec: 3,
  stopBeforeLockSec: 5,
  intervalSec: 5,
};

export const DEFAULT_FUND_UP = [200, 500, 1000, 2000];
export const DEFAULT_FUND_DOWN = [200, 500, 1000, 2000];

const SLOT_KEYS = ['morning', 'afternoon', 'peak', 'night'] as const;

/** 旧 key → 新 key（白天并入下午） */
function migrateSlotKey(raw: string): RobotDaySlot['key'] | null {
  if (raw === 'day') return 'afternoon';
  if ((SLOT_KEYS as readonly string[]).includes(raw)) return raw as RobotDaySlot['key'];
  return null;
}

/** 默认：上午 8–12、下午 12–18、高峰 18–24、夜间 0–8；高峰20→10/12/20/15 */
export function defaultDaySlots(robotCount: number): RobotDaySlot[] {
  const peak = Math.min(50, Math.max(0, Math.floor(robotCount) || 0));
  const morning = peak <= 0 ? 0 : Math.min(50, Math.max(1, Math.round((peak * 10) / 20)));
  const afternoon = peak <= 0 ? 0 : Math.min(50, Math.max(1, Math.round((peak * 12) / 20)));
  const night = peak <= 0 ? 0 : Math.min(50, Math.max(1, Math.round((peak * 15) / 20)));
  return [
    { key: 'morning', startHour: 8, endHour: 12, count: morning },
    { key: 'afternoon', startHour: 12, endHour: 18, count: afternoon },
    { key: 'peak', startHour: 18, endHour: 24, count: peak },
    { key: 'night', startHour: 0, endHour: 8, count: night },
  ];
}

/** 当前小时是否落在 [start, end)（支持跨午夜） */
export function hourInSlot(hour: number, startHour: number, endHour: number): boolean {
  const h = ((Math.floor(hour) % 24) + 24) % 24;
  let s = Math.floor(startHour);
  let e = Math.floor(endHour);
  if (!Number.isFinite(s)) s = 0;
  if (!Number.isFinite(e)) e = 24;
  s = Math.min(23, Math.max(0, s));
  e = Math.min(24, Math.max(0, e));
  if (s === e) return true;
  if (s < e) return h >= s && h < e;
  return h >= s || h < e;
}

const TZ_OFFSET_MS = 8 * 3600 * 1000;

export function shanghaiHour(d = new Date()): number {
  const t = d.getTime() + TZ_OFFSET_MS;
  return new Date(t).getUTCHours();
}

/** 按上海时区取当前时段托人数 */
export function resolveActiveRobotCount(plan: NormalizedRobotPlan, now = new Date()): number {
  if (plan.scheme === 'OFF' || plan.robotCount <= 0) return 0;
  const h = shanghaiHour(now);
  for (const slot of plan.daySlots) {
    if (hourInSlot(h, slot.startHour, slot.endHour)) {
      return Math.min(50, Math.max(0, slot.count));
    }
  }
  return Math.min(50, Math.max(0, plan.robotCount));
}

/** 名册人数取各时段与基准的最大值，保证名字够用 */
export function rosterSizeFor(plan: NormalizedRobotPlan): number {
  const slotMax = plan.daySlots.reduce((m, s) => Math.max(m, s.count), 0);
  return Math.min(50, Math.max(plan.robotCount, slotMax, 0));
}

function uniqPosInts(raw: unknown, maxN: number, maxVal: number): number[] {
  if (!Array.isArray(raw)) return [];
  const out: number[] = [];
  const seen = new Set<number>();
  for (const x of raw) {
    const n = Math.floor(Number(x));
    if (!Number.isFinite(n) || n < 1 || n > maxVal) continue;
    if (seen.has(n)) continue;
    seen.add(n);
    out.push(n);
    if (out.length >= maxN) break;
  }
  return out.sort((a, b) => a - b);
}

function uniqPlays(raw: unknown, maxN: number): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const x of raw) {
    const s = String(x || '').trim().slice(0, 24);
    if (!s || seen.has(s)) continue;
    seen.add(s);
    out.push(s);
    if (out.length >= maxN) break;
  }
  return out;
}

function normalizeDaySlots(raw: unknown, robotCount: number): RobotDaySlot[] {
  const fallback = defaultDaySlots(robotCount);
  if (!Array.isArray(raw) || !raw.length) return fallback;
  const byKey = new Map<string, RobotDaySlot>();
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const row = item as Record<string, unknown>;
    const key = migrateSlotKey(String(row.key || ''));
    if (!key) continue;
    const fb = fallback.find((s) => s.key === key)!;
    let startHour = Math.floor(Number(row.startHour));
    let endHour = Math.floor(Number(row.endHour));
    let count = Math.floor(Number(row.count));
    if (!Number.isFinite(startHour)) startHour = fb.startHour;
    if (!Number.isFinite(endHour)) endHour = fb.endHour;
    if (!Number.isFinite(count)) count = fb.count;
    /* 旧「白天」10–18：并入下午时用默认下午时段，避免整段盖住上午 */
    if (String(row.key || '') === 'day') {
      startHour = fb.startHour;
      endHour = fb.endHour;
    }
    startHour = Math.min(23, Math.max(0, startHour));
    endHour = Math.min(24, Math.max(0, endHour));
    count = Math.min(50, Math.max(0, count));
    byKey.set(key, { key, startHour, endHour, count });
  }
  return SLOT_KEYS.map((k) => byKey.get(k) ?? fallback.find((s) => s.key === k)!);
}

export function normalizeRobotPlan(raw: unknown, robotCountFallback?: number): NormalizedRobotPlan {
  const src = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const schemeRaw = String(src.scheme || 'NORMAL').toUpperCase();
  const scheme = ['OFF', 'LIGHT', 'NORMAL', 'HEAVY', 'CUSTOM'].includes(schemeRaw)
    ? schemeRaw
    : 'NORMAL';
  const betStyleRaw = String(src.betStyle || 'random');
  const betStyle: RobotBetStyle =
    betStyleRaw === 'follow' || betStyleRaw === 'hedge' ? betStyleRaw : 'random';
  let intensity = Math.floor(Number(src.intensity ?? 3));
  if (!Number.isFinite(intensity)) intensity = 3;
  intensity = Math.min(5, Math.max(1, intensity));
  let winBias = Math.floor(Number(src.winBias ?? 0));
  if (!Number.isFinite(winBias)) winBias = 0;
  winBias = Math.min(50, Math.max(-50, winBias));
  let robotCount = Math.floor(Number(src.robotCount ?? robotCountFallback ?? 10));
  if (!Number.isFinite(robotCount)) robotCount = 10;
  robotCount = Math.min(50, Math.max(0, robotCount));
  if (scheme === 'OFF') robotCount = 0;
  const remark = typeof src.remark === 'string' ? src.remark.trim().slice(0, 80) : '';

  let amounts = uniqPosInts(src.amounts, 24, 100_000);
  if (!amounts.length) amounts = [...DEFAULT_ROBOT_AMOUNTS];

  const plays = uniqPlays(src.plays, 40);

  const timingSrc = (src.timing && typeof src.timing === 'object'
    ? src.timing
    : {}) as Record<string, unknown>;
  let startAfterOpenSec = Math.floor(Number(timingSrc.startAfterOpenSec ?? DEFAULT_ROBOT_TIMING.startAfterOpenSec));
  let stopBeforeLockSec = Math.floor(Number(timingSrc.stopBeforeLockSec ?? DEFAULT_ROBOT_TIMING.stopBeforeLockSec));
  let intervalSec = Math.floor(Number(timingSrc.intervalSec ?? DEFAULT_ROBOT_TIMING.intervalSec));
  if (!Number.isFinite(startAfterOpenSec)) startAfterOpenSec = DEFAULT_ROBOT_TIMING.startAfterOpenSec;
  if (!Number.isFinite(stopBeforeLockSec)) stopBeforeLockSec = DEFAULT_ROBOT_TIMING.stopBeforeLockSec;
  if (!Number.isFinite(intervalSec)) intervalSec = DEFAULT_ROBOT_TIMING.intervalSec;
  startAfterOpenSec = Math.min(180, Math.max(0, startAfterOpenSec));
  stopBeforeLockSec = Math.min(120, Math.max(0, stopBeforeLockSec));
  intervalSec = Math.min(60, Math.max(2, intervalSec));

  const fundSrc = (src.fundTalk && typeof src.fundTalk === 'object'
    ? src.fundTalk
    : {}) as Record<string, unknown>;
  const fundEnabled = fundSrc.enabled === false ? false : true;
  let upAmounts = uniqPosInts(fundSrc.upAmounts, 16, 100_000);
  let downAmounts = uniqPosInts(fundSrc.downAmounts, 16, 100_000);
  if (!upAmounts.length) upAmounts = [...DEFAULT_FUND_UP];
  if (!downAmounts.length) downAmounts = [...DEFAULT_FUND_DOWN];

  const daySlots = normalizeDaySlots(src.daySlots, robotCount);
  if (scheme === 'OFF') {
    for (const s of daySlots) s.count = 0;
  }

  return {
    scheme,
    betStyle,
    intensity,
    winBias,
    robotCount,
    remark: remark || undefined,
    amounts,
    plays,
    timing: { startAfterOpenSec, stopBeforeLockSec, intervalSec },
    fundTalk: {
      enabled: fundEnabled,
      upAmounts,
      downAmounts,
    },
    daySlots,
  };
}
