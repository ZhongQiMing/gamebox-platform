import type { App, ComponentPublicInstance } from 'vue'
import type { Router } from 'vue-router'

function emitFatal(message: string) {
  window.dispatchEvent(new CustomEvent('app-fatal-error', { detail: message }))
}

/** ElMessageBox 点取消/关闭会 reject 字符串，不应当成页面崩溃 */
function isUserDismiss(err: unknown): boolean {
  if (err === 'cancel' || err === 'close') return true
  if (err instanceof Error && (err.message === 'cancel' || err.message === 'close')) return true
  return false
}

/** Vue 渲染错误 + 路由懒加载失败 + 未处理 Promise，避免静默白屏 */
export function installErrorHandlers(app: App, router?: Router) {
  app.config.errorHandler = (err: unknown, _instance: ComponentPublicInstance | null, info: string) => {
    if (isUserDismiss(err)) return
    console.error('[vue.errorHandler]', info, err)
    emitFatal(err instanceof Error ? err.message : String(err))
  }

  window.addEventListener('unhandledrejection', (ev) => {
    if (isUserDismiss(ev.reason)) {
      ev.preventDefault()
      return
    }
    console.error('[unhandledrejection]', ev.reason)
  })

  router?.onError((err) => {
    console.error('[vue-router]', err)
    emitFatal(err instanceof Error ? err.message : String(err))
  })
}
