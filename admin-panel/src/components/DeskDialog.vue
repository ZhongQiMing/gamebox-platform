<template>
  <el-dialog
    :model-value="modelValue"
    :width="width"
    :top="top"
    :append-to-body="appendToBody"
    :align-center="alignCenter"
    :destroy-on-close="destroyOnClose"
    :close-on-click-modal="closeOnClickModal"
    :show-close="false"
    :class="['desk-window-dialog', dialogClass]"
    @update:model-value="emit('update:modelValue', $event)"
    @closed="emit('closed')"
    @opened="emit('opened')"
  >
    <template #header>
      <div class="win-caption">
        <span class="win-caption-mark">♛</span>
        <span class="win-caption-title">{{ title }}</span>
        <span class="win-caption-sub">{{ subtitle || '' }}</span>
        <button type="button" class="win-caption-x" @click="close">×</button>
      </div>
    </template>

    <div v-if="variant === 'form'" class="win-content">
      <slot />
    </div>
    <slot v-else />

    <template v-if="$slots.footer" #footer>
      <div class="win-footer">
        <slot name="footer" />
      </div>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
withDefaults(defineProps<{
  modelValue: boolean
  title: string
  subtitle?: string
  width?: string | number
  top?: string
  appendToBody?: boolean
  alignCenter?: boolean
  destroyOnClose?: boolean
  closeOnClickModal?: boolean
  dialogClass?: string
  /** form=单栏内容区；bare=自行布局（如创建房间向导） */
  variant?: 'form' | 'bare'
}>(), {
  width: '440px',
  top: undefined,
  appendToBody: false,
  alignCenter: true,
  destroyOnClose: true,
  closeOnClickModal: true,
  dialogClass: '',
  variant: 'form',
})

const emit = defineEmits<{
  'update:modelValue': [boolean]
  closed: []
  opened: []
}>()

function close() {
  emit('update:modelValue', false)
}
</script>
