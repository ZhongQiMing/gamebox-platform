<template>
  <div class="screen-deco" aria-hidden="true">
    <img class="cd cd-tl" src="/images/corner-flourish.png" alt="">
    <img class="cd cd-tr" src="/images/corner-flourish.png" alt="">
    <img class="cd cd-bl" src="/images/corner-flourish.png" alt="">
    <img class="cd cd-br" src="/images/corner-flourish.png" alt="">
  </div>

  <div class="page am-page">
    <div class="app-bar">
      <div class="back" @click="router.back()">‹</div>
      <div class="title">账 号 管 理</div>
      <div class="right"></div>
    </div>

    <div class="page-body">
      <h1 class="am-title">账 号 管 理</h1>

      <div class="am-list">
        <button type="button" class="am-row" @click="pickAvatar">
          <span class="am-label">个 人 头 像</span>
          <div class="am-value">
            <img class="am-avatar" :src="avatarSrc" alt="">
            <span class="am-arrow">›</span>
          </div>
        </button>

        <button type="button" class="am-row" @click="openNickname">
          <span class="am-label">修 改 昵 称</span>
          <div class="am-value">
            <span class="am-text">{{ userStore.profile?.nickname ?? '———' }}</span>
            <span class="am-arrow">›</span>
          </div>
        </button>

        <button type="button" class="am-row" @click="router.push('/password')">
          <span class="am-label">修 改 密 码</span>
          <div class="am-value">
            <span class="am-text-muted">前往修改</span>
            <span class="am-arrow">›</span>
          </div>
        </button>

        <div class="am-row am-row--switch">
          <span class="am-label">点 击 音 效</span>
          <div class="am-value">
            <label class="am-switch">
              <input type="checkbox" v-model="soundOn" @change="onSoundChange">
              <span class="am-switch-track"><span class="am-switch-thumb"></span></span>
            </label>
          </div>
        </div>

        <div class="am-row am-row--switch">
          <span class="am-label">背 景 音 乐</span>
          <div class="am-value">
            <label class="am-switch">
              <input type="checkbox" v-model="bgmOn" @change="onBgmChange">
              <span class="am-switch-track"><span class="am-switch-thumb"></span></span>
            </label>
          </div>
        </div>
      </div>

      <div class="lobby-spacer"></div>
    </div>
  </div>

  <input
    ref="fileInput"
    type="file"
    accept="image/jpeg,image/png,image/webp"
    class="am-file-hidden"
    @change="onFilePicked"
  >

  <AppModal
    :visible="showNickModal"
    title="修改昵称"
    ok-text="保存"
    cancel-text="取消"
    @ok="saveNickname"
    @cancel="showNickModal = false"
  >
    <input
      v-model="nickDraft"
      class="am-nick-input"
      maxlength="8"
      placeholder="2～8 个字"
      @keyup.enter="saveNickname"
    >
    <p class="am-nick-hint">仅支持中文、字母、数字；全站唯一</p>
  </AppModal>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { useUserStore } from '@/stores/user'
import { useToast } from '@/composables/useToast'
import { useBodyClass } from '@/composables/useBodyClass'
import { userApi } from '@/api/user'
import { isClickSoundOn, setClickSoundOn, isAppBgmOn, setAppBgmOn } from '@/composables/appSoundPrefs'
import { useClickSound } from '@/composables/useClickSound'
import AppModal from '@/components/AppModal.vue'
import '@/assets/account-manage.css'

useBodyClass('deco-bg')

const router = useRouter()
const userStore = useUserStore()
const { toast } = useToast()
const { playClick } = useClickSound()

const avatarSrc = computed(() => userStore.profile?.avatar || '/images/avatars/001.jpg')
const fileInput = ref<HTMLInputElement | null>(null)
const soundOn = ref(true)
const bgmOn = ref(true)
const showNickModal = ref(false)
const nickDraft = ref('')
const uploading = ref(false)

onMounted(() => {
  soundOn.value = isClickSoundOn()
  bgmOn.value = isAppBgmOn()
})

function pickAvatar() {
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
  if (uploading.value) return
  uploading.value = true
  try {
    const dataUrl = await readAsDataUrl(file)
    const profile = await userApi.updateAvatar(dataUrl)
    userStore.profile = profile
    toast('头像已更新')
  } catch (err: any) {
    toast(err?.message || '上传失败')
  } finally {
    uploading.value = false
  }
}

function openNickname() {
  nickDraft.value = userStore.profile?.nickname ?? ''
  showNickModal.value = true
}

async function saveNickname() {
  const name = nickDraft.value.trim()
  if (name.length < 2 || name.length > 8) {
    toast('昵称需为 2～8 个字')
    return
  }
  try {
    const profile = await userApi.updateNickname(name)
    userStore.profile = profile
    showNickModal.value = false
    toast('昵称已更新')
  } catch (err: any) {
    toast(err?.message || '修改失败')
  }
}

function onSoundChange() {
  setClickSoundOn(soundOn.value)
  if (soundOn.value) {
    playClick()
    toast('点击音效已开启')
  } else {
    toast('点击音效已关闭')
  }
}

function onBgmChange() {
  setAppBgmOn(bgmOn.value)
  toast(bgmOn.value ? '背景音乐已开启' : '背景音乐已关闭')
}
</script>
