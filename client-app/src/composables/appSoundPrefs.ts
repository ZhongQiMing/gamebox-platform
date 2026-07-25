/** 全局点击音效 / 大厅背景音乐偏好（localStorage） */

const SOUND_KEY = 'sound_off'
const BGM_KEY = 'app_bgm_off'

export function isClickSoundOn(): boolean {
  return localStorage.getItem(SOUND_KEY) !== '1'
}

export function setClickSoundOn(on: boolean) {
  if (on) localStorage.removeItem(SOUND_KEY)
  else localStorage.setItem(SOUND_KEY, '1')
}

export function isAppBgmOn(): boolean {
  return localStorage.getItem(BGM_KEY) !== '1'
}

export function setAppBgmOn(on: boolean) {
  if (on) localStorage.removeItem(BGM_KEY)
  else localStorage.setItem(BGM_KEY, '1')
}
