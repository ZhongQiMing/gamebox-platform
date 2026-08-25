<template>
  <div class="screen-deco" aria-hidden="true">
    <img class="cd cd-tl" src="/images/corner-flourish.webp" loading="lazy" decoding="async" alt="">
    <img class="cd cd-tr" src="/images/corner-flourish.webp" loading="lazy" decoding="async" alt="">
    <img class="cd cd-bl" src="/images/corner-flourish.webp" loading="lazy" decoding="async" alt="">
    <img class="cd cd-br" src="/images/corner-flourish.webp" loading="lazy" decoding="async" alt="">
  </div>

  <div class="page ag-page has-page-title">
    <div class="app-bar">
      <div class="back" @click="router.back()">‹</div>
      <div class="title">推 广 中 心</div>
      <div class="right"></div>
    </div>
    <h1 class="page-title">推 广 中 心</h1>

    <div class="page-body">
      <section class="ag-hero" v-if="overview">
        <div class="ag-hero-main">
          <div class="ag-hero-item">
            <div class="ag-hero-lab">今日佣金</div>
            <div class="ag-hero-val">{{ fmtInt(overview.todayCommission) }}</div>
          </div>
          <div class="ag-hero-split"></div>
          <div class="ag-hero-item">
            <div class="ag-hero-lab">累计佣金</div>
            <div class="ag-hero-val">{{ fmtInt(overview.totalCommission) }}</div>
          </div>
        </div>
      </section>

      <nav class="ag-seg" :class="{ 'ag-seg--3': overview?.canHang }">
        <button
          v-if="overview?.canHang"
          type="button"
          :class="{ 'is-on': tab === 'hang' }"
          @click="tab = 'hang'"
        >挂靠</button>
        <button type="button" :class="{ 'is-on': tab === 'team' }" @click="tab = 'team'">团队</button>
        <button type="button" :class="{ 'is-on': tab === 'comm' }" @click="tab = 'comm'">佣金</button>
      </nav>

      <div class="ag-panel" v-if="overview?.canHang && tab === 'hang'">
        <p class="ag-hang-tip">仅可挂本房玩家；挂靠按房间独立，跨房不返挂靠佣金。多房请在员工端按房间操作。</p>
        <div class="ag-form">
          <input v-model="friendUid" type="text" inputmode="numeric" maxlength="12" placeholder="好友玩家 ID">
          <input v-model="underUid" type="text" inputmode="numeric" maxlength="12" placeholder="挂到谁名下（推荐人 ID）">
          <button type="button" class="ag-submit" :disabled="hanging" @click="doHang">
            {{ hanging ? '提交中…' : '确认挂靠' }}
          </button>
        </div>
      </div>

      <div class="ag-panel" v-else-if="tab === 'team'">
        <div v-if="loading" class="ag-empty">加载中…</div>
        <div v-else-if="team.length === 0" class="ag-empty">暂无下级</div>
        <ul v-else class="ag-rows">
          <li v-for="m in team" :key="m.uid" class="ag-row">
            <div class="ag-row-l">
              <div class="ag-row-name">{{ m.nickname }}</div>
              <div class="ag-row-sub">{{ m.uid }} · 流水 {{ fmtInt(m.totalFlow) }}</div>
            </div>
            <div class="ag-row-r">+{{ fmtInt(m.myCommission) }}</div>
          </li>
        </ul>
      </div>

      <div class="ag-panel" v-else-if="tab === 'comm'">
        <div v-if="loading" class="ag-empty">加载中…</div>
        <div v-else-if="commissions.length === 0" class="ag-empty">暂无佣金</div>
        <ul v-else class="ag-rows">
          <li v-for="c in commissions" :key="c.id" class="ag-row">
            <div class="ag-row-l">
              <div class="ag-row-name">{{ c.sourceUser.nickname }}</div>
              <div class="ag-row-sub">L{{ c.level }} · {{ fmtDate(c.settledAt) }}</div>
            </div>
            <div class="ag-row-r">+{{ fmtInt(c.amount) }}</div>
          </li>
        </ul>
      </div>

      <div class="lobby-spacer"></div>
    </div>
  </div>

  <TabBar />
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { useToast } from '@/composables/useToast'
import { useBodyClass } from '@/composables/useBodyClass'
import { agentApi, type AgentOverview, type TeamMember, type CommissionItem } from '@/api/agent'
import { formatDateTime, formatMoney } from '@gamebox/shared'
import TabBar from '@/components/TabBar.vue'
import '@/assets/agent-center.css'

useBodyClass('deco-bg')

const router = useRouter()
const { toast } = useToast()

const overview = ref<AgentOverview | null>(null)
const team = ref<TeamMember[]>([])
const commissions = ref<CommissionItem[]>([])
const tab = ref<'hang' | 'team' | 'comm'>('team')
const loading = ref(true)
const hanging = ref(false)
const friendUid = ref('')
const underUid = ref('')

const fmtInt = (n: number) => formatMoney(n)

function fmtDate(s: string) {
  return formatDateTime(s)
}

async function doHang() {
  const f = friendUid.value.trim()
  const u = underUid.value.trim()
  if (!f || !u) { toast('请填写好友 ID 与推荐人 ID'); return }
  hanging.value = true
  try {
    const res = await agentApi.hang(f, u)
    toast(res.message || '挂靠成功')
    friendUid.value = ''
    underUid.value = ''
    const [ov, tm] = await Promise.all([agentApi.overview(), agentApi.team()])
    overview.value = ov
    team.value = tm.list
  } catch (e: unknown) {
    toast((e as Error).message || '挂靠失败')
  } finally {
    hanging.value = false
  }
}

onMounted(async () => {
  loading.value = true
  try {
    const [ov, tm, cm] = await Promise.all([
      agentApi.overview(),
      agentApi.team(),
      agentApi.commissions(),
    ])
    overview.value = ov
    team.value = tm.list
    commissions.value = cm.list
    if (ov.canHang) tab.value = 'hang'
  } catch (e: unknown) {
    toast((e as Error).message || '加载失败')
  } finally {
    loading.value = false
  }
})
</script>

<style scoped>
.ag-hang-tip {
  margin: 0 0 10px;
  font-size: 12px;
  line-height: 1.5;
  color: rgba(255, 255, 255, 0.55);
}
</style>
