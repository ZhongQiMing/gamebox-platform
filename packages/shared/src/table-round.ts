/**
 * 牌桌局号（电子百人场风格）
 * 格式：{前缀}{YYYYMMDD}-{seq4}  例：BJL20260725-0042
 * 序号按该游戏 cycleMs 墙钟周期，从上海时区当日 0 点起算。
 */

export const TABLE_ROUND_PREFIX: Record<string, string> = {
  'dragon-tiger': 'LHD',
  longhu: 'LHD',
  baccarat: 'BJL',
  zhajinhua: 'ZJH',
  douniu: 'DN',
};

export function normalizeTableRoundGameCode(code: string): string {
  if (code === 'longhu') return 'dragon-tiger';
  return code;
}

export function tableRoundPrefix(gameCode: string): string {
  const code = normalizeTableRoundGameCode(gameCode);
  return TABLE_ROUND_PREFIX[code] || TABLE_ROUND_PREFIX[gameCode] || 'TBL';
}

/** Asia/Shanghai 日历日 YYYYMMDD + 当日 0 点 epoch ms */
export function shanghaiDayOf(ms: number): { ymd: string; dayStartMs: number } {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date(ms));
  const get = (t: string) => parts.find((p) => p.type === t)?.value || '01';
  const y = get('year');
  const m = get('month');
  const d = get('day');
  const ymd = `${y}${m}${d}`;
  const dayStartMs = Date.parse(`${y}-${m}-${d}T00:00:00+08:00`);
  return { ymd, dayStartMs };
}

/**
 * @param cycleMs 该游戏整局毫秒（betting+draw+settle）
 * @param now 通常传入本周期 cycleStart，保证同一墙钟周期内局号稳定
 */
export function formatTableRoundNo(
  gameCode: string,
  cycleMs: number,
  now = Date.now(),
): string {
  const cycle = Math.max(1, Math.floor(Number(cycleMs) || 1));
  const cycleStart = Math.floor(now / cycle) * cycle;
  const { ymd, dayStartMs } = shanghaiDayOf(cycleStart);
  const seq = Math.floor((cycleStart - dayStartMs) / cycle) + 1;
  const prefix = tableRoundPrefix(gameCode);
  return `${prefix}${ymd}-${String(Math.max(1, seq)).padStart(4, '0')}`;
}

/**
 * 展示用短号：从完整局号取出当日序号（4 位）。
 * 仅识别新格式 `{前缀}{YYYYMMDD}-{seq}`；旧 T… / 裸数字返回 null。
 * 警告：返回值只允许 UI 展示，禁止当作 roundNo 请求后端。
 */
export function shortTableRoundLabel(roundNo: string): string | null {
  const m = String(roundNo || '')
    .trim()
    .match(/^[A-Z]{2,4}\d{8}-(\d{1,6})$/i);
  if (!m) return null;
  return m[1].padStart(4, '0').slice(-4);
}
