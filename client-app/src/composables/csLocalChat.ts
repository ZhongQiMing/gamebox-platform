/** 本地客服会话：上下分申请同步一条消息（后端客服系统接入前） */

type CsMsg = { type: string; text?: string; ts?: number; img?: string }

const EXPIRE_MS = 60 * 60 * 1000

function storeKey(uid: string) {
  return `cs_messages_${uid || 'guest'}_default`
}

function load(uid: string): CsMsg[] {
  try {
    const raw = localStorage.getItem(storeKey(uid))
    const list = raw ? (JSON.parse(raw) as CsMsg[]) : []
    const cutoff = Date.now() - EXPIRE_MS
    return (list || []).filter(m => m.type !== 'typing' && !!m.ts && (m.ts as number) >= cutoff)
  } catch {
    return []
  }
}

function save(uid: string, list: CsMsg[]) {
  try {
    localStorage.setItem(storeKey(uid), JSON.stringify(list.slice(-80)))
  } catch {
    /* ignore */
  }
}

const PAY_NAMES: Record<string, string> = {
  wechat: '微信',
  alipay: '支付宝',
  unionpay: '银联',
}

/**
 * 上分 / 下分提交成功后，同步到在线客服会话
 */
export function pushCsScoreApply(opts: {
  uid?: string | null
  kind: 'up' | 'down'
  amount: number
  channel?: string
}) {
  const uid = opts.uid || 'guest'
  const amount = Math.floor(Number(opts.amount) || 0)
  if (!(amount > 0)) return

  const list = load(uid)
  const now = Date.now()

  if (opts.kind === 'down') {
    list.push({ type: 'user', text: `下分${amount}`, ts: now })
    list.push({
      type: 'agent',
      text: `已收到下分申请${amount}积分，余额已扣除。请提供收款账户`,
      ts: now + 1,
    })
  } else {
    const ch = opts.channel ? PAY_NAMES[opts.channel] || opts.channel : ''
    list.push({ type: 'user', text: ch ? `${ch}上分${amount}` : `上分${amount}`, ts: now })
    list.push({
      type: 'agent',
      text: `已收到上分申请${amount}积分。请按客服提供的收款码完成支付。注意：每次上分请先向客服索取最新收款码；未按指引私自转账造成的损失自行承担。`,
      ts: now + 1,
    })
  }

  save(uid, list)
}
