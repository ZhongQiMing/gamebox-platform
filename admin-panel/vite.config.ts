import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { resolve } from 'node:path'
import AutoImport from 'unplugin-auto-import/vite'
import Components from 'unplugin-vue-components/vite'
import { ElementPlusResolver } from 'unplugin-vue-components/resolvers'
import compression from 'vite-plugin-compression'

export default defineConfig({
  plugins: [
    vue(),
    AutoImport({
      resolvers: [ElementPlusResolver({ importStyle: 'css' })],
      dts: 'src/auto-imports.d.ts',
    }),
    Components({
      resolvers: [ElementPlusResolver({ importStyle: 'css' })],
      dts: 'src/components.d.ts',
    }),
    compression({ algorithm: 'gzip', ext: '.gz', threshold: 1024 }),
  ],
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
      '@gamebox/shared': resolve(__dirname, '../packages/shared/src/index.ts'),
    },
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          const p = id.replace(/\\/g, '/')
          if (!p.includes('node_modules')) return
          /* 不把 element-plus 打成单包，否则按需引入失效、首屏仍下整库 */
          if (p.includes('vue-router') || p.includes('/pinia/') || /\/vue\/dist\//.test(p)) {
            return 'vue-vendor'
          }
        },
      },
    },
  },
  server: {
    port: 3001,
    proxy: { '/api': { target: 'http://localhost:3000', changeOrigin: true } },
  },
})
