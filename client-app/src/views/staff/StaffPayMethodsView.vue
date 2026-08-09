<template>
  <div class="screen-deco" aria-hidden="true">
    <img class="cd cd-tl" src="/images/corner-flourish.png" alt="">
    <img class="cd cd-tr" src="/images/corner-flourish.png" alt="">
    <img class="cd cd-bl" src="/images/corner-flourish.png" alt="">
    <img class="cd cd-br" src="/images/corner-flourish.png" alt="">
  </div>

  <div class="page staff-console-page">
    <div class="app-bar">
      <div class="back" @click="router.back()">‹</div>
      <div class="title">收款方式</div>
      <div class="right sc-bar-act" @click="save">保存</div>
    </div>

    <div class="page-body">
      <p class="pay-tip">
        快捷话术与收款码保存在云端，手机与电脑同一账号共用。保存后客服聊天可直接发送。
      </p>

      <section class="pay-block">
        <div class="pay-hd">
          <span>快捷话术</span>
          <button
            type="button"
            class="pay-add"
            :disabled="settings.quickReplies.length >= 8"
            @click="settings.quickReplies.push('')"
          >添加</button>
        </div>
        <div v-for="(_, i) in settings.quickReplies" :key="i" class="pay-reply-row">
          <input v-model="settings.quickReplies[i]" type="text" maxlength="80" placeholder="输入话术">
          <button type="button" class="pay-del" @click="settings.quickReplies.splice(i, 1)">删</button>
        </div>
        <div v-if="!settings.quickReplies.length" class="sp-empty">暂无话术</div>
      </section>

      <section class="pay-block">
        <div class="pay-hd">
          <span>微信收款码</span>
          <button type="button" class="pay-add" :disabled="!!uploading || settings.wechatQrs.length >= 8" @click="pick('wechat')">
            {{ uploading === 'wechat' ? '上传中…' : '添加' }}
          </button>
        </div>
        <div v-if="!settings.wechatQrs.length" class="sp-empty">暂无</div>
        <div v-for="(q, i) in settings.wechatQrs" :key="q.id" class="pay-card">
          <img :src="q.url" alt="微信码">
          <button type="button" class="pay-del" @click="remove('wechat', i)">删除</button>
        </div>
      </section>

      <section class="pay-block">
        <div class="pay-hd">
          <span>支付宝收款码</span>
          <button type="button" class="pay-add" :disabled="!!uploading || settings.alipayQrs.length >= 8" @click="pick('alipay')">
            {{ uploading === 'alipay' ? '上传中…' : '添加' }}
          </button>
        </div>
        <div v-if="!settings.alipayQrs.length" class="sp-empty">暂无</div>
        <div v-for="(q, i) in settings.alipayQrs" :key="q.id" class="pay-card">
          <img :src="q.url" alt="支付宝码">
          <button type="button" class="pay-del" @click="remove('alipay', i)">删除</button>
        </div>
      </section>

      <input
        ref="fileEl"
        type="file"
        accept="image/png,image/jpeg,image/webp"
        hidden
        @change="onFile"
      >
    </div>
    <StaffTabBar />
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { staffConsoleApi } from '@/api/staffConsole'
import StaffTabBar from '@/components/StaffTabBar.vue'
import { useStaffStore } from '@/stores/staff'
import { useToast } from '@/composables/useToast'
import { useBodyClass } from '@/composables/useBodyClass'
import {
  DEFAULT_QUICK_REPLIES,
  fetchStaffPaySettings,
  saveStaffPaySettingsRemote,
  type StaffPaySettings,
} from '@/utils/staffPaySettings'
import '@/assets/staff-console.css'

useBodyClass('deco-bg')

const router = useRouter()
const staff = useStaffStore()
const { toast } = useToast()

const settings = ref<StaffPaySettings>({
  quickReplies: [...DEFAULT_QUICK_REPLIES],
  wechatQrs: [],
  alipayQrs: [],
})
const uploading = ref<'wechat' | 'alipay' | null>(null)
const fileEl = ref<HTMLInputElement | null>(null)
let pendingKind: 'wechat' | 'alipay' = 'wechat'

function userId() {
  return staff.profile?.id || 'anon'
}

async function persist() {
  settings.value = await saveStaffPaySettingsRemote(userId(), settings.value)
}

async function save() {
  try {
    await persist()
    toast('已保存（手机电脑同步）')
  } catch (e: unknown) {
    toast(e instanceof Error ? e.message : '保存失败')
  }
}

function pick(kind: 'wechat' | 'alipay') {
  pendingKind = kind
  fileEl.value?.click()
}

async function remove(kind: 'wechat' | 'alipay', index: number) {
  if (kind === 'wechat') settings.value.wechatQrs.splice(index, 1)
  else settings.value.alipayQrs.splice(index, 1)
  try {
    await persist()
  } catch (e: unknown) {
    toast(e instanceof Error ? e.message : '删除失败')
  }
}

function readAsDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result || ''))
    reader.onerror = () => reject(new Error('读取失败'))
    reader.readAsDataURL(file)
  })
}

async function onFile(ev: Event) {
  const input = ev.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file) return
  uploading.value = pendingKind
  try {
    const dataUrl = await readAsDataUrl(file)
    const res = await staffConsoleApi.csUploadPayQr(pendingKind, dataUrl)
    const item = { id: `q-${Date.now()}`, url: res.url }
    if (pendingKind === 'wechat') settings.value.wechatQrs.push(item)
    else settings.value.alipayQrs.push(item)
    await persist()
    toast('已上传')
  } catch (e: unknown) {
    toast(e instanceof Error ? e.message : '上传失败')
  } finally {
    uploading.value = null
  }
}

onMounted(async () => {
  try {
    settings.value = await fetchStaffPaySettings(userId())
  } catch {
    toast('加载收款设置失败，请稍后重试')
  }
})
</script>

<style scoped>
.pay-tip {
  margin: 0 2px 14px;
  font-size: 12px;
  line-height: 1.5;
  color: rgba(244, 211, 107, 0.5);
}
.pay-block {
  margin-bottom: 16px;
  padding: 12px;
  border-radius: 14px;
  border: 1px solid rgba(212, 175, 55, 0.22);
  background: rgba(16, 12, 8, 0.85);
}
.pay-hd {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 10px;
  font-size: 14px;
  letter-spacing: 1px;
  color: #fff4c2;
}
.pay-add {
  height: 30px;
  padding: 0 12px;
  border-radius: 999px;
  border: 1px solid rgba(244, 211, 107, 0.4);
  background: rgba(0, 0, 0, 0.22);
  color: var(--gold-bright);
  font-size: 12px;
  cursor: pointer;
}
.pay-add:disabled { opacity: 0.45; }
.pay-reply-row {
  display: flex;
  gap: 8px;
  margin-bottom: 8px;
}
.pay-reply-row input {
  flex: 1;
  height: 38px;
  padding: 0 10px;
  border-radius: 10px;
  border: 1px solid rgba(212, 175, 55, 0.28);
  background: rgba(0, 0, 0, 0.35);
  color: #fff4c2;
  font-size: 13px;
  outline: none;
}
.pay-card {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 10px;
}
.pay-card img {
  width: 88px;
  height: 88px;
  object-fit: cover;
  border-radius: 10px;
  border: 1px solid rgba(244, 211, 107, 0.25);
  background: #000;
}
.pay-del {
  height: 32px;
  padding: 0 12px;
  border-radius: 8px;
  border: 1px solid rgba(220, 120, 80, 0.45);
  background: rgba(180, 80, 40, 0.15);
  color: #e8a080;
  font-size: 12px;
  cursor: pointer;
  flex-shrink: 0;
}
</style>
