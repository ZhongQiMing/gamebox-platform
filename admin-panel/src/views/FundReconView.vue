<template>
  <div class="desk-work recon-page">
    <div class="desk-panel">
      <PageHeader title="资金对账">
        <template #actions>
          <el-button :loading="loading" @click="loadLast">刷新</el-button>
          <el-button type="primary" :loading="running" @click="runNow">立即对账</el-button>
        </template>
      </PageHeader>

      <div class="rooms-summary">
        <div class="sum-chip" :class="{ hot: report && !report.ok }">
          <span class="sum-label">对账结果</span>
          <span class="sum-val" :class="report ? (report.ok ? 'good' : 'hot') : ''">
            {{ report ? (report.ok ? '平账' : `${report.totalBad} 项差异`) : '未执行' }}
          </span>
        </div>
        <div class="sum-chip">
          <span class="sum-label">对账时间</span>
          <span class="sum-val small">{{ report ? fmtTime(report.checkedAt) : '—' }}</span>
        </div>
        <div class="sum-chip">
          <span class="sum-label">耗时</span>
          <span class="sum-val small">{{ report ? `${report.durationMs} ms` : '—' }}</span>
        </div>
        <div class="sum-chip">
          <span class="sum-label">自动对账</span>
          <span class="sum-val small">每日 05:00</span>
        </div>
        <div class="sum-chip" :class="{ hot: gate && !gate.allowed }">
          <span class="sum-label">出款闸门</span>
          <span class="sum-val" :class="gate ? (gate.allowed ? 'good' : 'hot') : ''">
            {{ gateText }}
          </span>
        </div>
      </div>

      <!-- 账本被破坏时一律禁止出款；正常波动（如信用盘偏离）只告警不拦 -->
      <el-alert
        v-if="gate && !gate.allowed"
        type="error"
        show-icon
        :closable="false"
        class="gate-alert"
      >
        <template #title>
          出款已自动拦截 · 检出 {{ gate.totalBad }} 项账务差异
        </template>
        <div class="gate-body">
          <dl class="gate-kv">
            <dt>触发项</dt>
            <dd>{{ (gate.blocking || []).join('；') }}</dd>
            <dt>影响范围</dt>
            <dd>玩家下分、后台出款</dd>
            <dt>不受影响</dt>
            <dd>下注、上分、结账</dd>
          </dl>
          <div class="gate-actions">
            <el-button type="warning" size="small" @click="openRelease">人工放行</el-button>
          </div>
        </div>
      </el-alert>

      <el-alert
        v-else-if="gate && gate.reason === 'released'"
        type="warning"
        show-icon
        :closable="false"
        class="gate-alert"
      >
        <template #title>
          出款人工放行中 · {{ fmtTime(gate.release?.expiresAt || '') }} 到期
        </template>
        <div class="gate-actions">
          <span class="gate-tip">放行原因：{{ gate.release?.reason }}</span>
          <el-button size="small" @click="revokeGate">立即撤销</el-button>
        </div>
      </el-alert>

      <div class="panel-body" v-loading="loading || running">
        <el-empty v-if="!report" description="暂无对账记录" />

        <template v-else>
          <!-- 检查项做成带表头的表格：文字长短不一时列宽仍是齐的，不会看着参差 -->
          <div class="check-block">
            <div class="check-head"><span class="check-name">检查项</span></div>
            <el-table :data="report.checks" stripe border size="small" class="check-table">
              <el-table-column prop="label" label="项目" min-width="240" show-overflow-tooltip />
              <el-table-column label="结果" width="120" align="center">
                <template #default="{ row }">
                  <el-tag :type="row.bad ? 'danger' : 'success'" size="small" effect="dark">
                    {{ row.bad ? `${row.bad} 项差异` : '平账' }}
                  </el-tag>
                </template>
              </el-table-column>
              <el-table-column label="出款影响" width="110" align="center">
                <template #default="{ row }">
                  <el-tag :type="row.gating ? 'warning' : 'info'" size="small" effect="plain">
                    {{ row.gating ? '拦截出款' : '仅告警' }}
                  </el-tag>
                </template>
              </el-table-column>
              <el-table-column label="处置说明" min-width="280" show-overflow-tooltip>
                <template #default="{ row }">
                  <span class="check-hint">{{ row.bad ? row.hint : '—' }}</span>
                </template>
              </el-table-column>
            </el-table>
          </div>

          <!-- 只有查出差异的项才往下列明细 -->
          <div v-for="c in badChecks" :key="c.key" class="check-block">
            <div class="check-head">
              <span class="check-name">{{ c.label }}</span>
              <el-tag type="danger" size="small" effect="dark">{{ c.bad }} 项差异</el-tag>
            </div>
            <el-table :data="c.rows" stripe border size="small" class="check-table">
              <el-table-column prop="label" label="账户" min-width="220" show-overflow-tooltip />
              <el-table-column label="账面余额" width="130" align="right">
                <template #default="{ row }">{{ money(row.actual) }}</template>
              </el-table-column>
              <el-table-column label="账本应有" width="130" align="right">
                <template #default="{ row }">{{ money(row.expected) }}</template>
              </el-table-column>
              <el-table-column label="差异" width="130" align="right">
                <template #default="{ row }">
                  <span class="drift" :class="row.drift > 0 ? 'up' : 'down'">
                    {{ row.drift > 0 ? '+' : '' }}{{ money(row.drift) }}
                  </span>
                </template>
              </el-table-column>
              <!--
                原先这一列有「补记差错调整」按钮，已连同后端接口一起删除：
                它只写流水不动余额，真相是「余额多了」时会把流水也改错，等于抹掉证据。
                对不上一律先查原因，再走正常上下分把钱调平。
              -->
            </el-table>
          </div>
        </template>

        <!-- 历次记录落库保存，重启不丢，用来回溯「从什么时候开始不平的」 -->
        <div class="check-block">
          <div class="check-head">
            <span class="check-name">对账历史</span>
          </div>
          <el-table :data="history" stripe border size="small" class="check-table" empty-text="暂无记录">
            <el-table-column label="对账时间" min-width="170">
              <template #default="{ row }">{{ fmtTime(row.checkedAt) }}</template>
            </el-table-column>
            <el-table-column label="触发" width="100" align="center">
              <template #default="{ row }">{{ triggerText(row.trigger) }}</template>
            </el-table-column>
            <el-table-column label="结果" width="130" align="center">
              <template #default="{ row }">
                <el-tag :type="row.ok ? 'success' : 'danger'" size="small" effect="dark">
                  {{ row.ok ? '平账' : `${row.totalBad} 项差异` }}
                </el-tag>
              </template>
            </el-table-column>
            <el-table-column label="耗时" width="100" align="right">
              <template #default="{ row }">{{ row.durationMs }} ms</template>
            </el-table-column>
          </el-table>
        </div>
      </div>
    </div>

    <DeskDialog v-model="releaseOpen" title="人工放行出款" width="520px">
      <el-alert type="error" :closable="false" show-icon class="mb16">
        账目当前存在差异，放行后将在未平账状态下继续出款，损失不可逆。
      </el-alert>

      <el-form label-position="top">
        <el-form-item label="放行原因" required>
          <el-input
            v-model="releaseReason"
            type="textarea"
            :rows="3"
            maxlength="200"
            show-word-limit
            placeholder="填写差异已查明的依据"
          />
        </el-form-item>
        <el-form-item label="放行时长" required>
          <el-select v-model="releaseHours" style="width: 100%">
            <el-option :value="1" label="1 小时" />
            <el-option :value="2" label="2 小时" />
            <el-option :value="6" label="6 小时" />
            <el-option :value="12" label="12 小时" />
            <el-option :value="24" label="24 小时" />
          </el-select>
        </el-form-item>
        <el-form-item label="管理员密码" required>
          <el-input
            v-model="releasePassword"
            type="password"
            show-password
            maxlength="64"
            autocomplete="off"
          />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="releaseOpen = false">取消</el-button>
        <span class="win-footer-grow" />
        <el-button type="warning" :loading="releaseLoading" @click="submitRelease">
          确认放行
        </el-button>
      </template>
    </DeskDialog>

  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import PageHeader from '@/components/PageHeader.vue'
import DeskDialog from '@/components/DeskDialog.vue'
import { formatDateTime, formatMoney } from '@gamebox/shared'
import {
  fundReconApi,
  type PayoutGate,
  type ReconHistoryItem,
  type ReconReport,
} from '@/api/admin'

const report = ref<ReconReport | null>(null)
const gate = ref<PayoutGate | null>(null)
const history = ref<ReconHistoryItem[]>([])
const loading = ref(false)
const running = ref(false)

const releaseOpen = ref(false)
const releaseLoading = ref(false)
const releaseReason = ref('')
const releaseHours = ref(2)
const releasePassword = ref('')

/** 只有查出差异的项才需要往下列明细 */
const badChecks = computed(() =>
  (report.value?.checks ?? []).filter((c) => c.bad > 0 && c.rows.length > 0),
)

const gateText = computed(() => {
  const g = gate.value
  if (!g) return '—'
  if (g.reason === 'released') return '人工放行中'
  if (!g.allowed) return '已拦截'
  if (g.reason === 'ok') return '正常'
  return '—'
})

function triggerText(t: string) {
  if (t === 'cron') return '定时'
  if (t === 'gate') return '出款前'
  return '手动'
}

async function loadGate() {
  try {
    gate.value = await fundReconApi.payoutGate()
  } catch {
    /* 闸门状态取不到不影响看对账结果 */
  }
}

async function loadHistory() {
  try {
    history.value = (await fundReconApi.history(1, 20)).items
  } catch {
    /* 历史取不到不影响主体 */
  }
}

async function loadLast() {
  loading.value = true
  try {
    const res = await fundReconApi.last()
    report.value = res.report
    if (res.gate) gate.value = res.gate
    await loadHistory()
  } catch (e) {
    ElMessage.error((e as Error).message || '读取对账结果失败')
  } finally {
    loading.value = false
  }
}

async function runNow() {
  running.value = true
  try {
    report.value = (await fundReconApi.run()).report
    ElMessage[report.value.ok ? 'success' : 'warning'](
      report.value.ok ? '对账完成，账目平衡' : `对账完成，检出 ${report.value.totalBad} 项差异`,
    )
    await Promise.all([loadGate(), loadHistory()])
  } catch (e) {
    ElMessage.error((e as Error).message || '对账失败')
  } finally {
    running.value = false
  }
}

function openRelease() {
  releaseReason.value = ''
  releasePassword.value = ''
  releaseHours.value = 2
  releaseOpen.value = true
}

async function submitRelease() {
  const reason = releaseReason.value.trim()
  if (reason.length < 4) {
    ElMessage.warning('放行原因不得少于 4 个字')
    return
  }
  const pwd = releasePassword.value.trim()
  if (!pwd) {
    ElMessage.warning('请输入管理员密码')
    return
  }
  releaseLoading.value = true
  try {
    const res = await fundReconApi.releaseGate(reason, releaseHours.value, pwd)
    ElMessage.success(`已放行 ${res.hours} 小时`)
    releaseOpen.value = false
    releasePassword.value = ''
    await loadGate()
  } catch (e) {
    ElMessage.error((e as Error).message || '放行失败')
  } finally {
    releaseLoading.value = false
  }
}

async function revokeGate() {
  try {
    await ElMessageBox.confirm('撤销后立即恢复拦截出款，确认？', '撤销放行', {
      type: 'warning',
    })
  } catch {
    return
  }
  try {
    await fundReconApi.revokeGate()
    ElMessage.success('已恢复拦截')
    await loadGate()
  } catch (e) {
    ElMessage.error((e as Error).message || '撤销失败')
  }
}

function money(n: number) {
  return formatMoney(n)
}
function fmtTime(s: string) {
  return formatDateTime(s)
}

onMounted(loadLast)
</script>

<style scoped>
.recon-page :deep(.ops-header) {
  margin: 0;
  padding: 14px 18px 12px;
  flex-shrink: 0;
}
.rooms-summary {
  display: grid;
  /* 多了「出款闸门」一格 */
  grid-template-columns: repeat(5, minmax(0, 1fr));
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
.sum-chip.hot { background: #fff7f7; }
.sum-label { font-size: 12px; color: #64748b; white-space: nowrap; }
.sum-val {
  font-size: 18px;
  font-weight: 700;
  color: #0f172a;
  font-variant-numeric: tabular-nums;
}
.sum-val.small { font-size: 13px; font-weight: 600; color: #475569; }
.sum-val.good { color: #16a34a; }
.sum-val.hot { color: #ef4444; }
.gate-alert {
  margin: 0;
  border-radius: 0;
  border-left: none;
  border-right: none;
}
.gate-actions {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-top: 6px;
}
.gate-tip { font-size: 12px; line-height: 1.6; }
.gate-body { margin-top: 6px; }
/* 触发项按「字段 / 值」对齐成两列，比整段话好扫 */
.gate-kv {
  display: grid;
  grid-template-columns: 68px minmax(0, 1fr);
  gap: 3px 10px;
  margin: 0;
  font-size: 12px;
  line-height: 1.6;
}
.gate-kv dt { color: #94a3b8; }
.gate-kv dd { margin: 0; color: #0f172a; overflow-wrap: anywhere; }
.panel-body {
  flex: 1;
  min-height: 0;
  padding: 0;
  overflow: auto;
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
.check-block { border-bottom: 1px solid #e2e8f0; }
.check-head {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 14px;
  background: linear-gradient(180deg, #ffffff 0%, #f8fafc 100%);
}
.check-name { font-size: 13px; font-weight: 650; color: #0f172a; }
.check-hint { font-size: 12px; color: #64748b; }
.check-table { width: 100%; }
.drift { font-weight: 700; font-variant-numeric: tabular-nums; }
.drift.up { color: #ef4444; }
.drift.down { color: #2563eb; }
.muted { font-size: 12px; color: #94a3b8; }
.mb16 { margin-bottom: 16px; }
.mt12 { margin-top: 12px; }
</style>
