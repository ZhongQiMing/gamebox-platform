import { defineConfig, loadEnv, type Plugin } from 'vite'
import vue from '@vitejs/plugin-vue'
import fs from 'node:fs'
import path from 'node:path'
import zlib from 'node:zlib'
import { resolve } from 'path'

const repoRoot = resolve(__dirname, '..')
const gamesAssetsDir = path.join(repoRoot, 'games-assets')

/** 只读 .env 文件本身，不受当前 shell 里残留的 VITE_* 影响。 */
function readDotEnvFile(filePath: string): Record<string, string> {
  const out: Record<string, string> = {}
  if (!fs.existsSync(filePath)) return out
  for (const line of fs.readFileSync(filePath, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eq = trimmed.indexOf('=')
    if (eq <= 0) continue
    const key = trimmed.slice(0, eq).trim()
    let val = trimmed.slice(eq + 1).trim()
    if (
      (val.startsWith('"') && val.endsWith('"'))
      || (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1)
    }
    out[key] = val
  }
  return out
}

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

function originListConfigError(name: string, value?: string): string | null {
  const raw = String(value || '').trim()
  if (!raw) return null
  for (const part of raw.split(',')) {
    const item = part.trim()
    if (!item) continue
    const err = originConfigError(name, item)
    if (err) return err
  }
  return null
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
  if (/^kuai3\/assets\/result\/icon-\d+\.(png|webp)$/i.test(r)) return true
  if (/^(bjsc|speed-racing|speed-boat)\/assets\/balls\//i.test(r)) return true
  if (/^lhc\/assets\/balls\//i.test(r)) return true
  return false
}

/**
 * 素材生产中间件：留在仓库里供重新切图，但不进发布包。
 *
 * 这些文件浏览器一次都不会请求（已按「解析后真实路径」全仓扫过，js/css/html 里
 * 零引用），但完整包会把它们一起复制进 dist，白占镜像体积和服务器磁盘。
 *
 *   ai-sources/       AI 出图原稿
 *   *-green.png       绿幕源图，抠图后才有可用素材
 *   *-master.png      精灵母版，切帧后才有 xx-01/02
 *   _debug-*          抠图调试用的 mask / plate
 *   page-unified-v51.png  已转 webp，CSS 只引 webp
 *   bet-btns/download.png 弧度参考图，只在 CSS 注释里被提到
 *
 * 注意别顺手把 race-car-front-01.png 这类也排掉：它们是
 * result-card.js 里 `prefix + 序号 + '.png'` 拼出来的，静态扫不到但确实在用。
 */
function isBuildIntermediate(relPosix: string): boolean {
  const r = relPosix.replace(/^\/+/, '')
  const base = r.split('/').pop() || ''
  if (/(^|\/)ai-sources\//i.test(r)) return true
  if (/^_debug-/i.test(base)) return true
  if (/-green\.png$/i.test(base)) return true
  if (/-master\.png$/i.test(base)) return true
  if (/^page-unified-v51\.png$/i.test(base)) return true
  if (/(^|\/)bet-btns\/download\.png$/i.test(r)) return true
  /*
   * draw-result-stage.png：AI 出的开奖台底图，由 import_ai_assets.py 落盘，
   * ssc / ffc / lhc 各一份共 5.5 MB，但三个游戏的代码和 CSS 里引用数为 0。
   * bodybg.full.jpg：开奖动画的原始大图，xyssx_index.html 只引用同目录的
   * bodybg.webp（57 KB），这份 189 KB 的 jpg 同样零引用。
   * 两者都留在仓库里备查，但没有理由进发布包。
   */
  if (/^draw-result-stage\.png$/i.test(base)) return true
  if (/\.full\.jpg$/i.test(base)) return true
  return false
}

/** 仅游戏目录顶层的大厅图标/封面；pg 内 cover-* 不算 */
function keepBundledGameImage(relPosix: string): boolean {
  const parts = relPosix.replace(/\\/g, '/').split('/')
  const base = parts[parts.length - 1] || ''
  const topLevel = parts.length === 2
  if (topLevel && /cover/i.test(base) && !/raw/i.test(base)) return true
  if (
    /^(ssc|ffc|speed-racing|bjsc|speed-boat|kuai3|hk-mark6|zhajinhua|douniu|baccarat|slots)\.(png|webp)$/i.test(
      base,
    )
  ) {
    return true
  }
  if (/^(bcbm-icon|longhu-icon)\.(png|webp)$/i.test(base)) return true
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

/**
 * 删掉发布包里已被 WebP 取代的 PNG。
 *
 * 大厅那 11 个游戏图标和 crown/corner/medal/底图，运行时引用的一律是 .webp
 * （`useGameLobbyCards.ts`、各视图的 <img>、common.css 里都是写死的 .webp 字面量），
 * 同名 .png 只是 `scripts/optimize-lobby-images.mjs` 生成 WebP 用的源图。
 * 源图要留在仓库里好重新压，但没有理由跟着发布包走——它们比 WebP 大一个数量级
 * （单个 480~1400 KB 对 29~44 KB），合计约 9.5 MB。
 *
 * 判据故意设成「同目录存在同名 .webp」而不是列白名单：删之前必然已经确认
 * 替代品在包里，漏删好过误删。筹码图 chip-*.png 没有 .webp 兄弟，
 * 所以那批被 H5 用 `chip-${amt}.png` 拼出来的动态引用不会受影响。
 */
function pruneSupersededPng(imagesDir: string) {
  if (!fs.existsSync(imagesDir)) return
  for (const file of walkFiles(imagesDir)) {
    if (!/\.png$/i.test(file)) continue
    if (!fs.existsSync(file.replace(/\.png$/i, '.webp'))) continue
    try {
      fs.unlinkSync(file)
    } catch {
      /* ignore */
    }
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
        else copyDirFiltered(gamesAssetsDir, outGa, (rel) => !isBuildIntermediate(rel))
      }

      pruneSupersededPng(path.join(dist, 'images'))

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
      const game = String(process.env.VITE_GAME_ORIGIN || '').replace(/\/$/, '')
      console.log(`\n[slim-app] 已瘦包。素材 ${origin}，接口 ${api}，游戏 ${game || '(回退素材域)'}。\n`)
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
  // APK 必须以 .env.app 为准。shell 里残留的 VITE_GAME_ORIGIN（例如本机
  // 测网页时设的 games.local.test）优先级高于 dotenv，会打进正式包，手机打不开游戏。
  if (mode === 'app') {
    const appFile = readDotEnvFile(path.join(__dirname, '.env.app'))
    for (const key of [
      'VITE_SLIM_APP',
      'VITE_ASSET_ORIGIN',
      'VITE_API_ORIGIN',
      'VITE_GAME_ORIGIN',
      'VITE_API_FALLBACK_ORIGINS',
      'VITE_ASSET_FALLBACK_ORIGINS',
      'VITE_GAME_FALLBACK_ORIGINS',
    ]) {
      if (appFile[key]) process.env[key] = appFile[key]
    }
  }

  const env = loadEnv(mode, __dirname, '')
  if (mode === 'app') {
    const appFile = readDotEnvFile(path.join(__dirname, '.env.app'))
    for (const key of [
      'VITE_SLIM_APP',
      'VITE_ASSET_ORIGIN',
      'VITE_API_ORIGIN',
      'VITE_GAME_ORIGIN',
      'VITE_API_FALLBACK_ORIGINS',
      'VITE_ASSET_FALLBACK_ORIGINS',
      'VITE_GAME_FALLBACK_ORIGINS',
    ]) {
      if (appFile[key]) env[key] = appFile[key]
    }
  }
  if (env.VITE_SLIM_APP === '1') process.env.VITE_SLIM_APP = '1'
  if (env.VITE_ASSET_ORIGIN) process.env.VITE_ASSET_ORIGIN = env.VITE_ASSET_ORIGIN
  if (env.VITE_API_ORIGIN) process.env.VITE_API_ORIGIN = env.VITE_API_ORIGIN
  if (env.VITE_GAME_ORIGIN) process.env.VITE_GAME_ORIGIN = env.VITE_GAME_ORIGIN
  if (env.VITE_API_FALLBACK_ORIGINS) process.env.VITE_API_FALLBACK_ORIGINS = env.VITE_API_FALLBACK_ORIGINS
  if (env.VITE_ASSET_FALLBACK_ORIGINS) process.env.VITE_ASSET_FALLBACK_ORIGINS = env.VITE_ASSET_FALLBACK_ORIGINS
  if (env.VITE_GAME_FALLBACK_ORIGINS) process.env.VITE_GAME_FALLBACK_ORIGINS = env.VITE_GAME_FALLBACK_ORIGINS

  const nativeBuild = mode === 'app' || env.VITE_SLIM_APP === '1'

  if (command === 'build') {
    const errors = nativeBuild
      ? [
          originConfigError('VITE_ASSET_ORIGIN（Native 游戏素材域）', env.VITE_ASSET_ORIGIN),
          originConfigError('VITE_API_ORIGIN（Native 后端域）', env.VITE_API_ORIGIN),
          env.VITE_GAME_ORIGIN
            ? originConfigError('VITE_GAME_ORIGIN（Native 独立游戏域）', env.VITE_GAME_ORIGIN)
            : null,
          env.VITE_GAME_ORIGIN && /local\.test|localhost/i.test(env.VITE_GAME_ORIGIN)
            ? 'VITE_GAME_ORIGIN 不能是本机测试域名，APK 必须指向线上游戏域'
            : null,
          originListConfigError('VITE_API_FALLBACK_ORIGINS', env.VITE_API_FALLBACK_ORIGINS),
          originListConfigError('VITE_ASSET_FALLBACK_ORIGINS', env.VITE_ASSET_FALLBACK_ORIGINS),
          originListConfigError('VITE_GAME_FALLBACK_ORIGINS', env.VITE_GAME_FALLBACK_ORIGINS),
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
    /*
     * precompress 必须排在 finalizeStaticAssets 之后：games-assets 是那一步才复制进 dist 的。
     * Native 包里不能有 .gz：aapt 打包 assets 时会自动剥掉 .gz 后缀，xxx.css 和 xxx.css.gz
     * 会撞成同一个资源名，gradle 直接报 Duplicate resources。APK 里也没有 nginx 用它们。
     */
    plugins: [
      vue(),
      serveGamesAssetsDev(),
      finalizeStaticAssets(),
      ...(nativeBuild ? [] : [precompressAssets()]),
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
          manualChunks(id: string) {
            const p = id.replace(/\\/g, '/')
            if (!p.includes('node_modules')) return
            /*
             * pixi 只有奔驰宝马的龙骨动画用得上，是全站最大的依赖。
             * 不单独拆出去，它会被并进公共 vendor，让每个首次进站的用户都白下一份。
             */
            if (p.includes('/pixi.js/') || p.includes('/@pixi/')) return 'pixi-vendor'
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
