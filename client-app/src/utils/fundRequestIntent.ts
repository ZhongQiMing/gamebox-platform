export interface FundRequestIntent {
  type: 'up' | 'down'
  amount: number
  channel: string
  roomNo: string
}

/** 仅完全相同的不可变提交意图才可复用同一个服务端幂等号。 */
export function fundRequestIntentKey(intent: FundRequestIntent): string {
  return JSON.stringify([
    intent.type,
    intent.amount,
    intent.channel.trim(),
    intent.roomNo.trim(),
  ])
}
