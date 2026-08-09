/**
 * bcrypt 代价因子。
 *
 * 原来业务侧写死 10、seed 写 12，同一个系统两套强度。
 * 12 在现代服务器上约 200~300ms，登录限流已经收到 10 次/分，扛得住；
 * 而每加 1 就让离线爆破成本翻一倍，这个交换很划算。
 * 改这个值不影响已有密码：bcrypt 把 cost 编在哈希串里，老密码照常能验。
 */
export const PASSWORD_SALT_ROUNDS = 12;

/**
 * Capacitor App 的页面来源。
 *
 * App 里的页面是从安装包本地加载的，浏览器认定的来源是下面这几个地址，
 * 而接口在正式域名上——对 WebView 来说这是跨域，没有 CORS 头就整个连不上。
 * 生产默认 `origin: false`（拒绝一切跨域），所以必须把它们无条件放进白名单，
 * 否则打出来的包装上界面能出来、一发请求就失败，服务端日志还什么都看不到。
 *
 * 放开这几个来源不等于放开鉴权：它们不是真实网站，别人也没法在玩家手机上
 * 用这些来源托管页面；接口该要的 token 一个都不少。
 */
export const CAPACITOR_APP_ORIGINS = [
  /* 安卓：Capacitor 默认 androidScheme='https' */
  'https://localhost',
  /* iOS：WKWebView 自定义 scheme */
  'capacitor://localhost',
  /* 旧版安卓 / 调试时的明文 scheme */
  'http://localhost',
] as const;
