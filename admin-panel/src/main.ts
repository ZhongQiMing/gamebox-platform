import { createApp } from 'vue'
import { createPinia } from 'pinia'
import App from './App.vue'
import router from './router'
import './styles/global.css'
import { installErrorHandlers } from './utils/installErrorHandlers'

/**
 * 命令式 API（ElMessageBox / ElMessage 等）从 'element-plus' 直接 import，
 * 不会走 unplugin 的按需样式注入，需手动引入，否则弹窗无定位/遮罩会贴左上角。
 */
import 'element-plus/es/components/message/style/css'
import 'element-plus/es/components/message-box/style/css'
import 'element-plus/es/components/notification/style/css'
import 'element-plus/es/components/loading/style/css'

/** Element Plus 组件由 unplugin 按需引入，不再全量 app.use + 整包 CSS */
const app = createApp(App)
app.use(createPinia())
app.use(router)
installErrorHandlers(app, router)
app.mount('#app')
