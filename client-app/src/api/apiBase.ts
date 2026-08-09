/**
 * 接口根地址。
 *
 * 网页版跑在跟后端同一个域名下，用相对路径 `/api` 即可，浏览器会自己补上当前域名。
 *
 * 打成 APK 就不行了：WebView 加载的是安装包里的本地文件，此时「当前域名」是
 * Capacitor 的本地地址，`/api` 会指到手机自己身上，请求全部失败、界面一片空白。
 * 所以 App 构建必须用 VITE_API_ORIGIN 显式指定后端域名（见 .env.app）。
 *
 * 不设这个变量时结果与从前完全一致（空字符串 + '/api' 就是 '/api'），网页版不受影响。
 */
const origin = String(import.meta.env.VITE_API_ORIGIN || '').replace(/\/$/, '')

export const API_BASE = `${origin}/api`
