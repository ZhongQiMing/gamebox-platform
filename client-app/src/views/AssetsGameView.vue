<template>
  <div class="assets-game-shell">
    <iframe
      v-if="frameReady"
      ref="frameEl"
      class="assets-game-frame"
      :src="iframeSrc"
      :title="gameTitle"
      allow="autoplay"
      sandbox="allow-scripts allow-same-origin"
      referrerpolicy="no-referrer"
      @load="onFrameLoad"
    />
    <div v-else class="assets-game-loading">加载中…首次进入可能需下载素材</div>
  </div>
</template>

<script setup lang="ts">
/**
 * 静态 H5 游戏壳：通过 postMessage 与 iframe 桥接。
 * iframe 内下注 / 查余额 / 上下分 / 聊天等走父页 JWT 调 /api，再回传给 H5。
 */
import { computed, onActivated, onDeactivated, onMounted, onUnmounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useUserStore } from '@/stores/user'
import { useWalletStore } from '@/stores/wallet'
import { useRoomStore } from '@/stores/room'
import { gamesApi } from '@/api/games'
import { lotteryApi } from '@/api/lottery'
import { roomsApi } from '@/api/rooms'
import { rechargeApi } from '@/api/recharge'
import http from '@/api/http'
import { newFundOrderNo } from '@/utils/fundOrderNo'
import { useToast } from '@/composables/useToast'
import {
  gameAssetUrl,
  gameOrigin,
  isTrustedGameMessage,
} from '@/utils/gameOrigin'
import { frameActivityMessage } from '@/utils/frameActivity'

const ASSET_GAMES: Record<string, string> = {
  bjsc: '/games-assets/bjsc/index.html?v=175',
  ssc: '/games-assets/ssc/index.html?v=195',
  ffc: '/games-assets/ffc/index.html?v=183',
  'speed-racing': '/games-assets/speed-racing/index.html?v=242',
  'speed-boat': '/games-assets/speed-boat/index.html?v=167',
  kuai3: '/games-assets/kuai3/index.html?v=167',
  lhc: '/games-assets/lhc/index.html?v=200',
  zhajinhua: '/games-assets/zhajinhua/index.html?v=362',
  douniu: '/games-assets/douniu/index.html?v=171',
  baccarat: '/games-assets/baccarat/index.html?v=62',
  longhu: '/games-assets/longhu/index.html?v=60',
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
/** 业务消息的二次关联值；安全边界始终是严格的 origin + contentWindow。 */
const bridgeToken = ref('')
let frameWindow: Window | null = null
/** keep-alive 壳层是否仍是当前页面；不能依赖 iframe 自己的 document.hidden。 */
let shellActive = true

function ensureBridgeToken() {
  if (!bridgeToken.value) {
    bridgeToken.value =
      typeof crypto !== 'undefined' && 'randomUUID' in crypto
        ? `bt_${crypto.randomUUID()}`
        : `bt_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`
  }
  return bridgeToken.value
}

const gameCode = computed(
  () => (route.meta.assetGame as string) || (route.params.gameCode as string) || '',
)
const iframeSrc = computed(() => {
  const base = ASSET_GAMES[gameCode.value]
  if (!base) return ''
  const url = new URL(gameAssetUrl(base))
  /* 父页 Origin 仅用于游戏把消息定向发回；授权仍由父页校验 event.source + origin。 */
  url.searchParams.set('parentOrigin', location.origin)
  const room = roomStore.roomNo
  if (room) url.searchParams.set('roomNo', room)
  return url.toString()
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
  win.postMessage(payload, gameOrigin)
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

function syncFrameActivity() {
  postToFrame(frameActivityMessage(shellActive))
}

function onFrameLoad() {
  frameWindow = frameEl.value?.contentWindow ?? null
  pushInit()
  syncFrameActivity()
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
      roomNo: extra?.roomNo || roomStore.roomNo || '',
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
    const { current, history } = await lotteryApi.snapshot(code, 20)
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
  roomNoFromGame = '',
) {
  try {
    const serverCode = SERVER_GAME_CODE[code] || code
    const roomNo = String(roomNoFromGame || roomStore.roomNo || '').trim()
    if (!/^\d{6}$/.test(roomNo)) {
      postToFrame({
        type: 'assets-game-bet-err',
        requestId,
        message: '请先进入运营房间后再下注',
      })
      return
    }
    const body: { side: string; amount: number; clientKey?: string; roomNo: string } = {
      side,
      amount,
      roomNo,
    }
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
    const order = await rechargeApi.apply(
      amount,
      channel,
      roomStore.roomNo || undefined,
      newFundOrderNo('up'),
    )
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
    const order = await rechargeApi.withdraw(
      amount,
      roomStore.roomNo || undefined,
      newFundOrderNo('down'),
    )
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
  return isTrustedGameMessage(ev, win ?? null)
}

async function onGameMessage(ev: MessageEvent) {
  const data = ev.data
  if (!data || typeof data !== 'object') return
  if (!isFromGameFrame(ev)) return

  /* ready 也必须同时命中独立游戏 Origin 与当前 iframe Window。 */
  if (data.type === 'assets-game-ready') {
    pushInit()
    syncFrameActivity()
    return
  }
  /* pause 是协作通知，父壳仍须硬性拒绝离页后迟到的轮询与资金指令。 */
  if (!shellActive) return

  if (data.type === 'assets-game-nav' && typeof data.path === 'string') {
    navigateFromGame(String(data.path))
    return
  }

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
        String(data.roomNo || ''),
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
  /* 先挂 iframe，避免刷新开奖中先卡「加载中」；状态校验并行 */
  syncLegacyUserOnly()
  frameReady.value = true
  window.addEventListener('message', onGameMessage)

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
})

/*
 * 本页被 keep-alive 缓存：退回大厅时组件不卸载，iframe 继续跑。
 *
 * iframe 里的 document.hidden 在「浏览器仍在前台、只是 Vue 切走了这一页」时是 false，
 * 游戏自己察觉不到已经离开，牌桌 1s、彩票 2s 的轮询会一直打下去；玩过几个游戏就是
 * 几份幽灵轮询叠加。桥接两端早就约定了 pause/resume，这里补上发送方。
 */
onActivated(() => {
  shellActive = true
  syncFrameActivity()
})

onDeactivated(() => {
  shellActive = false
  syncFrameActivity()
})

onUnmounted(() => {
  shellActive = false
  syncFrameActivity()
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
