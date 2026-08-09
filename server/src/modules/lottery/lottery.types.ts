/**
 * 彩票通用类型定义
 *
 * 玩法键（betType）采用字符串枚举，各游戏可自行扩展。
 * 赔率表（payTable）格式：{ [betType]: { multiplier, desc } }
 *
 * 分分彩/时时彩/快三/北京赛车 共用同一引擎，通过不同 payTable 和 drawFn 区分。
 */

export interface LotteryPayItem {
  multiplier: number;
  desc: string;
}

export type LotteryPayTable = Record<string, LotteryPayItem>;

/** 玩家投注明细（存 Bet.payload） */
export interface LotteryBetPayload {
  betType: string;        // 玩法，如 "big" | "small" | "odd" | "even" | "exact:3"
  value?: string | number; // 对应 exact 玩法时的猜测值
}

/** 开奖结果 */
export interface DrawResult {
  numbers: number[];      // 各位号码，如 [3,7,2,1,5]
  sum: number;            // 总和
  extras: Record<string, unknown>; // 游戏专属额外字段
}

/** 游戏玩法定义（每款游戏一个实例） */
export interface LotteryGameDef {
  code: string;
  /** 验证投注是否合法 */
  validateBet(betType: string, value?: string | number): boolean;
  /** 执行开奖（返回号码） */
  draw(serverSeed: string, clientSeed: string, nonce: number): DrawResult;
  /** 判断该注是否中奖，返回命中的 payTable key；若未中返回 null */
  judge(bet: LotteryBetPayload, draw: DrawResult, payTable: LotteryPayTable): string | null;
  /**
   * 这一注最高可能的含本倍率，用于下注时按赔率限红。
   * 不实现则退回 payTable[betType]；betType 与赔率键不是一一对应的玩法
   * （如六合彩连码：一个 lianma 能命中四全中 9000 或三全中 670）必须实现。
   */
  maxOdds?(bet: LotteryBetPayload, payTable: LotteryPayTable): number;
}
