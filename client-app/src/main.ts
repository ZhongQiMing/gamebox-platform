import { createApp } from 'vue'
import { createPinia } from 'pinia'
import App from './App.vue'
import router from './router'
import './assets/common.css'
import { useClickSound } from './composables/useClickSound'
import { registerGameAssetSw } from './utils/registerGameAssetSw'
import { installErrorHandlers } from './utils/installErrorHandlers'
import { initializeSessionStorage } from './api/session'

async function bootstrap() {
  /*
   * Native 必须先从 Keystore/Keychain 恢复 token，再让 Pinia/路由读取同步缓存；
   * 否则首次路由守卫会把仍有效的会话误判成未登录。
   */
  await initializeSessionStorage()

  const app = createApp(App)
  app.use(createPinia())
  app.use(router)
  installErrorHandlers(app, router)
  app.mount('#app')

  // 全局点击音效
  const { attach } = useClickSound()
  attach()

  /* 瘦包 App：进游戏时按需下载素材（见 VITE_ASSET_ORIGIN / build:app） */
  registerGameAssetSw()
}

void bootstrap()

