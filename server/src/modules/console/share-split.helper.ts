/**
 * 庄家盈亏的三段拆：代理拿自己那成，总代拿成数差，平台拿剩下的。
 *
 * 房间结账（平台↔代理）与总代账期（平台↔总代）必须用同一套公式，
 * 否则月结的房被四次周结各算一段之后，加起来对不上代理那次月结的数。
 */
import { asMoney, roundMoney } from '@gamebox/shared';

export type HouseShareSplit = {
  /** 代理那一成 */
  agentShareAmount: number;
  /** 总代成数差；未挂总代恒为 0 */
  generalShareAmount: number;
  /** 平台应得 = 盈亏 − 代理 − 总代 */
  platformShareAmount: number;
  /** 代理该跟直接上家交割的基数：中间多一层总代也不能让代理少付 */
  agentPayBase: number;
  /** 实际生效的总代成数（低于代理成数时按代理算） */
  generalShareRate: number;
};

export function splitHouseShare(
  housePnl: number,
  agentShareRate: number,
  generalShareRate?: number | null,
): HouseShareSplit {
  const a = Math.min(1, Math.max(0, Number(agentShareRate) || 0));
  /* 总代成数被改到低于代理时，成数差会变负、等于总代倒贴，按代理成数兜住 */
  const g =
    generalShareRate == null ? a : Math.min(1, Math.max(a, Number(generalShareRate) || 0));
  const pnl = asMoney(housePnl);
  const agentShareAmount = roundMoney(pnl * a);
  const generalShareAmount = roundMoney(pnl * (g - a));
  return {
    agentShareAmount,
    generalShareAmount,
    platformShareAmount: roundMoney(pnl - agentShareAmount - generalShareAmount),
    agentPayBase: roundMoney(pnl - agentShareAmount),
    generalShareRate: g,
  };
}
