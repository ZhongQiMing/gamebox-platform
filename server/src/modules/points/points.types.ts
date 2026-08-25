/** 账户与账目的基础类型；抽出来供下限计算等纯函数模块引用，避免反向依赖 PointsService */
export type OwnerType = 'PLATFORM' | 'BRANCH' | 'AGENT' | 'PROXY' | 'CS' | 'PLAYER' | 'ROOM';

export type BizType =
  | 'RECHARGE'
  | 'WITHDRAW'
  | 'TRANSFER_OUT'
  | 'TRANSFER_IN'
  | 'BET'
  | 'WIN'
  | 'FEE'
  | 'COMMISSION'
  | 'REBATE'
  | 'ACTIVITY'
  | 'ADJUST';
