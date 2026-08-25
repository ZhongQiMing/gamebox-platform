import type { CapacitorConfig } from '@capacitor/cli'

/**
 * APP 打包配置。
 *
 * 默认就是生产包：加载安装包内 dist 里的静态文件，不连任何开发服务器。
 * 想在真机上调试，才显式带上 CAP_DEV_URL：
 *
 *   CAP_DEV_URL=http://10.0.2.2:5173 npx cap sync android    # 安卓模拟器
 *   CAP_DEV_URL=http://192.168.1.5:5173 npx cap sync android # 真机（换成本机局域网 IP）
 *
 * 为什么不写成「默认连开发服务器、靠 NODE_ENV 关掉」：
 * 这个文件是 Capacitor 命令行工具自己的进程在读，跟 vite build 不是同一个进程，
 * 那边设的 NODE_ENV 传不过来。打包时只要忘了手动设，打出来的正式包就会去连
 * 10.0.2.2:5173 —— 那个地址只在安卓模拟器里指向开发机，玩家装上就是白屏，
 * 而且构建过程一句警告都没有。默认值必须是安全的那个，出错才需要显式动手。
 */
const devUrl = process.env.CAP_DEV_URL?.trim()

const config: CapacitorConfig = {
  appId: 'com.goldhub.app',
  appName: '金御汇',
  webDir: 'dist',
  // 只有调试时才指向开发服务器；生产为 undefined，走安装包内的文件
  server: devUrl ? { url: devUrl, cleartext: true } : undefined,
  android: {
    // 允许 https 页面里加载 http 资源。仅调试需要，生产开着等于给中间人留门
    allowMixedContent: Boolean(devUrl),
  },
  ios: {
    // 页面来源为 capacitor://localhost，已写进服务端 CAPACITOR_APP_ORIGINS 白名单。
    // 改这里就要同步改那边，否则 iOS 包接口全挂。
    scheme: 'capacitor',
    // 内容不随系统字号缩放：牌桌与转盘按固定像素排版，放大会错位
    contentInset: 'never',
  },
  plugins: {
    /*
     * 安卓 12 起，系统开屏被强制成「纯色底 + 中间一个图标」，
     * 主题里的整屏 splash.png 直接被无视（见 res/values/styles.xml 注释）。
     * 所以品牌开屏图交给这个插件在 App 窗口里画，安卓 12 之前之后表现一致。
     * 系统那一瞬的图标仍要配（brand_dark + splash_icon），否则中间会闪一下白。
     */
    SplashScreen: {
      launchShowDuration: 0,
      launchAutoHide: true,
      backgroundColor: '#0d0a08',
      androidSplashResourceName: 'splash',
      androidScaleType: 'CENTER_CROP',
      showSpinner: false,
      splashFullScreen: true,
      splashImmersive: false,
    },
  },
}

export default config
