/** 操作日志：动作中文名 + 可读摘要（运营向，非开发向） */

export const ADMIN_ACTION_META: Record<string, { label: string; group: string }> = {
  RECON_FIX: { label: '对账差错调整', group: '资金' },
  QUOTA_SELL: { label: '出售额度', group: '资金' },
  QUOTA_RECALL: { label: '回收额度', group: '资金' },
  CONSOLE_CREDIT: { label: '玩家上分', group: '资金' },
  CONSOLE_DEBIT: { label: '玩家下分', group: '资金' },
  ROOM_FUND: { label: '房间盘口注资(已废弃)', group: '资金' },
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
  GAME_EMERGENCY_MAINT: { label: '平台触底紧急维护', group: '游戏' },
  GAME_FORCE_RESTORE_ONLINE: { label: '全部游戏恢复上架', group: '游戏' },

  ROOM_CREATE: { label: '创建房间', group: '房间' },
  ROOM_STATUS: { label: '房间状态变更', group: '房间' },
  ROOM_DELETE: { label: '删除房间', group: '房间' },
  ROOM_SOFT_DELETE: { label: '软删房间', group: '房间' },
  ROOM_HARD_PURGE: { label: '彻底清除房间', group: '房间' },
  ROOM_ICON: { label: '修改房间图标', group: '房间' },
  ROOM_OWNER_RETIRE: { label: '停用房间代理', group: '房间' },
  ROOM_OWNER_RESTORE: { label: '恢复房间代理', group: '房间' },
  ROOM_ROTATE_CODE: { label: '轮换房间号', group: '房间' },
  ROOM_GRANT_OWNER: { label: '授予房主可见', group: '房间' },
  ROOM_REVOKE_OWNER: { label: '取消房主可见', group: '房间' },
  ROOM_AGENT_RESET_PWD: { label: '重置房间代理密码', group: '房间' },
  ROOM_BILLING_UPDATE: { label: '房间月费设置', group: '房间' },
  ROOM_OVER_ISSUE: { label: '房间超发设置（历史）', group: '房间' },
  COVER_OVER_ISSUE: { label: '补超发恢复飞盘（历史）', group: '资金' },
  ROOM_GAME_CONFIG: { label: '房间游戏配置', group: '房间' },
  ROOM_BILL_OK: { label: '房间月费扣款成功', group: '房间' },
  ROOM_BILL_FREEZE: { label: '房间欠费冻结', group: '房间' },
  ROOM_FLY: { label: '整房飞盘开关', group: '房间' },
  ROOM_CREDIT_LIMIT_BUMP: { label: '调整信用额度', group: '资金' },
  GENERAL_CREDIT_LIMIT_BUMP: { label: '调整总代信用额度', group: '资金' },
  ROOM_JOIN_APPROVE: { label: '通过进房申请', group: '房间' },
  ROOM_JOIN_REJECT: { label: '拒绝进房申请', group: '房间' },

  CONTROL_CREATE: { label: '新建控奖策略', group: '控奖' },
  CONTROL_STATUS: { label: '控奖策略状态', group: '控奖' },
  CONTROL_EXHAUSTED: { label: '控奖目标达成', group: '控奖' },
  CONTROL_DELETE: { label: '删除控奖策略', group: '控奖' },
  CONTROL_GLOBAL_SOFT: { label: '全局软控配置', group: '控奖' },
  CONTROL_SOFT_BIAS: { label: '偏置策略', group: '控奖' },
  PAYOUT_GATE_RELEASE: { label: '出款闸门放行', group: '资金' },
  PAYOUT_GATE_REVOKE: { label: '撤销出款放行', group: '资金' },
  ROOM_WEEK_SETTLE: { label: '房间周结已结清', group: '结账' },
  ROOM_WEEK_SETTLE_EARLY: { label: '信用盘提前结账', group: '结账' },
  ROOM_WEEK_SETTLE_PAYMENT: { label: '结账实付已收款', group: '结账' },
  GENERAL_PERIOD_SETTLE: { label: '总代账期结清', group: '结账' },
  GENERAL_ROOM_FEE_SET: { label: '总代房间月费单价', group: '结账' },

  REBATE_POLICY: { label: '回水规则', group: '回水' },
  REBATE_POLICY_DOWNLINE: { label: '下级回水规则', group: '回水' },
  REBATE_RATE: { label: '设置回水比例', group: '回水' },
  PLAYER_REBATE: { label: '玩家回水比例', group: '回水' },
  PLAYER_REBATE_CLAIM: { label: '代领玩家回水', group: '回水' },
  COMMISSION_RATE: { label: '设置佣金比例', group: '回水' },
  PLAYER_FLY: { label: '玩家飞盘开关', group: '回水' },
  PLAYER_HANG: { label: '玩家挂靠', group: '账号' },
  PLAYER_RESET_PWD: { label: '重置玩家密码', group: '账号' },

  USER_STATUS: { label: '账号状态变更', group: '账号' },
  USER_NICKNAME: { label: '修改昵称', group: '账号' },
  AGENT_CREATE: { label: '创建下级账号', group: '账号' },
  AGENT_LEVEL_SET: { label: '设置代理层级', group: '账号' },
  GENERAL_GRANT_OWNER: { label: '授予总监可见总代', group: '账号' },
  GENERAL_REVOKE_OWNER: { label: '取消总监可见总代', group: '账号' },
  CS_SLA_UNLOCK: { label: '客服解锁', group: '账号' },
  CS_SLA_WAIVE: { label: '免除客服罚扣', group: '账号' },
  CS_DUTY_SET: { label: '设置值班客服', group: '账号' },
  CS_DUTY_CLEAR: { label: '清空值班客服', group: '账号' },
  CS_STAFF_CREATE: { label: '开客服账号', group: '账号' },
  CS_STAFF_ALLOC: { label: '划额度给客服', group: '资金' },
  CS_STAFF_RECALL: { label: '收回客服额度', group: '资金' },
  CS_STAFF_PATCH: { label: '修改客服设置', group: '账号' },
  CS_WAGE_SETTLE: { label: '结清客服佣金', group: '资金' },

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
    case 'RECON_FIX':
      return `对 ${target || '账户'} 补记差错调整 ${money(d.drift)}（${d.reason || '未填原因'}）`;
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
    case 'GAME_DAILY_MAINT_START':
      return '进入每日维护窗，自动维护中的游戏已下架';
    case 'GAME_MAINT_END':
    case 'GAME_DAILY_MAINT_END':
      return '结束每日维护窗，恢复自动维护的游戏';
    case 'GAME_EMERGENCY_MAINT':
      return `平台账户触及下限${d.floor != null ? ` ${money(d.floor)}` : ''}，全部游戏进入维护`;
    case 'GAME_FORCE_RESTORE_ONLINE':
      return `手动恢复上架 ${Array.isArray(d.codes) ? (d.codes as string[]).length : '—'} 个游戏${
        d.clearedEmergency ? '（已解除紧急维护）' : ''
      }`;

    case 'ROOM_CREATE':
      return `创建房间 ${d.name || target || '—'}${d.roomNo ? `（号 ${d.roomNo}）` : ''}`;
    case 'ROOM_STATUS':
      return `房间 ${target || '—'} → ${ROOM_STATUS_LABEL[str(d.status)] || d.status}`;
    case 'ROOM_DELETE':
      return `删除房间 ${d.name || target || '—'}${d.roomNo ? `（${d.roomNo}）` : ''}`;
    case 'ROOM_SOFT_DELETE':
      return `软删房间 ${target || '—'}`;
    case 'ROOM_HARD_PURGE':
      return `彻底清除房间 ${target || '—'}`;
    case 'ROOM_ICON':
      return `修改房间 ${target || '—'} 的图标`;
    case 'ROOM_OWNER_RETIRE':
      return `停用房间 ${target || '—'} 的代理`;
    case 'ROOM_OWNER_RESTORE':
      return `恢复房间 ${target || '—'} 的代理`;
    case 'ROOM_ROTATE_CODE':
      return `房间 ${target || '—'} 轮换房间号为 ${d.roomNo || '—'}`;
    case 'ROOM_GRANT_OWNER':
      return `房间 ${target || '—'} 授予房主可见`;
    case 'ROOM_REVOKE_OWNER':
      return `房间 ${target || '—'} 取消房主可见`;
    case 'GENERAL_GRANT_OWNER':
      return `总代 ${target || '—'} 对总监开放可见（剩 ${d.remaining ?? '—'} 个总监可见）`;
    case 'GENERAL_REVOKE_OWNER':
      return `总代 ${target || '—'} 对总监取消可见（剩 ${d.remaining ?? '—'} 个总监可见）`;
    case 'ROOM_AGENT_RESET_PWD':
      return `重置房间 ${target || '—'} 绑定代理密码`;
    case 'ROOM_BILLING_UPDATE':
      return `房间 ${target || '—'} 月费 ${money(d.monthlyFee)}`;
    case 'ROOM_OVER_ISSUE': {
      const after = (d.after ?? d) as Record<string, unknown>;
      const on = after.overIssueEnabled === true || after.overIssueEnabled === 'true';
      return on
        ? `房间 ${target || '—'} 超发开（历史），上限 ${money(after.overIssueLimit)}`
        : `房间 ${target || '—'} 超发关（历史）`;
    }
    case 'COVER_OVER_ISSUE':
      return `房间 ${target || '—'} 补超发恢复飞盘（历史） ${money(d.covered)}`;
    case 'ROOM_GAME_CONFIG':
      return `房间 ${target || '—'} 游戏 ${d.gameCode || '—'} 配置变更`;
    case 'ROOM_BILL_OK':
      return `房间 ${target || '—'} 月费扣款成功 ${money(d.amount ?? d.fee)}`;
    case 'ROOM_BILL_FREEZE':
      return `房间 ${target || '—'} 欠费已冻结`;
    case 'ROOM_FLY':
      return `房间 ${target || '—'} 整房飞盘${d.flyEnabled ? '开启' : '关闭'}${
        d.updated != null ? `（${d.updated} 名玩家）` : ''
      }`;
    case 'ROOM_CREDIT_LIMIT_BUMP': {
      const dir = d.direction === 'down' ? '减少' : '增加';
      return `房间 ${target || '—'} 信用额度${dir} ${money(d.amount)}${
        d.after != null ? ` → 合同 ${money(d.after)}` : ''
      }${d.quotaAfter != null ? ` · 剩余 ${money(d.quotaAfter)}` : ''}`;
    }
    case 'GENERAL_CREDIT_LIMIT_BUMP': {
      const dir = d.direction === 'down' ? '减少' : '增加';
      return `总代 ${target || '—'} 信用额度${dir} ${money(d.amount)}${
        d.creditLimit != null ? ` → 合同 ${money(d.creditLimit)}` : ''
      }${d.pointsQuota != null ? ` · 剩余 ${money(d.pointsQuota)}` : ''}`;
    }
    case 'ROOM_JOIN_APPROVE':
      return `通过进房申请 ${d.uid || target || '—'}${d.roomNo ? ` · 房 ${d.roomNo}` : ''}`;
    case 'ROOM_JOIN_REJECT':
      return `拒绝进房申请 ${d.uid || target || '—'}${d.roomNo ? ` · 房 ${d.roomNo}` : ''}`;

    case 'CONTROL_CREATE':
      return `新建控奖策略 ${d.name || target || '—'}${d.goalAmount != null ? ` · 目标 ${money(d.goalAmount)}` : ''}`;
    case 'CONTROL_STATUS':
      return `控奖策略 ${target || '—'} → ${d.status || '—'}`;
    case 'CONTROL_EXHAUSTED':
      return `控奖目标达成 ${target || '—'} · 已回 ${money(d.recoveredAmount)} / ${money(d.goalAmount)}`;
    case 'CONTROL_DELETE':
      return `删除控奖策略 ${d.name || target || '—'}`;
    case 'CONTROL_GLOBAL_SOFT':
      return `更新全局软控${d.enabled != null ? ` · ${d.enabled ? '开启' : '关闭'}` : ''}${
        d.targetNetPct != null ? ` · 中轴 ${d.targetNetPct}%` : ''
      }${d.bandLowPct != null || d.bandHighPct != null ? ` · 带 ${d.bandLowPct ?? '?'}~${d.bandHighPct ?? '?'}%` : ''}`;
    case 'CONTROL_SOFT_BIAS':
      return `偏置策略 ${d.action || '更新'}${d.kind ? ` · ${d.kind}` : ''}${
        d.biasPct != null ? ` · ${d.biasPct}%` : ''
      }${d.goalAmount != null ? ` · ${money(d.goalAmount)}` : ''}${
        d.enabled != null ? ` · ${d.enabled ? '启用' : '停用'}` : ''
      }`;
    case 'ROOM_WEEK_SETTLE':
      return `房间 ${target || '—'} 周结已结清${d.creditRestored ? ' · 信用额度已恢复' : ''}${
        d.settlePay != null ? ` · 实付 ${money(d.settlePay)}` : ''
      }`;
    case 'ROOM_WEEK_SETTLE_EARLY':
      return `房间 ${target || '—'} 信用盘提前结账${d.creditRestored ? ' · 信用额度已恢复' : ''}${
        d.settlePay != null ? ` · 实付 ${money(d.settlePay)}` : ''
      }`;
    case 'ROOM_WEEK_SETTLE_PAYMENT':
      return `房间 ${target || '—'} 实付已确认收款 ${money(d.settlePay)}`;
    case 'GENERAL_PERIOD_SETTLE':
      return `总代 ${target || '—'} 账期结清${
        d.roomCount != null ? ` · ${d.roomCount} 间房` : ''
      }${d.betFlow != null ? ` · 投注额 ${money(d.betFlow)}` : ''}${
        d.settlePay != null ? ` · 交割 ${money(d.settlePay)}` : ''
      }`;
    case 'GENERAL_ROOM_FEE_SET':
      return `总代 ${target || '—'} 房间月费单价改为 ${money(d.roomMonthlyFee ?? d.after)}`;
    case 'GENERAL_PERIOD_SETTLE':
      return `总代 ${target || '—'} 账期结清${
        d.roomCount != null ? ` · ${d.roomCount} 间房` : ''
      }${d.settlePay != null ? ` · 交割 ${money(d.settlePay)}` : ''}`;
    case 'GENERAL_ROOM_FEE_SET':
      return `总代 ${target || '—'} 房间月费单价改为 ${money(d.roomMonthlyFee ?? d.fee)}`;

    case 'REBATE_POLICY': {
      const parts: string[] = [];
      if (d.totalPct != null) parts.push(`总额 T=${pct(d.totalPct)}`);
      if (d.playerMinPct != null) parts.push(`玩家下限 ${pct(d.playerMinPct)}`);
      if (d.hangCommissionPct != null) parts.push(`下级佣金 ${pct(d.hangCommissionPct)}`);
      return parts.length ? `更新回水规则：${parts.join(' · ')}` : '更新回水规则';
    }
    case 'REBATE_RATE':
      return `设置 ${target || '账号'} 回水比例 ${pct(d.rate)}`;
    case 'PLAYER_REBATE':
      return `玩家 ${target || '—'} 回水比例 ${pct(d.rate)}`;
    case 'PLAYER_REBATE_CLAIM':
      return `代领玩家 ${target || '—'} 回水 ${Number(d.amount || 0).toLocaleString('zh-CN')}（${
        Array.isArray(d.dates) ? d.dates.length : 0
      } 日）`;
    case 'COMMISSION_RATE':
      return `设置 ${target || '账号'} 佣金比例 ${pct(d.rate)}`;
    case 'PLAYER_FLY':
      return `玩家 ${target || '—'} 飞盘${d.flyEnabled ? '开启' : '关闭'}`;
    case 'PLAYER_HANG':
      return `本房把玩家 ${d.friendUid || '—'} 挂到 ${d.underUid || target || '—'} 名下${
        d.roomId ? ` · 房 ${d.roomId}` : ''
      }${d.message ? ` · ${d.message}` : ''}`;
    case 'PLAYER_RESET_PWD':
      return `重置玩家 ${d.username || target || '—'} 密码并解冻`;

    case 'USER_STATUS':
      return `账号 ${target || '—'} 状态 → ${d.status === 'DISABLED' ? '停用' : d.status === 'ACTIVE' ? '正常' : d.status}`;
    case 'USER_NICKNAME':
      return `修改${d.role === 'PROXY' ? '子账号' : '账号'} ${target || '—'} 昵称${
        d.from || d.to ? `：${d.from || '—'} → ${d.to || '—'}` : ''
      }`;
    case 'AGENT_CREATE': {
      const roleZh =
        d.role === 'PROXY' ? '子账号' : d.role === 'AGENT' ? '代理' : d.role === 'BRANCH' ? '房主' : str(d.role);
      return `创建下级 ${d.nickname || target || '—'}${roleZh ? `（${roleZh}）` : ''}`;
    }
    case 'AGENT_LEVEL_SET':
      return `设置代理 ${target || '—'} 层级 ${d.levelCode || '—'}`;
    case 'CS_SLA_UNLOCK':
      return `解锁客服 ${target || '—'}`;
    case 'CS_SLA_WAIVE':
      return `免除客服 ${target || '—'} 罚款${d.amount != null ? ` ${money(d.amount)}` : ''}`;
    case 'REBATE_POLICY_DOWNLINE':
      return `设置下级回水规则${target ? ` · ${target}` : ''}`;
    case 'CS_DUTY_SET':
      return '设置值班客服';
    case 'CS_DUTY_CLEAR':
      return '清空值班客服';
    case 'CS_STAFF_CREATE':
      return `开客服账号 ${d.nickname || d.username || target || '—'}`;
    case 'CS_STAFF_ALLOC':
      return `划额度给客服 ${target || '—'} ${money(d.amount)}`;
    case 'CS_STAFF_RECALL':
      return `收回客服额度 ${target || '—'} ${money(d.amount)}`;
    case 'CS_STAFF_PATCH':
      return `修改客服设置 ${target || '—'}`;
    case 'CS_WAGE_SETTLE':
      return `结清客服佣金 ${target || '—'} ${money(d.settledAmount)}（${d.settledCount ?? 0} 笔）`;

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

/**
 * 软控/控奖相关动作，**只有 ADMIN 能看见**。
 *
 * 靠「管辖范围碰巧匹配不上」来挡是不牢的：只要某条记录的 target 恰好落进
 * 总代/代理的管辖集合，他就能翻到软控痕迹。这里改成按动作名显式排除。
 */
export const SOFT_CONTROL_ACTIONS = Object.entries(ADMIN_ACTION_META)
  .filter(([, m]) => m.group === '控奖')
  .map(([action]) => action);

export function listActionOptions(role?: string) {
  const hideControl = role !== 'ADMIN';
  return Object.entries(ADMIN_ACTION_META)
    .filter(([, m]) => !(hideControl && m.group === '控奖'))
    .map(([value, m]) => ({
      value,
      label: m.label,
      group: m.group,
    }));
}
