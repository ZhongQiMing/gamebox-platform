/**
 * 单局派彩封顶（全游戏统一）。
 *
 * 存在两个独立上限，取更小者：
 *  - 相对上限：本局总下注 × MAX_WIN_MULTIPLIER，防止小注撞出天价赔付
 *  - 绝对上限：MAX_WIN_ABSOLUTE，兜住 ways/级联/连环奖这类乘法叠加
 */
import { roundMoney } from './money';

export const MAX_WIN_MULTIPLIER = 5000;
export const MAX_WIN_ABSOLUTE = 20_000_000;

/** 本局允许的最大派彩 */
export function maxWinFor(stake: number): number {
  const base = Math.max(0, roundMoney(stake));
  return Math.min(roundMoney(base * MAX_WIN_MULTIPLIER), MAX_WIN_ABSOLUTE);
}

/** 派彩封顶；返回 capped 说明触顶，调用方应告警 */
export function capWin(stake: number, rawWin: number): { win: number; capped: boolean } {
  const limit = maxWinFor(stake);
  const raw = Math.max(0, roundMoney(rawWin));
  return raw > limit ? { win: limit, capped: true } : { win: raw, capped: false };
}

/**
 * 多仓/多线整局封顶后按比例拆到各注。
 * 余数按 0.01 逐票补齐，保证 Σwins === cappedTotal（两位小数）。
 */
export function allocateCappedWins(
  stake: number,
  parts: number[],
): { wins: number[]; total: number; capped: boolean } {
  const raw = parts.map((p) => Math.max(0, roundMoney(p)));
  const rawTotal = roundMoney(raw.reduce((s, p) => s + p, 0));
  const { win: total, capped } = capWin(stake, rawTotal);
  if (rawTotal <= 0 || total === rawTotal) {
    return { wins: raw, total, capped };
  }
  const wins = raw.map((p) => roundMoney((p * total) / rawTotal));
  let allocated = roundMoney(wins.reduce((s, w) => s + w, 0));
  let i = 0;
  while (allocated + 0.005 < total && i < wins.length * 200) {
    const idx = i % wins.length;
    if (raw[idx]! > 0) {
      wins[idx] = roundMoney(wins[idx]! + 0.01);
      allocated = roundMoney(allocated + 0.01);
    }
    i += 1;
  }
  return { wins, total, capped };
}
