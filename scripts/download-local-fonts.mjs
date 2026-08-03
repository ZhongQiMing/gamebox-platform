/**
 * 从 Google Fonts 拉取 css2 + woff2，改写为本地 /fonts/ 路径。
 * 用法：node scripts/download-local-fonts.mjs
 */
import fs from 'node:fs'
import path from 'node:path'
import https from 'node:https'
import { fileURLToPath } from 'node:url'
import crypto from 'node:crypto'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const outDir = path.join(__dirname, '../client-app/public/fonts')
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'

const CSS_URL =
  'https://fonts.googleapis.com/css2?' +
  [
    'family=Ma+Shan+Zheng',
    'family=Noto+Serif+SC:wght@500;600;700;900',
    'family=Orbitron:wght@600;700;900',
    'family=ZCOOL+QingKe+HuangYou',
    'display=swap',
  ].join('&')

function fetchBuf(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(
      url,
      { headers: { 'User-Agent': UA, Accept: 'text/css,*/*;q=0.1' } },
      (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          fetchBuf(res.headers.location).then(resolve, reject)
          return
        }
        if (res.statusCode !== 200) {
          reject(new Error(`HTTP ${res.statusCode} ${url}`))
          res.resume()
          return
        }
        const chunks = []
        res.on('data', (c) => chunks.push(c))
        res.on('end', () => resolve(Buffer.concat(chunks)))
      },
    )
    req.on('error', reject)
  })
}

fs.mkdirSync(outDir, { recursive: true })
const filesDir = path.join(outDir, 'files')
fs.mkdirSync(filesDir, { recursive: true })

console.log('fetch css…')
let css = (await fetchBuf(CSS_URL)).toString('utf8')
const urls = [...new Set([...css.matchAll(/url\((https:\/\/[^)]+)\)/g)].map((m) => m[1]))]
console.log('woff2 count', urls.length)

const map = new Map()
for (let i = 0; i < urls.length; i++) {
  const url = urls[i]
  const ext = path.extname(new URL(url).pathname) || '.woff2'
  const hash = crypto.createHash('sha1').update(url).digest('hex').slice(0, 12)
  const name = `${hash}${ext}`
  const dest = path.join(filesDir, name)
  if (!fs.existsSync(dest)) {
    process.stdout.write(`  [${i + 1}/${urls.length}] ${name}\n`)
    fs.writeFileSync(dest, await fetchBuf(url))
  }
  map.set(url, `/fonts/files/${name}`)
}

for (const [from, to] of map) {
  css = css.split(from).join(to)
}

const outCss = path.join(outDir, 'gamebox-fonts.css')
fs.writeFileSync(outCss, `/* auto-generated local fonts — do not edit by hand */\n${css}`)
const total = fs
  .readdirSync(filesDir)
  .reduce((n, f) => n + fs.statSync(path.join(filesDir, f)).size, 0)
console.log('wrote', outCss)
console.log(`files: ${urls.length}, size: ${(total / 1024 / 1024).toFixed(2)} MB`)
