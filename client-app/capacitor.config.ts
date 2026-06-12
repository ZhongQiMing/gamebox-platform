import type { CapacitorConfig } from '@capacitor/cli'

/**
 * APP 配置
 * server.url: 开发时指向本地/测试服务器，生产打包时注释掉（用 dist 里的静态文件）
 * server.cleartext: Android 允许 HTTP（开发用），生产要改为 HTTPS
 */
const isDev = process.env.NODE_ENV !== 'production'

const config: CapacitorConfig = {
  appId: 'com.goldhub.app',
  appName: '金御汇',
  webDir: 'dist',
  server: isDev
    ? {
        // 开发时直接加载 Vite dev server，改成你的局域网 IP 即可在真机上调试
        url: 'http://10.0.2.2:5173',  // 安卓模拟器用 10.0.2.2，真机用局域网 IP
        cleartext: true,
      }
    : undefined,
  android: {
    allowMixedContent: true,
  },
  plugins: {
    SplashScreen: {
      launchShowDuration: 0,
    },
  },
}

export default config
