import { CONTROL_FIXED_CANDIDATE_TRIES } from './control.constants';

export type HoldPolicyRef = { roomId: string; holdRatio: number };

/** 单房策略：目标派彩 = 总下注 × (1 − 留存%) */
export function holdTargetPayout(stake: number, holdRatio: number): number {
  return stake * (1 - holdRatio);
}

/** 加权误差：越偏离目标、注额越大，分越高（挑最小） */
export function holdScore(payout: number, targetPayout: number, stake: number): number {
  return Math.abs(payout - targetPayout) * Math.max(stake, 1);
}

export function matchRoomHoldPolicy<T extends HoldPolicyRef>(
  policies: T[],
  roomId: string | null | undefined,
): T | null {
  if (!roomId) return null;
  return policies.find((p) => p.roomId === roomId) ?? null;
}

/**
 * 街机/电子：开奖前重摇 serverSeed，挑派彩最接近目标的候选。
 * simulate(seed) 须返回与真实结算一致的派彩（含封顶）。
 */
export function pickSeedByHoldTarget<T extends { payout: number }>(opts: {
  policy: HoldPolicyRef | null;
  stake: number;
  tries?: number;
  gen: () => { seed: string; hash: string };
  simulate: (seed: string, hash: string) => T;
}): T & { seed: string; hash: string } {
  const tries = opts.policy ? (opts.tries ?? CONTROL_FIXED_CANDIDATE_TRIES) : 1;
  const target = opts.policy
    ? holdTargetPayout(opts.stake, opts.policy.holdRatio)
    : null;

  let bestSeed = opts.gen();
  let bestBody = opts.simulate(bestSeed.seed, bestSeed.hash);
  let bestScore = target == null
    ? 0
    : holdScore(bestBody.payout, target, opts.stake);

  for (let i = 1; i < tries; i++) {
    const candSeed = opts.gen();
    const body = opts.simulate(candSeed.seed, candSeed.hash);
    if (target == null) break;
    const score = holdScore(body.payout, target, opts.stake);
    if (score < bestScore) {
      bestScore = score;
      bestSeed = candSeed;
      bestBody = body;
    }
  }

  return { ...bestBody, seed: bestSeed.seed, hash: bestSeed.hash };
}
