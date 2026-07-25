<template>
  <Teleport to="body">
    <!-- 结构对齐 common.css：mask 与 modal 为兄弟节点，靠 .show 显示 -->
    <div
      v-show="visible"
      class="app-modal-mask"
      :class="{ show: visible }"
      @click="onCancel"
    />
    <div
      v-show="visible"
      class="app-modal"
      :class="{ show: visible }"
      role="dialog"
      aria-modal="true"
      :aria-labelledby="titleId"
    >
      <div class="app-modal-card" @click.stop>
        <div class="app-modal-icon" :class="{ danger }">
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <circle cx="12" cy="12" r="9" />
            <path d="M12 8v5" />
            <circle cx="12" cy="16" r="0.8" fill="currentColor" stroke="none" />
          </svg>
        </div>
        <div :id="titleId" class="app-modal-title">{{ title }}</div>
        <div v-if="message" class="app-modal-body">{{ message }}</div>
        <div v-if="$slots.default" class="app-modal-body app-modal-body--slot">
          <slot />
        </div>
        <div class="app-modal-actions">
          <button
            v-if="showCancel"
            type="button"
            class="app-modal-btn app-modal-btn-cancel"
            @click="onCancel"
          >
            {{ cancelText }}
          </button>
          <button
            type="button"
            class="app-modal-btn app-modal-btn-ok"
            :class="{ danger }"
            @click="onOk"
          >
            {{ okText }}
          </button>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { onUnmounted, useId, watch } from 'vue'

const props = withDefaults(
  defineProps<{
    visible: boolean
    title: string
    message?: string
    okText?: string
    cancelText?: string
    showCancel?: boolean
    danger?: boolean
  }>(),
  {
    okText: '确定',
    cancelText: '取消',
    showCancel: true,
    danger: false,
  },
)

const emit = defineEmits<{ ok: []; cancel: [] }>()
const titleId = useId()

function onOk() {
  emit('ok')
}
function onCancel() {
  emit('cancel')
}

watch(
  () => props.visible,
  (v) => {
    document.body.style.overflow = v ? 'hidden' : ''
  },
)
onUnmounted(() => {
  document.body.style.overflow = ''
})
</script>
