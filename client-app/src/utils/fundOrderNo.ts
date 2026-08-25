/**
 * 生成资金操作订单号（兼作防重复键 clientRequestId）。
 * bump=调信用额度，跟上下分共用一套，重放时后端凭它整笔跳过。
 */
export function newFundOrderNo(mode: 'up' | 'down' | 'bump'): string {
  const prefix = mode === 'up' ? 'SF' : mode === 'down' ? 'XF' : 'ED'
  const d = new Date()
  const pad = (n: number, w = 2) => String(n).padStart(w, '0')
  const ts =
    `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}` +
    `${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`
  const rand = Math.random().toString(36).slice(2, 8).toUpperCase()
  return `${prefix}${ts}${rand}`
}
