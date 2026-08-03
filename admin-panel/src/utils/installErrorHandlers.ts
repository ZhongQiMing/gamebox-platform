import type { App, ComponentPublicInstance } from 'vue'
import type { Router } from 'vue-router'

function emitFatal(message: string) {
  window.dispatchEvent(new CustomEvent('app-fatal-error', { detail: message }))
}

/** Vue 渲染错误 + 路由懒加载失败 + 未处理 Promise，避免静默白屏 */
export function installErrorHandlers(app: App, router?: Router) {
  app.config.errorHandler = (err: unknown, _instance: ComponentPublicInstance | null, info: string) => {
    console.error('[vue.errorHandler]', info, err)
    emitFatal(err instanceof Error ? err.message : String(err))
  }

  window.addEventListener('unhandledrejection', (ev) => {
    console.error('[unhandledrejection]', ev.reason)
  })

  router?.onError((err) => {
    console.error('[vue-router]', err)
    emitFatal(err instanceof Error ? err.message : String(err))
  })
}
