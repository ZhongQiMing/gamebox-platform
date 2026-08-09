/**
 * 单局派彩封顶（全游戏统一）。
 *
 * 存在两个独立上限，取更小者：
 *  - 相对上限：本局总下注 × MAX_WIN_MULTIPLIER，防止小注撞出天价赔付
 *  - 绝对上限：MAX_WIN_ABSOLUTE，兜住 ways/级联/连环奖这类乘法叠加
 *
 * 相对上限只用来拦「赔率表没配过的天价」。已挂牌的赔率（如六合彩四全中 9000 倍）
 * 要靠 oddsMultiplier 抬到该赔率，否则页面写 9000、结算只给 5000，属于不实展示；
 * 绝对上限不放开，仍然兜住单笔敞口。
 */
import { roundMoney } from './money';

export const MAX_WIN_MULTIPLIER = 5000;
export const MAX_WIN_ABSOLUTE = 20_000_000;

/** 本局允许的最大派彩；oddsMultiplier 传该注挂牌赔率时按赔率放行 */
export function maxWinFor(stake: number, oddsMultiplier = MAX_WIN_MULTIPLIER): number {
  const base = Math.max(0, roundMoney(stake));
  const odds = Number.isFinite(oddsMultiplier) ? oddsMultiplier : 0;
  const mult = Math.max(MAX_WIN_MULTIPLIER, odds);
  return Math.min(roundMoney(base * mult), MAX_WIN_ABSOLUTE);
}

/** 派彩封顶；返回 capped 说明触顶，调用方应告警 */
export function capWin(
  stake: number,
  rawWin: number,
  oddsMultiplier = MAX_WIN_MULTIPLIER,
): { win: number; capped: boolean } {
  const limit = maxWinFor(stake, oddsMultiplier);
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
