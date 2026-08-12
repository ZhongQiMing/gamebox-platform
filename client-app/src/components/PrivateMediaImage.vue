<template>
  <img v-if="displaySrc" v-bind="$attrs" :src="displaySrc">
</template>

<script setup lang="ts">
import { onBeforeUnmount, ref, watch } from 'vue'
import { API_BASE } from '@/api/apiBase'
import {
  PLAYER_TOKEN_KEY,
  STAFF_TOKEN_KEY,
  loadToken,
  type SessionKind,
} from '@/api/session'

defineOptions({ inheritAttrs: false })

const props = withDefaults(defineProps<{
  src: string
  session?: SessionKind
}>(), {
  session: 'player',
})

const displaySrc = ref('')
let objectUrl = ''
let generation = 0

function releaseObjectUrl() {
  if (objectUrl) URL.revokeObjectURL(objectUrl)
  objectUrl = ''
}

function requestUrl(src: string): string {
  if (!src.startsWith('/api/')) return src
  const origin = API_BASE.endsWith('/api') ? API_BASE.slice(0, -4) : API_BASE
  return `${origin}${src}`
}

async function load(src: string) {
  const current = ++generation
  releaseObjectUrl()
  displaySrc.value = ''
  if (!src) return
  if (!/^\/api\/cs\/media\/[A-Za-z0-9_-]{10,64}$/.test(src)) {
    return
  }

  const token = loadToken(
    props.session === 'staff' ? STAFF_TOKEN_KEY : PLAYER_TOKEN_KEY,
  )
  const headers = new Headers()
  if (token) headers.set('Authorization', `Bearer ${token}`)
  try {
    const response = await fetch(requestUrl(src), {
      credentials: 'include',
      headers,
      cache: 'no-store',
    })
    if (!response.ok) return
    const blob = await response.blob()
    if (current !== generation) return
    objectUrl = URL.createObjectURL(blob)
    displaySrc.value = objectUrl
  } catch {
    /* 私有媒体加载失败时保持隐藏，不回退为公开 URL。 */
  }
}

watch(
  () => [props.src, props.session] as const,
  ([src]) => {
    void load(src)
  },
  { immediate: true },
)

onBeforeUnmount(() => {
  generation += 1
  releaseObjectUrl()
})
</script>
