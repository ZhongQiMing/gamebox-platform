/**
 * 庄家盈亏的三段拆：代理拿自己那成，总代拿成数差，平台拿剩下的。
 *
 * 飞上台的注：房间结账与总代账期共用 splitHouseShare。
 * 代理飞、总代关：钱在总代，平台不分这截；总代↔代理用 splitAgentFlyingHouse。
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

/**
 * 现金盘飞盘：玩家输赢已经落在平台账上。
 * 上家应付代理 = 代理占成额（正=上家付给代理，负=代理补给上家）。
 */
export function cashFlownPayToAgent(agentShareAmount: number): number {
  return roundMoney(agentShareAmount);
}

/**
 * 平台↔总代（飞上台）：钱在平台账上，不看房间是现金还是信用。
 * 对方应付平台 = −(代理占成 + 总代成数差)。
 * 总代表：平台把代理那份和成数差一起付给总代；总代跟代理怎么结是另一张单。
 * 直挂表：没有总代，就是 −代理占成。
 */
export function cashFlownPayToPlatform(
  agentShareAmount: number,
  generalShareAmount = 0,
): number {
  return roundMoney(-(Number(agentShareAmount) + Number(generalShareAmount)));
}

export type AgentFlyingShareSplit = HouseShareSplit & {
  flownHousePnl: number;
  generalSatHousePnl: number;
  housePnl: number;
  flownAgentShare: number;
  satAgentShare: number;
};

/**
 * 总代↔代理：代理全部飞盘。
 * 飞上台仍三段拆；总代坐庄那截平台拿 0，总代留下减掉代理占成之后的。
 */
export function splitAgentFlyingHouse(
  flownHousePnl: number,
  generalSatHousePnl: number,
  agentShareRate: number,
  generalShareRate?: number | null,
): AgentFlyingShareSplit {
  const flown = splitHouseShare(flownHousePnl, agentShareRate, generalShareRate);
  const sat = asMoney(generalSatHousePnl);
  const a = Math.min(1, Math.max(0, Number(agentShareRate) || 0));
  const satAgentShare = roundMoney(sat * a);
  const satGeneralKeep = roundMoney(sat - satAgentShare);
  return {
    agentShareAmount: roundMoney(flown.agentShareAmount + satAgentShare),
    generalShareAmount: roundMoney(flown.generalShareAmount + satGeneralKeep),
    platformShareAmount: flown.platformShareAmount,
    agentPayBase: roundMoney(flown.agentPayBase + satGeneralKeep),
    generalShareRate: flown.generalShareRate,
    flownHousePnl: asMoney(flownHousePnl),
    generalSatHousePnl: sat,
    housePnl: asMoney(asMoney(flownHousePnl) + sat),
    flownAgentShare: flown.agentShareAmount,
    satAgentShare,
  };
}

/** 总代↔代理（信用盘反过来）：飞上台代理上缴其余；总代坐庄付给代理占成。 */
export function creditAgentFlyPayToAgent(split: AgentFlyingShareSplit): number {
  return roundMoney(-(split.flownHousePnl - split.flownAgentShare) + split.satAgentShare);
}

/** 一间房拆给三方算净赚所需的全部输入 */
export type RoomEarningInput = {
  /** 飞上台：平台坐庄那部分的输赢 */
  flownHousePnl: number;
  /** 总代坐庄那部分的输赢 */
  generalSatHousePnl: number;
  /** 代理自己关盘那部分的输赢 */
  agentSatHousePnl: number;
  agentShareRate: number;
  /** 未挂总代传 null */
  generalShareRate?: number | null;
};

export type RoleEarning = {
  /** 我自己坐庄那部分的毛输赢 */
  satHousePnl: number;
  /** 我最终分到的那份：平台=平台占成；总代=成数差+坐庄留存；代理=飞出去部分的占成 */
  myShareAmount: number;
  /** 我付出去的挂靠佣金（只有代理有） */
  commissionAmount: number;
  /** 我今日净赚 */
  netEarning: number;
};

/**
 * 三方各自「今天到底赚了多少」，同一套输入算出来，口径不会打架。
 *
 * - 平台：坐庄的是飞上台那批，分给代理和总代之后剩下的才是自己的
 * - 总代：飞上去的拿成数差，自己坐庄的扣掉代理占成后留下
 *   （两截都在 splitAgentFlyingHouse().generalShareAmount 里）
 * - 代理：飞出去的拿占成，自己关盘的全归自己，再减掉挂靠佣金
 *
 * 关盘由谁坐庄谁自负，所以代理关盘那截不会出现在总代和平台的净赚里。
 */
export function roleEarning(
  side: 'PLATFORM' | 'GENERAL' | 'AGENT',
  rooms: RoomEarningInput[],
  commissionAmount = 0,
): RoleEarning {
  let satHousePnl = 0;
  let myShareAmount = 0;

  for (const r of rooms) {
    const split = splitAgentFlyingHouse(
      r.flownHousePnl,
      r.generalSatHousePnl,
      r.agentShareRate,
      r.generalShareRate,
    );
    if (side === 'PLATFORM') {
      satHousePnl = roundMoney(satHousePnl + asMoney(r.flownHousePnl));
      myShareAmount = roundMoney(myShareAmount + split.platformShareAmount);
    } else if (side === 'GENERAL') {
      satHousePnl = roundMoney(satHousePnl + asMoney(r.generalSatHousePnl));
      myShareAmount = roundMoney(myShareAmount + split.generalShareAmount);
    } else {
      satHousePnl = roundMoney(satHousePnl + asMoney(r.agentSatHousePnl));
      myShareAmount = roundMoney(myShareAmount + split.agentShareAmount);
    }
  }

  const commission = side === 'AGENT' ? roundMoney(commissionAmount) : 0;
  /* 平台与总代的 myShareAmount 已经含了各自坐庄留存，不能再加一遍 satHousePnl */
  const netEarning =
    side === 'AGENT'
      ? roundMoney(myShareAmount + satHousePnl - commission)
      : myShareAmount;

  return { satHousePnl, myShareAmount, commissionAmount: commission, netEarning };
}
