/** 点击音效（Web Audio API，与原型 common.js 逻辑一致） */
import { isClickSoundOn } from './appSoundPrefs'

let audioCtx: AudioContext | null = null
let lastTone = 0

function fireClickTone(ctx: AudioContext) {
  try {
    const o = ctx.createOscillator()
    const g = ctx.createGain()
    o.type = 'sine'
    o.frequency.value = 880
    o.connect(g)
    g.connect(ctx.destination)
    const t = ctx.currentTime
    g.gain.setValueAtTime(0, t)
    g.gain.linearRampToValueAtTime(0.05, t + 0.005)
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.06)
    o.start(t)
    o.stop(t + 0.08)
  } catch (_) {}
}

export function useClickSound() {
  function playClick() {
    if (!isClickSoundOn()) return
    const now = performance.now()
    if (now - lastTone < 80) return
    lastTone = now
    const Ctx = window.AudioContext ?? (window as any).webkitAudioContext
    if (!Ctx) return
    if (!audioCtx) {
      try { audioCtx = new Ctx() } catch (_) { return }
    }
    if (audioCtx.state === 'suspended') {
      audioCtx.resume().then(() => fireClickTone(audioCtx!)).catch(() => {})
    } else {
      fireClickTone(audioCtx)
    }
  }

  function attach() {
    const opts = { capture: true, passive: true }
    if ('onpointerdown' in window) {
      document.addEventListener('pointerdown', playClick, opts)
    } else {
      document.addEventListener('mousedown', playClick, opts)
      document.addEventListener('touchstart', playClick, opts)
    }
  }

  return { playClick, attach }
}
