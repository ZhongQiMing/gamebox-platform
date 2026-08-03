/** 风控事件类型（落库 type 字段） */
export const RISK_TYPES = {
  BIG_WIN: 'BIG_WIN',
  SAME_IP: 'SAME_IP',
  SUSPECT_WASH: 'SUSPECT_WASH',
  COLLUSION: 'COLLUSION',
} as const;

export type RiskType = (typeof RISK_TYPES)[keyof typeof RISK_TYPES];

export const RISK_LEVELS = ['INFO', 'WARN', 'CRITICAL'] as const;
export type RiskLevel = (typeof RISK_LEVELS)[number];

export const RISK_TYPE_META: Record<
  RiskType,
  { label: string; hint: string }
> = {
  BIG_WIN: {
    label: '大额中奖',
    hint: '彩票/牌桌/电玩单笔派彩异常偏高，需人工确认是否异常爆奖',
  },
  SAME_IP: {
    label: '同 IP 多号',
    hint: '多个玩家账号使用同一公网 IP 登录，疑似一人多号',
  },
  SUSPECT_WASH: {
    label: '疑似刷分',
    hint: '上分后流水偏低又快速下分，疑似空转套额度/刷流水',
  },
  COLLUSION: {
    label: '疑似对刷',
    hint: '同局对立方向出现金额接近的不同玩家对押，疑似互刷',
  },
};
