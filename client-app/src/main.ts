import { createApp } from 'vue'
import { createPinia } from 'pinia'
import App from './App.vue'
import router from './router'
import './assets/common.css'
import { useClickSound } from './composables/useClickSound'
import { registerGameAssetSw } from './utils/registerGameAssetSw'
import { installErrorHandlers } from './utils/installErrorHandlers'

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

