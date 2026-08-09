/**
 * 水果机 · 两路音频（互不混控）
 *
 * 1) music  背景音乐：bgm-idle.mp3 循环
 *    - setFruitBgmMuted / setFruitMusicOn
 *    - 账号「背景音乐」→ app_bgm_off（无本游戏覆盖时）
 *    - 跑灯/报奖时仅压低音量（duck），不关掉
 *
 * 2) sfx    游戏音效：下注 / 开跑 go / 跑灯 tick / 报奖 / 特殊奖语音 / 比倍 等
 *    - setFruitSfxMuted / setFruitSfxOn
 *    - 账号「音效」→ sound_off（无本游戏覆盖时）
 *    - 关掉立刻停当前短音与报奖，不影响 BGM
 *
 * 静音策略：无本游戏记录时跟随账号管理；有本游戏记录后只认本游戏开关。
 */
import type { FruitAwardType, FruitBetSymbolId } from '@gamebox/shared'
import {
  getAppBgmVolume,
  getAppSfxVolume,
  isAppBgmOn,
  isClickSoundOn,
} from '@/composables/appSoundPrefs'

/** 全游戏统一基准（再乘账号音量滑条） */
const BASE_BGM = 0.4
const BASE_SFX = 0.75
function musicVol() {
  return BASE_BGM * getAppBgmVolume()
}
function sfxVol(mult = 1) {
  return Math.min(1, BASE_SFX * getAppSfxVolume() * mult)
}

const BASE = '/audio/fruit'

const FILES = {
  bgm: `${BASE}/bgm-idle.mp3`,
  tick: `${BASE}/sfx-tick.mp3`,
  stop: `${BASE}/sfx-stop.mp3`,
  lose: `${BASE}/sfx-lose.mp3`,
  win: `${BASE}/win.mp3`,
  go: `${BASE}/go.mp3`,
  start: `${BASE}/start.mp3`,
  coin: `${BASE}/coin.mp3`,
  clear: `${BASE}/clear.mp3`,
  big: `${BASE}/sfx-big.mp3`,
  small: `${BASE}/sfx-small.mp3`,
  gambleWin: `${BASE}/sfx-gamble-win.mp3`,
  gambleLose: `${BASE}/sfx-gamble-lose.mp3`,
  cashout: `${BASE}/sfx-cashout.mp3`,
  /** 清盘 / 退注提示（与退币专用音区分） */
  clearBoard: `${BASE}/clear.mp3`,
  mult: `${BASE}/sfx-mult.mp3`,
  click: `${BASE}/sfx-click.mp3`,
  special: `${BASE}/sfx-special.mp3`,
  trainStep: `${BASE}/sfx-train-step.mp3`,
  awardTrain: `${BASE}/sfx-award-train.mp3`,
  awardFanfare: `${BASE}/sfx-award-fanfare.mp3`,
  awardSlam: `${BASE}/sfx-award-slam.mp3`,
  /** 大奖触发专用特殊音效 */
  jackpot: `${BASE}/sfx-jackpot.mp3`,
  wild: `${BASE}/sfx-wild.mp3`,
  barWin: `${BASE}/sfx-bar-win.mp3`,
  scoreUp: `${BASE}/sfx-score-up.mp3`,
} as const

/** 特殊大奖中文语音报奖（走 sfx 通道） */
const AWARD_VOICE: Partial<Record<FruitAwardType | 'goodluck', string>> = {
  train: `${BASE}/v_train.mp3`,
  big3: `${BASE}/v_big3.mp3`,
  small3: `${BASE}/v_small3.mp3`,
  four: `${BASE}/v_four.mp3`,
  slam: `${BASE}/v_slam.mp3`,
  luck_send: `${BASE}/v_luck_send.mp3`,
  luck_eat: `${BASE}/v_luck_eat.mp3`,
  goodluck: `${BASE}/v_goodluck.mp3`,
}

/** 8 仓位下注音（按钮左→右：bar→s1 … apple→s8） */
const BET_SFX: Record<FruitBetSymbolId, string> = {
  bar: `${BASE}/s1.mp3`,
  seven: `${BASE}/s2.mp3`,
  star: `${BASE}/s3.mp3`,
  melon: `${BASE}/s4.mp3`,
  bell: `${BASE}/s5.mp3`,
  lemon: `${BASE}/s6.mp3`,
  orange: `${BASE}/s7.mp3`,
  apple: `${BASE}/s8.mp3`,
}

/** 报奖：普通格 / 大格（幸运加倍） */
const ANNOUNCE_SFX: Record<FruitBetSymbolId, { small: string; big: string }> = {
  apple: { small: `${BASE}/s_apple.mp3`, big: `${BASE}/s_lapple.mp3` },
  orange: { small: `${BASE}/s_orange.mp3`, big: `${BASE}/s_lorange.mp3` },
  lemon: { small: `${BASE}/s_lingmeng.mp3`, big: `${BASE}/s_slingmeng.mp3` },
  bell: { small: `${BASE}/s_lingdang.mp3`, big: `${BASE}/s_slingdang.mp3` },
  melon: { small: `${BASE}/s_xigua.mp3`, big: `${BASE}/s_lxigua.mp3` },
  star: { small: `${BASE}/s_star.mp3`, big: `${BASE}/s_lstar.mp3` },
  seven: { small: `${BASE}/s_77.mp3`, big: `${BASE}/s_l77.mp3` },
  bar: { small: `${BASE}/s_bar.mp3`, big: `${BASE}/s_lbar.mp3` },
}

type SfxKey = keyof typeof FILES

const cache = new Map<string, HTMLAudioElement>()
/** 进行中的短音效，关 sfx 时一并掐掉 */
let liveSfx: HTMLAudioElement[] = []

function getAudio(url: string): HTMLAudioElement {
  let a = cache.get(url)
  if (!a) {
    a = new Audio(url)
    a.preload = 'auto'
    cache.set(url, a)
  }
  return a
}

function trackLiveSfx(a: HTMLAudioElement) {
  liveSfx.push(a)
  const drop = () => {
    const i = liveSfx.indexOf(a)
    if (i >= 0) liveSfx.splice(i, 1)
  }
  a.addEventListener('ended', drop, { once: true })
  a.addEventListener('error', drop, { once: true })
}

function playUrl(url: string, _volume = 0.75): HTMLAudioElement | null {
  if (sfxMuted) return null
  unlockFruitAudio()
  const a = getAudio(url).cloneNode(true) as HTMLAudioElement
  a.volume = sfxVol()
  trackLiveSfx(a)
  void a.play().catch(() => {})
  return a
}

let announceEl: HTMLAudioElement | null = null
let announceSrc: MediaElementAudioSourceNode | null = null
let announceCtx: AudioContext | null = null
let announceGain: GainNode | null = null

function getAnnounceCtx(): AudioContext | null {
  if (typeof window === 'undefined') return null
  const AC = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
  if (!AC) return null
  if (!announceCtx || announceCtx.state === 'closed') {
    announceCtx = new AC()
    announceGain = announceCtx.createGain()
    announceGain.connect(announceCtx.destination)
  }
  return announceCtx
}

function teardownAnnounceGraph() {
  try {
    announceSrc?.disconnect()
  } catch {
    /* ignore */
  }
  announceSrc = null
  if (!announceEl) return
  try {
    announceEl.pause()
    announceEl.removeAttribute('src')
    announceEl.load()
  } catch {
    /* ignore */
  }
  announceEl = null
}

/** 打断进行中的报奖语音，避免开火车连报时互相掐断 */
export function stopFruitAnnounce() {
  teardownAnnounceGraph()
}

function stopLiveSfx() {
  liveSfx.forEach((node) => {
    try {
      node.pause()
      node.removeAttribute('src')
      node.load()
    } catch {
      /* ignore */
    }
  })
  liveSfx = []
}

/** 立刻停掉 sfx 通道上的一切（短音 + go + 报奖），不动 BGM */
export function stopAllFruitSfx() {
  stopFruitAnnounce()
  stopFruitGo()
  stopLiveSfx()
}

/**
 * 播放并等到结束（独立 Audio，不 clone 未缓冲节点，带超时兜底）
 * gainBoost > 1 时经 WebAudio 放大，突破 HTMLAudio volume≤1 的上限（报奖语音偏轻）
 */
function playUrlAndWait(url: string, _volume = 0.9, maxMs = 3500, gainBoost = 1): Promise<void> {
  return new Promise((resolve) => {
    if (sfxMuted) {
      resolve()
      return
    }
    unlockFruitAudio()
    stopFruitAnnounce()
    // 报奖必须新建实例：clone 预加载节点在未 ready 时会立刻 error/ended，导致中间格“没报”
    const a = new Audio(url)
    a.preload = 'auto'
    a.crossOrigin = 'anonymous'
    announceEl = a
    let done = false
    const finish = () => {
      if (done) return
      done = true
      window.clearTimeout(t)
      try {
        announceSrc?.disconnect()
      } catch {
        /* ignore */
      }
      announceSrc = null
      if (announceEl === a) announceEl = null
      resolve()
    }
    const t = window.setTimeout(finish, maxMs)
    a.addEventListener('ended', finish, { once: true })
    a.addEventListener('error', finish, { once: true })

    const level = sfxVol()
    const boost = Math.max(1, gainBoost)
    const ctx = boost > 1 ? getAnnounceCtx() : null
    if (ctx && announceGain) {
      a.volume = 1
      announceGain.gain.value = level * boost
      void ctx.resume().catch(() => {})
      try {
        const src = ctx.createMediaElementSource(a)
        src.connect(announceGain)
        announceSrc = src
      } catch {
        // MediaElementSource 失败时退回普通播放
        a.volume = level
      }
    } else {
      a.volume = level
    }
    void a.play().catch(() => finish())
  })
}

let unlocked = false
let bgmEl: HTMLAudioElement | null = null
let bgmMuted = false
let sfxMuted = false
let goEl: HTMLAudioElement | null = null

const LS_BGM = 'fruit_bgm_off'
const LS_SFX = 'fruit_sfx_off'
const LS_LEGACY = 'fruit_sound_off'

/** 本游戏开关：关写 off；开写 on（不再被全局压死，也不改个人资料） */
function persistFruitLocal(bgmOff: boolean, sfxOff: boolean) {
  if (typeof localStorage === 'undefined') return
  localStorage.setItem(LS_BGM, bgmOff ? '1' : '0')
  localStorage.setItem(LS_SFX, sfxOff ? '1' : '0')
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
  const bgmKey = localStorage.getItem(LS_BGM)
  const sfxKey = localStorage.getItem(LS_SFX)
  if (legacy) {
    bgmMuted = true
    sfxMuted = true
    return
  }
  bgmMuted = bgmKey == null ? !isAppBgmOn() : bgmKey === '1'
  sfxMuted = sfxKey == null ? !isClickSoundOn() : sfxKey === '1'
}

function applyFruitLevels() {
  if (bgmEl && !bgmMuted) {
    // duck 由业务侧 setFruitBgmDuck 控制；此处只在非 duck 默认态刷新
    if (bgmEl.volume > musicVol() * 0.2) bgmEl.volume = musicVol()
  }
  liveSfx.forEach((n) => {
    try {
      n.volume = sfxVol()
    } catch {
      /* ignore */
    }
  })
  if (goEl) {
    try {
      goEl.volume = sfxVol()
    } catch {
      /* ignore */
    }
  }
}

/** 账号管理 / storage 变更后重读两路与音量；关 sfx 时立刻掐进行中音效 */
function syncAudioPrefs() {
  const prevBgm = bgmMuted
  const prevSfx = sfxMuted
  refreshEffectiveMute()
  if (bgmMuted && !prevBgm) stopFruitBgm()
  else if (!bgmMuted && prevBgm) startFruitBgm()
  if (sfxMuted && !prevSfx) stopAllFruitSfx()
  applyFruitLevels()
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

export function unlockFruitAudio() {
  if (unlocked) return
  unlocked = true
  const ctx = getAnnounceCtx()
  if (ctx) void ctx.resume().catch(() => {})
  const a = getAudio(FILES.click)
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

export function playFruitSfx(key: SfxKey, volume = 0.7) {
  playUrl(FILES[key], volume)
}

/** 按符号播放下注音 */
export function playFruitBet(symbol: FruitBetSymbolId) {
  playUrl(BET_SFX[symbol], 0.8)
}

/** 报奖：按格子大小播对应语音/音效，并等到播完 */
export function playFruitAnnounce(symbol: FruitBetSymbolId, size: 'big' | 'small'): Promise<void> {
  const pack = ANNOUNCE_SFX[symbol]
  if (!pack) return Promise.resolve()
  const url = size === 'big' ? pack.big : pack.small
  // 小格约 0.6~0.9s，大格约 1~1.4s；留足余量等 ended；增益抬高报奖人声
  /* gainBoost=1：与其它游戏音效统一响度，只受账号音量滑条控制 */
  return playUrlAndWait(url, 1, size === 'big' ? 2800 : 2200, 1)
}

/** 开跑：播一段跑灯 go（可打断） */
export function playFruitGo() {
  stopFruitGo()
  goEl = playUrl(FILES.go, 0.55)
}

export function stopFruitGo() {
  if (goEl) {
    try {
      goEl.pause()
      goEl.currentTime = 0
    } catch {
      /* ignore */
    }
    goEl = null
  }
}

/** 离开页面时释放 AudioContext，避免报奖增益节点泄漏 */
export function disposeFruitAudio() {
  stopAllFruitSfx()
  try {
    announceGain?.disconnect()
  } catch {
    /* ignore */
  }
  announceGain = null
  if (announceCtx && announceCtx.state !== 'closed') {
    void announceCtx.close().catch(() => {})
  }
  announceCtx = null
}

/* ───────── 1) 背景音乐 ───────── */

export function startFruitBgm() {
  refreshEffectiveMute()
  if (bgmMuted) return
  unlockFruitAudio()
  if (!bgmEl) {
    bgmEl = getAudio(FILES.bgm)
    bgmEl.loop = true
  }
  bgmEl.volume = musicVol()
  bgmEl.muted = false
  void bgmEl.play().catch(() => {})
}

export function stopFruitBgm() {
  if (bgmEl) {
    bgmEl.pause()
    bgmEl.currentTime = 0
  }
}

/** 跑灯/报奖时压低 BGM，结束后恢复 */
export function setFruitBgmDuck(duck: boolean) {
  if (!bgmEl) return
  const base = musicVol()
  bgmEl.volume = duck ? base * 0.12 : base
}

/** 本游戏单独关/开音乐（不改个人资料）；参数 true=静音 */
export function setFruitBgmMuted(v: boolean) {
  bgmMuted = v
  const sfxOff =
    localStorage.getItem(LS_SFX) == null
      ? !isClickSoundOn()
      : localStorage.getItem(LS_SFX) === '1'
  persistFruitLocal(v, sfxOff)
  if (bgmEl) {
    bgmEl.muted = v
    if (!v) {
      bgmEl.loop = true
      bgmEl.volume = musicVol()
      void bgmEl.play().catch(() => {})
    } else {
      bgmEl.pause()
    }
  } else if (!v) {
    startFruitBgm()
  }
}

/** 正向 API：开/关背景音乐（与牌桌 setMusicOn 对齐） */
export function setFruitMusicOn(on: boolean) {
  setFruitBgmMuted(!on)
}

/* ───────── 2) 游戏音效 ───────── */

/** 本游戏单独关/开音效（不改个人资料）；参数 true=静音 */
export function setFruitSfxMuted(v: boolean) {
  sfxMuted = v
  const bgmOff =
    localStorage.getItem(LS_BGM) == null
      ? !isAppBgmOn()
      : localStorage.getItem(LS_BGM) === '1'
  persistFruitLocal(bgmOff, v)
  if (v) stopAllFruitSfx()
}

/** 正向 API：开/关游戏音效（与牌桌 setSfxOn 对齐） */
export function setFruitSfxOn(on: boolean) {
  setFruitSfxMuted(!on)
}

export function isFruitBgmMuted() {
  return bgmMuted
}

export function isFruitSfxMuted() {
  return sfxMuted
}

export function isFruitMusicOn() {
  return !bgmMuted
}

export function isFruitSfxOn() {
  return !sfxMuted
}

/** 音乐与音效都关时视为总静音（兼容旧调用） */
export function isFruitMuted() {
  return bgmMuted && sfxMuted
}

/** @deprecated 请用 setFruitBgmMuted / setFruitSfxMuted */
export function setFruitMuted(v: boolean) {
  setFruitBgmMuted(v)
  setFruitSfxMuted(v)
}

export function initFruitMuteFromStorage() {
  refreshEffectiveMute()
}

/**
 * 特殊大奖开场曲（与中文语音配套，只在此处打一次 jackpot，避免与 revealHits 叠播）
 */
export function playFruitAwardFanfare(
  awardType: 'train' | 'big3' | 'small3' | 'four' | 'slam' | 'luck_send' | 'luck_eat' | string,
) {
  if (awardType === 'luck_eat') {
    playFruitSfx('special', 0.85)
    return
  }
  playFruitSfx('jackpot', 1)
  if (awardType === 'train') {
    playFruitSfx('awardTrain', 0.9)
    return
  }
  if (awardType === 'slam') {
    playFruitSfx('awardSlam', 0.95)
    return
  }
  if (
    awardType === 'big3' ||
    awardType === 'small3' ||
    awardType === 'four' ||
    awardType === 'luck_send'
  ) {
    playFruitSfx('awardFanfare', 0.88)
    return
  }
  playFruitSfx('special', 0.85)
}

/**
 * 中文语音报奖：开火车啦 / 大三元 / 小三元 / 大四喜 / 大满贯 / 送灯 / 吃灯
 * 返回 Promise，便于等语音播完再继续跑灯
 */
export async function playFruitAwardVoice(
  awardType: FruitAwardType | 'goodluck' | string,
): Promise<void> {
  const url = AWARD_VOICE[awardType as keyof typeof AWARD_VOICE]
  if (!url) return
  /* 与其它 sfx 统一响度 */
  await playUrlAndWait(url, 1, 3200, 1)
}
