/**
 * 即时开奖（街机 / 电子）跨端契约。
 * 只描述请求/响应形状与幂等约定，不含 UI。
 */

/** 客户端生成、同一次「开奖意图」重试必须复用 */
export function assertClientRequestId(id: unknown): asserts id is string {
  if (typeof id !== 'string' || id.length < 8 || id.length > 100) {
    throw new Error('clientRequestId 无效');
  }
}

export interface InstantSpinIdempotency {
  clientRequestId: string;
  clientSeed?: string;
}

export interface InstantArcadeSpinRequest extends InstantSpinIdempotency {
  gameCode: string;
  /** 仓位/符号 → 押注额 */
  bets: Record<string, number>;
}

export interface InstantSpinBalanceSlice {
  balance: number;
  roundId: string;
  totalBet: number;
  totalPayout: number;
}
