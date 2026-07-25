import { onBeforeUnmount, ref } from 'vue'

/**
 * 即时游戏开奖会话：离开即停、幂等 ID（同一次意图重试复用）。
 * 各游戏 View 自己管动画，这里只管「别重复扣 / 别后台偷转」。
 */
export function useGameSpinSession(prefix: string) {
  const disposed = ref(false)
  /** 当前进行中的开奖意图；成功或最终失败后清空 */
  let inflightRequestId: string | null = null
  const timers = new Set<ReturnType<typeof setTimeout>>()

  function newClientRequestId() {
    const id =
      typeof crypto !== 'undefined' && 'randomUUID' in crypto
        ? `${prefix}_${crypto.randomUUID()}`
        : `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`
    inflightRequestId = id
    return id
  }

  /** 重试时复用；没有进行中意图则新建 */
  function currentOrNewClientRequestId() {
    if (inflightRequestId) return inflightRequestId
    return newClientRequestId()
  }

  function clearClientRequestId() {
    inflightRequestId = null
  }

  function schedule(fn: () => void, ms: number) {
    const t = setTimeout(() => {
      timers.delete(t)
      if (!disposed.value) fn()
    }, ms)
    timers.add(t)
    return t
  }

  function clearScheduled() {
    for (const t of timers) clearTimeout(t)
    timers.clear()
  }

  onBeforeUnmount(() => {
    disposed.value = true
    clearScheduled()
    inflightRequestId = null
  })

  return {
    disposed,
    newClientRequestId,
    currentOrNewClientRequestId,
    clearClientRequestId,
    schedule,
    clearScheduled,
  }
}
