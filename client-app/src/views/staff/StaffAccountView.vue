<template>
  <div class="screen-deco" aria-hidden="true">
    <img class="cd cd-tl" src="/images/corner-flourish.webp" loading="lazy" decoding="async" alt="">
    <img class="cd cd-tr" src="/images/corner-flourish.webp" loading="lazy" decoding="async" alt="">
    <img class="cd cd-bl" src="/images/corner-flourish.webp" loading="lazy" decoding="async" alt="">
    <img class="cd cd-br" src="/images/corner-flourish.webp" loading="lazy" decoding="async" alt="">
  </div>

  <div class="page staff-console-page">
    <div class="app-bar">
      <div class="back" @click="router.back()">‹</div>
      <div class="title">账号资料</div>
      <div class="right"></div>
    </div>

    <div class="page-body">
      <section class="sc-panel sa-hero">
        <button type="button" class="sa-avatar-btn" :disabled="uploading" @click="pickAvatar">
          <span class="sa-avatar-wrap">
            <img class="sa-avatar" :src="avatarSrc" alt="">
          </span>
          <span class="sa-avatar-tip">{{ uploading ? '上传中…' : (isAgent ? '点击换房间图标' : '点击换头像') }}</span>
        </button>
        <div class="sa-hero-name">{{ staff.profile?.nickname || '—' }}</div>
        <div class="sa-hero-sub">{{ roleLabel }} · {{ staff.profile?.username || '—' }}</div>
        <div class="sa-hero-uid">UID {{ staff.profile?.uid || '—' }}</div>
      </section>

      <nav class="sc-panel sa-list">
        <button type="button" class="sa-row" @click="openNickname">
          <span class="sa-label">昵称</span>
          <span class="sa-value">
            <em>{{ staff.profile?.nickname || '—' }}</em>
            <i>›</i>
          </span>
        </button>
        <div class="sa-row idle">
          <span class="sa-label">账号</span>
          <span class="sa-value">
            <em class="muted">{{ staff.profile?.username || '—' }}</em>
          </span>
        </div>
        <div class="sa-row idle">
          <span class="sa-label">UID</span>
          <span class="sa-value">
            <em class="muted">{{ staff.profile?.uid || '—' }}</em>
          </span>
        </div>
        <button type="button" class="sa-row" @click="router.push({ name: 'staff-password' })">
          <span class="sa-label">修改密码</span>
          <span class="sa-value">
            <em class="muted">安全设置</em>
            <i>›</i>
          </span>
        </button>
      </nav>
    </div>

    <input
      ref="fileInput"
      type="file"
      accept="image/jpeg,image/png,image/webp"
      hidden
      @change="onFilePicked"
    >

    <div v-if="nickVisible" class="sp-sheet" @click.self="nickVisible = false">
      <div class="sp-sheet-panel">
        <h3>修改昵称</h3>
        <input
          v-model="nickDraft"
          type="text"
          maxlength="8"
          placeholder="2～8 个字"
          @keyup.enter="saveNickname"
        >
        <p class="hint">仅支持中文、字母、数字</p>
        <div class="sp-sheet-actions">
          <button type="button" class="cancel" :disabled="busy" @click="nickVisible = false">取消</button>
          <button type="button" class="ok" :disabled="busy" @click="saveNickname">保存</button>
        </div>
      </div>
    </div>
    <StaffTabBar />
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import staffHttp from '@/api/staffHttp'
import { staffConsoleApi } from '@/api/staffConsole'
import type { UserProfile } from '@/api/auth'
import StaffTabBar from '@/components/StaffTabBar.vue'
import { useStaffStore } from '@/stores/staff'
import { useUserStore } from '@/stores/user'
import { useToast } from '@/composables/useToast'
import { useBodyClass } from '@/composables/useBodyClass'
import '@/assets/staff-console.css'

useBodyClass('deco-bg')

const router = useRouter()
const staff = useStaffStore()
const user = useUserStore()
const { toast } = useToast()

const fileInput = ref<HTMLInputElement | null>(null)
const isAgent = computed(() => staff.role === 'AGENT')
const roomIcon = ref('')
const agentRoomId = ref('')
const DEFAULT_ROOM_ICON = '/images/rooms/default-room.png'
const uploading = ref(false)
const busy = ref(false)
const nickVisible = ref(false)
const nickDraft = ref('')

const avatarSrc = computed(() => {
  if (isAgent.value) return roomIcon.value || DEFAULT_ROOM_ICON
  return staff.profile?.avatar || '/images/avatars/001.jpg'
})
const roleLabel = computed(() => {
  if (staff.role === 'ADMIN') return '管理员'
  if (staff.role === 'BRANCH') return '房主'
  if (staff.role === 'AGENT') return '代理'
  if (staff.role === 'PROXY') return '子账号'
  if (staff.role === 'CS') return '客服'
  return staff.role || ''
})

function applyProfile(p: UserProfile) {
  staff.profile = p
  /* 进游戏期间玩家壳用的就是这张运营票，同步一份。
     网页版两边都没有可比的 token（凭证在 Cookie 里），只能看 play 态。 */
  if (staff.playActive) {
    user.profile = p
  }
}

async function loadAgentRoom() {
  if (!isAgent.value) return
  try {
    const list = await staffConsoleApi.rooms()
    const r = list?.[0]
    agentRoomId.value = r?.id || ''
    roomIcon.value = r?.icon || DEFAULT_ROOM_ICON
  } catch {
    agentRoomId.value = ''
    roomIcon.value = DEFAULT_ROOM_ICON
  }
}

onMounted(() => { void loadAgentRoom() })

function pickAvatar() {
  if (uploading.value) return
  if (isAgent.value && !agentRoomId.value) {
    toast('未绑定房间，无法更换图标')
    return
  }
  fileInput.value?.click()
}

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result || ''))
    reader.onerror = () => reject(new Error('读取失败'))
    reader.readAsDataURL(file)
  })
}

async function onFilePicked(e: Event) {
  const input = e.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file) return
  if (!/^image\/(jpeg|png|webp)$/i.test(file.type)) {
    toast('请选择 JPG / PNG / WEBP 图片')
    return
  }
  if (file.size > 800 * 1024) {
    toast('图片请小于 800KB')
    return
  }
  uploading.value = true
  try {
    const image = await readAsDataUrl(file)
    if (isAgent.value) {
      if (!agentRoomId.value) {
        toast('未绑定房间，无法更换图标')
        return
      }
      const res = await staffConsoleApi.uploadRoomIcon(agentRoomId.value, image)
      roomIcon.value = res.icon || DEFAULT_ROOM_ICON
      toast('房间图标已更新')
    } else {
      const profile = await staffHttp.patch<UserProfile, UserProfile>(
        '/users/me/avatar',
        { image },
        { timeout: 30000 },
      )
      applyProfile(profile)
      toast('头像已更新')
    }
  } catch (err: unknown) {
    toast(err instanceof Error ? err.message : '上传失败')
  } finally {
    uploading.value = false
  }
}

function openNickname() {
  nickDraft.value = staff.profile?.nickname || ''
  nickVisible.value = true
}

async function saveNickname() {
  const name = nickDraft.value.trim()
  if (name.length < 2 || name.length > 8) {
    toast('昵称需为 2～8 个字')
    return
  }
  if (busy.value) return
  busy.value = true
  try {
    const profile = await staffHttp.patch<UserProfile, UserProfile>(
      '/users/me/nickname',
      { nickname: name },
    )
    applyProfile(profile)
    nickVisible.value = false
    toast('昵称已更新')
  } catch (err: unknown) {
    toast(err instanceof Error ? err.message : '修改失败')
  } finally {
    busy.value = false
  }
}
</script>

<style scoped>
.sa-hero {
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  padding-top: 22px;
  padding-bottom: 20px;
}
.sa-avatar-btn {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  border: 0;
  background: transparent;
  color: inherit;
  cursor: pointer;
  padding: 0;
}
.sa-avatar-btn:disabled { opacity: 0.7; }
.sa-avatar-wrap {
  width: 84px;
  height: 84px;
  padding: 3px;
  border-radius: 50%;
  background:
    linear-gradient(#1a1208, #1a1208) padding-box,
    linear-gradient(160deg, #fff4c2, #d4a832 40%, #8a6818 70%, #f0d878) border-box;
  border: 2px solid transparent;
}
.sa-avatar {
  display: block;
  width: 100%;
  height: 100%;
  border-radius: 50%;
  object-fit: cover;
  background: rgba(0, 0, 0, 0.35);
}
.sa-avatar-tip {
  font-size: 11px;
  letter-spacing: 1px;
  color: rgba(244, 211, 107, 0.65);
}
.sa-hero-name {
  margin-top: 12px;
  font-size: 20px;
  font-weight: 800;
  letter-spacing: 2px;
  color: #f5d36b;
}
.sa-hero-sub {
  margin-top: 6px;
  font-size: 12px;
  color: var(--text-muted);
  letter-spacing: 1px;
}
.sa-hero-uid {
  margin-top: 4px;
  font-size: 12px;
  color: rgba(255, 244, 194, 0.55);
  font-variant-numeric: tabular-nums;
  letter-spacing: 1px;
}

.sa-list {
  padding: 0;
  overflow: hidden;
}
.sa-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  width: 100%;
  min-height: 54px;
  padding: 0 16px;
  border: 0;
  border-bottom: 1px solid rgba(244, 211, 107, 0.1);
  background: transparent;
  color: inherit;
  text-align: left;
  cursor: pointer;
}
.sa-row:last-child { border-bottom: 0; }
.sa-row:not(.idle):active { background: rgba(244, 211, 107, 0.06); }
.sa-row.idle { cursor: default; }
.sa-label {
  font-size: 15px;
  letter-spacing: 1px;
  color: #fff4c2;
}
.sa-value {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}
.sa-value em {
  font-style: normal;
  font-size: 14px;
  color: rgba(255, 244, 194, 0.85);
  max-width: 160px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.sa-value em.muted {
  color: rgba(244, 211, 107, 0.5);
}
.sa-value i {
  font-style: normal;
  font-size: 16px;
  color: rgba(212, 175, 55, 0.45);
}
</style>
