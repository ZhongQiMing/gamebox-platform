/**
 * 奔驰宝马 · 两路音频（互不混控）
 *
 * 1) music  背景音乐：bgm.mp3 循环
 *    - setBcbmBgmMuted / setBcbmMusicOn
 *    - 账号「背景音乐」→ app_bgm_off（无本游戏覆盖时）
 *    - 对齐官方 SOUND_BGM：静音只 muted，不停轨、不归零进度
 *
 * 2) sfx    游戏音效：下注 / 开跑 / 跑灯 / 派彩循环 / 报奖旁白 / ding / flash 等
 *    - setBcbmSfxMuted / setBcbmSfxOn
 *    - 账号「音效」→ sound_off（无本游戏覆盖时）
 *    - 对齐官方 SOUND_SFX stopAtMuted=true：关掉立刻停进行中音效，不影响 BGM
 *
 * YoPlay YBEN 对照（benz2221.min.js + yp ModuleSound）：
 *   ModuleSound.play(res, channel, loop, volume=100)
 *   实际响度 = channelVol(100) * volume * 0.01 * 0.01
 *   例：BGM play(yben_bgm, BGM, -1, 20) → 0.20
 */
import type { BcbmAwardType } from '@gamebox/shared'
import {
  getAppBgmVolume,
  getAppSfxVolume,
  isAppBgmOn,
  isClickSoundOn,
} from '@/composables/appSoundPrefs'
import { playOneShot } from '../pg-common/audioPool'

const BASE = '/audio/bcbm'

/** 全游戏统一基准（再乘账号音量滑条）；原官方 BGM 约 0.20 */
const BASE_BGM = 0.4
const BASE_SFX = 0.75
function musicVol() {
  return BASE_BGM * getAppBgmVolume()
}
function sfxVol() {
  return Math.min(1, BASE_SFX * getAppSfxVolume())
}

const FILES = {
  bgm: `${BASE}/bgm.mp3`,
  bet: `${BASE}/bet.mp3`,
  start: `${BASE}/start.mp3`,
  spin: `${BASE}/spin.mp3`,
  anticipation: `${BASE}/anticipation.mp3`,
  bonusLoop: `${BASE}/bonus-loop.mp3`,
  bonusEnd: `${BASE}/bonus-end.mp3`,
  payout: `${BASE}/payout.mp3`,
  payout2: `${BASE}/payout2.mp3`,
  payoutOut: `${BASE}/payout-out.mp3`,
  counting: `${BASE}/counting.mp3`,
  countingEnd: `${BASE}/counting-end.mp3`,
  ding: `${BASE}/ding.mp3`,
  flash: `${BASE}/flash.mp3`,
  /** 特殊奖中文报奖旁白（短语音，非氛围乐） */
  announceSanyuan: `${BASE}/announce-sanyuan.mp3`,
  announceSixi: `${BASE}/announce-sixi.mp3`,
  announceFast: `${BASE}/announce-fast.mp3`,
  announceUturn: `${BASE}/announce-uturn.mp3`,
  announceLightning: `${BASE}/announce-lightning.mp3`,
  announceDrift: `${BASE}/announce-drift.mp3`,
} as const

type SfxKey = keyof typeof FILES
const cache = new Map<string, HTMLAudioElement>()
let unlocked = false
/** 两路静音：music / sfx（对应官方 SOUND_BGM / SOUND_SFX） */
let bgmMuted = false
let sfxMuted = false

let bgmEl: HTMLAudioElement | null = null
let spinEl: HTMLAudioElement | null = null
let anticipEl: HTMLAudioElement | null = null
/** group=payout：bonus_loop / payout_loop / payout_loop2 */
let payoutLoopEl: HTMLAudioElement | null = null
let countingEl: HTMLAudioElement | null = null
/** 报奖旁白（独立轨，避免被 cloneNode 未缓冲拖死） */
let announceEl: HTMLAudioElement | null = null
let spinStartTimer: number | null = null
let announceDuckTimer: number | null = null
let dingTimers: number[] = []
/** 切后台前 BGM 是否在播，回前台用于恢复 */
let bgmWasPlaying = false

const LS_BGM = 'bcbm_bgm_off'
const LS_SFX = 'bcbm_sfx_off'
/** 旧版合并静音，迁移用 */
const LS_LEGACY = 'bcbm_sound_off'

const ANNOUNCE_URLS = [
  FILES.announceSanyuan,
  FILES.announceSixi,
  FILES.announceFast,
  FILES.announceUturn,
  FILES.announceLightning,
  FILES.announceDrift,
] as const

/** 报奖氛围乐压低比例（相对统一 sfx 音量） */
const BONUS_LOOP_DUCK_RATIO = 0.2

function getAudio(url: string) {
  let a = cache.get(url)
  if (!a) {
    a = new Audio(url)
    a.preload = 'auto'
    cache.set(url, a)
  }
  return a
}

/** 一次性音效：走 pg-common 对象池，复用空闲实例，避免高频下注堆积游离 Audio */
function playUrl(url: string, _volume = 0.75) {
  if (sfxMuted) return null
  unlockBcbmAudio()
  return playOneShot(url, sfxVol())
}

function stopEl(el: HTMLAudioElement | null) {
  if (!el) return
  el.pause()
  el.currentTime = 0
  el.loop = false
}

function playLoop(url: string, _volume: number): HTMLAudioElement | null {
  if (sfxMuted) return null
  unlockBcbmAudio()
  const a = getAudio(url)
  a.loop = true
  a.volume = sfxVol()
  a.currentTime = 0
  void a.play().catch(() => {})
  return a
}

function preloadAnnounce() {
  for (const url of ANNOUNCE_URLS) getAudio(url)
}

function clearAnnounceDuck() {
  if (announceDuckTimer != null) {
    window.clearTimeout(announceDuckTimer)
    announceDuckTimer = null
  }
}

function stopAnnounce() {
  clearAnnounceDuck()
  stopEl(announceEl)
  announceEl = null
}

export function unlockBcbmAudio() {
  if (unlocked) return
  unlocked = true
  preloadAnnounce()
  const a = getAudio(FILES.bet)
  a.volume = 0
  void a
    .play()
    .then(() => {
      a.pause()
      a.currentTime = 0
      a.volume = 1
    })
    .catch(() => {})
}

export function playBcbmSfx(key: SfxKey, volume = 0.75) {
  playUrl(FILES[key], volume)
}

export function playBcbmBet() {
  playUrl(FILES.bet, 0.7)
}

/** 官方 STARTING_SPIN：pendingPlay(spin_start, loop=0, vol=100) + pendingPlay(spin_loop, -1, vol=100)
 *  第 4 参是音量，不是 delay——两轨同时起，勿人为延后 100ms */
export function playBcbmSpinStartAndLoop() {
  stopBcbmSpinLoop()
  stopBcbmAnticipation()
  if (spinStartTimer != null) {
    window.clearTimeout(spinStartTimer)
    spinStartTimer = null
  }
  if (sfxMuted) return
  unlockBcbmAudio()
  playUrl(FILES.start, 0.85)
  spinEl = playLoop(FILES.spin, 0.55)
}

export function stopBcbmSpinLoop() {
  if (spinStartTimer != null) {
    window.clearTimeout(spinStartTimer)
    spinStartTimer = null
  }
  stopEl(spinEl)
  spinEl = null
}

function clearDingTimers() {
  for (const id of dingTimers) window.clearTimeout(id)
  dingTimers = []
}

export function playBcbmAnticipation() {
  stopBcbmAnticipation()
  if (sfxMuted) return
  unlockBcbmAudio()
  anticipEl = new Audio(FILES.anticipation)
  anticipEl.volume = sfxVol()
  void anticipEl.play().catch(() => {})
}

export function stopBcbmAnticipation() {
  stopEl(anticipEl)
  anticipEl = null
}

/**
 * 官方 GamePage onAdd：ModuleSound.play("yben_bgm_mp3", SOUND_BGM, -1, 20)
 * volume=20 → 响度 0.20；BGM 频道 stopAtMuted=false，静音时仍播但 muted
 */
export function startBcbmBgm() {
  unlockBcbmAudio()
  if (!bgmEl) bgmEl = getAudio(FILES.bgm)
  bgmEl.loop = true
  bgmEl.volume = musicVol()
  bgmEl.muted = bgmMuted
  void bgmEl.play().catch(() => {})
}

/** 离页/销毁：真正停轨并复位（与 stopChannel(BGM) 对应） */
export function stopBcbmBgm() {
  if (!bgmEl) return
  bgmEl.pause()
  bgmEl.currentTime = 0
  bgmEl.muted = false
}

function stopPayoutGroup() {
  // 报奖旁白独立：不随 payout group 一起掐断
  stopEl(payoutLoopEl)
  payoutLoopEl = null
  stopEl(countingEl)
  countingEl = null
}

/** 停派彩组/旁白/ding 定时器；不播 counting_end（离局与收尾用） */
export function clearBcbmPayout() {
  clearDingTimers()
  stopEl(countingEl)
  countingEl = null
  stopPayoutGroup()
  stopAnnounce()
}

/** 切到后台：暂停 BGM，停掉循环 SFX，避免漏音 */
export function pauseBcbmForBackground() {
  bgmWasPlaying = !!(bgmEl && !bgmEl.paused && !bgmEl.muted && !bgmMuted)
  if (bgmEl) bgmEl.pause()
  stopBcbmSpinLoop()
  stopBcbmAnticipation()
  clearBcbmPayout()
}

/** 回前台：按需恢复 BGM（开奖中 SFX 由本局流程自行再起） */
export function resumeBcbmFromBackground() {
  if (bgmWasPlaying && !bgmMuted) startBcbmBgm()
  bgmWasPlaying = false
}

/** 本游戏开关：关写 1 / 开写 0；有记录后不再被个人资料覆盖 */
function persistMute() {
  if (typeof localStorage === 'undefined') return
  localStorage.setItem(LS_BGM, bgmMuted ? '1' : '0')
  localStorage.setItem(LS_SFX, sfxMuted ? '1' : '0')
  localStorage.removeItem(LS_LEGACY)
}

/**
 * 读取本游戏静音。
 * 无本游戏记录时跟随个人资料；有记录后只认本游戏开关。
 */
function refreshEffectiveMute() {
  if (typeof localStorage === 'undefined') {
    bgmMuted = false
    sfxMuted = false
    return
  }
  const legacy = localStorage.getItem(LS_LEGACY) === '1'
  if (legacy) {
    bgmMuted = true
    sfxMuted = true
    return
  }
  const bgmKey = localStorage.getItem(LS_BGM)
  const sfxKey = localStorage.getItem(LS_SFX)
  bgmMuted = bgmKey == null ? !isAppBgmOn() : bgmKey === '1'
  sfxMuted = sfxKey == null ? !isClickSoundOn() : sfxKey === '1'
}

/** 立刻停掉 sfx 通道上的一切，不动 BGM */
export function stopAllBcbmSfx() {
  stopBcbmSpinLoop()
  stopBcbmAnticipation()
  clearBcbmPayout()
}

function applyBcbmLevels() {
  if (bgmEl) {
    try {
      bgmEl.volume = musicVol()
    } catch {
      /* ignore */
    }
  }
  const level = sfxVol()
  for (const el of [spinEl, anticipEl, payoutLoopEl, countingEl, announceEl]) {
    if (!el) continue
    try {
      el.volume = el === payoutLoopEl && announceEl ? level * BONUS_LOOP_DUCK_RATIO : level
    } catch {
      /* ignore */
    }
  }
}

/** 账号管理 / storage 变更后重读两路与音量 */
function syncAudioPrefs() {
  const prevBgm = bgmMuted
  const prevSfx = sfxMuted
  refreshEffectiveMute()
  if (bgmEl) {
    bgmEl.muted = bgmMuted
    if (!bgmMuted && prevBgm) {
      bgmEl.loop = true
      bgmEl.volume = musicVol()
      void bgmEl.play().catch(() => {})
    }
  } else if (!bgmMuted && prevBgm) {
    startBcbmBgm()
  }
  if (sfxMuted && !prevSfx) stopAllBcbmSfx()
  applyBcbmLevels()
}

if (typeof window !== 'undefined') {
  window.addEventListener('storage', (ev) => {
    if (!ev) return
    if (
      ev.key === 'app_bgm_off' ||
      ev.key === 'sound_off' ||
      ev.key === 'app_bgm_vol' ||
      ev.key === 'app_sfx_vol' ||
      ev.key === LS_BGM ||
      ev.key === LS_SFX ||
      ev.key === LS_LEGACY
    ) {
      syncAudioPrefs()
    }
  })
  window.addEventListener('app-audio-pref-changed', () => {
    syncAudioPrefs()
  })
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) syncAudioPrefs()
  })
}

/* ───────── 1) 背景音乐 ───────── */

/** 官方 setMuted(SOUND_BGM)：只改 muted，不停轨、不归零进度 */
export function setBcbmBgmMuted(v: boolean) {
  bgmMuted = v
  persistMute()
  if (bgmEl) {
    bgmEl.muted = v
    if (!v) {
      bgmEl.loop = true
      bgmEl.volume = musicVol()
      void bgmEl.play().catch(() => {})
    }
  } else if (!v) {
    startBcbmBgm()
  }
}

/** 正向 API：开/关背景音乐（与牌桌/水果机 setMusicOn 对齐） */
export function setBcbmMusicOn(on: boolean) {
  setBcbmBgmMuted(!on)
}

/* ───────── 2) 游戏音效 ───────── */

/** 官方 setMuted(SOUND_SFX, stopAtMuted=true)：停掉进行中的循环音效 */
export function setBcbmSfxMuted(v: boolean) {
  sfxMuted = v
  persistMute()
  if (v) stopAllBcbmSfx()
}

/** 正向 API：开/关游戏音效（与牌桌/水果机 setSfxOn 对齐） */
export function setBcbmSfxOn(on: boolean) {
  setBcbmSfxMuted(!on)
}

export function isBcbmBgmMuted() {
  return bgmMuted
}

export function isBcbmSfxMuted() {
  return sfxMuted
}

export function isBcbmMusicOn() {
  return !bgmMuted
}

export function isBcbmSfxOn() {
  return !sfxMuted
}

export function initBcbmMuteFromStorage() {
  refreshEffectiveMute()
  if (typeof localStorage !== 'undefined' && localStorage.getItem(LS_LEGACY) === '1') {
    persistMute()
  }
}

export function isBcbmBonusAward(awardType: BcbmAwardType | string) {
  const a = String(awardType)
  return (
    a.startsWith('sanyuan_') ||
    a.startsWith('sixi_') ||
    a === 'fast' ||
    a === 'uturn' ||
    a === 'lightning' ||
    a === 'drift' ||
    a === 'free'
  )
}

/**
 * 特殊奖中文报奖旁白：大三元 / 大四喜 / 极速狂飙 / U型弯道 / 霹雳闪电 / 全民漂移
 * 压低 bonus_loop，避免氛围乐盖掉报奖
 */
export function playBcbmBonusAnnounce(awardType: BcbmAwardType | string) {
  if (sfxMuted) return
  unlockBcbmAudio()
  const a = String(awardType)
  let url: string | null = null
  if (a.startsWith('sanyuan')) url = FILES.announceSanyuan
  else if (a.startsWith('sixi')) url = FILES.announceSixi
  else if (a === 'fast') url = FILES.announceFast
  else if (a === 'uturn') url = FILES.announceUturn
  else if (a === 'free' || a === 'lightning') url = FILES.announceLightning
  else if (a === 'drift') url = FILES.announceDrift
  // FxOverlay kind 也可能直接传入
  else if (a === 'sanyuan') url = FILES.announceSanyuan
  else if (a === 'sixi') url = FILES.announceSixi
  if (!url) return

  stopAnnounce()
  if (payoutLoopEl) payoutLoopEl.volume = sfxVol() * BONUS_LOOP_DUCK_RATIO

  const el = new Audio(url)
  el.preload = 'auto'
  el.volume = sfxVol()
  announceEl = el
  const restore = () => {
    if (announceEl && announceEl !== el) return
    if (announceEl === el) announceEl = null
    clearAnnounceDuck()
    if (payoutLoopEl && !sfxMuted && !announceEl) {
      payoutLoopEl.volume = sfxVol()
    }
  }
  el.addEventListener('ended', restore, { once: true })
  el.addEventListener('error', restore, { once: true })
  const tryPlay = () => {
    void el.play().catch(() => {
      // 未缓冲完成时再试一次
      window.setTimeout(() => {
        void el.play().catch(() => restore())
      }, 120)
    })
  }
  if (el.readyState >= 2) tryPlay()
  else {
    el.addEventListener('canplaythrough', tryPlay, { once: true })
    el.load()
    // 兜底：部分浏览器不触发 canplaythrough
    window.setTimeout(tryPlay, 80)
  }
  announceDuckTimer = window.setTimeout(restore, 3500)
}

/**
 * 官方 startPayout 入口音（已 stop spin_loop / anticipation）：
 * ResultBonus≥0 → bonus_loop(-1) + 报奖旁白
 * else level>1 → payout_loop(-1)
 * else SmallPrize（Lv1 开场静音，ding 在 FastJumpAmount）
 */
export function startBcbmPayout(opts: {
  isBonus: boolean
  payoutLevel: number
  payout: number
  awardType?: BcbmAwardType | string
}) {
  stopPayoutGroup()
  stopAnnounce()
  if (sfxMuted) return
  const { isBonus, payoutLevel } = opts
  if (isBonus) {
    // 正版 startPayout 立刻 bonus_loop(vol=100)；旁白出现时再压低
    payoutLoopEl = playLoop(FILES.bonusLoop, sfxVol())
    return
  }
  if (payoutLevel > 1) {
    payoutLoopEl = playLoop(FILES.payout, 0.8)
  }
  // SmallPrize Lv0/Lv1：此处不播 ding
}

/** 官方 FastJumpAmount：800ms 间隔 ding ×2 */
export function playBcbmFastJumpDing() {
  if (sfxMuted) return
  clearDingTimers()
  playUrl(FILES.ding, 0.8)
  dingTimers.push(
    window.setTimeout(() => {
      if (!sfxMuted) playUrl(FILES.ding, 0.8)
    }, 800),
  )
}

/** ShowAmount：level≥2 循环 counting */
export function playBcbmCounting(payoutLevel: number) {
  stopEl(countingEl)
  countingEl = null
  if (sfxMuted || payoutLevel < 2) return
  countingEl = playLoop(FILES.counting, 0.55)
}

/** 金额滚完：stop counting + counting_end */
export function endBcbmCounting() {
  if (countingEl) {
    stopEl(countingEl)
    countingEl = null
    playUrl(FILES.countingEnd, 0.7)
  }
}

/** PrizeLv3/4 且无 ResultBonus → payout_loop2 */
export function playBcbmPrizeLv(payoutLevel: number, isBonus: boolean) {
  if (sfxMuted || isBonus || payoutLevel < 3) return
  stopEl(payoutLoopEl)
  payoutLoopEl = playLoop(FILES.payout2, 0.8)
}

/** 金额飞顶 flash */
export function playBcbmFlash() {
  playUrl(FILES.flash, 0.8)
}

/**
 * JumpAmount / End / Idel：
 * bonus → bonus_end；否则 stop(payout group) + payout_fadeout
 */
export function endBcbmPayout(isBonus: boolean) {
  endBcbmCounting()
  if (sfxMuted) {
    stopPayoutGroup()
    return
  }
  if (isBonus) {
    stopPayoutGroup()
    playUrl(FILES.bonusEnd, 0.9)
  } else {
    stopPayoutGroup()
    playUrl(FILES.payoutOut, 0.75)
  }
}

/** 官方 payoutLevel：totalBonus / totalBet → 0..4 */
export function bcbmPayoutLevel(totalPayout: number, totalBet: number): number {
  if (totalPayout <= 0 || totalBet <= 0) return 0
  const t = totalPayout / totalBet
  if (t <= 1) return 1
  if (t <= 3) return 2
  if (t <= 5) return 3
  return 4
}

/**
 * 官方 ShowAmount 滚分时长：
 * Lv≤1：瞬间 sync（0）
 * Lv2：2000ms
 * Lv≥3：min(14000, 2000 + (totalBonus/totalBet)/10 * 12000)
 */
export function bcbmCountDurationMs(
  totalPayout: number,
  totalBet: number,
  payoutLevel: number,
): number {
  if (payoutLevel <= 1) return 0
  if (payoutLevel === 2) return 2000
  const ratio = totalBet > 0 ? totalPayout / totalBet : 0
  return Math.min(14000, 2000 + (ratio / 10) * 12000)
}
