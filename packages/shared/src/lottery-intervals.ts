/**
 * 彩票开奖间隔唯一数据源（秒）。
 * server scheduler/seed、client 大厅、H5 本地 INTERVAL 均应对齐本表。
 */
export const LOTTERY_INTERVALS: Record<string, number> = {
  ssc: 60,
  ffc: 55,
  /** 极速赛车：下注 41s + 开奖中 19s（盖住约 17s 竞速动画：倒计时3+中段8+领奖台6） */
  'speed-racing': 60,
  /** 北京赛车：下注 45s + 开奖中 30s（盖住约 28s 正版竞速动画） */
  bjsc: 75,
  /** 幸运飞艇：下注 41s + 开奖中 19s（与极速赛车同结构：倒计时3+中段8+领奖台6） */
  'speed-boat': 60,
  kuai3: 55,
  /** 幸运六合彩：下注约 40s + 开奖中 35s（盖住摇珠 + 七球报号） */
  lhc: 75,
};

/** 默认封盘提前秒数（开奖中窗口） */
export const LOTTERY_PREP_SEC = 10;

/** 按游戏覆盖封盘提前秒数（lockAt = openAt - prep） */
export const LOTTERY_PREP_BY_GAME: Record<string, number> = {
  bjsc: 30,
  'speed-racing': 19,
  'speed-boat': 19,
  /** 快乐/1分时时彩：盖住滚号约 6s + 出号约 3.2s + 核对余量 */
  ssc: 14,
  ffc: 14,
  /** 1分快三：封盘后出卡 + 倒计时 3s + 摇骰约 5s + 出号余量 */
  kuai3: 14,
  /** 幸运六合彩：摇珠 + 七球「第N个+号码」报号（约 30s）+ 余量 */
  lhc: 35,
};

export function lotteryIntervalSec(code: string, dbValue?: number | null): number {
  if (typeof dbValue === 'number' && dbValue > 0) return dbValue;
  return LOTTERY_INTERVALS[code] || 60;
}

export function lotteryPrepSec(code: string): number {
  const n = LOTTERY_PREP_BY_GAME[code];
  if (typeof n === 'number' && n > 0) return n;
  return LOTTERY_PREP_SEC;
}
