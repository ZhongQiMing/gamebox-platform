/**
 * 水果机特奖 / 跑灯演出（与业务开奖 API 分离）
 * 行为与抽离前 FruitMachineView 内实现保持一致。
 */
import { FRUIT_RING, type FruitAwardType, type FruitBetSymbolId } from '@gamebox/shared'
import type { CenterStageMode } from '@/games/slots/fruitCenterAssets'
import {
  playFruitAnnounce,
  playFruitAwardFanfare,
  playFruitAwardVoice,
  playFruitGo,
  playFruitSfx,
  setFruitBgmDuck,
  stopFruitGo,
} from '@/games/slots/fruitAudio'
import type { FruitRingLights } from '@/games/slots/useFruitRingLights'
import type { Ref } from 'vue'

export type FruitAwardFxDeps = {
  lights: FruitRingLights
  sleep: (ms: number) => Promise<void>
  winScore: Ref<number>
  stageMode: Ref<CenterStageMode>
  centerHitSymbol: Ref<FruitBetSymbolId | 'luck' | null>
  centerHitSize: Ref<'big' | 'small' | 'luck'>
  centerHitKind: Ref<string | null>
  centerHitLabel: Ref<string>
  centerHitOdds: Ref<number>
  centerHitBetUnits: Ref<number>
  clearCenterHit: () => void
  setCenterHit: (cellIndex: number) => void
  enterAwardStage: (awardType: FruitAwardType | 'bar' | 'normal') => void
  startTitleMarquee: () => void
}

export function createFruitAwardFx(deps: FruitAwardFxDeps) {
  const {
    lights,
    sleep,
    winScore,
    stageMode,
    centerHitSymbol,
    centerHitSize: _centerHitSize,
    centerHitKind: _centerHitKind,
    centerHitLabel,
    centerHitOdds: _centerHitOdds,
    centerHitBetUnits: _centerHitBetUnits,
    clearCenterHit,
    setCenterHit,
    enterAwardStage,
    startTitleMarquee,
  } = deps
  void _centerHitSize
  void _centerHitKind
  void _centerHitOdds
  void _centerHitBetUnits

  const {
    cursorIndex,
    hitLit: _hitLit,
    flashAll: _flashAll,
    ringCellEls,
    setCursor,
    clearTrainVisual,
    paintTrain,
    setRingFx,
    clearHitLit,
    addHitLit,
    setHitLitAll,
  } = lights
  void _hitLit
  void _flashAll

  async function flashRing(times = 3, gap = 120) {
    await lights.flashRing(sleep, times, gap)
  }

  async function pulseHitCells(times = 3, gap = 100) {
    await lights.pulseHitCells(sleep, times, gap)
  }

  async function runLightTo(stopIndex: number, minLaps = 2) {
    const n = FRUIT_RING.length
    const start = cursorIndex.value >= 0 ? cursorIndex.value : 0
    const dist = ((stopIndex - start) % n + n) % n
    const totalSteps = minLaps * n + dist
    setFruitBgmDuck(true)
    playFruitGo()
    for (let step = 0; step <= totalSteps; step++) {
      const idx = (start + step) % n
      setCursor(idx)
      const p = step / totalSteps
      if (p > 0.72) playFruitSfx('tick', 0.35)
      let delay = 55
      if (p < 0.15) delay = 110 - p * 300
      else if (p > 0.7) delay = 55 + (p - 0.7) * 280
      else delay = 38
      await sleep(Math.max(28, delay))
    }
    stopFruitGo()
    setCursor(stopIndex)
    playFruitSfx('stop')
    await sleep(220)
  }

  /** 单格报奖：中心立刻切水果图标 + 语音 + 累加赢分 */
  async function announceCell(
    cellIndex: number,
    addWin = 0,
  ): Promise<string> {
    const cell = FRUIT_RING[cellIndex]
    if (!cell?.symbol) return ''
    setCenterHit(cellIndex)
    const size = cell.size === 'big' ? 'big' : 'small'
    const label = `${cell.label} ×${cell.mult}`
    const announceP = playFruitAnnounce(cell.symbol, size)
    if (addWin > 0) {
      winScore.value += addWin
      playFruitSfx('scoreUp', 0.7)
    }
    await announceP
    return label
  }

  /** 天门 / 高倍格：灯效庆祝；一律留在常驻四行算账 */
  async function celebrateHighCell(cellIndex: number) {
    const cell = FRUIT_RING[cellIndex]
    if (!cell?.symbol) return
    const isBar = cell.symbol === 'bar'
    const isHigh = isBar || cell.mult >= 20
    if (!isHigh) return

    setCenterHit(cellIndex)
    stageMode.value = 'idle'
    playFruitSfx(isBar ? 'barWin' : 'jackpot', isBar ? 0.95 : 0.85)
    if (isBar) playFruitSfx('jackpot', 0.7)
    await flashRing(isBar ? 5 : 3, isBar ? 85 : 90)
    await sleep(isBar ? 350 : 200)
  }



  /** 特殊奖标题压场：只停顿，不把中心屏改成好运图/0 算式 */
  async function holdAwardTitle(_label: string, ms = 900) {
    clearCenterHit()
    await sleep(ms)
  }

  /** 赢分瀑布：不播报格语音，只看分数往上冲（大满贯/大四喜用） */
  async function floodWinScore(
    winByCell: Map<number, number>,
    hitIndexes: number[],
  ) {
    const amounts = hitIndexes
      .map((i) => winByCell.get(i) ?? 0)
      .filter((a) => a > 0)
    if (!amounts.length) return
    for (const amt of amounts) {
      const steps = Math.min(5, Math.max(1, Math.ceil(amt / 40)))
      const chunk = Math.ceil(amt / steps)
      let left = amt
      for (let s = 0; s < steps; s++) {
        const add = s === steps - 1 ? left : Math.min(chunk, left)
        winScore.value += add
        left -= add
        playFruitSfx('scoreUp', 0.5 + Math.min(0.35, s * 0.08))
        await sleep(48)
      }
      await sleep(30)
    }
  }

  /** 猛停：只炸当前格，不全圈闪、不抖柜机 */
  async function trainSlamStop(toIndex: number) {
    paintTrain(toIndex, 1)
    setCursor(toIndex)
    const el = ringCellEls[toIndex]
    el?.classList.add('train-slam')
    playFruitSfx('stop', 1)
    playFruitSfx('awardTrain', 0.85)
    playFruitSfx('trainStep', 1)
    await sleep(120)
    el?.classList.add('hit-pulse')
    await sleep(100)
    el?.classList.remove('hit-pulse')
    el?.classList.remove('train-slam')
    await sleep(40)
  }

  /**
   * 开火车：整段车厢（多格）一起甩圈，对准 to 猛停（不是单格跑灯）
   */
  async function runTrainSlamLap(fromIndex: number, toIndex: number) {
    const n = FRUIT_RING.length
    if (n <= 0) return
    let head = fromIndex >= 0 ? fromIndex : 0
    const dist = (((toIndex - head) % n) + n) % n
    // 完整一圈 + 走到下一站；若就在邻格也仍先甩满一圈再撞上
    const totalSteps = n + (dist === 0 ? n : dist)
    // 转圈时收起单格光标，只看整列车身在跑
    setCursor(-1)
    const cars = Math.min(5, Math.max(4, n - 1))
    playFruitGo()
    for (let step = 1; step <= totalSteps; step++) {
      head = (head + 1) % n
      const p = step / totalSteps
      // 4~5 节连成一段一起平移
      paintTrain(head, cars)
      if (step % 3 === 0) playFruitSfx('trainStep', 0.55 + p * 0.35)

      // 更快巡航，末段急刹
      let delay = 14
      if (p < 0.04) delay = 20
      else if (p > 0.9) delay = 28 + (p - 0.9) * 520
      await sleep(Math.max(10, delay))
    }
    stopFruitGo()
    await trainSlamStop(toIndex)
  }

  async function playTrainReveal(
    hitIndexes: number[],
    winByCell: Map<number, number>,
  ) {
    const route = hitIndexes.filter((idx) => !!FRUIT_RING[idx]?.symbol)
    if (!route.length) return

    clearHitLit()
    clearTrainVisual()
    stageMode.value = 'idle'
    setRingFx('train')
    startTitleMarquee()
    centerHitLabel.value = '开火车'
    centerHitSymbol.value = null

    // 1) 先中第一格并报奖（通常就是刚停住的那格）
    const first = route[0]!
    setCursor(first)
    paintTrain(first, 1)
    addHitLit(first)
    setCenterHit(first)
    playFruitSfx('awardTrain', 0.8)
    await sleep(200)
    await announceCell(first, winByCell.get(first) ?? 0)
    await sleep(180)

    // 2) 之后每站：快速转一圈 → 猛停 → 报奖；已中格全程常亮不灭
    let from = first
    for (let i = 1; i < route.length; i++) {
      const stop = route[i]!
      centerHitLabel.value = '开火车'
      await runTrainSlamLap(from, stop)
      addHitLit(stop)
      // 再钉一次整条已中路线，防止任何中间逻辑漏亮
      setHitLitAll(route.slice(0, i + 1))
      setCenterHit(stop)
      await sleep(80)
      await announceCell(stop, winByCell.get(stop) ?? 0)
      await sleep(160)
      from = stop
    }

    // 3) 全部到齐：车头收起，已中格一起闪一阵（闪的是 hit-pulse，不灭 hit）
    clearTrainVisual()
    setHitLitAll(route)
    playFruitSfx('awardTrain', 0.9)
    playFruitSfx('coin', 0.85)
    await pulseHitCells(6, 90)
    await pulseHitCells(4, 100)
    await sleep(280)
  }

  /**
   * 大三元专属：金闪压场后，神秘一格一格揭开报奖
   * —— 不提前亮三格（防剧透）
   */
  async function playBig3Reveal(
    hitIndexes: number[],
    winByCell: Map<number, number>,
  ) {
    clearHitLit()
    stageMode.value = 'idle'
    setRingFx('big3')
    centerHitLabel.value = '大三元'
    playFruitSfx('jackpot', 0.9)
    await flashRing(4, 110)
    await sleep(300)
    setCursor(-1)
    clearHitLit()
    await sleep(180)
    for (let i = 0; i < hitIndexes.length; i++) {
      const idx = hitIndexes[i]!
      addHitLit(idx)
      setCursor(idx)
      setCenterHit(idx)
      playFruitSfx('special', 0.65)
      await sleep(180)
      await announceCell(idx, winByCell.get(idx) ?? 0)
      await pulseHitCells(2, 90)
      await sleep(300)
    }
    setHitLitAll(hitIndexes)
    playFruitSfx('jackpot', 0.85)
    await pulseHitCells(4, 100)
    await sleep(450)
  }

  /**
   * 小三元专属：翠绿柔闪后，错落慢揭（节奏比大三元更轻、更散）
   */
  async function playSmall3Reveal(
    hitIndexes: number[],
    winByCell: Map<number, number>,
  ) {
    clearHitLit()
    stageMode.value = 'idle'
    setRingFx('small3')
    centerHitLabel.value = '小三元'
    await sleep(280)
    await flashRing(3, 130)
    await sleep(240)
    setCursor(-1)
    clearHitLit()
    for (let i = 0; i < hitIndexes.length; i++) {
      const idx = hitIndexes[i]!
      addHitLit(idx)
      setCursor(idx)
      setCenterHit(idx)
      playFruitSfx('special', 0.4)
      await sleep(220 + i * 80)
      await announceCell(idx, winByCell.get(idx) ?? 0)
      await pulseHitCells(1, 110)
      await sleep(340)
    }
    setHitLitAll(hitIndexes)
    await pulseHitCells(3, 120)
    await sleep(380)
  }

  /**
   * 大四喜专属：不提前点苹果格 → 全苹果位同时齐爆 → 对角对闪 → 再逐个报苹果
   * —— 惊喜在“一下子全中”，和三元的神秘逐揭、火车巡航都不一样
   */
  async function playFourReveal(
    hitIndexes: number[],
    winByCell: Map<number, number>,
  ) {
    clearHitLit()
    stageMode.value = 'idle'
    setRingFx('four')
    centerHitLabel.value = '大四喜'
    centerHitSymbol.value = null
    setCursor(-1)

    // 压场：只全圈闪，绝不先亮苹果位
    playFruitSfx('special', 0.65)
    await flashRing(3, 120)
    await sleep(320)

    // 齐爆：所有苹果位同一帧亮起
    setHitLitAll(hitIndexes)
    playFruitSfx('jackpot', 1)
    playFruitSfx('wild', 0.95)
    await pulseHitCells(5, 85)
    await sleep(220)

    // 对角对闪（四喜阵感）：0↔2、1↔3
    if (hitIndexes.length >= 4) {
      for (let r = 0; r < 3; r++) {
        clearHitLit()
        addHitLit(hitIndexes[0]!)
        addHitLit(hitIndexes[2]!)
        playFruitSfx('tick', 0.45)
        await sleep(130)
        clearHitLit()
        addHitLit(hitIndexes[1]!)
        addHitLit(hitIndexes[3]!)
        playFruitSfx('tick', 0.45)
        await sleep(130)
      }
      setHitLitAll(hitIndexes)
      playFruitSfx('jackpot', 0.85)
      await pulseHitCells(3, 90)
      await sleep(200)
    }

    // 齐爆之后再逐个报苹果（中心切苹果图标+语音）
    for (const idx of hitIndexes) {
      setCursor(idx)
      setCenterHit(idx)
      playFruitSfx('special', 0.45)
      await sleep(120)
      await announceCell(idx, winByCell.get(idx) ?? 0)
      await sleep(200)
    }

    setHitLitAll(hitIndexes)
    centerHitLabel.value = '大四喜'
    playFruitSfx('coin', 0.9)
    playFruitSfx('jackpot', 0.8)
    await pulseHitCells(4, 95)
    await sleep(400)
  }

  /** 大满贯：隔一亮一（phase 0/1），按环序点亮 */
  function paintSlamEveryOther(hitIndexes: number[], phase: number) {
    clearHitLit()
    for (let i = 0; i < hitIndexes.length; i++) {
      if ((i + phase) % 2 === 0) addHitLit(hitIndexes[i]!)
    }
  }

  /**
   * 大满贯（贴近正版印象）：
   * 全部亮起 → 间隔一个亮一个 → 隔灯绕圈转 → 再逐个点亮 → 齐闪 + 分数
   * 不抖柜机、不逐格报奖语音
   */
  async function playSlamReveal(
    hitIndexes: number[],
    winByCell: Map<number, number>,
    _stopIndex: number,
  ) {
    clearHitLit()
    stageMode.value = 'idle'
    setRingFx('slam')
    startTitleMarquee()
    centerHitLabel.value = '大满贯'
    centerHitSymbol.value = null
    setCursor(-1)

    // 1) 全部亮起
    playFruitSfx('awardSlam', 0.95)
    playFruitSfx('jackpot', 1)
    setHitLitAll(hitIndexes)
    await sleep(550)
    await pulseHitCells(3, 100)
    await sleep(220)

    // 2) 间隔一个亮一个（奇偶对闪几下）
    playFruitSfx('special', 0.75)
    for (let k = 0; k < 6; k++) {
      paintSlamEveryOther(hitIndexes, k % 2)
      playFruitSfx('tick', 0.45)
      await sleep(140)
    }

    // 3) 隔灯图案绕圈转（相位一路递进，看起来在转）
    playFruitSfx('awardSlam', 0.7)
    playFruitGo()
    const spinSteps = hitIndexes.length * 2
    for (let step = 0; step < spinSteps; step++) {
      paintSlamEveryOther(hitIndexes, step % 2)
      // 用短拖尾感：相位按步推进时再强调当前“前沿”
      const tip = hitIndexes[step % hitIndexes.length]
      if (tip != null) setCursor(tip)
      if (step % 2 === 0) playFruitSfx('trainStep', 0.4 + Math.min(0.35, step * 0.01))
      const p = step / spinSteps
      let delay = 70
      if (p < 0.15) delay = 95
      else if (p > 0.75) delay = 55
      else delay = 48
      await sleep(delay)
    }
    stopFruitGo()
    setCursor(-1)

    // 4) 绕完圈后：熄掉再逐个点亮一圈
    clearHitLit()
    await sleep(180)
    playFruitSfx('awardSlam', 0.75)
    for (let i = 0; i < hitIndexes.length; i++) {
      const idx = hitIndexes[i]!
      addHitLit(idx)
      setCursor(idx)
      playFruitSfx('tick', 0.4 + Math.min(0.4, i * 0.02))
      await sleep(48)
    }
    setCursor(-1)

    // 5) 全亮后再闪一阵 + 分数狂飙
    setHitLitAll(hitIndexes)
    playFruitSfx('jackpot', 1)
    playFruitSfx('coin', 1)
    await pulseHitCells(6, 85)
    await pulseHitCells(4, 95)
    const floodP = floodWinScore(winByCell, hitIndexes)
    await pulseHitCells(4, 80)
    await floodP

    // 6) 终章再闪
    setHitLitAll(hitIndexes)
    centerHitLabel.value = '大满贯'
    playFruitSfx('win', 0.95)
    playFruitSfx('jackpot', 1)
    await pulseHitCells(5, 90)
    await sleep(600)
  }

  /**
   * 送灯专属：紫粉光从停点追到各目标格，送到再报
   */
  async function playLuckSendRuns(
    hitIndexes: number[],
    winByCell: Map<number, number>,
  ) {
    clearHitLit()
    stageMode.value = 'idle'
    setRingFx('send')
    // 送灯不改中心屏标题；只在送到具体水果格时用 announceCell 算账
    await sleep(300)
    for (let i = 0; i < hitIndexes.length; i++) {
      const idx = hitIndexes[i]!
      await runLightTo(idx, i === 0 ? 1 : 0)
      addHitLit(idx)
      playFruitSfx('wild', 0.65)
      await sleep(160)
      await announceCell(idx, winByCell.get(idx) ?? 0)
      await pulseHitCells(2, 90)
      await sleep(240)
    }
    await pulseHitCells(4, 100)
    await sleep(360)
  }

  async function revealHits(
    awardType: FruitAwardType,
    stopIndex: number,
    hitIndexes: number[],
    wins: Array<{ cellIndex: number; amount: number }>,
  ) {
    const winByCell = new Map(wins.map((w) => [w.cellIndex, w.amount]))
    const stoppedOnLuck = FRUIT_RING[stopIndex]?.size === 'luck'
    const isSend =
      awardType === 'luck_send' || (stoppedOnLuck && hitIndexes.length > 0 && awardType !== 'luck_eat')
    const special = awardType !== 'normal' || isSend

    clearHitLit()
    setRingFx('none')
    stageMode.value = 'idle'

    // —— 吃灯：只动环灯+语音，中心屏不变（无送到的图案可显示）——
    if (awardType === 'luck_eat') {
      setRingFx('eat')
      setCursor(stopIndex)
      clearCenterHit()
      await sleep(500)
      await flashRing(3, 150)
      enterAwardStage('luck_eat')
      await playFruitAwardVoice('goodluck')
      playFruitAwardFanfare('luck_eat')
      await playFruitAwardVoice('luck_eat')
      await flashRing(4, 160)
      clearHitLit()
      setCursor(-1)
      await sleep(700)
      setRingFx('none')
      setFruitBgmDuck(false)
      return
    }

    // —— 送灯：环灯 + 语音；中心屏不切好运/算式，只在送到的水果格上算账 ——
    if (isSend) {
      setRingFx('send')
      setCursor(stopIndex)
      clearCenterHit()
      addHitLit(stopIndex)
      await sleep(450)
      await pulseHitCells(4, 100)
      enterAwardStage('luck_send')
      await playFruitAwardVoice('goodluck')
      playFruitAwardFanfare('luck_send')
      await playFruitAwardVoice('luck_send')
      clearHitLit()
      await sleep(280)
      await playLuckSendRuns(hitIndexes, winByCell)
      playFruitSfx('coin', 0.85)
      await pulseHitCells(3, 100)
    }
    // —— 开火车：青光拖车 ——
    else if (awardType === 'train') {
      clearCenterHit()
      setCursor(stopIndex)
      setRingFx('train')
      await holdAwardTitle('开火车', 650)
      await flashRing(2, 110)
      enterAwardStage('train')
      playFruitAwardFanfare('train')
      await playFruitAwardVoice('train')
      await sleep(280)
      await playTrainReveal(hitIndexes, winByCell)
    }
    // —— 大满贯 ——
    else if (awardType === 'slam') {
      clearCenterHit()
      setCursor(stopIndex)
      setRingFx('slam')
      await holdAwardTitle('大满贯', 700)
      await flashRing(2, 150)
      enterAwardStage('slam')
      playFruitAwardFanfare('slam')
      await playFruitAwardVoice('slam')
      await sleep(350)
      await playSlamReveal(hitIndexes, winByCell, stopIndex)
    }
    // —— 大三元：金爆齐亮再逐揭 ——
    else if (awardType === 'big3') {
      clearCenterHit()
      setCursor(stopIndex)
      setRingFx('big3')
      await holdAwardTitle('大三元', 700)
      await flashRing(3, 110)
      enterAwardStage('big3')
      playFruitAwardFanfare('big3')
      await playFruitAwardVoice('big3')
      await sleep(280)
      await playBig3Reveal(hitIndexes, winByCell)
      playFruitSfx('coin', 0.9)
    }
    // —— 小三元：翠绿错落 ——
    else if (awardType === 'small3') {
      clearCenterHit()
      setCursor(stopIndex)
      setRingFx('small3')
      await holdAwardTitle('小三元', 650)
      await flashRing(2, 130)
      enterAwardStage('small3')
      playFruitAwardFanfare('small3')
      await playFruitAwardVoice('small3')
      await sleep(280)
      await playSmall3Reveal(hitIndexes, winByCell)
      playFruitSfx('coin', 0.8)
    }
    // —— 大四喜：四苹果齐爆 ——
    else if (awardType === 'four') {
      clearCenterHit()
      setCursor(stopIndex)
      setRingFx('four')
      await holdAwardTitle('大四喜', 700)
      await flashRing(3, 110)
      enterAwardStage('four')
      playFruitAwardFanfare('four')
      await playFruitAwardVoice('four')
      await sleep(280)
      await playFourReveal(hitIndexes, winByCell)
      playFruitSfx('coin', 0.9)
    }
    // —— 普通单格 ——
    else if (hitIndexes.length) {
      setHitLitAll(hitIndexes)
      for (const idx of hitIndexes) {
        setCursor(idx)
        const amt = winByCell.get(idx) ?? 0
        setCenterHit(idx)
        stageMode.value = 'idle'
        await celebrateHighCell(idx)
        await announceCell(idx, amt)
      }
    }

    await sleep(special ? 900 : 280)
    if (special) await sleep(700)
    setRingFx('none')
    setFruitBgmDuck(false)
    // 猜大小由 doSpin 在最终赢分校准后再切入
  }

  return {
    runLightTo,
    announceCell,
    celebrateHighCell,
    flashRing,
    pulseHitCells,
    revealHits,
  }
}

export type FruitAwardFx = ReturnType<typeof createFruitAwardFx>
