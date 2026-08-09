import type { GameCategory } from '@gamebox/shared';

/**
 * 游戏内核通用类型。
 * 设计目标：彩票/棋牌/电子/街机四类游戏机制不同，但都通过统一接口接入，
 *          结算统一汇入「积分账本 + 多级分润」。
 */

/** 一次下注请求（前端发起，服务端校验） */
export interface PlaceBetInput {
  playerId: string;
  gameCode: string;
  amount: number;
  /** 彩票：玩法 key；棋牌：动作；电子/街机：可空 */
  betType?: string;
  /** 投注明细（号码/筹码分布/动作参数） */
  payload?: Record<string, unknown>;
  /** 彩票需要：期号 id；棋牌：局 id */
  issueId?: string;
  roundId?: string;
  /** 可证明公平：客户端种子 */
  clientSeed?: string;
  /** 幂等键：同一意图重试复用，避免重复扣款开奖 */
  clientRequestId?: string;
  /** 6 位运营房间号（多房隔离） */
  roomNo?: string;
}

/** 单个玩家的结算结果 */
export interface BetSettlement {
  betId: string;
  playerId: string;
  amount: number; // 下注额
  payout: number; // 派彩（含本金，0 表示输）
  multiplier: number; // 命中倍率
  odds: number; // 命中赔率
  won: boolean;
  validFlow: number; // 有效流水（算分润/回水）
}

/** 一次开奖/一局的整体结算汇总 */
export interface SettlementSummary {
  gameCode: string;
  category: GameCategory;
  refType: 'issue' | 'round';
  refId: string;
  totalFlow: number;
  /** 开奖结果明细（号码/牌面，供前端展示 + 审计） */
  outcome: Record<string, unknown>;
  /** 每个玩家的结算 */
  bets: BetSettlement[];
  /** 可证明公平 */
  serverSeed?: string;
  serverSeedHash?: string;
}

/**
 * 游戏引擎统一接口。
 * 每个品类（lottery/table/slot/arcade）实现一份，供各自模块直接注入使用。
 */
export interface IGameEngine {
  readonly category: GameCategory;

  /** 校验并受理一次下注（扣注走账本 BET，写 Bet=PENDING） */
  placeBet(input: PlaceBetInput): Promise<{ betId: string }>;

  /**
   * 生成结果并结算：
   *   - 服务端用 active 的 GameConfig 计算结果（爆率/赔率）
   *   - 派彩走账本 WIN
   *   - 触发抽水(FEE) + 多级分润(COMMISSION) + 回水(REBATE)
   * 彩票按期号批量；棋牌/电子按局。
   */
  settle(refId: string): Promise<SettlementSummary>;
}
