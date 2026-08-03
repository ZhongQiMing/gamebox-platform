<template>
  <div class="page" v-loading="loading">
    <!-- 代理/子账号：跳转房间绑定代理页；无绑房时空态 -->
    <template v-if="unboundAgent">
      <PageHeader title="未绑定房间" subtitle="代理操作仅在房间「绑定代理」中进行">
        <template #actions>
          <el-button @click="router.push({ name: 'agents' })">返回账号中心</el-button>
          <el-button type="primary" @click="router.push({ name: 'rooms' })">去房间中心</el-button>
        </template>
      </PageHeader>
      <div class="empty-box">
        该账号尚未绑定房间。请先在房间中心创建房间（创建时会生成专属代理）。
      </div>
    </template>

    <!-- 房主详情：多房间可见权 -->
    <template v-else-if="detail && detail.role === 'BRANCH'">
      <PageHeader
        :title="detail.nickname || '房主详情'"
        :subtitle="`房主 · ${detail.username} · ${detail.uid}`"
      >
        <template #actions>
          <el-button @click="goBack">返回</el-button>
        </template>
      </PageHeader>

      <div class="cards">
        <div class="card"><div class="k">当前余额</div><div class="v gold">{{ fmt(detail.balance) }}</div></div>
        <div class="card"><div class="k">额度 / 已用</div><div class="v">{{ fmt(detail.pointsQuota) }} <span class="soft">/ {{ fmt(detail.pointsUsed) }}</span></div></div>
        <div class="card"><div class="k">绑定房间</div><div class="v">{{ detail.roomTotal ?? detail.rooms.length }}</div></div>
      </div>

      <section class="block">
        <div class="hd">
          <div class="hd-title">可见房间</div>
          <span class="hd-count">共 {{ detail.roomTotal ?? detail.rooms.length }} 间（近 8 间）</span>
        </div>
        <el-table v-if="detail.rooms.length" :data="detail.rooms" stripe size="small">
          <el-table-column label="房间" min-width="140">
            <template #default="{ row }">
              <div class="name">{{ row.name }}</div>
              <div class="meta">{{ row.roomNo }}</div>
            </template>
          </el-table-column>
          <el-table-column label="玩家" width="80" align="center">
            <template #default="{ row }">{{ row.memberCount ?? 0 }}</template>
          </el-table-column>
          <el-table-column label="游戏" width="80" align="center">
            <template #default="{ row }">{{ row.openGames ?? '—' }}</template>
          </el-table-column>
          <el-table-column label="状态" width="80">
            <template #default="{ row }">{{ statusLabel(row.status) }}</template>
          </el-table-column>
          <el-table-column label="月费" width="100">
            <template #default="{ row }">{{ fmt(row.monthlyFee) }}</template>
          </el-table-column>
          <el-table-column label="" width="90">
            <template #default="{ row }">
              <el-button link type="primary" @click="router.push({ name: 'room-detail', params: { id: row.id } })">打开</el-button>
            </template>
          </el-table-column>
        </el-table>
        <div v-else class="empty">
          暂无可见房间。
          <el-button link type="primary" @click="router.push({ name: 'rooms' })">去房间中心</el-button>
        </div>
      </section>
    </template>
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import PageHeader from '@/components/PageHeader.vue'
import { consoleApi, type AgentDetail } from '@/api/console'

const route = useRoute()
const router = useRouter()

const loading = ref(false)
const detail = ref<AgentDetail | null>(null)
const unboundAgent = ref(false)

function goBack() {
  router.push({ name: 'agents' })
}
function statusLabel(s: string) {
  return ({ OPEN: '营业', CLOSED: '关闭', MAINTENANCE: '维护' } as Record<string, string>)[s] || s
}
function fmt(n?: number) {
  return Number(n || 0).toLocaleString('zh-CN', { maximumFractionDigits: 2 })
}

async function load() {
  const id = String(route.params.id || '')
  if (!id) return
  loading.value = true
  unboundAgent.value = false
  detail.value = null
  try {
    const d = await consoleApi.agentDetail(id)
    if (d.role === 'AGENT' || d.role === 'PROXY') {
      const roomId = d.rooms?.[0]?.id
      if (roomId) {
        await router.replace({
          name: 'room-detail',
          params: { id: roomId },
          query: {
            tab: 'agent',
            ...(d.role === 'PROXY' ? { agentId: id } : {}),
          },
        })
        return
      }
      unboundAgent.value = true
      detail.value = d
      return
    }
    detail.value = d
  } catch (e: unknown) {
    ElMessage.error(
      (e as { response?: { data?: { message?: string } } })?.response?.data?.message
      || (e as Error).message
      || '加载失败',
    )
  } finally {
    loading.value = false
  }
}

watch(() => route.params.id, () => { void load() })
onMounted(() => { void load() })
</script>

<style scoped>
.page { width: 100%; }
.cards {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));
  gap: 12px;
  margin-bottom: 16px;
}
.card {
  background: var(--el-bg-color);
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 8px;
  padding: 12px 14px;
}
.card .k { font-size: 12px; color: var(--el-text-color-secondary); margin-bottom: 6px; }
.card .v { font-size: 18px; font-weight: 600; }
.card .v.gold { color: #c9a227; }
.card .soft { font-weight: 400; font-size: 14px; color: var(--el-text-color-secondary); }
.block {
  background: var(--el-bg-color);
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 8px;
  padding: 14px 16px;
  margin-bottom: 14px;
}
.hd {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  margin-bottom: 10px;
}
.hd-title { font-weight: 600; }
.hd-count { font-size: 12px; color: var(--el-text-color-secondary); }
.name { font-weight: 500; }
.meta { font-size: 12px; color: var(--el-text-color-secondary); }
.empty, .empty-box {
  padding: 24px 8px;
  color: var(--el-text-color-secondary);
  font-size: 14px;
}
.empty-box {
  margin-top: 12px;
  border: 1px dashed var(--el-border-color);
  border-radius: 8px;
  text-align: center;
}
</style>
