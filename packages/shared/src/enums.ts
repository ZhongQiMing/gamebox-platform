/** 与后端 Prisma enum 字符串值保持一致 */

/**
 * 用户角色 —— 多级盘口体系
 * 业务树：管理(ADMIN) = 总监(BRANCH) → 总代(GENERAL) → 代理(AGENT) → 玩家(PLAYER)
 */
export const UserRole = {
  ADMIN: 'ADMIN', // 平台唯一管理
  BRANCH: 'BRANCH', // 总监（与管理同池，不吃流水）
  GENERAL: 'GENERAL', // 总代
  AGENT: 'AGENT', // 代理
  PROXY: 'PROXY', // 子账号（只读）
  CS: 'CS', // 客服（上下分）
  PLAYER: 'PLAYER', // 玩家
} as const;
export type UserRole = (typeof UserRole)[keyof typeof UserRole];

export const UserStatus = {
  ACTIVE: 'ACTIVE',
  DISABLED: 'DISABLED',
  /** 玩家自助注销：不可登录、不可恢复；账目保留 */
  CLOSED: 'CLOSED',
} as const;
export type UserStatus = (typeof UserStatus)[keyof typeof UserStatus];

/** 积分账户主体类型 */
export const AccountOwnerType = {
  PLATFORM: 'PLATFORM',
  BRANCH: 'BRANCH',
  AGENT: 'AGENT',
  PROXY: 'PROXY',
  CS: 'CS',
  PLAYER: 'PLAYER',
  ROOM: 'ROOM', // 历史房间分桶（已废弃，结算统一走平台盘口池）
} as const;
export type AccountOwnerType = (typeof AccountOwnerType)[keyof typeof AccountOwnerType];

/** 账本业务类型 */
export const LedgerBizType = {
  RECHARGE: 'RECHARGE', // 上分 / 平台下发额度
  WITHDRAW: 'WITHDRAW', // 下分
  TRANSFER_OUT: 'TRANSFER_OUT',
  TRANSFER_IN: 'TRANSFER_IN',
  BET: 'BET', // 下注
  WIN: 'WIN', // 派彩
  FEE: 'FEE', // 平台抽水
  COMMISSION: 'COMMISSION', // 代理分成（逐级）
  REBATE: 'REBATE', // 回水
  ACTIVITY: 'ACTIVITY', // 活动奖励
  ADJUST: 'ADJUST', // 人工调整
} as const;
export type LedgerBizType = (typeof LedgerBizType)[keyof typeof LedgerBizType];

/** 上下分类型 */
export const RechargeType = {
  UP: 'UP', // 上分
  DOWN: 'DOWN', // 下分
} as const;
export type RechargeType = (typeof RechargeType)[keyof typeof RechargeType];

/** 通用审核状态 */
export const ReviewStatus = {
  PENDING: 'PENDING',
  APPROVED: 'APPROVED',
  REJECTED: 'REJECTED',
} as const;
export type ReviewStatus = (typeof ReviewStatus)[keyof typeof ReviewStatus];

/**
 * 游戏品类 —— 决定引擎与开奖方式
 *   LOTTERY 彩票：期号 + 定时开奖（ssc/ffc/kuai3/bjsc/lhc/赛车/赛艇）
 *   TABLE   棋牌：房间→桌→局，多人实时（麻将/斗牛/炸金花/龙虎/百家乐）
 *   SLOT    电子：单机即开即结，按爆率表（如水果机）
 *   ARCADE  街机：多仓位即时开奖（水果机 / bcbm 等）
 */
export const GameCategory = {
  LOTTERY: 'LOTTERY',
  TABLE: 'TABLE',
  SLOT: 'SLOT',
  ARCADE: 'ARCADE',
} as const;
export type GameCategory = (typeof GameCategory)[keyof typeof GameCategory];

export const GameStatus = {
  ONLINE: 'ONLINE',
  OFFLINE: 'OFFLINE',
  MAINTENANCE: 'MAINTENANCE',
} as const;
export type GameStatus = (typeof GameStatus)[keyof typeof GameStatus];

/** 彩票期号状态 */
export const IssueStatus = {
  PENDING: 'PENDING', // 未开奖（可投注）
  LOCKED: 'LOCKED', // 封盘（停止投注，待开奖）
  DRAWN: 'DRAWN', // 已开奖
  CANCELLED: 'CANCELLED',
} as const;
export type IssueStatus = (typeof IssueStatus)[keyof typeof IssueStatus];

/** 注单结算状态 */
export const BetStatus = {
  PENDING: 'PENDING', // 待结算
  WON: 'WON',
  LOST: 'LOST',
  CANCELLED: 'CANCELLED',
} as const;
export type BetStatus = (typeof BetStatus)[keyof typeof BetStatus];

/** 活动类型 */
export const ActivityType = {
  FIRST_DEPOSIT: 'FIRST_DEPOSIT',
  WIN_STREAK: 'WIN_STREAK',
  ACCUMULATE: 'ACCUMULATE',
  VIP: 'VIP',
  PROMO: 'PROMO',
  NEWBIE: 'NEWBIE',
} as const;
export type ActivityType = (typeof ActivityType)[keyof typeof ActivityType];
