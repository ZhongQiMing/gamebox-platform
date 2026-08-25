<template>
  <div class="desk-work games-page" v-loading="loading">
    <div class="desk-panel">
      <PageHeader title="游戏管理">
        <template #actions>
          <el-button
            v-if="counts.maint > 0"
            type="warning"
            :loading="restoring"
            @click="onRestoreAll"
          >
            全部恢复上架（{{ counts.maint }}）
          </el-button>
          <el-button :loading="loading" @click="load">刷新</el-button>
        </template>
      </PageHeader>

      <div class="rooms-summary">
        <div
          v-for="k in kpis"
          :key="k.label"
          class="sum-chip clickable"
          :class="[{ active: chipFilter === k.filter, hot: k.chipHot }]"
          @click="onChipClick(k.filter)"
        >
          <span class="sum-label">{{ k.label }}</span>
          <span class="sum-val" :class="k.valTone">{{ k.value }}</span>
        </div>
      </div>

      <div v-if="opsSchedule?.items?.length" class="schedule-bar">
        <span class="schedule-bar__label">平台定时</span>
        <span
          v-for="item in opsSchedule.items"
          :key="item.key"
          class="schedule-bar__item"
          :title="item.desc"
        >{{ item.label }}</span>
      </div>

      <div class="panel-toolbar">
        <el-radio-group v-model="catFilter" size="small">
          <el-radio-button label="ALL">全部</el-radio-button>
          <el-radio-button label="SLOT">电子</el-radio-button>
          <el-radio-button label="TABLE">棋牌</el-radio-button>
          <el-radio-button label="LOTTERY">彩票</el-radio-button>
          <el-radio-button label="ARCADE">街机</el-radio-button>
        </el-radio-group>
        <el-input
          v-model="keyword"
          clearable
          size="small"
          placeholder="搜名称 / 代码"
          class="filter-search"
        />
      </div>

      <div class="panel-body">
        <el-table
          :data="filteredGames"
          class="games-table"
          stripe
          border
          size="small"
          height="100%"
          empty-text="暂无游戏"
        >
          <el-table-column label="游戏" min-width="160">
            <template #default="{ row }: { row: any }">
              <div class="g-name">{{ row.name }}</div>
              <div class="g-code">{{ row.code }}</div>
            </template>
          </el-table-column>
          <el-table-column label="类型" width="90">
            <template #default="{ row }: { row: any }">
              <el-tag size="small" effect="plain">{{ catLabel(row.category) }}</el-tag>
            </template>
          </el-table-column>
          <el-table-column label="状态" width="130">
            <template #default="{ row }: { row: any }">
              <el-select
                :model-value="row.status"
                size="small"
                style="width: 110px"
                @change="(v: string) => onStatus(row, v)"
              >
                <el-option label="上架" value="ONLINE" />
                <el-option label="维护" value="MAINTENANCE" />
                <el-option label="下架" value="OFFLINE" />
              </el-select>
            </template>
          </el-table-column>
          <el-table-column label="限红" min-width="120">
            <template #default="{ row }: { row: any }">{{ fmtNum(row.minBet) }} ~ {{ fmtNum(row.maxBet) }}</template>
          </el-table-column>
          <el-table-column label="目标 RTP" width="100">
            <template #default="{ row }: { row: any }">
              <template v-if="activeConfig(row)">
                {{ pct(activeConfig(row)!.rtp) }}
              </template>
              <span v-else class="danger-text">未配置</span>
            </template>
          </el-table-column>
          <el-table-column label="生效版本" width="100">
            <template #default="{ row }: { row: any }">
              <el-tag v-if="activeConfig(row)" size="small" type="success">
                v{{ activeConfig(row)!.version }}
              </el-tag>
              <span v-else class="muted">—</span>
            </template>
          </el-table-column>
          <el-table-column label="大厅顺序" width="140">
            <template #default="{ row }: { row: any }">
              <div class="sort-cell">
                <span class="sort-no">#{{ lobbyRank(row) }}</span>
                <el-button
                  link
                  type="primary"
                  :disabled="sortBusy || !canMove(row, -1)"
                  @click="moveGame(row, -1)"
                >上移</el-button>
                <el-button
                  link
                  type="primary"
                  :disabled="sortBusy || !canMove(row, 1)"
                  @click="moveGame(row, 1)"
                >下移</el-button>
              </div>
            </template>
          </el-table-column>
          <el-table-column label="提醒" min-width="120">
            <template #default="{ row }: { row: any }">
              <el-tag v-if="!activeConfig(row)" size="small" type="danger" effect="plain">缺爆率</el-tag>
              <el-tag v-else-if="row.status === 'ONLINE'" size="small" type="success" effect="plain">营业</el-tag>
              <el-tag v-else-if="row.status === 'MAINTENANCE'" size="small" type="warning" effect="plain">维护</el-tag>
              <span v-else class="muted">已下架</span>
            </template>
          </el-table-column>
          <el-table-column label="操作" width="180" fixed="right">
            <template #default="{ row }: { row: any }">
              <el-button link type="primary" @click="openBasics(row)">基础设置</el-button>
              <el-button link type="primary" @click="openConfig(row)">爆率配置</el-button>
            </template>
          </el-table-column>
        </el-table>
      </div>
    </div>

    <!-- 基础设置：每个玩法单独限红 -->
    <DeskDialog
      v-model="basicsVisible"
      :title="`基础设置 · ${basicsGame?.name || ''}`"
      width="720px"
      dialog-class="gsc-param-dlg"
    >
      <el-form label-width="80px" class="basics-form">
        <el-form-item label="显示名称">
          <el-input v-model="basicsForm.name" maxlength="40" />
        </el-form-item>
        <div class="basics-fill">
          <span class="basics-fill-lab">填到全部玩法</span>
          <el-input-number v-model="basicsFill.minBet" :min="0.01" :precision="2" :step="1" />
          <span class="basics-fill-tilde">~</span>
          <el-input-number v-model="basicsFill.maxBet" :min="1" :precision="2" :step="100" />
          <el-button size="small" @click="applyBasicsFill">应用</el-button>
        </div>
        <el-table
          :data="basicsPlays"
          size="small"
          border
          stripe
          max-height="420"
          class="basics-table"
          v-loading="basicsLoading"
          empty-text="该游戏没有可单独设置的玩法"
        >
          <el-table-column label="玩法" min-width="180">
            <template #default="{ row }: { row: any }">
              <div class="cell-name">{{ row.label }}</div>
              <div class="cell-meta">{{ row.key }}<template v-if="row.hint"> · {{ row.hint }}</template></div>
            </template>
          </el-table-column>
          <el-table-column label="最小下注" width="160">
            <template #default="{ row }: { row: any }">
              <el-input-number v-model="row.minBet" :min="0.01" :precision="2" :step="1" size="small" style="width:100%" />
            </template>
          </el-table-column>
          <el-table-column label="最大下注" width="180">
            <template #default="{ row }: { row: any }">
              <el-input-number v-model="row.maxBet" :min="1" :precision="2" :step="100" size="small" style="width:100%" />
            </template>
          </el-table-column>
        </el-table>
      </el-form>
      <template #footer>
        <el-button @click="basicsVisible = false">取消</el-button>
        <span class="win-footer-grow" />
        <el-button type="primary" :loading="opLoading" @click="saveBasics">保存</el-button>
      </template>
    </DeskDialog>

    <!-- 爆率配置 -->
    <DeskDialog
      v-model="configVisible"
      :title="`爆率配置 · ${configGame?.name || ''}`"
      width="760px"
      dialog-class="cfg-dlg"
    >
      <div class="cfg-sec">
        <div class="cfg-sec-hd">历史版本</div>
        <el-table :data="configHistory" size="small" stripe max-height="220">
          <el-table-column label="版本" prop="version" width="70" />
          <el-table-column label="目标 RTP" width="90">
            <template #default="{ row }: { row: any }">{{ pct(row.rtp) }}</template>
          </el-table-column>
          <el-table-column label="状态" width="90">
            <template #default="{ row }: { row: any }">
              <el-tag :type="row.active ? 'success' : 'info'" size="small">
                {{ row.active ? '生效中' : '历史' }}
              </el-tag>
            </template>
          </el-table-column>
          <el-table-column label="创建时间" min-width="160">
            <template #default="{ row }: { row: any }">{{ fmtTime(row.createdAt) }}</template>
          </el-table-column>
          <el-table-column label="操作" width="100">
            <template #default="{ row }: { row: any }">
              <el-button
                v-if="!row.active"
                link
                type="warning"
                @click="activateVer(row.version)"
              >
                激活
              </el-button>
              <el-button link @click="loadPayTableFrom(row)">载入</el-button>
            </template>
          </el-table-column>
        </el-table>
      </div>

      <div class="cfg-sec">
        <div class="cfg-sec-hd">
          <span>新建版本</span>
          <span class="cfg-sub" v-if="isArrayPayTable">
            理论 RTP ≈ {{ pct(theoreticalRtp) }}
            <span v-if="rtpGapAbs >= 0.03" class="danger-text">（与目标偏差较大）</span>
          </span>
        </div>

        <el-form label-width="88px" size="default">
          <el-form-item label="目标 RTP">
            <el-input-number v-model="newConfig.rtp" :min="0.5" :max="0.99" :step="0.01" :precision="2" />
          </el-form-item>

          <!-- SLOT / TABLE -->
          <template v-if="isArrayPayTable">
            <el-form-item label="奖项表">
              <div class="pay-toolbar">
                <el-button size="small" @click="addItem">增加奖项</el-button>
              </div>
              <el-table :data="newConfig.items" size="small" class="pay-table">
                <el-table-column label="奖项名" min-width="140">
                  <template #default="{ row }: { row: any }">
                    <el-input v-model="row.label" size="small" />
                  </template>
                </el-table-column>
                <el-table-column label="赔率(x)" width="120">
                  <template #default="{ row }: { row: any }">
                    <el-input-number v-model="row.multiplier" :min="0" :precision="2" size="small" style="width:100%" />
                  </template>
                </el-table-column>
                <el-table-column label="权重" width="120">
                  <template #default="{ row }: { row: any }">
                    <el-input-number v-model="row.weight" :min="0" :precision="0" size="small" style="width:100%" />
                  </template>
                </el-table-column>
                <el-table-column width="60">
                  <template #default="{ $index }">
                    <el-button link type="danger" @click="newConfig.items.splice($index, 1)">删</el-button>
                  </template>
                </el-table-column>
              </el-table>
            </el-form-item>
          </template>

          <!-- LOTTERY -->
          <template v-else-if="configGame?.category === 'LOTTERY'">
            <el-form-item label="玩法赔率">
              <div class="pay-toolbar">
                <el-button size="small" @click="addLotteryRow">增加玩法</el-button>
              </div>
              <el-table :data="lotteryRows" size="small" class="pay-table">
                <el-table-column label="玩法键" min-width="140">
                  <template #default="{ row }: { row: any }">
                    <el-input v-model="row.key" size="small" placeholder="如 big" />
                  </template>
                </el-table-column>
                <el-table-column label="赔率" width="140">
                  <template #default="{ row }: { row: any }">
                    <el-input-number v-model="row.multiplier" :min="0.01" :precision="3" size="small" style="width:100%" />
                  </template>
                </el-table-column>
                <el-table-column width="60">
                  <template #default="{ $index }">
                    <el-button link type="danger" @click="lotteryRows.splice($index, 1)">删</el-button>
                  </template>
                </el-table-column>
              </el-table>
            </el-form-item>
          </template>

          <!-- ARCADE -->
          <template v-else-if="configGame?.category === 'ARCADE'">
            <el-form-item label="奖项权重">
              <div class="pay-toolbar">
                <el-button size="small" @click="addArcadeRow">增加奖项</el-button>
              </div>
              <el-table :data="arcadeRows" size="small" class="pay-table">
                <el-table-column label="奖项名" min-width="140">
                  <template #default="{ row }: { row: any }">
                    <el-input v-model="row.key" size="small" />
                  </template>
                </el-table-column>
                <el-table-column label="权重" width="140">
                  <template #default="{ row }: { row: any }">
                    <el-input-number v-model="row.weight" :min="0" :precision="0" size="small" style="width:100%" />
                  </template>
                </el-table-column>
                <el-table-column width="60">
                  <template #default="{ $index }">
                    <el-button link type="danger" @click="arcadeRows.splice($index, 1)">删</el-button>
                  </template>
                </el-table-column>
              </el-table>
            </el-form-item>
          </template>
        </el-form>
      </div>

      <template #footer>
        <el-button @click="configVisible = false">取消</el-button>
        <span class="win-footer-grow" />
        <el-button type="primary" :loading="opLoading" @click="saveConfig">保存并激活</el-button>
      </template>
    </DeskDialog>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import PageHeader from '@/components/PageHeader.vue'
import DeskDialog from '@/components/DeskDialog.vue'
import { formatDateTime, formatMoney } from '@gamebox/shared'
import { gameAdminApi, type GameAdmin, type GameConfigAdmin, type GameOpsSchedule } from '@/api/admin'

type BasicsPlayRow = { key: string; label: string; minBet: number; maxBet: number; hint?: string }

type ChipFilter = 'ONLINE' | 'MAINTENANCE' | 'OFFLINE' | 'noConfig' | ''

const games = ref<GameAdmin[]>([])
const opsSchedule = ref<GameOpsSchedule | null>(null)
const loading = ref(false)
const opLoading = ref(false)
const restoring = ref(false)
const sortBusy = ref(false)
const keyword = ref('')
const catFilter = ref('ALL')
const chipFilter = ref<ChipFilter>('')

const basicsVisible = ref(false)
const basicsLoading = ref(false)
const basicsGame = ref<GameAdmin | null>(null)
const basicsForm = reactive({
  name: '',
})
const basicsFill = reactive({
  minBet: 1,
  maxBet: 100000,
})
const basicsPlays = ref<BasicsPlayRow[]>([])

const configVisible = ref(false)
const configGame = ref<GameAdmin | null>(null)
const configHistory = ref<GameConfigAdmin[]>([])
const newConfig = reactive({
  rtp: 0.95,
  items: [{ label: '谢谢参与', multiplier: 0, weight: 40 }] as {
    label: string
    multiplier: number
    weight: number
  }[],
})
const lotteryRows = ref<{ key: string; multiplier: number }[]>([])
const arcadeRows = ref<{ key: string; weight: number }[]>([])

const counts = computed(() => {
  const list = games.value
  return {
    online: list.filter((g) => g.status === 'ONLINE').length,
    maint: list.filter((g) => g.status === 'MAINTENANCE').length,
    offline: list.filter((g) => g.status === 'OFFLINE').length,
    noConfig: list.filter((g) => !g.configs?.some((c) => c.active)).length,
  }
})

const kpis = computed(() => [
  {
    label: '上架中',
    value: counts.value.online,
    valTone: 'ok',
    filter: 'ONLINE' as const,
  },
  {
    label: '维护中',
    value: counts.value.maint,
    valTone: 'warn',
    filter: 'MAINTENANCE' as const,
  },
  {
    label: '已下架',
    value: counts.value.offline,
    valTone: '',
    filter: 'OFFLINE' as const,
  },
  {
    label: '未配爆率',
    value: counts.value.noConfig,
    valTone: counts.value.noConfig > 0 ? 'hot' : '',
    chipHot: counts.value.noConfig > 0,
    filter: 'noConfig' as const,
  },
])

function onChipClick(filter: Exclude<ChipFilter, ''>) {
  chipFilter.value = chipFilter.value === filter ? '' : filter
}

/** 大厅完整顺序（不受筛选影响） */
const lobbyOrdered = computed(() =>
  [...games.value].sort((a, b) => {
    const sa = Number(a.sortOrder ?? 0)
    const sb = Number(b.sortOrder ?? 0)
    if (sa !== sb) return sa - sb
    return a.code.localeCompare(b.code)
  }),
)

const filteredGames = computed(() => {
  const kw = keyword.value.trim().toLowerCase()
  return lobbyOrdered.value.filter((g) => {
    if (catFilter.value !== 'ALL' && g.category !== catFilter.value) return false
    if (chipFilter.value === 'ONLINE' && g.status !== 'ONLINE') return false
    if (chipFilter.value === 'MAINTENANCE' && g.status !== 'MAINTENANCE') return false
    if (chipFilter.value === 'OFFLINE' && g.status !== 'OFFLINE') return false
    if (chipFilter.value === 'noConfig' && activeConfig(g)) return false
    if (!kw) return true
    return g.name.toLowerCase().includes(kw) || g.code.toLowerCase().includes(kw)
  })
})

function lobbyRank(row: GameAdmin) {
  const i = lobbyOrdered.value.findIndex((g) => g.code === row.code)
  return i >= 0 ? i + 1 : '—'
}

function canMove(row: GameAdmin, dir: -1 | 1) {
  const i = lobbyOrdered.value.findIndex((g) => g.code === row.code)
  if (i < 0) return false
  const j = i + dir
  return j >= 0 && j < lobbyOrdered.value.length
}

async function moveGame(row: GameAdmin, dir: -1 | 1) {
  if (sortBusy.value || !canMove(row, dir)) return
  const list = [...lobbyOrdered.value]
  const i = list.findIndex((g) => g.code === row.code)
  const j = i + dir
  ;[list[i], list[j]] = [list[j], list[i]]
  sortBusy.value = true
  try {
    await gameAdminApi.reorder(list.map((g) => g.code))
    games.value = list.map((g, idx) => ({ ...g, sortOrder: idx + 1 }))
  } catch (e: unknown) {
    ElMessage.error(
      (e as { response?: { data?: { message?: string } }; message?: string })?.response?.data?.message
      || (e as Error).message
      || '调整顺序失败',
    )
  } finally {
    sortBusy.value = false
  }
}

/** 把旧数据整理成 1..N，避免空洞/重复 */
async function ensureSequentialOrder(list: GameAdmin[]) {
  const ordered = [...list].sort((a, b) => {
    const sa = Number(a.sortOrder ?? 0)
    const sb = Number(b.sortOrder ?? 0)
    if (sa !== sb) return sa - sb
    return a.code.localeCompare(b.code)
  })
  const dirty = ordered.some((g, i) => Number(g.sortOrder) !== i + 1)
  if (!dirty) return ordered.map((g, i) => ({ ...g, sortOrder: i + 1 }))
  await gameAdminApi.reorder(ordered.map((g) => g.code))
  return ordered.map((g, i) => ({ ...g, sortOrder: i + 1 }))
}

const isArrayPayTable = computed(() => {
  const c = configGame.value?.category
  return c === 'SLOT' || c === 'TABLE'
})

const theoreticalRtp = computed(() => {
  const items = newConfig.items
  const tw = items.reduce((s, i) => s + Number(i.weight || 0), 0)
  if (tw <= 0) return 0
  return items.reduce((s, i) => s + Number(i.weight || 0) * Number(i.multiplier || 0), 0) / tw
})

const rtpGapAbs = computed(() => Math.abs(theoreticalRtp.value - Number(newConfig.rtp || 0)))

function activeConfig(g: GameAdmin) {
  return g.configs?.find((c) => c.active)
}
function catLabel(c: string) {
  const map: Record<string, string> = {
    SLOT: '电子',
    TABLE: '棋牌',
    LOTTERY: '彩票',
    ARCADE: '街机',
  }
  return map[c] || c
}
function pct(n: number) {
  return `${(Number(n) * 100).toFixed(1)}%`
}
function fmtNum(n: number) {
  return formatMoney(n)
}
function fmtTime(s: string) {
  return formatDateTime(s)
}

async function load() {
  loading.value = true
  try {
    const [list, schedule] = await Promise.all([
      gameAdminApi.list(),
      gameAdminApi.opsSchedule().catch(() => null),
    ])
    games.value = await ensureSequentialOrder(list)
    if (schedule) opsSchedule.value = schedule
  } catch (e: unknown) {
    ElMessage.error((e as Error).message || '加载失败')
  } finally {
    loading.value = false
  }
}

async function onStatus(row: GameAdmin, status: string) {
  if (status === row.status) return
  if (status === 'ONLINE' && !activeConfig(row)) {
    ElMessage.warning('请先配置并激活爆率，再上架')
    return
  }
  const label = status === 'ONLINE' ? '上架' : status === 'MAINTENANCE' ? '维护' : '下架'
  try {
    await ElMessageBox.confirm(`确认将「${row.name}」设为${label}？`, '确认', { type: 'warning' })
    await gameAdminApi.setStatus(row.code, status)
    row.status = status
    ElMessage.success(`已${label}`)
  } catch (e: unknown) {
    if (e === 'cancel' || (e as { message?: string })?.message === 'cancel') return
    ElMessage.error(
      (e as { response?: { data?: { message?: string } }; message?: string })?.response?.data?.message
      || (e as Error).message
      || '操作失败',
    )
  }
}

async function onRestoreAll() {
  try {
    await ElMessageBox.confirm(
      '将把所有「维护中」且已配置爆率的游戏恢复为上架。房间里的「开放」开关不在此列。',
      '全部恢复上架',
      { type: 'warning', confirmButtonText: '恢复上架' },
    )
  } catch {
    return
  }
  restoring.value = true
  try {
    const res = await gameAdminApi.restoreOnline()
    ElMessage.success(res.restored ? `已恢复 ${res.restored} 款游戏上架` : '没有需要恢复的游戏')
    await load()
  } catch (e: unknown) {
    ElMessage.error((e as Error).message || '恢复失败')
  } finally {
    restoring.value = false
  }
}

async function openBasics(row: GameAdmin) {
  basicsGame.value = row
  basicsForm.name = row.name
  basicsFill.minBet = Number(row.minBet) || 1
  basicsFill.maxBet = Number(row.maxBet) || 100000
  basicsPlays.value = []
  basicsVisible.value = true
  basicsLoading.value = true
  try {
    const cat = await gameAdminApi.listPlays(row.code)
    basicsForm.name = cat.name || row.name
    basicsPlays.value = cat.plays.map((p) => ({
      key: p.key,
      label: p.label,
      minBet: Number(p.minBet),
      maxBet: Number(p.maxBet),
      hint: p.hint,
    }))
  } catch (e: unknown) {
    ElMessage.error((e as Error).message || '加载玩法失败')
    basicsVisible.value = false
  } finally {
    basicsLoading.value = false
  }
}

function applyBasicsFill() {
  if (basicsFill.minBet > basicsFill.maxBet) {
    ElMessage.warning('最小下注不能大于最大下注')
    return
  }
  for (const row of basicsPlays.value) {
    row.minBet = basicsFill.minBet
    row.maxBet = basicsFill.maxBet
  }
}

async function saveBasics() {
  if (!basicsGame.value) return
  if (!basicsPlays.value.length) {
    ElMessage.warning('没有可保存的玩法')
    return
  }
  for (const row of basicsPlays.value) {
    if (row.minBet > row.maxBet) {
      ElMessage.warning(`${row.label} 最小下注不能大于最大下注`)
      return
    }
  }
  const playLimits = Object.fromEntries(
    basicsPlays.value.map((p) => [p.key, { minBet: p.minBet, maxBet: p.maxBet }]),
  )
  opLoading.value = true
  try {
    await gameAdminApi.updateBasics(basicsGame.value.code, {
      name: basicsForm.name,
      playLimits,
    })
    ElMessage.success('已保存')
    basicsVisible.value = false
    await load()
  } catch (e: unknown) {
    ElMessage.error(
      (e as { response?: { data?: { message?: string } }; message?: string })?.response?.data?.message
      || (e as Error).message
      || '保存失败',
    )
  } finally {
    opLoading.value = false
  }
}

function resetPayEditors() {
  newConfig.rtp = 0.95
  newConfig.items = [{ label: '谢谢参与', multiplier: 0, weight: 40 }]
  lotteryRows.value = []
  arcadeRows.value = []
}

function loadPayTableFrom(cfg: GameConfigAdmin) {
  newConfig.rtp = cfg.rtp
  const pt = cfg.payTable
  if (isArrayPayTable.value && Array.isArray(pt)) {
    newConfig.items = pt.map((p) => {
      const row = p as { label?: string; multiplier?: number; weight?: number }
      return {
        label: String(row.label ?? ''),
        multiplier: Number(row.multiplier ?? 0),
        weight: Number(row.weight ?? 0),
      }
    })
    return
  }
  if (configGame.value?.category === 'LOTTERY' && pt && typeof pt === 'object' && !Array.isArray(pt)) {
    lotteryRows.value = Object.entries(pt as Record<string, unknown>).map(([key, val]) => {
      const multiplier = typeof val === 'number'
        ? val
        : Number((val as { multiplier?: number })?.multiplier ?? 0)
      return { key, multiplier }
    })
    return
  }
  if (configGame.value?.category === 'ARCADE' && pt && typeof pt === 'object') {
    const weights = (pt as { awardWeights?: Record<string, number> }).awardWeights || {}
    arcadeRows.value = Object.entries(weights).map(([key, weight]) => ({
      key,
      weight: Number(weight ?? 0),
    }))
  }
}

async function openConfig(row: GameAdmin) {
  configGame.value = row
  resetPayEditors()
  try {
    configHistory.value = await gameAdminApi.listConfigs(row.code)
    const cur = configHistory.value.find((c) => c.active) || configHistory.value[0]
    if (cur) loadPayTableFrom(cur)
    configVisible.value = true
  } catch (e: unknown) {
    ElMessage.error((e as Error).message || '加载配置失败')
  }
}

function addItem() {
  newConfig.items.push({ label: '新奖项', multiplier: 1, weight: 5 })
}
function addLotteryRow() {
  lotteryRows.value.push({ key: 'play', multiplier: 1.98 })
}
function addArcadeRow() {
  arcadeRows.value.push({ key: 'award', weight: 1 })
}

function buildPayTable(): unknown {
  const cat = configGame.value?.category
  if (cat === 'SLOT' || cat === 'TABLE') {
    if (!newConfig.items.length) throw new Error('请至少配置一个奖项')
    return newConfig.items.map((i) => ({
      label: i.label.trim() || '未命名',
      multiplier: Number(i.multiplier),
      weight: Number(i.weight),
    }))
  }
  if (cat === 'LOTTERY') {
    if (!lotteryRows.value.length) throw new Error('请至少配置一个玩法赔率')
    const obj: Record<string, number> = {}
    for (const r of lotteryRows.value) {
      const k = r.key.trim()
      if (!k) throw new Error('玩法键不能为空')
      obj[k] = Number(r.multiplier)
    }
    return obj
  }
  if (cat === 'ARCADE') {
    if (!arcadeRows.value.length) throw new Error('请至少配置一个奖项权重')
    const awardWeights: Record<string, number> = {}
    for (const r of arcadeRows.value) {
      const k = r.key.trim()
      if (!k) throw new Error('奖项键不能为空')
      awardWeights[k] = Number(r.weight)
    }
    return { awardWeights }
  }
  throw new Error('未知游戏类型')
}

async function saveConfig() {
  if (!configGame.value) return
  let payTable: unknown
  try {
    payTable = buildPayTable()
  } catch (e: unknown) {
    ElMessage.warning((e as Error).message)
    return
  }
  if (isArrayPayTable.value && rtpGapAbs.value >= 0.08) {
    try {
      await ElMessageBox.confirm(
        `理论 RTP（${pct(theoreticalRtp.value)}）与目标 RTP（${pct(newConfig.rtp)}）偏差较大，仍要保存并激活？`,
        '提示',
        { type: 'warning' },
      )
    } catch {
      return
    }
  }
  opLoading.value = true
  try {
    await gameAdminApi.createConfig(configGame.value.code, {
      rtp: newConfig.rtp,
      payTable,
    })
    ElMessage.success('已保存并激活新版本')
    configVisible.value = false
    await load()
  } catch (e: unknown) {
    ElMessage.error(
      (e as { response?: { data?: { message?: string } }; message?: string })?.response?.data?.message
      || (e as Error).message
      || '保存失败',
    )
  } finally {
    opLoading.value = false
  }
}

async function activateVer(version: number) {
  if (!configGame.value) return
  try {
    await ElMessageBox.confirm(`确认激活 v${version}？当前生效版本将被替换。`, '确认', {
      type: 'warning',
    })
    await gameAdminApi.activateConfig(configGame.value.code, version)
    ElMessage.success(`v${version} 已激活`)
    configHistory.value = await gameAdminApi.listConfigs(configGame.value.code)
    await load()
  } catch (e: unknown) {
    if (e === 'cancel') return
    ElMessage.error((e as Error).message || '激活失败')
  }
}

onMounted(load)
</script>

<style scoped>
.games-page :deep(.ops-header) {
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
}
.sum-chip:last-child { border-right: none; }
.sum-chip.clickable { cursor: pointer; }
.sum-chip.clickable:hover { background: #eff6ff; }
.sum-chip.active { background: #eff6ff; }
.sum-chip.hot { background: #fff7f7; }
.sum-label { font-size: 12px; color: #64748b; white-space: nowrap; }
.sum-val {
  font-size: 18px;
  font-weight: 700;
  color: #0f172a;
  font-variant-numeric: tabular-nums;
}
.sum-val.ok { color: #16a34a; }
.sum-val.warn { color: #f59e0b; }
.sum-val.hot { color: #ef4444; }

.schedule-bar {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 6px 14px;
  padding: 6px 16px;
  font-size: 12px;
  color: #64748b;
  background: #f8fafc;
  border-bottom: 1px solid #e2e8f0;
  flex-shrink: 0;
}
.schedule-bar__label {
  font-weight: 600;
  color: #475569;
  white-space: nowrap;
}
.schedule-bar__item {
  color: var(--ops-gold);
  font-weight: 600;
  white-space: nowrap;
}

.panel-toolbar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px 10px;
  padding: 10px 14px;
  background: linear-gradient(180deg, #ffffff 0%, #f8fafc 100%);
  border-bottom: 1px solid #e2e8f0;
  flex-shrink: 0;
}
.filter-search { width: 220px; }

.panel-body {
  flex: 1;
  min-height: 0;
  padding: 0;
  background: #fff;
}
.panel-body :deep(.el-table) {
  --el-table-header-bg-color: #f1f5f9;
  --el-table-row-hover-bg-color: #eff6ff;
}
.panel-body :deep(.el-table th.el-table__cell) {
  color: #475569;
  font-weight: 600;
  background: #f1f5f9 !important;
}
.games-table { width: 100%; }

.g-name { font-weight: 600; color: #0f172a; }
.g-code { margin-top: 2px; font-size: 12px; color: #64748b; }
.sort-cell {
  display: flex;
  align-items: center;
  gap: 2px;
  flex-wrap: wrap;
}
.sort-no {
  min-width: 28px;
  font-variant-numeric: tabular-nums;
  color: #475569;
  font-weight: 600;
}
.muted { color: #cbd5e1; }
.danger-text { color: #f56c6c; }

.cfg-sec { margin-bottom: 18px; }
.cfg-sec-hd {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 10px;
  font-size: 14px;
  font-weight: 600;
  color: #0f172a;
}
.cfg-sub { font-size: 12px; font-weight: 400; color: #64748b; }
.pay-toolbar { margin-bottom: 8px; }
.pay-table { width: 100%; }
.basics-form :deep(.el-form-item) { margin-bottom: 12px; }
.basics-fill {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  margin: 0 0 12px;
  padding: 8px 10px;
  background: #f8fafc;
  border: 1px solid #e2e8f0;
}
.basics-fill-lab { font-size: 12px; font-weight: 650; color: #475569; }
.basics-fill-tilde { color: #94a3b8; }
.basics-table { width: 100%; }
.cell-name { font-weight: 650; color: #0f172a; }
.cell-meta { margin-top: 2px; font-size: 12px; color: #64748b; }

@media (max-width: 900px) {
  .rooms-summary { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .sum-chip { border-bottom: 1px solid #f1f5f9; }
}
</style>
