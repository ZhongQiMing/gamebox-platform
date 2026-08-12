/**
 * 探活 + 可选 Telegram 告警（宝塔计划任务每 1～5 分钟跑一次即可）
 *
 * 用法：
 *   node scripts/health-alert.mjs
 *   # 或先复制 scripts/health-alert.env.example → scripts/health-alert.env 再填值
 *
 * 未配置 TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID 时：只检查、写日志，不发消息。
 * 配好后同一脚本会自动发 Telegram。
 *
 * 生产由 deploy-on-server.sh 自动写入 crontab（每 5 分钟）：
 *   node /opt/gamebox-platform/health-alert.mjs >> /opt/gamebox-platform/health-alert.log 2>&1
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.join(__dirname, '..')
const stateFile = path.join(__dirname, '.health-alert-state.json')
const envFile = path.join(__dirname, 'health-alert.env')

function loadEnvFile(file) {
  if (!fs.existsSync(file)) return
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const s = line.trim()
    if (!s || s.startsWith('#')) continue
    const i = s.indexOf('=')
    if (i <= 0) continue
    const key = s.slice(0, i).trim()
    let val = s.slice(i + 1).trim()
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1)
    }
    if (!(key in process.env)) process.env[key] = val
  }
}

loadEnvFile(envFile)

/*
 * 生产默认打 8080：docker-compose.prod 只把 web 容器映射到 127.0.0.1:8080，
 * server 自己不对宿主机开端口。默认写 3000 的话探活永远连不上，
 * 于是要么天天误报、要么被当成噪音关掉——两种结果都等于没有告警。
 * 本机裸跑（server 直接监听 3000）时用 HEALTH_URL 覆盖。
 */
const HEALTH_URL =
  process.env.HEALTH_URL || 'http://127.0.0.1:8080/api/health'
/* 只有 /api/health/reconcile 需要；普通 /api/health 不校验，带上也无害 */
const RECON_TOKEN = (process.env.RECON_HEALTH_TOKEN || '').trim()
const BOT = (process.env.TELEGRAM_BOT_TOKEN || '').trim()
const CHAT = (process.env.TELEGRAM_CHAT_ID || '').trim()
const COOLDOWN_SEC = Math.max(60, Number(process.env.ALERT_COOLDOWN_SEC || 1800))
const TIMEOUT_MS = Math.max(2000, Number(process.env.HEALTH_TIMEOUT_MS || 8000))

function now() {
  return new Date().toISOString()
}

function readState() {
  try {
    return JSON.parse(fs.readFileSync(stateFile, 'utf8'))
  } catch {
    return { ok: true, lastAlertAt: 0, lastNotifyKind: '' }
  }
}

function writeState(s) {
  fs.writeFileSync(stateFile, JSON.stringify(s, null, 2))
}

async function checkHealth() {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS)
  try {
    const res = await fetch(HEALTH_URL, {
      signal: ctrl.signal,
      headers: RECON_TOKEN ? { 'X-Recon-Token': RECON_TOKEN } : undefined,
    })
    const text = await res.text()
    let body
    try {
      body = JSON.parse(text)
    } catch {
      body = { raw: text.slice(0, 200) }
    }
    if (!res.ok) {
      return {
        ok: false,
        detail: `HTTP ${res.status} ${JSON.stringify(body)}`,
      }
    }
    /* 服务端统一包了一层 {code,data,message}，真正的 status 在 data 里 */
    const status = body?.data?.status ?? body?.status
    if (status && status !== 'ok' && status !== 'pending') {
      return { ok: false, detail: JSON.stringify(body) }
    }
    return { ok: true, detail: JSON.stringify(body) }
  } catch (e) {
    return { ok: false, detail: e instanceof Error ? e.message : String(e) }
  } finally {
    clearTimeout(timer)
  }
}

async function sendTelegram(text) {
  if (!BOT || !CHAT) {
    console.log(`[${now()}] telegram skipped (未配置 TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID)`)
    return false
  }
  const url = `https://api.telegram.org/bot${BOT}/sendMessage`
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: CHAT,
      text,
      disable_web_page_preview: true,
    }),
  })
  const body = await res.text()
  if (!res.ok) {
    console.error(`[${now()}] telegram failed: HTTP ${res.status} ${body}`)
    return false
  }
  console.log(`[${now()}] telegram sent`)
  return true
}

const result = await checkHealth()
const state = readState()
const ts = Date.now()

if (result.ok) {
  console.log(`[${now()}] health OK ${HEALTH_URL} ${result.detail}`)
  if (state.ok === false) {
    await sendTelegram(`✅ gamebox 已恢复\n${HEALTH_URL}\n${result.detail}`)
    writeState({ ok: true, lastAlertAt: ts, lastNotifyKind: 'recovered' })
  } else {
    writeState({ ...state, ok: true })
  }
  process.exit(0)
}

console.error(`[${now()}] health FAIL ${HEALTH_URL} ${result.detail}`)
const cooled = ts - (Number(state.lastAlertAt) || 0) >= COOLDOWN_SEC * 1000
const shouldNotify = state.ok !== false || cooled

if (shouldNotify) {
  await sendTelegram(
    `🚨 gamebox 健康检查失败\n${HEALTH_URL}\n${result.detail}\n时间: ${now()}`,
  )
  writeState({ ok: false, lastAlertAt: ts, lastNotifyKind: 'fail' })
} else {
  console.log(`[${now()}] alert suppressed (cooldown ${COOLDOWN_SEC}s)`)
  writeState({ ...state, ok: false })
}

process.exit(1)
