import { defineConfig, loadEnv, type Plugin } from 'vite'
import vue from '@vitejs/plugin-vue'
import fs from 'node:fs'
import path from 'node:path'
import zlib from 'node:zlib'
import { resolve } from 'path'

const repoRoot = resolve(__dirname, '..')
const gamesAssetsDir = path.join(repoRoot, 'games-assets')

function originConfigError(name: string, value?: string): string | null {
  const raw = String(value || '').trim()
  if (!raw || /CHANGE_TO_YOUR_DOMAIN|请改成/.test(raw)) return `${name} 未配置或仍是占位符`
  try {
    const normalized = raw.replace(/\/$/, '')
    const url = new URL(raw)
    if (url.protocol !== 'https:' || url.origin !== normalized) {
      return `${name} 必须是 HTTPS Origin（如 https://games.example.com，不能含路径、参数或认证信息）`
    }
    return null
  } catch {
    return `${name} 不是合法 URL：${raw}`
  }
}

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
      const api = String(process.env.VITE_API_ORIGIN || '').replace(/\/$/, '')
      console.log(`\n[slim-app] 已瘦包。素材来自 ${origin}，接口指向 ${api}。\n`)
    },
  }
}

/*
 * 产出 .gz 兄弟文件，交给 nginx 的 gzip_static 直接发。
 *
 * 现压每次请求都要花 CPU，而且只能用较低的压缩等级；构建期压一次可以拉满，
 * 文本资源通常再小 10%~15%。用 Node 自带 zlib，不引第三方插件。
 */
function precompressAssets(): Plugin {
  const COMPRESSIBLE = /\.(js|mjs|css|html|json|svg|wasm)$/i
  const MIN_BYTES = 1024

  return {
    name: 'precompress-assets',
    apply: 'build',
    enforce: 'post',
    closeBundle() {
      const dist = path.join(__dirname, 'dist')
      if (!fs.existsSync(dist)) return

      let count = 0
      let raw = 0
      let gz = 0
      for (const file of walkFiles(dist)) {
        if (!COMPRESSIBLE.test(file)) continue
        const buf = fs.readFileSync(file)
        if (buf.length < MIN_BYTES) continue
        const out = zlib.gzipSync(buf, { level: zlib.constants.Z_BEST_COMPRESSION })
        // 压完反而变大就别留了，nginx 会优先发 .gz
        if (out.length >= buf.length) continue
        fs.writeFileSync(`${file}.gz`, out)
        count++
        raw += buf.length
        gz += out.length
      }
      const mb = (n: number) => (n / 1024 / 1024).toFixed(2)
      console.log(`\n[precompress] ${count} 个文件 ${mb(raw)}MB → ${mb(gz)}MB (.gz)\n`)
    },
  }
}

export default defineConfig(({ command, mode }) => {
  const env = loadEnv(mode, __dirname, '')
  if (env.VITE_SLIM_APP === '1') process.env.VITE_SLIM_APP = '1'
  if (env.VITE_ASSET_ORIGIN) process.env.VITE_ASSET_ORIGIN = env.VITE_ASSET_ORIGIN
  if (env.VITE_API_ORIGIN) process.env.VITE_API_ORIGIN = env.VITE_API_ORIGIN

  if (command === 'build') {
    const nativeBuild = mode === 'app' || env.VITE_SLIM_APP === '1'
    const errors = nativeBuild
      ? [
          originConfigError('VITE_ASSET_ORIGIN（Native 游戏素材域）', env.VITE_ASSET_ORIGIN),
          originConfigError('VITE_API_ORIGIN（Native 后端域）', env.VITE_API_ORIGIN),
          env.VITE_GAME_ORIGIN
            ? originConfigError('VITE_GAME_ORIGIN（Native 独立游戏域）', env.VITE_GAME_ORIGIN)
            : null,
        ]
      : [originConfigError('VITE_GAME_ORIGIN（生产 Web 独立游戏域）', env.VITE_GAME_ORIGIN)]
    const invalid = errors.filter((error): error is string => Boolean(error))
    if (invalid.length) {
      throw new Error(
        `\n[game-origin] ${nativeBuild ? 'Native' : '生产 Web'} 构建已中止：\n`
          + invalid.map((error) => `  - ${error}`).join('\n')
          + '\n生产产物禁止回退到当前页面 Origin，否则 /games-assets 会统一 404。\n',
      )
    }
  }

  return {
    /* precompress 必须排在 finalizeStaticAssets 之后：games-assets 是那一步才复制进 dist 的 */
    plugins: [vue(), serveGamesAssetsDev(), finalizeStaticAssets(), precompressAssets()],
    resolve: {
      alias: {
        '@': resolve(__dirname, 'src'),
        '@gamebox/shared': resolve(__dirname, '../packages/shared/src/index.ts'),
      },
    },
    build: {
      rollupOptions: {
        output: {
          manualChunks(id: string) {
            const p = id.replace(/\\/g, '/')
            if (!p.includes('node_modules')) return
            /*
             * pixi 只有奔驰宝马的龙骨动画用得上，是全站最大的依赖。
             * 不单独拆出去，它会被并进公共 vendor，让每个首次进站的用户都白下一份。
             */
            if (p.includes('/pixi.js/') || p.includes('/@pixi/')) return 'pixi-vendor'
            if (p.includes('/socket.io-client/') || p.includes('/engine.io-client/')) {
              return 'socket-vendor'
            }
            if (
              p.includes('/vue-router/')
              || p.includes('/pinia/')
              || /\/vue\/dist\//.test(p)
              || p.includes('/@vue/')
            ) {
              return 'vue-vendor'
            }
            if (p.includes('/axios/')) return 'vue-vendor'
          },
        },
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
