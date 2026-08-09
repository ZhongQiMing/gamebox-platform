import { defineConfig } from 'vitest/config'
import vue from '@vitejs/plugin-vue'
import { resolve } from 'path'

/**
 * 玩家端单测：只跑纯逻辑与 store，不碰 games-assets 拷贝那套构建插件。
 * 别名要与 vite.config.ts 保持一致，否则 `@/` 在测试里解析不到。
 */
export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
      '@gamebox/shared': resolve(__dirname, '../packages/shared/src/index.ts'),
    },
  },
  test: {
    environment: 'jsdom',
    include: ['src/**/*.spec.ts'],
    restoreMocks: true,
  },
})
