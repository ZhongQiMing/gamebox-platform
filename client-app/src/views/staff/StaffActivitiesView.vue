<template>
  <div class="screen-deco" aria-hidden="true">
    <img class="cd cd-tl" src="/images/corner-flourish.webp" alt="">
    <img class="cd cd-tr" src="/images/corner-flourish.webp" alt="">
    <img class="cd cd-bl" src="/images/corner-flourish.webp" alt="">
    <img class="cd cd-br" src="/images/corner-flourish.webp" alt="">
  </div>

  <div class="page staff-console-page">
    <div class="app-bar">
      <div class="back" @click="router.back()">‹</div>
      <div class="title">活动中心</div>
      <div class="right"></div>
    </div>

    <div class="page-body">
      <section class="sc-panel">
        <p class="pwd-tip">{{ hint }}</p>
        <button type="button" class="pwd-submit" @click="openCreate">新建活动</button>
      </section>

      <section v-for="row in activities" :key="row.id" class="sc-panel">
        <p class="pwd-tip">{{ row.title }} · {{ typeLabel(row.type) }} · {{ row.status === 'ONLINE' ? '已上线' : '未上线' }}</p>
        <p class="pwd-tip">{{ row.publisherLabel || '管理' }} · {{ row.scopeLabel || scopeText(row) }} · 已领 {{ row.claimCount }} 人</p>
        <button v-if="row.canEdit" type="button" class="pwd-submit" @click="openEdit(row)">编辑</button>
        <p v-else class="pwd-tip">只读，只有发布人能改</p>
      </section>

      <section v-if="editing" class="sc-panel">
        <label class="pwd-label">标题</label>
        <input v-model="form.title" class="pwd-input" maxlength="40">
        <label class="pwd-label">类型</label>
        <select v-model="form.type" class="pwd-input">
          <option value="NEWBIE">新人礼</option>
          <option value="FIRST_DEPOSIT">首充</option>
          <option value="VIP">累计充值</option>
        </select>
        <template v-if="form.type === 'NEWBIE'">
          <label class="pwd-label">奖励</label>
          <input v-model.number="form.reward" class="pwd-input" type="number" min="0.01">
          <label class="pwd-label">多少小时内可领</label>
          <input v-model.number="form.expiresHours" class="pwd-input" type="number" min="1" max="720">
        </template>
        <template v-else>
          <div v-for="(t, i) in form.tiers" :key="i">
            <label class="pwd-label">第 {{ i + 1 }} 档：满 / 送</label>
            <input v-model.number="t.minDeposit" class="pwd-input" type="number" min="0">
            <input v-model.number="t.reward" class="pwd-input" type="number" min="0.01">
          </div>
          <button v-if="form.tiers.length < 8" type="button" class="pwd-submit" @click="form.tiers.push({ minDeposit: 0, reward: 1 })">加一档</button>
        </template>
        <label v-if="page?.canScopeAll" class="pwd-tip">
          <input
            type="checkbox"
            :checked="form.scopeMode === 'ALL'"
            @change="setAll"
          > 全部房间
        </label>
        <template v-if="form.scopeMode === 'PICKED'">
          <label v-if="page?.canPickGenerals" class="pwd-label">发到总代名下</label>
          <label v-for="g in page?.generals || []" :key="g.userId" class="pwd-tip">
            <input v-model="form.generalUserIds" type="checkbox" :value="g.userId"> {{ g.name }}
          </label>
          <label class="pwd-label">发到房间</label>
          <label v-for="r in page?.rooms || []" :key="r.id" class="pwd-tip">
            <input v-model="form.roomIds" type="checkbox" :value="r.id"> {{ r.roomNo }} {{ r.name }}
          </label>
        </template>
        <label class="pwd-tip">
          <input v-model="form.online" type="checkbox"> 上线后达到条件即可领取
        </label>
        <button type="button" class="pwd-submit" :disabled="saving" @click="save">{{ saving ? '保存中…' : '保存' }}</button>
      </section>
    </div>
    <StaffTabBar />
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { useRouter } from 'vue-router'
import staffHttp from '@/api/staffHttp'
import StaffTabBar from '@/components/StaffTabBar.vue'
import { useToast } from '@/composables/useToast'

interface RoomOpt { id: string; roomNo: string; name: string }
interface ActivityRow {
  id: string
  type: string
  title: string
  status: string
  config: { reward?: number; expiresHours?: number; tiers?: Array<{ minDeposit: number; reward: number }> }
  scopeMode: string
  claimCount: number
  canEdit?: boolean
  publisherLabel?: string
  scopeLabel?: string
  generalUserIds: string[]
  roomIds: string[]
}
interface PageData {
  fundLabel: string
  balance: number | null
  canScopeAll: boolean
  canPickGenerals: boolean
  activities: ActivityRow[]
  generals: Array<{ userId: string; name: string }>
  rooms: RoomOpt[]
}

const router = useRouter()
const { toast } = useToast()
const page = ref<PageData | null>(null)
const editing = ref(false)
const saving = ref(false)
const activities = computed(() => page.value?.activities || [])
const hint = computed(() => {
  const p = page.value
  if (!p) return '加载中…'
  const bal = p.balance == null ? '' : `，当前余额 ${p.balance}`
  return `领取从${p.fundLabel}扣出${bal}`
})

const form = reactive({
  id: '',
  title: '',
  type: 'NEWBIE',
  reward: 100,
  expiresHours: 72,
  tiers: [{ minDeposit: 100, reward: 20 }] as Array<{ minDeposit: number; reward: number }>,
  scopeMode: 'PICKED',
  generalUserIds: [] as string[],
  roomIds: [] as string[],
  online: false,
})

function typeLabel(t: string) {
  return { NEWBIE: '新人礼', FIRST_DEPOSIT: '首充', VIP: '累计充值' }[t] || t
}
function scopeText(row: ActivityRow) {
  if (row.scopeMode === 'ALL') return '全部房间'
  return `总代 ${row.generalUserIds.length} · 房间 ${row.roomIds.length}`
}
function fill(row?: ActivityRow) {
  form.id = row?.id || ''
  form.title = row?.title || ''
  form.type = row?.type || 'NEWBIE'
  form.reward = Number(row?.config?.reward ?? 100)
  form.expiresHours = Number(row?.config?.expiresHours ?? 72)
  form.tiers = (row?.config?.tiers?.length ? row.config.tiers : [{ minDeposit: 100, reward: 20 }])
    .map((t) => ({ minDeposit: Number(t.minDeposit), reward: Number(t.reward) }))
  form.scopeMode = row?.scopeMode || (page.value?.canScopeAll ? 'ALL' : 'PICKED')
  form.generalUserIds = [...(row?.generalUserIds || [])]
  form.roomIds = [...(row?.roomIds || [])]
  form.online = row?.status === 'ONLINE'
  editing.value = true
}
function setAll(ev: Event) {
  form.scopeMode = (ev.target as HTMLInputElement).checked ? 'ALL' : 'PICKED'
}
function openCreate() { fill() }
function openEdit(row: ActivityRow) { fill(row) }

async function load() {
  page.value = await staffHttp.get<PageData, PageData>('/console/activities')
}
async function save() {
  saving.value = true
  try {
    const body = {
      title: form.title,
      type: form.type,
      reward: form.reward,
      expiresHours: form.expiresHours,
      tiers: form.tiers,
      scopeMode: form.scopeMode,
      generalUserIds: form.generalUserIds,
      roomIds: form.roomIds,
      status: form.online ? 'ONLINE' : 'OFFLINE',
    }
    page.value = form.id
      ? await staffHttp.patch<PageData, PageData>(`/console/activities/${form.id}`, body)
      : await staffHttp.post<PageData, PageData>('/console/activities', body)
    editing.value = false
    toast('已保存')
  } catch (e: unknown) {
    toast((e as Error).message || '保存失败')
  } finally {
    saving.value = false
  }
}
onMounted(load)
</script>
