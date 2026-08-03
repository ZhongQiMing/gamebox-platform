/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** 远端静态资源根（与宝塔站点同域即可），瘦包 App 必填，如 https://your.domain */
  readonly VITE_ASSET_ORIGIN?: string
  /** 为 true 时构建产物剔除游戏内素材，仅保留大厅/封面等 */
  readonly VITE_SLIM_APP?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
