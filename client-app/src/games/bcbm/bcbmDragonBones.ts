import {
  Application,
  Assets,
  ALPHA_MODES,
  BLEND_MODES,
  Container,
  Sprite,
  Texture,
  Ticker,
  settings,
  SCALE_MODES,
} from 'pixi.js'
import { PixiFactory } from '@md5crypt/dragonbones-pixi'
import type { PixiArmatureDisplay } from '@md5crypt/dragonbones-pixi'

/** 黑底转透明后强制刷新缓存；shine 已还原正版软边 alpha → alpha6 */
const DB_ROOT = '/images/games/bcbm/benz/db'
const FX_PS = '/images/games/bcbm/benz/fx/particles'
const DB_VER = 'alpha6'
const dbUrl = (name: string) => `${DB_ROOT}/${name}?v=${DB_VER}`
const fxPsUrl = (name: string) => `${FX_PS}/${name}?v=${DB_VER}`

/** 正版 Egret GravityParticleSystem 精简运行时 */
type PsCfg = {
  maxParticles: number
  lifespan: number
  lifespanVariance: number
  speed: number
  speedVariance: number
  emitAngle: number
  emitAngleVariance: number
  gravity: { x: number; y: number }
  /** JSON emitter 相对粒子系统原点 */
  emitter: { x: number; y: number }
  emitterVariance: { x: number; y: number }
  startSize: number
  startSizeVariance: number
  endSize: number
  endSizeVariance: number
  startAlpha: number
  endAlpha: number
  startRotation: number
  startRotationVariance: number
  endRotation: number
  endRotationVariance: number
}

type PsParticle = {
  sprite: Sprite
  vx: number
  vy: number
  life: number
  maxLife: number
  startSize: number
  endSize: number
  rotSpeed: number
  texW: number
  texH: number
}

type PsEmitter = {
  root: Container
  particles: PsParticle[]
  alive: boolean
  accMs: number
  cfg: PsCfg
  tex: Texture
}

export type BcbmDbPackId =
  | 'speedWeak'
  | 'speedStrong'
  | 'payoutCommon'
  | 'payoutText'
  | 'number'
  | 'thunder'

type PackSpec = {
  id: BcbmDbPackId
  ske: string
  tex: string
  png: string
  dbName: string
  armature: string
}

const PACKS: PackSpec[] = [
  {
    id: 'speedWeak',
    ske: 'yben_speeed_effect_final_ske.json',
    tex: 'yben_speeed_effect_final_tex.json',
    png: 'yben_speeed_effect_final_tex.png',
    dbName: 'yben_speeed_effect_final',
    armature: 'Armature',
  },
  {
    id: 'speedStrong',
    ske: 'yben_speeed_effect_2_final_ske.json',
    tex: 'yben_speeed_effect_2_final_tex.json',
    png: 'yben_speeed_effect_2_final_tex.png',
    dbName: 'yben_speeed_effect_2_final',
    armature: 'Armature',
  },
  {
    id: 'payoutCommon',
    ske: 'yben_effect_final_common_ske.json',
    tex: 'yben_effect_final_common_tex.json',
    png: 'yben_effect_final_common_tex.png',
    dbName: 'yben_effect_final_common',
    armature: 'Armature',
  },
  {
    id: 'payoutText',
    ske: 'yben_effect_final_text_ske.json',
    tex: 'yben_effect_final_text_tex.json',
    png: 'yben_effect_final_text_tex.png',
    dbName: 'yben_effect_final_text',
    armature: 'Armature',
  },
  {
    id: 'number',
    ske: 'yben_number_effect_ske.json',
    tex: 'yben_number_effect_tex.json',
    png: 'yben_number_effect_tex.png',
    dbName: 'yben_number_disappear',
    armature: 'Armature',
  },
  {
    id: 'thunder',
    ske: 'yben_lv2_thunder_ske.json',
    tex: 'yben_lv2_thunder_tex.json',
    png: 'yben_lv2_thunder_tex.png',
    dbName: 'yben_lv2_thunder',
    armature: 'Armature',
  },
]

settings.SCALE_MODE = SCALE_MODES.LINEAR

type Layer = {
  app: Application
  host: HTMLElement
  displays: Map<string, PixiArmatureDisplay>
  sparks: Map<string, PsEmitter>
}

const layers = new Map<string, Layer>()
let factoryReady: Promise<boolean> | null = null
let factoryOk = false
const loadedPacks = new Set<string>()
let clockStarted = false

type NamedPs = { tex: Texture; cfg: PsCfg }
const psAssets = new Map<string, NamedPs>()

const HOST_IDS: Record<string, string> = {
  speed: 'bcbm-speed-db-host',
  payout: 'bcbm-payout-db-host',
  amountGlow: 'bcbm-amount-glow-host',
  /** 官方 rewardPaperPs：betBoardPanel+1 */
  paper: 'bcbm-paper-fx-host',
}

function randRange(base: number, variance: number) {
  return base + (Math.random() * 2 - 1) * variance
}

function parsePsCfg(raw: Record<string, unknown>): PsCfg {
  const grav = (raw.gravity || {}) as { x?: number; y?: number }
  const em = (raw.emitter || {}) as { x?: number; y?: number }
  const ev = (raw.emitterVariance || {}) as { x?: number; y?: number }
  return {
    maxParticles: Number(raw.maxParticles) || 10,
    lifespan: Number(raw.lifespan) || 500,
    lifespanVariance: Number(raw.lifespanVariance) || 0,
    speed: Number(raw.speed) || 0,
    speedVariance: Number(raw.speedVariance) || 0,
    emitAngle: Number(raw.emitAngle) || 0,
    emitAngleVariance: Number(raw.emitAngleVariance) || 0,
    gravity: { x: Number(grav.x) || 0, y: Number(grav.y) || 0 },
    emitter: { x: Number(em.x) || 0, y: Number(em.y) || 0 },
    emitterVariance: { x: Number(ev.x) || 0, y: Number(ev.y) || 0 },
    startSize: Number(raw.startSize) || 20,
    startSizeVariance: Number(raw.startSizeVariance) || 0,
    endSize: Number(raw.endSize) || 20,
    endSizeVariance: Number(raw.endSizeVariance) || 0,
    startAlpha: Number(raw.startAlpha) || 1,
    endAlpha: Number(raw.endAlpha) || 0,
    startRotation: Number(raw.startRotation) || 0,
    startRotationVariance: Number(raw.startRotationVariance) || 0,
    endRotation: Number(raw.endRotation) || 0,
    endRotationVariance: Number(raw.endRotationVariance) || 0,
  }
}

/**
 * Egret GravityParticleSystem：
 *   scale = startSize / texture.textureWidth
 *   绘制宽高 = textureW*scale × textureH*scale
 * → 显示宽 = startSize；shine 95×512 + 60 → **60×323**
 */
function applyPsSize(
  sprite: Sprite,
  size: number,
  texW: number,
  texH: number,
) {
  const w = Math.max(0.1, size)
  sprite.width = w
  sprite.height = w * (texH / Math.max(1, texW))
}

function tickSparks(layer: Layer, dtMs: number) {
  const dt = dtMs / 1000
  for (const em of layer.sparks.values()) {
    if (!em.alive) continue
    em.accMs += dtMs
    const cfg = em.cfg
    // 正版 emissionRate = lifespan / maxParticles（ms）
    const spawnEvery = Math.max(16, cfg.lifespan / Math.max(1, cfg.maxParticles))
    let tries = 0
    while (
      em.accMs >= spawnEvery &&
      em.particles.length < cfg.maxParticles &&
      tries++ < 8
    ) {
      em.accMs -= spawnEvery
      // lifespan+variance 可为负：spawn 内部丢弃，与正版一致
      spawnPsParticle(em)
    }
    for (let i = em.particles.length - 1; i >= 0; i--) {
      const p = em.particles[i]!
      p.life -= dtMs
      if (p.life <= 0) {
        em.root.removeChild(p.sprite)
        p.sprite.destroy()
        em.particles.splice(i, 1)
        continue
      }
      // advanceParticle：先 dt/=1000，再 v+=g*dt、pos+=v*dt
      p.vx += cfg.gravity.x * dt
      p.vy += cfg.gravity.y * dt
      p.sprite.x += p.vx * dt
      p.sprite.y += p.vy * dt
      p.sprite.rotation += p.rotSpeed * dt
      const t = 1 - p.life / p.maxLife
      const size = p.startSize + (p.endSize - p.startSize) * t
      applyPsSize(p.sprite, size, p.texW, p.texH)
      p.sprite.alpha = Math.max(
        0,
        Math.min(1, cfg.startAlpha + (cfg.endAlpha - cfg.startAlpha) * t),
      )
    }
  }
}

function spawnPsParticle(em: PsEmitter) {
  const cfg = em.cfg
  // 正版：lifespan+variance 可为负 → 直接丢弃，勿钳成短命粒子（会变密变丑）
  const life = randRange(cfg.lifespan, cfg.lifespanVariance)
  if (life <= 0) return
  // speed=0 → 初速为 0（正版仍算 angle，但 speed 为 0）
  const angDeg = randRange(cfg.emitAngle, cfg.emitAngleVariance)
  const ang = (angDeg * Math.PI) / 180
  const spd = Math.max(0, randRange(cfg.speed, cfg.speedVariance))
  // 正版：startSize < 0.1 时钳成 0.1
  let startSize = randRange(cfg.startSize, cfg.startSizeVariance)
  if (startSize < 0.1) startSize = 0.1
  let endSize = randRange(cfg.endSize, cfg.endSizeVariance)
  if (endSize < 0.1) endSize = 0.1
  const startRot = randRange(cfg.startRotation, cfg.startRotationVariance)
  const endRot = randRange(cfg.endRotation, cfg.endRotationVariance)
  const texW = em.tex.orig?.width ?? em.tex.width
  const texH = em.tex.orig?.height ?? em.tex.height
  const sprite = new Sprite(em.tex)
  sprite.anchor.set(0.5)
  // 正版：单粒子 NORMAL；系统 DisplayObject.blendMode=ADD（由 host CSS plus-lighter 承担）
  sprite.blendMode = BLEND_MODES.NORMAL
  // 正版：x = emitterX + variance*(rand*2-1)
  sprite.x = randRange(cfg.emitter.x, cfg.emitterVariance.x)
  sprite.y = randRange(cfg.emitter.y, cfg.emitterVariance.y)
  sprite.rotation = (startRot * Math.PI) / 180
  applyPsSize(sprite, startSize, texW, texH)
  sprite.alpha = Math.min(1, Math.max(0, cfg.startAlpha))
  em.root.addChild(sprite)
  em.particles.push({
    sprite,
    vx: Math.cos(ang) * spd,
    vy: Math.sin(ang) * spd,
    life,
    maxLife: life,
    startSize,
    endSize,
    rotSpeed:
      (((endRot - startRot) * Math.PI) / 180) / Math.max(0.05, life / 1000),
    texW,
    texH,
  })
}

function ensureClock() {
  if (clockStarted) return
  clockStarted = true
  Ticker.shared.add(() => {
    const dt = Ticker.shared.deltaMS
    PixiFactory.advanceTime(dt / 1000)
    for (const layer of layers.values()) tickSparks(layer, dt)
  })
}

async function loadNamedPs(key: string, pngUrl: string, jsonUrl: string) {
  if (psAssets.has(key)) return psAssets.get(key)!
  const [texRaw, cfgText] = await Promise.all([
    Assets.load(pngUrl),
    fetch(jsonUrl).then((r) => {
      if (!r.ok) throw new Error(`ps json ${jsonUrl} ${r.status}`)
      return r.json()
    }),
  ])
  const tex = texRaw instanceof Texture ? texRaw : Texture.from(texRaw as never)
  // 正版粒子贴图为非预乘软边 alpha；勿按预乘解读，否则竖条发硬
  if (tex.baseTexture) {
    tex.baseTexture.alphaMode = ALPHA_MODES.NPM
    tex.baseTexture.scaleMode = SCALE_MODES.LINEAR
  }
  const named = { tex, cfg: parsePsCfg(cfgText) }
  psAssets.set(key, named)
  return named
}

async function ensurePsAssets() {
  await Promise.all([
    loadNamedPs(
      'thunderSpark',
      dbUrl('yben_lv2_thunder_spark.png'),
      dbUrl('yben_lv2_thunder_spark.json'),
    ),
    loadNamedPs(
      'amountShine',
      fxPsUrl('yben_vfx_number_shine.png'),
      fxPsUrl('yben_vfx_number_shine.json'),
    ),
    loadNamedPs(
      'amountDot',
      fxPsUrl('yben_vfx_number_dot.png'),
      fxPsUrl('yben_vfx_number_dot.json'),
    ),
    loadNamedPs(
      'rewardPaper1',
      fxPsUrl('yben_vfx_reward_paper_1.png'),
      fxPsUrl('yben_vfx_reward_paper_1.json'),
    ),
    loadNamedPs(
      'rewardPaper2',
      fxPsUrl('yben_vfx_reward_paper_2.png'),
      fxPsUrl('yben_vfx_reward_paper_2.json'),
    ),
  ])
}

function startNamedPs(
  layer: Layer,
  slotKey: string,
  assetKey: string,
  x: number,
  y: number,
  behind = false,
) {
  stopSpark(layer, slotKey)
  const asset = psAssets.get(assetKey)
  if (!asset) return
  const root = new Container()
  root.x = x
  root.y = y
  if (behind) layer.app.stage.addChildAt(root, 0)
  else layer.app.stage.addChild(root)
  const em: PsEmitter = {
    root,
    particles: [],
    alive: true,
    accMs: 0,
    cfg: asset.cfg,
    tex: asset.tex,
  }
  layer.sparks.set(slotKey, em)
  // 金额/彩纸：正版从空发射器按 emissionRate 冒出，勿首帧 burst
  if (assetKey.startsWith('amount') || assetKey.startsWith('rewardPaper')) {
    return
  }
  const burst = Math.min(4, asset.cfg.maxParticles)
  for (let i = 0; i < burst; i++) spawnPsParticle(em)
}

function stopSpark(layer: Layer, slotKey: string) {
  const em = layer.sparks.get(slotKey)
  if (!em) return
  em.alive = false
  for (const p of em.particles) {
    em.root.removeChild(p.sprite)
    p.sprite.destroy()
  }
  em.particles.length = 0
  em.root.parent?.removeChild(em.root)
  em.root.destroy({ children: true })
  layer.sparks.delete(slotKey)
}

function startSpark(layer: Layer, slotKey: string, x: number, y: number) {
  startNamedPs(layer, slotKey, 'thunderSpark', x, y, false)
}

async function ensureFactory(): Promise<boolean> {
  if (factoryReady) return factoryReady
  factoryReady = (async () => {
    try {
      const factory = PixiFactory.factory
      ensureClock()
      for (const pack of PACKS) {
        if (loadedPacks.has(pack.dbName)) continue
        const [skeText, texText, tex] = await Promise.all([
          fetch(dbUrl(pack.ske)).then((r) => {
            if (!r.ok) throw new Error(`ske ${pack.ske} ${r.status}`)
            return r.text()
          }),
          fetch(dbUrl(pack.tex)).then((r) => {
            if (!r.ok) throw new Error(`tex ${pack.tex} ${r.status}`)
            return r.text()
          }),
          Assets.load(dbUrl(pack.png)),
        ])
        const base = 'baseTexture' in tex ? tex.baseTexture : tex
        factory.parseDragonBonesData(JSON.parse(skeText), pack.dbName)
        factory.parseTextureAtlasData(JSON.parse(texText), base, pack.dbName)
        loadedPacks.add(pack.dbName)
      }
      await ensurePsAssets()
      factoryOk = true
      return true
    } catch (e) {
      console.warn('[bcbm] DragonBones load failed, keep CSS FX', e)
      factoryOk = false
      factoryReady = null
      return false
    }
  })()
  return factoryReady
}

function resolveHost(layerKey: string, host: HTMLElement | null): HTMLElement | null {
  if (host) return host
  const id = HOST_IDS[layerKey]
  return id ? document.getElementById(id) : null
}

function forceAdditive(root: Container) {
  const stack: Container[] = [root]
  while (stack.length) {
    const node = stack.pop()!
    const anyNode = node as Container & { blendMode?: BLEND_MODES }
    if (typeof anyNode.blendMode !== 'undefined') {
      // 正版 slot 多为 add；黑底发光贴图用 ADD 才正确
      if (anyNode.blendMode === BLEND_MODES.NORMAL) {
        anyNode.blendMode = BLEND_MODES.ADD
      }
    }
    for (const child of node.children) {
      stack.push(child as Container)
    }
  }
}

function ensureLayer(
  key: string,
  host: HTMLElement,
  width: number,
  height: number,
): Layer | null {
  const existing = layers.get(key)
  if (existing) {
    if (existing.host !== host) {
      for (const sk of [...(existing.sparks?.keys() ?? [])]) {
        stopSpark(existing, sk)
      }
      existing.app.destroy(true)
      layers.delete(key)
    } else {
      if (!existing.sparks) existing.sparks = new Map()
      existing.app.renderer.resize(width, height)
      return existing
    }
  }
  const app = new Application({
    width,
    height,
    backgroundAlpha: 0,
    antialias: true,
    // 金额/彩纸粒子用 1x，避免 DPR 放大后发糊发散
    resolution:
      key === 'amountGlow' || key === 'paper'
        ? 1
        : Math.min(window.devicePixelRatio || 1, 2),
    autoDensity: true,
    clearBeforeRender: true,
  })
  const view = app.view as HTMLCanvasElement
  view.style.width = '100%'
  view.style.height = '100%'
  view.style.pointerEvents = 'none'
  // 金额/彩纸 ADD 只挂在 host CSS（勿 canvas+host 双重 plus-lighter）
  if (key !== 'amountGlow' && key !== 'paper') {
    view.style.mixBlendMode = 'plus-lighter'
  }
  host.replaceChildren(view)
  const layer: Layer = {
    app,
    host,
    displays: new Map(),
    sparks: new Map(),
  }
  layers.set(key, layer)
  return layer
}

function getPack(id: BcbmDbPackId): PackSpec {
  const pack = PACKS.find((p) => p.id === id)
  if (!pack) throw new Error(`unknown pack ${id}`)
  return pack
}

function stopDisplay(display: PixiArmatureDisplay | undefined) {
  if (!display) return
  display.animation.stop()
  display.visible = false
  display.parent?.removeChild(display)
}

/**
 * 在指定挂载点播放官方 armature。
 * coords 为 480 设计稿坐标（相对挂载层左上角）。
 */
export async function playBcbmDbArmature(opts: {
  layerKey: string
  host?: HTMLElement | null
  packId: BcbmDbPackId
  animation: string
  /** playTimes: 0=loop；正版 thunder 用 99 */
  playTimes?: number
  x: number
  y: number
  scale?: number
  /** Egret display.rotation（度，y 向下顺时针）；Pixi 同向用弧度 */
  rotationDeg?: number
  /** PrizeLv 电弧配套 ADD 火花 */
  withSpark?: boolean
  stageW?: number
  stageH?: number
  slotKey?: string
}): Promise<boolean> {
  const host = resolveHost(opts.layerKey, opts.host ?? null)
  if (!host) {
    console.warn('[bcbm] DB host missing', opts.layerKey)
    return false
  }
  const ok = await ensureFactory()
  if (!ok) return false

  const stageW = opts.stageW ?? 480
  const stageH = opts.stageH ?? 853
  const layer = ensureLayer(opts.layerKey, host, stageW, stageH)
  if (!layer) return false

  const pack = getPack(opts.packId)
  const slot = opts.slotKey ?? opts.packId
  let display = layer.displays.get(slot)
  if (!display) {
    display =
      PixiFactory.factory.buildArmatureDisplay(pack.armature, {
        dragonBonesName: pack.dbName,
      }) ?? undefined
    if (!display) {
      console.warn('[bcbm] buildArmatureDisplay failed', pack.dbName)
      return false
    }
    layer.displays.set(slot, display)
  }

  if (opts.layerKey === 'speed') {
    for (const [k, d] of layer.displays) {
      if (k !== slot) stopDisplay(d)
    }
  }

  if (!display.parent) layer.app.stage.addChild(display)
  display.visible = true
  display.x = opts.x
  display.y = opts.y
  const sc = opts.scale ?? 1
  display.scale.set(sc, sc)
  display.rotation =
    typeof opts.rotationDeg === 'number'
      ? (opts.rotationDeg * Math.PI) / 180
      : 0
  display.animation.play(opts.animation, opts.playTimes ?? 0)
  // 速度线 / 电弧 / 金额闪光 几乎全是 ADD 槽
  if (
    opts.layerKey === 'speed' ||
    opts.packId === 'thunder' ||
    opts.packId === 'number'
  ) {
    forceAdditive(display)
  }

  if (opts.withSpark) {
    startSpark(layer, slot, opts.x, opts.y)
  } else {
    stopSpark(layer, slot)
  }
  return true
}

export async function stopBcbmDbLayer(layerKey: string) {
  const layer = layers.get(layerKey)
  if (!layer) return
  for (const d of layer.displays.values()) stopDisplay(d)
  for (const key of [...layer.sparks.keys()]) stopSpark(layer, key)
}

export async function stopBcbmDbSlot(layerKey: string, slotKey: string) {
  const layer = layers.get(layerKey)
  if (!layer) return
  stopDisplay(layer.displays.get(slotKey))
  stopSpark(layer, slotKey)
}

/**
 * 官方 PrizeLv amountShinePs + amountDotPs：
 * 坐标 (W/2, payoutAmountTextCenterY=460)，ADD，插在金额文字下。
 * shine：竖条贴图粒子，横向散布 ±160，speed=0，重力上浮。
 * dot：圆光粒子，横向 ±120。
 */
export async function startBcbmAmountGlow(opts?: {
  layerKey?: string
  x?: number
  y?: number
  stageW?: number
  stageH?: number
}): Promise<boolean> {
  const layerKey = opts?.layerKey ?? 'amountGlow'
  const host = resolveHost(layerKey, null)
  if (!host) {
    console.warn('[bcbm] amount glow host missing')
    return false
  }
  try {
    ensureClock()
    await ensurePsAssets()
  } catch (e) {
    console.warn('[bcbm] amount glow assets failed', e)
    return false
  }
  const stageW = opts?.stageW ?? 480
  const stageH = opts?.stageH ?? 640
  // 每次重建，清掉旧 DPR/混合模式残留
  const old = layers.get(layerKey)
  if (old) {
    for (const sk of [...old.sparks.keys()]) stopSpark(old, sk)
    old.app.destroy(true)
    layers.delete(layerKey)
  }
  const layer = ensureLayer(layerKey, host, stageW, stageH)
  if (!layer) return false
  // ADD：仅 host `.fx-amount-glow-host { mix-blend-mode: plus-lighter }`
  const x = opts?.x ?? stageW / 2
  // 正版：文字 y=400，粒子 y=460
  const y = opts?.y ?? 460
  startNamedPs(layer, 'amount-shine', 'amountShine', x, y, false)
  startNamedPs(layer, 'amount-dot', 'amountDot', x, y, false)
  return true
}

export function stopBcbmAmountGlow(layerKey = 'amountGlow') {
  const layer = layers.get(layerKey)
  if (!layer) return
  stopSpark(layer, 'amount-shine')
  stopSpark(layer, 'amount-dot')
}

/**
 * 官方 PrizeLv4：rewardPaperPs1/2
 * - JSON emitter (240,0) ±240，gravity (0,110) 下落
 * - 挂在 betBoardPanel+1（#bcbm-paper-fx-host），系统 blendMode=ADD
 */
export async function startBcbmRewardPaper(opts?: {
  layerKey?: string
  stageW?: number
  stageH?: number
}): Promise<boolean> {
  const layerKey = opts?.layerKey ?? 'paper'
  const host = resolveHost(layerKey, null)
  if (!host) {
    console.warn('[bcbm] reward paper host missing')
    return false
  }
  try {
    ensureClock()
    await ensurePsAssets()
  } catch (e) {
    console.warn('[bcbm] reward paper assets failed', e)
    return false
  }
  const stageW = opts?.stageW ?? 480
  const stageH = opts?.stageH ?? 820
  const old = layers.get(layerKey)
  if (old) {
    for (const sk of [...old.sparks.keys()]) stopSpark(old, sk)
    old.app.destroy(true)
    layers.delete(layerKey)
  }
  const layer = ensureLayer(layerKey, host, stageW, stageH)
  if (!layer) return false
  // 系统原点 (0,0)；粒子用 JSON emitter (240,0)
  startNamedPs(layer, 'paper-1', 'rewardPaper1', 0, 0, false)
  startNamedPs(layer, 'paper-2', 'rewardPaper2', 0, 0, false)
  return true
}

export function stopBcbmRewardPaper(layerKey = 'paper') {
  const layer = layers.get(layerKey)
  if (!layer) return
  stopSpark(layer, 'paper-1')
  stopSpark(layer, 'paper-2')
}

export function isBcbmDbReady() {
  return factoryOk
}

export function preloadBcbmDragonBones() {
  return ensureFactory()
}

export function destroyBcbmDragonBones() {
  for (const layer of layers.values()) {
    for (const key of [...layer.sparks.keys()]) stopSpark(layer, key)
    layer.app.destroy(true)
  }
  layers.clear()
  factoryReady = null
  factoryOk = false
  loadedPacks.clear()
  psAssets.clear()
}
