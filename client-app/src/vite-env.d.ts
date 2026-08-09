/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** 远端静态资源根（与宝塔站点同域即可），瘦包 App 必填，如 https://your.domain */
  readonly VITE_ASSET_ORIGIN?: string
  /** 为 true 时构建产物剔除游戏内素材，仅保留大厅/封面等 */
  readonly VITE_SLIM_APP?: string
  /** 后端域名。网页版留空走同域相对路径；APK 必填，否则请求会打到手机自己身上 */
  readonly VITE_API_ORIGIN?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
