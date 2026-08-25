<template>
  <div class="rp" v-loading="loading">
    <div class="rp-head">
      <div class="rp-summary">
        已开托 <b>{{ onCount }}</b> / {{ rows.length }} 款
        <span class="rp-tz">· 按时段人数（上海时区）</span>
        <span v-if="dirtyCount" class="rp-dirty-hint">· {{ dirtyCount }} 款未保存</span>
      </div>
      <el-button size="small" :loading="loading" @click="load">刷新</el-button>
    </div>

    <div v-if="!rows.length" class="rp-empty">
      暂无已开放游戏，请先到「游戏设置」开放
    </div>

    <div v-else class="rp-grid">
      <article
        v-for="row in rows"
        :key="row.gameCode"
        class="rp-card"
        :class="{ dirty: isDirty(row), off: draftOf(row) <= 0 }"
      >
        <header class="rp-card-head">
          <h3 class="rp-name">{{ row.label }}</h3>
          <span class="rp-badge" :class="isDirty(row) ? 'warn' : 'ok'">
            {{ isDirty(row) ? '未保存' : '已保存' }}
          </span>
        </header>

        <div class="rp-well">
          <div class="rp-figure" :class="{ off: draftOf(row) <= 0 }">
            <strong>{{ draftOf(row) > 0 ? liveRangeText(row) : '关' }}</strong>
            <span>{{ draftOf(row) > 0 ? '此刻随机人数' : '托人' }}</span>
          </div>

          <div class="rp-seg">
            <button
              type="button"
              class="rp-seg-btn"
              :class="{ on: draftOf(row) <= 0 }"
              :disabled="readonly || savingCode === row.gameCode"
              @click="setDraft(row, 0)"
            >关</button>
            <button
              type="button"
              class="rp-seg-btn"
              :class="{ on: slotsEqual(draftSlots(row), PLATFORM_DEFAULT_SLOTS) }"
              :disabled="readonly || savingCode === row.gameCode"
              @click="restoreDefault(row)"
            >默认时段</button>
          </div>

          <div v-if="draftOf(row) > 0" class="rp-slots">
            <div
              v-for="slot in draftSlots(row)"
              :key="slot.key"
              class="rp-slot"
            >
              <span class="rp-slot-name">{{ slotLabel(slot.key) }}</span>
              <div class="rp-slot-time">
                <input
                  class="rp-num"
                  type="number"
                  min="0"
                  max="23"
                  :disabled="readonly || savingCode === row.gameCode"
                  :value="slot.startHour"
                  @change="onSlotHour(row, slot.key, 'startHour', $event)"
                >
                <span>点-</span>
                <input
                  class="rp-num"
                  type="number"
                  min="1"
                  max="24"
                  :disabled="readonly || savingCode === row.gameCode"
                  :value="slot.endHour"
                  @change="onSlotHour(row, slot.key, 'endHour', $event)"
                >
                <span>点</span>
              </div>
              <div class="rp-slot-count">
                <input
                  class="rp-num wide"
                  type="number"
                  min="0"
                  max="50"
                  :disabled="readonly || savingCode === row.gameCode"
                  :value="slotMin(slot)"
                  @change="onSlotBound(row, slot.key, 'min', $event)"
                >
                <span>–</span>
                <input
                  class="rp-num wide"
                  type="number"
                  min="0"
                  max="50"
                  :disabled="readonly || savingCode === row.gameCode"
                  :value="slotMax(slot)"
                  @change="onSlotBound(row, slot.key, 'max', $event)"
                >
                <span>人</span>
              </div>
            </div>
            <p class="rp-slot-tip">此刻 {{ liveRangeText(row) }}</p>
          </div>
        </div>

        <footer class="rp-card-foot">
          <p class="rp-hint">
            <template v-if="isDirty(row)">有未保存改动</template>
            <template v-else-if="row.count > 0">线上生效中</template>
            <template v-else>当前未开托</template>
          </p>
          <el-button
            v-if="!readonly"
            type="primary"
            size="small"
            class="rp-save"
            :disabled="!isDirty(row)"
            :loading="savingCode === row.gameCode"
            @click="saveRow(row)"
          >保存</el-button>
        </footer>
      </article>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { ElMessage } from 'element-plus'
import {
  consoleApi,
  type RobotDaySlot,
  type RobotPlan,
  type RoomGameCfg,
} from '@/api/console'
import { GAME_OPTIONS, gameLabel } from '@/utils/labels'

const NO_ROBOT_GAMES = new Set(['fruit-machine', 'bcbm'])
const SLOT_KEYS = ['night', 'morning', 'noon', 'afternoon', 'peak'] as const

const PLATFORM_DEFAULT_SLOTS: RobotDaySlot[] = [
  { key: 'night', startHour: 0, endHour: 6, count: 40, countMin: 35, countMax: 45 },
  { key: 'morning', startHour: 6, endHour: 10, count: 5, countMin: 3, countMax: 8 },
  { key: 'noon', startHour: 10, endHour: 12, count: 8, countMin: 5, countMax: 12 },
  { key: 'afternoon', startHour: 12, endHour: 18, count: 30, countMin: 25, countMax: 35 },
  { key: 'peak', startHour: 18, endHour: 24, count: 45, countMin: 40, countMax: 50 },
]

const props = defineProps<{
  roomId: string
  readonly?: boolean
}>()

const loading = ref(false)
const savingCode = ref('')
const games = ref<RoomGameCfg[]>([])
const draftCount = reactive<Record<string, number>>({})
const draftSlotMap = reactive<Record<string, RobotDaySlot[]>>({})

type Row = {
  gameCode: string
  label: string
  count: number
  slots: RobotDaySlot[]
}

/** 建房默认五段随机人数；n<=0 全关 */
function defaultSlots(n: number): RobotDaySlot[] {
  if (n <= 0) {
    return PLATFORM_DEFAULT_SLOTS.map((s) => ({
      ...s,
      count: 0,
      countMin: 0,
      countMax: 0,
    }))
  }
  return PLATFORM_DEFAULT_SLOTS.map((s) => ({ ...s }))
}

function clampCount(n: number) {
  return Math.min(50, Math.max(0, Math.floor(n)))
}

function slotMin(slot: RobotDaySlot) {
  const a = slot.countMin != null ? clampCount(slot.countMin) : clampCount(slot.count)
  const b = slot.countMax != null ? clampCount(slot.countMax) : clampCount(slot.count)
  return Math.min(a, b)
}

function slotMax(slot: RobotDaySlot) {
  const a = slot.countMin != null ? clampCount(slot.countMin) : clampCount(slot.count)
  const b = slot.countMax != null ? clampCount(slot.countMax) : clampCount(slot.count)
  return Math.max(a, b)
}

function withRange(slot: RobotDaySlot, min: number, max: number): RobotDaySlot {
  const lo = clampCount(Math.min(min, max))
  const hi = clampCount(Math.max(min, max))
  return {
    ...slot,
    countMin: lo,
    countMax: hi,
    count: Math.round((lo + hi) / 2),
  }
}

function migrateSlotKey(raw: string): RobotDaySlot['key'] | null {
  if (raw === 'day') return 'afternoon'
  if ((SLOT_KEYS as readonly string[]).includes(raw)) return raw as RobotDaySlot['key']
  return null
}

function readCount(cfg: RoomGameCfg): number {
  const p = cfg.robotPlan
  if (p && typeof p === 'object') {
    if (String(p.scheme || '').toUpperCase() === 'OFF') return 0
    if (Array.isArray(p.daySlots) && p.daySlots.length) {
      const m = Math.max(0, ...p.daySlots.map((s) => slotMax(s)))
      if (m > 0) return m
    }
    if (p.robotCount != null) return clampCount(Number(p.robotCount) || 0)
  }
  return clampCount(Number(cfg.robotCount) || 0)
}

function readSlots(cfg: RoomGameCfg): RobotDaySlot[] {
  const n = readCount(cfg)
  const raw = cfg.robotPlan?.daySlots
  const fbAll = defaultSlots(n)
  if (!Array.isArray(raw) || !raw.length) return fbAll
  const byKey = new Map<string, RobotDaySlot>()
  for (const s of raw) {
    const key = migrateSlotKey(String(s.key || ''))
    if (!key) continue
    const fb = fbAll.find((x) => x.key === key)!
    const fromDay = String(s.key) === 'day'
    byKey.set(key, {
      key,
      startHour: fromDay
        ? fb.startHour
        : Math.min(23, Math.max(0, Math.floor(Number(s.startHour) || fb.startHour))),
      endHour: fromDay
        ? fb.endHour
        : Math.min(24, Math.max(0, Math.floor(Number(s.endHour) || fb.endHour))),
      count: clampCount(Number(s.count) || 0),
      countMin: s.countMin != null ? clampCount(Number(s.countMin)) : undefined,
      countMax: s.countMax != null ? clampCount(Number(s.countMax)) : undefined,
    })
  }
  return SLOT_KEYS.map((k) => byKey.get(k) ?? { ...fbAll.find((x) => x.key === k)! })
}

function slotLabel(key: RobotDaySlot['key']) {
  return ({
    night: '凌晨',
    morning: '上午',
    noon: '午前',
    afternoon: '下午',
    peak: '晚间',
  } as const)[key]
}

function shanghaiHour() {
  const t = Date.now() + 8 * 3600 * 1000
  return new Date(t).getUTCHours()
}

function hourInSlot(h: number, start: number, end: number) {
  if (start === end) return true
  if (start < end) return h >= start && h < end
  return h >= start || h < end
}

const rows = computed<Row[]>(() => {
  const map = new Map(games.value.map((g) => [g.gameCode, g]))
  return GAME_OPTIONS
    .map((opt) => {
      if (NO_ROBOT_GAMES.has(opt.value)) return null
      const cfg = map.get(opt.value)
      if (!cfg?.enabled) return null
      return {
        gameCode: opt.value,
        label: gameLabel(opt.value) || opt.label,
        count: readCount(cfg),
        slots: readSlots(cfg),
      }
    })
    .filter((r): r is Row => !!r)
})

const onCount = computed(() => rows.value.filter((r) => r.count > 0).length)
const dirtyCount = computed(() => rows.value.filter((r) => isDirty(r)).length)

function draftOf(row: Row): number {
  const n = draftCount[row.gameCode]
  if (n == null || Number.isNaN(n)) return row.count
  return Math.min(50, Math.max(0, Math.floor(Number(n) || 0)))
}

function draftSlots(row: Row): RobotDaySlot[] {
  return draftSlotMap[row.gameCode] || row.slots
}

function slotsEqual(a: RobotDaySlot[], b: RobotDaySlot[]) {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) {
    const x = a[i]!
    const y = b[i]!
    if (
      x.key !== y.key
      || x.startHour !== y.startHour
      || x.endHour !== y.endHour
      || slotMin(x) !== slotMin(y)
      || slotMax(x) !== slotMax(y)
    ) {
      return false
    }
  }
  return true
}

function isDirty(row: Row): boolean {
  if (draftOf(row) !== row.count) return true
  return !slotsEqual(draftSlots(row), row.slots)
}

function liveRange(row: Row): { min: number; max: number } {
  const h = shanghaiHour()
  const slots = draftSlots(row)
  for (const s of slots) {
    if (hourInSlot(h, s.startHour, s.endHour)) return { min: slotMin(s), max: slotMax(s) }
  }
  const n = draftOf(row)
  return { min: n, max: n }
}

function liveRangeText(row: Row) {
  const { min, max } = liveRange(row)
  return min === max ? `${min} 人` : `${min}–${max} 人`
}

function schemeOf(count: number): RobotPlan['scheme'] {
  if (count <= 0) return 'OFF'
  return 'CUSTOM'
}

function ensureDraftSlots(row: Row) {
  if (!draftSlotMap[row.gameCode]) {
    draftSlotMap[row.gameCode] = row.slots.map((s) => ({ ...s }))
  }
}

function setDraft(row: Row, n: number) {
  if (props.readonly) return
  const count = Math.min(50, Math.max(0, Math.floor(n)))
  const slots = defaultSlots(count)
  draftSlotMap[row.gameCode] = slots
  draftCount[row.gameCode] = count <= 0 ? 0 : Math.max(...slots.map((s) => slotMax(s)))
}

function restoreDefault(row: Row) {
  setDraft(row, 50)
}

function onSlotBound(
  row: Row,
  key: RobotDaySlot['key'],
  bound: 'min' | 'max',
  ev: Event,
) {
  if (props.readonly) return
  ensureDraftSlots(row)
  const raw = Math.floor(Number((ev.target as HTMLInputElement).value))
  const slots = draftSlotMap[row.gameCode]!.map((s) => ({ ...s }))
  const i = slots.findIndex((s) => s.key === key)
  if (i < 0) return
  const cur = slots[i]!
  const lo = bound === 'min' ? (Number.isFinite(raw) ? raw : 0) : slotMin(cur)
  const hi = bound === 'max' ? (Number.isFinite(raw) ? raw : 0) : slotMax(cur)
  slots[i] = withRange(cur, lo, hi)
  draftSlotMap[row.gameCode] = slots
  draftCount[row.gameCode] = Math.max(...slots.map((s) => slotMax(s)))
}

function onSlotHour(
  row: Row,
  key: RobotDaySlot['key'],
  field: 'startHour' | 'endHour',
  ev: Event,
) {
  if (props.readonly) return
  ensureDraftSlots(row)
  const raw = Math.floor(Number((ev.target as HTMLInputElement).value))
  const slots = draftSlotMap[row.gameCode]!.map((s) => ({ ...s }))
  const i = slots.findIndex((s) => s.key === key)
  if (i < 0) return
  if (field === 'startHour') {
    slots[i]!.startHour = Math.min(23, Math.max(0, Number.isFinite(raw) ? raw : 0))
  } else {
    slots[i]!.endHour = Math.min(24, Math.max(0, Number.isFinite(raw) ? raw : 24))
  }
  draftSlotMap[row.gameCode] = slots
}

async function saveRow(row: Row) {
  if (props.readonly || !isDirty(row)) return
  const count = draftOf(row)
  const slots = (count <= 0 ? defaultSlots(0) : draftSlots(row)).map((s) => {
    const lo = count <= 0 ? 0 : slotMin(s)
    const hi = count <= 0 ? 0 : slotMax(s)
    return withRange(s, lo, hi)
  })
  savingCode.value = row.gameCode
  try {
    const plan: RobotPlan = {
      scheme: schemeOf(count),
      betStyle: 'random',
      intensity: 3,
      winBias: 0,
      robotCount: count,
      daySlots: slots,
    }
    await consoleApi.patchRoomGame(props.roomId, row.gameCode, {
      robotCount: count,
      robotPlan: plan,
    })
    ElMessage.success(
      count <= 0 ? `${row.label} 已关掉托人` : `${row.label} 已保存时段人数`,
    )
    draftCount[row.gameCode] = count
    draftSlotMap[row.gameCode] = slots.map((s) => ({ ...s }))
    const cfg = games.value.find((g) => g.gameCode === row.gameCode)
    if (cfg) {
      cfg.robotCount = count
      cfg.robotPlan = plan
    } else {
      await load()
    }
  } catch (e: unknown) {
    ElMessage.error(
      (e as { response?: { data?: { message?: string } }; message?: string })?.response?.data?.message
      || (e as Error).message
      || '保存失败',
    )
  } finally {
    savingCode.value = ''
  }
}

function syncDraftFromServer() {
  for (const r of rows.value) {
    draftCount[r.gameCode] = r.count
    draftSlotMap[r.gameCode] = r.slots.map((s) => ({ ...s }))
  }
}

async function load() {
  if (!props.roomId) return
  loading.value = true
  try {
    games.value = await consoleApi.roomGames(props.roomId)
    syncDraftFromServer()
  } catch (e: unknown) {
    ElMessage.error((e as Error).message || '加载失败')
  } finally {
    loading.value = false
  }
}

watch(() => props.roomId, () => void load())
onMounted(() => void load())
</script>

<style scoped>
.rp-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 14px;
  padding-bottom: 12px;
  border-bottom: 1px solid #f1f5f9;
}
.rp-summary {
  font-size: 13px;
  color: #475569;
}
.rp-summary b {
  margin: 0 2px;
  font-size: 15px;
  font-weight: 650;
  color: #f59e0b;
}
.rp-tz { color: #94a3b8; }
.rp-dirty-hint {
  margin-left: 4px;
  color: #d97706;
  font-weight: 650;
}
.rp-empty {
  padding: 40px 16px;
  text-align: center;
  font-size: 13px;
  color: #94a3b8;
  background: #fff;
  border: 1px dashed #e2e8f0;
  border-radius: 12px;
}
.rp-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
  gap: 14px;
}
.rp-card {
  position: relative;
  display: flex;
  flex-direction: column;
  min-height: 280px;
  padding: 14px 14px 12px;
  background: #fff;
  border: 1px solid #e2e8f0;
  border-radius: 12px;
  box-shadow: 0 1px 2px rgba(15, 23, 42, 0.04);
  overflow: hidden;
}
.rp-card::before {
  content: '';
  position: absolute;
  left: 0;
  top: 0;
  bottom: 0;
  width: 3px;
  background: transparent;
}
.rp-card.off { background: #fafbfc; }
.rp-card.off .rp-name { color: #64748b; }
.rp-card.dirty {
  border-color: #fcd34d;
  background: #fffdf7;
}
.rp-card.dirty::before { background: #f59e0b; }
.rp-card-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 12px;
}
.rp-name {
  margin: 0;
  min-width: 0;
  font-size: 14px;
  font-weight: 700;
  color: #0f172a;
  line-height: 1.3;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.rp-badge {
  flex-shrink: 0;
  height: 20px;
  padding: 0 8px;
  border-radius: 999px;
  font-size: 11px;
  font-weight: 700;
  line-height: 20px;
}
.rp-badge.ok { color: #15803d; background: #ecfdf5; }
.rp-badge.warn { color: #b45309; background: #fef3c7; }
.rp-well {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 14px 12px;
  background: #f8fafc;
  border: 1px solid #eef2f7;
  border-radius: 10px;
}
.rp-card.dirty .rp-well {
  background: #fff7ed;
  border-color: #fde68a;
}
.rp-stepper {
  display: grid;
  grid-template-columns: 36px 1fr 36px;
  align-items: center;
  gap: 8px;
}
.rp-step {
  appearance: none;
  width: 36px;
  height: 36px;
  border: 1px solid #e2e8f0;
  border-radius: 10px;
  background: #fff;
  color: #0f172a;
  font-size: 20px;
  font-weight: 600;
  line-height: 1;
  cursor: pointer;
}
.rp-step:hover:not(:disabled) {
  border-color: #93c5fd;
  background: #eff6ff;
  color: #1d4ed8;
}
.rp-step:disabled { opacity: 0.35; cursor: not-allowed; }
.rp-figure { text-align: center; line-height: 1; }
.rp-figure strong {
  display: block;
  font-size: 30px;
  font-weight: 800;
  color: #0f172a;
  font-variant-numeric: tabular-nums;
}
.rp-figure span {
  display: block;
  margin-top: 5px;
  font-size: 12px;
  font-weight: 600;
  color: #64748b;
}
.rp-figure.off strong { color: #94a3b8; font-size: 28px; }
.rp-seg {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 4px;
  padding: 3px;
  background: #e2e8f0;
  border-radius: 9px;
}
.rp-card.dirty .rp-seg { background: #fde68a; }
.rp-seg-btn {
  appearance: none;
  height: 28px;
  border: 0;
  border-radius: 7px;
  background: transparent;
  color: #475569;
  font-size: 12px;
  font-weight: 700;
  cursor: pointer;
}
.rp-seg-btn.on {
  background: #fff;
  color: #1d4ed8;
  box-shadow: 0 1px 2px rgba(15, 23, 42, 0.08);
}
.rp-seg-btn:disabled { opacity: 0.45; cursor: not-allowed; }

.rp-slots {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding-top: 4px;
  border-top: 1px dashed #e2e8f0;
}
.rp-slot {
  display: grid;
  grid-template-columns: 40px 1fr auto;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: #475569;
}
.rp-slot-name {
  font-weight: 700;
  color: #0f172a;
}
.rp-slot-time, .rp-slot-count {
  display: flex;
  align-items: center;
  gap: 2px;
}
.rp-num {
  width: 40px;
  height: 26px;
  padding: 0 4px;
  border: 1px solid #e2e8f0;
  border-radius: 6px;
  background: #fff;
  font-size: 12px;
  font-weight: 650;
  font-variant-numeric: tabular-nums;
  text-align: center;
  color: #0f172a;
}
.rp-num.wide { width: 44px; }
.rp-num:disabled { opacity: 0.5; }
.rp-slot-tip {
  margin: 2px 0 0;
  font-size: 11px;
  color: #94a3b8;
}

.rp-card-foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  margin-top: 12px;
  min-height: 28px;
}
.rp-hint {
  margin: 0;
  min-width: 0;
  font-size: 12px;
  color: #64748b;
  line-height: 1.35;
}
.rp-card.dirty .rp-hint {
  color: #b45309;
  font-weight: 600;
}
.rp-save {
  flex-shrink: 0;
  min-width: 64px;
}

@media (max-width: 560px) {
  .rp-grid { grid-template-columns: 1fr; }
}
</style>
