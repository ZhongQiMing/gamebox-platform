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
          <span class="sum-label">对账结论</span>
          <span class="sum-val" :class="report ? (report.ok ? 'good' : 'hot') : ''">
            {{ report ? (report.ok ? '全部对得上' : `${report.totalBad} 处对不上`) : '尚未对账' }}
          </span>
        </div>
        <div class="sum-chip">
          <span class="sum-label">检查时间</span>
          <span class="sum-val small">{{ report ? fmtTime(report.checkedAt) : '—' }}</span>
        </div>
        <div class="sum-chip">
          <span class="sum-label">本次耗时</span>
          <span class="sum-val small">{{ report ? `${report.durationMs} ms` : '—' }}</span>
        </div>
        <div class="sum-chip">
          <span class="sum-label">自动执行</span>
          <span class="sum-val small">每天 05:00</span>
        </div>
      </div>

      <div class="panel-body" v-loading="loading || running">
        <el-empty v-if="!report" description="还没跑过对账，点右上角「立即对账」" />

        <template v-else>
          <div v-for="c in report.checks" :key="c.key" class="check-block">
            <div class="check-head">
              <span class="check-name">{{ c.label }}</span>
              <el-tag :type="c.bad ? 'danger' : 'success'" size="small" effect="dark">
                {{ c.bad ? `${c.bad} 条` : '通过' }}
              </el-tag>
              <span v-if="c.bad" class="check-hint">{{ c.hint }}</span>
            </div>

            <el-table
              v-if="c.rows.length"
              :data="c.rows"
              stripe
              border
              size="small"
              class="check-table"
            >
              <el-table-column prop="label" label="账户 / 代理" min-width="220" />
              <el-table-column label="账面" width="130" align="right">
                <template #default="{ row }">{{ money(row.actual) }}</template>
              </el-table-column>
              <el-table-column label="按流水应为" width="130" align="right">
                <template #default="{ row }">{{ money(row.expected) }}</template>
              </el-table-column>
              <el-table-column label="差额" width="130" align="right">
                <template #default="{ row }">
                  <span class="drift" :class="row.drift > 0 ? 'up' : 'down'">
                    {{ row.drift > 0 ? '+' : '' }}{{ money(row.drift) }}
                  </span>
                </template>
              </el-table-column>
              <el-table-column label="操作" width="150" align="center">
                <template #default="{ row }">
                  <el-button
                    v-if="c.fixable"
                    size="small"
                    type="primary"
                    plain
                    @click="openFix(c, row as ReconRow)"
                  >
                    补记差错调整
                  </el-button>
                  <span v-else class="muted">需人工处理</span>
                </template>
              </el-table-column>
            </el-table>
          </div>
        </template>
      </div>
    </div>

    <DeskDialog v-model="fixOpen" title="补记差错调整" width="520px">
      <template v-if="fixRow">
        <el-alert type="warning" :closable="false" show-icon class="mb16">
          这一步只写一条流水记录差额的来路，<b>不会改动账面余额</b>。
          先查清差额是怎么来的再填；如果确认要把钱退给谁，请另走正常上下分。
        </el-alert>

        <el-descriptions :column="1" border size="small" class="mb16">
          <el-descriptions-item label="对象">{{ fixRow.label }}</el-descriptions-item>
          <el-descriptions-item label="账面">{{ money(fixRow.actual) }}</el-descriptions-item>
          <el-descriptions-item label="按流水应为">{{ money(fixRow.expected) }}</el-descriptions-item>
          <el-descriptions-item label="将补记">
            <span class="drift" :class="fixRow.drift > 0 ? 'up' : 'down'">
              {{ fixRow.drift > 0 ? '+' : '' }}{{ money(fixRow.drift) }}
            </span>
          </el-descriptions-item>
        </el-descriptions>

        <el-input
          v-model="fixReason"
          type="textarea"
          :rows="3"
          maxlength="200"
          show-word-limit
          placeholder="必填：差额是怎么来的、查到了什么。这条以后是唯一能解释这笔差额的东西"
        />

        <el-input
          v-model="fixPassword"
          type="password"
          show-password
          class="mt12"
          maxlength="64"
          placeholder="管理员密码（补记要写进账本，须二次确认身份）"
        />
      </template>
      <template #footer>
        <el-button @click="fixOpen = false">取消</el-button>
        <span class="win-footer-grow" />
        <el-button type="primary" :loading="fixLoading" @click="submitFix">确认补记</el-button>
      </template>
    </DeskDialog>
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { ElMessage } from 'element-plus'
import PageHeader from '@/components/PageHeader.vue'
import DeskDialog from '@/components/DeskDialog.vue'
import { fundReconApi, type ReconCheck, type ReconReport, type ReconRow } from '@/api/admin'

const report = ref<ReconReport | null>(null)
const loading = ref(false)
const running = ref(false)

const fixOpen = ref(false)
const fixLoading = ref(false)
const fixReason = ref('')
const fixPassword = ref('')
const fixRow = ref<ReconRow | null>(null)
const fixCheck = ref<ReconCheck | null>(null)

async function loadLast() {
  loading.value = true
  try {
    report.value = (await fundReconApi.last()).report
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
      report.value.ok ? '对账通过，账目一致' : `发现 ${report.value.totalBad} 处对不上`,
    )
  } catch (e) {
    ElMessage.error((e as Error).message || '对账失败')
  } finally {
    running.value = false
  }
}

function openFix(check: ReconCheck, row: ReconRow) {
  fixCheck.value = check
  fixRow.value = row
  fixReason.value = ''
  fixPassword.value = ''
  fixOpen.value = true
}

async function submitFix() {
  if (!fixRow.value || !fixCheck.value) return
  const reason = fixReason.value.trim()
  if (reason.length < 4) {
    ElMessage.warning('请写清差额原因（至少 4 个字）')
    return
  }
  const pwd = fixPassword.value.trim()
  if (!pwd) {
    ElMessage.warning('请输入管理员密码')
    return
  }
  fixLoading.value = true
  try {
    const call = fixCheck.value.key === 'quota_sum' ? fundReconApi.fixQuota : fundReconApi.fixPoints
    await call(fixRow.value.id, reason, pwd)
    ElMessage.success('已补记，正在重新对账')
    fixOpen.value = false
    fixPassword.value = ''
    await runNow()
  } catch (e) {
    ElMessage.error((e as Error).message || '补记失败')
  } finally {
    fixLoading.value = false
  }
}

function money(n: number) {
  return n.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}
function fmtTime(s: string) {
  return new Date(s).toLocaleString('zh-CN', { hour12: false })
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
