import { formatDateTime, formatMoney } from '@gamebox/shared'

/**
 * 把日志 / 风控事件里的原始 detail 翻成人看得懂的「字段 → 值」。
 *
 * 后台里这些抽屉原先直接甩一坨 JSON，运营根本看不出发生了什么。
 * 认识的键翻成中文并按类型格式化，不认识的原样保留键名——
 * 宁可露出一个英文键，也不能把内容悄悄吞掉。
 */

const LABELS: Record<string, string> = {
  // 通用
  action: '动作',
  kind: '类型',
  type: '类型',
  status: '状态',
  remark: '备注',
  note: '备注',
  reason: '原因',
  enabled: '是否启用',
  message: '说明',
  summary: '摘要',
  count: '数量',
  period: '账期',

  // 人 / 房
  roomId: '房间',
  roomNo: '房间号',
  name: '名称',
  playerId: '玩家',
  player: '玩家',
  agentUserId: '代理',
  generalUserId: '总代',
  username: '账号',
  nickname: '昵称',
  uid: 'UID',
  ip: 'IP',
  grantOwnerIds: '可见总监',
  games: '开通游戏',

  // 钱
  amount: '金额',
  goalAmount: '目标金额',
  fee: '费用',
  monthlyFee: '月费',
  balance: '余额',
  creditSum: '累计上分',
  debitAmount: '本次下分',
  validFlow: '有效流水',
  betFlow: '投注额',
  payout: '派彩',
  housePnl: '庄家盈亏',
  playerPnl: '玩家盈亏',
  agentShareAmount: '代理占成',
  generalShareAmount: '总代成数差',
  platformShareAmount: '平台占成',
  settlePay: '实付',
  settleFee: '本期月费',
  settlePocket: '额度找补',
  settleGrossPay: '占成应付',
  creditLimit: '信用额度',
  quotaAtClose: '封账剩余额度',
  overIssueLimit: '超发上限',
  excess: '超出额度',

  // 结算总表
  roomFee: '房间月费',
  unitFee: '月费单价',
  total: '合计',
  rooms: '房间',
  months: '月数',
  roomCount: '房间数',
  upAmount: '上分',
  downAmount: '下分',
  platformNet: '平台净收',
  payToPlatform: '应付平台',
  sharePayToPlatform: '占成应付平台',
  agentPnl: '代理收益',
  wageCount: '佣金笔数',
  agentWageAmount: '代理佣金',
  generalWageAmount: '总代佣金',
  generalWageKeep: '总代自留佣金',
  playerRebate: '玩家回水',
  unsettledIssueDebt: '未结上分往来',
  consumeIssueDebt: '本期冲抵往来',
  periodStart: '账期起',
  periodEnd: '账期止',
  grossPay: '占成应付',
  agentPocketAtSettle: '结账时口袋余额',
  monthlyFeePeriod: '本期月费',
  platformPayToAgent: '平台应付代理',
  newQuota: '结后额度',
  pointsQuotaBefore: '结前额度',
  playerBalances: '玩家持分合计',
  csBalances: '客服额度合计',
  sum: '合计',
  creditBook: '信用账本',

  // 房间设置
  billingDay: '扣费日',
  overIssueEnabled: '允许超发',
  settleWeekday: '结账日',
  agentPath: '代理层级',
  roomIds: '房间',
  ownerUserId: '房主',

  // 比例
  rate: '比例',
  biasPct: '偏置比例',
  flowRatio: '流水占比',
  agentShareRate: '代理占成',
  generalShareRate: '总代占成',
  rebateRate: '回水比例',

  // 时间 / 账期
  createdAt: '时间',
  nextBillAt: '下次月费日',
  weekStart: '账期起',
  weekEnd: '账期止',
  windowHours: '统计窗口',

  // 结算 / 盘口
  bookMode: '盘口',
  paymentStatus: '交割状态',
  creditRestored: '已补额度',
  early: '提前结账',
  settleCycle: '结账周期',
  gameCode: '游戏',
  roundNo: '局号',
  issueNo: '期号',
  sameIp: '同 IP',
  side: '方向',
}

const VALUE_MAPS: Record<string, Record<string, string>> = {
  action: { create: '新建', update: '修改', delete: '删除', enable: '启用', exhausted: '已达标停用' },
  kind: {
    PLAYER_WIN: '玩家偏赢',
    PLAYER_LOSE: '玩家偏输',
    ROOM_RECOVER: '房间回血',
    ROOM_RELEASE: '房间放水',
  },
  bookMode: { CASH: 'A 现金盘', CREDIT: 'B 信用盘' },
  paymentStatus: { NONE: '无交割', EVEN: '互不找补', UNPAID: '待交割', PAID: '已收款' },
  status: { ACTIVE: '正常', DISABLED: '停用', OPEN: '进行中', CLOSED: '已关账', SETTLED: '已结清' },
}

/* 哪些字段是钱，显式列出来；靠词尾猜会漏掉 platformNet、payToPlatform 这类 */
const MONEY_KEYS = new Set([
  'amount', 'goalAmount', 'fee', 'monthlyFee', 'monthlyFeePeriod', 'balance',
  'creditSum', 'debitAmount', 'validFlow', 'betFlow', 'payout', 'housePnl', 'playerPnl',
  'agentShareAmount', 'generalShareAmount', 'platformShareAmount',
  'settlePay', 'settleFee', 'settlePocket', 'settleGrossPay', 'grossPay',
  'creditLimit', 'quotaAtClose', 'overIssueLimit', 'excess',
  'roomFee', 'unitFee', 'total', 'sum',
  'upAmount', 'downAmount', 'platformNet', 'payToPlatform', 'sharePayToPlatform',
  'agentPnl', 'agentWageAmount', 'generalWageAmount', 'generalWageKeep', 'playerRebate',
  'unsettledIssueDebt', 'consumeIssueDebt', 'agentPocketAtSettle',
  'platformPayToAgent', 'newQuota', 'pointsQuotaBefore', 'playerBalances', 'csBalances',
])
const COUNT_KEYS = new Set([
  'roomCount', 'wageCount', 'months', 'count', 'upCount', 'downCount', 'betCount',
])
const RATE_KEY = /(rate|pct|ratio)$/i
const TIME_KEY = /(at|start|end|time)$/i
const ID_KEY = /(^id$|Id$|Ids$)/

export type DetailRow = { key: string; label: string; value: string; raw: boolean }

function isIsoLike(v: string) {
  return /^\d{4}-\d{2}-\d{2}[T ]/.test(v)
}

function formatValue(key: string, v: unknown): string {
  if (v == null || v === '') return '—'
  if (typeof v === 'boolean') return v ? '是' : '否'

  const mapped = VALUE_MAPS[key]?.[String(v)]
  if (mapped) return mapped

  if (typeof v === 'number') {
    if (COUNT_KEYS.has(key)) return String(v)
    if (RATE_KEY.test(key)) return v <= 1 ? `${Math.round(v * 1000) / 10}%` : `${v}%`
    if (MONEY_KEYS.has(key)) return formatMoney(v)
    return String(v)
  }

  if (typeof v === 'string') {
    if (isIsoLike(v)) return formatDateTime(v)
    return v
  }

  if (Array.isArray(v)) {
    if (!v.length) return '—'
    if (v.every((x) => typeof x === 'string' || typeof x === 'number')) {
      return v.length > 8 ? `${v.slice(0, 8).join('、')} 等 ${v.length} 项` : v.join('、')
    }
    /* 月费按房拆的那种：房号 ×月数 金额 */
    const parts = v
      .map((x) => {
        const o = x as Record<string, unknown>
        const no = o?.roomNo ?? o?.name
        if (no == null) return ''
        const months = o?.months != null ? ` ×${o.months}` : ''
        const amt = typeof o?.amount === 'number' ? ` ${formatMoney(o.amount)}` : ''
        return `${no}${months}${amt}`
      })
      .filter(Boolean)
    return parts.length ? parts.join('，') : `${v.length} 项`
  }

  return ''
}

/**
 * 展开一层嵌套：`{ a: { b: 1 } }` 出成 `a.b`。
 * 再深就不展了，交给「原始数据」那块兜底。
 */
export function toDetailRows(
  detail: unknown,
  /** 后端给的 ID → 名字；有名字就不显示 cuid */
  names: Record<string, string> = {},
  depth = 0,
): DetailRow[] {
  if (!detail || typeof detail !== 'object' || Array.isArray(detail)) return []
  const out: DetailRow[] = []
  for (const [k, v] of Object.entries(detail as Record<string, unknown>)) {
    if (v == null) continue
    /*
     * 表里没有的键一律不进这一块。宁可少显示，也不能甩一个 camelCase 出来——
     * 完整内容在「原始数据」里，要跟技术核对时展开就有。
     */
    const label = LABELS[k]
    if (!label) continue

    if (typeof v === 'object' && !Array.isArray(v) && depth < 1) {
      for (const sub of toDetailRows(v, names, depth + 1)) {
        out.push({ ...sub, key: `${k}.${sub.key}`, label: `${label} · ${sub.label}` })
      }
      continue
    }
    const named = typeof v === 'string' ? names[v] : undefined
    if (named) {
      out.push({ key: k, label, value: named, raw: false })
      continue
    }
    const text = formatValue(k, v)
    if (!text) continue
    out.push({
      key: k,
      label,
      value: text,
      /* 长串 ID 用等宽字体，方便跟技术核对 */
      raw: ID_KEY.test(k) || (typeof v === 'string' && v.length > 20 && !TIME_KEY.test(k)),
    })
  }
  return out
}
