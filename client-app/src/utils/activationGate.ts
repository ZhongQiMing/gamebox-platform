export interface ActivationGate {
  readonly active: boolean
  activate: () => boolean
  deactivate: () => boolean
}

/**
 * 将 keep-alive 的 mounted/activated 与 deactivated/unmounted 合并成幂等开关。
 * Vue 首次渲染可能连续触发 mounted、activated，资源只会注册一次。
 */
export function createActivationGate(
  start: () => void,
  stop: () => void,
): ActivationGate {
  let active = false

  return {
    get active() {
      return active
    },
    activate() {
      if (active) return false
      active = true
      start()
      return true
    },
    deactivate() {
      if (!active) return false
      active = false
      stop()
      return true
    },
  }
}
