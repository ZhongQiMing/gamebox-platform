/**
 * 单局派彩封顶（全游戏统一）。
 *
 * 存在两个独立上限，取更小者：
 *  - 相对上限：本局总下注 × MAX_WIN_MULTIPLIER，防止小注撞出天价赔付
 *  - 绝对上限：MAX_WIN_ABSOLUTE，兜住 ways/级联/连环奖这类乘法叠加
 *
 * 没有封顶时，麻将单步理论上限是 (下注/基准注)×100×1024ways×10倍 —— 
 * 足以一把打穿平台池，并逼近 Int 字段 21.47 亿的上限。
 */
export const MAX_WIN_MULTIPLIER = 5000;
export const MAX_WIN_ABSOLUTE = 20_000_000;

/** 本局允许的最大派彩 */
export function maxWinFor(stake: number): number {
  const base = Math.max(0, Math.floor(stake));
  return Math.min(base * MAX_WIN_MULTIPLIER, MAX_WIN_ABSOLUTE);
}

/** 派彩封顶；返回 capped 说明触顶，调用方应告警 */
export function capWin(stake: number, rawWin: number): { win: number; capped: boolean } {
  const limit = maxWinFor(stake);
  const raw = Math.max(0, Math.floor(rawWin));
  return raw > limit ? { win: limit, capped: true } : { win: raw, capped: false };
}

/**
 * 多仓/多线整局封顶后按比例拆到各注。
 * 余数逐票 +1，保证 Σwins === cappedTotal。
 */
export function allocateCappedWins(
  stake: number,
  parts: number[],
): { wins: number[]; total: number; capped: boolean } {
  const raw = parts.map((p) => Math.max(0, Math.floor(p)));
  const rawTotal = raw.reduce((s, p) => s + p, 0);
  const { win: total, capped } = capWin(stake, rawTotal);
  if (rawTotal <= 0 || total === rawTotal) {
    return { wins: raw, total, capped };
  }
  const wins = raw.map((p) => Math.floor((p * total) / rawTotal));
  let allocated = wins.reduce((s, w) => s + w, 0);
  for (let i = 0; allocated < total && i < wins.length; i++) {
    if (raw[i]! <= 0) continue;
    wins[i]! += 1;
    allocated += 1;
  }
  return { wins, total, capped };
}
