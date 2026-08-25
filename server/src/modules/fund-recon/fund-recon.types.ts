/** 资金对账：检查项与报告结构（服务端与管理端共用口径） */

export type ReconCheckKey =
  /* 自洽性：余额与自己那本流水对不对得上 */
  | 'points_sum'
  | 'quota_sum'
  | 'frozen_orders'
  | 'negative_balance'
  | 'credit_conservation'
  | 'general_house_ledger'
  /* 结算正确性：游戏有没有把钱吞掉或多派 */
  | 'swallowed_bets'
  | 'bet_debit_voucher'
  | 'duplicate_payout'
  | 'global_ledger_net'
  /* 回水可达性：有流水但永远领不到回水 */
  | 'bet_without_room'
  /* 运行健康：平台余额的合并工人有没有在干活 */
  | 'platform_apply_backlog';

export interface ReconRow {
  /** 修复入口按此区分：ACCOUNT 补积分流水，AGENT 补盘分流水，NONE 只能人工处理 */
  scope: 'ACCOUNT' | 'AGENT' | 'NONE';
  /** accountId 或 agentUserId */
  id: string;
  /** 展示用：昵称（UID）· 角色 · 房间 */
  label: string;
  /** 账面数（余额 / 额度 / 冻结额） */
  actual: number;
  /** 按流水或凭据算出来应该是多少 */
  expected: number;
  /** actual − expected */
  drift: number;
}

export interface ReconCheck {
  key: ReconCheckKey;
  label: string;
  /** 查出行说明什么问题，直接给运营看 */
  hint: string;
  /** 异常总行数（可能大于 rows.length） */
  bad: number;
  /** 明细，按差额绝对值倒序，最多 MAX_ROWS 行 */
  rows: ReconRow[];
  /**
   * 是否作为出款闸门的判据。
   *
   * 只有「账本本身被破坏」才该拦出款：余额与流水对不上、钱凭空出现或被多派。
   * 那些属于正常经营波动或单点卡单的项（信用盘偏离、待审下分单卡住、吞单）
   * 只告警不拦——拿正常波动去停掉全站出款，结果就是所有人天天点放行，
   * 闸门就废了。
   */
  gating: boolean;
}

export interface ReconReport {
  checkedAt: string;
  durationMs: number;
  ok: boolean;
  totalBad: number;
  checks: ReconCheck[];
}
