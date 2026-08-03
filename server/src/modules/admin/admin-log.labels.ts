/** 操作日志：动作中文名 + 可读摘要（运营向，非开发向） */

export const ADMIN_ACTION_META: Record<string, { label: string; group: string }> = {
  QUOTA_SELL: { label: '出售额度', group: '资金' },
  QUOTA_RECALL: { label: '回收额度', group: '资金' },
  CONSOLE_CREDIT: { label: '玩家上分', group: '资金' },
  CONSOLE_DEBIT: { label: '玩家下分', group: '资金' },
  ROOM_FUND: { label: '房间盘口注资', group: '资金' },
  AGENT_ISSUE: { label: '代理发分', group: '资金' },
  RECHARGE_APPROVE: { label: '通过上下分申请', group: '资金' },
  RECHARGE_REJECT: { label: '拒绝上下分申请', group: '资金' },

  GAME_STATUS_CHANGE: { label: '游戏状态变更', group: '游戏' },
  GAME_BASICS_UPDATE: { label: '游戏基础信息', group: '游戏' },
  GAME_CONFIG_UPDATE: { label: '更新游戏配置', group: '游戏' },
  GAME_CONFIG_ACTIVATE: { label: '启用游戏配置', group: '游戏' },
  GAME_REORDER: { label: '调整游戏排序', group: '游戏' },
  GAME_DAY_CUT: { label: '游戏日切', group: '游戏' },
  GAME_MAINT_START: { label: '进入维护窗', group: '游戏' },
  GAME_MAINT_END: { label: '结束维护窗', group: '游戏' },

  ROOM_CREATE: { label: '创建房间', group: '房间' },
  ROOM_STATUS: { label: '房间状态变更', group: '房间' },
  ROOM_DELETE: { label: '删除房间', group: '房间' },
  ROOM_SOFT_DELETE: { label: '软删房间', group: '房间' },
  ROOM_ROTATE_CODE: { label: '轮换房间号', group: '房间' },
  ROOM_GRANT_OWNER: { label: '授予房主可见', group: '房间' },
  ROOM_REVOKE_OWNER: { label: '取消房主可见', group: '房间' },
  ROOM_AGENT_RESET_PWD: { label: '重置房间代理密码', group: '房间' },
  ROOM_BILLING_UPDATE: { label: '房间月费设置', group: '房间' },
  ROOM_GAME_CONFIG: { label: '房间游戏配置', group: '房间' },
  ROOM_BILL_OK: { label: '房间月费扣款成功', group: '房间' },
  ROOM_BILL_FREEZE: { label: '房间欠费冻结', group: '房间' },

  CONTROL_CREATE: { label: '新建控奖策略', group: '控奖' },
  CONTROL_STATUS: { label: '控奖策略状态', group: '控奖' },
  CONTROL_EXHAUSTED: { label: '控奖目标达成', group: '控奖' },
  CONTROL_DELETE: { label: '删除控奖策略', group: '控奖' },

  REBATE_POLICY: { label: '回水规则', group: '回水' },
  REBATE_RATE: { label: '设置回水比例', group: '回水' },
  PLAYER_REBATE: { label: '玩家回水比例', group: '回水' },
  COMMISSION_RATE: { label: '设置佣金比例', group: '回水' },
  PLAYER_FLY: { label: '玩家飞盘开关', group: '回水' },

  USER_STATUS: { label: '账号状态变更', group: '账号' },
  AGENT_CREATE: { label: '创建下级账号', group: '账号' },
  AGENT_LEVEL_SET: { label: '设置代理层级', group: '账号' },
  CS_DUTY_SET: { label: '设置值班客服', group: '账号' },
  CS_DUTY_CLEAR: { label: '清空值班客服', group: '账号' },

  RISK_EVENT_HANDLE: { label: '处理风控告警', group: '风控' },
  RISK_EVENT_BATCH_HANDLE: { label: '批量处理风控', group: '风控' },
};

export const GAME_STATUS_LABEL: Record<string, string> = {
  ONLINE: '上架',
  OFFLINE: '下架',
  MAINTENANCE: '维护',
};

export const ROOM_STATUS_LABEL: Record<string, string> = {
  OPEN: '营业',
  MAINTENANCE: '维护',
  FROZEN: '冻结',
  CLOSED: '关闭',
};

function money(v: unknown): string {
  const n = Number(v);
  if (!Number.isFinite(n)) return String(v ?? '—');
  return n.toLocaleString('zh-CN', { maximumFractionDigits: 2 });
}

function pct(v: unknown): string {
  const n = Number(v);
  if (!Number.isFinite(n)) return String(v ?? '—');
  // 存的是 0.01 = 1% 或 1 = 1%？业务里 rate 多为小数比例
  if (n > 0 && n <= 1) return `${(n * 100).toFixed(2)}%`;
  return `${n}%`;
}

function str(v: unknown): string {
  if (v == null) return '';
  return String(v);
}

/** 生成一行运营可读摘要 */
export function summarizeAdminLog(
  action: string,
  detail: unknown,
  resolvedTarget?: string | null,
): string {
  const d = (detail && typeof detail === 'object' ? detail : {}) as Record<string, unknown>;
  const target = resolvedTarget || '';

  switch (action) {
    case 'QUOTA_SELL':
      return `向 ${target || '代理'} 出售额度 ${money(d.amount)}${d.remark ? `（${d.remark}）` : ''}`;
    case 'QUOTA_RECALL':
      return `从 ${target || '代理'} 回收额度 ${money(d.amount)}${d.remark ? `（${d.remark}）` : ''}`;
    case 'CONSOLE_CREDIT':
      return `给玩家 ${target || '—'} 上分 ${money(d.amount)}${
        d.real != null || d.fake != null ? `（真${money(d.real)}/假${money(d.fake)}）` : ''
      }${d.remark ? ` · ${d.remark}` : ''}`;
    case 'CONSOLE_DEBIT':
      return `从玩家 ${target || '—'} 下分 ${money(d.amount)}${
        d.coverBack != null ? ` · 回冲占用 ${money(d.coverBack)}` : ''
      }${d.remark ? ` · ${d.remark}` : ''}`;
    case 'ROOM_FUND':
      return `向房间 ${target || '—'} 注资 ${money(d.amount)}${d.remark ? `（${d.remark}）` : ''}`;
    case 'AGENT_ISSUE':
      return `给代理 ${target || '—'} 发分 ${money(d.amount)}`;
    case 'RECHARGE_APPROVE':
      return `通过${d.type === 'DOWN' ? '下分' : '上分'}申请 ${money(d.amount)}${target ? ` · ${target}` : ''}`;
    case 'RECHARGE_REJECT':
      return `拒绝${d.type === 'DOWN' ? '下分' : '上分'}申请 ${money(d.amount)}${target ? ` · ${target}` : ''}${d.reason ? ` · ${d.reason}` : ''}`;

    case 'GAME_STATUS_CHANGE':
      return `游戏 ${target || '—'}：${GAME_STATUS_LABEL[str(d.from)] || d.from} → ${GAME_STATUS_LABEL[str(d.to)] || d.to}`;
    case 'GAME_BASICS_UPDATE':
      return `更新游戏 ${target || '—'} 基础信息`;
    case 'GAME_CONFIG_UPDATE':
      return `更新游戏 ${target || '—'} 配置${d.version != null ? ` v${d.version}` : ''}${d.rtp != null ? ` · RTP ${d.rtp}` : ''}`;
    case 'GAME_CONFIG_ACTIVATE':
      return `启用游戏 ${target || '—'} 配置${d.version != null ? ` v${d.version}` : ''}`;
    case 'GAME_REORDER': {
      const codes = Array.isArray(d.codes) ? (d.codes as string[]).join('、') : target;
      return `调整大厅游戏排序：${codes || '—'}`;
    }
    case 'GAME_DAY_CUT':
      return `执行游戏日切${target ? `（${target}）` : ''}`;
    case 'GAME_MAINT_START':
      return '进入每日维护窗，自动维护中的游戏已下架';
    case 'GAME_MAINT_END':
      return '结束每日维护窗，恢复自动维护的游戏';

    case 'ROOM_CREATE':
      return `创建房间 ${d.name || target || '—'}${d.roomNo ? `（号 ${d.roomNo}）` : ''}`;
    case 'ROOM_STATUS':
      return `房间 ${target || '—'} → ${ROOM_STATUS_LABEL[str(d.status)] || d.status}`;
    case 'ROOM_DELETE':
      return `删除房间 ${d.name || target || '—'}${d.roomNo ? `（${d.roomNo}）` : ''}`;
    case 'ROOM_SOFT_DELETE':
      return `软删房间 ${target || '—'}`;
    case 'ROOM_ROTATE_CODE':
      return `房间 ${target || '—'} 轮换房间号为 ${d.roomNo || '—'}`;
    case 'ROOM_GRANT_OWNER':
      return `房间 ${target || '—'} 授予房主可见`;
    case 'ROOM_REVOKE_OWNER':
      return `房间 ${target || '—'} 取消房主可见`;
    case 'ROOM_AGENT_RESET_PWD':
      return `重置房间 ${target || '—'} 绑定代理密码`;
    case 'ROOM_BILLING_UPDATE':
      return `房间 ${target || '—'} 月费 ${money(d.monthlyFee)} / 每月 ${d.billingDay ?? '—'} 日`;
    case 'ROOM_GAME_CONFIG':
      return `房间 ${target || '—'} 游戏 ${d.gameCode || '—'} 配置变更`;
    case 'ROOM_BILL_OK':
      return `房间 ${target || '—'} 月费扣款成功 ${money(d.amount ?? d.fee)}`;
    case 'ROOM_BILL_FREEZE':
      return `房间 ${target || '—'} 欠费已冻结`;

    case 'CONTROL_CREATE':
      return `新建控奖策略 ${d.name || target || '—'}${d.goalAmount != null ? ` · 目标 ${money(d.goalAmount)}` : ''}`;
    case 'CONTROL_STATUS':
      return `控奖策略 ${target || '—'} → ${d.status || '—'}`;
    case 'CONTROL_EXHAUSTED':
      return `控奖目标达成 ${target || '—'} · 已回 ${money(d.recoveredAmount)} / ${money(d.goalAmount)}`;
    case 'CONTROL_DELETE':
      return `删除控奖策略 ${d.name || target || '—'}`;

    case 'REBATE_POLICY':
      return '更新回水规则';
    case 'REBATE_RATE':
      return `设置 ${target || '账号'} 回水比例 ${pct(d.rate)}`;
    case 'PLAYER_REBATE':
      return `玩家 ${target || '—'} 回水比例 ${pct(d.rate)}`;
    case 'COMMISSION_RATE':
      return `设置 ${target || '账号'} 佣金比例 ${pct(d.rate)}`;
    case 'PLAYER_FLY':
      return `玩家 ${target || '—'} 飞盘${d.flyEnabled ? '开启' : '关闭'}`;

    case 'USER_STATUS':
      return `账号 ${target || '—'} 状态 → ${d.status === 'DISABLED' ? '停用' : d.status === 'ACTIVE' ? '正常' : d.status}`;
    case 'AGENT_CREATE':
      return `创建下级 ${d.nickname || target || '—'}${d.role ? `（${d.role}）` : ''}`;
    case 'AGENT_LEVEL_SET':
      return `设置代理 ${target || '—'} 层级 ${d.levelCode || '—'}`;
    case 'CS_DUTY_SET':
      return '设置值班客服';
    case 'CS_DUTY_CLEAR':
      return '清空值班客服';

    case 'RISK_EVENT_HANDLE':
      return `处理风控告警${d.type ? ` · ${d.type}` : ''}${d.note ? ` · ${d.note}` : ''}`;
    case 'RISK_EVENT_BATCH_HANDLE':
      return `批量处理风控 ${d.count ?? '—'} 条${d.note ? ` · ${d.note}` : ''}`;

    default: {
      const meta = ADMIN_ACTION_META[action];
      if (meta && target) return `${meta.label} · ${target}`;
      if (meta) return meta.label;
      return action;
    }
  }
}

export function listActionOptions() {
  return Object.entries(ADMIN_ACTION_META).map(([value, m]) => ({
    value,
    label: m.label,
    group: m.group,
  }));
}
