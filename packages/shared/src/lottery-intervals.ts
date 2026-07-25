/**
 * 彩票开奖间隔唯一数据源（秒）。
 * server scheduler/seed、client 大厅、H5 本地 INTERVAL 均应对齐本表。
 */
export const LOTTERY_INTERVALS: Record<string, number> = {
  ssc: 90,
  ffc: 60,
  'speed-racing': 55,
  bjsc: 60,
  'speed-boat': 60,
  kuai3: 55,
  lhc: 60,
};

/** 封盘提前秒数（与 LotteryService lockAt = openAt - 10s 一致） */
export const LOTTERY_PREP_SEC = 10;

export function lotteryIntervalSec(code: string, dbValue?: number | null): number {
  if (typeof dbValue === 'number' && dbValue > 0) return dbValue;
  return LOTTERY_INTERVALS[code] || 60;
}
