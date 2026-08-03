<template>
  <div class="ops-page games-page" v-loading="loading">
    <PageHeader title="游戏管理" subtitle="平台游戏目录 · 上下架 · 限红 · 爆率版本">
      <template #actions>
        <el-button :loading="loading" @click="load">刷新</el-button>
      </template>
    </PageHeader>

    <div class="ops-kpi-row">
      <div class="ops-kpi is-ok">
        <div class="ops-kpi__label">上架中</div>
        <div class="ops-kpi__value">{{ counts.online }}</div>
      </div>
      <div class="ops-kpi is-warn">
        <div class="ops-kpi__label">维护中</div>
        <div class="ops-kpi__value">{{ counts.maint }}</div>
      </div>
      <div class="ops-kpi">
        <div class="ops-kpi__label">已下架</div>
        <div class="ops-kpi__value">{{ counts.offline }}</div>
      </div>
      <div class="ops-kpi" :class="{ 'is-danger': counts.noConfig > 0 }">
        <div class="ops-kpi__label">未配爆率</div>
        <div class="ops-kpi__value">{{ counts.noConfig }}</div>
      </div>
    </div>

    <section class="ops-panel schedule-block" v-if="opsSchedule">
      <div class="schedule-hd">
        <div>
          <div class="schedule-title">平台定时规则</div>
          <div class="schedule-sub">时区 {{ opsSchedule.timezone }} · 服务端自动执行</div>
        </div>
      </div>
      <div class="schedule-grid">
        <div v-for="item in opsSchedule.items" :key="item.key" class="schedule-item">
          <div class="schedule-time">{{ item.label }}</div>
          <div class="schedule-desc">{{ item.desc }}</div>
        </div>
      </div>
      <ul class="schedule-notes">
        <li v-for="(n, i) in opsSchedule.notes" :key="i">{{ n }}</li>
      </ul>
    </section>

    <section class="ops-panel">
      <div class="ops-filter" style="margin: 0 0 14px; padding: 0; border: none; box-shadow: none;">
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
          placeholder="搜名称 / 代码"
          style="width: 220px"
        />
      </div>

      <el-table :data="filteredGames" stripe empty-text="暂无游戏">
        <el-table-column label="游戏" min-width="160">
          <template #default="{ row }">
            <div class="g-name">{{ row.name }}</div>
            <div class="g-code">{{ row.code }}</div>
          </template>
        </el-table-column>
        <el-table-column label="类型" width="90">
          <template #default="{ row }">
            <el-tag size="small" effect="plain">{{ catLabel(row.category) }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="状态" width="130">
          <template #default="{ row }">
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
          <template #default="{ row }">{{ fmtNum(row.minBet) }} ~ {{ fmtNum(row.maxBet) }}</template>
        </el-table-column>
        <el-table-column label="目标 RTP" width="100">
          <template #default="{ row }">
            <template v-if="activeConfig(row)">
              {{ pct(activeConfig(row)!.rtp) }}
            </template>
            <span v-else class="danger-text">未配置</span>
          </template>
        </el-table-column>
        <el-table-column label="生效版本" width="100">
          <template #default="{ row }">
            <el-tag v-if="activeConfig(row)" size="small" type="success">
              v{{ activeConfig(row)!.version }}
            </el-tag>
            <span v-else class="muted">—</span>
          </template>
        </el-table-column>
        <el-table-column label="大厅顺序" width="140">
          <template #default="{ row }">
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
          <template #default="{ row }">
            <el-tag v-if="!activeConfig(row)" size="small" type="danger" effect="plain">缺爆率</el-tag>
            <el-tag v-else-if="row.status === 'ONLINE'" size="small" type="success" effect="plain">营业</el-tag>
            <el-tag v-else-if="row.status === 'MAINTENANCE'" size="small" type="warning" effect="plain">维护</el-tag>
            <span v-else class="muted">已下架</span>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="180" fixed="right">
          <template #default="{ row }">
            <el-button link type="primary" @click="openBasics(row)">基础设置</el-button>
            <el-button link type="primary" @click="openConfig(row)">爆率配置</el-button>
          </template>
        </el-table-column>
      </el-table>
    </section>

    <!-- 基础设置 -->
    <el-dialog v-model="basicsVisible" :title="`基础设置 · ${basicsGame?.name || ''}`" width="480px" destroy-on-close>
      <el-form label-width="96px">
        <el-form-item label="显示名称">
          <el-input v-model="basicsForm.name" maxlength="40" />
        </el-form-item>
        <el-form-item label="最小下注">
          <el-input-number v-model="basicsForm.minBet" :min="0.01" :precision="2" :step="1" style="width:100%" />
        </el-form-item>
        <el-form-item label="最大下注">
          <el-input-number v-model="basicsForm.maxBet" :min="1" :precision="2" :step="100" style="width:100%" />
        </el-form-item>
        <el-form-item label="大厅顺序">
          <div class="form-tip">在列表里用「上移 / 下移」调整，无需手填数字</div>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="basicsVisible = false">取消</el-button>
        <el-button type="primary" :loading="opLoading" @click="saveBasics">保存</el-button>
      </template>
    </el-dialog>

    <!-- 爆率配置 -->
    <el-dialog
      v-model="configVisible"
      :title="`爆率配置 · ${configGame?.name || ''}`"
      width="760px"
      destroy-on-close
      class="cfg-dlg"
    >
      <div class="cfg-sec">
        <div class="cfg-sec-hd">历史版本</div>
        <el-table :data="configHistory" size="small" stripe max-height="220">
          <el-table-column label="版本" prop="version" width="70" />
          <el-table-column label="目标 RTP" width="90">
            <template #default="{ row }">{{ pct(row.rtp) }}</template>
          </el-table-column>
          <el-table-column label="状态" width="90">
            <template #default="{ row }">
              <el-tag :type="row.active ? 'success' : 'info'" size="small">
                {{ row.active ? '生效中' : '历史' }}
              </el-tag>
            </template>
          </el-table-column>
          <el-table-column label="创建时间" min-width="160">
            <template #default="{ row }">{{ fmtTime(row.createdAt) }}</template>
          </el-table-column>
          <el-table-column label="操作" width="100">
            <template #default="{ row }">
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
            <span class="form-tip inline">玩家期望返还比例，如 0.95 = 95%</span>
          </el-form-item>

          <!-- SLOT / TABLE -->
          <template v-if="isArrayPayTable">
            <el-form-item label="奖项表">
              <div class="pay-toolbar">
                <el-button size="small" @click="addItem">增加奖项</el-button>
              </div>
              <el-table :data="newConfig.items" size="small" class="pay-table">
                <el-table-column label="奖项名" min-width="140">
                  <template #default="{ row }">
                    <el-input v-model="row.label" size="small" />
                  </template>
                </el-table-column>
                <el-table-column label="赔率(x)" width="120">
                  <template #default="{ row }">
                    <el-input-number v-model="row.multiplier" :min="0" :precision="2" size="small" style="width:100%" />
                  </template>
                </el-table-column>
                <el-table-column label="权重" width="120">
                  <template #default="{ row }">
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
                  <template #default="{ row }">
                    <el-input v-model="row.key" size="small" placeholder="如 big" />
                  </template>
                </el-table-column>
                <el-table-column label="赔率" width="140">
                  <template #default="{ row }">
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
                <el-table-column label="奖项键" min-width="140">
                  <template #default="{ row }">
                    <el-input v-model="row.key" size="small" />
                  </template>
                </el-table-column>
                <el-table-column label="权重" width="140">
                  <template #default="{ row }">
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
        <el-button type="primary" :loading="opLoading" @click="saveConfig">保存并激活</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import PageHeader from '@/components/PageHeader.vue'
import { gameAdminApi, type GameAdmin, type GameConfigAdmin, type GameOpsSchedule } from '@/api/admin'

const games = ref<GameAdmin[]>([])
const opsSchedule = ref<GameOpsSchedule | null>(null)
const loading = ref(false)
const opLoading = ref(false)
const sortBusy = ref(false)
const keyword = ref('')
const catFilter = ref('ALL')

const basicsVisible = ref(false)
const basicsGame = ref<GameAdmin | null>(null)
const basicsForm = reactive({
  name: '',
  minBet: 1,
  maxBet: 100000,
})

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
  return Number(n || 0).toLocaleString('zh-CN')
}
function fmtTime(s: string) {
  return new Date(s).toLocaleString('zh-CN', { hour12: false })
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

function openBasics(row: GameAdmin) {
  basicsGame.value = row
  basicsForm.name = row.name
  basicsForm.minBet = Number(row.minBet)
  basicsForm.maxBet = Number(row.maxBet)
  basicsVisible.value = true
}

async function saveBasics() {
  if (!basicsGame.value) return
  if (basicsForm.minBet > basicsForm.maxBet) {
    ElMessage.warning('最小下注不能大于最大下注')
    return
  }
  opLoading.value = true
  try {
    await gameAdminApi.updateBasics(basicsGame.value.code, { ...basicsForm })
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
.games-page { width: 100%; max-width: none; }
.schedule-block { margin-bottom: 14px; }
.schedule-hd { margin-bottom: 12px; }
.schedule-title { font-size: 14px; font-weight: 600; color: #303133; }
.schedule-sub { margin-top: 4px; font-size: 12px; color: #909399; }
.schedule-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 10px;
}
.schedule-item {
  padding: 12px 14px;
  background: #f5f7fa;
  border-radius: 8px;
}
.schedule-time { font-size: 13px; font-weight: 600; color: var(--ops-gold); }
.schedule-desc { margin-top: 6px; font-size: 12px; color: #606266; line-height: 1.5; }
.schedule-notes {
  margin: 12px 0 0;
  padding-left: 18px;
  font-size: 12px;
  color: #909399;
  line-height: 1.7;
}

.g-name { font-weight: 600; color: #303133; }
.g-code { margin-top: 2px; font-size: 12px; color: #909399; }
.sort-cell {
  display: flex;
  align-items: center;
  gap: 2px;
  flex-wrap: wrap;
}
.sort-no {
  min-width: 28px;
  font-variant-numeric: tabular-nums;
  color: #606266;
  font-weight: 600;
}
.muted { color: #c0c4cc; }
.danger-text { color: #f56c6c; }
.form-tip { margin-top: 4px; font-size: 12px; color: #909399; }
.form-tip.inline { margin: 0 0 0 10px; }

.cfg-sec { margin-bottom: 18px; }
.cfg-sec-hd {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 10px;
  font-size: 14px;
  font-weight: 600;
  color: #303133;
}
.cfg-sub { font-size: 12px; font-weight: 400; color: #909399; }
.pay-toolbar { margin-bottom: 8px; }
.pay-table { width: 100%; }

@media (max-width: 900px) {
  .stat-row { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .schedule-grid { grid-template-columns: 1fr; }
}
</style>
