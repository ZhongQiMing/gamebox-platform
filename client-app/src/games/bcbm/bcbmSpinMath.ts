/**
 * PC_Benz SpinPanelV2 / PC_SpinPanelV2 官方透视旋转
 * 来源：benz2221.min.js（非猜测）
 */
export const BCBM_POSITION_NUM = 24
/** 手机 SpinPanelV2.RADIUS（PC 为 300；V66 H5 用手机版） */
export const BCBM_RADIUS = 180
export const BCBM_FOCAL = 100
/**
 * 下列速度参数按官方 Egret enter_frame（约 30fps）「每逻辑帧」标定。
 * 渲染层必须用 30fps 定步 tick（见 BcbmSpinRing），勿按 60fps rAF 每帧推进。
 */
export const BCBM_MAX_SPEED = 20
export const BCBM_STOP_ACCEL = -0.5

/** WHEEL[carPos] → playType（0..11） */
export const BCBM_WHEEL_PLAYTYPE: readonly number[] = [
  11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1, 0,
  11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1, 0,
]

/**
 * carPos → skin carN 索引（iconList）
 * 官方：iconMap=[11,10,...,0, 23,22,...,12]
 */
export const BCBM_ICON_MAP: readonly number[] = [
  11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1, 0,
  23, 22, 21, 20, 19, 18, 17, 16, 15, 14, 13, 12,
]

export const BCBM_PLAYTYPE_META: Record<
  number,
  { brand: string; color: string; mult: number; betId: string }
> = {
  0: { brand: 'volkswagen', color: 'yellow', mult: 4, betId: 'vw_yellow' },
  1: { brand: 'volkswagen', color: 'green', mult: 5, betId: 'vw_green' },
  2: { brand: 'volkswagen', color: 'red', mult: 7, betId: 'vw_red' },
  3: { brand: 'audi', color: 'yellow', mult: 6, betId: 'audi_yellow' },
  4: { brand: 'audi', color: 'green', mult: 10, betId: 'audi_green' },
  5: { brand: 'audi', color: 'red', mult: 12, betId: 'audi_red' },
  6: { brand: 'bmw', color: 'yellow', mult: 13, betId: 'bmw_yellow' },
  7: { brand: 'bmw', color: 'green', mult: 16, betId: 'bmw_green' },
  8: { brand: 'bmw', color: 'red', mult: 22, betId: 'bmw_red' },
  9: { brand: 'benz', color: 'yellow', mult: 27, betId: 'benz_yellow' },
  10: { brand: 'benz', color: 'green', mult: 38, betId: 'benz_green' },
  11: { brand: 'benz', color: 'red', mult: 45, betId: 'benz_red' },
}

export type CircleProps = {
  zDistance: number
  tiltAngle: number
  circleYScale: number
  iconMaxScale: number
}

/** 手机 Idle（与 PC Idle 相同） */
export const IDLE_PROPS: CircleProps = {
  zDistance: 100,
  tiltAngle: -1,
  circleYScale: 0.4,
  iconMaxScale: 0.4,
}

/** 手机 StartSpin（基类 applyToStartSpinProps） */
export const SPIN_PROPS: CircleProps = {
  zDistance: 100,
  tiltAngle: -15,
  circleYScale: 0.3,
  iconMaxScale: 0.6,
}

export type IconPose = {
  x: number
  y: number
  scale: number
  angle: number
  zIndex: number
}

function multiply(a: number[][], b: number[][]): number[][] {
  const r: number[][] = [[0], [0], [0]]
  for (let i = 0; i < 3; i++) {
    let s = 0
    for (let k = 0; k < 4; k++) s += (a[i][k] ?? 0) * (b[k]?.[0] ?? 0)
    r[i][0] = s
  }
  return r
}

/** 官方 get_coordinate_in_2d */
export function project2d(
  x: number,
  y: number,
  tiltDeg: number,
  zDistance: number,
  focal = BCBM_FOCAL,
): [number, number] {
  const phi = (tiltDeg * Math.PI) / 180
  const transformer = [
    [focal, 0, 0, 0],
    [0, focal, 0, 0],
    [0, 0, 1, 0],
  ]
  const vec = [[x], [y * Math.cos(phi)], [zDistance + y * Math.sin(phi)], [1]]
  const o = multiply(transformer, vec)
  return [o[0][0] / o[2][0], o[1][0] / o[2][0]]
}

/** angles 按 skin car0..car23 索引 */
export function computePoses(angles: number[], props: CircleProps): IconPose[] {
  const step = 360 / BCBM_POSITION_NUM
  const frontMin = 90 - step / 2
  const frontMax = 90 + step / 2
  const backMin = 270 - step / 2
  const backMax = 270 + step / 2
  /** 手机 spin 图标 112×112 */
  const halfIcon = 56

  return angles.map((angle) => {
    let a = angle % 360
    if (a < 0) a += 360
    const cx = BCBM_RADIUS * Math.cos((a * Math.PI) / 180)
    const cy = BCBM_RADIUS * Math.sin((a * Math.PI) / 180)
    const [px, py] = project2d(cx, cy, props.tiltAngle, props.zDistance)
    // 官方：scale 用未乘 circleYScale 的投影差 hypot(dx, dy)
    const [px2, py2] = project2d(cx + halfIcon, cy, props.tiltAngle, props.zDistance)
    const scale =
      (Math.hypot(px - px2, py - py2) / halfIcon) * props.iconMaxScale
    const y = py * props.circleYScale
    let zIndex: number
    if (a > frontMin && a < frontMax) zIndex = 23
    else if (a > backMin && a < backMax) zIndex = 0
    else if (a > 0 && a < 180) zIndex = 18
    else zIndex = 6
    return { x: px, y, scale: Math.max(0.12, scale), angle: a, zIndex }
  })
}

export function initialAngles(): number[] {
  const step = 360 / BCBM_POSITION_NUM
  return Array.from({ length: BCBM_POSITION_NUM }, (_, i) => {
    let o = 90 - i * step
    if (o < 0) o += 360
    return o
  })
}

/** skin carN 图标（与 SpinPanelV2Skin 一致） */
export function spinIconUrl(iconIndex: number): string {
  const pt = ((iconIndex % 12) + 12) % 12
  const m = BCBM_PLAYTYPE_META[pt]
  return `/images/games/bcbm/benz/spin/yben_icon_large_${m.brand}_${m.color}.png`
}

export function iconIndexOfCarPos(carPos: number): number {
  return BCBM_ICON_MAP[((carPos % 24) + 24) % 24]
}

export function carPosCandidatesForPlayType(playType: number): number[] {
  const out: number[] = []
  for (let i = 0; i < 24; i++) {
    if (BCBM_WHEEL_PLAYTYPE[i] === playType) out.push(i)
  }
  return out
}

export type SpinStatus =
  | 'idle'
  | 'transform_spin'
  | 'transform_idle'
  | 'starting'
  | 'spinning'
  | 'stopping'
  | 'stopped'

export class BcbmSpinEngine {
  angles = initialAngles()
  props: CircleProps = { ...IDLE_PROPS }
  private from: CircleProps = { ...IDLE_PROPS }
  private to: CircleProps = { ...IDLE_PROPS }
  private plus: CircleProps = { zDistance: 0, tiltAngle: 0, circleYScale: 0, iconMaxScale: 0 }
  private morphLeft = 0
  angleSpeed = 0
  angleAccelarate = 0
  status: SpinStatus = 'idle'
  targetPos = -1
  canStopSpinningNow = true
  private stoppingStage: 'adjust' | 'after' | 'slow' | 'done' = 'done'
  private angleToSlow = 90
  private idleResolve: (() => void) | null = null

  constructor() {
    let e = BCBM_MAX_SPEED
    let t = 0
    while (e > 0) {
      t += e
      e += BCBM_STOP_ACCEL
    }
    this.angleToSlow = 90 - (t % 360)
  }

  poses(): IconPose[] {
    return computePoses(this.angles, this.props)
  }

  private setPlus(frames: number) {
    this.plus = {
      zDistance: (this.to.zDistance - this.from.zDistance) / frames,
      tiltAngle: (this.to.tiltAngle - this.from.tiltAngle) / frames,
      circleYScale: (this.to.circleYScale - this.from.circleYScale) / frames,
      iconMaxScale: (this.to.iconMaxScale - this.from.iconMaxScale) / frames,
    }
    this.morphLeft = frames
  }

  private applyMorphStep() {
    if (this.morphLeft <= 0) return
    this.from.zDistance += this.plus.zDistance
    this.from.tiltAngle += this.plus.tiltAngle
    this.from.circleYScale += this.plus.circleYScale
    this.from.iconMaxScale += this.plus.iconMaxScale
    this.props = { ...this.from }
    this.morphLeft--
  }

  /** 官方 transformToAndStartSpin：不重置角度 */
  transformToSpin() {
    this.angleAccelarate = 0
    this.angleSpeed = 0
    this.from = { ...this.props }
    this.to = { ...SPIN_PROPS }
    this.setPlus(12)
    this.status = 'transform_spin'
  }

  /** 官方 transformToIdel：停轮/派彩后回到 Idle 透视 */
  transformToIdle(): Promise<void> {
    if (this.status === 'idle') {
      this.props = { ...IDLE_PROPS }
      this.from = { ...IDLE_PROPS }
      return Promise.resolve()
    }
    if (this.status === 'transform_idle') {
      return new Promise((r) => {
        const prev = this.idleResolve
        this.idleResolve = () => {
          prev?.()
          r()
        }
      })
    }
    this.angleAccelarate = 0
    this.angleSpeed = 0
    this.from = { ...this.props }
    this.to = { ...IDLE_PROPS }
    this.setPlus(12)
    this.status = 'transform_idle'
    return new Promise((r) => {
      this.idleResolve = r
    })
  }

  startSpin() {
    this.angleAccelarate = 0.2
    this.angleSpeed = -5
    this.status = 'starting'
  }

  setTarget(carPos: number) {
    if (carPos < 0) {
      this.targetPos = -1
      return
    }
    this.targetPos = ((carPos % 24) + 24) % 24
  }

  delayStop(ms: number) {
    this.canStopSpinningNow = false
    window.setTimeout(() => {
      this.canStopSpinningNow = true
    }, ms)
  }

  private angleDiff(a: number, b: number) {
    let i = Math.abs(a - b) % 360
    i = i > 180 ? 360 - i : i
    const sign =
      (a - b >= 0 && a - b <= 180) || (a - b <= -180 && a - b >= -360) ? 1 : -1
    return i * sign
  }

  private targetIconAngle() {
    return this.angles[iconIndexOfCarPos(this.targetPos)]
  }

  tick(): IconPose[] {
    switch (this.status) {
      case 'idle':
      case 'stopped':
        break
      case 'transform_spin':
        this.applyMorphStep()
        if (Math.abs(this.to.tiltAngle - this.from.tiltAngle) < 0.1 || this.morphLeft <= 0) {
          this.props = { ...SPIN_PROPS }
          this.from = { ...SPIN_PROPS }
          this.startSpin()
        }
        break
      case 'transform_idle':
        this.applyMorphStep()
        if (Math.abs(this.to.tiltAngle - this.from.tiltAngle) < 0.1 || this.morphLeft <= 0) {
          this.props = { ...IDLE_PROPS }
          this.from = { ...IDLE_PROPS }
          this.targetPos = -1
          this.status = 'idle'
          this.idleResolve?.()
          this.idleResolve = null
        }
        break
      case 'starting':
        if (this.angleSpeed < BCBM_MAX_SPEED) this.angleAccelarate += 0.1
        if (this.angleSpeed >= BCBM_MAX_SPEED) {
          this.angleSpeed = BCBM_MAX_SPEED
          this.angleAccelarate = 0
          this.status = 'spinning'
        }
        break
      case 'spinning':
        if (this.targetPos >= 0 && this.canStopSpinningNow) {
          this.angleAccelarate = 0
          this.angleSpeed = BCBM_MAX_SPEED
          this.stoppingStage = 'adjust'
          this.status = 'stopping'
        }
        break
      case 'stopping':
        switch (this.stoppingStage) {
          case 'adjust': {
            const o = this.angleDiff(this.targetIconAngle(), this.angleToSlow)
            if (o === 0) this.stoppingStage = 'after'
            else if (o > 0 && o <= this.angleSpeed) {
              this.angleSpeed -= o
              this.stoppingStage = 'after'
            }
            break
          }
          case 'after':
            this.angleSpeed = BCBM_MAX_SPEED
            this.angleAccelarate = BCBM_STOP_ACCEL
            this.stoppingStage = 'slow'
            break
          case 'slow':
            if (this.angleSpeed <= 0) {
              const cur = this.targetIconAngle()
              const delta = 90 - cur
              for (let i = 0; i < this.angles.length; i++) {
                let a = this.angles[i] + delta
                a %= 360
                if (a < 0) a += 360
                this.angles[i] = a
              }
              this.angleSpeed = 0
              this.angleAccelarate = 0
              this.status = 'stopped'
              this.stoppingStage = 'done'
            }
            break
          default:
            break
        }
        break
    }

    this.angleSpeed += this.angleAccelarate
    // 官方：Idle / Stopped / Transform 阶段不推进角度（Transform 时 speed=0）
    if (
      this.status !== 'idle' &&
      this.status !== 'stopped' &&
      this.status !== 'transform_spin' &&
      this.status !== 'transform_idle'
    ) {
      for (let i = 0; i < this.angles.length; i++) {
        let l = this.angles[i] + this.angleSpeed
        l %= 360
        if (l < 0) l += 360
        this.angles[i] = l
      }
    }

    return this.poses()
  }

  /** 仅初始化用；开局不要重置角度（官方连局保持当前环位） */
  resetIdle() {
    this.status = 'idle'
    this.targetPos = -1
    this.canStopSpinningNow = true
    this.angleSpeed = 0
    this.angleAccelarate = 0
    this.props = { ...IDLE_PROPS }
    this.from = { ...IDLE_PROPS }
    this.angles = initialAngles()
    this.idleResolve?.()
    this.idleResolve = null
  }
}
