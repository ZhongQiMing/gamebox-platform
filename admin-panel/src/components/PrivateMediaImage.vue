<template>
  <img v-if="displaySrc" v-bind="$attrs" :src="displaySrc">
</template>

<script setup lang="ts">
import { onBeforeUnmount, ref, watch } from 'vue'

defineOptions({ inheritAttrs: false })

const props = defineProps<{ src: string }>()
const displaySrc = ref('')
let objectUrl = ''
let generation = 0

function release() {
  if (objectUrl) URL.revokeObjectURL(objectUrl)
  objectUrl = ''
}

async function load(src: string) {
  const current = ++generation
  release()
  displaySrc.value = ''
  if (!/^\/api\/cs\/media\/[A-Za-z0-9_-]{10,64}$/.test(src)) return
  try {
    const response = await fetch(src, {
      credentials: 'include',
      cache: 'no-store',
    })
    if (!response.ok) return
    const blob = await response.blob()
    if (current !== generation) return
    objectUrl = URL.createObjectURL(blob)
    displaySrc.value = objectUrl
  } catch {
    /* 私有媒体加载失败时不回退为公开 URL。 */
  }
}

watch(() => props.src, (src) => void load(src), { immediate: true })
onBeforeUnmount(() => {
  generation += 1
  release()
})
</script>
