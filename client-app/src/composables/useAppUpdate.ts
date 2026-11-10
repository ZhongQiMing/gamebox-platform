import { ref } from 'vue'
import { Capacitor } from '@capacitor/core'
import { App as CapApp } from '@capacitor/app'
import http from '@/api/http'
import { useToast } from '@/composables/useToast'
import { getLiveOrigin } from '@/utils/originPool'
import {
  apkDownloadUrl,
  decideUpdate,
  iosInstallUrl,
  type RemoteAppVersion,
} from '@/utils/appUpdate'

/** 玩家端和代理端共用：安卓下安装包，iPhone 打开 Safari 安装页。 */
export function useAppUpdate() {
  const { toast } = useToast()
  const visible = ref(false)
  const message = ref('')
  const link = ref('')
  let checking = false

  function openExternal(url: string) {
    const a = document.createElement('a')
    a.href = url
    a.target = '_blank'
    a.rel = 'noopener noreferrer'
    document.body.appendChild(a)
    a.click()
    a.remove()
  }

  function openInstall() {
    const url = link.value
    visible.value = false
    if (!url) return
    openExternal(url)
  }

  async function localVersionCode(): Promise<number> {
    if (!Capacitor.isNativePlatform()) return 1
    try {
      const info = await CapApp.getInfo()
      const code = Number(info.build)
      return Number.isFinite(code) && code > 0 ? code : 1
    } catch {
      return 1
    }
  }

  async function check() {
    if (checking) return
    checking = true
    try {
      const remote = await http.get<RemoteAppVersion, RemoteAppVersion>('/version')
      const decision = decideUpdate(await localVersionCode(), remote)
      if (decision.kind === 'current') {
        toast(`当前已是最新版本 v${decision.version}`)
        return
      }
      if (Capacitor.getPlatform() === 'ios') {
        link.value = iosInstallUrl(getLiveOrigin('api'))
        message.value = `新版本 v${decision.version}。请用 Safari 打开安装页后再安装，装好后从桌面重新进入。`
        visible.value = true
        return
      }
      const ok = window.confirm(`发现新版本 v${decision.version}，是否下载安装包？`)
      if (!ok) return
      openExternal(apkDownloadUrl(getLiveOrigin('api')))
    } catch {
      toast('连不上服务器，无法检查更新')
    } finally {
      checking = false
    }
  }

  return { visible, message, check, openInstall }
}
