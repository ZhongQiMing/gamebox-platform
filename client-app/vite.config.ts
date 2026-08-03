import { defineConfig, loadEnv, type Plugin } from 'vite'
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

function isSlimApp() {
  return String(process.env.VITE_SLIM_APP || '') === '1'
}

/** 大厅期号球 / 快三结果图：安装包内保留，避免大厅也要联网 */
function isLobbyGamesAsset(relPosix: string): boolean {
  const r = relPosix.replace(/^\/+/, '')
  if (/^kuai3\/assets\/result\/icon-\d+\.png$/i.test(r)) return true
  if (/^(bjsc|speed-racing|speed-boat)\/assets\/balls\//i.test(r)) return true
  if (/^lhc\/assets\/balls\//i.test(r)) return true
  return false
}

/** 仅游戏目录顶层的大厅图标/封面；pg 内 cover-* 不算 */
function keepBundledGameImage(relPosix: string): boolean {
  const parts = relPosix.replace(/\\/g, '/').split('/')
  const base = parts[parts.length - 1] || ''
  const topLevel = parts.length === 2
  if (topLevel && /cover/i.test(base) && !/raw/i.test(base)) return true
  if (
    /^(ssc|ffc|speed-racing|bjsc|speed-boat|kuai3|hk-mark6|zhajinhua|douniu|baccarat|slots)\.png$/i.test(
      base,
    )
  ) {
    return true
  }
  if (/^(bcbm-icon|longhu-icon)\.png$/i.test(base)) return true
  if (topLevel && /开始按钮/.test(base)) return true
  return false
}

function copyDirFiltered(
  src: string,
  dest: string,
  shouldCopy: (relPosix: string) => boolean,
  relBase = '',
) {
  fs.mkdirSync(dest, { recursive: true })
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const from = path.join(src, entry.name)
    const to = path.join(dest, entry.name)
    const rel = relBase ? `${relBase}/${entry.name}` : entry.name
    const relPosix = rel.replace(/\\/g, '/')
    if (entry.isDirectory()) {
      copyDirFiltered(from, to, shouldCopy, relPosix)
      try {
        if (fs.existsSync(to) && fs.readdirSync(to).length === 0) fs.rmdirSync(to)
      } catch {
        /* ignore */
      }
    } else if (shouldCopy(relPosix)) {
      fs.copyFileSync(from, to)
    }
  }
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

function rmRf(p: string) {
  if (!fs.existsSync(p)) return
  fs.rmSync(p, { recursive: true, force: true })
}

function walkFiles(dir: string, out: string[] = []): string[] {
  if (!fs.existsSync(dir)) return out
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) walkFiles(full, out)
    else out.push(full)
  }
  return out
}

function walkAllDirs(dir: string, out: string[] = []): string[] {
  if (!fs.existsSync(dir)) return out
  out.push(dir)
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) walkAllDirs(path.join(dir, entry.name), out)
  }
  return out
}

function serveGamesAssetsDev(): Plugin {
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
    const stat = fs.statSync(filePath)
    res.setHeader('Content-Type', MIME[ext] ?? 'application/octet-stream')
    res.setHeader('Content-Length', String(stat.size))
    fs.createReadStream(filePath).pipe(res)
  }

  return {
    name: 'serve-games-assets-dev',
    configureServer(server) {
      server.middlewares.use(handler)
    },
    configurePreviewServer(server) {
      server.middlewares.use(handler)
    },
  }
}

/** 构建结束：写入 games-assets；瘦包时只留大厅球图并剔除游戏内素材 */
function finalizeStaticAssets(): Plugin {
  return {
    name: 'finalize-static-assets',
    apply: 'build',
    enforce: 'post',
    closeBundle() {
      const dist = path.join(__dirname, 'dist')
      const outGa = path.join(dist, 'games-assets')
      const slim = isSlimApp()

      /* 必须先清空，避免上次完整包残留 */
      rmRf(outGa)
      if (fs.existsSync(gamesAssetsDir)) {
        if (slim) copyDirFiltered(gamesAssetsDir, outGa, isLobbyGamesAsset)
        else copyDir(gamesAssetsDir, outGa)
      }

      if (!slim) return

      rmRf(path.join(dist, 'audio'))

      const gamesImg = path.join(dist, 'images', 'games')
      for (const file of walkFiles(gamesImg)) {
        const rel = path.relative(gamesImg, file).replace(/\\/g, '/')
        if (!keepBundledGameImage(rel)) {
          try {
            fs.unlinkSync(file)
          } catch {
            /* ignore */
          }
        }
      }
      for (const d of walkAllDirs(gamesImg).sort((a, b) => b.length - a.length)) {
        try {
          if (fs.existsSync(d) && fs.readdirSync(d).length === 0) fs.rmdirSync(d)
        } catch {
          /* ignore */
        }
      }

      const origin = String(process.env.VITE_ASSET_ORIGIN || '').replace(/\/$/, '')
      if (!origin || /请改成/.test(origin)) {
        console.warn(
          '\n[slim-app] 警告: VITE_ASSET_ORIGIN 未配置成真实域名。瘦包进游戏将无法下载素材。\n',
        )
      } else {
        console.log(`\n[slim-app] 已瘦包。游戏素材将从 ${origin} 按需下载。\n`)
      }
    },
  }
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, __dirname, '')
  if (env.VITE_SLIM_APP === '1') process.env.VITE_SLIM_APP = '1'
  if (env.VITE_ASSET_ORIGIN) process.env.VITE_ASSET_ORIGIN = env.VITE_ASSET_ORIGIN

  return {
    plugins: [vue(), serveGamesAssetsDev(), finalizeStaticAssets()],
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
  }
})
