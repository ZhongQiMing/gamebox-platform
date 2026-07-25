import { defineConfig, type Plugin } from 'vite'
import vue from '@vitejs/plugin-vue'
import fs from 'node:fs'
import path from 'node:path'
import { resolve } from 'path'

const repoRoot = resolve(__dirname, '..')
const gamesAssetsDir = path.join(repoRoot, 'games-assets')

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.json': 'application/json',
  '.woff2': 'font/woff2',
}

function serveGamesAssets(): Plugin {
  function handler(req: any, res: any, next: () => void) {
    const url = req.url?.split('?')[0] ?? ''
    if (!url.startsWith('/games-assets/')) return next()

    let rel = decodeURIComponent(url.slice('/games-assets'.length))
    if (rel === '' || rel === '/') rel = '/bjsc/index.html'
    const filePath = path.normalize(path.join(gamesAssetsDir, rel))
    if (!filePath.startsWith(gamesAssetsDir)) {
      res.statusCode = 403
      res.end('Forbidden')
      return
    }
    if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
      next()
      return
    }
    const ext = path.extname(filePath).toLowerCase()
    res.setHeader('Content-Type', MIME[ext] ?? 'application/octet-stream')
    fs.createReadStream(filePath).pipe(res)
  }

  function copyDir(src: string, dest: string) {
    fs.mkdirSync(dest, { recursive: true })
    for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
      const from = path.join(src, entry.name)
      const to = path.join(dest, entry.name)
      if (entry.isDirectory()) copyDir(from, to)
      else fs.copyFileSync(from, to)
    }
  }

  return {
    name: 'serve-games-assets',
    configureServer(server) {
      server.middlewares.use(handler)
    },
    configurePreviewServer(server) {
      server.middlewares.use(handler)
    },
    closeBundle() {
      const out = path.join(__dirname, 'dist', 'games-assets')
      if (fs.existsSync(gamesAssetsDir)) copyDir(gamesAssetsDir, out)
    },
  }
}

export default defineConfig({
  plugins: [vue(), serveGamesAssets()],
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
      '@gamebox/shared': resolve(__dirname, '../packages/shared/src/index.ts'),
    },
  },
  server: {
    port: 5173,
    host: true,
    fs: { allow: [repoRoot] },
    proxy: {
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      },
      '/uploads': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      },
      '/socket.io': {
        target: 'http://localhost:3000',
        changeOrigin: true,
        ws: true,
      },
    },
  },
})
