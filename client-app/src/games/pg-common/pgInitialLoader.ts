/** 正版 index.html 开屏 PG SVG 动画 */

import {
  PG_DIGIT_G_PATHS,
  PG_DIGIT_G_X,
  PG_DIGIT_H,
  PG_DIGIT_P_PATHS,
  PG_DIGIT_P_X,
  PG_LAYER_COUNT,
  PG_ROW_STEP,
  PG_VIEW_H,
  PG_VIEW_W,
} from './pgOfficialPaths'

export const PG_INITIAL_LOADER_MIN_MS = 1800
export const PG_INITIAL_LOADER_FADE_MS = 350
export const PG_SLOGAN_TEXT = '不  凡   成   就   非   凡'

const ANIM_DURATION_MS = 1200
const BASE_Y = 20
const REF_W = 1440
const REF_H = 1024

/** 正版 index.html dt() */
function dt(w: number, h: number): number {
  return w / h > 0.5625 ? 1920 / h : 1080 / w
}

/** 正版 pt()：scale = dt(1440,1024) / dt(窗口) */
export function calcPgLogoScale(): number {
  const ref = dt(REF_W, REF_H)
  const current = dt(window.innerWidth, window.innerHeight)
  return ref / current
}

function easeWave(t: number): number {
  if (t <= 0.3) return t * t
  return 1 + 1.25 * (t - 1) ** 3 + 0.25 * (t - 1) ** 2
}

function createPaths(
  parent: SVGSVGElement,
  paths: ReadonlyArray<{ d: string; fill: string }>,
) {
  for (const item of paths) {
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path')
    path.setAttribute('d', item.d)
    path.setAttribute('fill', item.fill)
    path.setAttribute('fill-rule', 'evenodd')
    parent.appendChild(path)
  }
}

function createDigitSvg(
  paths: ReadonlyArray<{ d: string; fill: string }>,
  width: number,
): SVGSVGElement {
  const inner = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
  inner.setAttribute('xmlns', 'http://www.w3.org/2000/svg')
  inner.setAttribute('width', String(width))
  inner.setAttribute('height', String(PG_DIGIT_H))
  createPaths(inner, paths)
  return inner
}

function createDigitLayers(
  parent: SVGGElement,
  paths: ReadonlyArray<{ d: string; fill: string }>,
  width: number,
) {
  for (let i = 0; i < PG_LAYER_COUNT; i++) {
    const layer = document.createElementNS('http://www.w3.org/2000/svg', 'g')
    layer.setAttribute('transform', `translate(0, ${-i * PG_ROW_STEP})`)
    layer.appendChild(createDigitSvg(paths, width))
    parent.appendChild(layer)
  }
}

export function mountOfficialPgLoader(root: HTMLElement): () => void {
  const uid = String(Date.now())
  const bootAt = performance.now()

  const outerSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
  outerSvg.setAttribute('viewBox', `0 0 ${PG_VIEW_W} ${PG_VIEW_H}`)
  outerSvg.setAttribute('width', String(PG_VIEW_W))
  outerSvg.setAttribute('height', String(PG_VIEW_H))
  outerSvg.style.overflow = 'hidden'
  outerSvg.style.height = `${PG_VIEW_H}px`

  const masked = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
  masked.setAttribute('mask', `url(#mask-${uid})`)

  const digitP = document.createElementNS('http://www.w3.org/2000/svg', 'g')
  digitP.setAttribute('id', `digit-0-${uid}`)
  digitP.setAttribute('transform', `translate(${PG_DIGIT_P_X}, ${BASE_Y})`)
  digitP.setAttribute('filter', `url(#motionFilter-0-${uid})`)
  createDigitLayers(digitP, PG_DIGIT_P_PATHS, 112)

  const digitG = document.createElementNS('http://www.w3.org/2000/svg', 'g')
  digitG.setAttribute('id', `digit-1-${uid}`)
  digitG.setAttribute('transform', `translate(${PG_DIGIT_G_X}, ${BASE_Y})`)
  digitG.setAttribute('filter', `url(#motionFilter-1-${uid})`)
  createDigitLayers(digitG, PG_DIGIT_G_PATHS, 113)

  masked.appendChild(digitP)
  masked.appendChild(digitG)
  outerSvg.appendChild(masked)

  const defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs')

  const gradient = document.createElementNS('http://www.w3.org/2000/svg', 'linearGradient')
  gradient.setAttribute('id', `gradient-${uid}`)
  gradient.setAttribute('x1', '0%')
  gradient.setAttribute('y1', '0%')
  gradient.setAttribute('x2', '0%')
  gradient.setAttribute('y2', '100%')
  ;[
    ['0', '0'],
    ['0.2', '1'],
    ['0.8', '1'],
    ['1', '0'],
  ].forEach(([offset, opacity]) => {
    const stop = document.createElementNS('http://www.w3.org/2000/svg', 'stop')
    stop.setAttribute('offset', offset)
    stop.setAttribute('stop-color', 'white')
    stop.setAttribute('stop-opacity', opacity)
    gradient.appendChild(stop)
  })

  const mask = document.createElementNS('http://www.w3.org/2000/svg', 'mask')
  mask.setAttribute('id', `mask-${uid}`)
  const maskRect = document.createElementNS('http://www.w3.org/2000/svg', 'rect')
  maskRect.setAttribute('x', '0')
  maskRect.setAttribute('y', '0')
  maskRect.setAttribute('width', '100%')
  maskRect.setAttribute('height', '100%')
  maskRect.setAttribute('fill', `url(#gradient-${uid})`)
  mask.appendChild(maskRect)

  const makeBlurFilter = (id: string, blur: string) => {
    const filter = document.createElementNS('http://www.w3.org/2000/svg', 'filter')
    filter.setAttribute('id', id)
    filter.setAttribute('width', '300%')
    filter.setAttribute('x', '-100%')
    const blurNode = document.createElementNS('http://www.w3.org/2000/svg', 'feGaussianBlur')
    blurNode.setAttribute('stdDeviation', blur)
    filter.appendChild(blurNode)
    return filter
  }

  defs.appendChild(gradient)
  defs.appendChild(mask)
  defs.appendChild(makeBlurFilter(`motionFilter-0-${uid}`, '0 3'))
  defs.appendChild(makeBlurFilter(`motionFilter-1-${uid}`, '0 0.1'))
  outerSvg.appendChild(defs)

  const slogan = document.createElement('pre')
  slogan.className = 'pg-official-slogan'
  slogan.textContent = PG_SLOGAN_TEXT
  slogan.style.font = '20px Roboto, sans-serif'
  slogan.style.color = 'rgb(204, 204, 204)'
  slogan.style.opacity = '0'
  slogan.style.textAlign = 'center'
  slogan.style.margin = '12px 0 0'
  slogan.style.padding = '0'
  slogan.style.whiteSpace = 'pre'
  slogan.style.animation = '1.2s ease-in-out 0s 1 normal forwards running fade-in'

  root.appendChild(outerSvg)
  root.appendChild(slogan)

  const applyScale = () => {
    root.style.transform = `scale(${calcPgLogoScale().toFixed(4)})`
  }
  applyScale()
  window.addEventListener('resize', applyScale)

  const digits = [
    { el: digitP, delay: 400, weight: 1 },
    { el: digitG, delay: 200, weight: 1 },
  ]

  let raf = 0
  const tick = (now: number) => {
    const elapsed = now - bootAt
    digits.forEach(({ el, delay, weight }) => {
      const local = Math.max(0, elapsed - delay)
      const phase = (local % ANIM_DURATION_MS) / ANIM_DURATION_MS
      const travel = easeWave(phase) * (76 * PG_ROW_STEP * weight)
      const y = BASE_Y + (travel % (4 * PG_ROW_STEP))
      const x = el === digitP ? PG_DIGIT_P_X : PG_DIGIT_G_X
      el.setAttribute('transform', `translate(${x}, ${y})`)
    })
    raf = requestAnimationFrame(tick)
  }
  raf = requestAnimationFrame(tick)

  return () => {
    cancelAnimationFrame(raf)
    window.removeEventListener('resize', applyScale)
    root.style.transform = ''
    outerSvg.remove()
    slogan.remove()
  }
}
