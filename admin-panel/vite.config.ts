import { defineConfig, type Plugin } from 'vite'
import vue from '@vitejs/plugin-vue'
import fs from 'node:fs'
import path from 'node:path'
import { resolve } from 'node:path'
import AutoImport from 'unplugin-auto-import/vite'
import Components from 'unplugin-vue-components/vite'
import { ElementPlusResolver } from 'unplugin-vue-components/resolvers'
import compression from 'vite-plugin-compression'

/** 只开放奖球 / 骰子，不把整包 H5 挂到后台 Origin */
const LOBBY_DRAW_ASSET =
  /^(kuai3\/assets\/result\/icon-\d+\.(png|webp)|(bjsc|speed-racing|speed-boat)\/assets\/balls\/ball-\d+\.(png|webp)|lhc\/assets\/balls\/ball_\d+\.(png|webp))$/i

const DRAW_MIME: Record<string, string> = {
  '.png': 'image/png',
  '.webp': 'image/webp',
}

function serveLobbyDrawAssets(): Plugin {
  const root = resolve(__dirname, '../games-assets')
  return {
    name: 'admin-lobby-draw-assets',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const raw = req.url?.split('?')[0] || ''
        if (!raw.startsWith('/games-assets/')) return next()
        const rel = decodeURIComponent(raw.slice('/games-assets/'.length)).replace(/\\/g, '/')
        if (!LOBBY_DRAW_ASSET.test(rel)) {
          res.statusCode = 404
          res.end()
          return
        }
        const file = path.resolve(root, rel)
        const safeRoot = root.endsWith(path.sep) ? root : root + path.sep
        if (!file.startsWith(safeRoot) || !fs.existsSync(file)) {
          res.statusCode = 404
          res.end()
          return
        }
        res.setHeader('Content-Type', DRAW_MIME[path.extname(file).toLowerCase()] || 'application/octet-stream')
        res.setHeader('Cache-Control', 'public, max-age=86400')
        fs.createReadStream(file).pipe(res)
      })
    },
  }
}

export default defineConfig({
  /* 管理后台使用独立 Origin，并在该 Origin 的根路径部署。 */
  base: '/',
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
    serveLobbyDrawAssets(),
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
    host: '127.0.0.1',
    port: 3001,
    proxy: {
      '/api': { target: 'http://localhost:3000', changeOrigin: true },
      '/uploads': { target: 'http://localhost:3000', changeOrigin: true },
      /* 与玩家端共用 /images 素材（默认房间图等） */
      '/images': { target: 'http://localhost:5173', changeOrigin: true },
    },
  },
})
