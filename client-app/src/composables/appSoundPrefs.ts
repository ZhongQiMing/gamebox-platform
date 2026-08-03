/** 账号管理：背景音乐 / 游戏音效（localStorage，全站与游戏共用） */

const SOUND_KEY = 'sound_off'
const BGM_KEY = 'app_bgm_off'

/** 各游戏单独覆盖键；账号页改开关时清除，使游戏重新跟随账号设置 */
const GAME_AUDIO_OVERRIDE_KEYS = [
  'ssc_audio_v1',
  'ffc_audio_v1',
  'k3_audio_v1',
  'bjsc_audio_v1',
  'jsr_audio_v1',
  'jsb_audio_v1',
  'lhc_audio_v1',
  'bjl_audio',
  'zjh_audio',
  'dn_audio',
  'lhd_audio',
  'fruit_bgm_off',
  'fruit_sfx_off',
  'fruit_sound_off',
  'bcbm_bgm_off',
  'bcbm_sfx_off',
  'bcbm_sound_off',
] as const

export function isClickSoundOn(): boolean {
  return localStorage.getItem(SOUND_KEY) !== '1'
}

export function setClickSoundOn(on: boolean) {
  if (on) localStorage.removeItem(SOUND_KEY)
  else localStorage.setItem(SOUND_KEY, '1')
  clearGameAudioOverrides()
  notifyAppAudioPrefChanged()
}

export function isAppBgmOn(): boolean {
  return localStorage.getItem(BGM_KEY) !== '1'
}

export function setAppBgmOn(on: boolean) {
  if (on) localStorage.removeItem(BGM_KEY)
  else localStorage.setItem(BGM_KEY, '1')
  clearGameAudioOverrides()
  notifyAppAudioPrefChanged()
}

/** 清除各游戏内单独开关，下次进房按账号管理设置 */
export function clearGameAudioOverrides() {
  for (const k of GAME_AUDIO_OVERRIDE_KEYS) {
    try {
      localStorage.removeItem(k)
    } catch {
      /* ignore */
    }
  }
}

function notifyAppAudioPrefChanged() {
  try {
    window.dispatchEvent(new CustomEvent('app-audio-pref-changed'))
  } catch {
    /* ignore */
  }
}
