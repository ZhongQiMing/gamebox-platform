<template>
  <div class="players-panel">
    <div class="ops-filter">
      <el-input v-model="q" placeholder="UID / 昵称 / 账号" clearable style="width:220px" @keyup.enter="load" />
      <el-button type="primary" @click="load">查询</el-button>
    </div>

    <div class="ops-table-wrap">
      <el-table :data="list" v-loading="loading" stripe empty-text="暂无玩家">
        <el-table-column prop="uid" label="UID" width="110" />
        <el-table-column prop="nickname" label="昵称" min-width="100" />
        <el-table-column prop="username" label="账号" min-width="100" />
        <el-table-column prop="balance" label="余额" width="120">
          <template #default="{ row }">{{ fmt(row.balance) }}</template>
        </el-table-column>
        <el-table-column label="状态" width="90">
          <template #default="{ row }">
            <el-tag :type="row.status === 'ACTIVE' ? 'success' : 'info'" size="small" effect="plain">
              {{ row.status === 'ACTIVE' ? '正常' : '停用' }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="360" fixed="right">
          <template #default="{ row }">
            <el-button link type="primary" @click="openCredit(row)">上分</el-button>
            <el-button link type="warning" @click="openDebit(row)">下分</el-button>
            <el-button v-if="canWritePlayer" link @click="toggleFly(row)">飞盘</el-button>
            <el-button v-if="canWritePlayer" link @click="editRebate(row)">回水%</el-button>
            <el-button
              v-if="canWritePlayer"
              link
              :type="row.status === 'ACTIVE' ? 'danger' : 'success'"
              @click="toggleStatus(row)"
            >
              {{ row.status === 'ACTIVE' ? '停用' : '启用' }}
            </el-button>
          </template>
        </el-table-column>
      </el-table>
      <el-pagination
        class="pager"
        background
        layout="prev, pager, next, total"
        :total="total"
        v-model:current-page="page"
        :page-size="pageSize"
        @current-change="load"
      />
    </div>

    <el-dialog v-model="dlg" :title="dlgTitle" width="440px" destroy-on-close align-center>
      <div v-if="mode === 'up'" class="flow-tip">
        <div class="flow-title">上分怎么走</div>
        <ol>
          <li>优先用主代理「真分额度」：扣代理余额 + 额度，同时加飞盘占用。</li>
          <li>额度不够的部分记为「假分」：只加玩家余额，不扣代理钱包。</li>
          <li>同一笔点两次也不会重复：本次操作带唯一请求号。</li>
        </ol>
      </div>
      <div v-else class="flow-tip">
        <div class="flow-title">下分怎么走</div>
        <ol>
          <li>从玩家扣回金额，加回主代理余额。</li>
          <li>在飞盘占用范围内，同步把真分额度加回。</li>
        </ol>
      </div>
      <el-form label-position="top">
        <el-form-item label="金额" required>
          <el-input-number
            v-model="amount"
            :min="mode === 'up' ? PLAYER_UP_MIN : PLAYER_DOWN_MIN"
            :max="PLAYER_FUND_MAX"
            :precision="0"
            style="width:100%"
          />
        </el-form-item>
        <el-form-item label="备注">
          <el-input v-model="remark" maxlength="40" placeholder="可选" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="dlg = false">取消</el-button>
        <el-button type="primary" :loading="saving" @click="submitMoney">
          {{ mode === 'up' ? '确认上分' : '确认下分' }}
        </el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { PLAYER_DOWN_MIN, PLAYER_FUND_MAX, PLAYER_UP_MIN } from '@gamebox/shared'
import { consoleApi } from '@/api/console'
import { useAdminStore } from '@/stores/admin'

const props = defineProps<{ roomId?: string }>()
const store = useAdminStore()
const canWritePlayer = computed(() => store.profile?.role === 'AGENT')

const q = ref('')
const list = ref<Array<{
  id: string; uid: string; nickname: string; username: string; balance: number; status: string
}>>([])
const loading = ref(false)
const page = ref(1)
const pageSize = 20
const total = ref(0)
const dlg = ref(false)
const dlgTitle = ref('')
const amount = ref(PLAYER_UP_MIN)
const remark = ref('')
const saving = ref(false)
const targetId = ref('')
const mode = ref<'up' | 'down'>('up')
const clientRequestId = ref('')

function fmt(n: number) {
  return Number(n || 0).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function newRequestId() {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID()
  return `ops_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`
}

async function load() {
  loading.value = true
  try {
    const res = await consoleApi.players({
      page: page.value,
      pageSize,
      q: q.value || undefined,
      roomId: props.roomId,
    })
    list.value = res.list
    total.value = res.total
  } finally {
    loading.value = false
  }
}

function openCredit(row: { id: string; nickname: string }) {
  targetId.value = row.id
  mode.value = 'up'
  dlgTitle.value = `上分 → ${row.nickname}`
  amount.value = PLAYER_UP_MIN
  remark.value = ''
  clientRequestId.value = newRequestId()
  dlg.value = true
}
function openDebit(row: { id: string; nickname: string }) {
  targetId.value = row.id
  mode.value = 'down'
  dlgTitle.value = `下分 ← ${row.nickname}`
  amount.value = PLAYER_DOWN_MIN
  remark.value = ''
  clientRequestId.value = newRequestId()
  dlg.value = true
}

async function submitMoney() {
  if (!(amount.value > 0)) return ElMessage.warning('请填写金额')
  if (mode.value === 'up') {
    if (amount.value < PLAYER_UP_MIN) return ElMessage.warning(`上分最低 ${PLAYER_UP_MIN}`)
    if (amount.value > PLAYER_FUND_MAX) return ElMessage.warning(`单笔上分不超过 ${PLAYER_FUND_MAX}`)
  } else {
    if (amount.value < PLAYER_DOWN_MIN) return ElMessage.warning(`下分最低 ${PLAYER_DOWN_MIN}`)
    if (amount.value > PLAYER_FUND_MAX) return ElMessage.warning(`单笔下分不超过 ${PLAYER_FUND_MAX}`)
  }
  const dir = mode.value === 'up' ? '上分' : '下分'
  try {
    await ElMessageBox.confirm(
      `是否确认给该玩家${dir} ${fmt(amount.value)}？`,
      `${dir}确认`,
      { type: 'warning', confirmButtonText: `确认${dir}`, cancelButtonText: '取消' },
    )
  } catch {
    return
  }
  saving.value = true
  try {
    const rid = clientRequestId.value || newRequestId()
    if (mode.value === 'up') {
      const res = await consoleApi.creditPlayer(targetId.value, amount.value, remark.value || undefined, rid) as {
        real?: number; fake?: number
      }
      const real = Number(res?.real ?? 0)
      const fake = Number(res?.fake ?? 0)
      ElMessage.success(fake > 0 ? `上分成功（真 ${fmt(real)} / 假 ${fmt(fake)}）` : '上分成功')
    } else {
      await consoleApi.debitPlayer(targetId.value, amount.value, remark.value || undefined, rid)
      ElMessage.success('下分成功')
    }
    dlg.value = false
    await load()
  } catch (e: unknown) {
    const msg = (e as { response?: { data?: { message?: string } }; message?: string })?.response?.data?.message
      || (e as { message?: string })?.message
    if (msg) ElMessage.error(msg)
  } finally {
    saving.value = false
  }
}

async function toggleStatus(row: { id: string; status: string }) {
  const next = row.status === 'ACTIVE' ? 'DISABLED' : 'ACTIVE'
  await consoleApi.setPlayerStatus(row.id, next)
  ElMessage.success('已更新')
  await load()
}

async function toggleFly(row: { id: string; nickname: string }) {
  try {
    await ElMessageBox.confirm(
      `${row.nickname}：确定后将关闭飞盘（只与代理结算）。`,
      '飞盘开关',
      {
        distinguishCancelAndClose: true,
        confirmButtonText: '关闭飞盘',
        cancelButtonText: '开启飞盘',
        type: 'warning',
      },
    )
    await consoleApi.setPlayerFly(row.id, false, props.roomId)
    ElMessage.success('已关闭飞盘')
  } catch (e: unknown) {
    if (e === 'cancel') {
      await consoleApi.setPlayerFly(row.id, true, props.roomId)
      ElMessage.success('已开启飞盘')
    }
  }
}

async function editRebate(row: { id: string; nickname: string }) {
  const { value } = await ElMessageBox.prompt(
    `设置 ${row.nickname} 回水比例（如 0.018）。不改则用代理默认回水。`,
    '玩家回水',
    {
      inputValue: '0.018',
      inputPattern: /^0\.\d+$/,
      inputErrorMessage: '请输入 0~1 小数',
    },
  )
  await consoleApi.setPlayerRebateRate(row.id, Number(value), props.roomId)
  ElMessage.success('已保存')
}

onMounted(load)
defineExpose({ load })
</script>

<style scoped>
.pager { margin-top: 12px; justify-content: flex-end; }
.flow-tip {
  margin-bottom: 14px;
  padding: 10px 12px;
  background: #fafbfc;
  border: 1px solid var(--ops-border-soft, #f0f2f5);
  border-radius: 8px;
  font-size: 12px;
  color: var(--ops-text-2, #606266);
  line-height: 1.55;
}
.flow-title { font-weight: 600; color: var(--ops-text, #1f2329); margin-bottom: 6px; }
.flow-tip ol { margin: 0; padding-left: 18px; }
</style>
