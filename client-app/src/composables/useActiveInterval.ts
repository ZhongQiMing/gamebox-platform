import { onActivated, onDeactivated, onMounted, onUnmounted } from 'vue'

interface ActiveIntervalOptions {
  /** 从后台/缓存恢复时先补一次，避免回到页面看到过期数据 */
  refreshOnResume?: boolean
}

/**
 * 只在页面「当前可见且未被 keep-alive 挂起」时才走的定时器。
 *
 * 普通 setInterval + onUnmounted 在两种情况下会漏：页面被 keep-alive 缓存后组件不卸载，
 * 用户切到别的 Tab 定时器照跑；浏览器切后台同理。轮询多的页面叠加起来就是持续的无效请求。
 */
export function useActiveInterval(
  fn: () => void,
  intervalMs: number,
  options: ActiveIntervalOptions = {},
) {
  const { refreshOnResume = true } = options
  let timer: ReturnType<typeof setInterval> | null = null
  let suspended = false
  let firstActivate = true

  function stop() {
    if (timer === null) return
    clearInterval(timer)
    timer = null
  }

  function start() {
    if (timer !== null || suspended) return
    if (document.visibilityState === 'hidden') return
    timer = setInterval(fn, intervalMs)
  }

  function resume() {
    if (refreshOnResume) fn()
    start()
  }

  function onVisibilityChange() {
    if (document.visibilityState === 'hidden') stop()
    else if (!suspended) resume()
  }

  onMounted(() => {
    document.addEventListener('visibilitychange', onVisibilityChange)
    start()
  })

  onActivated(() => {
    suspended = false
    // 首次挂载时 onActivated 紧跟 onMounted，此处再跑一次就成了重复请求
    if (firstActivate) {
      firstActivate = false
      start()
      return
    }
    resume()
  })

  onDeactivated(() => {
    suspended = true
    stop()
  })

  onUnmounted(() => {
    document.removeEventListener('visibilitychange', onVisibilityChange)
    stop()
  })

  return { start, stop }
}
