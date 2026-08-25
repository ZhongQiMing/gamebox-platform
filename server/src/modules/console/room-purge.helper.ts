export type RoomPurgeCounts = {
  rounds: number;
  settles: number;
  fundOrders: number;
  leftoverBooks: number;
  rebates: number;
};

/** 有过钱的房只能关，不能物理删，否则对账对不上 */
export function roomPurgeBlockReasons(c: RoomPurgeCounts): string[] {
  const reasons: string[] = [];
  if (c.rounds > 0) reasons.push(`还有 ${c.rounds} 局注单`);
  if (c.settles > 0) reasons.push(`还有 ${c.settles} 张房间结账单`);
  if (c.fundOrders > 0) reasons.push(`还有 ${c.fundOrders} 笔上下分`);
  if (c.leftoverBooks > 0) reasons.push('玩家账本还有余额或流水');
  if (c.rebates > 0) reasons.push(`还有 ${c.rebates} 笔日回水记录`);
  return reasons;
}
