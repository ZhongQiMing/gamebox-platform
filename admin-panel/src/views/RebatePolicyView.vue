<template>
  <div class="desk-work rebate-page" v-loading="loading">
    <div class="desk-panel">
      <PageHeader title="回水规则">
        <template #actions>
          <el-button :loading="loading" @click="load">刷新</el-button>
          <el-button v-if="isAdmin" type="primary" :loading="saving" @click="save">保存</el-button>
        </template>
      </PageHeader>

      <div class="desk-panel__scroll">
        <section class="sheet">
          <div class="row">
            <div class="label">
              <div class="name">回水总额</div>
              <div class="desc">拿去分给玩家和代理的总比例</div>
            </div>
            <div class="ctrl">
              <el-input-number
                v-model="form.totalPct"
                :min="0"
                :max="50"
                :step="0.1"
                :precision="2"
                :disabled="!isAdmin"
                controls-position="right"
                class="num"
              />
              <span class="unit">%</span>
            </div>
          </div>

          <div class="row">
            <div class="label">
              <div class="name">玩家回水</div>
              <div class="desc">房间给玩家时，最低按这个比例</div>
            </div>
            <div class="ctrl">
              <el-input-number
                v-model="form.playerMinPct"
                :min="0"
                :max="25"
                :step="0.1"
                :precision="2"
                :disabled="!isAdmin"
                controls-position="right"
                class="num"
              />
              <span class="unit">%</span>
            </div>
          </div>

          <div class="row last">
            <div class="label">
              <div class="name">代理回水</div>
              <div class="desc">{{ form.totalPct.toFixed(2) }}% − {{ form.playerMinPct.toFixed(2) }}%</div>
            </div>
            <div class="ctrl">
              <b class="result">{{ agentPct.toFixed(2) }}</b>
              <span class="unit">%</span>
            </div>
          </div>
        </section>

        <el-alert
          v-if="formError"
          type="warning"
          :closable="false"
          show-icon
          :title="formError"
          class="alert"
        />

        <section v-if="canEditSelfCommission" class="comm">
          <div class="comm-hd">
            <div>
              <div class="comm-title">下级佣金</div>
              <div class="comm-desc">从代理回水中再分给下级</div>
            </div>
            <el-button
              type="primary"
              size="small"
              :disabled="!commDirty"
              :loading="commSaving"
              @click="saveMyCommission"
            >保存</el-button>
          </div>
          <div class="comm-status" :class="commDirty ? 'dirty' : 'ok'">
            <template v-if="commDirty">
              未保存 {{ draftCommissionPct.toFixed(2) }}% · 当前 {{ savedCommissionPct.toFixed(2) }}%
            </template>
            <template v-else>
              已生效 {{ savedCommissionPct.toFixed(2) }}%
            </template>
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
import { computed, onMounted, reactive, ref } from 'vue'
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
const savedCommissionPct = ref(0.2)
const draftCommissionPct = ref(0.2)
const commissionPresets = [0.1, 0.2, 0.5, 1, 2]
const commDirty = computed(
  () => Math.abs(draftCommissionPct.value - savedCommissionPct.value) > 1e-9,
)
const isCustomDraft = computed(
  () => !commissionPresets.some((p) => Math.abs(draftCommissionPct.value - p) < 1e-9),
)

const agentPct = computed(() =>
  Number(Math.max(0, form.totalPct - form.playerMinPct).toFixed(2)),
)

const formError = computed(() => {
  const maxP = form.totalPct / 2
  if (form.playerMinPct > maxP + 1e-9) {
    return `玩家回水 ${form.playerMinPct}% 不能超过总额的一半（${maxP.toFixed(2)}%）`
  }
  return ''
})

async function load() {
  loading.value = true
  try {
    const p = await consoleApi.rebatePolicy()
    form.totalPct = Number(((p.totalRate ?? 0.05) * 100).toFixed(2))
    form.playerMinPct = Number(((p.playerMinRate ?? p.minRate ?? 0.018) * 100).toFixed(2))

    if (canEditSelfCommission.value && store.profile?.id) {
      try {
        const page = await consoleApi.agents({ page: 1, pageSize: 200 })
        const me = page.list?.find((a) => a.id === store.profile?.id)
        if (me?.commissionRate != null) {
          const pct = Number((Number(me.commissionRate) * 100).toFixed(2))
          savedCommissionPct.value = pct
          draftCommissionPct.value = pct
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
      `确认保存回水规则？总额 ${form.totalPct}% 、玩家下限 ${form.playerMinPct}%，将对全平台生效。`,
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

function formatPreset(p: number) {
  return Number.isInteger(p) ? String(p) : p.toFixed(1)
}
function isDraftPreset(p: number) {
  return Math.abs(draftCommissionPct.value - p) < 1e-9
}
function setDraftCommission(pct: number) {
  draftCommissionPct.value = Number(pct.toFixed(2))
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
    const pct = Number(value)
    if (Number.isNaN(pct) || pct < 0 || pct > 20) {
      ElMessage.warning('比例须在 0～20%')
      return
    }
    setDraftCommission(pct)
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
  const pct = draftCommissionPct.value
  try {
    await ElMessageBox.confirm(
      `确认保存下级佣金为 ${pct.toFixed(2)}%？保存后立即对挂靠流水生效。`,
      '保存下级佣金',
      { type: 'warning', confirmButtonText: '确认保存', cancelButtonText: '取消' },
    )
  } catch {
    return
  }
  commSaving.value = true
  try {
    await consoleApi.setCommissionRate(uid, pct / 100)
    savedCommissionPct.value = pct
    draftCommissionPct.value = pct
    ElMessage.success(`已保存：下级佣金 ${pct.toFixed(2)}%`)
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

.sheet {
  max-width: 720px;
  background: #fff;
  border: 1px solid #e2e8f0;
  border-radius: 14px;
  overflow: hidden;
  box-shadow: 0 1px 2px rgba(15, 23, 42, 0.04);
}

.row {
  display: grid;
  grid-template-columns: minmax(140px, 1fr) auto;
  align-items: center;
  gap: 16px 24px;
  min-height: 76px;
  padding: 16px 20px;
  border-bottom: 1px solid #f1f5f9;
}
.row.last { border-bottom: 0; }
.row:hover { background: #fafbfc; }

.label { min-width: 0; }
.name {
  font-size: 14px;
  font-weight: 700;
  color: #0f172a;
  line-height: 1.3;
}
.desc {
  margin-top: 4px;
  font-size: 12px;
  color: #94a3b8;
  line-height: 1.3;
}

.ctrl {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
}
.num { width: 140px; }
.num :deep(.el-input__wrapper) {
  min-height: 40px;
  border-radius: 10px;
  box-shadow: 0 0 0 1px #e2e8f0 inset;
}
.num :deep(.el-input__inner) {
  font-size: 18px;
  font-weight: 750;
  color: #0f172a;
  font-variant-numeric: tabular-nums;
}
.unit {
  font-size: 13px;
  font-weight: 700;
  color: #64748b;
}
.result {
  font-size: 22px;
  font-weight: 750;
  color: #d97706;
  font-variant-numeric: tabular-nums;
  line-height: 1;
}

.alert {
  max-width: 720px;
  margin-top: 12px;
}

.comm {
  margin-top: 16px;
  max-width: 720px;
  padding: 16px 20px;
  background: #fff;
  border: 1px solid #e2e8f0;
  border-radius: 14px;
  box-shadow: 0 1px 2px rgba(15, 23, 42, 0.04);
}
.comm-hd {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
}
.comm-title {
  font-size: 14px;
  font-weight: 700;
  color: #0f172a;
}
.comm-desc {
  margin-top: 4px;
  font-size: 12px;
  color: #94a3b8;
}
.comm-status {
  margin: 12px 0;
  font-size: 13px;
}
.comm-status.ok { color: #16a34a; }
.comm-status.dirty { color: #d97706; }
.comm-presets {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.comm-presets.disabled { opacity: 0.6; pointer-events: none; }
.chip {
  appearance: none;
  min-width: 56px;
  height: 32px;
  padding: 0 12px;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  background: #fff;
  color: #475569;
  font-size: 13px;
  font-weight: 650;
  cursor: pointer;
}
.chip:hover:not(:disabled) {
  border-color: #cbd5e1;
  color: #0f172a;
}
.chip.on {
  border-color: #93c5fd;
  background: #eff6ff;
  color: #1d4ed8;
}
.chip.ghost { border-style: dashed; color: #94a3b8; }
.chip.ghost.on {
  border-style: solid;
  color: #1d4ed8;
}
.chip:disabled { cursor: default; }

@media (max-width: 640px) {
  .row {
    grid-template-columns: 1fr;
    gap: 10px;
    min-height: 0;
  }
}
</style>
