/**
 * 牌桌墙钟周期唯一数据源（毫秒）。
 * server table-rules、大厅 intervalSec/prepSec、H5 本地兜底均应对齐本表。
 *
 * 整局 cycle = betting + draw + settle
 * 大厅：intervalSec = cycle/1000，prepSec = (draw+settle)/1000
 */

export const TABLE_BETTING_MS = 45_000;
export const TABLE_SETTLE_MS = 4_000;

export type TableTiming = {
  cycleMs: number;
  bettingMs: number;
  drawMs: number;
  settleMs: number;
};

/** 发牌动画窗口（毫秒）；下注统一 45s，派奖默认 4s */
export const TABLE_DRAW_MS: Record<string, number> = {
  'dragon-tiger': 9_000,
  longhu: 9_000,
  baccarat: 12_000,
  zhajinhua: 13_000,
  douniu: 17_000,
};

function normalizeTimingCode(code: string): string {
  if (code === 'longhu') return 'dragon-tiger';
  return code;
}

function makeTiming(drawMs: number, settleMs = TABLE_SETTLE_MS): TableTiming {
  const bettingMs = TABLE_BETTING_MS;
  return {
    bettingMs,
    drawMs,
    settleMs,
    cycleMs: bettingMs + drawMs + settleMs,
  };
}

export const TABLE_TIMING: Record<string, TableTiming> = {
  'dragon-tiger': makeTiming(TABLE_DRAW_MS['dragon-tiger']),
  longhu: makeTiming(TABLE_DRAW_MS.longhu),
  baccarat: makeTiming(TABLE_DRAW_MS.baccarat),
  zhajinhua: makeTiming(TABLE_DRAW_MS.zhajinhua),
  douniu: makeTiming(TABLE_DRAW_MS.douniu),
};

export function tableTimingOf(gameCode: string): TableTiming {
  const code = normalizeTimingCode(gameCode);
  return TABLE_TIMING[code] ?? TABLE_TIMING.baccarat;
}

/** 孤儿退款宽限用：最长整局 */
export function maxTableCycleMs(): number {
  let max = 0;
  for (const t of Object.values(TABLE_TIMING)) {
    if (t.cycleMs > max) max = t.cycleMs;
  }
  return max || 66_000;
}

export function tableLobbyIntervalSec(gameCode: string): number {
  return Math.round(tableTimingOf(gameCode).cycleMs / 1000);
}

export function tableLobbyPrepSec(gameCode: string): number {
  const t = tableTimingOf(gameCode);
  return Math.round((t.drawMs + t.settleMs) / 1000);
}
