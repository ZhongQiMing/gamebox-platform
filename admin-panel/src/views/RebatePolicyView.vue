<template>
  <div class="desk-work rebate-page" v-loading="loading">
    <div class="desk-panel">
      <PageHeader title="回水规则">
        <template #actions>
          <el-tag size="small" effect="plain" :type="statusTag">{{ statusText }}</el-tag>
          <el-button :loading="loading" :disabled="editing" @click="load">刷新</el-button>
          <template v-if="canStartEdit">
            <el-button v-if="!editing" type="primary" @click="startEdit">修改</el-button>
            <template v-else>
              <el-button @click="cancelEdit">取消</el-button>
              <el-button type="primary" :loading="saving" @click="save">保存</el-button>
            </template>
          </template>
        </template>
      </PageHeader>

      <div class="rooms-summary">
        <div
          v-for="c in catChips"
          :key="c.cat"
          class="sum-chip"
          :class="{ on: catFilter === c.cat }"
          @click="catFilter = catFilter === c.cat ? 'ALL' : c.cat"
        >
          <span class="sum-label">{{ c.label }}</span>
          <span class="sum-val">{{ c.count }}</span>
        </div>
      </div>

      <div class="panel-toolbar">
        <el-radio-group v-model="catFilter" size="small">
          <el-radio-button label="ALL">全部</el-radio-button>
          <el-radio-button v-for="c in catOrder" :key="c" :label="c">{{ catLabel(c) }}</el-radio-button>
        </el-radio-group>
        <span class="toolbar-note">{{ visibleCount }} 个游戏</span>
      </div>

      <div class="desk-panel__scroll">
        <el-alert
          v-if="formError"
          type="warning"
          :closable="false"
          show-icon
          :title="formError"
          class="alert"
        />

        <section v-for="group in groups" :key="group.cat" class="cat-block">
          <div class="cat-head">
            <div>
              <div class="cat-title">{{ group.label }}</div>
            </div>
            <el-button
              v-if="editing && canEdit === 'platform'"
              size="small"
              @click="applyTemplate(group.cat)"
            >套用该类型默认</el-button>
          </div>

          <el-table
            :data="group.rows"
            stripe
            border
            size="small"
            class="game-table"
            empty-text="暂无游戏"
          >
            <el-table-column label="游戏" min-width="148" fixed>
              <template #default="{ row }: { row: any }">
                <div class="g-name">{{ row.name }}</div>
                <div class="g-code">{{ row.gameCode }}</div>
              </template>
            </el-table-column>
            <el-table-column v-if="showGeneralCol" label="总代 %" :min-width="showGeneralBounds ? 280 : 120" align="center">
              <template #default="{ row }: { row: any }">
                <div v-if="editing && editGeneral" class="triple-edit">
                  <label>下限<el-input-number v-model="row.generalMinPct" :min="row.agentMaxPct" :max="row.generalMaxPct" :step="0.1" :precision="1" size="small" controls-position="right" /></label>
                  <label>默认<el-input-number v-model="row.generalDefaultPct" :min="row.generalMinPct" :max="row.generalMaxPct" :step="0.1" :precision="1" size="small" controls-position="right" /></label>
                  <label>上限<el-input-number v-model="row.generalMaxPct" :min="row.generalMinPct" :max="20" :step="0.1" :precision="1" size="small" controls-position="right" /></label>
                </div>
                <div v-else-if="showGeneralBounds" class="triple">
                  <span>{{ pct(row.generalMinPct) }}</span>
                  <b>{{ pct(row.generalDefaultPct) }}</b>
                  <span>{{ pct(row.generalMaxPct) }}</span>
                </div>
                <b v-else class="one">{{ pct(row.generalDefaultPct) }}%</b>
              </template>
            </el-table-column>
            <el-table-column label="代理 %" :min-width="showAgentBounds ? 280 : 120" align="center">
              <template #default="{ row }: { row: any }">
                <div v-if="editing && editAgent" class="triple-edit">
                  <label>下限<el-input-number v-model="row.agentMinPct" :min="agentMinFloor(row)" :max="row.agentMaxPct" :step="0.1" :precision="1" size="small" controls-position="right" /></label>
                  <label>默认<el-input-number v-model="row.agentDefaultPct" :min="row.agentMinPct" :max="row.agentMaxPct" :step="0.1" :precision="1" size="small" controls-position="right" /></label>
                  <label>上限<el-input-number v-model="row.agentMaxPct" :min="row.agentMinPct" :max="agentCapPct(row)" :step="0.1" :precision="1" size="small" controls-position="right" /></label>
                </div>
                <div v-else-if="showAgentBounds" class="triple">
                  <span>{{ pct(row.agentMinPct) }}</span>
                  <b>{{ pct(row.agentDefaultPct) }}</b>
                  <span>{{ pct(row.agentMaxPct) }}</span>
                </div>
                <b v-else class="one">{{ pct(row.agentDefaultPct) }}%</b>
              </template>
            </el-table-column>
            <el-table-column label="玩家 %" :min-width="showPlayerBounds ? 280 : 120" align="center">
              <template #default="{ row }: { row: any }">
                <div v-if="editing && editPlayer && showPlayerBounds" class="triple-edit">
                  <label>下限<el-input-number v-model="row.playerMinPct" :min="row.capPlayerMinPct" :max="row.playerMaxPct" :step="0.1" :precision="1" size="small" controls-position="right" /></label>
                  <label>默认<el-input-number v-model="row.playerDefaultPct" :min="row.playerMinPct" :max="row.playerMaxPct" :step="0.1" :precision="1" size="small" controls-position="right" /></label>
                  <label>上限<el-input-number v-model="row.playerMaxPct" :min="row.playerMinPct" :max="playerCapPct(row)" :step="0.1" :precision="1" size="small" controls-position="right" /></label>
                </div>
                <div v-else-if="editing && editPlayer" class="one-edit">
                  <el-input-number
                    v-model="row.playerDefaultPct"
                    :min="row.playerMinPct"
                    :max="row.playerMaxPct"
                    :step="0.1"
                    :precision="1"
                    size="small"
                    controls-position="right"
                  />
                </div>
                <div v-else-if="showPlayerBounds" class="triple">
                  <span>{{ pct(row.playerMinPct) }}</span>
                  <b>{{ pct(row.playerDefaultPct) }}</b>
                  <span>{{ pct(row.playerMaxPct) }}</span>
                </div>
                <b v-else class="one">{{ pct(row.playerDefaultPct) }}%</b>
              </template>
            </el-table-column>
          </el-table>
        </section>

        <section v-if="canEditSelfCommission" class="comm">
          <div class="comm-hd">
            <div>
              <div class="comm-title">挂靠佣金</div>
            </div>
            <el-button type="primary" size="small" :disabled="!commDirty" :loading="commSaving" @click="saveMyCommission">保存</el-button>
          </div>
          <div class="comm-status" :class="commDirty ? 'dirty' : 'ok'">
            <template v-if="commDirty">未保存 {{ draftCommissionPct.toFixed(2) }}% · 当前 {{ savedCommissionPct.toFixed(2) }}%</template>
            <template v-else>已生效 {{ savedCommissionPct.toFixed(2) }}%</template>
          </div>
          <div class="comm-presets" :class="{ disabled: commSaving }">
            <button
              v-for="p in commissionPresets"
              :key="p"
              type="button"
              class="chip"
              :class="{ on: isDraftPreset(p) }"
              :disabled="commSaving"
              @click="setDraftCommission(p)"
            >{{ formatPreset(p) }}%</button>
            <button
              type="button"
              class="chip ghost"
              :class="{ on: isCustomDraft }"
              :disabled="commSaving"
              @click="pickCustomCommission"
            >自定义</button>
          </div>
        </section>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import PageHeader from '@/components/PageHeader.vue'
import { consoleApi, type RebateGameRule } from '@/api/console'
import { useAdminStore } from '@/stores/admin'
import {
  REBATE_CATEGORY_LABEL,
  REBATE_CATEGORY_ORDER,
  rebateFallbackForCategory,
  isGeneralSide,
} from '@gamebox/shared'

type GameRow = RebateGameRule & {
  generalMinPct: number
  generalDefaultPct: number
  generalMaxPct: number
  agentMinPct: number
  agentDefaultPct: number
  agentMaxPct: number
  playerMinPct: number
  playerDefaultPct: number
  playerMaxPct: number
  capAgentMinPct: number
  capAgentMaxPct: number
  capPlayerMinPct: number
  capPlayerMaxPct: number
}

const store = useAdminStore()
const canEdit = ref<'platform' | 'general' | 'agent' | 'none'>('none')
const canEditSelfCommission = computed(() => store.profile?.role === 'AGENT')
const canStartEdit = computed(() => canEdit.value !== 'none')
const editGeneral = computed(() => canEdit.value === 'platform')
const editAgent = computed(() => canEdit.value === 'platform' || canEdit.value === 'general')
const editPlayer = computed(() => canEdit.value === 'platform' || canEdit.value === 'general' || canEdit.value === 'agent')
const isRoomAgentSide = computed(() => {
  const r = store.profile?.role
  if (isGeneralSide(r, store.profile?.parentRole)) return false
  return r === 'AGENT' || r === 'PROXY'
})
const showGeneralCol = computed(() => !isRoomAgentSide.value)
const showGeneralBounds = computed(() => !isRoomAgentSide.value && canEdit.value !== 'general')
const showAgentBounds = computed(() => !isRoomAgentSide.value)
const showPlayerBounds = computed(() => !isRoomAgentSide.value)

const loading = ref(false)
const saving = ref(false)
const editing = ref(false)
const savedOnce = ref(false)
const commSaving = ref(false)
const snapshot = ref('')
const gameRows = ref<GameRow[]>([])
const catFilter = ref('ALL')
const catOrder = REBATE_CATEGORY_ORDER

const savedCommissionPct = ref(0.2)
const draftCommissionPct = ref(0.2)
const commissionPresets = [0.1, 0.2, 0.5, 1, 2]
const commDirty = computed(
  () => Math.abs(draftCommissionPct.value - savedCommissionPct.value) > 1e-9,
)
const isCustomDraft = computed(
  () => !commissionPresets.some((p) => Math.abs(draftCommissionPct.value - p) < 1e-9),
)

const dirty = computed(() => editing.value && snapshot.value !== serialize())
const statusText = computed(() => {
  if (editing.value) return dirty.value ? '修改中 · 未保存' : '修改中 · 尚未改动'
  return savedOnce.value ? '已生效' : '查看中'
})
const statusTag = computed(() => {
  if (editing.value && dirty.value) return 'warning'
  return 'success'
})

const catChips = computed(() =>
  catOrder.map((cat) => ({
    cat,
    label: catLabel(cat),
    count: gameRows.value.filter((r) => r.category === cat).length,
  })),
)
const groups = computed(() =>
  catOrder
    .filter((cat) => catFilter.value === 'ALL' || catFilter.value === cat)
    .map((cat) => ({
      cat,
      label: catLabel(cat),
      rows: gameRows.value.filter((r) => r.category === cat),
    }))
    .filter((g) => g.rows.length),
)
const visibleCount = computed(() => groups.value.reduce((n, g) => n + g.rows.length, 0))

const formError = computed(() => {
  if (!editing.value) return ''
  for (const row of gameRows.value) {
    const name = row.name || row.gameCode
    if (editGeneral.value) {
      if (row.generalMinPct > row.generalMaxPct + 1e-9) return `${name} 总代下限不能高于上限`
      if (row.generalMinPct < row.agentMaxPct - 1e-9) return `${name} 总代下限不能低于代理上限`
      if (row.generalDefaultPct < row.generalMinPct - 1e-9 || row.generalDefaultPct > row.generalMaxPct + 1e-9) {
        return `${name} 总代默认须在下限～上限之间`
      }
    }
    if (editAgent.value) {
      if (row.agentMinPct > row.agentMaxPct + 1e-9) return `${name} 代理下限不能高于上限`
      if (row.agentMinPct < agentMinFloor(row) - 1e-9) return `${name} 代理下限不能低于玩家上限 ${pct(row.playerMaxPct)}`
      if (row.agentMaxPct > agentCapPct(row) + 1e-9) return `${name} 代理上限不能超过总代默认 ${pct(agentCapPct(row))}`
      if (row.agentDefaultPct < row.agentMinPct - 1e-9 || row.agentDefaultPct > row.agentMaxPct + 1e-9) {
        return `${name} 代理默认须在下限～上限之间`
      }
    }
    if (editPlayer.value) {
      if (row.playerMinPct > row.playerMaxPct + 1e-9) return `${name} 玩家下限不能高于上限`
      if (row.playerMinPct < row.capPlayerMinPct - 1e-9) return `${name} 玩家下限不能低于 ${pct(row.capPlayerMinPct)}`
      if (row.playerMaxPct > playerCapPct(row) + 1e-9) return `${name} 玩家上限不能超过代理默认 ${pct(playerCapPct(row))}`
      if (row.playerDefaultPct < row.playerMinPct - 1e-9 || row.playerDefaultPct > row.playerMaxPct + 1e-9) {
        return `${name} 玩家默认须在下限～上限之间`
      }
    }
  }
  return ''
})

function catLabel(c: string) {
  return REBATE_CATEGORY_LABEL[c] || c
}
function pct(n: number) {
  return Number((Number(n) || 0).toFixed(1))
}
function toPct(rate: number) {
  return Number(((Number(rate) || 0) * 100).toFixed(1))
}
function toRate(pctVal: number) {
  return Number((pctVal / 100).toFixed(4))
}
function agentCapPct(row: GameRow) {
  if (editGeneral.value) return row.generalDefaultPct
  return Math.min(row.capAgentMaxPct, row.generalDefaultPct)
}
function agentMinFloor(row: GameRow) {
  return Math.max(row.capAgentMinPct, row.playerMaxPct)
}
function playerCapPct(row: GameRow) {
  return Math.min(row.capPlayerMaxPct, row.agentDefaultPct, row.agentMaxPct)
}
function serialize() {
  return JSON.stringify(gameRows.value.map((r) => ({
    gameCode: r.gameCode,
    generalMinPct: r.generalMinPct,
    generalDefaultPct: r.generalDefaultPct,
    generalMaxPct: r.generalMaxPct,
    agentMinPct: r.agentMinPct,
    agentDefaultPct: r.agentDefaultPct,
    agentMaxPct: r.agentMaxPct,
    playerMinPct: r.playerMinPct,
    playerDefaultPct: r.playerDefaultPct,
    playerMaxPct: r.playerMaxPct,
  })))
}
function toRow(g: RebateGameRule): GameRow {
  return {
    ...g,
    generalMinPct: toPct(g.generalMin),
    generalDefaultPct: toPct(g.generalDefault),
    generalMaxPct: toPct(g.generalMax),
    agentMinPct: toPct(g.agentMin),
    agentDefaultPct: toPct(g.agentDefault),
    agentMaxPct: toPct(g.agentMax),
    playerMinPct: toPct(g.playerMin),
    playerDefaultPct: toPct(g.playerDefault),
    playerMaxPct: toPct(g.playerMax),
    capAgentMinPct: toPct(g.capAgentMin ?? g.adminAgentMin ?? g.agentMin),
    capAgentMaxPct: toPct(g.capAgentMax ?? g.adminAgentMax ?? g.agentMax),
    capPlayerMinPct: toPct(g.capPlayerMin ?? g.adminPlayerMin ?? g.playerMin),
    capPlayerMaxPct: toPct(g.capPlayerMax ?? g.adminPlayerMax ?? g.playerMax),
  }
}
function applyTemplate(cat: string) {
  const t = rebateFallbackForCategory(cat)
  for (const row of gameRows.value) {
    if (row.category !== cat) continue
    row.generalMinPct = toPct(t.generalMin)
    row.generalDefaultPct = toPct(t.generalDefault)
    row.generalMaxPct = toPct(t.generalMax)
    row.agentMinPct = toPct(t.agentMin)
    row.agentDefaultPct = toPct(t.agentDefault)
    row.agentMaxPct = toPct(t.agentMax)
    row.playerMinPct = toPct(t.playerMin)
    row.playerDefaultPct = toPct(t.playerDefault)
    row.playerMaxPct = toPct(t.playerMax)
  }
}

function startEdit() {
  snapshot.value = serialize()
  editing.value = true
}
async function cancelEdit() {
  if (dirty.value) {
    try {
      await ElMessageBox.confirm('修改还没保存，取消后会回到已生效数字。', '取消修改', {
        type: 'warning',
        confirmButtonText: '放弃修改',
      })
    } catch {
      return
    }
  }
  editing.value = false
  await load()
}

async function load() {
  loading.value = true
  try {
    const p = await consoleApi.rebatePolicy()
    canEdit.value = p.chain?.canEdit ?? 'none'
    gameRows.value = (p.games ?? []).map(toRow)
    snapshot.value = serialize()

    if (canEditSelfCommission.value && store.profile?.id) {
      try {
        const page = await consoleApi.agents({ page: 1, pageSize: 200 })
        const me = page.list?.find((a) => a.id === store.profile?.id)
        if (me?.commissionRate != null) {
          const cPct = Number((Number(me.commissionRate) * 100).toFixed(2))
          savedCommissionPct.value = cPct
          draftCommissionPct.value = cPct
        }
      } catch {
        /* ignore */
      }
    }
  } catch (e: unknown) {
    ElMessage.error((e as Error).message || '加载失败')
  } finally {
    loading.value = false
  }
}

async function save() {
  if (formError.value) {
    ElMessage.warning(formError.value)
    return
  }
  if (!dirty.value) {
    ElMessage.info('没有改动，无需保存')
    editing.value = false
    return
  }
  try {
    await ElMessageBox.confirm(
      editGeneral.value
        ? '确认保存？每个游戏的三层框会立即生效。'
        : editAgent.value
          ? '确认保存？代理、玩家会立即生效。总代是管理合同，不会改。'
          : '确认保存？玩家回水会立即生效。',
      '保存回水规则',
      {
        type: 'warning',
        confirmButtonText: '确认保存',
      },
    )
  } catch {
    return
  }
  saving.value = true
  try {
    const games = gameRows.value.map((r) => {
      const row: {
        gameCode: string
        generalMin?: number
        generalDefault?: number
        generalMax?: number
        agentMin?: number
        agentDefault?: number
        agentMax?: number
        playerMin?: number
        playerDefault?: number
        playerMax?: number
      } = { gameCode: r.gameCode }
      if (editGeneral.value) {
        row.generalMin = toRate(r.generalMinPct)
        row.generalDefault = toRate(r.generalDefaultPct)
        row.generalMax = toRate(r.generalMaxPct)
      }
      if (editAgent.value) {
        row.agentMin = toRate(r.agentMinPct)
        row.agentDefault = toRate(r.agentDefaultPct)
        row.agentMax = toRate(r.agentMaxPct)
      }
      if (editPlayer.value) {
        row.playerDefault = toRate(r.playerDefaultPct)
        if (showPlayerBounds.value) {
          row.playerMin = toRate(r.playerMinPct)
          row.playerMax = toRate(r.playerMaxPct)
        }
      }
      return row
    })
    await consoleApi.patchRebatePolicy({ games })
    ElMessage.success('已保存生效')
    savedOnce.value = true
    editing.value = false
    await load()
  } catch (e: unknown) {
    ElMessage.error(
      (e as { response?: { data?: { message?: string } }; message?: string })?.response?.data?.message
      || (e as Error).message
      || '保存失败',
    )
  } finally {
    saving.value = false
  }
}

function formatPreset(p: number) {
  return Number.isInteger(p) ? String(p) : p.toFixed(1)
}
function isDraftPreset(p: number) {
  return Math.abs(draftCommissionPct.value - p) < 1e-9
}
function setDraftCommission(pctVal: number) {
  draftCommissionPct.value = Number(pctVal.toFixed(2))
}

async function pickCustomCommission() {
  try {
    const { value } = await ElMessageBox.prompt(
      '填写下级佣金比例（0～20），填完后还需点「保存」',
      '自定义下级佣金',
      {
        confirmButtonText: '选用',
        cancelButtonText: '取消',
        inputValue: String(draftCommissionPct.value),
        inputPattern: /^(?:0|[1-9]\d?)(?:\.\d{1,2})?$|^20(?:\.0{1,2})?$/,
        inputErrorMessage: '请输入 0～20，最多两位小数',
      },
    )
    const cPct = Number(value)
    if (Number.isNaN(cPct) || cPct < 0 || cPct > 20) {
      ElMessage.warning('比例须在 0～20%')
      return
    }
    setDraftCommission(cPct)
  } catch {
    /* cancel */
  }
}

async function saveMyCommission() {
  const uid = store.profile?.id
  if (!uid) return
  if (!commDirty.value) {
    ElMessage.info('没有改动，无需保存')
    return
  }
  const cPct = draftCommissionPct.value
  try {
    await ElMessageBox.confirm(
      `确认保存下级佣金为 ${cPct.toFixed(2)}%？保存后立即对挂靠流水生效。`,
      '保存下级佣金',
      { type: 'warning', confirmButtonText: '确认保存', cancelButtonText: '取消' },
    )
  } catch {
    return
  }
  commSaving.value = true
  try {
    await consoleApi.setCommissionRate(uid, cPct / 100)
    savedCommissionPct.value = cPct
    draftCommissionPct.value = cPct
    ElMessage.success(`已保存：下级佣金 ${cPct.toFixed(2)}%`)
  } catch (e: unknown) {
    ElMessage.error(
      (e as { response?: { data?: { message?: string } }; message?: string })?.response?.data?.message
      || (e as Error).message
      || '保存失败',
    )
  } finally {
    commSaving.value = false
  }
}

onMounted(load)
</script>

<style scoped>
.rebate-page :deep(.ops-header) {
  margin: 0;
  padding: 14px 18px 12px;
  flex-shrink: 0;
}
.rooms-summary {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 0;
  flex-shrink: 0;
  border-bottom: 1px solid #e2e8f0;
  background: linear-gradient(180deg, #ffffff 0%, #f8fafc 100%);
}
.sum-chip {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  min-height: 48px;
  padding: 0 16px;
  border-right: 1px solid #f1f5f9;
  cursor: pointer;
}
.sum-chip:last-child { border-right: none; }
.sum-chip.on { background: #fff7ed; }
.sum-label { font-size: 12px; color: #64748b; white-space: nowrap; }
.sum-val {
  font-size: 18px;
  font-weight: 700;
  color: #0f172a;
  font-variant-numeric: tabular-nums;
}
.panel-toolbar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px 12px;
  padding: 10px 14px;
  background: linear-gradient(180deg, #ffffff 0%, #f8fafc 100%);
  border-bottom: 1px solid #e2e8f0;
  flex-shrink: 0;
}
.toolbar-note {
  margin-left: auto;
  font-size: 12px;
  color: #94a3b8;
}
.alert { margin: 12px 16px 0; }
.cat-block {
  margin: 14px 16px 18px;
  border: 1px solid var(--ops-border);
  border-radius: 12px;
  background: #fff;
  overflow: hidden;
}
.cat-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
  padding: 12px 14px;
  border-bottom: 1px solid #f1f5f9;
  background: #f8fafc;
}
.cat-title { font-weight: 700; }
.game-table { width: 100%; }
.g-name { font-weight: 650; }
.g-code { font-size: 12px; color: var(--ops-muted); }
.triple {
  display: flex;
  justify-content: center;
  align-items: baseline;
  gap: 10px;
  font-variant-numeric: tabular-nums;
}
.triple span { color: #94a3b8; font-size: 12px; }
.triple b { font-size: 16px; }
.triple-edit {
  display: flex;
  justify-content: center;
  gap: 8px;
  flex-wrap: wrap;
}
.triple-edit label {
  display: flex;
  flex-direction: column;
  gap: 2px;
  font-size: 11px;
  color: #94a3b8;
}
.triple-edit :deep(.el-input-number) { width: 92px; }
.one {
  font-size: 16px;
  font-variant-numeric: tabular-nums;
}
.one-edit {
  display: flex;
  justify-content: center;
}
.one-edit :deep(.el-input-number) { width: 108px; }
.stepper {
  display: inline-flex;
  align-items: center;
  gap: 10px;
}
.mine {
  min-width: 64px;
  text-align: center;
  font-size: 18px;
  font-variant-numeric: tabular-nums;
}
.comm {
  margin: 4px 16px 16px;
  border: 1px solid var(--ops-border);
  border-radius: 12px;
  padding: 14px 16px;
}
.comm-hd { display: flex; justify-content: space-between; align-items: flex-start; gap: 12px; }
.comm-title { font-weight: 700; }
.comm-status { margin: 10px 0; font-size: 13px; }
.comm-status.dirty { color: #d97706; }
.comm-status.ok { color: #15803d; }
.comm-presets { display: flex; flex-wrap: wrap; gap: 8px; }
.chip {
  border: 1px solid var(--ops-border);
  background: #fff;
  border-radius: 999px;
  padding: 4px 10px;
  cursor: pointer;
}
.chip.on { border-color: var(--el-color-primary); color: var(--el-color-primary); }
.chip.ghost { border-style: dashed; }
</style>
