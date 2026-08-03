<template>
  <div class="ops-page rebate-page" v-loading="loading">
    <PageHeader title="回水规则" subtitle="总额 T 固定 · 玩家 P + 代理 A = T">
      <template #actions>
        <el-button :loading="loading" @click="load">刷新</el-button>
        <el-button v-if="isAdmin" type="primary" :loading="saving" @click="save">保存</el-button>
      </template>
    </PageHeader>

    <div class="ops-panel main-card">
      <div class="ops-kpi-row metric-row">
        <div class="ops-kpi">
          <div class="ops-kpi__label">总额 T</div>
          <div class="ops-kpi__value">{{ form.totalPct.toFixed(2) }}%</div>
        </div>
        <div class="ops-kpi is-ok">
          <div class="ops-kpi__label">玩家 P</div>
          <div class="ops-kpi__value" style="font-size:18px">{{ form.playerMinPct.toFixed(2) }}% ~ {{ (form.totalPct / 2).toFixed(2) }}%</div>
        </div>
        <div class="ops-kpi is-gold">
          <div class="ops-kpi__label">代理 A</div>
          <div class="ops-kpi__value" style="font-size:18px">{{ previewAPct.toFixed(2) }}%（随 P 变）</div>
        </div>
      </div>

      <div class="body-grid">
        <section class="panel">
          <div class="panel-title">平台设置</div>
          <p class="panel-sub">{{ isAdmin ? '保存后对所有房间生效' : '只读，由超管设定' }}</p>

          <div class="field-list">
            <div class="field-item">
              <div class="field-hd">
                <span>回水总额 T</span>
                <span class="field-unit">%</span>
              </div>
              <el-input-number
                v-model="form.totalPct"
                :min="0"
                :max="50"
                :step="0.1"
                :precision="2"
                :disabled="!isAdmin"
                controls-position="right"
                class="field-input"
              />
              <div class="field-tip">整盘返水比例，玩家 + 代理合计等于它</div>
            </div>

            <div class="field-item">
              <div class="field-hd">
                <span>玩家下限</span>
                <span class="field-unit">%</span>
              </div>
              <el-input-number
                v-model="form.playerMinPct"
                :min="0"
                :max="25"
                :step="0.1"
                :precision="2"
                :disabled="!isAdmin"
                controls-position="right"
                class="field-input"
              />
              <div class="field-tip">房间里设玩家回水时，不能低于此值</div>
            </div>

            <div class="field-item">
              <div class="field-hd">
                <span>玩家上限</span>
                <span class="field-unit">自动</span>
              </div>
              <div class="field-readonly">{{ (form.totalPct / 2).toFixed(2) }}% <span class="muted">= T ÷ 2</span></div>
              <div class="field-tip">保证代理至少一半，玩家不能超过 T/2</div>
            </div>
          </div>

          <el-alert
            v-if="formError"
            type="warning"
            :closable="false"
            show-icon
            :title="formError"
            class="form-alert"
          />
        </section>

        <section class="panel preview-panel">
          <div class="panel-title">分配预览</div>
          <p class="panel-sub">拖动看玩家拿多少时，代理剩多少</p>

          <div class="preview-ctrl">
            <span class="preview-label">玩家 P</span>
            <el-slider
              v-model="previewPPct"
              :min="sliderMin"
              :max="sliderMax"
              :step="0.1"
              :format-tooltip="(v: number) => `${Number(v).toFixed(2)}%`"
            />
            <b class="preview-val">{{ previewPPct.toFixed(2) }}%</b>
          </div>

          <div class="split-bar">
            <div class="split-p" :style="{ width: barPlayerWidth }" />
            <div class="split-a" :style="{ width: barAgentWidth }" />
          </div>
          <div class="split-legend">
            <span><i class="dot p" />玩家 {{ previewPPct.toFixed(2) }}%</span>
            <span><i class="dot a" />代理 {{ previewAPct.toFixed(2) }}%</span>
            <span class="muted">合计 {{ form.totalPct.toFixed(2) }}%</span>
          </div>

          <div class="example">
            <div class="example-hd">流水 10,000 时</div>
            <div class="example-grid">
              <div class="ex-item">
                <div class="ex-k">玩家</div>
                <div class="ex-v">{{ fmtMoney(examplePlayer) }}</div>
              </div>
              <div class="ex-item">
                <div class="ex-k">代理</div>
                <div class="ex-v gold">{{ fmtMoney(exampleAgent) }}</div>
              </div>
              <div class="ex-item">
                <div class="ex-k">合计</div>
                <div class="ex-v">{{ fmtMoney(exampleTotal) }}</div>
              </div>
            </div>
          </div>
        </section>
      </div>

      <div class="notes-row">
        <span><b>T</b> 整盘上限</span>
        <span><b>P</b> 房间游戏设置里单独调</span>
        <span><b>A</b> 自动 = T − P</span>
        <span>改规则后对新流水生效</span>
        <span v-if="!isAdmin">当前只读，改 T/下限请找超管</span>
      </div>
    </div>

    <section v-if="canEditSelfCommission" class="side-card">
      <div class="side-hd">
        <div>
          <div class="panel-title">我的挂靠抽成</div>
          <div class="panel-sub">从代理账户出，不占用回水池 T</div>
        </div>
        <el-button type="primary" size="small" :loading="commSaving" @click="saveMyCommission">保存</el-button>
      </div>
      <div class="comm-row">
        <el-input-number
          v-model="myCommissionPct"
          :min="0"
          :max="20"
          :step="0.1"
          :precision="2"
          controls-position="right"
        />
        <span class="field-unit">%</span>
        <span class="field-tip inline">默认 0.2%，与上面 T/P/A 无关</span>
      </div>
    </section>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import PageHeader from '@/components/PageHeader.vue'
import { consoleApi } from '@/api/console'
import { useAdminStore } from '@/stores/admin'

const store = useAdminStore()
const isAdmin = computed(() => store.profile?.role === 'ADMIN')
const canEditSelfCommission = computed(() =>
  ['AGENT'].includes(store.profile?.role || ''),
)

const loading = ref(false)
const saving = ref(false)
const commSaving = ref(false)

const form = reactive({
  totalPct: 5,
  playerMinPct: 1.8,
})
const previewPPct = ref(2.5)
const myCommissionPct = ref(0.2)

const sliderMin = computed(() => Number(form.playerMinPct.toFixed(2)))
const sliderMax = computed(() => Number((form.totalPct / 2).toFixed(2)))

const previewAPct = computed(() => Math.max(0, form.totalPct - previewPPct.value))
const barPlayerWidth = computed(() => {
  const t = form.totalPct || 1
  return `${Math.min(100, (previewPPct.value / t) * 100)}%`
})
const barAgentWidth = computed(() => {
  const t = form.totalPct || 1
  return `${Math.min(100, (previewAPct.value / t) * 100)}%`
})

const FLOW_DEMO = 10_000
const examplePlayer = computed(() => FLOW_DEMO * (previewPPct.value / 100))
const exampleAgent = computed(() => FLOW_DEMO * (previewAPct.value / 100))
const exampleTotal = computed(() => FLOW_DEMO * (form.totalPct / 100))

const formError = computed(() => {
  if (form.playerMinPct > form.totalPct / 2 + 1e-9) {
    return `玩家下限 ${form.playerMinPct}% 不能高于上限 T/2 = ${(form.totalPct / 2).toFixed(2)}%`
  }
  return ''
})

watch(
  () => [form.playerMinPct, form.totalPct] as const,
  () => {
    const lo = sliderMin.value
    const hi = Math.max(lo, sliderMax.value)
    if (previewPPct.value < lo) previewPPct.value = lo
    if (previewPPct.value > hi) previewPPct.value = hi
  },
)

function fmtMoney(n: number) {
  return Number(n || 0).toLocaleString('zh-CN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })
}

async function load() {
  loading.value = true
  try {
    const p = await consoleApi.rebatePolicy()
    form.totalPct = Number(((p.totalRate ?? 0.05) * 100).toFixed(2))
    form.playerMinPct = Number(((p.playerMinRate ?? p.minRate ?? 0.018) * 100).toFixed(2))
    const mid = (form.playerMinPct + form.totalPct / 2) / 2
    previewPPct.value = Number(mid.toFixed(2))

    if (canEditSelfCommission.value && store.profile?.id) {
      try {
        const page = await consoleApi.agents({ page: 1, pageSize: 200 })
        const me = page.list?.find((a) => a.id === store.profile?.id)
        if (me?.commissionRate != null) {
          myCommissionPct.value = Number((Number(me.commissionRate) * 100).toFixed(2))
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
  try {
    await ElMessageBox.confirm(
      `确认保存回水规则？总额 T=${form.totalPct}% 、玩家下限=${form.playerMinPct}%，将对全平台生效。`,
      '保存回水规则',
      { type: 'warning', confirmButtonText: '确认保存' },
    )
  } catch {
    return
  }
  saving.value = true
  try {
    const totalRateVal = form.totalPct / 100
    const playerMin = form.playerMinPct / 100
    await consoleApi.patchRebatePolicy({
      totalRate: totalRateVal,
      playerMinRate: playerMin,
      minRate: playerMin,
      maxRate: totalRateVal / 2,
    })
    ElMessage.success('回水规则已保存')
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

async function saveMyCommission() {
  const uid = store.profile?.id
  if (!uid) return
  commSaving.value = true
  try {
    await consoleApi.setCommissionRate(uid, myCommissionPct.value / 100)
    ElMessage.success('挂靠比例已保存')
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
.rebate-page { width: 100%; max-width: none; }
.main-card { padding-top: 4px; }
.metric-row { margin-bottom: 16px; padding-bottom: 4px; border-bottom: 1px solid var(--ops-border-soft); }

.body-grid {
  display: grid;
  grid-template-columns: minmax(280px, 1fr) minmax(320px, 1.2fr);
  gap: 24px 40px;
  align-items: stretch;
}
.panel { min-width: 0; display: flex; flex-direction: column; width: 100%; }
.panel-title { font-size: 14px; font-weight: 600; color: #1f2329; }
.panel-sub { margin: 4px 0 14px; font-size: 12px; color: #8f959e; }

.field-list { display: flex; flex-direction: column; gap: 16px; }
.field-item { display: flex; flex-direction: column; gap: 6px; }
.field-hd {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 13px;
  color: #606266;
}
.field-unit { font-size: 12px; color: #c0c4cc; }
.field-input { width: 180px; max-width: 100%; }
.field-readonly {
  min-height: 32px;
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 16px;
  font-weight: 650;
  color: #1f2329;
}
.field-tip { font-size: 12px; color: #a8abb2; line-height: 1.45; }
.field-tip.inline { margin-left: 4px; }
.muted { color: #c0c4cc; font-size: 12px; font-weight: 400; }
.form-alert { margin-top: 12px; }

.preview-panel {
  padding-left: 28px;
  border-left: 1px solid #f0f2f5;
  min-height: 100%;
}
.preview-ctrl {
  display: grid;
  grid-template-columns: auto 1fr auto;
  align-items: center;
  gap: 12px;
  margin-bottom: 14px;
}
.preview-label { font-size: 13px; color: #606266; white-space: nowrap; }
.preview-val {
  min-width: 56px;
  text-align: right;
  font-variant-numeric: tabular-nums;
  color: #409eff;
  font-size: 14px;
}

.split-bar {
  display: flex;
  height: 12px;
  border-radius: 999px;
  overflow: hidden;
  background: #f0f2f5;
}
.split-p { background: #67c23a; transition: width 0.15s ease; }
.split-a { background: #e6a23c; transition: width 0.15s ease; }
.split-legend {
  display: flex;
  flex-wrap: wrap;
  gap: 14px;
  margin-top: 10px;
  font-size: 12px;
  color: #606266;
}
.dot {
  display: inline-block;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  margin-right: 6px;
  vertical-align: middle;
}
.dot.p { background: #67c23a; }
.dot.a { background: #e6a23c; }

.example {
  margin-top: auto;
  padding-top: 16px;
}
.example-hd { font-size: 12px; color: #8f959e; margin-bottom: 8px; }
.example-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 8px;
  padding: 12px;
  background: #fafbfc;
  border-radius: 10px;
}
.ex-item { text-align: center; }
.ex-k { font-size: 12px; color: #8f959e; }
.ex-v {
  margin-top: 4px;
  font-size: 16px;
  font-weight: 700;
  color: #1f2329;
  font-variant-numeric: tabular-nums;
}
.ex-v.gold { color: #d4a93c; }

.notes-row {
  display: flex;
  flex-wrap: wrap;
  gap: 8px 16px;
  margin-top: 16px;
  padding-top: 14px;
  border-top: 1px solid #f0f2f5;
  font-size: 12px;
  color: #8f959e;
}
.notes-row b { color: #606266; font-weight: 600; }

.side-card {
  margin-top: 14px;
  padding: 16px 18px;
  background: #fff;
  border: 1px solid #eef0f3;
  border-radius: 12px;
}
.side-hd {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 12px;
  margin-bottom: 12px;
}
.comm-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
}
.field-unit { font-size: 13px; color: #606266; }

@media (max-width: 900px) {
  .body-grid { grid-template-columns: 1fr; gap: 20px; }
  .preview-panel { padding-left: 0; border-left: none; border-top: 1px solid #f0f2f5; padding-top: 16px; }
  .metric-plus { display: none; }
  .example-grid { grid-template-columns: 1fr; }
}
</style>
