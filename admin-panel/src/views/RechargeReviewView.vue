<template>
  <div class="ops-page">
    <PageHeader title="上下分审核" subtitle="玩家发起的上分/下分申请；通过后与控制台上下分同一套真分/飞盘规则" />

    <div class="ops-filter">
      <el-select v-model="filter.type" placeholder="全部类型" clearable style="width:140px" @change="load">
        <el-option label="上分" value="UP" /><el-option label="下分" value="DOWN" />
      </el-select>
      <el-select v-model="filter.status" placeholder="全部状态" clearable style="width:140px" @change="load">
        <el-option label="待审核" value="PENDING" />
        <el-option label="已通过" value="APPROVED" />
        <el-option label="已拒绝" value="REJECTED" />
      </el-select>
      <el-button type="primary" @click="load">查询</el-button>
    </div>

    <div class="ops-table-wrap">
      <el-table :data="list" v-loading="loading" stripe>
        <el-table-column label="订单号" prop="orderNo" width="200" />
        <el-table-column label="玩家" width="140">
          <template #default="{ row }">
            <div>{{ row.player.nickname }}</div>
            <div style="font-size:11px;color:#909399">{{ row.player.uid }}</div>
          </template>
        </el-table-column>
        <el-table-column label="类型" width="80">
          <template #default="{ row }">
            <el-tag :type="row.type === 'UP' ? 'success' : 'warning'">
              {{ row.type === 'UP' ? '上分' : '下分' }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="金额" prop="amount" width="120">
          <template #default="{ row }">
            <span style="font-weight:600;color:#e6a23c">{{ row.amount.toLocaleString() }}</span>
          </template>
        </el-table-column>
        <el-table-column label="状态" width="100">
          <template #default="{ row }">
            <el-tag :type="statusType(row.status)">{{ statusText(row.status) }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="渠道" prop="channel" width="80" />
        <el-table-column label="申请时间" width="160">
          <template #default="{ row }">{{ fmtTime(row.createdAt) }}</template>
        </el-table-column>
        <el-table-column label="操作" fixed="right" width="160">
          <template #default="{ row }">
            <template v-if="row.status === 'PENDING'">
              <el-button type="success" size="small" @click="approve(row)">通过</el-button>
              <el-button type="danger"  size="small" @click="openReject(row)">拒绝</el-button>
            </template>
            <span v-else style="color:#909399;font-size:12px">{{ row.rejectReason || '—' }}</span>
          </template>
        </el-table-column>
      </el-table>
      <el-pagination
        class="pager"
        :total="total"
        :page-size="filter.pageSize"
        :current-page="filter.page"
        layout="total,prev,pager,next"
        @current-change="(p: number) => { filter.page = p; load() }"
      />
    </div>

    <el-dialog v-model="rejectVisible" title="拒绝原因" width="400px">
      <el-input v-model="rejectReason" type="textarea" rows="3" placeholder="请输入拒绝原因" />
      <template #footer>
        <el-button @click="rejectVisible = false">取消</el-button>
        <el-button type="danger" :loading="opLoading" @click="doReject">确认拒绝</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, onMounted } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import PageHeader from '@/components/PageHeader.vue'
import { reviewApi, type ReviewOrder } from '@/api/admin'

const list = ref<ReviewOrder[]>([])
const total = ref(0)
const loading = ref(false)
const opLoading = ref(false)
const rejectVisible = ref(false)
const rejectReason = ref('')
const rejectTarget = ref<ReviewOrder | null>(null)

const filter = reactive({ type: '', status: '', page: 1, pageSize: 20 })

async function load() {
  loading.value = true
  try {
    const res = await reviewApi.list({ ...filter, type: filter.type || undefined, status: filter.status || undefined })
    list.value = res.list
    total.value = res.total
  } finally { loading.value = false }
}

async function approve(row: ReviewOrder) {
  await ElMessageBox.confirm(`确认通过该 ${row.type === 'UP' ? '上分' : '下分'} 订单？金额 ${row.amount}`, '确认操作', { type: 'warning' })
  opLoading.value = true
  try {
    await reviewApi.approve(row.id)
    ElMessage.success('已通过')
    load()
  } catch (e: unknown) {
    ElMessage.error((e as Error).message)
  } finally { opLoading.value = false }
}

function openReject(row: ReviewOrder) {
  rejectTarget.value = row
  rejectReason.value = ''
  rejectVisible.value = true
}

async function doReject() {
  if (!rejectTarget.value) return
  if (!rejectReason.value.trim()) { ElMessage.warning('请填写拒绝原因'); return }
  opLoading.value = true
  try {
    await reviewApi.reject(rejectTarget.value.id, rejectReason.value)
    ElMessage.success('已拒绝')
    rejectVisible.value = false
    load()
  } catch (e: unknown) {
    ElMessage.error((e as Error).message)
  } finally { opLoading.value = false }
}

function statusType(s: string) {
  return s === 'APPROVED' ? 'success' : s === 'REJECTED' ? 'danger' : 'warning'
}
function statusText(s: string) {
  return s === 'APPROVED' ? '已通过' : s === 'REJECTED' ? '已拒绝' : '待审核'
}
function fmtTime(s: string) {
  return new Date(s).toLocaleString('zh-CN', { hour12: false })
}

onMounted(load)
</script>

<style scoped>
.pager { margin-top: 14px; display: flex; justify-content: flex-end; }
</style>
