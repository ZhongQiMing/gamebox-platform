/**
 * 玩家 / 代理大厅共用：游戏目录、期号倒计时、上期开奖底条
 */
import { computed, ref, reactive, onMounted, type Ref } from 'vue'
import { useActiveInterval } from '@/composables/useActiveInterval'
import { gamesApi } from '@/api/games'
import { TABLE_SERVER_CODE, type TableSnapshot } from '@/api/table'
import { lobbyApi, type LobbySnapshot } from '@/api/lobby'
import { gameAssetUrl } from '@/utils/gameOrigin'
import {
  formatTableRoundNo,
  shortTableRoundLabel,
  tableLobbyIntervalSec,
  tableLobbyPrepSec,
  LOTTERY_INTERVALS,
  lotteryPrepSec,
} from '@gamebox/shared'

export interface LobbyGame {
  key: string
  name: string
  tag?: string
  type: 'lottery' | 'table' | 'instant'
  intervalSec?: number
  prepSec?: number
  iconImg?: string
  route?: string
  backendCode?: string
}

export function useGameLobbyCards(options?: {
  /** null/undefined = 仅按平台目录；传入数组 = 再按房间开启游戏过滤 */
  enabledCodes?: Ref<string[] | null | undefined>
}) {
  const enabledCodes = options?.enabledCodes

/* ===== 游戏列表（与原型 game-lobby.js 的 GAMES 一致） =====
 * type: 'lottery' 定时开奖；'table' 牌桌墙钟周期；'instant' 即时开局
 * route: 已接入后端的游戏跳转路由；无 route 的卡片点击提示「即将上线」 */
/** 大厅排序：时时彩 → 赛车飞艇 → 快三/六合 → 牌桌 → 街机电子 */
const GAMES: LobbyGame[] = [
  // —— 时时彩 ——
  {
    key: 'ssc', name: '快乐时时彩', type: 'lottery',
    intervalSec: LOTTERY_INTERVALS.ssc, prepSec: lotteryPrepSec('ssc'),
    iconImg: '/images/games/ssc/ssc.webp',
    route: '/game/lottery/ssc', backendCode: 'ssc',
  },
  {
    key: 'ffc', name: '1分时时彩', type: 'lottery',
    intervalSec: LOTTERY_INTERVALS.ffc, prepSec: lotteryPrepSec('ffc'),
    iconImg: '/images/games/ffc/ffc.webp',
    route: '/game/lottery/ffc', backendCode: 'ffc',
  },
  // —— 赛车 / 飞艇 ——
  {
    key: 'speed-racing', name: '极速赛车', type: 'lottery',
    intervalSec: LOTTERY_INTERVALS['speed-racing'], prepSec: lotteryPrepSec('speed-racing'),
    iconImg: '/images/games/speed-racing/speed-racing.webp',
    route: '/game/lottery/speed-racing', backendCode: 'speed-racing',
  },
  {
    key: 'bjsc', name: '北京赛车', type: 'lottery',
    intervalSec: LOTTERY_INTERVALS.bjsc, prepSec: lotteryPrepSec('bjsc'),
    iconImg: '/images/games/bjsc/bjsc.webp',
    route: '/game/lottery/bjsc', backendCode: 'bjsc',
  },
  {
    key: 'speed-boat', name: '幸运飞艇', type: 'lottery',
    intervalSec: LOTTERY_INTERVALS['speed-boat'], prepSec: lotteryPrepSec('speed-boat'),
    iconImg: '/images/games/speed-boat/speed-boat.webp',
    route: '/game/lottery/speed-boat', backendCode: 'speed-boat',
  },
  // —— 快三 / 六合 ——
  {
    key: 'kuai3', name: '1分快三', type: 'lottery',
    intervalSec: LOTTERY_INTERVALS.kuai3, prepSec: lotteryPrepSec('kuai3'),
    iconImg: '/images/games/kuai3/kuai3.webp',
    route: '/game/lottery/kuai3', backendCode: 'kuai3',
  },
  {
    key: 'lhc', name: '幸运六合彩', type: 'lottery',
    intervalSec: LOTTERY_INTERVALS.lhc, prepSec: lotteryPrepSec('lhc'),
    iconImg: '/images/games/hk-mark6/hk-mark6.webp',
    route: '/game/lottery/lhc', backendCode: 'lhc',
  },
  // —— 牌桌（prep = 开奖流程 + 派奖；不走彩票 API） ——
  {
    key: 'zhajinhua', name: '炸金花', tag: '热 门', type: 'table',
    intervalSec: tableLobbyIntervalSec('zhajinhua'), prepSec: tableLobbyPrepSec('zhajinhua'),
    iconImg: '/images/games/zhajinhua/zhajinhua.webp',
    route: '/game/table/zhajinhua', backendCode: 'zhajinhua',
  },
  {
    key: 'douniu', name: '斗牛', type: 'table',
    intervalSec: tableLobbyIntervalSec('douniu'), prepSec: tableLobbyPrepSec('douniu'),
    iconImg: '/images/games/douniu/douniu.webp',
    route: '/game/table/douniu', backendCode: 'douniu',
  },
  {
    key: 'baccarat', name: '百家乐', tag: '热 门', type: 'table',
    intervalSec: tableLobbyIntervalSec('baccarat'), prepSec: tableLobbyPrepSec('baccarat'),
    iconImg: '/images/games/baccarat/baccarat.webp',
    route: '/game/table/baccarat', backendCode: 'baccarat',
  },
  {
    key: 'longhu', name: '龙虎斗', tag: '新 品', type: 'table',
    intervalSec: tableLobbyIntervalSec('longhu'), prepSec: tableLobbyPrepSec('longhu'),
    iconImg: '/images/games/longhu/longhu-icon.webp',
    route: '/game/table/longhu', backendCode: 'dragon-tiger',
  },
  // —— 街机 / 电子 ——
  {
    key: 'slots', name: '水果机', type: 'instant',
    iconImg: '/images/games/slots/slots.webp',
    route: '/game/fruit', backendCode: 'fruit-machine',
  },
  {
    key: 'bcbm', name: '奔驰宝马', tag: '新 品', type: 'instant',
    iconImg: '/images/games/bcbm/bcbm-icon.webp',
    route: '/game/arcade/bcbm', backendCode: 'bcbm',
  },
]

/** code → ONLINE | MAINTENANCE（下架不在目录里） */
const catalogStatus = ref<Record<string, string>>({})
const catalogLoaded = ref(false)

function resolveBackendCode(g: LobbyGame): string | undefined {
  if (g.backendCode) return g.backendCode
  if (g.type === 'table') return TABLE_SERVER_CODE[g.key]
  return undefined
}

function platformStatus(g: LobbyGame): string | null {
  const code = resolveBackendCode(g)
  if (!code || !catalogLoaded.value) return null
  return catalogStatus.value[code] ?? null
}

async function loadCatalog() {
  try {
    const list = await gamesApi.list()
    const next: Record<string, string> = {}
    for (const g of list) {
      if (g?.code) next[g.code] = g.status || 'ONLINE'
    }
    catalogStatus.value = next
  } catch {
    catalogStatus.value = {}
  } finally {
    catalogLoaded.value = true
  }
}

function isPlatformOnline(g: LobbyGame): boolean {
  return platformStatus(g) === 'ONLINE'
}

function isMaintenance(g: LobbyGame): boolean {
  return platformStatus(g) === 'MAINTENANCE'
}

/** 上架可玩 + 维护可见；下架不展示；可选房间 enabledCodes 再过滤 */
  const visibleGames = computed(() =>
    GAMES.filter((g) => {
      const s = platformStatus(g)
      if (s !== 'ONLINE' && s !== 'MAINTENANCE') return false
      const codes = enabledCodes?.value
      if (codes == null) return true
      if (!codes.length) return false
      const set = new Set(codes.map(String))
      const code = resolveBackendCode(g)
      return (code && set.has(code)) || set.has(g.key)
    }),
  )

/* ===== 跑马灯：中性运营文案（禁止伪造「某某赢了 xxx」） ===== */
const marqueeItems = ref<string[]>([])

function buildMarquee() {
  marqueeItems.value = [
    '理性娱乐 · 量力而行',
    '开奖结果以房间官方公告为准',
    '下注前请确认玩法与赔率',
    '封盘后请等待开奖动画完成',
    '祝您游戏愉快',
    '积分变动以账户余额为准',
  ]
}

/* ===== 期号 / 倒计时滴答：倒计时显示 = 总时间 − 准备中 ===== */

/** 开奖号码形态：大厅底条展示用 */
type DrawKind = 'digit5' | 'dice3' | 'pk10' | 'lhc' | 'table'

const DRAW_KIND: Record<string, DrawKind> = {
  ssc: 'digit5',
  ffc: 'digit5',
  kuai3: 'dice3',
  bjsc: 'pk10',
  'speed-racing': 'pk10',
  'speed-boat': 'pk10',
  lhc: 'lhc',
  zhajinhua: 'table',
  douniu: 'table',
  baccarat: 'table',
  longhu: 'table',
}

/** 各 PK10 游戏自带赛道号素材目录（与游戏内 ballHtml 一致） */
const PK10_BALL_BASE: Record<string, string> = {
  bjsc: '/games-assets/bjsc/assets/balls',
  'speed-racing': '/games-assets/speed-racing/assets/balls',
  'speed-boat': '/games-assets/speed-boat/assets/balls',
}

function isPk10Game(key: string) {
  return DRAW_KIND[key] === 'pk10'
}
function isDice3Game(key: string) {
  return DRAW_KIND[key] === 'dice3'
}
function isDigit5Game(key: string) {
  return DRAW_KIND[key] === 'digit5'
}
function isLhcGame(key: string) {
  return DRAW_KIND[key] === 'lhc'
}

function pk10BallUrl(gameKey: string, n: string) {
  const base = PK10_BALL_BASE[gameKey] || PK10_BALL_BASE['speed-racing']
  const num = Math.max(1, Math.min(10, Number(n) || 1))
  return gameAssetUrl(`${base}/ball-${String(num).padStart(2, '0')}.png`)
}

/** 快三大厅用游戏内 xs/tbl 同款扁平骰子图标 */
function kuai3DiceUrl(n: string) {
  const num = Math.max(1, Math.min(6, Number(n) || 1))
  return gameAssetUrl(`/games-assets/kuai3/assets/result/icon-${String(num).padStart(2, '0')}.png`)
}

/** 六合彩：与游戏内 ballHtml 同路径 ball_01.png … ball_49.png */
function lhcBallUrl(n: string) {
  const num = Math.max(1, Math.min(49, Number(n) || 1))
  return gameAssetUrl(`/games-assets/lhc/assets/balls/ball_${String(num).padStart(2, '0')}.png`)
}

/** 大厅底条：正码 6 + 「+」+ 特码（接口若无加号则补上） */
function lhcFootNums(nums: string[]): string[] {
  const raw = nums.filter((n) => n !== '+')
  if (raw.length < 7) return nums
  const mains = raw.slice(0, 6).map((n) => String(n).padStart(2, '0'))
  const special = String(raw[6]).padStart(2, '0')
  return [...mains, '+', special]
}

interface DrawPart {
  kind: 'side' | 'card' | 'point' | 'hand' | 'result' | 'tag' | 'sep'
  text: string
  tone?: 'dragon' | 'tiger' | 'banker' | 'player' | 'tie' | 'win' | 'red' | 'black'
}

interface CardState {
  /** 大厅短显期号/局号 */
  issue: string
  prevIssue: string
  /** 完整期号（title 悬停，不占版面） */
  issueFull?: string
  prevIssueFull?: string
  cdText: string
  cdClass: string
  /** 数字彩开奖号 */
  nums: string[]
  /** 牌类详细结果（优先展示） */
  parts: DrawPart[]
}

const cardState = reactive<Record<string, CardState>>({})
/** 后端历史开奖缓存（优先于本地种子结果） */
const apiDrawCache = reactive<Record<string, { issueNo: string; nums: string[]; parts?: DrawPart[] }>>({})
/** 后端当前期号（与进房后 serverCurrent.issueNo 对齐） */
const apiCurrentCache = reactive<Record<string, string>>({})
/** 彩票直播相位（来自 /lottery/.../current，与进房 lockAt 对齐） */
const apiLotteryLive = reactive<Record<string, {
  issueNo: string
  lockAt: number
  openAt: number
  status: string
  fetchedAt: number
}>>({})
/** 牌桌直播相位（来自 /table/.../snapshot） */
const apiTableLive = reactive<Record<string, { phase: string; secondsLeft: number; roundNo: string; fetchedAt: number }>>({})

/** 全部彩票：上海日 MMDD + 当日序号（每日 00:00 重置） */
const LOTTERY_ISSUE_KEYS = new Set([
  'ssc', 'ffc', 'kuai3', 'lhc', 'bjsc', 'speed-racing', 'speed-boat',
])

function shanghaiYmdParts(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date)
  const get = (t: string) => parts.find((p) => p.type === t)?.value || '01'
  return { y: get('year'), m: get('month'), d: get('day') }
}

/** Asia/Shanghai 当日 0 点（与彩票 H5 / 服务端日切一致） */
function todayStartMs() {
  const p = shanghaiYmdParts()
  return Date.parse(`${p.y}-${p.m}-${p.d}T00:00:00+08:00`)
}
function pad(n: number, w: number) { return String(n).padStart(w, '0') }

/**
 * 彩票大厅短显：仅认日切全号 MMDD+6 位 → 取当日序号后 4 位。
 * 旧连续累加号（如 1087645）禁止再截后四位，否则会误显示成「七千多期」。
 */
function shortLotteryIssueLabel(issueNo: string): string | null {
  const s = String(issueNo || '').trim()
  if (!s || s === '—' || s === '— —') return null
  const m = s.match(/^\d{4}(\d{6})$/)
  if (m) return m[1].slice(-4)
  return null
}

/** 与服务端 _nextAlignedTime 一致：UTC epoch 整除对齐的下一开奖点 */
function nextOpenAtMs(intervalSec: number, now = Date.now()) {
  const intervalMs = intervalSec * 1000
  return Math.ceil(now / intervalMs) * intervalMs
}
/** 本地兜底期号/局号：按 openAt 对齐服务端公式（有 API 时优先 API） */
function fmtLobbyIssueFromOpenAt(gameKey: string, openAtMs: number, intervalSec: number) {
  const intervalMs = intervalSec * 1000
  if (LOTTERY_ISSUE_KEYS.has(gameKey)) {
    const p = shanghaiYmdParts(new Date(openAtMs))
    const dayStart = Date.parse(`${p.y}-${p.m}-${p.d}T00:00:00+08:00`)
    const seq = Math.floor((openAtMs - dayStart) / intervalMs) + 1
    return `${p.m}${p.d}${pad(Math.max(1, seq), 6)}`
  }
  /* 牌桌：与 @gamebox/shared formatTableRoundNo / 服务端 alignedRoundNo 同源 */
  if (DRAW_KIND[gameKey] === 'table') {
    const serverCode = TABLE_SERVER_CODE[gameKey] || gameKey
    return formatTableRoundNo(serverCode, intervalMs, openAtMs)
  }
  return pad(Math.max(1, Math.floor((openAtMs - todayStartMs()) / intervalMs) + 1), 6)
}
function fmtMmss(sec: number) {
  const s = Math.max(0, Math.ceil(sec))
  return pad(Math.floor(s / 60), 2) + ':' + pad(s % 60, 2)
}

function faceCardText(card: unknown): { text: string; tone: 'red' | 'black' } {
  const c = (card || {}) as { suit?: string; rank?: string | number }
  const suitMap: Record<string, string> = {
    spade: '♠', heart: '♥', club: '♣', diamond: '♦',
    S: '♠', H: '♥', C: '♣', D: '♦',
  }
  const suit = suitMap[String(c.suit || '')] || '?'
  let rank = '?'
  if (typeof c.rank === 'number') {
    rank = ({ 1: 'A', 11: 'J', 12: 'Q', 13: 'K' } as Record<number, string>)[c.rank] ?? String(c.rank)
  } else if (c.rank != null) {
    rank = String(c.rank)
  }
  const tone = suit === '♥' || suit === '♦' ? 'red' as const : 'black' as const
  return { text: `${suit}${rank}`, tone }
}

function resultPart(result: string, style: 'lhd' | 'bp'): DrawPart {
  if (style === 'lhd') {
    if (result === 'dragon') return { kind: 'result', text: '龙赢', tone: 'dragon' }
    if (result === 'tiger') return { kind: 'result', text: '虎赢', tone: 'tiger' }
    return { kind: 'result', text: '和局', tone: 'tie' }
  }
  if (result === 'banker') return { kind: 'result', text: '庄赢', tone: 'banker' }
  if (result === 'player') return { kind: 'result', text: '闲赢', tone: 'player' }
  return { kind: 'result', text: '和局', tone: 'tie' }
}

/** 将 /table snapshot 的 outcome 转为大厅底条 DrawPart */
function outcomeToParts(gameKey: string, outcome: Record<string, unknown> | null | undefined): DrawPart[] {
  if (!outcome) return []
  const sep = (): DrawPart => ({ kind: 'sep', text: '·' })
  if (gameKey === 'longhu') {
    const d = faceCardText(outcome.dragon)
    const t = faceCardText(outcome.tiger)
    return [
      { kind: 'side', text: '龙', tone: 'dragon' },
      { kind: 'card', text: d.text, tone: d.tone },
      sep(),
      { kind: 'side', text: '虎', tone: 'tiger' },
      { kind: 'card', text: t.text, tone: t.tone },
      sep(),
      resultPart(String(outcome.result || ''), 'lhd'),
    ]
  }
  if (gameKey === 'baccarat') {
    const banker = Array.isArray(outcome.banker) ? outcome.banker : []
    const player = Array.isArray(outcome.player) ? outcome.player : []
    const bText = banker.map((c) => faceCardText(c).text).join(' ')
    const pText = player.map((c) => faceCardText(c).text).join(' ')
    const parts: DrawPart[] = [
      { kind: 'side', text: '庄', tone: 'banker' },
      { kind: 'card', text: bText || '—' },
      { kind: 'point', text: `${Number(outcome.bankerPoint ?? 0)}点`, tone: 'banker' },
      { kind: 'side', text: '闲', tone: 'player' },
      { kind: 'card', text: pText || '—' },
      { kind: 'point', text: `${Number(outcome.playerPoint ?? 0)}点`, tone: 'player' },
      resultPart(String(outcome.result || ''), 'bp'),
    ]
    if (outcome.bankerPair) parts.push({ kind: 'tag', text: '庄对', tone: 'banker' })
    if (outcome.playerPair) parts.push({ kind: 'tag', text: '闲对', tone: 'player' })
    return parts
  }
  if (gameKey === 'zhajinhua' || gameKey === 'douniu') {
    const bt = (outcome.bankerType as { label?: string } | undefined)?.label || '—'
    const pt = (outcome.playerType as { label?: string } | undefined)?.label || '—'
    return [
      { kind: 'side', text: '庄', tone: 'banker' },
      { kind: 'hand', text: bt, tone: 'banker' },
      sep(),
      { kind: 'side', text: '闲', tone: 'player' },
      { kind: 'hand', text: pt, tone: 'player' },
      sep(),
      resultPart(String(outcome.result || 'banker'), 'bp'),
    ]
  }
  return []
}

function parseApiDrawNumbers(raw: string | null | undefined): string[] {
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw)
    if (Array.isArray(parsed)) return parsed.map((n) => String(n))
  } catch {
    /* ignore */
  }
  return []
}

function resolveDraw(gameKey: string, prevIssue: string): { nums: string[]; parts: DrawPart[] } {
  if (!prevIssue || prevIssue === '— —') return { nums: [], parts: [] }
  const cached = apiDrawCache[gameKey]
  // 牌类优先用服务端 snapshot 历史；无 cache 不造假开奖
  if (DRAW_KIND[gameKey] === 'table') {
    if (cached?.parts?.length) return { nums: [], parts: cached.parts }
    return { nums: [], parts: [] }
  }
  if (cached?.nums?.length) {
    return { nums: cached.nums, parts: [] }
  }
  return { nums: [], parts: [] }
}

function numClass(gameKey: string, n: string, index: number) {
  const kind = DRAW_KIND[gameKey] ?? 'digit5'
  if (n === '+') return 'gc-num--sep'
  if (kind === 'lhc' && index === 7) return 'gc-num--special'
  const v = Number(n)
  if (!Number.isFinite(v)) return ''
  if (v >= 5) return 'gc-num--big'
  return 'gc-num--small'
}

  /** 把一个彩种的聚合结果写进本地缓存（倒计时相位 + 上期开奖号） */
  function applyLotteryEntry(g: LobbyGame, entry: LobbySnapshot['lottery'][string] | undefined) {
    if (!entry) return
    const current = entry.current
    if (current?.issueNo) {
      apiCurrentCache[g.key] = String(current.issueNo)
      const lockAt = new Date(current.lockAt).getTime()
      const openAt = new Date(current.openAt).getTime()
      if (Number.isFinite(lockAt) && Number.isFinite(openAt)) {
        apiLotteryLive[g.key] = {
          issueNo: String(current.issueNo),
          lockAt,
          openAt,
          status: String(current.status || ''),
          fetchedAt: Date.now(),
        }
      }
    }
    const row = entry.lastDraw
    if (!row) return
    const nums = parseApiDrawNumbers(row.drawNumbers)
    if (!nums.length) return
    apiDrawCache[g.key] = { issueNo: String(row.issueNo), nums }
  }

  /** 把一个牌桌的快照写进本地缓存（相位 + 上一局结果芯片） */
  function applyTableSnap(g: LobbyGame, snap: TableSnapshot | null | undefined) {
    if (!snap) return
    apiTableLive[g.key] = {
      phase: snap.phase,
      secondsLeft: snap.secondsLeft,
      roundNo: snap.roundNo,
      fetchedAt: Date.now(),
    }
    if (snap.roundNo) apiCurrentCache[g.key] = String(snap.roundNo)

    const hist = snap.history || []
    /* DRAWING/SETTLED：history[0] 常=当前局；上期取 history[1]
       BETTING：history[0] 才是真正上期 */
    let prevIdx = 0
    if (snap.phase === 'DRAWING' || snap.phase === 'SETTLED') {
      if (hist[0]?.roundNo === snap.roundNo) prevIdx = 1
    }
    const prev = hist[prevIdx]
    const outcome = (prev?.outcome
      || (snap.phase !== 'BETTING' ? snap.outcome : undefined)) as Record<string, unknown> | undefined
    const parts = outcomeToParts(g.key, outcome)
    if (parts.length) {
      apiDrawCache[g.key] = {
        issueNo: String(prev?.roundNo || (snap.phase !== 'BETTING' ? snap.roundNo : '') || ''),
        nums: [],
        parts,
      }
    }
  }

  /**
   * 大厅聚合刷新：一个请求拿齐所有可见彩种 + 牌桌的状态。
   * 取代原先每游戏 1~2 个请求的轮询——十来个游戏原来一轮十七八个请求，现在就一个。
   */
  async function refreshLobbySnapshot() {
    const lotteryGames = visibleGames.value.filter((g) => g.type === 'lottery')
    const tableGames = visibleGames.value.filter((g) => g.type === 'table')
    if (!lotteryGames.length && !tableGames.length) return

    /* 服务端按 code 归集，这里建 code→游戏 的回填映射 */
    const lotteryByCode = new Map(lotteryGames.map((g) => [g.backendCode || g.key, g]))
    const tableByCode = new Map(tableGames.map((g) => [TABLE_SERVER_CODE[g.key] || g.key, g]))

    try {
      const snap = await lobbyApi.snapshot([...lotteryByCode.keys()], [...tableByCode.keys()])
      for (const [code, g] of lotteryByCode) applyLotteryEntry(g, snap.lottery?.[code])
      for (const [code, g] of tableByCode) applyTableSnap(g, snap.table?.[code])
    } catch {
      // 后端不可达：保留上一次缓存与本地种子结果，卡片不清空
    }
  }

function tickAll() {
  for (const g of GAMES) {
    if ((g.type !== 'lottery' && g.type !== 'table') || !g.intervalSec) {
      cardState[g.key] = {
        issue: '',
        prevIssue: '',
        cdText: '实时进行',
        cdClass: 'is-instant',
        nums: [],
        parts: [],
      }
      continue
    }
    const interval = g.intervalSec
    const prep = Math.max(1, g.prepSec ?? 4)
    const isLottery = g.type === 'lottery'
    const isTable = g.type === 'table'
    let r: number
    let localIssue: string
    let localPrev: string
    /* 聊天室彩票 / 牌桌：倒计时与服务端 UTC epoch 对齐网格一致 */
    const openAt = nextOpenAtMs(interval)
    r = (openAt - Date.now()) / 1000
    if (r <= 0) r = interval
    if (isTable) {
      /* 牌桌：当前墙钟周期 = 正在进行的局；勿用 nextOpen（那是下一局） */
      localIssue = fmtLobbyIssueFromOpenAt(g.key, Date.now(), interval)
      localPrev = fmtLobbyIssueFromOpenAt(g.key, Date.now() - interval * 1000, interval)
    } else {
      localIssue = fmtLobbyIssueFromOpenAt(g.key, openAt, interval)
      localPrev = fmtLobbyIssueFromOpenAt(g.key, openAt - interval * 1000, interval)
    }

    let cdText: string
    let cdClass = ''
    const nowMs = Date.now()
    const liveTable = isTable ? apiTableLive[g.key] : undefined
    const liveLot = isLottery ? apiLotteryLive[g.key] : undefined
    /** 彩票直播包：期号与倒计时必须同包，禁止「旧期号 + 墙钟下一期秒数」拼盘 */
    let lotteryLiveIssue: string | null = null
    if (liveTable && nowMs - liveTable.fetchedAt < 20_000) {
      /* 牌桌近期 snapshot：按真实相位展示 */
      const elapsedSec = (nowMs - liveTable.fetchedAt) / 1000
      const left = Math.max(0, liveTable.secondsLeft - elapsedSec)
      if (liveTable.phase === 'BETTING' && left > 0) {
        cdText = fmtMmss(left)
        cdClass = ''
      } else {
        cdText = '开奖中'
        cdClass = 'is-drawing'
      }
    } else if (liveLot && nowMs - liveLot.fetchedAt < 25_000) {
      if (nowMs >= liveLot.openAt) {
        /* 该期 openAt 已过：作废直播包，避免继续显示已结束期号配上下一期墙钟倒计时 */
        delete apiLotteryLive[g.key]
        if (apiCurrentCache[g.key] === liveLot.issueNo) delete apiCurrentCache[g.key]
        cdText = '开奖中'
        cdClass = 'is-drawing'
        lotteryLiveIssue = localIssue
      } else if (liveLot.status === 'PENDING' && nowMs < liveLot.lockAt) {
        cdText = fmtMmss((liveLot.lockAt - nowMs) / 1000)
        cdClass = ''
        lotteryLiveIssue = liveLot.issueNo
      } else {
        cdText = '开奖中'
        cdClass = 'is-drawing'
        lotteryLiveIssue = liveLot.issueNo
      }
    } else {
      if (liveLot && nowMs - liveLot.fetchedAt >= 25_000) {
        delete apiLotteryLive[g.key]
        if (apiCurrentCache[g.key] === liveLot.issueNo) delete apiCurrentCache[g.key]
      }
      if (r <= prep) {
        cdText = '开奖中'; cdClass = 'is-drawing'
      } else {
        cdText = fmtMmss(r - prep)
      }
    }
    /*
     * 牌桌双形态（必须严格分工，短号绝不能进 API / 验算 / 注单）：
     * - 权威全号 issueFull/prevFull：BJL20260725-0399（服务端 roundNo，缓存与 resolveDraw 只用它）
     * - 大厅短显 cardState：0399（pure display；进房点击不带期号）
     */
    const issueFull = isLottery
      ? (lotteryLiveIssue || apiCurrentCache[g.key] || localIssue)
      : (apiCurrentCache[g.key] || localIssue)
    const prevFull = apiDrawCache[g.key]?.issueNo || localPrev
    let issue = issueFull
    let prevIssue = prevFull
    if (isTable) {
      issue = shortTableRoundLabel(issueFull) || shortTableRoundLabel(localIssue) || '—'
      const prevShort = shortTableRoundLabel(prevFull)
      if (prevShort) {
        prevIssue = prevShort
      } else if (!prevFull) {
        /* 尚无服务端上期：才允许本地全号派生短显 */
        prevIssue = shortTableRoundLabel(localPrev) || '— —'
      } else {
        /* 上期仍是旧 T… / 乱号：结果芯片可信，局号勿用本地短号冒充成另一局 */
        prevIssue = '— —'
      }
    } else if (isLottery) {
      issue = shortLotteryIssueLabel(issueFull) || shortLotteryIssueLabel(localIssue) || '—'
      /* 历史若仍是旧连续号，short 会得到 null，回退本地日切上期，避免底条空白或假「七千期」 */
      prevIssue = shortLotteryIssueLabel(prevFull)
        || shortLotteryIssueLabel(localPrev)
        || '— —'
    }
    const draw = resolveDraw(g.key, prevFull)
    cardState[g.key] = {
      issue,
      prevIssue,
      issueFull,
      prevIssueFull: prevFull || undefined,
      cdText,
      cdClass,
      nums: draw.nums,
      parts: draw.parts,
    }
  }
}



/* 一轮就是 11 个并发请求，弱网下上一轮没回来就再发会越堆越多 */
  let drawsInFlight = false
  function refreshDraws() {
    if (drawsInFlight) return
    drawsInFlight = true
    void refreshLobbySnapshot()
      .then(() => tickAll())
      .finally(() => { drawsInFlight = false })
  }

  /* 倒计时纯本地计算（UTC 网格），不发请求，回到页面无需补跑 */
  useActiveInterval(tickAll, 1000, { refreshOnResume: false })
  /*
   * 开奖结果/期号刷新。倒计时既然是本地算的，这里只为同步「期号 + 上期结果」，
   * 一次聚合请求拿齐所有卡片，8s 一轮足够。
   */
  useActiveInterval(refreshDraws, 8000)

  onMounted(async () => {
    buildMarquee()
    tickAll()
    await loadCatalog()
    await refreshLobbySnapshot()
    tickAll()
  })

  return {
    marqueeItems,
    visibleGames,
    cardState,
    isMaintenance,
    isPlatformOnline,
    isPk10Game,
    isDice3Game,
    isDigit5Game,
    isLhcGame,
    pk10BallUrl,
    kuai3DiceUrl,
    lhcBallUrl,
    lhcFootNums,
    numClass,
    loadCatalog,
    refreshAll: async () => {
      await loadCatalog()
      await refreshLobbySnapshot()
      tickAll()
    },
  }
}

