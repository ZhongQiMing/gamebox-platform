import { createApp } from 'vue'
import { createPinia } from 'pinia'
import App from './App.vue'
import router from './router'
import './styles/global.css'
import { installErrorHandlers } from './utils/installErrorHandlers'

/** Element Plus 由 unplugin 按需引入，不再全量 app.use + 整包 CSS */
const app = createApp(App)
app.use(createPinia())
app.use(router)
installErrorHandlers(app, router)
app.mount('#app')
