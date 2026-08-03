<template>
  <div class="ops-header">
    <div class="ops-header__text">
      <h2 class="ops-header__title">
        <slot name="title">{{ title }}</slot>
      </h2>
      <p v-if="subtitle || $slots.subtitle" class="ops-header__sub">
        <slot name="subtitle">{{ subtitle }}</slot>
      </p>
    </div>
    <div v-if="$slots.actions" class="ops-header__actions">
      <slot name="actions" />
    </div>
  </div>
</template>

<script setup lang="ts">
defineProps<{
  title?: string
  subtitle?: string
}>()
</script>
