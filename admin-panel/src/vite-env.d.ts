/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly MODE: string
  readonly DEV: boolean
  readonly PROD: boolean
  readonly BASE_URL: string
  /** 独立 H5 / 开奖球图 Origin。生产构建建议填写，未填时回退线上游戏域 */
  readonly VITE_GAME_ORIGIN?: string
  /** 水果 / 奔驰宝马等 /images 素材域；未填时与 VITE_GAME_ORIGIN 相同 */
  readonly VITE_ASSET_ORIGIN?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
