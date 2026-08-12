/**
 * 大厅首屏图片瘦身：把 512×512 的 RGBA PNG 转成实际显示尺寸的 WebP。
 *
 * 图标 CSS 里只占 92px，却存着 512px 无损 PNG，13 张合计 6.6MB，
 * 而 PNG 已是压缩格式、gzip 拿不到收益，只能靠换格式和降分辨率。
 *
 * 原 PNG 保留不删：Capacitor 原生壳与部分旧引用仍按 .png 找文件。
 *
 * 用法（需 Node >= 20 且能 require('sharp')）：
 *   node scripts/optimize-lobby-images.mjs
 *   SHARP_PATH=/abs/path/to/node_modules/sharp node scripts/optimize-lobby-images.mjs
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const PUBLIC_DIR = path.join(ROOT, 'client-app', 'public')

/** 目标宽度按 CSS 尺寸的 2 倍取，够覆盖主流手机的 DPR */
const TARGETS = [
  /* 登录页 hero 奖章：未登录用户看到的第一张图，CSS 108px */
  { glob: 'images/splash-medal.png', width: 216 },
  /* 四角装饰：几乎每个 Tab 页都铺四张，CSS 最大 200px */
  { glob: 'images/corner-flourish.png', width: 400 },
  /* 皇冠：CSS 最大 366px（推荐码页） */
  { glob: 'images/crown-emblem.png', width: 732 },
  /* 全局 body 底图：竖屏比例不能改，只换格式降质量 */
  { glob: 'images/textures/bg-dark-baroque-portrait.png', width: 1024, quality: 72 },

  { glob: 'images/games/ssc/ssc.png', width: 192 },
  { glob: 'images/games/ffc/ffc.png', width: 192 },
  { glob: 'images/games/speed-racing/speed-racing.png', width: 192 },
  { glob: 'images/games/bjsc/bjsc.png', width: 192 },
  { glob: 'images/games/speed-boat/speed-boat.png', width: 192 },
  { glob: 'images/games/kuai3/kuai3.png', width: 192 },
  { glob: 'images/games/hk-mark6/hk-mark6.png', width: 192 },
  { glob: 'images/games/zhajinhua/zhajinhua.png', width: 192 },
  { glob: 'images/games/douniu/douniu.png', width: 192 },
  { glob: 'images/games/baccarat/baccarat.png', width: 192 },
  { glob: 'images/games/longhu/longhu-icon.png', width: 192 },
  { glob: 'images/games/slots/slots.png', width: 192 },
  { glob: 'images/games/bcbm/bcbm-icon.png', width: 192 },
]

async function loadSharp() {
  const override = process.env.SHARP_PATH
  if (!override) {
    const mod = await import('sharp')
    return mod.default ?? mod
  }
  /* 入口在各版本间搬过家（lib/index.js → dist/），照包自己声明的来 */
  const pkg = JSON.parse(fs.readFileSync(path.join(override, 'package.json'), 'utf8'))
  const entry = pkg.main || pkg.exports?.['.']?.require || 'lib/index.js'
  const mod = await import(pathToFileURL(path.join(override, entry)).href)
  return mod.default ?? mod
}

function kb(bytes) {
  return (bytes / 1024).toFixed(0).padStart(5) + ' KB'
}

async function main() {
  const sharp = await loadSharp()
  let before = 0
  let after = 0

  for (const { glob, width, quality = 88 } of TARGETS) {
    const src = path.join(PUBLIC_DIR, glob)
    if (!fs.existsSync(src)) {
      console.warn(`跳过（不存在）: ${glob}`)
      continue
    }
    const dst = src.replace(/\.png$/i, '.webp')
    await sharp(src)
      .resize({ width, fit: 'inside', withoutEnlargement: true })
      .webp({ quality, effort: 6 })
      .toFile(dst)

    const srcSize = fs.statSync(src).size
    const dstSize = fs.statSync(dst).size
    before += srcSize
    after += dstSize
    const cut = ((1 - dstSize / srcSize) * 100).toFixed(1)
    console.log(`${kb(srcSize)} → ${kb(dstSize)}  -${cut.padStart(5)}%  ${glob}`)
  }

  console.log('')
  console.log(`合计 ${(before / 1024 / 1024).toFixed(2)} MB → ${(after / 1024 / 1024).toFixed(2)} MB`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
