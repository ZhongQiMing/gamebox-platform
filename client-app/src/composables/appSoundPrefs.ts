/** 账号管理：背景音乐 / 游戏音效（开关 + 音量，全站与游戏共用） */

const SOUND_KEY = 'sound_off'
const BGM_KEY = 'app_bgm_off'
/** 音量 0～100；缺省 80 */
const SFX_VOL_KEY = 'app_sfx_vol'
const BGM_VOL_KEY = 'app_bgm_vol'
const DEFAULT_VOL_PERCENT = 80

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

function clampPercent(n: number): number {
  if (!Number.isFinite(n)) return DEFAULT_VOL_PERCENT
  return Math.max(0, Math.min(100, Math.round(n)))
}

function readVolPercent(key: string): number {
  try {
    const raw = localStorage.getItem(key)
    if (raw == null || raw === '') return DEFAULT_VOL_PERCENT
    return clampPercent(Number(raw))
  } catch {
    return DEFAULT_VOL_PERCENT
  }
}

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

/** 游戏音效音量 0～1（含聊天室开奖动画音效） */
export function getAppSfxVolume(): number {
  return readVolPercent(SFX_VOL_KEY) / 100
}

export function getAppSfxVolumePercent(): number {
  return readVolPercent(SFX_VOL_KEY)
}

export function setAppSfxVolumePercent(n: number) {
  localStorage.setItem(SFX_VOL_KEY, String(clampPercent(n)))
  notifyAppAudioPrefChanged()
}

/** 背景音乐音量 0～1 */
export function getAppBgmVolume(): number {
  return readVolPercent(BGM_VOL_KEY) / 100
}

export function getAppBgmVolumePercent(): number {
  return readVolPercent(BGM_VOL_KEY)
}

export function setAppBgmVolumePercent(n: number) {
  localStorage.setItem(BGM_VOL_KEY, String(clampPercent(n)))
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
