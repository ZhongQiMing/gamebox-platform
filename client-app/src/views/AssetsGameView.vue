<template>
  <div class="assets-game-shell">
    <iframe
      v-if="frameReady"
      ref="frameEl"
      class="assets-game-frame"
      :src="iframeSrc"
      :title="gameTitle"
      allow="autoplay"
      @load="onFrameLoad"
    />
    <div v-else class="assets-game-loading">加载中…</div>
  </div>
</template>

<script setup lang="ts">
/**
 * 静态 H5 游戏壳：通过 postMessage 与 iframe 桥接。
 * iframe 内下注 / 查余额 / 上下分 / 聊天等走父页 JWT 调 /api，再回传给 H5。
 */
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useUserStore } from '@/stores/user'
import { useWalletStore } from '@/stores/wallet'
import { useRoomStore } from '@/stores/room'
import { gamesApi } from '@/api/games'
import { lotteryApi } from '@/api/lottery'
import { roomsApi } from '@/api/rooms'
import { rechargeApi } from '@/api/recharge'
import http from '@/api/http'
import { useToast } from '@/composables/useToast'

const ASSET_GAMES: Record<string, string> = {
  bjsc: '/games-assets/bjsc/index.html?v=141',
  ssc: '/games-assets/ssc/index.html?v=158',
  ffc: '/games-assets/ffc/index.html?v=150',
  'speed-racing': '/games-assets/speed-racing/index.html?v=204',
  'speed-boat': '/games-assets/speed-boat/index.html?v=127',
  kuai3: '/games-assets/kuai3/index.html?v=141',
  lhc: '/games-assets/lhc/index.html?v=176',
  zhajinhua: '/games-assets/zhajinhua/index.html?v=338',
  douniu: '/games-assets/douniu/index.html?v=158',
  baccarat: '/games-assets/baccarat/index.html?v=49',
  longhu: '/games-assets/longhu/index.html?v=47',
}

/** H5 gameCode → 服务端 lottery/table code */
const SERVER_GAME_CODE: Record<string, string> = {
  longhu: 'dragon-tiger',
}

const AVATAR_FALLBACK = '/images/avatars/001.jpg'

const route = useRoute()
const router = useRouter()
const { toast } = useToast()
const userStore = useUserStore()
const walletStore = useWalletStore()
const roomStore = useRoomStore()
const frameEl = ref<HTMLIFrameElement | null>(null)
const frameReady = ref(false)
/** 桥接 token：iframe 就绪后 init 下发；部分 WebView contentWindow === 不可靠时作备用校验 */
const bridgeToken = ref('')
let frameWindow: Window | null = null

function ensureBridgeToken() {
  if (!bridgeToken.value) {
    bridgeToken.value =
      'bt_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 10)
  }
  return bridgeToken.value
}

const gameCode = computed(
  () => (route.meta.assetGame as string) || (route.params.gameCode as string) || '',
)
const iframeSrc = computed(() => {
  const base = ASSET_GAMES[gameCode.value]
  if (!base) return ''
  /* bt 写入 URL，便于 ready/无 source 时校验 token，再由 init 下发 */
  const parts = [`bt=${encodeURIComponent(ensureBridgeToken())}`]
  const room = roomStore.roomNo
  if (room) parts.push(`roomNo=${encodeURIComponent(room)}`)
  const sep = base.includes('?') ? '&' : '?'
  return `${base}${sep}${parts.join('&')}`
})
const gameTitle = computed(() => {
  const titles: Record<string, string> = {
    bjsc: '北京赛车',
    ssc: '快乐时时彩',
    ffc: '1分时时彩',
    'speed-racing': '极速赛车',
    'speed-boat': '幸运飞艇',
    kuai3: '1分快三',
    lhc: '幸运六合彩',
    zhajinhua: '炸金花',
    douniu: '斗牛',
    baccarat: '百家乐',
    longhu: '龙虎斗',
  }
  return titles[gameCode.value] || '游戏'
})

function postToFrame(payload: Record<string, unknown>) {
  const win = frameEl.value?.contentWindow
  if (!win) return
  win.postMessage(payload, '*')
}

function syncLegacyUserOnly() {
  const profile = userStore.profile
  if (!profile) return
  localStorage.setItem(
    'gamebox_user',
    JSON.stringify({
      uid: profile.uid,
      name: profile.nickname || profile.username,
      avatar: profile.avatar || AVATAR_FALLBACK,
    }),
  )
  try {
    localStorage.removeItem(`gamebox_balance_${profile.uid}`)
    localStorage.removeItem('gamebox_balance_100000001')
  } catch {
    /* ignore */
  }
}

function pushInit() {
  const profile = userStore.profile
  postToFrame({
    type: 'assets-game-init',
    bridgeToken: ensureBridgeToken(),
    balance: walletStore.balance,
    gameCode: gameCode.value,
    serverGameCode: SERVER_GAME_CODE[gameCode.value] || gameCode.value,
    roomNo: roomStore.roomNo || '',
    user: profile
      ? {
          uid: profile.uid,
          name: profile.nickname || profile.username,
          avatar: profile.avatar || AVATAR_FALLBACK,
        }
      : null,
  })
}

function onFrameLoad() {
  frameWindow = frameEl.value?.contentWindow ?? null
  pushInit()
}

async function handleLotteryBet(
  requestId: string,
  code: string,
  bets: Array<{ betType: string; betValue?: string; amount: number }>,
  extra?: { roomNo?: string; chatText?: string },
) {
  try {
    const clientRequestId =
      requestId && requestId.length >= 8
        ? requestId
        : typeof crypto !== 'undefined' && 'randomUUID' in crypto
          ? `lot_${crypto.randomUUID()}`
          : `lot_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`
    const res = await lotteryApi.betBatch(code, bets, {
      clientRequestId,
      roomNo: extra?.roomNo || roomStore.roomNo || undefined,
      chatText: extra?.chatText,
    })
    await walletStore.fetchBalance()
    postToFrame({
      type: 'assets-game-bet-ok',
      requestId,
      balance: walletStore.balance,
      kind: 'lottery',
      issueNo: res.issueNo,
      count: res.count,
      totalAmount: res.totalAmount,
      chatPosted: res.chatPosted !== false,
    })
  } catch (e) {
    postToFrame({
      type: 'assets-game-bet-err',
      requestId,
      message: e instanceof Error ? e.message : '下注失败',
    })
  }
}

async function handleRoomChat(
  requestId: string,
  code: string,
  afterId: string,
  limit: number,
  roomNoFromGame?: string,
) {
  const roomNo = String(roomNoFromGame || roomStore.roomNo || '').trim()
  if (!roomNo) {
    postToFrame({
      type: 'assets-game-room-chat-err',
      requestId,
      message: '请先选房间',
    })
    return
  }
  try {
    const list = await roomsApi.chat(roomNo, code, {
      after: afterId || undefined,
      limit: limit || 50,
    })
    postToFrame({
      type: 'assets-game-room-chat-ok',
      requestId,
      list,
      roomNo,
    })
  } catch (e) {
    postToFrame({
      type: 'assets-game-room-chat-err',
      requestId,
      message: e instanceof Error ? e.message : '拉取聊天失败',
    })
  }
}

async function handleLotterySnapshot(requestId: string, code: string) {
  try {
    const [current, history] = await Promise.all([
      lotteryApi.currentIssue(code),
      lotteryApi.history(code, 20),
    ])
    postToFrame({
      type: 'assets-game-lottery-snapshot-ok',
      requestId,
      current,
      history,
    })
  } catch (e) {
    postToFrame({
      type: 'assets-game-lottery-snapshot-err',
      requestId,
      message: e instanceof Error ? e.message : '拉取快照失败',
    })
  }
}

async function handleLotteryPayTable(requestId: string, code: string) {
  try {
    const res = await lotteryApi.payTable(code)
    postToFrame({
      type: 'assets-game-lottery-paytable-ok',
      requestId,
      gameCode: res.gameCode,
      payTable: res.payTable,
    })
  } catch (e) {
    postToFrame({
      type: 'assets-game-lottery-paytable-err',
      requestId,
      message: e instanceof Error ? e.message : '拉取赔率失败',
    })
  }
}

async function handleLotteryMyBets(
  requestId: string,
  code: string,
  issueNo: string,
) {
  const wantIssue = String(issueNo || '').trim()
  // 无期号时无法过滤本局注单，直接报错避免返回错期数据
  if (!wantIssue) {
    postToFrame({
      type: 'assets-game-lottery-mybets-err',
      requestId,
      message: '缺少期号，无法查询本局注单',
    })
    return
  }
  try {
    const res = await lotteryApi.myBets(code, 1, 100, wantIssue)
    const list = (res.list || []).filter((b) => {
      if (!b || b.status === 'CANCELLED') return false
      const no = b.issue?.issueNo != null ? String(b.issue.issueNo) : ''
      return no === wantIssue
    })
    postToFrame({
      type: 'assets-game-lottery-mybets-ok',
      requestId,
      list,
      total: list.length,
      issueNo: wantIssue,
    })
  } catch (e) {
    postToFrame({
      type: 'assets-game-lottery-mybets-err',
      requestId,
      message: e instanceof Error ? e.message : '查询失败',
    })
  }
}

async function handleLotteryCancel(requestId: string, code: string) {
  try {
    const res = await lotteryApi.cancel(code)
    await walletStore.fetchBalance()
    postToFrame({
      type: 'assets-game-cancel-ok',
      requestId,
      balance: walletStore.balance,
      issueNo: res.issueNo,
      count: res.count,
      refunded: res.refunded,
    })
  } catch (e) {
    postToFrame({
      type: 'assets-game-cancel-err',
      requestId,
      message: e instanceof Error ? e.message : '撤单失败',
    })
  }
}

async function handleTableBet(
  requestId: string,
  code: string,
  side: string,
  amount: number,
  clientKey = '',
) {
  try {
    const serverCode = SERVER_GAME_CODE[code] || code
    const body: { side: string; amount: number; clientKey?: string } = { side, amount }
    if (clientKey) body.clientKey = clientKey
    const res = await http.post<
      {
        balance: number
        roundNo: string
        side: string
        amount: number
        phase: string
        secondsLeft: number
      },
      {
        balance: number
        roundNo: string
        side: string
        amount: number
        phase: string
        secondsLeft: number
      }
    >(`/table/${encodeURIComponent(serverCode)}/bet`, body)
    walletStore.balance = Math.round((Number(res.balance) || 0) * 100) / 100
    postToFrame({
      type: 'assets-game-bet-ok',
      requestId,
      balance: res.balance,
      kind: 'table',
      roundNo: res.roundNo,
      phase: res.phase,
      secondsLeft: res.secondsLeft,
      /* 牌桌注单待结算，勿提前当 won/payout */
      pending: true,
    })
  } catch (e) {
    postToFrame({
      type: 'assets-game-bet-err',
      requestId,
      message: e instanceof Error ? e.message : '下注失败',
    })
  }
}

async function handleTableSnapshot(requestId: string, code: string) {
  try {
    const serverCode = SERVER_GAME_CODE[code] || code
    const snap = await http.get<Record<string, unknown>>(
      `/table/${encodeURIComponent(serverCode)}/snapshot`,
    )
    postToFrame({
      type: 'assets-game-table-snapshot-ok',
      requestId,
      snapshot: snap,
    })
  } catch (e) {
    postToFrame({
      type: 'assets-game-table-snapshot-err',
      requestId,
      message: e instanceof Error ? e.message : '拉取牌桌快照失败',
    })
  }
}

async function handleTableMyBets(requestId: string, code: string, roundNo: string) {
  try {
    const serverCode = SERVER_GAME_CODE[code] || code
    const q = roundNo ? `?roundNo=${encodeURIComponent(roundNo)}` : ''
    const result = await http.get<Record<string, unknown>>(
      `/table/${encodeURIComponent(serverCode)}/my-bets${q}`,
    )
    postToFrame({
      type: 'assets-game-table-my-bets-ok',
      requestId,
      result,
    })
  } catch (e) {
    postToFrame({
      type: 'assets-game-table-my-bets-err',
      requestId,
      message: e instanceof Error ? e.message : '查询失败',
    })
  }
}

async function handleTablePayTable(requestId: string, code: string) {
  try {
    const serverCode = SERVER_GAME_CODE[code] || code
    const payTable = await http.get<Record<string, unknown>>(
      `/table/${encodeURIComponent(serverCode)}/pay-table`,
    )
    postToFrame({
      type: 'assets-game-table-paytable-ok',
      requestId,
      payTable,
    })
  } catch (e) {
    postToFrame({
      type: 'assets-game-table-paytable-err',
      requestId,
      message: e instanceof Error ? e.message : '拉取赔率失败',
    })
  }
}

async function handleTableVerify(requestId: string, code: string, roundNo: string) {
  try {
    const serverCode = SERVER_GAME_CODE[code] || code
    const q = roundNo ? `?roundNo=${encodeURIComponent(roundNo)}` : ''
    const result = await http.get<Record<string, unknown>>(
      `/table/${encodeURIComponent(serverCode)}/verify${q}`,
    )
    postToFrame({
      type: 'assets-game-table-verify-ok',
      requestId,
      result,
    })
  } catch (e) {
    postToFrame({
      type: 'assets-game-table-verify-err',
      requestId,
      message: e instanceof Error ? e.message : '校验失败',
    })
  }
}

async function handleTopup(requestId: string, amount: number, channel: string) {
  try {
    const order = await rechargeApi.apply(amount, channel)
    postToFrame({
      type: 'assets-game-topup-ok',
      requestId,
      order,
      balance: walletStore.balance,
    })
  } catch (e) {
    postToFrame({
      type: 'assets-game-topup-err',
      requestId,
      message: e instanceof Error ? e.message : '上分申请失败',
    })
  }
}

async function handleWithdraw(requestId: string, amount: number) {
  try {
    const order = await rechargeApi.withdraw(amount)
    await walletStore.fetchBalance()
    postToFrame({
      type: 'assets-game-withdraw-ok',
      requestId,
      order,
      balance: walletStore.balance,
    })
  } catch (e) {
    postToFrame({
      type: 'assets-game-withdraw-err',
      requestId,
      message: e instanceof Error ? e.message : '下分失败',
    })
  }
}

function navigateFromGame(rawPath: string) {
  const qIdx = rawPath.indexOf('?')
  const pathname = (qIdx >= 0 ? rawPath.slice(0, qIdx) : rawPath).trim() || '/lobby'
  const qs = qIdx >= 0 ? rawPath.slice(qIdx + 1) : ''
  const params = new URLSearchParams(qs)
  const isLobby = pathname === '/lobby' || pathname === 'lobby'
  const isSettings = pathname === '/settings' || pathname === 'settings'

  if (isLobby) {
    router.replace({ name: 'lobby' })
    return
  }
  if (isSettings) {
    router.replace({ name: 'settings' })
    return
  }

  params.set('from', 'game')
  /* /bets 由页面自行处理 game=，其它页自动带上当前游戏 */
  if (gameCode.value && !params.has('game') && pathname !== '/bets') {
    params.set('game', gameCode.value)
  }
  const next = `${pathname.startsWith('/') ? pathname : `/${pathname}`}?${params.toString()}`
  router.push(next)
}

function isFromGameFrame(ev: MessageEvent) {
  const win = frameWindow || frameEl.value?.contentWindow
  if (!win) return false
  try {
    return ev.source === win
  } catch {
    return false
  }
}

/** source 对不上时，用 bridgeToken（init 后）识别 iframe */
function acceptGameMessage(ev: MessageEvent, data: Record<string, unknown>): boolean {
  if (isFromGameFrame(ev)) return true
  const token = String(data.bridgeToken || '')
  return !!bridgeToken.value && token === bridgeToken.value
}

async function onGameMessage(ev: MessageEvent) {
  const data = ev.data
  if (!data || typeof data !== 'object') return

  /* ready：同源校验 token，或 iframe source 匹配时在 @load 前也可 pushInit */
  if (data.type === 'assets-game-ready') {
    if (isFromGameFrame(ev) || String((data as { bridgeToken?: string }).bridgeToken || '') === bridgeToken.value) {
      pushInit()
    }
    return
  }

  const accepted = acceptGameMessage(ev, data as Record<string, unknown>)

  /* 返回大厅：即使 iframe source 对不上（部分 WebView），有 frame 也放行 */
  if (data.type === 'assets-game-nav' && typeof data.path === 'string') {
    const raw = String(data.path)
    const pathname = (raw.split('?')[0] || '').trim()
    const isLobby = pathname === '/lobby' || pathname === 'lobby'
    if (accepted || (isLobby && !!frameEl.value)) {
      navigateFromGame(raw)
    }
    return
  }

  if (!accepted) return

  if (data.type === 'assets-game-get-balance') {
    try {
      await walletStore.fetchBalance()
    } catch {
      /* keep cache */
    }
    postToFrame({
      type: 'assets-game-balance',
      requestId: data.requestId,
      balance: walletStore.balance,
    })
    return
  }

  if (data.type === 'assets-game-lottery-snapshot') {
    await handleLotterySnapshot(
      String(data.requestId || ''),
      String(data.gameCode || gameCode.value),
    )
    return
  }

  if (data.type === 'assets-game-lottery-paytable') {
    await handleLotteryPayTable(
      String(data.requestId || ''),
      String(data.gameCode || gameCode.value),
    )
    return
  }

  if (data.type === 'assets-game-lottery-mybets') {
    await handleLotteryMyBets(
      String(data.requestId || ''),
      String(data.gameCode || gameCode.value),
      String(data.issueNo || ''),
    )
    return
  }

  if (data.type === 'assets-game-cancel') {
    await handleLotteryCancel(
      String(data.requestId || ''),
      String(data.gameCode || gameCode.value),
    )
    return
  }

  if (data.type === 'assets-game-topup') {
    await handleTopup(
      String(data.requestId || ''),
      Math.floor(Number(data.amount) || 0),
      String(data.channel || 'default'),
    )
    return
  }

  if (data.type === 'assets-game-withdraw') {
    await handleWithdraw(
      String(data.requestId || ''),
      Math.floor(Number(data.amount) || 0),
    )
    return
  }

  if (data.type === 'assets-game-room-chat') {
    await handleRoomChat(
      String(data.requestId || ''),
      String(data.gameCode || gameCode.value),
      String(data.afterId || ''),
      Math.floor(Number(data.limit) || 50),
      String(data.roomNo || roomStore.roomNo || ''),
    )
    return
  }

  if (data.type === 'assets-game-table-snapshot') {
    await handleTableSnapshot(
      String(data.requestId || ''),
      String(data.gameCode || gameCode.value),
    )
    return
  }

  if (data.type === 'assets-game-table-my-bets') {
    await handleTableMyBets(
      String(data.requestId || ''),
      String(data.gameCode || gameCode.value),
      String(data.roundNo || ''),
    )
    return
  }

  if (data.type === 'assets-game-table-paytable') {
    await handleTablePayTable(
      String(data.requestId || ''),
      String(data.gameCode || gameCode.value),
    )
    return
  }

  if (data.type === 'assets-game-table-verify') {
    await handleTableVerify(
      String(data.requestId || ''),
      String(data.gameCode || gameCode.value),
      String(data.roundNo || ''),
    )
    return
  }

  if (data.type === 'assets-game-bet') {
    const requestId = String(data.requestId || '')
    if (data.kind === 'lottery') {
      const bets = Array.isArray(data.bets) ? data.bets : []
      const code = String(data.gameCode || gameCode.value)
      await handleLotteryBet(requestId, code, bets, {
        roomNo: String(data.roomNo || roomStore.roomNo || ''),
        chatText: String(data.chatText || ''),
      })
      return
    }
    if (data.kind === 'table') {
      await handleTableBet(
        requestId,
        String(data.gameCode || gameCode.value),
        String(data.side || ''),
        Number(data.amount) || 0,
        String(data.clientKey || ''),
      )
      return
    }
    postToFrame({
      type: 'assets-game-bet-err',
      requestId,
      message: '未知下注类型',
    })
  }
}

onMounted(async () => {
  if (!ASSET_GAMES[gameCode.value]) {
    router.replace('/lobby')
    return
  }
  const serverCode = SERVER_GAME_CODE[gameCode.value] || gameCode.value
  try {
    const list = await gamesApi.list()
    const entry = list.find((g) => g.code === serverCode)
    if (!entry || entry.status !== 'ONLINE') {
      toast(entry?.status === 'MAINTENANCE' ? '该游戏维护中，暂不可进入' : '该游戏已下架')
      router.replace('/lobby')
      return
    }
  } catch {
    toast('无法确认游戏状态，请稍后重试')
    router.replace('/lobby')
    return
  }
  try {
    await walletStore.fetchBalance()
  } catch {
    /* 余额拉取失败仍进 iframe，由 H5 再试 */
  }
  syncLegacyUserOnly()
  frameReady.value = true
  window.addEventListener('message', onGameMessage)
})

onUnmounted(() => {
  window.removeEventListener('message', onGameMessage)
  frameWindow = null
  bridgeToken.value = ''
  void walletStore.fetchBalance()
})
</script>

<style scoped>
.assets-game-shell {
  position: fixed;
  inset: 0;
  z-index: 200;
  width: 100%;
  height: 100%;
  background: #0d0a08;
}
.assets-game-frame {
  width: 100%;
  height: 100%;
  border: none;
  display: block;
}
.assets-game-loading {
  color: rgba(255, 255, 255, 0.55);
  font-size: 14px;
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100%;
}
</style>
