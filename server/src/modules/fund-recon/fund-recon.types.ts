/** 资金对账：检查项与报告结构（服务端与管理端共用口径） */

export type ReconCheckKey =
  | 'points_sum'
  | 'quota_sum'
  | 'frozen_orders'
  | 'negative_balance';

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
  /** 能否用「补记差错调整」把账做平 */
  fixable: boolean;
}

export interface ReconReport {
  checkedAt: string;
  durationMs: number;
  ok: boolean;
  totalBad: number;
  checks: ReconCheck[];
}
