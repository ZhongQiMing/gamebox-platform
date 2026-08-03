/**
 * 水果机 24 格灯控：光标 / 中奖常亮 / 火车车厢 / 全圈闪 / 主题色
 */
import { computed, ref } from 'vue'

export type RingFx =
  | 'none'
  | 'eat'
  | 'send'
  | 'train'
  | 'big3'
  | 'small3'
  | 'four'
  | 'slam'

export function useFruitRingLights(ringLen: number) {
  const cursorIndex = ref(-1)
  const hitLit = ref<Set<number>>(new Set())
  const trainHead = ref(-1)
  const trainTail = ref(-1)
  const trainBody = ref<Set<number>>(new Set())
  const flashAll = ref(false)
  const ringFx = ref<RingFx>('none')
  const ringFxClass = computed(() => (ringFx.value === 'none' ? '' : `fx-${ringFx.value}`))

  const ringCellEls: (HTMLElement | null)[] = []

  function setRingCellRef(el: HTMLElement | null, i: number) {
    ringCellEls[i] = el
  }

  function setCursor(idx: number) {
    const old = cursorIndex.value
    if (old === idx) return
    if (old >= 0) ringCellEls[old]?.classList.remove('active')
    if (idx >= 0) ringCellEls[idx]?.classList.add('active')
    cursorIndex.value = idx
  }

  function clearTrainVisual() {
    trainHead.value = -1
    trainTail.value = -1
    trainBody.value = new Set()
  }

  /** 车头在 headIdx，车厢沿环往回拖 length 节 */
  function paintTrain(headIdx: number, length: number) {
    const n = ringLen
    if (headIdx < 0 || length <= 0 || !n) {
      clearTrainVisual()
      return
    }
    const len = Math.min(length, n)
    const next = new Set<number>()
    for (let k = 0; k < len; k++) {
      next.add((headIdx - k + n * 8) % n)
    }
    trainHead.value = headIdx
    trainTail.value = (headIdx - (len - 1) + n * 8) % n
    trainBody.value = next
  }

  function setRingFx(fx: RingFx) {
    ringFx.value = fx
  }

  function clearHitLit() {
    for (const i of hitLit.value) {
      ringCellEls[i]?.classList.remove('hit')
    }
    for (const el of ringCellEls) el?.classList.remove('hit')
    hitLit.value = new Set()
  }

  function addHitLit(idx: number) {
    if (idx < 0) return
    if (!hitLit.value.has(idx)) {
      const next = new Set(hitLit.value)
      next.add(idx)
      hitLit.value = next
    }
    ringCellEls[idx]?.classList.add('hit')
  }

  function setHitLitAll(indexes: number[]) {
    clearHitLit()
    const next = new Set<number>()
    for (const idx of indexes) {
      next.add(idx)
      ringCellEls[idx]?.classList.add('hit')
    }
    hitLit.value = next
  }

  async function flashRing(sleep: (ms: number) => Promise<void>, times = 3, gap = 120) {
    for (let i = 0; i < times; i++) {
      flashAll.value = true
      await sleep(gap)
      flashAll.value = false
      await sleep(gap)
    }
  }

  async function pulseHitCells(sleep: (ms: number) => Promise<void>, times = 3, gap = 100) {
    const idxs = [...hitLit.value]
    if (!idxs.length) {
      await flashRing(sleep, times, gap)
      return
    }
    for (let i = 0; i < times; i++) {
      for (const idx of idxs) ringCellEls[idx]?.classList.add('hit-pulse')
      await sleep(gap)
      for (const idx of idxs) ringCellEls[idx]?.classList.remove('hit-pulse')
      await sleep(gap)
    }
  }

  return {
    cursorIndex,
    hitLit,
    trainHead,
    trainTail,
    trainBody,
    flashAll,
    ringFx,
    ringFxClass,
    ringCellEls,
    setRingCellRef,
    setCursor,
    clearTrainVisual,
    paintTrain,
    setRingFx,
    clearHitLit,
    addHitLit,
    setHitLitAll,
    flashRing,
    pulseHitCells,
  }
}

export type FruitRingLights = ReturnType<typeof useFruitRingLights>
