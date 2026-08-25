/**
 * 生成安卓 App 图标与启动图（金御汇品牌：深棕黑底 + 古典金皇冠徽章）。
 *
 * 素材来源是玩家端已有的 public/images/splash-medal.png，
 * 图标和开屏都用它，App 装上去和进入欢迎页是同一枚徽章，不会跳。
 *
 * 用法（必须在 client-app 目录下跑，sharp 装在那边）：
 *   cd client-app && node ../scripts/gen-app-icons.mjs
 *
 * 跑完要 pnpm app:release 重新打包才会进 APK。
 */
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const clientApp = path.join(here, '..', 'client-app')
// sharp 只装在 client-app 里；ESM 按脚本自身位置找包，所以显式从那边解析
const sharp = createRequire(path.join(clientApp, 'package.json'))('sharp')
const res = path.join(clientApp, 'android', 'app', 'src', 'main', 'res')
const medalSrc = path.join(clientApp, 'public', 'images', 'splash-medal.png')
const artSrc = path.join(clientApp, 'android', 'branding', 'splash-bg.png')

/** AI 底图里那个空金环的位置（占全图比例），徽章要正好嵌进去 */
const RING = { cx: 0.505, cy: 0.357, diameter: 0.50 }

const BG = '#0d0a08'
const GOLD = '#d4af37'

if (!fs.existsSync(medalSrc)) throw new Error(`找不到品牌徽章：${medalSrc}`)

function out(dir, file) {
  const full = path.join(res, dir)
  fs.mkdirSync(full, { recursive: true })
  return path.join(full, file)
}

/** 深色底 + 顶部金光晕 + 底部酒红微光，和 body.deco-bg 的两层渐变同一套配方。 */
function backdropSvg(w, h, { round = false } = {}) {
  const shape = round
    ? `<circle cx="${w / 2}" cy="${h / 2}" r="${Math.min(w, h) / 2}" fill="url(#base)"/>`
    : `<rect width="${w}" height="${h}" fill="url(#base)"/>`
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">
  <defs>
    <radialGradient id="base" cx="50%" cy="42%" r="78%">
      <stop offset="0%" stop-color="#221a10"/>
      <stop offset="55%" stop-color="#140f0a"/>
      <stop offset="100%" stop-color="${BG}"/>
    </radialGradient>
    <radialGradient id="topGlow" cx="50%" cy="-6%" r="62%">
      <stop offset="0%" stop-color="${GOLD}" stop-opacity="0.22"/>
      <stop offset="100%" stop-color="${GOLD}" stop-opacity="0"/>
    </radialGradient>
    <radialGradient id="botGlow" cx="50%" cy="106%" r="55%">
      <stop offset="0%" stop-color="#a32130" stop-opacity="0.20"/>
      <stop offset="100%" stop-color="#a32130" stop-opacity="0"/>
    </radialGradient>
    <clipPath id="clip">${round
      ? `<circle cx="${w / 2}" cy="${h / 2}" r="${Math.min(w, h) / 2}"/>`
      : `<rect width="${w}" height="${h}"/>`}</clipPath>
  </defs>
  ${shape}
  <g clip-path="url(#clip)">
    <rect width="${w}" height="${h}" fill="url(#topGlow)"/>
    <rect width="${w}" height="${h}" fill="url(#botGlow)"/>
  </g>
</svg>`)
}

/** 徽章原图只有 512px；放大到它以上时用 lanczos3 再补一点锐度，别让系统去糊放。 */
async function medal(size) {
  let img = sharp(medalSrc).resize(size, size, {
    fit: 'contain',
    kernel: 'lanczos3',
    background: { r: 0, g: 0, b: 0, alpha: 0 },
  })
  if (size > 512) img = img.sharpen({ sigma: 0.7 })
  return img.png().toBuffer()
}

async function composeIcon(canvas, medalRatio, file, { round = false, transparent = false } = {}) {
  const m = Math.round(canvas * medalRatio)
  const offset = Math.round((canvas - m) / 2)
  const layers = [{ input: await medal(m), top: offset, left: offset }]
  const base = transparent
    ? sharp({ create: { width: canvas, height: canvas, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    : sharp(await sharp(backdropSvg(canvas, canvas, { round })).png().toBuffer())
  await base.composite(layers).png().toFile(file)
}

/**
 * 竖屏开屏主图：AI 底图（1024×1536）+ 徽章嵌进图中间那个金环。
 * 先在原分辨率合成一张母版，各尺寸再从母版 cover 缩放，
 * 徽章跟着底图一起缩，永远落在金环正中，不会因为屏幕比例不同跑出环外。
 */
let portraitMasterCache = null
async function portraitMaster() {
  if (portraitMasterCache) return portraitMasterCache
  if (!fs.existsSync(artSrc)) throw new Error(`找不到开屏底图：${artSrc}`)
  const { width: W, height: H } = await sharp(artSrc).metadata()
  const m = Math.round(W * RING.diameter)
  portraitMasterCache = await sharp(artSrc)
    .composite([{
      input: await medal(m),
      left: Math.round(W * RING.cx - m / 2),
      top: Math.round(H * RING.cy - m / 2),
    }])
    .png()
    .toBuffer()
  return portraitMasterCache
}

/*
 * 开屏图一律出 WebP：这是有画面的整屏大图，同样画质下 PNG 要大十倍，
 * 全密度存一遍能让 APK 平白胖十几 MB。安卓资源系统本身支持 webp，
 * Capacitor 的 androidSplashResourceName 也是按名字找、不认后缀。
 * 同名 png 必须删掉，否则两份同名资源会让 aapt 直接报重复。
 */
function splashOut(dir) {
  const png = out(dir, 'splash.png')
  if (fs.existsSync(png)) fs.unlinkSync(png)
  return out(dir, 'splash.webp')
}

async function composeSplashPortrait(w, h, dir) {
  await sharp(await portraitMaster())
    .resize(w, h, { fit: 'cover', position: 'center', kernel: 'lanczos3' })
    .webp({ quality: 82 })
    .toFile(splashOut(dir))
}

/** 横屏很少见到（游戏和大厅都是竖版），保持纯深色底 + 居中徽章即可。 */
async function composeSplashLandscape(w, h, dir) {
  const m = Math.round(Math.min(w, h) * 0.34)
  const layers = [{
    input: await medal(m),
    top: Math.round(h / 2 - m / 2 - h * 0.04),
    left: Math.round(w / 2 - m / 2),
  }]
  await sharp(await sharp(backdropSvg(w, h)).png().toBuffer())
    .composite(layers)
    .webp({ quality: 82 })
    .toFile(splashOut(dir))
}

const LAUNCHER = { mdpi: 48, hdpi: 72, xhdpi: 96, xxhdpi: 144, xxxhdpi: 192 }
// 自适应图标画布 108dp，可见区只有中间 72dp（66.7%），徽章不能铺满否则会被裁
const FOREGROUND = { mdpi: 108, hdpi: 162, xhdpi: 216, xxhdpi: 324, xxxhdpi: 432 }
const PORT = { mdpi: [320, 480], hdpi: [480, 800], xhdpi: [720, 1280], xxhdpi: [960, 1600], xxxhdpi: [1280, 1920] }

async function main() {
  for (const [dpi, size] of Object.entries(LAUNCHER)) {
    await composeIcon(size, 0.82, out(`mipmap-${dpi}`, 'ic_launcher.png'))
    await composeIcon(size, 0.82, out(`mipmap-${dpi}`, 'ic_launcher_round.png'), { round: true })
  }
  for (const [dpi, size] of Object.entries(FOREGROUND)) {
    await composeIcon(size, 0.62, out(`mipmap-${dpi}`, 'ic_launcher_foreground.png'), { transparent: true })
  }
  for (const [dpi, [w, h]] of Object.entries(PORT)) {
    await composeSplashPortrait(w, h, `drawable-port-${dpi}`)
    await composeSplashLandscape(h, w, `drawable-land-${dpi}`)
  }
  // 默认桶给竖版：开屏插件按 CENTER_CROP 显示，取不到方向限定目录时也不该退成横图
  await composeSplashPortrait(1080, 1920, 'drawable')

  /*
   * 安卓 12+ 开屏中心图标。系统规格是 288dp 画布、只有中间 192dp 可见（2/3），
   * 之前直接借用 ic_launcher_foreground（xxxhdpi 才 432px、徽章仅 268px），
   * 被系统拉到 768px 显示，就是开屏发虚的原因。这里按最高密度一次给足。
   */
  const ICON_CANVAS = 1152
  const iconMedal = Math.round(ICON_CANVAS * (2 / 3))
  await sharp({
    create: { width: ICON_CANVAS, height: ICON_CANVAS, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
  })
    .composite([{
      input: await medal(iconMedal),
      top: Math.round((ICON_CANVAS - iconMedal) / 2),
      left: Math.round((ICON_CANVAS - iconMedal) / 2),
    }])
    .png()
    .toFile(out('drawable-xxxhdpi', 'splash_icon.png'))

  /*
   * App 进场画面用的整屏图。安卓 12+ 不让系统开屏显示大图，
   * 所以这张由 Web 层自己铺（见 components/AppIntro.vue），各版本安卓都能看到。
   * 放 public/images 根下：瘦包只裁 images/games，这张会随 APK 一起带走，
   * 断网冷启也能立刻显示，不用等网络。
   */
  await sharp(await portraitMaster())
    .resize(1080, 1920, { fit: 'cover', position: 'center', kernel: 'lanczos3' })
    .webp({ quality: 82 })
    .toFile(path.join(clientApp, 'public', 'images', 'app-intro.webp'))

  /*
   * 欢迎页那枚徽章：CSS 里显示 108px，而 webp 只有 216px（2 倍图），
   * 现在手机普遍 3～4 倍屏，等于再拉一次，页面上看着就是糊的。补到 432px。
   * 发布时 PNG 会被 pruneSupersededPng 剔掉，真正上线的就是这张 webp。
   */
  await sharp(medalSrc)
    .resize(432, 432, { kernel: 'lanczos3', fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .webp({ quality: 88 })
    .toFile(path.join(clientApp, 'public', 'images', 'splash-medal.webp'))

  fs.writeFileSync(
    out('values', 'ic_launcher_background.xml'),
    `<?xml version="1.0" encoding="utf-8"?>\n<resources>\n    <color name="ic_launcher_background">${BG}</color>\n</resources>\n`,
    'utf8',
  )
  // 安卓 12+ 的开屏窗口底色只认 windowSplashScreenBackground，读不到上面那张 splash.png，
  // 不给它就会先闪一屏白底，再跳进深色页面。
  fs.writeFileSync(
    out('values', 'colors.xml'),
    `<?xml version="1.0" encoding="utf-8"?>\n<resources>\n    <color name="brand_dark">${BG}</color>\n</resources>\n`,
    'utf8',
  )
  console.log('图标与启动图已全部生成')
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
