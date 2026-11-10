/**
 * 检查更新只在「还能连上包里某个域名」时有意义。
 * 域名全部失效时请求失败，不能再说「已是最新」。
 * 下载地址跟当前还能用的接口域名走，不采用服务端可能写死的旧地址。
 */

export interface RemoteAppVersion {
  version?: string
  versionCode?: number
  updateUrl?: string
}

export type UpdateDecision =
  | { kind: 'current'; version: string }
  | { kind: 'newer'; version: string }

export function apkDownloadUrl(apiOrigin: string): string {
  const origin = String(apiOrigin || '').replace(/\/$/, '')
  if (origin) return `${origin}/api/download/apk`
  return '/api/download/apk'
}

/** iPhone 安装必须离开 App，用系统 Safari 打开。页内再决定跳到签名安装地址。 */
export function iosInstallUrl(apiOrigin: string): string {
  const origin = String(apiOrigin || '').replace(/\/$/, '')
  if (origin) return `${origin}/api/download/ios`
  return '/api/download/ios'
}

export function decideUpdate(
  localCode: number,
  remote: RemoteAppVersion,
): UpdateDecision {
  const remoteCode = Number(remote.versionCode)
  const version = String(remote.version || remoteCode || '').trim() || '0'
  if (!Number.isFinite(remoteCode)) {
    return { kind: 'current', version }
  }
  if (remoteCode > localCode) {
    return { kind: 'newer', version }
  }
  return { kind: 'current', version }
}
