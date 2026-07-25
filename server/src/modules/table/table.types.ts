/** 棋牌实时桌面共用类型 */

/** 龙虎斗牌面（旧格式，dragon-tiger.game 内部用） */
export interface Card {
  suit: 'S' | 'H' | 'D' | 'C';
  rank: number;
}

export interface DragonTigerOutcome {
  dragon: Card;
  tiger: Card;
  winner: 'DRAGON' | 'TIGER' | 'TIE';
}

export type TablePhase = 'BETTING' | 'DRAWING' | 'SETTLED' | 'PAUSED';

export interface TableHistoryItem {
  roundNo: string;
  outcome: Record<string, unknown>;
  createdAt: string;
  serverSeedHash?: string;
  serverSeed?: string;
  nonce?: number;
}

/** 前端收到的桌面快照（outcome 按游戏不同） */
export interface TableSnapshot {
  roomId: string;
  gameCode: string;
  phase: TablePhase;
  roundNo: string;
  secondsLeft: number;
  outcome?: Record<string, unknown>;
  betSummary: Record<string, number>;
  history: TableHistoryItem[];
  /** 下注期公开承诺；封盘后可对照 serverSeed */
  serverSeedHash: string;
  /** 封盘后公开，用于复算 */
  serverSeed?: string;
  nonce: number;
  /** 周期配置（与 @gamebox/shared table-timing 同源），供 H5 校准本地兜底 */
  timing?: {
    bettingMs: number;
    drawMs: number;
    settleMs: number;
    cycleMs: number;
  };
}

export interface TableBetPayload {
  roomId: string;
  side: string;
  amount: number;
  /** 客户端幂等键：短时内重复提交返回同一结果，防连点双扣 */
  clientKey?: string;
}
