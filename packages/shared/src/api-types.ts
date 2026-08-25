/**
 * 多端共享 API 契约（请求/响应 DTO）。
 * server 产出、client-app / admin-panel 消费，避免各端各自维护同名 interface 漂移。
 * 仅放跨端稳定的公共结构；游戏专属复杂结果仍留在各端 api 层。
 */

/** 统一响应信封 */
export interface ApiEnvelope<T = unknown> {
  code: number;
  data: T;
  message: string;
}

/** 用户画像（登录/拉取当前用户返回） */
export interface UserProfileDTO {
  id: string;
  uid: string;
  username: string;
  nickname: string;
  avatar: string | null;
  role: string;
  status: string;
  promoCode: string | null;
  createdAt: string;
  /** PROXY / CS 挂靠上级；其它角色为 null */
  parentId?: string | null;
  parentRole?: string | null;
}

/** 登录/注册返回 */
export interface AuthResultDTO {
  user: UserProfileDTO;
  token: string;
}

/** 登录请求 */
export interface LoginRequestDTO {
  username: string;
  password: string;
}

/** 注册请求 */
export interface RegisterRequestDTO {
  username: string;
  password: string;
  nickname?: string;
  inviteCode?: string;
}

/** 钱包余额 */
export interface WalletBalanceDTO {
  balance: number;
}

/** 账本流水条目 */
export interface LedgerItemDTO {
  id: string;
  bizType: string;
  amount: number;
  balanceAfter: number;
  remark: string | null;
  createdAt: string;
  /** 上下分等业务订单号（有则展示） */
  orderNo?: string | null;
  /** 上分 / 下分 等展示用方式 */
  method?: string | null;
  refType?: string | null;
  refId?: string | null;
}

/** 分页信封 */
export interface PagedDTO<T> {
  total: number;
  page: number;
  pageSize: number;
  list: T[];
}

/** 游戏目录条目 */
export interface PublicGameConfigDTO {
  version: number;
  /** 仅含玩家展示所需内容；不得包含 RTP、权重或服务端参数。 */
  payTable: unknown;
}

export interface GameItemDTO {
  id: string;
  code: string;
  name: string;
  category: string;
  status: string;
  iconUrl: string | null;
  /** 兼容旧客户端；服务端映射层可暂时同时返回。 */
  coverUrl?: string | null;
  sortOrder: number;
  minBet: number;
  maxBet: number;
  configs: PublicGameConfigDTO[];
}

export interface BetHistoryDetailDTO {
  position: string;
  amount: number;
  payout: number;
  multiplier: number;
  won: boolean;
}

export interface BetHistoryRowDTO {
  id: string;
  betNo: string;
  amount: number;
  payout: number;
  validBet: number;
  status: string;
  createdAt: string;
  game: { name: string; code: string };
  roundId: string | null;
  roundNo: string | null;
  outcome: unknown;
  details: BetHistoryDetailDTO[];
}
