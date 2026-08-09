/** 生成上下分订单号（兼作防重复键 clientRequestId） */
export function newFundOrderNo(mode: 'up' | 'down'): string {
  const prefix = mode === 'up' ? 'SF' : 'XF'
  const d = new Date()
  const pad = (n: number, w = 2) => String(n).padStart(w, '0')
  const ts =
    `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}` +
    `${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`
  const rand = Math.random().toString(36).slice(2, 8).toUpperCase()
  return `${prefix}${ts}${rand}`
}
