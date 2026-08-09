# APP 打包（安卓 / iOS）

网页版和 App 是同一份前端代码，区别只在**它从哪里取东西**：

|  | 网页版 | APK |
|---|---|---|
| 页面文件 | 从你的域名下载 | 打在安装包里 |
| 接口 `/api` | 相对路径，自动指向当前域名 | **必须写死绝对域名**，否则指到手机自己身上 |
| 游戏素材 | 从你的域名下载 | 大厅图打在包里，进游戏时再从域名下载 |

APK 里没有「当前域名」这个概念——WebView 加载的是本地文件。所以凡是相对地址
在 APK 里都会失效，这是 App 白屏最常见的原因。

## 正式打包

先把 `client-app/.env.app` 里两个占位符改成你的真实域名：

```
VITE_ASSET_ORIGIN=https://你的域名
VITE_API_ORIGIN=https://你的域名
```

没改的话构建会直接失败并告诉你缺哪个，不会打出一个装上白屏的包。

### 安卓

```bash
pnpm --filter @gamebox/client-app app:release
```

这一条命令做三件事：类型检查 → 出瘦包静态产物 → 同步进安卓工程。
之后用 Android Studio 打开 `client-app/android` 出 APK。

**不需要设任何环境变量。** 默认就是生产配置。

### iOS

iOS 工程只能在 **macOS + Xcode** 上生成和构建，Windows 做不了。仓库里只放依赖和配置。

第一次在 Mac 上准备环境：

```bash
pnpm install
pnpm --filter @gamebox/client-app exec cap add ios   # 生成 client-app/ios/
```

之后每次出包：

```bash
pnpm --filter @gamebox/client-app app:release:ios
```

再用 Xcode 打开 `client-app/ios/App/App.xcworkspace` 归档上传。

iOS 的页面来源是 `capacitor://localhost`（见 `capacitor.config.ts` 的 `ios.scheme`），
这个值已经写进服务端的 CORS 白名单。**改了 scheme 就要同步改服务端**，
否则 iOS 包能打开界面但所有接口都失败。

安卓工程（`client-app/android/`）是入库的，iOS 工程要在 Mac 上首次 `cap add ios` 生成。
生成后建议一并提交，跟安卓保持一致——签名配置、图标、权限声明都在里面，
不入库的话每次换机器都要重配一遍。构建产物（`ios/App/Pods/`、`android/app/build/`）
已在 `.gitignore` 里排除。

## 真机 / 模拟器调试

调试时才让 App 去连你电脑上的开发服务器，需要显式指定地址：

```powershell
# 安卓模拟器（10.0.2.2 是模拟器里指向宿主机的固定地址）
$env:CAP_DEV_URL="http://10.0.2.2:5173"; pnpm exec cap sync android

# 真机（换成你电脑的局域网 IP，手机要和电脑同一个 WiFi）
$env:CAP_DEV_URL="http://192.168.1.5:5173"; pnpm exec cap sync android
```

调完记得重新跑一次 `app:release`，否则同步进安卓工程的还是那份指向开发机的配置。

## 为什么开关是这个方向

以前的写法是「默认连开发服务器，靠 `NODE_ENV=production` 关掉」。

问题在于 `capacitor.config.ts` 是 Capacitor 命令行工具自己的进程在读，
跟 `vite build` 不是同一个进程，那边的 `NODE_ENV` 传不过来。打包时只要忘了手动设，
打出来的正式包就会去连 `10.0.2.2:5173`——那个地址只在安卓模拟器里有意义，
玩家装上就是白屏，而且**整个构建过程一句警告都没有**。

现在反过来：不设 `CAP_DEV_URL` 就是生产包。要打出坏包，你得主动去设那个变量，
而不是忘了设。默认值必须是安全的那个。

同理，`allowMixedContent`（允许 https 页面里加载 http 资源）也只在调试时打开，
生产开着等于给中间人留门。

## 装上是白屏，按顺序查

1. **`.env.app` 里还是占位符？** 现在构建会拦，但旧包可能是这么打出来的。
2. **打包前设过 `CAP_DEV_URL` 没清掉？** 看
   `client-app/android/app/src/main/assets/capacitor.config.json` 里有没有 `server.url`，
   有就是连着开发服务器。重跑 `app:release`。
3. **`VITE_API_ORIGIN` 的域名能从手机访问吗？** 用手机浏览器打开
   `https://你的域名/api/health`，返回 JSON 才算通。
4. **静态资源跨域没放开？** 宝塔 Nginx 加：

   ```nginx
   location ~* ^/(games-assets|images|audio)/ {
     add_header Access-Control-Allow-Origin *;
   }
   ```

## 界面出得来，但一登录就「网络错误」——接口跨域

这跟上面的白屏不是一回事：页面加载正常，只有接口请求全挂。

App 里的页面从安装包本地加载，浏览器认定的来源是 `https://localhost`（安卓）或
`capacitor://localhost`（iOS），而接口在你的正式域名上——**这是跨域请求**，
服务端必须回 CORS 头，浏览器才肯把响应交给页面。

服务端已经把这几个来源写死在白名单里（`server/src/common/security.constants.ts`
的 `CAPACITOR_APP_ORIGINS`），正常情况下不用配任何环境变量。

排查时看服务端启动日志有没有这一行：

```
[server] CORS 允许来源: https://localhost, capacitor://localhost, http://localhost
```

没有这行说明跑的是旧版本镜像。另外，如果你在浏览器 DevTools 里看到
`No 'Access-Control-Allow-Origin' header`，也是这个问题。

改过 Capacitor 的 `androidScheme` / `iosScheme` 的话，记得把新来源加进那个常量。
