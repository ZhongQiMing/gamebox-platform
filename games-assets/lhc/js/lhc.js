/**
 * 游戏类型: lhc
 *
 * 幸运六合彩 · 聊天投注房
 */
$(function () {
  const GAME_TYPE = 'lhc';

  /** 与服务端一致：75 秒一局，封盘前 35 秒盖住摇珠+七球报号。 */
  const INTERVAL = 75;
  const PREP_SEC = 35;
  const BET_SEC = INTERVAL - PREP_SEC;

  /*
   * 服务端校准时钟。
   * 凡是要跟 lockAt / openAt 这类服务端绝对时间戳比较的地方都走 srvNow()，
   * 否则玩家设备时钟偏几秒，倒计时和下注闸门就跟着偏几秒。
   * 公共层没加载时退化成本地钟，行为与改造前一致，不会把游戏卡死。
   */
  function srvNow() {
    return window.LotteryClock ? LotteryClock.now() : Date.now();
  }
  /** 服务端时刻 → 本地时刻，供 setTimeout 排程 */
  function toLocalMs(serverMs) {
    return window.LotteryClock ? LotteryClock.toLocal(serverMs) : Number(serverMs);
  }
  /** 客户端停止接单的时刻：比服务端封盘线提前一点，避免最后一刻下注被服务端打回 */
  function betCutoffAt(lockAtMs) {
    return window.LotteryClock ? LotteryClock.cutoffAt(lockAtMs) : Number(lockAtMs);
  }

  function fixAvatar(url) {
    const fallback = '/images/avatars/001.jpg';
    if (!url) return fallback;
    if (url.startsWith('http://') || url.startsWith('https://')) return url;
    // 旧路径兼容
    if (url.startsWith('/legacy/images/avatars/')) {
      return '/images/avatars/' + url.slice('/legacy/images/avatars/'.length);
    }
    if (url.startsWith('../../client-app/assets/images/avatars/')) {
      return '/images/avatars/' + url.slice('../../client-app/assets/images/avatars/'.length);
    }
    if (url.startsWith('../../client-app/assets/')) {
      return '/legacy/' + url.slice('../../client-app/assets/'.length);
    }
    if (url.startsWith('../../assets/images/avatars/')) {
      return '/images/avatars/' + url.slice('../../assets/images/avatars/'.length);
    }
    if (url.startsWith('../../assets/')) {
      return '/legacy/' + url.slice('../../assets/'.length);
    }
    if (url.startsWith('../assets/')) {
      return '/legacy/' + url.slice('../assets/'.length);
    }
    return url;
  }
  const ROBOT = { name: '开奖员', avatar: '/images/avatars/001.jpg' };
  const params = new URLSearchParams(location.search);
  const roomNo = (params.get('roomNo') || '').trim();
  let user = App.getUser();
  // 父页 assets-game-init 会更新用户；保持引用同步
  const _setUser = App.setUser;
  App.setUser = function (u) {
    _setUser(u);
    user = App.getUser();
  };
  const q = roomNo ? '?roomNo=' + encodeURIComponent(roomNo) : '';
  const SERVER_GAME = 'lhc';

  function mulOf(pt, key, fb) {
    const row = pt && pt[key];
    return row && typeof row.multiplier === 'number' ? row.multiplier : fb;
  }
  function loadServerPayTable() {
    if (!App.fetchLotteryPayTable) return;
    App.fetchLotteryPayTable(SERVER_GAME).then(function (pt) {
      App._lotteryPayTable = pt || {};
      if (typeof applyServerPayTable === 'function') applyServerPayTable(App._lotteryPayTable);
    }).catch(function () { /* keep local fallback */ });
  }
  function serverBetProfit(b) {
    const amount = Number(b.amount) || 0;
    const payout = Number(b.payout) || 0;
    if (b.status === 'CANCELLED' || b.status === 'PENDING') return 0;
    return payout - amount;
  }
  function refreshAfterServerSettle() {
    if (App.refreshBalance) {
      App.refreshBalance().then(function () { if (typeof refreshStats === 'function') refreshStats(); });
    } else if (typeof refreshStats === 'function') {
      refreshStats();
    }
  }

  let historyRows = [];
  let lastDraw = [];
  let serverCurrent = null;
  let serverSynced = false;
  let snapshotBusy = false;
  /** 开奖点后催快照节流 */
  let openAtResyncAt = 0;
  function updateCountdownDrawing() {
    const $box = $('#countdownBox').removeClass('is-preparing is-betting is-freeze is-urgent').addClass('is-drawing');
    const $label = $('#cdLabel');
    if ($label.length) $label.text('开奖中');
    $box.attr('aria-label', '开奖中');
    /* 开奖中只留三字；class + hide，避免 display:flex 盖掉 [hidden] */
    $('#cdDigits').attr('hidden', true).hide();
    $('#cdPrep').attr('hidden', true).hide();
  }
  function requestLotteryResync() {
    const now = Date.now();
    if (openAtResyncAt && now - openAtResyncAt < 800) return;
    openAtResyncAt = now;
    snapshotBusy = false;
    if (typeof App.resyncLottery === 'function') App.resyncLottery();
    else if (typeof syncServerSnapshot === 'function') syncServerSnapshot();
  }
  const REVEALED_STORAGE_KEY = 'lhc_revealed_v1';
  const PLAYED_ANIM_STORAGE_KEY = 'lhc_played_anim_v1';
  const CLOSED_STORAGE_KEY = 'lhc_closed_v1';
  let revealedIssues = new Set();
  let playedAnimIssues = new Set();
  /** 进房后首次拉到历史头：只对齐顶栏，不往聊天推「进房前已开奖」 */
  let historyHeadBootstrapped = false;
  let lastBetText = '';
  let composerAllin = false;
  /** 上一笔成功投注的全部注单行（玩法面板「重复」用） */
  let lastBetLines = [];
  let drawPanelOpen = false;
  let closedIssues = new Set();
  /** 封盘后冻结下注，开奖核对展示完再解冻（避免下一期过早冒注） */
  let roomBetFrozen = false;
  let sealedIssueNo = '';
  /** 当期注单：issue -> { 玩家名: [{ play, amount }] } */
  const issueBetBook = {};

  function nextOpenAtMs(now) {
    const intervalMs = INTERVAL * 1000;
    /* 服务端的开奖网格对齐 Unix 纪元，推算必须站在服务端时间轴上 */
    const t = now != null ? now : srvNow();
    return Math.ceil(t / intervalMs) * intervalMs;
  }
  function fmtIssueFromOpenAt(openAtMs) {
    const intervalMs = INTERVAL * 1000;
    const p = shanghaiYmdParts(new Date(openAtMs));
    const dayStart = Date.parse(p.y + '-' + p.m + '-' + p.d + 'T00:00:00+08:00');
    const seq = Math.floor((openAtMs - dayStart) / intervalMs) + 1;
    return '' + p.m + p.d + pad(Math.max(1, seq), 6);
  }
  function getRoundRemain() {
    const openAt = nextOpenAtMs();
    let r = (openAt - srvNow()) / 1000;
    if (r <= 0) r = INTERVAL;
    return r;
  }
  function getCurrentIssue() {
    if (serverSynced && serverCurrent && serverCurrent.issueNo) return String(serverCurrent.issueNo);
    return fmtIssueFromOpenAt(nextOpenAtMs());
  }
  function isBettingOpen() {
    if (!serverSynced || !serverCurrent) return false;
    /* 提前于服务端封盘线收口：请求还要飞过网络，卡着线点下去必被服务端拒 */
    const open = serverCurrent.status === 'PENDING'
      && srvNow() < betCutoffAt(new Date(serverCurrent.lockAt).getTime());
    if (!open) return false;
    /* 开奖仪式未回到 betting：禁止下注 */
    if (roomChat && typeof roomChat.isBettingOpen === 'function' && !roomChat.isBettingOpen()) return false;
    /* 仅冻结「仍是封盘那一期」；已换新期以服务端 lockAt 为准 */
    if (roomBetFrozen && sealedIssueNo && String(serverCurrent.issueNo) === String(sealedIssueNo)) return false;
    return true;
  }
  function toastBetBlocked(kind) {
    if (!serverSynced) {
      App.toast('房间同步中，请稍候');
      return;
    }
    App.toast(kind === 'cancel' ? '当前期无可取消注单' : '封盘中，无法下注');
  }
  function parseBet(text) {
    const t = String(text || '').trim();
    if (!t) return null;
    // 优先：末段空格分隔金额（兼容「复式二全中 01,08 100」）
    const parts = t.split(/\s+/);
    if (parts.length >= 2 && /^\d+$/.test(parts[parts.length - 1])) {
      const amount = parseInt(parts[parts.length - 1], 10);
      const play = parts.slice(0, -1).join(' ').replace(/[\/／]\s*$/, '');
      if (amount > 0 && play && parsePlay(play)) return { play, amount };
    }
    // 兼容：特码大100 / 特码08/100
    const m = t.match(/^(.*?)[\/／\s]*(\d+)$/);
    if (!m) return null;
    const amount = parseInt(m[2], 10);
    const play = m[1].trim().replace(/[\/／]\s*$/, '');
    if (!amount || !play) return null;
    if (!parsePlay(play)) return null;
    return { play, amount };
  }
  /** 写入本期竞猜簿（口语下注先展开，与真实玩家同一套解析） */
  function recordBet(name, text, opts) {
    const force = !!(opts && opts.force);
    if (!force && !isBettingOpen()) return false;
    const issue = (opts && opts.issue) || getCurrentIssue();
    if (!issue) return false;
    let lines = null;
    try {
      if (typeof expandChatBetInput === 'function') lines = expandChatBetInput(text);
    } catch (e) { lines = null; }
    if (!lines || !lines.length) {
      const one = parseBet(text);
      if (!one) return false;
      lines = [one];
    }
    if (!issueBetBook[issue]) issueBetBook[issue] = {};
    if (!issueBetBook[issue][name]) issueBetBook[issue][name] = [];
    const mock = !!(opts && opts.mock);
    lines.forEach((b) => {
      if (b && b.play && b.amount > 0) {
        const row = { play: b.play, amount: b.amount };
        if (mock) row.mock = true;
        issueBetBook[issue][name].push(row);
        if (!mock && name === user.name) appendUserBetLog(issue, b.play, b.amount);
      }
    });
    saveBetBook();
    return issueBetBook[issue][name].length > 0;
  }
  function betBookStorageKey() {
    const uid = (user && user.uid) ? user.uid : 'guest';
    return 'lhc_betbook_v1_' + uid + (roomNo ? '_' + roomNo : '');
  }
  function saveBetBook() {
    try {
      const keys = Object.keys(issueBetBook);
      // 只留最近几期，避免撑爆
      const keep = keys.slice(-8);
      const slim = {};
      keep.forEach((k) => { slim[k] = issueBetBook[k]; });
      // 清掉过旧键
      keys.forEach((k) => {
        if (!slim[k]) delete issueBetBook[k];
      });
      localStorage.setItem(betBookStorageKey(), JSON.stringify(slim));
    } catch (e) { /* ignore */ }
  }
  function restoreBetBook() {
    try {
      const raw = JSON.parse(localStorage.getItem(betBookStorageKey()) || '{}');
      if (raw && typeof raw === 'object') {
        Object.keys(raw).forEach((k) => { issueBetBook[k] = raw[k]; });
      }
    } catch (e) { /* ignore */ }
  }

  /* ================= 注单持久化（供竞猜记录页 lhc_bet_log_） ================= */
  function betLogKey() {
    return 'lhc_bet_log_' + ((user && user.uid) ? user.uid : 'guest');
  }
  function loadUserBetLog() {
    try {
      const raw = localStorage.getItem(betLogKey());
      return raw ? JSON.parse(raw) : [];
    } catch (e) {
      return [];
    }
  }
  function saveUserBetLog(list) {
    localStorage.setItem(betLogKey(), JSON.stringify(list.slice(0, 120)));
    try {
      window.dispatchEvent(new CustomEvent('lhc-bet-log-updated'));
    } catch (e) { /* ignore */ }
  }
  function appendUserBetLog(issue, play, amount) {
    const log = loadUserBetLog();
    let group = log.find(function (g) { return g.issue === issue; });
    if (!group) {
      group = {
        game: 'lhc',
        issue: issue,
        createdAt: new Date().toISOString(),
        settled: false,
        bets: [],
        totalAmount: 0,
        totalProfit: 0,
      };
      log.unshift(group);
    }
    group.bets.push({
      play: play,
      amount: amount,
      status: 'PENDING',
      profit: 0,
      winAmount: 0,
      hit: '',
    });
    group.totalAmount += amount;
    saveUserBetLog(log);
  }
  function clearUserPendingBetLog(issue) {
    const log = loadUserBetLog();
    const group = log.find(function (g) { return g.issue === issue; });
    if (!group || group.settled) return;
    group.bets = [];
    group.totalAmount = 0;
    group.totalProfit = 0;
    group.cancelled = true;
    saveUserBetLog(log);
  }
  function settleUserBetLog(issue, nums, rows) {
    const log = loadUserBetLog();
    const group = log.find(function (g) { return g.issue === issue; });
    if (!group || !group.bets.length) return;
    group.settled = true;
    group.settledAt = new Date().toISOString();
    group.drawNums = (nums || []).slice();
    group.drawSummary = (typeof gyMeta === 'function' && nums && nums.length)
      ? String(gyMeta(nums).text || '')
      : '';
    group.totalProfit = 0;
    const rowQueue = rows && rows.length ? rows.slice() : [];
    group.bets = group.bets.map(function (b, i) {
      let r = rowQueue[i];
      if (!r || r.play !== b.play || r.amount !== b.amount) {
        r = settleBet(b.play, b.amount, nums || []);
      }
      const item = {
        play: b.play,
        amount: b.amount,
        status: r.hit === '和' ? 'TIE' : (r.winAmount > 0 ? 'WON' : 'LOST'),
        profit: r.profit,
        winAmount: r.winAmount,
        hit: r.hit || '',
      };
      group.totalProfit += item.profit;
      return item;
    });
    saveUserBetLog(log);
  }

  function fmtMoney2(n) {
    return (Math.round((Number(n) || 0) * 100) / 100).toFixed(2);
  }
  function fmtProfit(n) {
    const v = Math.round((Number(n) || 0) * 100) / 100;
    return (v >= 0 ? '+' : '') + v.toFixed(2);
  }
  function realBetBook(issue) {
    const book = issueBetBook[issue];
    if (!book) return null;
    const out = {};
    Object.keys(book).forEach(function (name) {
      const bets = (book[name] || []).filter(function (b) { return !b.mock; });
      if (bets.length) out[name] = bets;
    });
    return Object.keys(out).length ? out : null;
  }

  /** 房间展示用：含聊天假注，模拟全员竞猜 */
  function roomBetBook(issue) {
    const book = issueBetBook[issue];
    if (!book || !Object.keys(book).length) return null;
    return book;
  }

  function buildBetListVerifyText(issue) {
    const book = roomBetBook(issue);
    if (!book) {
      return issue + '期已封盘\n注单核对\n——————————\n暂无下注数据';
    }
    const blocks = Object.keys(book).map(function (name) {
      const bets = book[name] || [];
      const total = bets.reduce(function (s, b) { return s + (Number(b.amount) || 0); }, 0);
      const lines = bets.map(function (b) { return b.play + ' ' + b.amount; }).join('\n');
      return '（' + name + '）下注总金额：' + total + '\n' + lines;
    });
    return issue + '期已封盘\n注单核对\n——————————\n' + blocks.join('\n\n');
  }

  function applyServerPayTable(pt) {
    if (!pt) return;
    ODDS.tema = mulOf(pt, 'special', ODDS.tema);
    ODDS.temaB = ODDS.tema;
    ODDS.zhengma = mulOf(pt, 'zhengma', ODDS.zhengma);
    ODDS.zhengmaB = ODDS.zhengma;
    ODDS.zhengTe = mulOf(pt, 'zhengTe', ODDS.zhengTe);
    ODDS.side = mulOf(pt, 'big', ODDS.side);
    ODDS.heSide = mulOf(pt, 'heSide', ODDS.heSide != null ? ODDS.heSide : ODDS.side);
    ODDS.weiSide = mulOf(pt, 'weiSide', ODDS.weiSide != null ? ODDS.weiSide : ODDS.side);
    ODDS.weiXiao = mulOf(pt, 'weiSideSmall', ODDS.weiXiao);
    ODDS.comboSide = mulOf(pt, 'combo', ODDS.comboSide);
    ODDS.zhengSide = mulOf(pt, 'zhengSide', ODDS.zhengSide);
    ODDS.zhengCombo = mulOf(pt, 'zhengCombo', ODDS.zhengCombo);
    ODDS.zhengHe = mulOf(pt, 'zhengHe', ODDS.zhengHe);
    ODDS.zhengWei = mulOf(pt, 'zhengWei', ODDS.zhengWei);
    ODDS.zhengWeiSmall = mulOf(pt, 'zhengWeiSmall', ODDS.zhengWeiSmall);
    ODDS.colorRed = mulOf(pt, 'colorRed', ODDS.colorRed);
    ODDS.colorBlue = mulOf(pt, 'colorBlue', ODDS.colorBlue);
    ODDS.colorGreen = mulOf(pt, 'colorGreen', ODDS.colorGreen);
    Object.keys(ODDS.colorHalf).forEach(function (k) {
      ODDS.colorHalf[k] = mulOf(pt, 'colorHalf_' + k, ODDS.colorHalf[k]);
    });
    Object.keys(ODDS.colorHalfHalf).forEach(function (k) {
      ODDS.colorHalfHalf[k] = mulOf(pt, 'colorHalfHalf_' + k, ODDS.colorHalfHalf[k]);
    });
    ODDS.zodiac = mulOf(pt, 'zodiac', ODDS.zodiac);
    ODDS.zodiacYear = mulOf(pt, 'zodiacYear', ODDS.zodiacYear);
    ODDS.pingTe = mulOf(pt, 'pingTe', ODDS.pingTe);
    ODDS.pingTeYear = mulOf(pt, 'pingTeYear', ODDS.pingTeYear);
    ODDS.zhengXiao = mulOf(pt, 'zhengXiao', ODDS.zhengXiao);
    ODDS.zhengXiaoYear = mulOf(pt, 'zhengXiaoYear', ODDS.zhengXiaoYear);
    ODDS.weiShu0 = mulOf(pt, 'weiShu0', ODDS.weiShu0);
    ODDS.weiShu = mulOf(pt, 'weiShu', ODDS.weiShu);
    ODDS.weiShuMiss0 = mulOf(pt, 'weiShuMiss0', ODDS.weiShuMiss0);
    ODDS.weiShuMiss = mulOf(pt, 'weiShuMiss', ODDS.weiShuMiss);
    ODDS.sumSide = mulOf(pt, 'sumSide', ODDS.sumSide);
    ODDS.sumTail = mulOf(pt, 'sumTail', ODDS.sumTail);
    ODDS.liuxiao = mulOf(pt, 'liuxiao', ODDS.liuxiao);
    ODDS.erQuanZhong = mulOf(pt, 'erQuanZhong', ODDS.erQuanZhong);
    ODDS.erZhongTe = mulOf(pt, 'erZhongTe', ODDS.erZhongTe);
    ODDS.erZhongTeTe = mulOf(pt, 'erZhongTeTe', ODDS.erZhongTeTe);
    ODDS.teChuan = mulOf(pt, 'teChuan', ODDS.teChuan);
    ODDS.sanQuanZhong = mulOf(pt, 'sanQuanZhong', ODDS.sanQuanZhong);
    ODDS.sanZhongEr = mulOf(pt, 'sanZhongEr', ODDS.sanZhongEr);
    ODDS.sanZhongSan = mulOf(pt, 'sanZhongSan', ODDS.sanZhongSan);
    ODDS.siQuanZhong = mulOf(pt, 'siQuanZhong', ODDS.siQuanZhong);
    ODDS.temaTou0 = mulOf(pt, 'temaTou0', ODDS.temaTou0);
    ODDS.temaTou = mulOf(pt, 'temaTou', ODDS.temaTou);
    ODDS.temaWei0 = mulOf(pt, 'temaWei0', ODDS.temaWei0);
    ODDS.temaWei = mulOf(pt, 'temaWei', ODDS.temaWei);
    ODDS.wuxingJin = mulOf(pt, 'wuxingJin', ODDS.wuxingJin);
    ODDS.wuxingMu = mulOf(pt, 'wuxingMu', ODDS.wuxingMu);
    ODDS.wuxingShui = mulOf(pt, 'wuxingShui', ODDS.wuxingShui);
    ODDS.wuxingHuo = mulOf(pt, 'wuxingHuo', ODDS.wuxingHuo);
    ODDS.wuxingTu = mulOf(pt, 'wuxingTu', ODDS.wuxingTu);
    ;[2, 3, 4, 5].forEach(function (n) {
      ODDS.sxLianZhong[n] = mulOf(pt, 'sxLianZhong' + n, ODDS.sxLianZhong[n]);
      ODDS.sxLianZhongYear[n] = mulOf(pt, 'sxLianZhong' + n + 'Year', ODDS.sxLianZhongYear[n]);
      ODDS.sxLianBuZhong[n] = mulOf(pt, 'sxLianBuZhong' + n, ODDS.sxLianBuZhong[n]);
    });
    ;[2, 3, 4, 5].forEach(function (n) {
      ODDS.wsLianZhong[n] = mulOf(pt, 'wsLianZhong' + n, ODDS.wsLianZhong[n]);
      ODDS.wsLianBuZhong[n] = mulOf(pt, 'wsLianBuZhong' + n, ODDS.wsLianBuZhong[n]);
    });
    ODDS.wsLianZhong5Zero = mulOf(pt, 'wsLianZhong5Zero', ODDS.wsLianZhong5Zero);
    ;[2, 3, 4, 5, 6, 7, 8, 9, 10, 11].forEach(function (n) {
      ODDS.heXiao[n] = mulOf(pt, 'heXiao' + n, ODDS.heXiao[n]);
    });
    ;[5, 6, 7, 8, 9, 10, 11, 12].forEach(function (n) {
      ODDS.buZhong[n] = mulOf(pt, 'buZhong' + n, ODDS.buZhong[n]);
    });
  }

  /* 本地兜底须与 server lhc-odds.ts LHC_ODDS 同值；启动后由 /pay-table 覆盖 */
  const ODDS = {
    tema: 48.5,
    temaB: 47,
    zhengma: 7.21,
    zhengmaB: 7.21,
    zhengTe: 48.5,
    side: 1.98,
    heSide: 1.98,
    weiSide: 1.98,
    weiXiao: 1.98,
    comboSide: 3.7,
    zhengSide: 1.98,
    zhengCombo: 3.7,
    zhengHe: 1.98,
    zhengWei: 1.98,
    zhengWeiSmall: 1.98,
    colorRed: 2.7,
    colorBlue: 2.9,
    colorGreen: 2.9,
    colorHalf: {
      红大: 6.51, 红单: 5.61, 红双: 5.05, 红小: 4.52,
      蓝小: 6.51, 蓝单: 5.61, 蓝双: 5.61, 蓝大: 5.05,
      绿小: 6.51, 绿双: 6.51, 绿大: 5.61, 绿单: 5.61,
    },
    colorHalfHalf: {
      红大单: 13.5, 红大双: 11.6, 红小单: 9.3, 红小双: 9.3,
      蓝小单: 13.5, 蓝大双: 11.6, 蓝小双: 11.6, 蓝大单: 9.3,
      绿小双: 13.5, 绿大单: 11.6, 绿大双: 11.6, 绿小单: 11.6,
    },
    zodiac: 11.3,
    zodiacYear: 9.3,
    pingTe: 2.07,
    pingTeYear: 1.79,
    zhengXiao: 1.88,
    zhengXiaoYear: 1.62,
    weiShu0: 2.07,
    weiShu: 1.79,
    weiShuMiss0: 1.81,
    weiShuMiss: 2.15,
    sumSide: 1.93,
    sumTail: 1.96,
    liuxiao: 1.95,
    erQuanZhong: 60,
    erZhongTe: 50,
    erZhongTeTe: 25.5,
    teChuan: 150,
    sanQuanZhong: 670,
    sanZhongEr: 20,
    sanZhongSan: 100,
    siQuanZhong: 9000,
    temaTou0: 5,
    temaTou: 4.36,
    temaWei0: 12,
    temaWei: 9.6,
    wuxingJin: 4.3,
    wuxingMu: 4.3,
    wuxingShui: 5.2,
    wuxingHuo: 3.5,
    wuxingTu: 4.7,
    sxLianZhong: { 2: 4.12, 3: 11.12, 4: 31.2, 5: 98 },
    sxLianZhongYear: { 2: 3.32, 3: 9.02, 4: 25.3, 5: 87 },
    sxLianBuZhong: { 2: 3.66, 3: 8, 4: 19.3, 5: 52.8 },
    wsLianZhong: { 2: 3.18, 3: 7.08, 4: 15.8, 5: 40 },
    wsLianZhong5Zero: 45,
    wsLianBuZhong: { 2: 5.36, 3: 15.3, 4: 52.8, 5: 120 },
    heXiao: { 2: 5.6, 3: 3.7, 4: 2.8, 5: 2.2, 6: 1.99, 7: 1.63, 8: 1.43, 9: 1.27, 10: 1.14, 11: 1.05 },
    buZhong: { 5: 1.75, 6: 1.9, 7: 2.5, 8: 3, 9: 4, 10: 5, 11: 6, 12: 7 },
  };

  /** 春节前沿用上一生肖年；表与服务端 lhc-odds.ts 保持一致。 */
  const CNY_ZODIAC = [
    [2023, 1, 22, '兔'], [2024, 2, 10, '龙'], [2025, 1, 29, '蛇'], [2026, 2, 17, '马'],
    [2027, 2, 6, '羊'], [2028, 1, 26, '猴'], [2029, 2, 13, '鸡'], [2030, 2, 3, '狗'],
    [2031, 1, 23, '猪'], [2032, 2, 11, '鼠'], [2033, 1, 31, '牛'], [2034, 2, 19, '虎'],
    [2035, 2, 8, '兔'], [2036, 1, 28, '龙'],
  ];
  const ZODIAC_CYCLE = ['鼠', '牛', '虎', '兔', '龙', '蛇', '马', '羊', '猴', '鸡', '狗', '猪'];
  function yearZodiacAt(date) {
    const d = date || new Date();
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Shanghai',
      year: 'numeric', month: '2-digit', day: '2-digit',
    }).formatToParts(d);
    const get = function (t) {
      const hit = parts.find(function (p) { return p.type === t; });
      return Number(hit ? hit.value : '1');
    };
    const y = get('year');
    const m = get('month');
    const day = get('day');
    let current = '马';
    CNY_ZODIAC.forEach(function (row) {
      const yy = row[0];
      const mm = row[1];
      const dd = row[2];
      const zodiac = row[3];
      if (y > yy || (y === yy && (m > mm || (m === mm && day >= dd)))) current = zodiac;
    });
    return current;
  }
  function zodiacOrderForYear(yearZodiac) {
    const start = Math.max(0, ZODIAC_CYCLE.indexOf(yearZodiac || yearZodiacAt()));
    return Array.from({ length: 12 }, (_, i) => ZODIAC_CYCLE[(start - i + 12) % 12]);
  }
  function yearZodiac() { return yearZodiacAt(); }
  function zodiacOrder() { return zodiacOrderForYear(yearZodiac()); }

  const RED = [1, 2, 7, 8, 12, 13, 18, 19, 23, 24, 29, 30, 34, 35, 40, 45, 46];
  const BLUE = [3, 4, 9, 10, 14, 15, 20, 25, 26, 31, 36, 37, 41, 42, 47, 48];
  const CN_NUM = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10, 十一: 11, 十二: 12 };
  const NUM_CN = { 1: '一', 2: '二', 3: '三', 4: '四', 5: '五', 6: '六', 7: '七', 8: '八' };
  /** 五行号码表（与 server lhc-odds.ts 一致） */
  const WUXING_OF = {
    1: '火', 2: '火', 3: '金', 4: '金', 5: '土', 6: '土', 7: '木', 8: '木', 9: '火', 10: '火',
    11: '金', 12: '金', 13: '土', 14: '水', 15: '木', 16: '木', 17: '火', 18: '火', 19: '金', 20: '金',
    21: '土', 22: '水', 23: '木', 24: '木', 25: '火', 26: '火', 27: '金', 28: '金', 29: '土', 30: '水',
    31: '木', 32: '木', 33: '火', 34: '火', 35: '金', 36: '金', 37: '土', 38: '水', 39: '木', 40: '木',
    41: '火', 42: '火', 43: '金', 44: '土', 45: '水', 46: '水', 47: '木', 48: '土', 49: '火',
  };

  function zodiacOf(n) {
    const idx = (n - 1) % 12;
    return zodiacOrder()[idx];
  }
  function zodiacOdds(z) {
    return z === yearZodiac() ? ODDS.zodiacYear : ODDS.zodiac;
  }
  function pingTeOdds(z) {
    return z === yearZodiac() ? ODDS.pingTeYear : ODDS.pingTe;
  }
  function zhengXiaoOdds(z) {
    return z === yearZodiac() ? ODDS.zhengXiaoYear : ODDS.zhengXiao;
  }
  function wuxingOf(n) {
    return WUXING_OF[n] || '火';
  }
  function numsOfWuxing(wx) {
    const out = [];
    for (let n = 1; n <= 49; n++) if (wuxingOf(n) === wx) out.push(n);
    return out;
  }
  function wuxingOdds(wx) {
    if (wx === '金') return ODDS.wuxingJin;
    if (wx === '木') return ODDS.wuxingMu;
    if (wx === '水') return ODDS.wuxingShui;
    if (wx === '火') return ODDS.wuxingHuo;
    if (wx === '土') return ODDS.wuxingTu;
    return 1;
  }
  function sxLianOdds(n, hit, zodiacs) {
    if (!hit) return (ODDS.sxLianBuZhong[n] || 1);
    const hasYear = (zodiacs || []).indexOf(yearZodiac()) >= 0;
    if (hasYear) return ODDS.sxLianZhongYear[n] || ODDS.sxLianZhong[n] || 1;
    return ODDS.sxLianZhong[n] || 1;
  }
  function wsLianOdds(n, hit, tails) {
    if (!hit) return ODDS.wsLianBuZhong[n] || 1;
    if (n === 5 && (tails || []).some((t) => Number(t) === 0)) return ODDS.wsLianZhong5Zero || 45;
    return ODDS.wsLianZhong[n] || 1;
  }
  function waveColor(n) {
    if (RED.includes(n)) return '红';
    if (BLUE.includes(n)) return '蓝';
    return '绿';
  }
  function digitSum(n) {
    return Math.floor(n / 10) + (n % 10);
  }
  function sideOfTema(n) {
    return { big: n >= 25, odd: n % 2 === 1 };
  }
  function matchSide(side, meta) {
    if (side === '大') return meta.big;
    if (side === '小') return !meta.big;
    if (side === '单') return meta.odd;
    return !meta.odd;
  }
  function colorOdds(c) {
    if (c === '红') return ODDS.colorRed;
    if (c === '蓝') return ODDS.colorBlue;
    return ODDS.colorGreen;
  }
  function parseNumList(str) {
    const raw = String(str || '');
    if (raw.includes('拖')) {
      const i = raw.indexOf('拖');
      return parseNumList(raw.slice(0, i)).concat(parseNumList(raw.slice(i + 1)));
    }
    return raw.split(/[,，、\s]+/).map(s => parseInt(s, 10)).filter(n => n >= 1 && n <= 49);
  }
  function parseZodiacList(str) {
    // 支持「鼠,牛,虎」/「鼠、牛」与无分隔「鼠牛虎」；拖头「鼠拖牛、虎」
    const raw = String(str || '');
    if (raw.includes('拖')) {
      const i = raw.indexOf('拖');
      return parseZodiacList(raw.slice(0, i)).concat(parseZodiacList(raw.slice(i + 1)));
    }
    const parts = raw.split(/[,，、\s]+/).filter(Boolean);
    const fromParts = parts.filter(z => /^[鼠牛虎兔龙蛇马羊猴鸡狗猪]$/.test(z));
    if (fromParts.length) return fromParts;
    const out = [];
    for (let i = 0; i < raw.length; i++) {
      if (/^[鼠牛虎兔龙蛇马羊猴鸡狗猪]$/.test(raw[i])) out.push(raw[i]);
    }
    return out;
  }
  function parseTailList(str) {
    const raw = String(str || '');
    if (raw.includes('拖')) {
      const i = raw.indexOf('拖');
      return parseTailList(raw.slice(0, i)).concat(parseTailList(raw.slice(i + 1)));
    }
    return raw.split(/[,，、\s]+/).map(s => {
      const m = String(s).match(/^(\d)/);
      return m ? +m[1] : NaN;
    }).filter(n => n >= 0 && n <= 9);
  }
  /** 拖头展示：鼠拖牛、虎 / 0尾1尾拖2尾、3尾；选胆中显示「鼠拖」 */
  function formatTuotouSelecting(items, danN, fmt, joinDan) {
    const arr = (items || []).map(fmt);
    const jd = joinDan == null ? '' : joinDan;
    if (!arr.length) return '';
    if (arr.length < danN) return arr.join(jd);
    if (arr.length === danN) return arr.join(jd) + '拖';
    return arr.slice(0, danN).join(jd) + '拖' + arr.slice(danN).join('、');
  }
  function formatTuotouZodiacs(zs, danN) {
    return formatTuotouSelecting(zs, danN, (z) => z, '');
  }
  function formatTuotouTails(ts, danN) {
    return formatTuotouSelecting(ts, danN, (t) => `${t}尾`, '');
  }
  function formatTuotouNums(nums, danN) {
    return formatTuotouSelecting(nums, danN, (n) => pad(+n, 2), ',');
  }
  function combinations(arr, k) {
    const out = [];
    const n = arr.length;
    if (k <= 0 || k > n) return out;
    const idx = Array.from({ length: k }, (_, i) => i);
    while (true) {
      out.push(idx.map(i => arr[i]));
      let i = k - 1;
      while (i >= 0 && idx[i] === i + n - k) i -= 1;
      if (i < 0) break;
      idx[i] += 1;
      for (let j = i + 1; j < k; j++) idx[j] = idx[j - 1] + 1;
    }
    return out;
  }

  /** C(n,k) 注数（对齐 gOrderB 复式） */
  function comboCountFushi(n, k) {
    if (k <= 0 || n < k) return 0;
    let a = 1;
    let b = 1;
    for (let i = 0; i < k; i++) {
      a *= (n - i);
      b *= (i + 1);
    }
    return Math.round(a / b);
  }
  /** 复式：全部 C(n,k) 组合 */
  function expandFushi(items, k) {
    return combinations([...items], k);
  }
  /**
   * 拖头：前 (k-1) 为胆，其余为托；每托一注 = 胆全部 + 该托
   * 对齐 gOrderB / rules「鼠拖牛、虎」
   */
  function expandTuotou(items, k) {
    const arr = [...items];
    const headN = k - 1;
    if (headN <= 0 || arr.length <= headN) return [];
    const head = arr.slice(0, headN);
    const tails = arr.slice(headN);
    return tails.map(t => head.concat([t]));
  }
  /** 多组：每组原样 1 注 */
  function expandDuozu(groups) {
    return (groups || []).filter(g => g && g.length).map(g => [...g]);
  }
  /** 对碰：A×B 笛卡尔积（去同号），生成二码对 */
  function expandDuipengPairs(setA, setB) {
    const out = [];
    const seen = new Set();
    (setA || []).forEach(a => {
      (setB || []).forEach(b => {
        if (a === b) return;
        const x = +a;
        const y = +b;
        if (!(x >= 1 && x <= 49 && y >= 1 && y <= 49)) return;
        const lo = Math.min(x, y);
        const hi = Math.max(x, y);
        const key = lo + ',' + hi;
        if (seen.has(key)) return;
        seen.add(key);
        out.push([lo, hi]);
      });
    });
    return out;
  }
  /** 生肖 → 对应号码 1~49 */
  function numsOfZodiac(z) {
    const out = [];
    for (let n = 1; n <= 49; n++) {
      if (zodiacOf(n) === z) out.push(n);
    }
    return out;
  }
  /** 尾数 → 对应号码 */
  function numsOfTail(t) {
    const tail = +t;
    const out = [];
    for (let n = 1; n <= 49; n++) {
      if (n % 10 === tail) out.push(n);
    }
    return out;
  }
  /** 按副玩法展开组合（items 保持选择顺序，拖头依赖顺序） */
  function expandByMode(mode, items, k) {
    if (mode === '拖头') return expandTuotou(items, k);
    return expandFushi(items, k);
  }
  /** 玩法脚金额栏是否处于梭哈（提前声明，避免 unitAmount/refreshStats TDZ） */
  let playAllin = false;
  /**
   * 上一次从玩法面板提交的选中快照，给面板里的「重复」用。
   * 面板的重复要把玩法重新点回来、金额留着可改，而不是把文本塞进聊天框
   * —— 塞进聊天框就没法换金额了。组合玩法不存（无可靠回填口）。
   * @type {{plays:string[],catIdx:number,amount:number,allin:boolean}|null}
   */
  let lastPanelPick = null;

  function unitAmount() {
    if (playAllin) return 0;
    return Math.max(1, parseInt($('#playAmount').val(), 10) || 0);
  }
  function fmtBetSummary(betCount, amount) {
    if (!betCount) return '';
    return `共${betCount}注·合计${betCount * amount}`;
  }

  /**
   * 解析玩法文本 → { type, ..., odds }；不合法返回 null
   * 对齐 123.com class1/class2/class3 语义
   */
  function parsePlay(raw) {
    const t = String(raw || '').replace(/\s+/g, '').replace(/\//g, '');
    let m;
    // 连码：复式二全中01,08 / 四全中...
    if ((m = t.match(/^(复式|拖头|生肖对碰|尾数对碰|生尾对碰|任意对碰)?(四全中|二全中|二中特|特串|三全中|三中二)([\d,，、拖]+)$/))) {
      const nums = parseNumList(m[3]);
      const need = m[2] === '四全中' ? 4 : (m[2] === '三全中' || m[2] === '三中二') ? 3 : 2;
      if (nums.length < need) return null;
      const oddsMap = {
        四全中: ODDS.siQuanZhong,
        二全中: ODDS.erQuanZhong,
        二中特: ODDS.erZhongTe,
        特串: ODDS.teChuan,
        三全中: ODDS.sanQuanZhong,
        三中二: ODDS.sanZhongEr,
      };
      const mode = m[1] || (String(m[3]).includes('拖') ? '拖头' : '复式');
      return { type: 'lianma', mode, play: m[2], nums, odds: oddsMap[m[2]], odds2: m[2] === '二中特' ? ODDS.erZhongTeTe : (m[2] === '三中二' ? ODDS.sanZhongSan : 0) };
    }
    // 连肖：复式二肖中鼠,牛 / 拖头二肖中鼠拖牛、虎
    if ((m = t.match(/^(复式|拖头)?([二三四五])肖(中|不中)([鼠牛虎兔龙蛇马羊猴鸡狗猪,，、拖]+)$/))) {
      const n = CN_NUM[m[2]];
      const zs = parseZodiacList(m[4]);
      if (!n || zs.length < n) return null;
      const hit = m[3] === '中';
      const mode = m[1] || (String(m[4]).includes('拖') ? '拖头' : '复式');
      return { type: 'sxLian', mode, n, hit, zodiacs: zs, odds: sxLianOdds(n, hit, zs) };
    }
    // 连尾：复式三尾中0尾,1尾 / 拖头三尾中0尾1尾拖2尾、3尾
    if ((m = t.match(/^(复式|拖头)?([二三四五])尾(中|不中)((?:\d尾?[,，、拖]*)+)$/))) {
      const n = CN_NUM[m[2]];
      const tails = parseTailList(m[4]);
      if (!n || tails.length < n) return null;
      const hit = m[3] === '中';
      const mode = m[1] || (String(m[4]).includes('拖') ? '拖头' : '复式');
      return { type: 'wsLian', mode, n, hit, tails, odds: wsLianOdds(n, hit, tails) };
    }
    // 合肖：须带「合肖」前缀，避免与连肖口语混淆
    if ((m = t.match(/^合肖(十一|十|[二三四五六七八九])肖([鼠牛虎兔龙蛇马羊猴鸡狗猪,，]+)$/) ) ||
        (m = t.match(/^合肖(十一|十|[二三四五六七八九])([鼠牛虎兔龙蛇马羊猴鸡狗猪,，]+)$/))) {
      const n = CN_NUM[m[1]];
      const zs = [...new Set(parseZodiacList(m[2]))];
      if (!n || zs.length !== n) return null;
      return { type: 'heXiao', n, zodiacs: zs, odds: ODDS.heXiao[n] || 1 };
    }
    // 六肖中/不中
    if ((m = t.match(/^(六肖中|六肖不中)([鼠牛虎兔龙蛇马羊猴鸡狗猪,，]+)$/))) {
      const zs = parseZodiacList(m[2]);
      if (zs.length !== 6) return null;
      return { type: 'liuxiao', hit: m[1] === '六肖中', zodiacs: zs, odds: ODDS.liuxiao };
    }
    // 自选不中：复式五不中01,02,...
    if ((m = t.match(/^(复式|多组)?(十一|十二|五|六|七|八|九|十)不中([\d,，]+)$/))) {
      const n = CN_NUM[m[2]];
      const nums = parseNumList(m[3]);
      if (!n || nums.length < n) return null;
      return { type: 'buZhong', mode: m[1] || '复式', n, nums, odds: ODDS.buZhong[n] || 1 };
    }
    // 正码特：正一特23 / 正1特23
    if ((m = t.match(/^正([一二三四五六1-6])特(0?[1-9]|[1-4][0-9])$/))) {
      const pos = CN_NUM[m[1]] || Number(m[1]);
      const num = +m[2];
      if (!pos || pos < 1 || pos > 6 || num < 1 || num > 49) return null;
      return { type: 'zhengTe', pos, num, odds: ODDS.zhengTe };
    }
    // 正码位两面/组合/合/尾：正1大 / 正一大单 / 正1合大 / 正1尾小
    if ((m = t.match(/^正([一二三四五六1-6])(大单|大双|小单|小双)$/))) {
      const pos = CN_NUM[m[1]] || Number(m[1]);
      if (!pos || pos < 1 || pos > 6) return null;
      return { type: 'zhengCombo', pos, combo: m[2], odds: ODDS.zhengCombo };
    }
    if ((m = t.match(/^正([一二三四五六1-6])合(大|小|单|双)$/))) {
      const pos = CN_NUM[m[1]] || Number(m[1]);
      if (!pos || pos < 1 || pos > 6) return null;
      return { type: 'zhengHe', pos, side: m[2], odds: ODDS.zhengHe };
    }
    if ((m = t.match(/^正([一二三四五六1-6])尾(大|小)$/))) {
      const pos = CN_NUM[m[1]] || Number(m[1]);
      if (!pos || pos < 1 || pos > 6) return null;
      return { type: 'zhengWei', pos, side: m[2], odds: m[2] === '小' ? ODDS.zhengWeiSmall : ODDS.zhengWei };
    }
    if ((m = t.match(/^正([一二三四五六1-6])(大|小|单|双)$/))) {
      const pos = CN_NUM[m[1]] || Number(m[1]);
      if (!pos || pos < 1 || pos > 6) return null;
      return { type: 'zhengSide', pos, side: m[2], odds: ODDS.zhengSide };
    }
    // 正波：正1红波 / 正一蓝
    if ((m = t.match(/^正([一二三四五六1-6])(红|蓝|绿)波?$/))) {
      const pos = CN_NUM[m[1]] || Number(m[1]);
      if (!pos || pos < 1 || pos > 6) return null;
      return { type: 'zhengColor', pos, color: m[2], odds: colorOdds(m[2]) };
    }
    // 特码号码
    if ((m = t.match(/^(?:特码|特)(0?[1-9]|[1-4][0-9])$/))) {
      const num = +m[1];
      if (num < 1 || num > 49) return null;
      return { type: 'tema', num, odds: ODDS.tema };
    }
    // 正码号码（须在正N两面之后）
    if ((m = t.match(/^(?:正码|正)(0?[1-9]|[1-4][0-9])$/))) {
      const num = +m[1];
      if (num < 1 || num > 49) return null;
      return { type: 'zhengma', num, odds: ODDS.zhengma };
    }
    if ((m = t.match(/^(?:特码|特)(大单|大双|小单|小双)$/))) {
      return { type: 'temaCombo', combo: m[1], odds: ODDS.comboSide };
    }
    if ((m = t.match(/^(?:特码|特)(大|小|单|双)$/))) {
      return { type: 'temaSide', side: m[1], odds: ODDS.side };
    }
    if ((m = t.match(/^(?:特码)?合(大|小|单|双)$/) ) || (m = t.match(/^特合(大|小|单|双)$/))) {
      return { type: 'heSide', side: m[1], odds: ODDS.heSide != null ? ODDS.heSide : ODDS.side };
    }
    // 特码头：0头 / 特码0头 / 1头
    if ((m = t.match(/^(?:特码)?([0-4])头$/))) {
      const head = +m[1];
      return { type: 'temaTou', head, odds: head === 0 ? ODDS.temaTou0 : ODDS.temaTou };
    }
    // 特码尾（特码位高赔）：特0尾 / 特码3尾 —— 须在平特N尾之前用「特」前缀区分
    if ((m = t.match(/^特(?:码)?([0-9])尾$/))) {
      const tail = +m[1];
      return { type: 'temaWeiNum', tail, odds: tail === 0 ? ODDS.temaWei0 : ODDS.temaWei };
    }
    if ((m = t.match(/^(?:特码)?尾(大|小)$/) ) || (m = t.match(/^特尾(大|小)$/))) {
      return { type: 'weiSide', side: m[1], odds: m[1] === '小' ? ODDS.weiXiao : (ODDS.weiSide != null ? ODDS.weiSide : ODDS.side) };
    }
    // 半半波须在半波之前
    if ((m = t.match(/^(红|蓝|绿)(大|小)(单|双)$/))) {
      const spec = m[1] + m[2] + m[3];
      return { type: 'colorHalfHalf', spec, odds: (ODDS.colorHalfHalf[spec] || 1) };
    }
    if ((m = t.match(/^(红|蓝|绿)(大|小|单|双)$/))) {
      const spec = m[1] + m[2];
      return { type: 'colorHalf', spec, odds: (ODDS.colorHalf[spec] || 1) };
    }
    if ((m = t.match(/^(红|蓝|绿)波$/))) {
      return { type: 'color', color: m[1], odds: colorOdds(m[1]) };
    }
    if ((m = t.match(/^总和(大|小|单|双)$/) ) || (m = t.match(/^总(大|小|单|双)$/))) {
      return { type: 'sumSide', side: m[1], odds: ODDS.sumSide };
    }
    if ((m = t.match(/^总尾(大|小)$/))) {
      return { type: 'sumTail', side: m[1], odds: ODDS.sumTail };
    }
    // 平特尾：七码含该尾
    if ((m = t.match(/^(?:平特)?([0-9])尾$/))) {
      const tail = +m[1];
      return { type: 'weiShu', tail, odds: tail === 0 ? ODDS.weiShu0 : ODDS.weiShu };
    }
    if ((m = t.match(/^(?:平特)?([0-9])尾不中$/))) {
      const tail = +m[1];
      return { type: 'weiShuMiss', tail, odds: tail === 0 ? ODDS.weiShuMiss0 : ODDS.weiShuMiss };
    }
    // 五行
    if ((m = t.match(/^(?:五行)?([金木水火土])$/))) {
      return { type: 'wuxing', wx: m[1], odds: wuxingOdds(m[1]) };
    }
    // 特肖（特码生肖，须在一肖/平特之前）
    if ((m = t.match(/^特肖([鼠牛虎兔龙蛇马羊猴鸡狗猪])$/))) {
      return { type: 'temaZodiac', z: m[1], odds: zodiacOdds(m[1]) };
    }
    // 正肖
    if ((m = t.match(/^正肖([鼠牛虎兔龙蛇马羊猴鸡狗猪])$/))) {
      return { type: 'zhengXiao', z: m[1], odds: zhengXiaoOdds(m[1]) };
    }
    // 平特一肖 / 一肖；裸生肖同义
    if ((m = t.match(/^(?:一肖|平特)([鼠牛虎兔龙蛇马羊猴鸡狗猪])$/))) {
      return { type: 'pingZodiac', z: m[1], odds: pingTeOdds(m[1]) };
    }
    if (/^[鼠牛虎兔龙蛇马羊猴鸡狗猪]$/.test(t)) {
      return { type: 'pingZodiac', z: t, odds: pingTeOdds(t) };
    }
    return null;
  }

  function mapPlayToServer(play) {
    const p = parsePlay(play);
    if (!p) return null;
    if (p.type === 'temaSide') {
      const sideMap = { '大': 'big', '小': 'small', '单': 'odd', '双': 'even' };
      const betType = sideMap[p.side];
      return betType ? { betType: betType } : null;
    }
    if (p.type === 'tema') return { betType: 'special', betValue: String(p.num) };
    if (p.type === 'zhengma') return { betType: 'zhengma', betValue: String(p.num) };
    if (p.type === 'zhengTe') return { betType: 'zhengTe', betValue: p.pos + ':' + p.num };
    if (p.type === 'zhengSide') return { betType: 'zhengSide', betValue: p.pos + ':' + p.side };
    if (p.type === 'zhengCombo') return { betType: 'zhengCombo', betValue: p.pos + ':' + p.combo };
    if (p.type === 'zhengHe') return { betType: 'zhengHe', betValue: p.pos + ':' + p.side };
    if (p.type === 'zhengWei') return { betType: 'zhengWei', betValue: p.pos + ':' + p.side };
    if (p.type === 'zhengColor') return { betType: 'zhengColor', betValue: p.pos + ':' + p.color };
    if (p.type === 'temaCombo') return { betType: 'combo', betValue: p.combo };
    if (p.type === 'color') return { betType: 'color', betValue: p.color };
    if (p.type === 'colorHalf') return { betType: 'colorHalf', betValue: p.spec };
    if (p.type === 'colorHalfHalf') return { betType: 'colorHalfHalf', betValue: p.spec };
    if (p.type === 'temaZodiac' || p.type === 'pingZodiac' || p.type === 'zhengXiao') return { betType: p.type, betValue: p.z };
    if (p.type === 'heSide' || p.type === 'weiSide' || p.type === 'sumSide' || p.type === 'sumTail') return { betType: p.type, betValue: p.side };
    if (p.type === 'weiShu' || p.type === 'weiShuMiss') return { betType: p.type, betValue: String(p.tail) };
    if (p.type === 'temaTou') return { betType: 'temaTou', betValue: String(p.head) };
    if (p.type === 'temaWeiNum') return { betType: 'temaWei', betValue: String(p.tail) };
    if (p.type === 'wuxing') return { betType: 'wuxing', betValue: p.wx };
    if (p.type === 'heXiao') return { betType: 'heXiao', betValue: JSON.stringify({ n: p.n, zodiacs: p.zodiacs }) };
    if (p.type === 'lianma') return { betType: 'lianma', betValue: JSON.stringify({ play: p.play, nums: p.nums, mode: p.mode || '复式' }) };
    if (p.type === 'sxLian') return { betType: 'sxLian', betValue: JSON.stringify({ n: p.n, hit: p.hit, zodiacs: p.zodiacs, mode: p.mode || '复式' }) };
    if (p.type === 'wsLian') return { betType: 'wsLian', betValue: JSON.stringify({ n: p.n, hit: p.hit, tails: p.tails, mode: p.mode || '复式' }) };
    if (p.type === 'buZhong') return { betType: 'buZhong', betValue: JSON.stringify({ n: p.n, nums: p.nums, mode: p.mode || '复式' }) };
    if (p.type === 'liuxiao') return { betType: 'liuxiao', betValue: JSON.stringify({ hit: p.hit, zodiacs: p.zodiacs }) };
    return null;
  }

  function mapLinesToServerBets(lines) {
    const bets = [];
    const unsupported = [];
    const NUM_CN = { 2: '二', 3: '三', 4: '四', 5: '五', 6: '六', 7: '七', 8: '八', 9: '九', 10: '十', 11: '十一', 12: '十二' };
    lines.forEach(function (l) {
      const parsed = parsePlay(l.play);
      /* 复式/拖头每一组合必须作为服务端独立注单提交（与本地 settleBet 拆注一致）。 */
      let parts = [l];
      if (parsed && parsed.type === 'lianma') {
        const need = lianmaNeedOf(parsed.play);
        parts = expandByMode(parsed.mode || '复式', parsed.nums, need)
          .map((nums) => {
            const mode = parsed.mode || '复式';
            const body = mode === '拖头'
              ? formatTuotouNums(nums, need - 1)
              : nums.map(n => pad(n, 2)).join(',');
            return { play: `${mode}${parsed.play}${body}`, amount: l.amount };
          });
      } else if (parsed && parsed.type === 'sxLian') {
        parts = expandByMode(parsed.mode || '复式', parsed.zodiacs, parsed.n)
          .map((zs) => {
            const tag = `${NUM_CN[parsed.n]}肖${parsed.hit ? '中' : '不中'}`;
            const mode = parsed.mode || '复式';
            const body = mode === '拖头'
              ? formatTuotouZodiacs(zs, parsed.n - 1)
              : zs.join(',');
            return { play: `${mode}${tag}${body}`, amount: l.amount };
          });
      } else if (parsed && parsed.type === 'wsLian') {
        parts = expandByMode(parsed.mode || '复式', parsed.tails, parsed.n)
          .map((ts) => {
            const tag = `${NUM_CN[parsed.n]}尾${parsed.hit ? '中' : '不中'}`;
            const mode = parsed.mode || '复式';
            const body = mode === '拖头'
              ? formatTuotouTails(ts, parsed.n - 1)
              : ts.map(t => t + '尾').join(',');
            return { play: `${mode}${tag}${body}`, amount: l.amount };
          });
      } else if (parsed && parsed.type === 'buZhong') {
        if (!(parsed.mode === '多组' && parsed.nums.length === parsed.n)) {
          parts = expandFushi([...new Set(parsed.nums)].sort((a, b) => a - b), parsed.n)
            .map(nums => ({ play: `复式${NUM_CN[parsed.n]}不中${nums.map(n => pad(n, 2)).join(',')}`, amount: l.amount }));
        }
      }
      if (!parts.length) unsupported.push(l.play);
      parts.forEach(part => {
        const m = mapPlayToServer(part.play);
        if (!m) { unsupported.push(part.play); return; }
        const row = { betType: m.betType, amount: part.amount };
        if (m.betValue != null) row.betValue = m.betValue;
        bets.push(row);
      });
    });
    return { bets: bets, unsupported: unsupported };
  }

  /* ================= 聊天口语下注展开 ================= */
  const ZODIAC_RE = /[鼠牛虎兔龙蛇马羊猴鸡狗猪]/g;
  const YOU_CN = { 2: '二', 3: '三', 4: '四', 5: '五' };
  const YOU_NUM = { 二: 2, 三: 3, 四: 4, 五: 5 };
  const LM_ALIAS = {
    三中三: '三全中', 三全中: '三全中', 三中二: '三中二',
    二中特: '二中特', 二全中: '二全中', 特串: '特串', 四全中: '四全中',
  };
  const LM_NEED = { 四全中: 4, 二全中: 2, 二中特: 2, 特串: 2, 三全中: 3, 三中二: 3 };
  function lianmaNeedOf(play) {
    return LM_NEED[play] || 2;
  }

  function extractZodiacs(str) {
    const out = [];
    const s = String(str || '');
    for (let i = 0; i < s.length; i++) {
      if (/^[鼠牛虎兔龙蛇马羊猴鸡狗猪]$/.test(s[i])) out.push(s[i]);
    }
    return out;
  }
  function extractNums(str) {
    return String(str || '')
      .replace(/[．.]/g, ',')
      .split(/[,，\s]+/)
      .map(x => parseInt(x, 10))
      .filter(n => n >= 1 && n <= 49);
  }
  function temaLines(nums, amount) {
    const seen = new Set();
    const lines = [];
    nums.forEach(n => {
      if (seen.has(n)) return;
      seen.add(n);
      const play = '特码' + pad(n, 2);
      if (parsePlay(play)) lines.push({ play, amount });
    });
    return lines.length ? lines : null;
  }
  function normalizeChatBetText(text) {
    return String(text || '')
      .trim()
      .replace(/[（(][^）)]*[）)]/g, '') // （二有）等说明
      .replace(/[／]/g, '/')
      .replace(/[．.]/g, ',')
      .replace(/\s+/g, '');
  }

  /** 空格多注：一肖鼠/50 一肖牛/50；玩法段内可含空格 */
  function splitChatBetTokens(raw, parseLine) {
    const s = String(raw || '').trim();
    if (!s) return [];
    if (!/\s/.test(s)) return [s];
    const out = [];
    let i = 0;
    while (i < s.length) {
      while (i < s.length && s[i] === ' ') i++;
      if (i >= s.length) break;
      let matched = null;
      let end = i;
      for (let j = s.length; j > i; j--) {
        if (j < s.length && s[j] !== ' ') continue;
        const cand = s.slice(i, j).trim();
        if (!cand || !/\/(\d+|梭哈|全下|allin)$/i.test(cand)) continue;
        const lines = parseLine(cand);
        if (lines && lines.length) {
          matched = cand;
          end = j;
          break;
        }
      }
      if (matched) {
        out.push(matched);
        i = end;
        continue;
      }
      const sp = s.indexOf(' ', i);
      if (sp < 0) {
        out.push(s.slice(i).trim());
        break;
      }
      out.push(s.slice(i, sp).trim());
      i = sp + 1;
    }
    return out.filter(Boolean);
  }

  function linesFromChatChunk(chunk, noMulti) {
    return expandChatBetInput(chunk, noMulti ? { noMulti: true } : undefined);
  }

  /** 口语 → [{play, amount}, ...]；失败返回 null */
  function expandChatBetInput(text, opts) {
    const raw0 = String(text || '').trim();
    if (!raw0) return null;
    const noMulti = !!(opts && opts.noMulti);
    // 多注：用 ； 或换行分隔（「重复」填入多注时用）
    if (!noMulti && /[；;\n\r]/.test(raw0)) {
      const all = [];
      for (const part of raw0.split(/[；;\n\r]+/)) {
        const row = part.trim();
        if (!row) continue;
        const lines = expandChatBetInput(row, { noMulti: true });
        if (!lines || !lines.length) return null;
        all.push(...lines);
      }
      return all.length ? all : null;
    }
    if (!noMulti && /\s/.test(raw0)) {
      const tokens = splitChatBetTokens(raw0, function (c) {
        return linesFromChatChunk(c, true);
      });
      if (tokens.length > 1) {
        const all = [];
        for (const tok of tokens) {
          const lines = expandChatBetInput(tok, { noMulti: true });
          if (!lines || !lines.length) return null;
          all.push(...lines);
        }
        return all.length ? all : null;
      }
    }
    const t = normalizeChatBetText(raw0);

    // 键盘简口令：大各100 → 该属性下每个特码号各买（不含 49）
    let m = t.match(/^([大小单双])各(\d+)$/);
    if (m) {
      const lines = temaLines(ballNumsBySide(m[1]), +m[2]);
      if (lines) return lines;
    }

    // 键盘简口令：大100 / 大/100 → 特码两面
    m = t.match(/^([大小单双])\/?(\d+)$/);
    if (m) {
      const play = '特码' + m[1];
      const amount = +m[2];
      if (amount > 0 && parsePlay(play)) return [{ play, amount }];
    }

    // 组合两面：大单50 → 特码大单
    m = t.match(/^(大单|大双|小单|小双)\/?(\d+)$/);
    if (m) {
      const play = '特码' + m[1];
      const amount = +m[2];
      if (amount > 0 && parsePlay(play)) return [{ play, amount }];
    }

    // 0尾各50 → 特码按尾展号（玩法面板总数项仍可用）
    m = t.match(/^([0-9])尾各(\d+)数?$/);
    if (m) {
      const lines = temaLines(numsOfTail(+m[1]), +m[2]);
      if (lines) return lines;
    }

    // F0: 特肖X/金额 或多肖（特肖鼠牛/50）
    m = t.match(/^特肖([鼠牛虎兔龙蛇马羊猴鸡狗猪]+)(?:各|\/)?(\d+)$/);
    if (m) {
      const zs = extractZodiacs(m[1]);
      const amount = +m[2];
      if (zs.length && amount > 0) {
        return zs.map(z => ({ play: '特肖' + z, amount }));
      }
    }

    // F: 一肖/平特 多肖（同义，统一展开为一肖X）
    m = t.match(/^(?:一肖|平特肖?)([鼠牛虎兔龙蛇马羊猴鸡狗猪]+)(?:各|\/)?(\d+)$/);
    if (m) {
      const zs = extractZodiacs(m[1]);
      const amount = +m[2];
      if (zs.length && amount > 0) {
        return zs.map(z => ({ play: '一肖' + z, amount }));
      }
    }

    // H: 复式三四有虎鸡猴猪各5 / 三有四有虎鸡猴猪各5
    {
      let ks = [];
      let zs = [];
      let amount = 0;
      m = t.match(/^复式?((?:[二三四五]有)+)([鼠牛虎兔龙蛇马羊猴鸡狗猪]+)各(\d+)$/);
      if (m) {
        const youRe = /([二三四五])有/g;
        let ym;
        while ((ym = youRe.exec(m[1]))) ks.push(YOU_NUM[ym[1]]);
        zs = extractZodiacs(m[2]);
        amount = +m[3];
      } else {
        m = t.match(/^复式?([二三四五]{2,})有([鼠牛虎兔龙蛇马羊猴鸡狗猪]+)各(\d+)$/);
        if (m) {
          ks = [...m[1]].map(ch => YOU_NUM[ch]).filter(Boolean);
          zs = extractZodiacs(m[2]);
          amount = +m[3];
        }
      }
      if (ks.length && zs.length && amount > 0) {
        const lines = [];
        ks.forEach(k => {
          expandFushi(zs, k).forEach(c => {
            const play = '复式' + YOU_CN[k] + '肖中' + c.join(',');
            if (parsePlay(play)) lines.push({ play, amount });
          });
        });
        if (lines.length) return lines;
      }
    }

    // E: 三有蛇猪猴，狗虎羊各5  |  蛇猪猴三有，狗虎羊三有各5
    m = t.match(/^([二三四五])有(.+)各(\d+)$/);
    if (m) {
      const k = YOU_NUM[m[1]];
      const amount = +m[3];
      const groups = String(m[2]).split(/[,，、;；]/).map(extractZodiacs).filter(g => g.length >= k);
      if (k && groups.length && amount > 0) {
        const cn = YOU_CN[k];
        const lines = [];
        groups.forEach(g => {
          expandFushi(g, k).forEach(c => {
            const play = '复式' + cn + '肖中' + c.join(',');
            if (parsePlay(play)) lines.push({ play, amount });
          });
        });
        if (lines.length) return lines;
      }
    }
    // E': 蛇猪猴，狗虎羊三有各5（几有在后）
    m = t.match(/^(.+)([二三四五])有各(\d+)$/);
    if (m) {
      const k = YOU_NUM[m[2]];
      const amount = +m[3];
      const groups = String(m[1]).split(/[,，、;；]/).map(extractZodiacs).filter(g => g.length >= k);
      if (k && groups.length && amount > 0) {
        const cn = YOU_CN[k];
        const lines = [];
        groups.forEach(g => {
          expandFushi(g, k).forEach(c => {
            const play = '复式' + cn + '肖中' + c.join(',');
            if (parsePlay(play)) lines.push({ play, amount });
          });
        });
        if (lines.length) return lines;
      }
    }

    // C/D: 猪猴二连50 / 猪猴二有50 / 二有猪猴50 / 牛蛇狗三连50
    m = t.match(/^([鼠牛虎兔龙蛇马羊猴鸡狗猪]+)([二三四五])(?:连|有|肖中)(\d+)$/);
    if (m) {
      const zs = extractZodiacs(m[1]);
      const k = YOU_NUM[m[2]];
      const amount = +m[3];
      if (zs.length >= k && amount > 0) {
        const lines = expandFushi(zs, k).map(c => ({
          play: '复式' + YOU_CN[k] + '肖中' + c.join(','),
          amount,
        })).filter(l => parsePlay(l.play));
        if (lines.length) return lines;
      }
    }
    m = t.match(/^([二三四五])(?:连|有|肖中)([鼠牛虎兔龙蛇马羊猴鸡狗猪]+)(\d+)$/);
    if (m) {
      const k = YOU_NUM[m[1]];
      const zs = extractZodiacs(m[2]);
      const amount = +m[3];
      if (zs.length >= k && amount > 0) {
        const lines = expandFushi(zs, k).map(c => ({
          play: '复式' + YOU_CN[k] + '肖中' + c.join(','),
          amount,
        })).filter(l => parsePlay(l.play));
        if (lines.length) return lines;
      }
    }

    // J: 30,49,27,45,32,43复式二中特各5 / 四全中
    m = t.match(/^([\d,，]+)复式?(四全中|二中特|二全中|特串|三全中|三中二|三中三)各(\d+)$/);
    if (m) {
      const playName = LM_ALIAS[m[2]] || m[2];
      const nums = extractNums(m[1]);
      const amount = +m[3];
      const need = lianmaNeedOf(playName);
      if (nums.length >= need && amount > 0) {
        const lines = expandFushi(nums, need).map(c => ({
          play: '复式' + playName + c.map(n => pad(n, 2)).join(','),
          amount,
        })).filter(l => parsePlay(l.play));
        if (lines.length) return lines;
      }
    }

    // I: 11,15,05三中三20 / 01,02,03,04四全中20
    m = t.match(/^([\d,，]+)(四全中|三中三|三全中|三中二|二中特|二全中|特串)(\d+)$/);
    if (m) {
      const playName = LM_ALIAS[m[2]] || m[2];
      const nums = extractNums(m[1]);
      const amount = +m[3];
      const need = lianmaNeedOf(playName);
      if (nums.length >= need && amount > 0) {
        const lines = expandFushi(nums, need).map(c => ({
          play: '复式' + playName + c.map(n => pad(n, 2)).join(','),
          amount,
        })).filter(l => parsePlay(l.play));
        if (lines.length) return lines;
      }
    }

    // B: 19,31,03,15,37/10 每个号码
    m = t.match(/^([\d,，]+)\/(\d+)$/);
    if (m && !/[鼠牛虎兔龙蛇马羊猴鸡狗猪连有尾平特复式]/.test(m[1])) {
      const nums = extractNums(m[1]);
      const amount = +m[2];
      if (nums.length && amount > 0) {
        const lines = temaLines(nums, amount);
        if (lines) return lines;
      }
    }

    // A: 马牛龙兔鸡各50数 / 马牛龙兔鸡输各50（非生肖字忽略）
    m = t.match(/^([鼠牛虎兔龙蛇马羊猴鸡狗猪\u4e00-\u9fff]*?)各(\d+)数?$/);
    if (m) {
      const zs = extractZodiacs(m[1]);
      const amount = +m[2];
      // 排除已被其它规则覆盖的「平特…各」「尾各」「有…各」
      if (zs.length >= 1 && amount > 0 && !/平特|尾|[二三四五]有|复式/.test(m[1])) {
        const nums = [];
        zs.forEach(z => nums.push(...numsOfZodiac(z)));
        const lines = temaLines(nums, amount);
        if (lines) return lines;
      }
    }

    // 拖头连肖：拖头二肖中鼠拖牛、虎各50 / 鼠拖牛、虎二肖中50
    m = t.match(/^(?:拖头)?([二三四五])肖(中|不中)([鼠牛虎兔龙蛇马羊猴鸡狗猪]+拖[鼠牛虎兔龙蛇马羊猴鸡狗猪、，,]+)(?:各|\/)?(\d+)$/);
    if (m) {
      const play = `拖头${m[1]}肖${m[2]}${m[3]}`;
      const amount = +m[4];
      if (amount > 0 && parsePlay(play)) return [{ play, amount }];
    }
    m = t.match(/^([鼠牛虎兔龙蛇马羊猴鸡狗猪]+拖[鼠牛虎兔龙蛇马羊猴鸡狗猪、，,]+)([二三四五])肖(中|不中)(?:各|\/)?(\d+)$/);
    if (m) {
      const play = `拖头${m[2]}肖${m[3]}${m[1]}`;
      const amount = +m[4];
      if (amount > 0 && parsePlay(play)) return [{ play, amount }];
    }
    // 拖头连尾：拖头二尾中0尾拖1尾、2尾各50
    m = t.match(/^(?:拖头)?([二三四五])尾(中|不中)((?:\d尾?)+拖(?:\d尾?[,，、]*)+)(?:各|\/)?(\d+)$/);
    if (m) {
      const play = `拖头${m[1]}尾${m[2]}${m[3]}`;
      const amount = +m[4];
      if (amount > 0 && parsePlay(play)) return [{ play, amount }];
    }

    // 回退：原有单注
    const one = parseBet(raw0);
    if (one) return [one];
    // 再试去空格规范化后的单注
    const one2 = parseBet(t.replace(/(\d+)$/, ' $1'));
    if (one2) return [one2];
    return null;
  }

  const SUOHA_WORDS = new Set(['梭哈', '全下', 'allin']);

  /** 梭哈：单注全下；多注按余额均分（余数给第一注） */
  function resolveBetAmounts(plays, amountPart) {
    const key = String(amountPart || '').trim();
    const isAllin = SUOHA_WORDS.has(key) || /^allin$/i.test(key);
    if (!isAllin) {
      const amount = parseInt(key, 10);
      if (!amount) return null;
      return plays.map(play => ({ play, amount }));
    }
    const bal = App.getBalance(user.uid);
    if (!bal || bal < 1) return null;
    if (plays.length === 1) return [{ play: plays[0], amount: bal }];
    const base = Math.floor(bal / plays.length);
    if (base < 1) return null;
    /* 余数不下注，留在余额里 */
    return plays.map((play) => ({ play, amount: base }));
  }

  function formatResolvedBets(lines) {
    return lines.map(l => `${l.play}/${l.amount}`).join('；');
  }

  /**
   * 从当前输入抽出玩法列表（可已带金额，或仅玩法）。
   * 仅玩法时用假金额走完整口语展开；复式/连码再按 C(n,k) 拆成真实注数。
   */
  function expandComboPlayNames(lines) {
    const NUM_CN = { 2: '二', 3: '三', 4: '四', 5: '五', 6: '六', 7: '七', 8: '八', 9: '九', 10: '十', 11: '十一', 12: '十二' };
    const out = [];
    (lines || []).forEach(function (l) {
      const parsed = parsePlay(l.play);
      let parts = [l.play];
      if (parsed && parsed.type === 'lianma') {
        parts = expandByMode(parsed.mode || '复式', parsed.nums, lianmaNeedOf(parsed.play))
          .map(nums => `${parsed.mode || '复式'}${parsed.play}${nums.map(n => pad(n, 2)).join(',')}`);
      } else if (parsed && parsed.type === 'sxLian') {
        parts = expandByMode(parsed.mode || '复式', parsed.zodiacs, parsed.n)
          .map(zs => `${parsed.mode || '复式'}${NUM_CN[parsed.n]}肖${parsed.hit ? '中' : '不中'}${zs.join(',')}`);
      } else if (parsed && parsed.type === 'wsLian') {
        parts = expandByMode(parsed.mode || '复式', parsed.tails, parsed.n)
          .map(ts => `${parsed.mode || '复式'}${NUM_CN[parsed.n]}尾${parsed.hit ? '中' : '不中'}${ts.map(t => t + '尾').join(',')}`);
      } else if (parsed && parsed.type === 'buZhong') {
        if (!(parsed.mode === '多组' && parsed.nums.length === parsed.n)) {
          parts = expandFushi([...new Set(parsed.nums)].sort((a, b) => a - b), parsed.n)
            .map(nums => `复式${NUM_CN[parsed.n]}不中${nums.map(n => pad(n, 2)).join(',')}`);
        }
      }
      parts.forEach(p => { if (p) out.push(p); });
    });
    return out.length ? out : null;
  }

  function expandPlaysForAllin(text) {
    const raw0 = String(text || '').trim();
    if (!raw0) return null;
    if (/[；;\n\r]/.test(raw0)) {
      const all = [];
      for (const part of raw0.split(/[；;\n\r]+/)) {
        const row = part.trim();
        if (!row) continue;
        const plays = expandPlaysForAllin(row);
        if (!plays || !plays.length) return null;
        all.push(...plays);
      }
      return all.length ? all : null;
    }

    function fromLines(lines) {
      if (!lines || !lines.length) return null;
      return expandComboPlayNames(lines);
    }

    let lines = expandChatBetInput(raw0);
    let plays = fromLines(lines);
    if (plays) return plays;

    let v = normalizeChatBetText(raw0)
      .replace(/\/(\d+|梭哈|全下|allin)$/i, '')
      .replace(/(各)\d+$/, '$1');

    /* 多选两面：大小、大小单双 → 特码大/小… */
    if (/^[大小单双]+$/.test(v)) {
      const out = [];
      const seen = new Set();
      for (const c of v) {
        if (seen.has(c)) continue;
        seen.add(c);
        const play = '特码' + c;
        if (parsePlay(play)) out.push(play);
      }
      if (out.length) return out;
    }

    const candidates = [];
    if (v.endsWith('各')) candidates.push(v + '1');
    candidates.push(v + '各1', v + '/1', v + '1');
    /* 复式/连码口语常省略金额 */
    if (/复式|[二三四五]有|[连中]|不中|中特|全中|特串|肖中|尾中/.test(v)) {
      candidates.unshift(v + '各1');
    }
    for (const c of candidates) {
      lines = expandChatBetInput(c);
      plays = fromLines(lines);
      if (plays) return plays;
    }
    if (parsePlay(v)) return [v];
    if (parsePlay('特码' + v)) return ['特码' + v];
    /* 纯号码：08,19,31 */
    if (/^[\d,，]+$/.test(v)) {
      lines = expandChatBetInput(v + '/1');
      plays = fromLines(lines);
      if (plays) return plays;
    }
    return null;
  }

  /** 玩法与金额之间：没有 / 就补上；已有 / 或 各 则不再加 */
  function joinPlayAmount(play, amount) {
    const p = String(play || '').replace(/\s+$/g, '');
    const a = String(amount);
    if (!p) return a;
    if (/[\/各]$/.test(p)) return p + a;
    return p + '/' + a;
  }

  /** 键盘输入金额数字：玩法后自动补 /；已有 /、各，或连续输数字则不加 */
  function appendKeyWithSlash(base, key) {
    const v = String(base || '');
    const t = (key === 0 || key === '0') ? '0' : String(key == null ? '' : key);
    if (!t || t === '/' || t === '各' || t === '删除' || t === '空格') return v + t;
    const isAmt = /^\d+$/.test(t);
    if (!isAmt) return v + t;
    if (!v) return t;
    if (/[\/各]$/.test(v)) return v + t;
    if (/\d$/.test(v)) return v + t;
    return v + '/' + t;
  }

  function applyAllinToInput() {
    const $in = $('#chatInput');
    const v = $in.val().trim();
    if (!v) {
      App.toast('请先输入玩法，再点梭哈');
      return false;
    }
    const plays = expandPlaysForAllin(v);
    if (!plays || !plays.length) {
      App.toast('玩法无效，请检查后再点梭哈');
      return false;
    }
    const lines = resolveBetAmounts(plays, '梭哈');
    if (!lines) {
      App.toast('余额不足，无法梭哈');
      return false;
    }
    const per = plays.length === 1
      ? lines[0].amount
      : Math.floor(App.getBalance(user.uid) / plays.length);
    /* 保持口语紧凑写法，发送时再拆复式/连码 */
    let compact = normalizeChatBetText(v)
      .replace(/\/(\d+|梭哈|全下|allin)$/i, '')
      .replace(/各\d+$/, '');
    if (/复式|[二三四五]有|连|[不]?中|特串|肖|尾|各/.test(v) && !/^特码/.test(compact) && !/^\d/.test(compact)) {
      if (!/各$/.test(compact)) compact += '各';
      $in.val(compact + per);
    } else {
      $in.val(joinPlayAmount(compact, per));
    }
    composerAllin = true;
    updateComposerAction();
    App.toast('梭哈已均分 · ' + plays.length + '注 · 每注约' + per);
    return true;
  }

  function ballHtml(n, cls, eager) {
    const c = cls ? ' ' + cls : '';
    const num = String(n).padStart(2, '0');
    const loading = eager ? 'eager' : 'lazy';
    return `<img class="lhc-ball-img${c}" src="./assets/balls/ball_${num}.png" alt="${n}" loading="${loading}">`;
  }
  /** 球号 + 生肖（历史表 / 开奖条） */
  function ballZodiacHtml(n, cls, eager) {
    return `<span class="ball-wrap">${ballHtml(n, cls, eager)}<span class="zx">${zodiacOf(n)}</span></span>`;
  }
  /** 特码属性：总和 / 大小单双 / 波色 */
  function temaMeta(nums) {
    const sp = nums[6];
    const sum = nums.reduce((a, b) => a + b, 0);
    const size = sp >= 25 ? '大' : '小';
    const oe = sp % 2 ? '单' : '双';
    const wave = waveColor(sp);
    const side = `${size}${oe}`;
    return {
      sum,
      size,
      oe,
      side,
      wave,
      zodiac: zodiacOf(sp),
      text: `${sum} ${side} ${wave}`,
    };
  }
  /** 期号单行完整显示 */
  function setIssueEl($el, issue) {
    const full = String(issue || '—');
    $el.attr('title', full).text(full);
  }
  /** 顶栏当前期（tick 依赖；缺失会抛错导致倒计时永久停在「同步中」） */
  function setCurIssueDisplay(issue) {
    setIssueEl($('#curIssue'), issue);
  }
  function gyMeta(nums) {
    return temaMeta(nums);
  }
  function lhRow(nums) {
    return temaMeta(nums).wave;
  }
  function waveClass(wave) {
    if (wave === '红') return 'is-red';
    if (wave === '蓝') return 'is-blue';
    return 'is-green';
  }
  let lastDrawBarKey = '';
  function renderDrawBar(row) {
    if (!row) return;
    const key = String(row.issue || '') + '|' + (row.nums || []).join(',');
    /* 快照轮询勿整段重绘球图，否则 lazy 重载会一闪一闪 */
    if (key === lastDrawBarKey) return;
    lastDrawBarKey = key;
    const meta = temaMeta(row.nums);
    setIssueEl($('#barIssue'), row.issue);
    $('#barBalls').html(row.nums.map(n => ballZodiacHtml(n, 'xs', true)).join(''));
    $('#barGy').text(`${meta.sum} ${meta.side}`);
  }
  function renderDrawTable() {
    $('#drawTableBody').html(historyRows.slice(0, HISTORY_SHOW).map(r => {
      const meta = temaMeta(r.nums);
      const balls = r.nums.map(n =>
        `<td class="cell-ball">${ballZodiacHtml(n, 'tbl')}</td>`
      ).join('');
      return `<tr>
        <td class="cell-issue" title="${r.issue}">${r.issue}</td>
        ${balls}
        <td class="cell-sum">${meta.sum}</td>
        <td class="cell-side">${meta.side}</td>
      </tr>`;
    }).join(''));
  }
  function resultCardHtml(nums, issue, opts) {
    opts = opts || {};
    if (window.LhcResultCard && typeof LhcResultCard.build === 'function') {
      return LhcResultCard.build(nums, issue, opts);
    }
    const meta = temaMeta(nums);
    const full = String(issue || '');
    return `<div class="lhc-result-card"><div class="lhc-result-card__head"><span class="lhc-result-card__title">幸运六合彩</span></div>
      <div class="lhc-result-card__foot is-show">
        <div class="lhc-result-stat"><span class="k">期号</span><span class="v is-issue" title="${full}">${full}</span></div>
        <div class="lhc-result-stat"><span class="k">总和</span><span class="v">${meta.sum}</span></div>
        <div class="lhc-result-stat"><span class="k">两面</span><span class="v">${meta.side}</span></div>
      </div></div>`;
  }

  /** 白框开奖动画时长（摇珠 + 七球出号） */
  function resultRevealDurationMs() {
    if (window.LhcResultCard && typeof LhcResultCard.revealDurationMs === 'function') {
      return LhcResultCard.revealDurationMs();
    }
    return 2000 + 480 * 7 + 900;
  }

  function payoutResult(amount, odds, hitLabel) {
    const winAmount = Math.round(amount * odds * 100) / 100;
    return { winAmount, profit: winAmount - amount, hit: hitLabel || '' };
  }
  function settleComboGroup(combos, amount, judgeFn) {
    // 复式/拖头：每组一注，金额按单注计（对齐 123.com 拆注）
    let winAmount = 0;
    let stake = 0;
    let hits = 0;
    combos.forEach(c => {
      stake += amount;
      const r = judgeFn(c);
      if (r.tie) { winAmount += amount; return; }
      if (r.win) {
        hits += 1;
        winAmount += Math.round(amount * r.odds * 100) / 100;
      }
    });
    return {
      winAmount,
      profit: winAmount - stake,
      hit: hits ? `${hits}组` : '',
    };
  }

  /** 本地展示结算仅用于聊天统计；与服务端一致：两面等特码49和局退本。 */
  function settleBet(play, amount, nums) {
    const p = parsePlay(play);
    if (!p) return { winAmount: 0, profit: -amount, hit: '' };
    const sp = nums[6];
    const mains = nums.slice(0, 6);
    const all = nums.slice();
    const zhengSet = new Set(mains);
    const sxSet = new Set(all.map(zodiacOf));
    const wsSet = new Set(all.map(n => n % 10));
    let win = false;
    let odds = p.odds;
    let tie = false;

    switch (p.type) {
      case 'tema':
        win = sp === p.num;
        break;
      case 'zhengma':
        win = zhengSet.has(p.num);
        break;
      case 'temaSide':
        if (sp === 49) { tie = true; break; }
        win = matchSide(p.side, sideOfTema(sp));
        break;
      case 'temaCombo': {
        if (sp === 49) { tie = true; break; }
        const meta = sideOfTema(sp);
        win = !!( {
          大单: meta.big && meta.odd,
          大双: meta.big && !meta.odd,
          小单: !meta.big && meta.odd,
          小双: !meta.big && !meta.odd,
        }[p.combo]);
        break;
      }
      case 'heSide': {
        if (sp === 49) { tie = true; break; }
        const hs = digitSum(sp);
        win = matchSide(p.side, { big: hs >= 7, odd: hs % 2 === 1 });
        break;
      }
      case 'weiSide': {
        if (sp === 49) { tie = true; break; }
        const w = sp % 10;
        win = p.side === '大' ? w >= 5 : w <= 4;
        break;
      }
      case 'color':
        // 色波：49 仍结算（绿），不和
        win = waveColor(sp) === p.color;
        break;
      case 'colorHalf':
      case 'colorHalfHalf': {
        if (sp === 49) { tie = true; break; }
        const c = p.spec[0];
        const rest = p.spec.slice(1);
        const big = sp >= 25;
        const odd = sp % 2 === 1;
        if (waveColor(sp) !== c) { win = false; break; }
        win = !!( {
          大: big, 小: !big, 单: odd, 双: !odd,
          大单: big && odd, 大双: big && !odd, 小单: !big && odd, 小双: !big && !odd,
        }[rest]);
        break;
      }
      case 'sumSide': {
        const s = mains.reduce((a, b) => a + b, 0);
        win = matchSide(p.side, { big: s >= 150, odd: s % 2 === 1 });
        break;
      }
      case 'sumTail': {
        const s = mains.reduce((a, b) => a + b, 0) % 10;
        win = p.side === '大' ? s >= 5 : s <= 4;
        break;
      }
      case 'weiShu':
        // 总数项·尾数（含平特尾）：七码任一含该尾
        win = wsSet.has(p.tail);
        break;
      case 'weiShuMiss':
        win = !wsSet.has(p.tail);
        break;
      case 'temaZodiac':
        // 特肖：49 正常比生肖，不和
        win = zodiacOf(sp) === p.z;
        odds = zodiacOdds(p.z);
        break;
      case 'pingZodiac':
        // 一肖：七码任一肖
        win = sxSet.has(p.z);
        odds = pingTeOdds(p.z);
        break;
      case 'lianma': {
        const need = lianmaNeedOf(p.play);
        // 提交已拆成单注时 nums.length===need；聊天整串复式/拖头仍按 mode 展开
        const combos = expandByMode(p.mode || '复式', p.nums, need);
        return settleComboGroup(combos, amount, (balls) => {
          const hitZ = balls.filter(n => zhengSet.has(n)).length;
          const hitT = balls.filter(n => n === sp).length;
          if (p.play === '四全中') return { win: hitZ >= 4, odds: ODDS.siQuanZhong };
          if (p.play === '三全中') return { win: hitZ > 2, odds: ODDS.sanQuanZhong };
          if (p.play === '三中二') {
            if (hitZ === 3) return { win: true, odds: ODDS.sanZhongSan };
            if (hitZ === 2) return { win: true, odds: ODDS.sanZhongEr };
            return { win: false, odds: 0 };
          }
          if (p.play === '二全中') return { win: hitZ > 1, odds: ODDS.erQuanZhong };
          if (p.play === '二中特') {
            if (hitZ > 0 && hitT > 0) return { win: true, odds: ODDS.erZhongTeTe };
            if (hitZ > 1 && hitT === 0) return { win: true, odds: ODDS.erZhongTe };
            return { win: false, odds: 0 };
          }
          if (p.play === '特串') return { win: hitZ > 0 && hitT === 1, odds: ODDS.teChuan };
          return { win: false, odds: 0 };
        });
      }
      case 'zhengTe':
        win = mains[p.pos - 1] === p.num;
        odds = ODDS.zhengTe;
        break;
      case 'zhengSide': {
        const n = mains[p.pos - 1];
        if (n === 49) { tie = true; break; }
        win = matchSide(p.side, sideOfTema(n));
        odds = ODDS.zhengSide;
        break;
      }
      case 'zhengCombo': {
        const n = mains[p.pos - 1];
        if (n === 49) { tie = true; break; }
        const meta = sideOfTema(n);
        win = !!( {
          大单: meta.big && meta.odd,
          大双: meta.big && !meta.odd,
          小单: !meta.big && meta.odd,
          小双: !meta.big && !meta.odd,
        }[p.combo]);
        odds = ODDS.zhengCombo;
        break;
      }
      case 'zhengHe': {
        const n = mains[p.pos - 1];
        if (n === 49) { tie = true; break; }
        const hs = digitSum(n);
        win = matchSide(p.side, { big: hs >= 7, odd: hs % 2 === 1 });
        odds = ODDS.zhengHe;
        break;
      }
      case 'zhengWei': {
        const n = mains[p.pos - 1];
        if (n === 49) { tie = true; break; }
        const w = n % 10;
        win = p.side === '大' ? w >= 5 : w <= 4;
        odds = p.side === '小' ? ODDS.zhengWeiSmall : ODDS.zhengWei;
        break;
      }
      case 'zhengColor': {
        const n = mains[p.pos - 1];
        win = waveColor(n) === p.color;
        odds = colorOdds(p.color);
        break;
      }
      case 'temaTou': {
        win = Math.floor(sp / 10) === p.head;
        odds = p.head === 0 ? ODDS.temaTou0 : ODDS.temaTou;
        break;
      }
      case 'temaWeiNum': {
        win = (sp % 10) === p.tail;
        odds = p.tail === 0 ? ODDS.temaWei0 : ODDS.temaWei;
        break;
      }
      case 'wuxing':
        win = wuxingOf(sp) === p.wx;
        odds = wuxingOdds(p.wx);
        break;
      case 'sxLian': {
        const combos = expandByMode(p.mode || '复式', p.zodiacs, p.n);
        return settleComboGroup(combos, amount, (zs) => {
          const hit = zs.filter(z => sxSet.has(z)).length;
          if (p.hit) return { win: hit >= zs.length, odds: sxLianOdds(p.n, true, zs) };
          return { win: hit === 0, odds: sxLianOdds(p.n, false, zs) };
        });
      }
      case 'wsLian': {
        const combos = expandByMode(p.mode || '复式', p.tails, p.n);
        return settleComboGroup(combos, amount, (ts) => {
          const hit = ts.filter(x => wsSet.has(x)).length;
          if (p.hit) return { win: hit >= ts.length, odds: wsLianOdds(p.n, true, ts) };
          return { win: hit === 0, odds: wsLianOdds(p.n, false, ts) };
        });
      }
      case 'heXiao': {
        if (sp === 49) { tie = true; break; }
        win = (p.zodiacs || []).includes(zodiacOf(sp));
        odds = ODDS.heXiao[p.n] || odds;
        break;
      }
      case 'zhengXiao': {
        const count = mains.filter((n) => zodiacOf(n) === p.z).length;
        if (count <= 0) { win = false; break; }
        win = true;
        odds = (zhengXiaoOdds(p.z) || odds) * Math.min(count, 5);
        break;
      }
      case 'liuxiao': {
        // 六肖跟特码生肖，整组 1 注不拆；特码 49 与服务端一致退本（和）。
        if (sp === 49) return { winAmount: amount, profit: 0, hit: '和' };
        const zx = zodiacOf(sp);
        win = p.hit ? p.zodiacs.includes(zx) : !p.zodiacs.includes(zx);
        break;
      }
      case 'buZhong': {
        // 多组提交已拆成每组 n 个；整串复式仍 C(n,k)
        const combos = (p.mode === '多组' && p.nums.length === p.n)
          ? [p.nums.slice()]
          : expandFushi([...new Set(p.nums)].sort((a, b) => a - b), p.n);
        return settleComboGroup(combos, amount, (balls) => {
          const hit = balls.filter(n => all.includes(n)).length;
          return { win: hit === 0, odds: p.odds };
        });
      }
      default:
        win = false;
    }

    if (tie) return { winAmount: amount, profit: 0, hit: '和' };
    if (!win) return { winAmount: 0, profit: -amount, hit: '' };
    return payoutResult(amount, odds, play);
  }
  const HISTORY_SHOW = 10;

  function buildWinListVerifyText(issue, settled) {
    const winners = Object.keys(settled || {}).filter(function (name) {
      return (settled[name] || []).some(function (r) { return (Number(r.winAmount) || 0) > 0; });
    });
    if (!winners.length) {
      return issue + '期\n中奖核对\n——————————\n本期暂无中奖';
    }
    const blocks = winners.map(function (name) {
      const rows = settled[name] || [];
      const winRows = rows.filter(function (r) { return (Number(r.winAmount) || 0) > 0; });
      const totalWin = winRows.reduce(function (s, r) { return s + (Number(r.winAmount) || 0); }, 0);
      const totalProfit = rows.reduce(function (s, r) { return s + (Number(r.profit) || 0); }, 0);
      const hits = winRows.filter(function (r) { return r.hit; }).map(function (r) { return r.hit; });
      return name + '  中奖金额：+' + fmtMoney2(totalWin) + '\n' + hits.join('、') + '\n输赢：' + fmtProfit(totalProfit);
    });
    return issue + '期\n中奖核对\n——————————\n' + blocks.join('\n\n');
  }

  function closeNoticeHtml(issue) {
    return '<div class="lhc-bot-close-line"><div class="lhc-bot-close-line__bar"><span class="lhc-bot-close-line__deco"></span><span class="lhc-bot-close-line__text">封 盘 线</span><span class="lhc-bot-close-line__deco"></span></div><div class="lhc-bot-close-line__sub">第 <span class="lhc-bot-close-line__issue">' + issue + '</span> 期 · 停止下注 · 即将开奖</div></div>';
  }
  function openNoticeHtml(issue) {
    return `<div class="lhc-bot-open-line">
      <div class="lhc-bot-open-line__bar">
        <span class="lhc-bot-open-line__deco"></span>
        <span class="lhc-bot-open-line__text">开 盘 线</span>
        <span class="lhc-bot-open-line__deco"></span>
      </div>
      <div class="lhc-bot-open-line__sub">第 <span class="lhc-bot-open-line__issue">${issue}</span> 期 · 开始下注</div>
    </div>`;
  }

  function buildBetListVerifyFromServer(issue, list) {
    const scoped = App.filterLotteryBetsByIssue ? App.filterLotteryBetsByIssue(list, issue) : (Array.isArray(list) ? list : []);
    const bets = scoped.filter(function (b) { return b && b.status !== 'CANCELLED'; });
    if (!bets.length) {
      return '<div class="lhc-bot-card lhc-bot-card--bets"><div class="lhc-bot-card__head"><span class="lhc-bot-card__title">注单核对</span><span class="lhc-bot-card__issue">' + issue + '</span></div><div class="lhc-bot-empty">本期暂无下注</div></div>';
    }
    const total = bets.reduce(function (s, b) { return s + (Number(b.amount) || 0); }, 0);
    const groups = App.groupLotteryBetsByType ? App.groupLotteryBetsByType(bets) : [];
    const tags = groups.map(function (g) {
      return '<span class="lhc-bot-tag">' + g.label + '×' + g.count + '/' + fmtMoney2(g.amount) + '</span>';
    }).join('');
    const userBlock = '<div class="lhc-bot-user is-me"><div class="lhc-bot-user__head"><span class="lhc-bot-user__name">我</span><span class="lhc-bot-user__sum">' + fmtMoney2(total) + '</span></div><div class="lhc-bot-user__tags">' + tags + '</div></div>';
    return '<div class="lhc-bot-card lhc-bot-card--bets"><div class="lhc-bot-card__head"><span class="lhc-bot-card__title">注单核对</span><span class="lhc-bot-card__issue">' + issue + '</span></div><div class="lhc-bot-card__body is-full">' + userBlock + '</div></div>';
  }

  function buildMineLineHtmlFromServer(issue, list) {
    const scoped = App.filterLotteryBetsByIssue ? App.filterLotteryBetsByIssue(list, issue) : (Array.isArray(list) ? list : []);
    const bets = scoped.filter(function (b) { return b && b.status !== 'CANCELLED' && b.status !== 'PENDING'; });
    if (!bets.length) return '';
    const stake = bets.reduce(function (sum, b) { return sum + (Number(b.amount) || 0); }, 0);
    const myProfit = bets.reduce(function (sum, b) { return sum + serverBetProfit(b); }, 0);
    const myWin = bets.reduce(function (sum, b) { return sum + (Number(b.payout) || 0); }, 0);
    const profitCls = myProfit >= 0 ? 'pos' : 'neg';
    /* 六肖特码49等：服务端退本 payout=本金、profit=0，勿显示「中奖」 */
    let winText = '未中奖';
    if (myProfit === 0 && myWin > 0 && myWin === stake) winText = '和·退本 ' + fmtMoney2(myWin);
    else if (myWin > 0) winText = '中奖 +' + fmtMoney2(myWin);
    return '<div class="lhc-bot-mine-line ' + profitCls + '">' +
      '<span class="lhc-bot-mine-line__label">您本期</span>' +
      '<span class="lhc-bot-mine-line__win">' + winText + '</span>' +
      '<span class="lhc-bot-mine-line__profit">输赢 ' + fmtProfit(myProfit) + '</span>' +
      '</div>';
  }
  function applyMineLineToWinHtml(html, mineHtml) {
    if (!mineHtml) return html;
    const re = /<div class="lhc-bot-mine-line[\s\S]*?<\/div>/;
    if (re.test(html)) return html.replace(re, mineHtml);
    return html.replace(/<\/div>\s*$/, mineHtml + '</div>');
  }

  function buildBetListVerifyHtml(issue) {
    const book = issueBetBook[issue];
    if (!book || !Object.keys(book).length) {
      return '<div class="lhc-bot-card lhc-bot-card--bets"><div class="lhc-bot-card__head"><span class="lhc-bot-card__title">注单核对</span><span class="lhc-bot-card__issue">' + issue + '</span></div><div class="lhc-bot-empty">本期暂无下注</div></div>';
    }
    const names = Object.keys(book);
    const users = names.map(function (name) {
      const bets = book[name];
      const total = bets.reduce(function (s, b) { return s + b.amount; }, 0);
      const tags = bets.map(function (b) { return '<span class="lhc-bot-tag">' + b.play + '/' + fmtMoney2(b.amount) + '</span>'; }).join('');
      return '<div class="lhc-bot-user' + (name === user.name ? ' is-me' : '') + '"><div class="lhc-bot-user__head"><span class="lhc-bot-user__name">' + name + '</span><span class="lhc-bot-user__sum">' + fmtMoney2(total) + '</span></div><div class="lhc-bot-user__tags">' + tags + '</div></div>';
    }).join('');
    return '<div class="lhc-bot-card lhc-bot-card--bets"><div class="lhc-bot-card__head"><span class="lhc-bot-card__title">注单核对</span><span class="lhc-bot-card__issue">' + issue + '</span></div><div class="lhc-bot-card__body is-full">' + users + '</div></div>';
  }

  function buildWinListVerifyHtml(issue, settled) {
    const pending = settled == null;
    if (pending) {
      return '<div class="lhc-bot-card lhc-bot-card--win is-calculating"><div class="lhc-bot-card__head"><span class="lhc-bot-card__title">中奖核对</span><span class="lhc-bot-card__issue">' + issue + '</span></div><div class="lhc-bot-card__body is-full"><div class="lhc-bot-calc-line"><span class="lhc-bot-calc-line__icon" aria-hidden="true"></span><span class="lhc-bot-calc-line__text">正在核对中奖注单</span></div></div></div>';
    }
    const winners = Object.keys(settled || {}).filter(function (n) { return settled[n].some(function (r) { return r.winAmount > 0; }); });
    let body = winners.length ? winners.map(function (name) {
      const winRows = settled[name].filter(function (r) { return r.winAmount > 0; });
      const totalProfit = settled[name].reduce(function (s, r) { return s + r.profit; }, 0);
      const tags = winRows.map(function (r) { return '<span class="lhc-bot-tag lhc-bot-tag--win">' + r.play + '/' + r.amount + '</span>'; }).join('');
      return '<div class="lhc-bot-user"><div class="lhc-bot-user__head"><span class="lhc-bot-user__name">' + name + '</span><span class="lhc-bot-user__profit ' + (totalProfit >= 0 ? 'pos' : 'neg') + '">' + fmtProfit(totalProfit) + '</span></div><div class="lhc-bot-user__tags">' + tags + '</div></div>';
    }).join('') : '<div class="lhc-bot-empty">本期暂无中奖</div>';
    let mine = '';
    const myRows = settled && settled[user.name];
    if (myRows && myRows.length) {
      const myProfit = myRows.reduce(function (s, r) { return s + r.profit; }, 0);
      const myWin = myRows.reduce(function (s, r) { return s + r.winAmount; }, 0);
      const profitCls = myProfit >= 0 ? 'pos' : 'neg';
      const winText = myWin > 0 ? ('中奖 +' + fmtMoney2(myWin)) : '未中奖';
      mine = '<div class="lhc-bot-mine-line ' + profitCls + '"><span class="lhc-bot-mine-line__label">您本期</span><span class="lhc-bot-mine-line__win">' + winText + '</span><span class="lhc-bot-mine-line__profit">输赢 ' + fmtProfit(myProfit) + '</span></div>';
    }
    return '<div class="lhc-bot-card lhc-bot-card--win"><div class="lhc-bot-card__head"><span class="lhc-bot-card__title">中奖核对</span><span class="lhc-bot-card__issue">' + issue + '</span></div><div class="lhc-bot-card__body is-full">' + body + '</div>' + mine + '</div>';
  }

  /** 用服务端派彩校正顶部输赢/流水（按期号去重后直接累加） */
  function refineUserStatsFromServer(issue, list) {
    const id = String(issue || '');
    if (!id) return;
    const bets = (list || []).filter(function (b) { return b && b.status !== 'CANCELLED' && b.status !== 'PENDING'; });
    if (!bets.length) return;
    const storeKey = 'lhc_stats_applied_' + (user && user.uid ? user.uid : 'guest');
    let applied = [];
    try { applied = JSON.parse(localStorage.getItem(storeKey) || '[]'); } catch (e) { applied = []; }
    if (!Array.isArray(applied)) applied = [];
    if (applied.indexOf(id) >= 0) return;
    applied.push(id);
    if (applied.length > 120) applied = applied.slice(-120);
    try { localStorage.setItem(storeKey, JSON.stringify(applied)); } catch (e) { /* ignore */ }
    const serverProfit = bets.reduce(function (s, b) { return s + serverBetProfit(b); }, 0);
    const serverTurnover = bets.reduce(function (s, b) { return s + (Number(b.amount) || 0); }, 0);
    const stats = getStats(user.uid);
    stats.winloss += serverProfit;
    stats.turnover += serverTurnover;
    stats.rebate = (stats.rebate || 0) + ((window.App && App.calcRebate) ? App.calcRebate(serverTurnover) : 0);
    saveStats(user.uid, stats);
    refreshStats();
  }

  function shanghaiYmdParts(date) {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Shanghai',
      year: 'numeric', month: '2-digit', day: '2-digit',
    }).formatToParts(date || new Date());
    const get = function (t) {
      const hit = parts.find(function (p) { return p.type === t; });
      return hit ? hit.value : '01';
    };
    return { y: get('year'), m: get('month'), d: get('day') };
  }
  function todayStartMs() {
    const p = shanghaiYmdParts(new Date());
    return Date.parse(p.y + '-' + p.m + '-' + p.d + 'T00:00:00+08:00');
  }
  function pad(n, w) { return String(n).padStart(w, '0'); }
  function dateKey(d) {
    const p = shanghaiYmdParts(d || new Date());
    return '' + p.m + p.d;
  }
  /** 与服务端 genIssueNo 一致：MMDD + 6 位当日序号 */
  function fmtIssue8(seq) {
    return dateKey() + pad(Math.max(1, seq), 6);
  }
  function fmtIssue(seq) { return fmtIssue8(seq); }
  function fmtTime(d) {
    return pad(d.getHours(), 2) + ':' + pad(d.getMinutes(), 2) + ':' + pad(d.getSeconds(), 2);
  }
  function fmtMmss(sec) {
    const s = Math.max(0, Math.ceil(sec));
    return pad(Math.floor(s / 60), 2) + ':' + pad(s % 60, 2);
  }

  function renderCountdownDigits(sec) {
    const s = Math.max(0, Math.ceil(sec));
    const mm = pad(Math.floor(s / 60), 2);
    const ss = pad(s % 60, 2);
    const cells = $('#cdDigits .lhc-timer__cell');
    if (cells.length >= 4) {
      cells.eq(0).text(mm[0]);
      cells.eq(1).text(mm[1]);
      cells.eq(2).text(ss[0]);
      cells.eq(3).text(ss[1]);
    }
  }

    function updateCountdownUI(r) {
    /* 只保留：距封盘；封盘后 → 开奖中（不再显示距开奖） */
    const remainToOpen = Math.max(0, Number(r) || 0);
    const betRemain = remainToOpen - PREP_SEC;
    const displaySec = Math.max(0, Math.ceil(betRemain));
    if (remainToOpen <= PREP_SEC || displaySec <= 0) {
      updateCountdownDrawing();
      return;
    }
    const $box = $('#countdownBox').removeClass('is-freeze is-preparing is-betting is-urgent is-drawing').addClass('is-betting');
    if (displaySec <= 5) $box.addClass('is-urgent');
    const $label = $('#cdLabel');
    if ($label.length) $label.text('距封盘');
    $box.attr('aria-label', '距封盘 ' + fmtMmss(displaySec));
    $('#cdDigits').removeAttr('hidden').css('display', '').show().attr('aria-label', $box.attr('aria-label'));
    $('#cdPrep').prop('hidden', true);
    renderCountdownDigits(displaySec);
  }

  function getStats(uid) {
    const key = 'lhc_stats_' + uid;
    let s = null;
    try { s = JSON.parse(localStorage.getItem(key)); } catch (e) { /* */ }
    return s || { turnover: 0, winloss: 0, rebate: 0 };
  }
  function saveStats(uid, s) {
    localStorage.setItem('lhc_stats_' + uid, JSON.stringify(s));
  }
  function refreshStats() {
    const bal = App.getBalance(user.uid);
    const s = getStats(user.uid);
    $('#statBalance').text(bal.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
    $('#statTurnover').text((Math.round(s.turnover * 100) / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
    const $wl = $('#statWinloss').text((s.winloss >= 0 ? '+' : '') + (Math.round(s.winloss * 100) / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
    $wl.toggleClass('is-plus', s.winloss > 0).toggleClass('is-minus', s.winloss < 0);
    $('#statRebate').text((Math.round(s.rebate * 100) / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
    $('#playFootBalance').text(bal.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
    /* play sheet 变量在文件后部初始化；早期 refreshStats 需吞掉 TDZ */
    if (typeof syncPlayFootTotals === 'function') {
      try { syncPlayFootTotals(); } catch (_) { /* not ready */ }
    }
  }
  function scrollChat() {
    /* 揭晓期间只暂停自动滚（停留），不钉死；用户手滑后 room-chat 会解除 */
    if (roomChat && roomChat.isAutoScrollPaused && roomChat.isAutoScrollPaused()) return;
    const el = document.getElementById('chatFeed');
    if (el) el.scrollTop = el.scrollHeight;
  }

  const CHAT_KEEP = 50;
  const chatLog = [];

  function chatStorageKey() {
    const uid = (user && user.uid) ? user.uid : 'guest';
    return 'lhc_chat_v3_' + uid + (roomNo ? '_' + roomNo : '');
  }
  function saveChatLog() {
    try {
      localStorage.setItem(chatStorageKey(), JSON.stringify(chatLog.slice(-CHAT_KEEP)));
    } catch (e) { /* quota / private mode */ }
  }
  function trimChatDom() {
    const $msgs = $('#chatFeed > .lhc-msg');
    const extra = $msgs.length - CHAT_KEEP;
    if (extra > 0) $msgs.slice(0, extra).remove();
  }
  function escapeHtml(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, function (ch) {
      return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch];
    });
  }
  /** 开奖卡动画结束后，把最终 HTML 写回日志，刷新后才能完整还原 */
  function finalizeResultCardInLog(cardEl) {
    const bubble = cardEl && cardEl.closest && cardEl.closest('.lhc-msg__bubble');
    if (!bubble) return;
    for (let i = chatLog.length - 1; i >= 0; i--) {
      if (chatLog[i].html && String(chatLog[i].html).indexOf('lhc-result-card') >= 0) {
        chatLog[i].html = bubble.innerHTML;
        saveChatLog();
        break;
      }
    }
  }
  function appendMsg(opts) {
    const time = opts.time || fmtTime(new Date());
    const isSelf = opts.self;
    const isRobot = opts.robot;
    const avatar = `<div class="lhc-msg__avatar"><img src="${fixAvatar(opts.avatar)}" alt="" onerror="this.onerror=null;this.src='/images/avatars/001.jpg'"></div>`;
    const meta = `<div class="lhc-msg__meta">
            <span class="lhc-msg__name">${escapeHtml(opts.name)}</span>
            <span class="lhc-msg__time">${escapeHtml(time)}</span>
          </div>`;
    const bubbleCls = isRobot ? ' lhc-msg__bubble--bot' : '';
    const bubble = `<div class="lhc-msg__bubble${bubbleCls}">${opts.html}</div>`;
    const html = isSelf
      ? `<div class="lhc-msg is-self">
        <div class="lhc-msg__top">${meta}${avatar}</div>
        ${bubble}
      </div>`
      : `<div class="lhc-msg${isRobot ? ' is-robot' : ''}">
        ${avatar}
        <div class="lhc-msg__body">
          ${meta}
          ${bubble}
        </div>
      </div>`;
    if (opts.dock) {
      const $dock = $('#chatDock');
      if ($dock.length) { $dock.prop('hidden', false).append(html); }
      else $('#chatFeed').append(html);
    } else {
      $('#chatFeed').append(html);
    }
    if (!opts.skipPersist) {
      chatLog.push({
        name: opts.name,
        avatar: opts.avatar || '',
        html: opts.html,
        self: !!isSelf,
        robot: !!isRobot,
        time,
      });
      if (chatLog.length > CHAT_KEEP) chatLog.splice(0, chatLog.length - CHAT_KEEP);
      trimChatDom();
      saveChatLog();
    }
    scrollChat();
  }
  function restoreChat() {
    let list = [];
    try {
      list = JSON.parse(localStorage.getItem(chatStorageKey()) || '[]');
    } catch (e) {
      list = [];
    }
    if (!Array.isArray(list) || !list.length) return false;
    chatLog.length = 0;
    $('#chatFeed').empty();
    list.slice(-CHAT_KEEP).forEach((m) => {
      if (!m || !m.html) return;
      let html = m.html;
      /* 本地恢复也先保持黑卡/进行中，禁止把 drawing 强改成 reveal 泄底 */
      if (String(html).indexOf('lhc-video-card') >= 0 || String(html).indexOf('lhc-result-card') >= 0) {
        html = String(html)
          .replace(/\bis-reveal\b/g, 'is-drawing')
          .replace(/\bis-result-shown\b/g, 'is-drawing')
          .replace(/\bis-settled\b/g, 'is-drawing')
          .replace(/settle=1/g, 'hold=1')
          .replace(/\bis-show\b/g, 'is-hidden');
      }
      appendMsg({
        name: m.name || '玩家',
        avatar: m.avatar || '',
        html,
        self: !!m.self,
        robot: !!m.robot,
        time: m.time || '',
        skipPersist: true,
      });
      chatLog.push({
        name: m.name || '玩家',
        avatar: m.avatar || '',
        html,
        self: !!m.self,
        robot: !!m.robot,
        time: m.time || '',
      });
    });
    saveChatLog();
    scrollChat();
    return chatLog.length > 0;
  }

  /* ========== 房间公共聊天（服务端时间线 · 共享内核） ========== */
  function applyRoomWinVerifyMineLine(issue) {
    issue = String(issue || '').trim();
    if (!App.fetchMyLotteryBets) return;
    App.fetchMyLotteryBets(SERVER_GAME, issue).then(function (res) {
      const list = (res && res.list) || [];
      /* 派彩已入账：立刻拉余额，避免顶栏积分仍停在扣注后 */
      refreshAfterServerSettle();
      if (list.length && typeof refineUserStatsFromServer === 'function') refineUserStatsFromServer(issue, list);
      if (typeof buildMineLineHtmlFromServer !== 'function' || typeof applyMineLineToWinHtml !== 'function') return;
      const mine = buildMineLineHtmlFromServer(issue, list);
      if (!mine) return;
      const $card = $('#chatFeed').find('.' + "lhc" + '-bot-card--win').filter(function () {
        return String($(this).find('.' + "lhc" + '-bot-card__issue').text() || '').trim() === issue;
      }).last().closest('[class*="-msg"]');
      if (!$card.length) return;
      const $bubble = $card.find('[class*="msg__bubble"]').first();
      let h = $bubble.html() || '';
      h = applyMineLineToWinHtml(h, mine);
      $bubble.html(h);
    }).catch(function () {});
  }

  function buildBetVerifyFromPayload(p) {
    return LotteryRoomChat.buildBetVerifyHtml("lhc", p, {
      escapeHtml: typeof escapeHtml === 'function' ? escapeHtml : undefined,
      userName: user.name,
    });
  }

  function buildWinVerifyFromPayload(p) {
    return LotteryRoomChat.buildWinVerifyHtml("lhc", p, {
      escapeHtml: typeof escapeHtml === 'function' ? escapeHtml : undefined,
      fmtProfit: typeof fmtProfit === 'function' ? fmtProfit : undefined,
    });
  }

  function hasResultAnimated(issue) {
    issue = String(issue || '').trim();
    if (!issue) return false;
    if (typeof isServerDrawingIssue === 'function' && isServerDrawingIssue(issue)) return false;
    return playedAnimIssues.has(issue);
  }
  function markResultAnimated(issue) {
    issue = String(issue || '').trim();
    if (!issue) return;
    playedAnimIssues.add(issue);
    try {
      localStorage.setItem(PLAYED_ANIM_STORAGE_KEY, JSON.stringify(Array.from(playedAnimIssues).slice(-120)));
    } catch (e) { /* ignore */ }
  }
  function forceSettleResultCard(issue) {
    issue = String(issue || '').trim();
    $('#chatFeed .lhc-video-card, #chatDock .lhc-video-card, #chatFeed .lhc-result-card, #chatDock .lhc-result-card').each(function () {
      const card = this;
      if (issue && String(card.getAttribute('data-issue') || '').trim() !== issue) return;
      /* 摇珠/尾段仍在播：勿掐动画，只保证脚注；仪式在 onDone 再推进 */
      if (card.classList.contains('is-playing') || card.getAttribute('data-playing') === '1') {
        if (window.LhcResultCard && typeof LhcResultCard.revealFoot === 'function') {
          LhcResultCard.revealFoot(card);
        }
        card._holdBlackExempt = true;
        return;
      }
      card.classList.remove('is-playing');
      card.removeAttribute('data-playing');
      let nums = null;
      const raw = String(card.getAttribute('data-nums') || '').trim();
      if (raw) {
        const arr = raw.split(',').map(Number);
        if (arr.length === 7) nums = arr;
      }
      if (nums && window.LhcResultCard && typeof LhcResultCard.settle === 'function') {
        LhcResultCard.settle(card, nums);
        card._holdBlackExempt = true;
      }
    });
  }
  /** 服务端仍封盘/开奖中：该期结果卡不可泄底 */
  function isServerDrawingIssue(issue) {
    issue = String(issue || '').trim();
    if (!issue || !serverCurrent) return false;
    if (String(serverCurrent.issueNo || '') !== issue) return false;
    const st = String(serverCurrent.status || '');
    const lockAt = new Date(serverCurrent.lockAt).getTime();
    const now = srvNow();
    return st === 'LOCKED' || (st === 'PENDING' && Number.isFinite(lockAt) && now >= lockAt);
  }

  function parseCardNums7(card) {
    const raw = String((card && card.getAttribute('data-nums')) || '').trim();
    if (!raw) return null;
    const arr = raw.split(/[,\s]+/).map(Number).filter(function (n) { return n >= 1 && n <= 49; });
    return arr.length === 7 ? arr : null;
  }
  /** 刷新/重进：开奖中压黑幕，避免泄底 */
  function holdBlackLockedResultCards() {
    if (!serverCurrent) return;
    const issue = String(serverCurrent.issueNo || '').trim();
    if (!issue || !isServerDrawingIssue(issue)) return;
    let newlyHeld = false;
    $('#chatFeed .lhc-video-card, #chatDock .lhc-video-card').each(function () {
      const card = this;
      if (String(card.getAttribute('data-issue') || '').trim() !== issue) return;
      if (window.LhcResultCard && typeof LhcResultCard.holdBlack === 'function') {
        if (LhcResultCard.holdBlack(card)) newlyHeld = true;
      }
    });
    if (!newlyHeld || !roomChat) return;
    /* 仪式已过揭晓/已在等开盘：勿重置 revealDone/winFlushed */
    if (roomChat.isRevealReady && roomChat.isRevealReady(issue)) return;
    if (typeof roomChat.getPhase === 'function' && roomChat.getPhase() === 'settled') return;
    if (typeof roomChat.beginCeremonyHold === 'function') roomChat.beginCeremonyHold(issue);
    if (typeof roomChat.setRevealPending === 'function') roomChat.setRevealPending(issue);
    const openAt = new Date(serverCurrent.openAt).getTime();
    const readyMs = (typeof resultRevealDurationMs === 'function' ? resultRevealDurationMs() : 8000) + 1400;
    const remain = Number.isFinite(openAt)
      ? Math.max(1200, openAt - srvNow() + 600)
      : readyMs;
    if (typeof roomChat.scheduleRevealReady === 'function') {
      roomChat.scheduleRevealReady(issue, Math.min(remain, readyMs + 400));
    }
  }

  function settleRestoredResultCards() {
    const holdIssue = (roomChat && typeof roomChat.getCeremonyHoldIssue === 'function')
      ? String(roomChat.getCeremonyHoldIssue() || '').trim()
      : '';
    const phaseIssue = (roomChat && typeof roomChat.getPhaseIssue === 'function')
      ? String(roomChat.getPhaseIssue() || '').trim()
      : '';
    $('#chatFeed .lhc-video-card, #chatFeed .lhc-result-card').each(function () {
      const card = this;
      if (card.classList.contains('is-playing') || card.getAttribute('data-playing') === '1') return;
      const issue = String(card.getAttribute('data-issue') || '').trim();
      if (issue && isServerDrawingIssue(issue)) return;
      if (issue && ((holdIssue && issue === holdIssue) || (phaseIssue && issue === phaseIssue))) {
        if (isCeremonyHolding()) return;
      }
      let nums = null;
      const raw = String(card.getAttribute('data-nums') || '').trim();
      if (raw) {
        const arr = raw.split(',').map(Number);
        if (arr.length === 7) nums = arr;
      }
      if (!nums && issue) {
        const row = historyRows.find(function (r) { return String(r.issue) === issue; });
        if (row && row.nums && row.nums.length === 7) nums = row.nums;
      }
      if (!nums || !window.LhcResultCard || !LhcResultCard.settle) return;
      LhcResultCard.settle(card, nums);
    });
  }

  /* let 而非 const：settleRestored 可能在赋值前被调用，避免 TDZ 整页崩 */
  let roomChat = null;
  roomChat = LotteryRoomChat.create({
    gameCode: SERVER_GAME,
    appendMsg: appendMsg,
    clearFeed: function () {
      $('#chatFeed').empty();
      if (typeof chatLog !== 'undefined') chatLog.length = 0;
    },
    getUserName: function () { return user.name; },
    getUserId: function () { return user.id || ''; },
    robotFallbackName: (typeof ROBOT !== 'undefined' && ROBOT.name) ? ROBOT.name : '开奖员',
    fmtTime: typeof fmtTime === 'function' ? fmtTime : undefined,
    hasResultAnimated: hasResultAnimated,
    markResultAnimated: markResultAnimated,
    onRevealDeadline: forceSettleResultCard,
    buildBetHtml: function (p) {
      return (typeof escapeHtml === 'function') ? escapeHtml(String(p.text || '')) : String(p.text || '');
    },
    buildOpenHtml: function (issue) {
      return (typeof openNoticeHtml === 'function') ? openNoticeHtml(issue) : ('开盘 ' + issue);
    },
    buildCloseHtml: function (issue) {
      return (typeof closeNoticeHtml === 'function') ? closeNoticeHtml(issue) : ('封盘 ' + issue);
    },
    buildResultHtml: function (p, msg, ctx) {
      const nums = Array.isArray(p.nums) ? p.nums.map(Number) : [];
      const issue = String(p.issueNo || msg.issueNo || '');
      /*
       * 历史回放必须先黑卡：若先 settle 再等 snapshot 压黑，会「漏一下再变黑」。
       * 仅直播且不重播、且服务端已非开奖中，才直接终态。
       */
      const settle = !!(
        ctx &&
        ctx.live &&
        !ctx.animate &&
        !(typeof isServerDrawingIssue === 'function' && isServerDrawingIssue(issue))
      );
      if (typeof resultCardHtml === 'function') {
        return resultCardHtml(nums, issue, { settle: settle });
      }
      return '开奖 ' + issue;
    },
    buildBetVerifyHtml: function (p) { return buildBetVerifyFromPayload(p); },
    buildWinVerifyHtml: function (p) { return buildWinVerifyFromPayload(p); },
    buildWinVerifyCalculatingHtml: function (issue) {
      return buildWinListVerifyHtml(issue, null);
    },
    onClose: function (issue, p, msg, ctx) {
      sealedIssueNo = String(issue || '');
      closedIssues.add(sealedIssueNo);
      /* 仅直播封盘禁注；phase 由 room-chat 推进 */
      if (ctx && ctx.live === false) return;
      roomBetFrozen = true;
    },
    onResultMeta: function (p, msg) {
      const nums = Array.isArray(p.nums) ? p.nums.map(Number) : [];
      const issue = String(p.issueNo || msg.issueNo || '');
      if (issue) {
        revealedIssues.add(issue);
        saveRevealedIssues();
      }
      if (nums.length === 7) {
        lastDraw = nums.slice();
        if (issue) upsertHistoryHeadFromDraw(issue, nums);
      }
    },
    onNumbersRevealed: function (issue) {
      if (typeof paintDrawBarAfterReveal === 'function') paintDrawBarAfterReveal(issue);
    },
    onWinVerifyUnlocked: function () {
      /* 解冻只在开盘线刷出（onCeremonyComplete），仪式中禁止下注 */
    },
    onWinVerifyShown: function (issue) {
      applyRoomWinVerifyMineLine(issue);
    },
    onFlushWinVerify: function (issue, pending) {
      const html = buildWinVerifyFromPayload(pending);
      LotteryRoomChat.replaceCalculatingWinCard({
        prefix: "lhc",
        issue: issue,
        html: html,
        appendMsg: appendMsg,
        robotName: (typeof ROBOT !== 'undefined' && ROBOT.name) ? ROBOT.name : '开奖员',
      });
      applyRoomWinVerifyMineLine(issue);
    },
    onPhaseChange: function (phase) {
      if (phase === 'betting') {
        roomBetFrozen = false;
        sealedIssueNo = '';
        drawBarRevealIssue = '';
        drawCeremonyReadyIssue = '';
        if (typeof requestLotteryResync === 'function') requestLotteryResync();
        else if (typeof syncServerSnapshot === 'function') syncServerSnapshot();
        if (typeof tick === 'function') try { tick(); } catch (e) { /* ignore */ }
      } else if (phase === 'drawing' || phase === 'revealing' || phase === 'settled') {
        roomBetFrozen = true;
        if (typeof tick === 'function') try { tick(); } catch (e) { /* ignore */ }
      }
    },
    onCeremonyComplete: function () {
      roomBetFrozen = false;
      sealedIssueNo = '';
      /* 开盘线已出：立刻拉下一期快照，避免顶栏继续卡在上一期「开奖中」 */
      if (typeof requestLotteryResync === 'function') requestLotteryResync();
      else if (typeof syncServerSnapshot === 'function') syncServerSnapshot();
      if (typeof tick === 'function') try { tick(); } catch (e) { /* ignore */ }
    },

    afterResultAppended: function (ctx) {
      const nums = Array.isArray(ctx.payload.nums) ? ctx.payload.nums.map(Number) : [];
      const issue = ctx.issue;
      const card = $('#chatDock .lhc-video-card, #chatDock .lhc-result-card, #chatFeed .lhc-video-card, #chatFeed .lhc-result-card').last()[0];
      const readyMs = resultRevealDurationMs() + 800;
      if (card && window.LhcResultCard) {
        if (ctx.animate && ctx.live && LhcResultCard.bindReveal) {
          ctx.setRevealPending(issue);
          let started = false;
          const openAt = serverCurrent && String(serverCurrent.issueNo || '') === String(issue || '')
            ? new Date(serverCurrent.openAt).getTime()
            : NaN;
          /* scheduleRevealReady 改在 play 真正开播后武装（见 onStarted） */
          LhcResultCard.bindReveal(card, nums, function () {
            if (typeof notifyDrawCeremonyReady === 'function') {
              notifyDrawCeremonyReady(issue);
            }
          }, {
            openAt: openAt,
            onNumbers: function () {
              if (typeof notifyDrawBarNumbersReady === 'function') {
                notifyDrawBarNumbersReady(issue, nums, 7);
              }
            },
            onStarted: function (totalMs, numbersAt) {
              started = true;
              let armMs = Math.max(Number(totalMs) || readyMs, Number(numbersAt) || 0) + 1200;
              if (Number.isFinite(openAt)) {
                armMs = Math.max(armMs, openAt - srvNow() + 1200);
              }
              ctx.scheduleRevealReady(issue, armMs);
            },
          });
          /* iframe 极端未就绪：约 9s 后仍武装兜底，避免永远卡仪式 */
          setTimeout(function () {
            if (!started) ctx.scheduleRevealReady(issue, readyMs);
          }, 9000);
        } else if (ctx.live && !ctx.animate) {
          const phaseIss = (roomChat && roomChat.getPhaseIssue)
            ? String(roomChat.getPhaseIssue() || '')
            : '';
          const holding = isServerDrawingIssue(issue) || (
            typeof isCeremonyHolding === 'function' &&
            isCeremonyHolding() &&
            phaseIss &&
            phaseIss === String(issue || '')
          );
          if (holding) {
            if (window.LhcResultCard && LhcResultCard.holdBlack) LhcResultCard.holdBlack(card);
            ctx.setRevealPending(issue);
            const openAtHold = serverCurrent && new Date(serverCurrent.openAt).getTime();
            const remain = Number.isFinite(openAtHold)
              ? Math.max(1200, openAtHold - srvNow() + 600)
              : readyMs;
            ctx.scheduleRevealReady(issue, Math.min(remain, readyMs + 400));
          } else if (LhcResultCard.settle) {
            LhcResultCard.settle(card, nums);
            ctx.setRevealReadyFlag(issue, true);
          } else {
            ctx.setRevealReadyFlag(issue, true);
          }
        } else {
          /* 历史回放：保持黑卡，等 snapshot holdBlack */
          ctx.setRevealReadyFlag(issue, true);
          if (typeof holdBlackLockedResultCards === 'function') {
            setTimeout(function () { try { holdBlackLockedResultCards(); } catch (eR) { /* ignore */ } }, 0);
          }
        }
      } else if (ctx.live && ctx.animate) {
        ctx.setRevealPending(issue);
        ctx.scheduleRevealReady(issue, readyMs);
      } else {
        ctx.setRevealReadyFlag(issue, true);
      }
    },
    getRevealFallbackMs: function () {
      return resultRevealDurationMs() + 1000 + 800;
    },
  });

  function onResultRevealReady(issue) {
    roomChat.markRevealReady(issue);
  }

  function scheduleResultRevealReady(issue, ms) {
    roomChat.scheduleRevealReady(issue, ms);
  }

  function syncRoomChat(initial) {
    roomChat.sync(!!initial);
  }

  function startRoomChatPolling() {
    roomChat.startPolling();
  }

  function buildBetListText() {
    return buildBetListVerifyText(getCurrentIssue());
  }

  function initKeypad() {
    const left = ['大', '小', '单', '双'];
    const right = ['删除', '100', '200', '500'];
    const mid = [
      ['1', '2', '3'],
      ['4', '5', '6'],
      ['7', '8', '9'],
      ['0', '/', '各'],
    ];
    let html = '';
    for (let r = 0; r < 4; r++) {
      html += `<button type="button" class="lhc-key lhc-key--side" data-key="${left[r]}">${left[r]}</button>`;
      mid[r].forEach(k => {
        html += `<button type="button" class="lhc-key${k === '各' ? ' lhc-key--side' : ''}" data-key="${k}">${k}</button>`;
      });
      const rk = right[r];
      const cls = rk === '删除' ? ' lhc-key--del' : ' lhc-key--side';
      html += `<button type="button" class="lhc-key${cls}" data-key="${rk}">${rk}</button>`;
    }
    $('#keyGrid').html(html);
  }

  let keypadArmTimer = 0;
  let keypadGuardUntil = 0;
  let delHoldTimer = 0;
  let delHoldInterval = 0;

  function stopDeleteHold() {
    if (delHoldTimer) { clearTimeout(delHoldTimer); delHoldTimer = 0; }
    if (delHoldInterval) { clearInterval(delHoldInterval); delHoldInterval = 0; }
  }

  function showKeypad(show) {
    const $room = $('.lhc-room');
    const $pad = $('#keypad');
    if (show) {
      $pad.prop('hidden', false);
      $room.addClass('has-keypad');
      keypadGuardUntil = Date.now() + 450;
      $pad.addClass('is-arming');
      if (keypadArmTimer) clearTimeout(keypadArmTimer);
      keypadArmTimer = setTimeout(() => {
        $pad.removeClass('is-arming');
        keypadArmTimer = 0;
      }, 320);
    } else {
      stopDeleteHold();
      if (keypadArmTimer) { clearTimeout(keypadArmTimer); keypadArmTimer = 0; }
      keypadGuardUntil = 0;
      $pad.removeClass('is-arming').prop('hidden', true);
      $room.removeClass('has-keypad');
    }
  }

  function insertInput(text) {
    const $in = $('#chatInput');
    const v = $in.val();
    composerAllin = false;
    if (text === '删除') {
      $in.val(v.slice(0, -1));
    } else if (text === '空格') {
      $in.val(v + ' ');
    } else {
      $in.val(appendKeyWithSlash(v, text));
    }
    updateComposerAction();
  }

  function updateComposerAction() {
    const hasText = !!$('#chatInput').val().trim();
    const $btn = $('#plusBtn');
    const $img = $('#plusBtnImg');
    if (hasText) {
      $btn.addClass('is-send').attr('aria-label', '发送');
      if ($img.length) $img.attr('src', '/images/chat-rail/send.webp?v=1');
    } else {
      $btn.removeClass('is-send').attr('aria-label', '更多');
      if ($img.length) $img.attr('src', '/images/chat-rail/plus.webp?v=1');
    }
  }

  function trySendCancel(text) {
    if (String(text || '').trim() !== '取消') return false;
    if (!isBettingOpen()) { toastBetBlocked('cancel'); return true; }
    if (!App.cancelLotteryBets) { App.toast('请从大厅进入游戏'); return true; }
    App.cancelLotteryBets(SERVER_GAME).then(function (res) {
      refreshStats();
      const issue = getCurrentIssue();
      if (issueBetBook[issue] && issueBetBook[issue][user.name]) delete issueBetBook[issue][user.name];
      saveBetBook();
      if (issue) clearUserPendingBetLog(issue);
      const refunded = res && res.refunded != null ? res.refunded : 0;
      const count = res && res.count != null ? res.count : 0;
      appendMsg({ name: user.name, avatar: fixAvatar(user.avatar), self: true, html: '本期注单已取消' });
      $('#chatInput').val('');
      updateComposerAction();
      showKeypad(false);
      App.toast(count ? ('本期注单已取消 · ' + count + ' 注 · 退回 ' + refunded) : '本期注单已取消');
    }).catch(function (e) {
      var msg = (e && e.message) || '';
      if (/取消|封盘|无可/.test(msg)) App.toast('当前期无可取消注单');
      else App.toast(msg || '取消失败');
    });
    return true;
  }
  function trySendTopup(text) {
    const m = String(text || '').match(/^上分\s*\/?\s*(\d+)$/);
    if (!m) {
      if (/^上分/.test(String(text || '').trim())) { App.toast('格式：上分200 或 上分/200'); return true; }
      return false;
    }
    const amount = parseInt(m[1], 10);
    if (!(amount > 0)) { App.toast('请输入有效上分金额'); return true; }
    if (amount < 200) { App.toast('上分最低 200 积分'); return true; }
    if (!App.requestTopup) { App.toast('请从大厅进入游戏'); return true; }
    App.requestTopup(amount, '人工').then(function () {
      appendMsg({ name: user.name, avatar: fixAvatar(user.avatar), self: true, html: '上分' + amount });
      $('#chatInput').val('');
      updateComposerAction();
      showKeypad(false);
      App.toast('上分申请已发给客服');
    }).catch(function (e) { App.toast((e && e.message) || '上分申请失败'); });
    return true;
  }
  function trySendWithdraw(text) {
    const m = String(text || '').match(/^下分\s*\/?\s*(\d+)$/);
    if (!m) {
      if (/^下分/.test(String(text || '').trim())) { App.toast('格式：下分500 或 下分/500'); return true; }
      return false;
    }
    const amount = parseInt(m[1], 10);
    if (!(amount > 0)) { App.toast('请输入有效下分金额'); return true; }
    if (amount < 500) { App.toast('下分最低 500 积分'); return true; }
    const bal = App.getBalance(user.uid);
    if (amount > bal) { App.toast('下分金额不能大于当前积分'); return true; }
    if (!App.requestWithdraw) { App.toast('请从大厅进入游戏'); return true; }
    App.requestWithdraw(amount).then(function () {
      refreshStats();
      appendMsg({ name: user.name, avatar: fixAvatar(user.avatar), self: true, html: '下分' + amount });
      $('#chatInput').val('');
      updateComposerAction();
      showKeypad(false);
      App.toast('已扣除 ' + amount + '，申请已发给客服');
    }).catch(function (e) { App.toast((e && e.message) || '下分申请失败'); });
    return true;
  }

  function sendBetMessage() {
    const text = $('#chatInput').val().trim();
    if (!text) return;
    if (trySendCancel(text)) return;
    if (trySendTopup(text)) return;
    if (trySendWithdraw(text)) return;
    if (!isBettingOpen()) {
      toastBetBlocked('bet');
      return;
    }
    let expanded;
    if (composerAllin) {
      composerAllin = false;
      const plays = expandPlaysForAllin(text);
      if (!plays || !plays.length) { App.toast('格式错误'); return; }
      expanded = resolveBetAmounts(plays, '梭哈');
      if (!expanded) { App.toast('余额不足，无法梭哈'); return; }
    } else {
      expanded = expandChatBetInput(text);
      if (!expanded || !expanded.length) {
        App.toast('格式错误');
        return;
      }
    }
    const bal = App.getBalance(user.uid);
    const totalAmt = expanded.reduce((s, b) => s + b.amount, 0);
    if (totalAmt > bal) { App.toast('余额不足'); return; }
    const mapped = mapLinesToServerBets(expanded);
    if (mapped.unsupported.length) {
      App.toast('无法识别：' + mapped.unsupported.slice(0, 3).join('、') + '（请检查口令或到玩法面板点选）');
      return;
    }
    if (!mapped.bets.length) {
      App.toast('暂无可用玩法');
      return;
    }
    if (mapped.bets.length > 50) {
      App.toast('单次最多 50 注，请减少组合后再下（当前 ' + mapped.bets.length + ' 注）');
      return;
    }
    if (!App.placeLotteryBets) {
      App.toast('请从大厅进入游戏');
      return;
    }
    App.placeLotteryBets(SERVER_GAME, mapped.bets, { chatText: text.replace(/\s+/g, ' ') }).then(function () {
      refreshStats();
      const lines = [];
      expanded.forEach(b => {
        const line = b.play + ' ' + b.amount;
        if (recordBet(user.name, line)) lines.push(line);
      });
      if (!lines.length) {
        App.toast('下注失败，请检查玩法');
        return;
      }
      // 口令拆注（如「大各80」→ 多个特码号）时聊天只显示摘要，避免误以为只下了一注
      let html;
      if (lines.length > 1) {
        const preview = lines.length <= 6
          ? lines.join('<br>')
          : (lines.slice(0, 4).join('<br>') + '<br>… 另有 ' + (lines.length - 4) + ' 注');
        html = '<div class="lhc-msg__bet-origin">' + escapeHtml(text.replace(/\s+/g, ' ')) + '</div>' +
          preview +
          '<br><span class="lhc-msg__bet-sum">已拆成 ' + lines.length + ' 注 · 合计 ' + totalAmt + '（账本按号逐注）</span>';
      } else {
        html = lines[0];
      }
      syncRoomChat(false);
      rememberBetLines(lines);
      App.toast(lines.length > 1
        ? ('投注成功 · 口令已拆成 ' + lines.length + ' 注 · 合计 ' + totalAmt)
        : '投注成功');
      $('#chatInput').val('');
      updateComposerAction();
    }).catch(function (e) {
      App.toast((e && e.message) || '下注失败');
    });
  }

  function rememberBetLines(lines) {
    const arr = (lines || []).filter(Boolean);
    lastBetLines = arr.slice();
    lastBetText = arr.length ? arr.join('；') : '';
  }

  /** 重复：只填入输入框，不直接发送 */
  function fillLastBetsToInput() {
    if (!lastBetLines.length && !lastBetText) {
      App.toast('暂无上笔投注可重复');
      return;
    }
    composerAllin = false;
    const text = lastBetLines.length ? lastBetLines.join('；') : lastBetText;
    $('#chatInput').val(text);
    updateComposerAction();
  }

  function toggleDrawPanel() {
    drawPanelOpen = !drawPanelOpen;
    $('#drawBar').toggleClass('is-open', drawPanelOpen);
    layoutRail();
    setTimeout(layoutRail, 360);
    $('#drawToggle').attr('aria-expanded', drawPanelOpen);
  }

  function openPlusMenu(open) {
    const $room = $('.lhc-room');
    if (open) {
      $('#menuMask').prop('hidden', false);
      $('#plusMenu').prop('hidden', false).addClass('is-open');
      $room.addClass('has-menu');
    } else {
      $('#plusMenu').removeClass('is-open');
      $('#menuMask').prop('hidden', true);
      setTimeout(() => { if (!$('#plusMenu').hasClass('is-open')) $('#plusMenu').prop('hidden', true); }, 280);
      $room.removeClass('has-menu');
    }
  }

  /** 右侧栏顶对齐开奖条单行下沿；短屏压缩并保证不压住底部输入 */
  function layoutRail() {
    const room = document.querySelector('.lhc-room');
    const rail = room && room.querySelector('.lhc-rail');
    const anchor = document.getElementById('drawToggle') || document.getElementById('drawBar');
    const composer = document.querySelector('.lhc-composer');
    if (!room || !anchor) return;
    const roomRect = room.getBoundingClientRect();
    const preferTop = Math.max(
      8,
      Math.ceil(anchor.getBoundingClientRect().bottom - roomRect.top + 6)
    );
    /* 先按期望 top 写上，再量真实栈高做夹紧 */
    room.style.setProperty('--rail-top', preferTop + 'px');
    const shortH = roomRect.height > 0 && roomRect.height < 700;
    room.classList.toggle('is-rail-compact', shortH);
    const stackH = rail ? Math.max(rail.offsetHeight, shortH ? 168 : 210) : (shortH ? 168 : 210);
    const composerTop = composer
      ? composer.getBoundingClientRect().top - roomRect.top
      : roomRect.height - 56;
    const maxTop = Math.max(8, Math.floor(composerTop - stackH - 6));
    const top = Math.min(preferTop, maxTop);
    room.style.setProperty('--rail-top', top + 'px');
  }

  /** 玩法面板顶边对齐历史开奖栏下沿，盖住聊天区、露出倒计时 */
  function layoutPlayOverlay() {
    const bar = document.getElementById('drawBar');
    let top = 210;
    if (bar) {
      const rect = bar.getBoundingClientRect();
      top = Math.max(120, Math.ceil(rect.bottom + 4));
    }
    document.documentElement.style.setProperty('--lhc-play-top', top + 'px');
  }
  function openPlaySheet(open) {
    const $room = $('.lhc-room');
    if (open) {
      // 收起历史展开，保证顶边贴在开奖栏主行下方
      if (drawPanelOpen) {
        drawPanelOpen = false;
        $('#drawBar').removeClass('is-open');
        $('#drawToggle').attr('aria-expanded', false);
      }
      layoutPlayOverlay();
      $('#playMask').prop('hidden', false);
      $('#playSheet').prop('hidden', false).addClass('is-open');
      $room.addClass('has-play');
      renderPlayPanel(false);
      updatePlaySelected();
    } else {
      $('#playSheet').removeClass('is-open');
      $('#playMask').prop('hidden', true);
      setTimeout(() => { if (!$('#playSheet').hasClass('is-open')) $('#playSheet').prop('hidden', true); }, 300);
      $room.removeClass('has-play');
    }
  }
  $(window).on('resize orientationchange', () => {
    layoutRail();
    if ($('#playSheet').hasClass('is-open')) layoutPlayOverlay();
  });

  // ===== 初始化（服务端快照到达前仅显示空状态，绝不伪造官方历史） =====
  refreshStats();
  renderDrawTable();
  setIssueEl($('#curIssue'), getCurrentIssue());
  updateCountdownUI(getRoundRemain());
  /* 左侧玩法分类（对齐官方截图导航） */
  /** 分区两列：特码两面 / 正码1~6 */
  const SIDE_SECTIONS_TEMA = [
    {
      title: '两面',
      items: [
        { label: '大', play: '特码大' }, { label: '小', play: '特码小' },
        { label: '单', play: '特码单' }, { label: '双', play: '特码双' },
      ],
    },
    {
      title: '组合',
      items: [
        { label: '大单', play: '特大单' }, { label: '大双', play: '特大双' },
        { label: '小单', play: '特小单' }, { label: '小双', play: '特小双' },
      ],
    },
    {
      title: '合数',
      items: [
        { label: '合大', play: '合大' }, { label: '合小', play: '合小' },
        { label: '合单', play: '合单' }, { label: '合双', play: '合双' },
      ],
    },
    {
      title: '尾数',
      items: [
        { label: '尾大', play: '尾大' }, { label: '尾小', play: '尾小' },
      ],
    },
  ];
  const TEMA_COLOR_SECTIONS = [
    {
      title: '特码色波',
      grid: 'is-wave',
      items: [
        { label: '红', play: '红波', cls: 'is-red' },
        { label: '蓝', play: '蓝波', cls: 'is-blue' },
        { label: '绿', play: '绿波', cls: 'is-green' },
      ],
    },
    {
      title: '特码半波',
      grid: 'is-side',
      items: [
        { label: '红大', play: '红大', cls: 'is-red' }, { label: '红单', play: '红单', cls: 'is-red' },
        { label: '红双', play: '红双', cls: 'is-red' }, { label: '红小', play: '红小', cls: 'is-red' },
        { label: '蓝小', play: '蓝小', cls: 'is-blue' }, { label: '蓝单', play: '蓝单', cls: 'is-blue' },
        { label: '蓝双', play: '蓝双', cls: 'is-blue' }, { label: '蓝大', play: '蓝大', cls: 'is-blue' },
        { label: '绿小', play: '绿小', cls: 'is-green' }, { label: '绿双', play: '绿双', cls: 'is-green' },
        { label: '绿大', play: '绿大', cls: 'is-green' }, { label: '绿单', play: '绿单', cls: 'is-green' },
      ],
    },
    {
      title: '特码半半波',
      grid: 'is-side',
      items: [
        { label: '红大单', play: '红大单', cls: 'is-red' }, { label: '红大双', play: '红大双', cls: 'is-red' },
        { label: '红小单', play: '红小单', cls: 'is-red' }, { label: '红小双', play: '红小双', cls: 'is-red' },
        { label: '蓝小单', play: '蓝小单', cls: 'is-blue' }, { label: '蓝大双', play: '蓝大双', cls: 'is-blue' },
        { label: '蓝小双', play: '蓝小双', cls: 'is-blue' }, { label: '蓝大单', play: '蓝大单', cls: 'is-blue' },
        { label: '绿小双', play: '绿小双', cls: 'is-green' }, { label: '绿大单', play: '绿大单', cls: 'is-green' },
        { label: '绿大双', play: '绿大双', cls: 'is-green' }, { label: '绿小单', play: '绿小单', cls: 'is-green' },
      ],
    },
  ];
  const SUM_SIDE_SECTIONS = [
    {
      title: '总和',
      items: [
        { label: '总和大', play: '总和大' }, { label: '总和小', play: '总和小' },
        { label: '总和单', play: '总和单' }, { label: '总和双', play: '总和双' },
      ],
    },
    {
      title: '总尾',
      items: [
        { label: '总尾大', play: '总尾大' }, { label: '总尾小', play: '总尾小' },
      ],
    },
  ];
  const ZHENG_POS_TABS = ['正一', '正二', '正三', '正四', '正五', '正六'];
  const ZHENG16_SECTIONS = (pos) => {
    const p = NUM_CN[pos] || String(pos);
    return [
      {
        title: '两面',
        items: [
          { label: '大', play: `正${p}大` }, { label: '小', play: `正${p}小` },
          { label: '单', play: `正${p}单` }, { label: '双', play: `正${p}双` },
        ],
      },
      {
        title: '组合',
        items: [
          { label: '大单', play: `正${p}大单` }, { label: '大双', play: `正${p}大双` },
          { label: '小单', play: `正${p}小单` }, { label: '小双', play: `正${p}小双` },
        ],
      },
      {
        title: '合数',
        items: [
          { label: '合大', play: `正${p}合大` }, { label: '合小', play: `正${p}合小` },
          { label: '合单', play: `正${p}合单` }, { label: '合双', play: `正${p}合双` },
        ],
      },
      {
        title: '尾数',
        items: [
          { label: '尾大', play: `正${p}尾大` }, { label: '尾小', play: `正${p}尾小` },
        ],
      },
    ];
  };
  const HEXIAO_TABS = ['二肖', '三肖', '四肖', '五肖', '六肖', '七肖', '八肖', '九肖', '十肖', '十一肖'];
  const PLAY_CATEGORIES = [
    { id: 'tema', title: '特码', hint: () => `点选号码 · 赔率 ${ODDS.tema}`, mode: 'balls', prefix: '特码', odds: ODDS.tema },
    {
      id: 'temaSide',
      title: '特码两面',
      hint: () => `两面 ${ODDS.side} · 组合 ${ODDS.comboSide}`,
      mode: 'items',
      layout: 'sideFlat',
      panelTitle: '特码两面',
      sections: SIDE_SECTIONS_TEMA,
    },
    {
      id: 'temaColor',
      title: '特码色波',
      hint: () => `色波/半波/半半波 · 红 ${ODDS.colorRed}`,
      mode: 'items',
      layout: 'sideSections',
      sections: TEMA_COLOR_SECTIONS,
    },
    {
      id: 'texiao',
      title: '特码生肖',
      hint: () => `特码生肖 · ${ODDS.zodiac}（本命 ${ODDS.zodiacYear}）`,
      mode: 'zodiacBalls',
      playPrefix: '特肖',
      oddsFn: zodiacOdds,
    },
    { id: 'zhengma', title: '正码', hint: () => `点选号码 · 赔率 ${ODDS.zhengma}`, mode: 'balls', prefix: '正码', odds: ODDS.zhengma },
    { id: 'zhengTe', title: '正码特', hint: () => `正一特~正六特 · 赔率 ${ODDS.zhengTe}`, mode: 'zhengTe' },
    { id: 'zheng16', title: '正码1~6', hint: () => `正码位两面 ${ODDS.zhengSide} · 组合 ${ODDS.zhengCombo}`, mode: 'zheng16' },
    { id: 'zhengBo', title: '正波', hint: () => `正码位色波 · 红 ${ODDS.colorRed} · 蓝/绿 ${ODDS.colorBlue}`, mode: 'zhengBo' },
    {
      id: 'pingTe',
      title: '平特一肖',
      hint: () => `七码任一 · ${ODDS.pingTe}（本命 ${ODDS.pingTeYear}）`,
      mode: 'zodiacBalls',
      playPrefix: '一肖',
      oddsFn: pingTeOdds,
    },
    { id: 'pingWei', title: '平特尾数', hint: () => `0尾 ${ODDS.weiShu0} · 其余 ${ODDS.weiShu}`, mode: 'zongshu' },
    {
      id: 'shengxiaolian',
      title: '连肖',
      hint: () => `二连肖 ${ODDS.sxLianZhong[2]}（本命 ${ODDS.sxLianZhongYear[2]}）`,
      mode: 'shengxiaolian',
    },
    {
      id: 'weishulian',
      title: '连尾',
      hint: () => `二连尾 ${ODDS.wsLianZhong[2]} · 三连尾 ${ODDS.wsLianZhong[3]}`,
      mode: 'weishulian',
    },
    { id: 'lianma', title: '连码', hint: '四全中 / 三中二 / 三全中 / 二全中 / 二中特 / 特串', mode: 'lianma' },
    {
      id: 'sumSide',
      title: '总和两面',
      hint: () => `总和 ${ODDS.sumSide} · 总尾 ${ODDS.sumTail}`,
      mode: 'items',
      layout: 'sideFlat',
      panelTitle: '总和两面',
      sections: SUM_SIDE_SECTIONS,
    },
    { id: 'temaTouWei', title: '特码头尾数', hint: () => `0头 ${ODDS.temaTou0} · 1-4头 ${ODDS.temaTou} · 0尾 ${ODDS.temaWei0}`, mode: 'temaTouWei' },
    { id: 'heXiao', title: '特码合肖', hint: () => `二~十一肖 · 三肖 ${ODDS.heXiao[3]}`, mode: 'heXiao' },
    {
      id: 'wuxing',
      title: '五行',
      hint: () => `金木 ${ODDS.wuxingJin} · 水 ${ODDS.wuxingShui} · 火 ${ODDS.wuxingHuo} · 土 ${ODDS.wuxingTu}`,
      mode: 'wuxing',
    },
    {
      id: 'zhengXiao',
      title: '正肖',
      hint: () => `正码任一同肖 · ${ODDS.zhengXiao}（本命 ${ODDS.zhengXiaoYear}）`,
      mode: 'zodiacBalls',
      playPrefix: '正肖',
      oddsFn: zhengXiaoOdds,
    },
    {
      id: 'duoxuan',
      title: '自选不中',
      hint: () => `选5~12个号 · 五不中 ${ODDS.buZhong[5]} · 十二 ${ODDS.buZhong[12]}`,
      mode: 'duoxuan',
    },
  ];
  /** 特码/正码快捷：仅十二生肖（6×2） */
  const BALL_QUICK = [
    { key: '鼠', cls: 'is-zx' }, { key: '牛', cls: 'is-zx' }, { key: '虎', cls: 'is-zx' },
    { key: '兔', cls: 'is-zx' }, { key: '龙', cls: 'is-zx' }, { key: '蛇', cls: 'is-zx' },
    { key: '马', cls: 'is-zx' }, { key: '羊', cls: 'is-zx' }, { key: '猴', cls: 'is-zx' },
    { key: '鸡', cls: 'is-zx' }, { key: '狗', cls: 'is-zx' }, { key: '猪', cls: 'is-zx' },
  ];
  const POULTRY_ZODIAC = new Set(['牛', '马', '羊', '鸡', '狗', '猪']);
  const BEAST_ZODIAC = new Set(['鼠', '虎', '兔', '龙', '蛇', '猴']);
  const LIANMA_MODES = ['复式', '拖头', '生肖对碰', '尾数对碰', '生尾对碰', '任意对碰'];
  const LIANMA_PLAYS = ['四全中', '三中二', '三全中', '二全中', '二中特', '特串'];
  /** 对碰类仅二码玩法 */
  const LIANMA_PLAYS_ER = ['二全中', '二中特', '特串'];
  const LIANMA_DUIPENG_MODES = new Set(['生肖对碰', '尾数对碰', '生尾对碰', '任意对碰']);
  const LIANMA_ZODIAC = ['鼠', '牛', '虎', '兔', '龙', '蛇', '马', '羊', '猴', '鸡', '狗', '猪'];
  /* 官方仅平特尾数（中）；尾数不中仍可由聊天口令投注 */
  const ZONGSHU_SUBS = ['尾数'];
  /* 官方：二连肖~五连肖（复式 C）；不中/拖头仍可口令 */
  const SXL_PLAYS = ['二连肖', '三连肖', '四连肖', '五连肖'];
  const SXL_CN = ['二', '三', '四', '五'];
  /* 官方：二连尾~五连尾（复式 C） */
  const WSL_PLAYS = ['二连尾', '三连尾', '四连尾', '五连尾'];
  const WSL_CN = ['二', '三', '四', '五'];
  const LIUXIAO_SUBS = ['中奖', '不中'];
  const BUZHONG_CN = { 5: '五', 6: '六', 7: '七', 8: '八', 9: '九', 10: '十', 11: '十一', 12: '十二' };
  const AMOUNT_CHIPS = [
    { amt: 1, label: '1' },
    { amt: 10, label: '10' },
    { amt: 100, label: '100' },
    { amt: 500, label: '500' },
    { amt: 1000, label: '1000' },
    { amt: 5000, label: '5000' },
    { amt: 10000, label: '1W' },
    { amt: 50000, label: '5W' }
  ];
  const CHIP_IMG = (amt) => `/images/chips/chip-${amt}.png?v=4`;
  const COMBO_MODES = new Set(['lianma', 'shengxiaolian', 'weishulian', 'liuxiao', 'duoxuan', 'heXiao']);
  let playCatIdx = 0;
  let playSelectedList = [];
  let zhengTePosIdx = 0;
  let zheng16PosIdx = 0;
  let zhengBoPosIdx = 0;
  let heXiaoTabIdx = 0;
  let heXiaoPicked = [];

  function clearPlayAmountChipActive() {
    $('#playAmountChips .lhc-play-foot__chip').removeClass('is-active');
  }

  function syncPlayAmountUI() {
    const $in = $('#playAmount');
    if (playAllin) {
      $in.attr('type', 'text').prop('readonly', true).val('梭哈').addClass('is-allin');
      $('#playAmountAllin').addClass('is-active');
      clearPlayAmountChipActive();
    } else {
      $in.attr('type', 'number').prop('readonly', false).removeClass('is-allin');
      $('#playAmountAllin').removeClass('is-active');
      if (!$in.val() || $in.val() === '梭哈') $in.val(100);
    }
  }

  function setPlayAmount(val) {
    playAllin = false;
    $('#playAmount').attr('type', 'number').prop('readonly', false).removeClass('is-allin');
    $('#playAmountAllin').removeClass('is-active');
    $('#playAmount').val(Math.max(1, val));
  }

  /** 特码快捷多选：可同时激活多个，号码取并集 */
  const ballQuickKeys = new Set();
  /** 各玩法分类独立暂存，切换特码/正码等不互相清空 */
  const playCatState = Object.create(null);
  let lianmaModeIdx = 0;
  let lianmaPlayIdx = 0;
  let lianmaPicked = [];
  let lianmaPickedA = [];
  let lianmaPickedB = [];
  let lianmaPengSide = 'A';
  let zongshuSubIdx = 0;
  let temaAttrSubIdx = 0;
  let sxlPlayIdx = 0;
  let sxlPicked = [];
  let wslPlayIdx = 0;
  let wslPicked = [];
  let liuxiaoSubIdx = 0;
  let liuxiaoPicked = [];
  let dxbzPicked = [];
  let dxbzGroups = [];

  function playOddsLabel(play) {
    const p = parsePlay(play);
    return p ? String(p.odds) : '';
  }
  function currentPlayCat() {
    return PLAY_CATEGORIES[playCatIdx] || PLAY_CATEGORIES[0];
  }
  function isComboPlayMode(mode) {
    return COMBO_MODES.has(mode);
  }
  function togglePlaySelect(play) {
    if (!play || !parsePlay(play)) return;
    const idx = playSelectedList.indexOf(play);
    if (idx >= 0) playSelectedList.splice(idx, 1);
    else playSelectedList.push(play);
  }
  function isPlaySelected(play) {
    return playSelectedList.indexOf(play) >= 0;
  }
  function clearComboPicks() {
    lianmaPicked = [];
    lianmaPickedA = [];
    lianmaPickedB = [];
    lianmaPengSide = 'A';
    sxlPicked = [];
    wslPicked = [];
    liuxiaoPicked = [];
    heXiaoPicked = [];
    dxbzPicked = [];
    dxbzGroups = [];
  }
  function clearComboPicksForMode(mode) {
    if (mode === 'lianma') {
      lianmaPicked = [];
      lianmaPickedA = [];
      lianmaPickedB = [];
      lianmaPengSide = 'A';
    } else if (mode === 'shengxiaolian') {
      sxlPicked = [];
    } else if (mode === 'weishulian') {
      wslPicked = [];
    } else if (mode === 'liuxiao') {
      liuxiaoPicked = [];
    } else if (mode === 'heXiao') {
      heXiaoPicked = [];
    } else if (mode === 'duoxuan') {
      dxbzPicked = [];
      dxbzGroups = [];
    }
  }
  function saveCurrentPlayCatState() {
    const cat = currentPlayCat();
    playCatState[cat.id] = {
      list: playSelectedList.slice(),
      quick: [...ballQuickKeys],
    };
  }
  function loadPlayCatState(catId) {
    const s = playCatState[catId];
    playSelectedList = s ? s.list.slice() : [];
    ballQuickKeys.clear();
    if (s && s.quick) s.quick.forEach((k) => ballQuickKeys.add(k));
  }
  /** 清空：所有分类已选一并清掉（特码/正码/连码等暂存全清） */
  function clearPlaySelection() {
    playSelectedList = [];
    ballQuickKeys.clear();
    clearComboPicks();
    Object.keys(playCatState).forEach((k) => { delete playCatState[k]; });
    renderPlayPanel(false);
    updatePlaySelected();
    App.toast('已清空全部选择');
  }
  /** 连码玩法赔率文案（三中二/二中特展示两档） */
  function lianmaPlayOddsText(play) {
    if (play === '四全中') return String(ODDS.siQuanZhong);
    if (play === '三全中') return String(ODDS.sanQuanZhong);
    if (play === '二全中') return String(ODDS.erQuanZhong);
    if (play === '特串') return String(ODDS.teChuan);
    if (play === '三中二') return `${ODDS.sanZhongEr}/${ODDS.sanZhongSan}`;
    if (play === '二中特') return `${ODDS.erZhongTe}/${ODDS.erZhongTeTe}`;
    return '';
  }
  /** 与连码一致的副玩法/玩法栏（蓝胶囊 + 金方块） */
  function buildLmBar(opts) {
    const modes = opts.modes || [];
    const plays = opts.plays || [];
    const modeIdx = opts.modeIdx | 0;
    const playIdx = opts.playIdx | 0;
    const modeRow = opts.modeRow || 'mode';
    const playRow = opts.playRow || 'play';
    const modeCols = opts.modeCols || Math.min(modes.length || 1, 3);
    const playCols = opts.playCols || Math.min(plays.length || 1, 4);
    const playLab = opts.playLab || '玩法';
    let html = '<div class="lhc-lm-bar">';
    if (modes.length) {
      const modeHtml = modes.map((m, i) =>
        `<button type="button" class="lhc-lm-mode${i === modeIdx ? ' is-active' : ''}" data-row="${modeRow}" data-idx="${i}">${m}</button>`
      ).join('');
      html += `<div class="lhc-lm-row">
        <span class="lhc-lm-row__lab is-mode">副玩法</span>
        <div class="lhc-lm-modes is-n${modeCols}">${modeHtml}</div>
      </div>`;
    }
    if (plays.length) {
      const playHtml = plays.map((p, i) => {
        const dataIdx = typeof opts.playDataIdx === 'function' ? opts.playDataIdx(p, i) : i;
        const active = typeof opts.isPlayActive === 'function' ? opts.isPlayActive(p, i) : (i === playIdx);
        const odds = typeof opts.playOdds === 'function' ? opts.playOdds(p, i) : '';
        return `<button type="button" class="lhc-lm-play${odds ? ' has-odds' : ''}${active ? ' is-active' : ''}" data-row="${playRow}" data-idx="${dataIdx}"><span>${p}</span>${odds ? `<small>${odds}</small>` : ''}</button>`;
      }).join('');
      html += `<div class="lhc-lm-row">
        <span class="lhc-lm-row__lab is-play">${playLab}</span>
        <div class="lhc-lm-plays is-n${playCols}">${playHtml}</div>
      </div>`;
    }
    if (opts.extraHtml) html += opts.extraHtml;
    html += '</div>';
    return html;
  }
  function setPlaySubBar(html) {
    $('#playSub').prop('hidden', false).removeClass('is-stack is-ball-quick').addClass('is-lianma-sub').html(html);
  }
  function fmtPickNum(v) {
    return /^\d+$/.test(String(v)) ? pad(+v, 2) : String(v);
  }
  function pickRoleClass(picked, idx, mode, k) {
    if (mode !== '拖头' || idx < 0) return picked ? ' is-active' : '';
    if (!picked) return '';
    const danN = k - 1;
    return idx < danN ? ' is-active is-dan' : ' is-active is-tuo';
  }
  function syncPlayFootTotals() {
    const n = previewComboBetCount();
    let total = 0;
    if (playAllin) {
      const bal = Math.floor(App.getBalance(user.uid) || 0);
      if (n >= 1 && bal >= 1) total = n === 1 ? bal : Math.floor(bal / n) * n;
    } else {
      const unit = Math.max(0, parseInt($('#playAmount').val(), 10) || 0);
      total = n * unit;
    }
    $('#playBetTotal').text(total.toLocaleString('en-US'));
    const hasPick = !!(
      playSelectedList.length
      || lianmaPicked.length || lianmaPickedA.length || lianmaPickedB.length
      || sxlPicked.length || wslPicked.length || liuxiaoPicked.length || heXiaoPicked.length
      || dxbzPicked.length || dxbzGroups.length || ballQuickKeys.size
    );
    $('#playClear').prop('disabled', !hasPick);
  }

  function setPlaySelectedText(main, betCount) {
    const $tip = $('#playSelected');
    if (!main || main === '—') {
      $tip.prop('hidden', true).text('');
    } else {
      $tip.prop('hidden', false).text(main);
    }
    syncPlayFootTotals();
  }

  /** 当前面板可拆注数（用于底部合计预览） */
  function previewComboBetCount() {
    const cat = currentPlayCat();
    if (cat.mode === 'lianma') return expandLianmaCombos().length;
    if (cat.mode === 'shengxiaolian') {
      const k = sxlMinPick();
      return expandFushi(sxlPicked, k).length;
    }
    if (cat.mode === 'weishulian') {
      const k = wslMinPick();
      return expandFushi(wslPicked.map(Number), k).length;
    }
    if (cat.mode === 'liuxiao') return liuxiaoPicked.length === 6 ? 1 : 0;
    if (cat.mode === 'heXiao') {
      const n = heXiaoTabIdx + 2;
      return heXiaoPicked.length === n ? 1 : 0;
    }
    if (cat.mode === 'duoxuan') {
      const n = dxbzPicked.length;
      return n >= 5 && n <= 12 ? 1 : 0;
    }
    return playSelectedList.length;
  }

  function expandLianmaCombos() {
    const mode = lianmaMode();
    const play = lianmaPlay();
    const need = lianmaMinPick();
    const isEr = need === 2;
    if (mode === '复式' || mode === '拖头') {
      const nums = lianmaPicked.map(Number).filter(n => n >= 1 && n <= 49);
      return expandByMode(mode, nums, need);
    }
    if (!isEr) return [];
    if (mode === '生肖对碰') {
      const zs = lianmaPicked.filter(v => /^[鼠牛虎兔龙蛇马羊猴鸡狗猪]$/.test(v));
      if (zs.length !== 2) return [];
      return expandDuipengPairs(numsOfZodiac(zs[0]), numsOfZodiac(zs[1]));
    }
    if (mode === '尾数对碰') {
      const ts = lianmaPicked.filter(v => /^\d$/.test(v));
      if (ts.length !== 2) return [];
      return expandDuipengPairs(numsOfTail(ts[0]), numsOfTail(ts[1]));
    }
    if (mode === '生尾对碰') {
      const zs = lianmaPicked.filter(v => /^[鼠牛虎兔龙蛇马羊猴鸡狗猪]$/.test(v));
      const ts = lianmaPicked.filter(v => /^\d$/.test(v));
      if (!zs.length || !ts.length) return [];
      const setA = zs.flatMap(numsOfZodiac);
      const setB = ts.flatMap(numsOfTail);
      return expandDuipengPairs(setA, setB);
    }
    if (mode === '任意对碰') {
      if (!lianmaPickedA.length || !lianmaPickedB.length) return [];
      return expandDuipengPairs(lianmaPickedA.map(Number), lianmaPickedB.map(Number));
    }
    return [];
  }

  function updatePlaySelected() {
    const cat = currentPlayCat();
    const mode = cat.mode;
    const amt = unitAmount();
    if (mode === 'lianma') {
      const min = lianmaMinPick();
      const betCount = expandLianmaCombos().length;
      if (!lianmaPicked.length) setPlaySelectedText(`已选 0/${min}`, 0);
      else setPlaySelectedText(`${lianmaPlay()} · ${lianmaPicked.map(fmtPickNum).join(',')}`, betCount);
      return;
    }
    if (mode === 'shengxiaolian') {
      const k = sxlMinPick();
      const betCount = expandFushi(sxlPicked, k).length;
      if (!sxlPicked.length) setPlaySelectedText(`已选 0/${k}`, 0);
      else setPlaySelectedText(`${sxlPlay()} · ${sxlPicked.join(',')}`, betCount);
      return;
    }
    if (mode === 'weishulian') {
      const k = wslMinPick();
      const betCount = expandFushi(wslPicked.map(Number), k).length;
      if (!wslPicked.length) setPlaySelectedText(`已选 0/${k}`, 0);
      else setPlaySelectedText(`${wslPlay()} · ${wslPicked.map(t => `${t}尾`).join(',')}`, betCount);
      return;
    }
    if (mode === 'liuxiao') {
      const sub = LIUXIAO_SUBS[liuxiaoSubIdx] || LIUXIAO_SUBS[0];
      const tag = sub === '不中' ? '六肖不中' : '六肖中';
      const ok = liuxiaoPicked.length === 6;
      if (!ok) setPlaySelectedText(`已选 ${liuxiaoPicked.length}/6`, 0);
      else setPlaySelectedText(`${tag} · ${liuxiaoPicked.join(',')}`, 1);
      return;
    }
    if (mode === 'heXiao') {
      const n = heXiaoTabIdx + 2;
      const tab = HEXIAO_TABS[heXiaoTabIdx] || HEXIAO_TABS[0];
      if (heXiaoPicked.length !== n) setPlaySelectedText(`已选 ${heXiaoPicked.length}/${n}`, 0);
      else setPlaySelectedText(`合肖${tab} · ${heXiaoPicked.join(',')}`, 1);
      return;
    }
    if (mode === 'duoxuan') {
      const n = dxbzPicked.length;
      const picks = dxbzPicked.map((x) => pad(+x, 2)).join(',');
      const odds = n >= 5 && n <= 12 ? (ODDS.buZhong[n] || '') : '';
      if (n < 5) setPlaySelectedText(`已选 ${n}/5~12`, 0);
      else if (n > 12) setPlaySelectedText(`最多12个 · 已选${n}`, 0);
      else setPlaySelectedText(`自选不中 · ${picks} · 赔率 ${odds}`, 1);
      return;
    }
    const n = playSelectedList.length;
    if (!n) {
      setPlaySelectedText('—', 0);
      return;
    }
    const list = playSelectedList.join('、');
    setPlaySelectedText(n > 1 ? `${list}（共${n}项）` : list, n);
  }

  /** 拆成多条玩法串（不含金额），对齐 123.com 每组合一注 */
  function buildComboBetPlays() {
    const cat = currentPlayCat();
    if (cat.mode === 'lianma') {
      const mode = lianmaMode();
      const play = lianmaPlay();
      const need = lianmaMinPick();
      if ((mode === '生肖对碰' || mode === '尾数对碰' || mode === '生尾对碰' || mode === '任意对碰') && need !== 2) {
        return { err: '对碰仅支持二全中 / 二中特 / 特串' };
      }
      const combos = expandLianmaCombos();
      if (!combos.length) {
        if (mode === '任意对碰') return { err: '请分别选择 A 组与 B 组号码（不可重复）' };
        if (mode === '生肖对碰') return { err: '请选择 2 个生肖对碰' };
        if (mode === '尾数对碰') return { err: '请选择 2 个尾数对碰' };
        if (mode === '生尾对碰') return { err: '请至少选 1 个生肖和 1 个尾' };
        return { err: mode === '拖头' ? `拖头请先选 ${need - 1} 个胆再选托码` : `请至少选择 ${need} 个` };
      }
      const prefix = (mode === '复式' || mode === '拖头') ? mode : '复式';
      return {
        plays: combos.map((c) => {
          if (mode === '拖头') return `拖头${play}${formatTuotouNums(c, need - 1)}`;
          return `${prefix}${play}${c.map(n => pad(+n, 2)).join(',')}`;
        }),
      };
    }
    if (cat.mode === 'shengxiaolian') {
      const k = sxlMinPick();
      const combos = expandFushi(sxlPicked, k);
      if (!combos.length) return { err: `请至少选择 ${k} 个生肖` };
      const tag = sxlBetTag();
      return { plays: combos.map((c) => `复式${tag}${c.join(',')}`) };
    }
    if (cat.mode === 'weishulian') {
      const k = wslMinPick();
      const combos = expandFushi(wslPicked.map(Number), k);
      if (!combos.length) return { err: `请至少选择 ${k} 个尾` };
      const tag = wslBetTag();
      return { plays: combos.map((c) => `复式${tag}${c.map((t) => `${t}尾`).join(',')}`) };
    }
    if (cat.mode === 'liuxiao') {
      if (liuxiaoPicked.length !== 6) return { err: '请选择 6 个生肖' };
      const sub = LIUXIAO_SUBS[liuxiaoSubIdx] || LIUXIAO_SUBS[0];
      const tag = sub === '不中' ? '六肖不中' : '六肖中';
      return { plays: [`${tag} ${liuxiaoPicked.join(',')}`] };
    }
    if (cat.mode === 'heXiao') {
      const n = heXiaoTabIdx + 2;
      const tab = HEXIAO_TABS[heXiaoTabIdx] || HEXIAO_TABS[0];
      if (heXiaoPicked.length !== n) return { err: `合肖请选满 ${n} 个生肖` };
      return { plays: [`合肖${tab}${heXiaoPicked.join(',')}`] };
    }
    if (cat.mode === 'duoxuan') {
      const n = dxbzPicked.length;
      if (n < 5 || n > 12) return { err: '自选不中请选 5～12 个号码' };
      const cn = BUZHONG_CN[n];
      const nums = dxbzPicked.map((x) => pad(+x, 2)).join(',');
      return { plays: [`复式${cn}不中${nums}`] };
    }
    return { err: '当前玩法不支持' };
  }

  /**
   * 玩法面板里的「重复」：把上次的玩法重新点选回来，金额也填回去但仍可改，
   * 不关面板、不写聊天框。想直接发上次那单请用键盘里的「重复」。
   * 组合玩法（生肖/多号码）没有可靠的回填口，退回填输入框。
   */
  function repeatLastBetInPlayPanel() {
    const snap = lastPanelPick;
    if (!snap || !snap.plays.length) {
      fillLastBetsToInput();
      return;
    }
    if (!$('#playSheet').hasClass('is-open')) openPlaySheet(true);

    playCatIdx = snap.catIdx;
    $('#playNav .lhc-play-nav__item').removeClass('is-active');
    $('#playNav .lhc-play-nav__item[data-idx="' + playCatIdx + '"]').addClass('is-active');
    renderPlayPanel();

    playSelectedList = snap.plays.slice();
    playAllin = !!snap.allin;
    if (!playAllin && snap.amount > 0) {
      setPlayAmount(snap.amount);
      clearPlayAmountChipActive();
      $('#playAmountChips .lhc-play-foot__chip[data-amt="' + snap.amount + '"]').addClass('is-active');
    }
    syncPlayAmountUI();
    updatePlaySelected();
    App.toast('已点选上次玩法 · ' + snap.plays.length + '项');
  }

  function submitPlayBet() {
    const cat = currentPlayCat();
    if (!isBettingOpen()) {
      toastBetBlocked('bet');
      return;
    }
    let plays = [];
    if (isComboPlayMode(cat.mode)) {
      const built = buildComboBetPlays();
      if (built.err) {
        App.toast(built.err);
        return;
      }
      plays = built.plays;
      /*
       * 组合玩法（生肖 / 多号码那类）的选中状态不在 playSelectedList 里，
       * 硬恢复会点错，所以这类不存快照，「重复」时退回填输入框。
       */
      lastPanelPick = null;
    } else {
      if (!playSelectedList.length) {
        App.toast('请先选择玩法');
        return;
      }
      plays = playSelectedList.slice();
      /* 普通玩法存面板快照，供「重复」原样点回来（金额仍可改） */
      lastPanelPick = {
        plays: plays.slice(),
        catIdx: playCatIdx,
        amount: unitAmount(),
        allin: !!playAllin,
      };
    }
    let resolved;
    if (playAllin) {
      resolved = resolveBetAmounts(plays, '梭哈');
      if (!resolved) { App.toast('余额不足，无法梭哈'); return; }
    } else {
      const amount = unitAmount();
      if (!amount) {
        App.toast('请输入有效金额');
        return;
      }
      resolved = resolveBetAmounts(plays, String(amount));
      if (!resolved) {
        App.toast('请输入有效金额');
        return;
      }
      const bal = App.getBalance(user.uid);
      const total = resolved.reduce((s, b) => s + b.amount, 0);
      if (total > bal) { App.toast('余额不足'); return; }
    }
    const expanded = [];
    resolved.forEach((l) => {
      const b = parseBet(l.play + ' ' + l.amount);
      if (b) expanded.push(b);
    });
    if (!expanded.length) {
      App.toast('玩法无效，请重新选择');
      return;
    }
    const mapped = mapLinesToServerBets(expanded);
    if (mapped.unsupported.length) {
      App.toast('无法识别：' + mapped.unsupported.slice(0, 3).join('、') + '（请检查口令或到玩法面板点选）');
      return;
    }
    if (!mapped.bets.length) {
      App.toast('暂无可用玩法');
      return;
    }
    if (mapped.bets.length > 50) {
      App.toast('单次最多 50 注，请减少组合后再下（当前 ' + mapped.bets.length + ' 注）');
      return;
    }
    if (!App.placeLotteryBets) {
      App.toast('请从大厅进入游戏');
      return;
    }
    App.placeLotteryBets(SERVER_GAME, mapped.bets, { chatText: expanded.map(function (l) { return l.play + '/' + l.amount; }).join(' ') }).then(function () {
      refreshStats();
      const ok = [];
      expanded.forEach((b) => {
        const line = b.play + ' ' + b.amount;
        if (recordBet(user.name, line)) ok.push(line);
      });
      syncRoomChat(false);
      rememberBetLines(ok);
      playSelectedList = [];
      ballQuickKeys.clear();
      clearComboPicksForMode(cat.mode);
      playCatState[cat.id] = { list: [], quick: [] };
      playAllin = false;
      syncPlayAmountUI();
      openPlaySheet(false);
      App.toast(`投注成功 · ${ok.length}注`);
    }).catch(function (e) {
      App.toast((e && e.message) || '下注失败');
    });
  }

  function ballNumsByQuick(key) {
    if (!/^[鼠牛虎兔龙蛇马羊猴鸡狗猪]$/.test(key)) return [];
    return Array.from({ length: 49 }, (_, i) => i + 1).filter((n) => zodiacOf(n) === key);
  }
  /** 特码两面属性对应号码（不含 49，与和局规则一致） */
  function ballNumsBySide(side) {
    return Array.from({ length: 48 }, (_, i) => i + 1).filter((n) => matchSide(side, sideOfTema(n)));
  }

  /** 按当前已激活的快捷键，重算本玩法前缀下的选号（多选并集） */
  function rebuildBallQuickSelection() {
    const cat = currentPlayCat();
    const prefix = cat.prefix || '特码';
    const union = new Set();
    ballQuickKeys.forEach((key) => {
      ballNumsByQuick(key).forEach((n) => union.add(prefix + pad(n, 2)));
    });
    playSelectedList = playSelectedList.filter((p) => !String(p).startsWith(prefix));
    union.forEach((p) => playSelectedList.push(p));
  }

  /** 点击快捷：多选开关；再点同一键取消该项，可同时开多个 */
  function applyBallQuick(key) {
    if (!key) return;
    if (ballQuickKeys.has(key)) ballQuickKeys.delete(key);
    else ballQuickKeys.add(key);
    rebuildBallQuickSelection();
    renderBallsPanel();
    updatePlaySelected();
  }

  function waveBallClass(n) {
    const w = waveColor(n);
    if (w === '红') return 'is-red';
    if (w === '蓝') return 'is-blue';
    return 'is-green';
  }

  function renderPlayNav() {
    $('#playNav').html(PLAY_CATEGORIES.map((c, i) =>
      `<button type="button" class="lhc-play-nav__item${i === playCatIdx ? ' is-active' : ''}" data-idx="${i}">${c.title}</button>`
    ).join(''));
  }

  function renderBallsPanel() {
    const cat = currentPlayCat();
    const odds = cat.odds != null ? cat.odds : ODDS.tema;
    const prefix = cat.prefix || '特码';
    const nSel = playSelectedList.filter(p => String(p).startsWith(prefix)).length;
    const qn = ballQuickKeys.size;
    const hintExtra = qn
      ? ` · 已开 ${qn} 个快捷 · 共选 ${nSel} 个`
      : (nSel ? ` · 已选 ${nSel} 个` : ' · 生肖快捷可多选，号码取并集');
    $('#playHint').text((typeof cat.hint === 'function' ? cat.hint() : (cat.hint || '')) + hintExtra);
    $('#playSub').prop('hidden', false).removeClass('is-stack').addClass('is-ball-quick').html(
      `<div class="lhc-play-quick-grid">${BALL_QUICK.map(q =>
        `<button type="button" class="lhc-play-quick ${q.cls || ''}${ballQuickKeys.has(q.key) ? ' is-active' : ''}" data-quick="${q.key}">${q.key}</button>`
      ).join('')}</div>`
    );
    const balls = Array.from({ length: 49 }, (_, i) => {
      const n = i + 1;
      const play = prefix + pad(n, 2);
      const on = isPlaySelected(play);
      return `<button type="button" class="lhc-play-ball lhc-play-ball--cell${on ? ' is-on' : ''}" data-num="${n}">
        ${ballHtml(n, 'play')}<small>${odds}</small>
      </button>`;
    }).join('');
    $('#playGrid').attr('class', 'lhc-play-panel__grid is-sectioned').html(
      `<div class="lhc-play-section"><div class="lhc-play-section__title">${cat.title || prefix}</div><div class="lhc-play-section__grid is-num3">${balls}</div></div>`
    );
  }

  function lianmaMode() {
    return LIANMA_MODES[lianmaModeIdx] || LIANMA_MODES[0];
  }
  function lianmaPlay() {
    return LIANMA_PLAYS[lianmaPlayIdx] || LIANMA_PLAYS[0];
  }
  function lianmaPlaysForMode(mode) {
    return LIANMA_DUIPENG_MODES.has(mode) ? LIANMA_PLAYS_ER : LIANMA_PLAYS;
  }
  function ensureLianmaPlayValid() {
    const plays = lianmaPlaysForMode(lianmaMode());
    if (!plays.includes(lianmaPlay())) {
      lianmaPlayIdx = LIANMA_PLAYS.indexOf(plays[0]);
      if (lianmaPlayIdx < 0) lianmaPlayIdx = 0;
    }
  }
  function lianmaMinPick() {
    const play = lianmaPlay();
    if (play === '四全中') return 4;
    if (play === '三全中' || play === '三中二') return 3;
    return 2;
  }
  function lianmaTogglePick(val, side) {
    const s = String(val);
    const mode = lianmaMode();
    if (mode === '任意对碰') {
      const list = side === 'B' ? lianmaPickedB : lianmaPickedA;
      const other = side === 'B' ? lianmaPickedA : lianmaPickedB;
      const i = list.indexOf(s);
      if (i >= 0) list.splice(i, 1);
      else if (other.indexOf(s) >= 0) {
        App.toast('A/B 组球号不可重复');
        return;
      } else list.push(s);
      renderLianmaPanel(false);
      return;
    }
    if (mode === '生肖对碰' && /^[鼠牛虎兔龙蛇马羊猴鸡狗猪]$/.test(s) && !lianmaPicked.includes(s) && lianmaPicked.filter(v => /^[鼠牛虎兔龙蛇马羊猴鸡狗猪]$/.test(v)).length >= 2) {
      App.toast('生肖对碰请选 2 个生肖');
      return;
    }
    if (mode === '尾数对碰' && /^\d$/.test(s) && !lianmaPicked.includes(s) && lianmaPicked.filter(v => /^\d$/.test(v)).length >= 2) {
      App.toast('尾数对碰请选 2 个尾');
      return;
    }
    const i = lianmaPicked.indexOf(s);
    if (i >= 0) lianmaPicked.splice(i, 1);
    else lianmaPicked.push(s);
    renderLianmaPanel(false);
  }

  function renderLianmaPanel(resetPick) {
    if (resetPick !== false) {
      lianmaPicked = [];
      lianmaPickedA = [];
      lianmaPickedB = [];
      lianmaPengSide = 'A';
    }
    /* 官方连码盘面仅玩法页签 + 复式选号 */
    lianmaModeIdx = 0;
    const play = lianmaPlay();
    const min = lianmaMinPick();
    const oddsTxt = lianmaPlayOddsText(play);
    let hint = '';
    if (play === '三中二') hint = `三中二: ${ODDS.sanZhongEr} · 三全中: ${ODDS.sanZhongSan}`;
    else if (play === '二中特') hint = `二全中: ${ODDS.erZhongTe} · 二中特: ${ODDS.erZhongTeTe}`;
    else hint = `${play}: ${oddsTxt}`;
    $('#playHint').text(hint);

    setPlaySubBar(buildLmBar({
      plays: LIANMA_PLAYS,
      playRow: 'play',
      playCols: 3,
      playDataIdx: (p) => LIANMA_PLAYS.indexOf(p),
      isPlayActive: (p) => LIANMA_PLAYS.indexOf(p) === lianmaPlayIdx,
    }));

    const picked = new Set(lianmaPicked);
    const body = Array.from({ length: 49 }, (_, i) => {
      const n = i + 1;
      const key = String(n);
      const on = picked.has(key);
      return `<button type="button" class="lhc-play-ball lhc-play-ball--pick${on ? ' is-on' : ''}" data-lianma="${key}">${ballHtml(n, 'play')}</button>`;
    }).join('');
    $('#playGrid').attr('class', 'lhc-play-panel__grid is-sectioned').html(
      sideSectionHtml(`${play}: ${oddsTxt || ''}`, body, 'is-num5')
    );
    updatePlaySelected();
  }


  /** 截图行内小球 */
  function miniBallsHtml(nums) {
    return `<span class="lhc-mini-balls">${(nums || []).map((n) => ballHtml(n, 'mini')).join('')}</span>`;
  }
  /** 分区格子单元格：标签 + 金色赔率（截图两列风格） */
  function sideCellHtml(play, label, extraCls) {
    const odds = playOddsLabel(play);
    const active = isPlaySelected(play);
    const cls = extraCls ? ` ${extraCls}` : '';
    return `<button type="button" class="lhc-play-item lhc-play-item--side${cls}${active ? ' is-active' : ''}" data-play="${play}"><span>${label}</span>${odds ? `<small>${odds}</small>` : ''}</button>`;
  }
  function sideSectionHtml(title, itemsHtml, gridCls) {
    return `<div class="lhc-play-section">${title ? `<div class="lhc-play-section__title">${title}</div>` : ''}<div class="lhc-play-section__grid ${gridCls || 'is-side'}">${itemsHtml}</div></div>`;
  }
  function renderSideSections(sections) {
    return (sections || []).map((sec) => {
      const cells = (sec.items || []).map((it) => sideCellHtml(it.play, it.label, it.cls || '')).join('');
      return sideSectionHtml(sec.title || '', cells, sec.grid || 'is-side');
    }).join('');
  }
  /** 整行：左标签+赔率，右小球（生肖/尾数/五行） */
  function ballRowHtml(opts) {
    const play = opts.play || '';
    const label = opts.label || '';
    const odds = opts.odds != null ? opts.odds : '';
    const nums = opts.nums || [];
    const active = !!opts.active;
    const yearCls = opts.year ? ' is-year' : '';
    const dataAttr = opts.dataAttr || (play ? `data-play="${play}"` : '');
    const roleCls = opts.roleCls || '';
    return `<button type="button" class="lhc-play-item lhc-play-item--row${yearCls}${roleCls}${active ? ' is-active' : ''}" ${dataAttr}><div class="lhc-side-main"><span>${label}</span>${odds !== '' && odds != null ? `<small>${odds}</small>` : ''}</div>${miniBallsHtml(nums)}</button>`;
  }
  function sxlRowOdds(z) {
    return sxLianOdds(sxlMinPick(), true, [z]);
  }
  function wslRowOdds(tail) {
    return wsLianOdds(wslMinPick(), true, [tail]);
  }


  function renderZongshuPanel() {
    const sub = ZONGSHU_SUBS[zongshuSubIdx] || ZONGSHU_SUBS[0];
    const isMiss = sub === '尾数不中';
    $('#playHint').text('');
    /* 官方平特尾数无子页；保留「尾数不中」作扩展时才显示子栏 */
    if (ZONGSHU_SUBS.length > 1) {
      setPlaySubBar(buildLmBar({
        modes: ZONGSHU_SUBS,
        modeIdx: zongshuSubIdx,
        modeRow: 'zongshu',
        modeCols: 2,
      }));
    } else {
      $('#playSub').prop('hidden', true).empty();
    }
    const cells = Array.from({ length: 10 }, (_, i) => {
      const play = isMiss ? `${i}尾不中` : `${i}尾`;
      return ballRowHtml({
        play,
        label: `${i}尾`,
        odds: playOddsLabel(play),
        nums: numsOfTail(i),
        active: isPlaySelected(play),
      });
    }).join('');
    $('#playGrid').attr('class', 'lhc-play-panel__grid is-sectioned').html(
      sideSectionHtml('平特尾数', cells, 'is-zx-row')
    );
    updatePlaySelected();
  }


  function renderItemsPanel(cat) {
    $('#playSub').prop('hidden', true).removeClass('is-stack is-lianma-sub is-ball-quick').empty();
    $('#playHint').text('');
    if (cat.layout === 'sideFlat') {
      const items = (cat.sections || []).flatMap((s) => s.items || []);
      const cells = items.map((it) => sideCellHtml(it.play, it.label, it.cls || '')).join('');
      $('#playGrid').attr('class', 'lhc-play-panel__grid is-sectioned').html(
        sideSectionHtml(cat.panelTitle || '', cells, 'is-side')
      );
      updatePlaySelected();
      return;
    }
    if (cat.layout === 'sideSections' && Array.isArray(cat.sections)) {
      $('#playGrid').attr('class', 'lhc-play-panel__grid is-sectioned').html(renderSideSections(cat.sections));
      updatePlaySelected();
      return;
    }
    if (cat.layout === 'wave') {
      const items = Array.isArray(cat.items) ? cat.items : [];
      const cells = items.map((it) => {
        let cls = it.cls || '';
        if (!cls) {
          if (String(it.label).includes('红')) cls = 'is-red';
          else if (String(it.label).includes('蓝')) cls = 'is-blue';
          else if (String(it.label).includes('绿')) cls = 'is-green';
        }
        return sideCellHtml(it.play, it.label, cls);
      }).join('');
      $('#playGrid').attr('class', 'lhc-play-panel__grid is-sectioned').html(
        sideSectionHtml(cat.panelTitle || '', cells, 'is-wave')
      );
      updatePlaySelected();
      return;
    }
    const items = Array.isArray(cat.items) ? cat.items : [];
    $('#playHint').text(typeof cat.hint === 'function' ? cat.hint() : (cat.hint || ''));
    $('#playGrid').attr('class', 'lhc-play-panel__grid').html(items.map(it => {
      const play = typeof it === 'string' ? it : it.play;
      const label = typeof it === 'string' ? it : (it.label || it.play);
      const odds = playOddsLabel(play);
      const active = isPlaySelected(play);
      return `<button type="button" class="lhc-play-item${active ? ' is-active' : ''}" data-play="${play}"><span>${label}</span>${odds ? `<small>${odds}</small>` : ''}</button>`;
    }).join(''));
    updatePlaySelected();
  }

  function renderZodiacBallsPanel(cat) {
    const prefix = cat.playPrefix || '一肖';
    const oddsFn = cat.oddsFn || pingTeOdds;
    $('#playSub').prop('hidden', true).empty();
    $('#playHint').text('');
    const title = cat.title || '';
    const cells = LIANMA_ZODIAC.map((z) => {
      const play = prefix + z;
      return ballRowHtml({
        play,
        label: z,
        odds: oddsFn(z),
        nums: numsOfZodiac(z),
        active: isPlaySelected(play),
        year: z === yearZodiac(),
      });
    }).join('');
    $('#playGrid').attr('class', 'lhc-play-panel__grid is-sectioned').html(
      sideSectionHtml(title, cells, 'is-zx-row')
    );
    updatePlaySelected();
  }

  function renderZhengTePanel() {
    const pos = zhengTePosIdx + 1;
    const pCn = NUM_CN[pos] || String(pos);
    const prefix = `正${pCn}特`;
    $('#playHint').text('');
    setPlaySubBar(buildLmBar({
      modes: ZHENG_POS_TABS.map((t) => t + '特'),
      modeIdx: zhengTePosIdx,
      modeRow: 'zhengTe',
      modeCols: 6,
    }));
    const body = Array.from({ length: 49 }, (_, i) => {
      const n = i + 1;
      const play = `${prefix}${pad(n, 2)}`;
      const active = isPlaySelected(play);
      return `<button type="button" class="lhc-play-ball lhc-play-ball--cell${active ? ' is-on' : ''}" data-play="${play}">${ballHtml(n, 'play')}<small>${ODDS.zhengTe}</small></button>`;
    }).join('');
    $('#playGrid').attr('class', 'lhc-play-panel__grid is-sectioned').html(
      `<div class="lhc-play-section"><div class="lhc-play-section__title">正${pCn}特</div><div class="lhc-play-section__grid is-num3">${body}</div></div>`
    );
    updatePlaySelected();
  }

  function renderZheng16Panel() {
    const pos = zheng16PosIdx + 1;
    $('#playHint').text('');
    setPlaySubBar(buildLmBar({
      modes: ZHENG_POS_TABS.map((t, i) => '正码' + (i + 1)),
      modeIdx: zheng16PosIdx,
      modeRow: 'zheng16',
      modeCols: 6,
    }));
    /* 官方：单标题「正码N」下扁平两列，无两面/组合/合数/尾数分组 */
    const items = ZHENG16_SECTIONS(pos).flatMap((s) => s.items || []);
    const cells = items.map((it) => sideCellHtml(it.play, it.label, it.cls || '')).join('');
    $('#playGrid').attr('class', 'lhc-play-panel__grid is-sectioned').html(
      sideSectionHtml(`正码${pos}`, cells, 'is-side')
    );
    updatePlaySelected();
  }

  function renderZhengBoPanel() {
    const pos = zhengBoPosIdx + 1;
    const pCn = NUM_CN[pos] || String(pos);
    const colors = [
      { label: '红', play: `正${pCn}红波`, cls: 'is-red' },
      { label: '蓝', play: `正${pCn}蓝波`, cls: 'is-blue' },
      { label: '绿', play: `正${pCn}绿波`, cls: 'is-green' },
    ];
    $('#playHint').text('');
    setPlaySubBar(buildLmBar({
      modes: ZHENG_POS_TABS.map((t, i) => '正码' + (i + 1)),
      modeIdx: zhengBoPosIdx,
      modeRow: 'zhengBo',
      modeCols: 6,
    }));
    const cells = colors.map((it) => sideCellHtml(it.play, it.label, it.cls)).join('');
    $('#playGrid').attr('class', 'lhc-play-panel__grid is-sectioned').html(
      sideSectionHtml(`正码${pos}`, cells, 'is-wave')
    );
    updatePlaySelected();
  }

  function renderTemaTouWeiPanel() {
    $('#playSub').prop('hidden', true).empty();
    $('#playHint').text('');
    const heads = [0, 1, 2, 3, 4].map((h) => {
      const play = `${h}头`;
      return sideCellHtml(play, `${h}头`);
    }).join('');
    const tails = Array.from({ length: 10 }, (_, i) => {
      const play = `特${i}尾`;
      return ballRowHtml({
        play,
        label: `${i}尾`,
        odds: playOddsLabel(play),
        nums: numsOfTail(i),
        active: isPlaySelected(play),
      });
    }).join('');
    $('#playGrid').attr('class', 'lhc-play-panel__grid is-sectioned').html(
      sideSectionHtml('特码头数', heads, 'is-tou-head') +
      sideSectionHtml('特码尾数', tails, 'is-zx-row')
    );
    updatePlaySelected();
  }

  function heXiaoTogglePick(z) {
    const s = String(z);
    const n = heXiaoTabIdx + 2;
    const i = heXiaoPicked.indexOf(s);
    if (i >= 0) heXiaoPicked.splice(i, 1);
    else {
      if (heXiaoPicked.length >= n) {
        App.toast(`合肖${HEXIAO_TABS[heXiaoTabIdx]}需选 ${n} 个生肖`);
        return;
      }
      heXiaoPicked.push(s);
    }
    renderHeXiaoPanel(false);
  }
  function renderHeXiaoPanel(resetPick) {
    if (resetPick !== false) heXiaoPicked = [];
    const n = heXiaoTabIdx + 2;
    const tab = HEXIAO_TABS[heXiaoTabIdx] || HEXIAO_TABS[0];
    const odds = ODDS.heXiao[n] || 1;
    const picked = new Set(heXiaoPicked);
    $('#playHint').text(`赔率: ${odds}`);
    setPlaySubBar(buildLmBar({
      modes: HEXIAO_TABS,
      modeIdx: heXiaoTabIdx,
      modeRow: 'heXiao',
      modeCols: 4,
    }));
    const cells = LIANMA_ZODIAC.map((z) => ballRowHtml({
      label: z,
      nums: numsOfZodiac(z),
      active: picked.has(z),
      year: z === yearZodiac(),
      dataAttr: `data-hexiao="${z}"`,
    })).join('');
    $('#playGrid').attr('class', 'lhc-play-panel__grid is-sectioned').html(
      sideSectionHtml('', cells, 'is-zx-row')
    );
    updatePlaySelected();
  }

  function renderWuxingPanel() {
    const list = ['金', '木', '水', '火', '土'];
    $('#playSub').prop('hidden', true).empty();
    $('#playHint').text('');
    /* 官方五行盘面仅名称+赔率，不展示号码球 */
    const cells = list.map((wx) => sideCellHtml('五行' + wx, wx)).join('');
    $('#playGrid').attr('class', 'lhc-play-panel__grid is-sectioned').html(
      sideSectionHtml('五行', cells, 'is-side')
    );
    updatePlaySelected();
  }

  function sxlPlay() {
    return SXL_PLAYS[sxlPlayIdx] || SXL_PLAYS[0];
  }
  function sxlMinPick() {
    return sxlPlayIdx + 2;
  }
  function sxlBetTag() {
    return `${SXL_CN[sxlPlayIdx] || '二'}肖中`;
  }
  function sxlTogglePick(z) {
    const s = String(z);
    const i = sxlPicked.indexOf(s);
    if (i >= 0) sxlPicked.splice(i, 1);
    else sxlPicked.push(s);
    renderShengxiaolianPanel(false);
  }
  function renderShengxiaolianPanel(resetPick) {
    if (resetPick !== false) sxlPicked = [];
    const play = sxlPlay();
    const min = sxlMinPick();
    $('#playHint').text('');
    setPlaySubBar(buildLmBar({
      plays: SXL_PLAYS,
      playIdx: sxlPlayIdx,
      playRow: 'sxl-play',
      playCols: 4,
    }));
    const cells = LIANMA_ZODIAC.map((z) => ballRowHtml({
      label: z,
      odds: sxlRowOdds(z),
      nums: numsOfZodiac(z),
      year: z === yearZodiac(),
      active: sxlPicked.indexOf(z) >= 0,
      dataAttr: `data-sxl="${z}"`,
    })).join('');
    $('#playGrid').attr('class', 'lhc-play-panel__grid is-sectioned').html(
      sideSectionHtml(play, cells, 'is-zx-row')
    );
    updatePlaySelected();
  }

  function wslPlay() {
    return WSL_PLAYS[wslPlayIdx] || WSL_PLAYS[0];
  }
  function wslMinPick() {
    return wslPlayIdx + 2;
  }
  function wslBetTag() {
    return `${WSL_CN[wslPlayIdx] || '二'}尾中`;
  }
  function wslTogglePick(t) {
    const s = String(t);
    const i = wslPicked.indexOf(s);
    if (i >= 0) wslPicked.splice(i, 1);
    else wslPicked.push(s);
    renderWeishulianPanel(false);
  }
  function renderWeishulianPanel(resetPick) {
    if (resetPick !== false) wslPicked = [];
    const play = wslPlay();
    const min = wslMinPick();
    $('#playHint').text('');
    setPlaySubBar(buildLmBar({
      plays: WSL_PLAYS,
      playIdx: wslPlayIdx,
      playRow: 'wsl-play',
      playCols: 4,
    }));
    const cells = Array.from({ length: 10 }, (_, i) => {
      const t = String(i);
      return ballRowHtml({
        label: `${i}尾`,
        odds: wslRowOdds(i),
        nums: numsOfTail(i),
        active: wslPicked.indexOf(t) >= 0,
        dataAttr: `data-wsl="${t}"`,
      });
    }).join('');
    $('#playGrid').attr('class', 'lhc-play-panel__grid is-sectioned').html(
      sideSectionHtml(play, cells, 'is-zx-row')
    );
    updatePlaySelected();
  }

  function liuxiaoTogglePick(z) {
    const s = String(z);
    const i = liuxiaoPicked.indexOf(s);
    if (i >= 0) {
      liuxiaoPicked.splice(i, 1);
    } else {
      if (liuxiaoPicked.length >= 6) {
        App.toast('六肖最多选 6 个生肖');
        return;
      }
      liuxiaoPicked.push(s);
    }
    renderLiuxiaoPanel(false);
  }
  function renderLiuxiaoPanel(resetPick) {
    if (resetPick !== false) liuxiaoPicked = [];
    const sub = LIUXIAO_SUBS[liuxiaoSubIdx] || LIUXIAO_SUBS[0];
    const picked = new Set(liuxiaoPicked);
    $('#playHint').text(`六肖 · ${sub}（需选满 6 个生肖）`);
    setPlaySubBar(buildLmBar({
      modes: LIUXIAO_SUBS,
      modeIdx: liuxiaoSubIdx,
      modeRow: 'liuxiao',
      modeCols: 2,
    }));
    $('#playGrid').attr('class', 'lhc-play-panel__grid is-lianma-block').html(
      `<div class="lhc-lm-section">
        <div class="lhc-lm-section__hd">已选 ${liuxiaoPicked.length}/6</div>
        <div class="lhc-lm-section__grid is-zx">${LIANMA_ZODIAC.map(z =>
          `<button type="button" class="lhc-play-item${picked.has(z) ? ' is-active' : ''}" data-lx="${z}"><span>${z}</span></button>`
        ).join('')}</div>
      </div>`
    );
    updatePlaySelected();
  }

  function dxbzTogglePick(num) {
    const s = String(num);
    const i = dxbzPicked.indexOf(s);
    if (i >= 0) dxbzPicked.splice(i, 1);
    else {
      if (dxbzPicked.length >= 12) {
        App.toast('自选不中最多选 12 个号码');
        return;
      }
      dxbzPicked.push(s);
    }
    renderDuoxuanPanel(false);
  }
  function renderDuoxuanPanel(resetPick) {
    if (resetPick !== false) {
      dxbzPicked = [];
      dxbzGroups = [];
    }
    const n = dxbzPicked.length;
    const odds = n >= 5 && n <= 12 ? (ODDS.buZhong[n] || '') : '';
    $('#playHint').text(odds ? `赔率: ${odds}` : '选 5～12 个号码');
    $('#playSub').prop('hidden', true).empty();
    const picked = new Set(dxbzPicked);
    $('#playGrid').attr('class', 'lhc-play-panel__grid is-sectioned').html(
      sideSectionHtml('自选不中', Array.from({ length: 49 }, (_, i) => {
        const num = i + 1;
        const key = String(num);
        const on = picked.has(key);
        return `<button type="button" class="lhc-play-ball lhc-play-ball--pick${on ? ' is-on' : ''}" data-dxbz="${key}">${ballHtml(num, 'play')}</button>`;
      }).join(''), 'is-num5')
    );
    updatePlaySelected();
  }

  function renderPlayPanel(resetCombo) {
    const cat = currentPlayCat();
    const doReset = resetCombo !== false;
    if (doReset) ballQuickKeys.clear();
    if (cat.mode === 'balls') {
      renderBallsPanel();
      updatePlaySelected();
      return;
    }
    if (cat.mode === 'items') {
      renderItemsPanel(cat);
      return;
    }
    if (cat.mode === 'zodiacBalls') {
      renderZodiacBallsPanel(cat);
      return;
    }
    if (cat.mode === 'zhengTe') {
      renderZhengTePanel();
      return;
    }
    if (cat.mode === 'zheng16') {
      renderZheng16Panel();
      return;
    }
    if (cat.mode === 'zhengBo') {
      renderZhengBoPanel();
      return;
    }
    if (cat.mode === 'temaTouWei') {
      renderTemaTouWeiPanel();
      return;
    }
    if (cat.mode === 'heXiao') {
      renderHeXiaoPanel(doReset);
      return;
    }
    if (cat.mode === 'wuxing') {
      renderWuxingPanel();
      return;
    }
    if (cat.mode === 'lianma') {
      renderLianmaPanel(doReset);
      return;
    }
    if (cat.mode === 'zongshu') {
      renderZongshuPanel();
      updatePlaySelected();
      return;
    }
    if (cat.mode === 'shengxiaolian') {
      renderShengxiaolianPanel(doReset);
      return;
    }
    if (cat.mode === 'weishulian') {
      renderWeishulianPanel(doReset);
      return;
    }
    if (cat.mode === 'liuxiao') {
      renderLiuxiaoPanel(doReset);
      return;
    }
    if (cat.mode === 'duoxuan') {
      renderDuoxuanPanel(doReset);
      return;
    }
    $('#playSub').prop('hidden', true).removeClass('is-stack is-lianma-sub is-ball-quick').empty();
    $('#playGrid').html('<div class="lhc-play-panel__empty">具体玩法待添加</div>');
    updatePlaySelected();
  }

  function initPlaySheet() {
    renderPlayNav();
    $('#playAmountChips').html(AMOUNT_CHIPS.map((c) =>
      `<button type="button" class="lhc-play-foot__chip${c.amt === 100 ? ' is-active' : ''}" data-amt="${c.amt}" aria-label="${c.label}">` +
        `<span class="lhc-play-foot__chip-glow" aria-hidden="true"></span>` +
        `<img src="${CHIP_IMG(c.amt)}" alt="${c.label}" draggable="false">` +
      `</button>`
    ).join(''));
    syncPlayFootTotals();
    renderPlayPanel();
  }

  /* ================= 长龙 / 预测（只使用服务端历史） ================= */
  const MIN_LONG_STREAK = 2;
  const PREDICT_WINDOW = 20;
  const ROAD_WINDOW = 24;
  let longTab = 'side';
  let predictTab = 'side';

  function streakAtHead(labels) {
    if (!labels.length) return { tag: '', count: 0 };
    const tag = labels[0];
    let count = 1;
    for (let i = 1; i < labels.length; i++) {
      if (labels[i] === tag) count++;
      else break;
    }
    return { tag, count };
  }

  function temaAttrs(nums) {
    const n = nums[6];
    const he = digitSum(n);
    const tail = n % 10;
    const size = n >= 25 ? '大' : '小';
    const oe = n % 2 ? '单' : '双';
    const z = zodiacOf(n);
    return {
      size,
      oe,
      combo: size + oe,
      heSize: he >= 7 ? '合大' : '合小',
      heOe: he % 2 ? '合单' : '合双',
      wei: tail >= 5 ? '尾大' : '尾小',
      wave: waveColor(n) + '波',
      zodiac: z,
      zoo: POULTRY_ZODIAC.has(z) ? '家禽' : '野兽',
      num: n,
    };
  }

  function playForTag(tag) {
    if (['大', '小', '单', '双'].includes(tag)) return '特码' + tag;
    if (['大单', '大双', '小单', '小双'].includes(tag)) return '特' + tag;
    if (['红波', '蓝波', '绿波'].includes(tag)) return tag;
    if (['合大', '合小', '合单', '合双', '尾大', '尾小'].includes(tag)) return tag;
    if (/^[鼠牛虎兔龙蛇马羊猴鸡狗猪]$/.test(tag)) return '一肖' + tag;
    if (/^(?:0?[1-9]|[1-4][0-9])$/.test(String(tag))) {
      const num = +tag;
      if (num >= 1 && num <= 49) return '特码' + pad(num, 2);
    }
    return '';
  }

  function longTagClass(tag) {
    if (tag === '大' || tag === '合大' || tag === '尾大' || tag === '大单' || tag === '红波') return 'tag-red';
    if (tag === '小' || tag === '合小' || tag === '尾小' || tag === '小双' || tag === '蓝波') return 'tag-blue';
    if (tag === '单' || tag === '合单' || tag === '大双' || tag === '绿波') return 'tag-gold';
    if (tag === '双' || tag === '合双' || tag === '小单') return 'tag-purple';
    if (tag === '家禽') return 'tag-green';
    if (tag === '野兽') return 'tag-muted';
    if (/^[鼠牛虎兔龙蛇马羊猴鸡狗猪]$/.test(tag)) return 'tag-gold';
    return 'tag-muted';
  }

  function longTierClass(count) {
    if (count >= 5) return 'is-fire';
    if (count >= 3) return 'is-hot';
    return 'is-warm';
  }

  function longStreakBar(count) {
    return `<div class="lhc-long-item__bar"><span style="width:${Math.min(100, Math.round(count * 10))}%"></span></div>`;
  }

  function pushLongDim(list, group, labels) {
    const s = streakAtHead(labels);
    if (!s.tag) return;
    list.push({
      name: s.tag,
      group,
      count: s.count,
      play: playForTag(s.tag),
    });
  }

  function buildLongDragonGroups() {
    const rows = historyRows.filter(r => Array.isArray(r.nums) && r.nums.length === 7);
    const side = [];
    const color = [];
    const zodiac = [];
    if (!rows.length) return { side, color, zodiac };

    const attrs = rows.map(r => temaAttrs(r.nums));
    pushLongDim(side, '特码大小', attrs.map(a => a.size));
    pushLongDim(side, '特码单双', attrs.map(a => a.oe));
    pushLongDim(side, '特码组合', attrs.map(a => a.combo));
    pushLongDim(side, '合数大小', attrs.map(a => a.heSize));
    pushLongDim(side, '合数单双', attrs.map(a => a.heOe));
    pushLongDim(side, '特码尾数', attrs.map(a => a.wei));
    pushLongDim(side, '家禽野兽', attrs.map(a => a.zoo));
    pushLongDim(color, '特码色波', attrs.map(a => a.wave));
    pushLongDim(zodiac, '特码生肖', attrs.map(a => a.zodiac));
    pushLongDim(zodiac, '家禽野兽', attrs.map(a => a.zoo));

    const sortDesc = arr => arr.sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, 'zh'));
    return { side: sortDesc(side), color: sortDesc(color), zodiac: sortDesc(zodiac) };
  }

  function roadLabelsForTab(tab) {
    const rows = historyRows.filter(r => Array.isArray(r.nums) && r.nums.length === 7).slice(0, ROAD_WINDOW);
    if (tab === 'color') return rows.map(r => temaAttrs(r.nums).wave);
    if (tab === 'zodiac') return rows.map(r => temaAttrs(r.nums).zodiac);
    return rows.map(r => temaAttrs(r.nums).combo);
  }

  function roadHtml(labels) {
    if (!labels.length) return '';
    const chips = labels.map((tag, i) =>
      `<span class="lhc-long-road__chip ${longTagClass(tag)}${i === 0 ? ' is-latest' : ''}">${tag}</span>`
    ).join('');
    return `<div class="lhc-long-road"><div class="lhc-long-road__label">近 ${labels.length} 期走势 · 左新右旧</div><div class="lhc-long-road__row">${chips}</div></div>`;
  }

  function currentShapeHtml(items) {
    if (!items.length) return '';
    const cards = items.map(item => {
      const playAttr = item.play && parsePlay(item.play) ? ` data-predict-play="${item.play}"` : '';
      const clickable = playAttr ? ' is-clickable' : '';
      return `<div class="lhc-long-shape${clickable}"${playAttr} role="${playAttr ? 'button' : 'group'}"${playAttr ? ' tabindex="0"' : ''}>
        <span class="lhc-long-shape__group">${item.group}</span>
        <span class="lhc-long-shape__tag ${longTagClass(item.name)}">${item.name}</span>
        <span class="lhc-long-shape__count">${item.count}<small>连</small></span>
      </div>`;
    }).join('');
    return `<div class="lhc-long-shape-wrap"><div class="lhc-long-road__label">当前形态</div><div class="lhc-long-shape-grid">${cards}</div></div>`;
  }

  function renderLongDragonPanel() {
    const groups = buildLongDragonGroups();
    const all = groups[longTab] || [];
    const list = all.filter(x => x.count >= MIN_LONG_STREAK);
    const tabLabel = { side: '两面', color: '色波', zodiac: '生肖' }[longTab] || '';
    const rows = historyRows.filter(r => Array.isArray(r.nums) && r.nums.length === 7);

    if (!rows.length) {
      $('#longSummary').text(`${tabLabel} · 等待开奖`);
      $('#longBody').html(`
        <div class="lhc-long-empty">
          <div class="lhc-long-empty__icon">◎</div>
          <div class="lhc-long-empty__text">暂无开奖数据</div>
          <div class="lhc-long-empty__hint">接入官方开奖后会自动统计长龙</div>
        </div>`);
      return;
    }

    $('#longSummary').text(list.length
      ? `${tabLabel} · ${list.length} 条长龙 · 样本 ${rows.length} 期`
      : `${tabLabel} · 暂无 2 连以上 · 样本 ${rows.length} 期`);

    let hero = '';
    if (list.length) {
      const top = list[0];
      hero = `
        <div class="lhc-long-hero ${longTierClass(top.count)}">
          <div class="lhc-long-hero__label">当前最长</div>
          <div class="lhc-long-hero__main">
            <span class="lhc-long-hero__tag ${longTagClass(top.name)}">${top.name}</span>
            <span class="lhc-long-hero__text">${top.group}</span>
            <span class="lhc-long-hero__num">${top.count}</span>
            <span class="lhc-long-hero__unit">期</span>
          </div>
        </div>`;
    }

    const listHtml = list.length
      ? `<div class="lhc-long-list">${list.map((item, idx) => `
          <div class="lhc-long-item ${longTierClass(item.count)}${item.play && parsePlay(item.play) ? ' is-clickable' : ''}"${item.play && parsePlay(item.play) ? ` data-predict-play="${item.play}" role="button" tabindex="0"` : ''}>
            <div class="lhc-long-item__rank">${idx + 1}</div>
            <div class="lhc-long-item__tag ${longTagClass(item.name)}">${item.name}</div>
            <div class="lhc-long-item__info">
              <div class="lhc-long-item__name">${item.group}<span class="sep">·</span>${item.name}</div>
              ${longStreakBar(item.count)}
            </div>
            <div class="lhc-long-item__count"><b>${item.count}</b><small>连</small></div>
          </div>`).join('')}</div>`
      : `<div class="lhc-long-empty lhc-long-empty--soft">
          <div class="lhc-long-empty__text">暂无 2 期以上长龙</div>
          <div class="lhc-long-empty__hint">下方仍可看近期走势与当前形态</div>
        </div>`;

    $('#longBody').html(hero + roadHtml(roadLabelsForTab(longTab)) + currentShapeHtml(all) + listHtml);
  }

  function openLongSheet(open) {
    if (open) {
      openPredictSheet(false);
      longTab = 'side';
      $('#longTabs button').removeClass('is-active').filter('[data-tab="side"]').addClass('is-active');
      $('#longMask,#longSheet').prop('hidden', false);
      $('#longSheet').addClass('is-open');
      renderLongDragonPanel();
    } else {
      $('#longSheet').removeClass('is-open');
      $('#longMask').prop('hidden', true);
      setTimeout(() => { if (!$('#longSheet').hasClass('is-open')) $('#longSheet').prop('hidden', true); }, 300);
    }
  }

  function flipPredict(tag) {
    return ({
      大: '小', 小: '大', 单: '双', 双: '单',
      大单: '小双', 大双: '小单', 小单: '大双', 小双: '大单',
      合大: '合小', 合小: '合大', 合单: '合双', 合双: '合单',
      尾大: '尾小', 尾小: '尾大',
      红波: '蓝波', 蓝波: '红波', 绿波: '红波',
      家禽: '野兽', 野兽: '家禽',
    })[tag] || tag;
  }

  function trendPick(labels, streakBreak) {
    const recent = labels.slice(0, PREDICT_WINDOW);
    if (!recent.length) return { pick: '—', reason: '数据不足', confidence: 0 };
    const streak = streakAtHead(recent);
    const breakAt = streakBreak || 3;
    if (streak.count >= breakAt && streak.tag) {
      return {
        pick: flipPredict(streak.tag),
        reason: `已连续 ${streak.count} 期「${streak.tag}」，关注反转`,
        confidence: Math.min(88, 52 + streak.count * 9),
      };
    }
    const counts = {};
    recent.forEach(x => { counts[x] = (counts[x] || 0) + 1; });
    const pick = Object.keys(counts).sort((a, b) => counts[b] - counts[a] || a.localeCompare(b, 'zh'))[0] || '—';
    return {
      pick,
      reason: `近 ${recent.length} 期「${pick}」出现 ${counts[pick] || 0} 次`,
      confidence: Math.round(48 + ((counts[pick] || 0) / Math.max(1, recent.length)) * 42),
    };
  }

  function defaultPredictAmount() {
    return Math.max(1, parseInt($('#playAmount').val(), 10) || 100);
  }

  function fillPredictPlay(play) {
    const cmd = playForTag(play) || play;
    if (!cmd || !parsePlay(cmd)) return;
    const amount = defaultPredictAmount();
    $('#chatInput').val(`${cmd}/${amount}`);
    updateComposerAction();
    showKeypad(true);
    openPredictSheet(false);
    openLongSheet(false);
    App.toast(`已填入 ${cmd}/${amount}`);
  }

  function predictCardHtml(name, data) {
    const pct = Math.max(0, Math.min(100, data.confidence || 0));
    const play = playForTag(data.pick);
    const playAttr = play && parsePlay(play) ? ` data-predict-play="${play}"` : '';
    return `<div class="lhc-predict-card${playAttr ? ' is-clickable' : ''}"${playAttr} role="${playAttr ? 'button' : 'group'}"${playAttr ? ' tabindex="0"' : ''}>
      <div class="lhc-predict-card__name">${name}</div>
      <div class="lhc-predict-card__pick">
        <span class="lhc-predict-card__tag ${longTagClass(data.pick)}">${data.pick}</span>
        <span class="lhc-predict-card__conf">${pct}%</span>
      </div>
      <div class="lhc-predict-card__reason">${data.reason}</div>
      <div class="lhc-predict-card__bar"><span style="width:${pct}%"></span></div>
    </div>`;
  }

  function buildTemaHotCold(rows) {
    const window = Math.min(PREDICT_WINDOW, rows.length);
    const freq = Array(50).fill(0);
    const lastSeen = Array(50).fill(window);
    for (let i = 0; i < window; i++) {
      const n = rows[i].nums[6];
      if (n >= 1 && n <= 49) {
        freq[n]++;
        if (lastSeen[n] === window) lastSeen[n] = i;
      }
    }
    const hot = freq
      .map((c, n) => ({ n, c }))
      .filter(x => x.n >= 1)
      .sort((a, b) => b.c - a.c || a.n - b.n)
      .slice(0, 6)
      .filter(x => x.c > 0);
    const cold = lastSeen
      .map((gap, n) => ({ n, gap }))
      .filter(x => x.n >= 1)
      .sort((a, b) => b.gap - a.gap || a.n - b.n)
      .slice(0, 6);
    return { hot, cold, window };
  }

  function buildZodiacHotCold(rows) {
    const window = Math.min(PREDICT_WINDOW, rows.length);
    const order = zodiacOrder();
    const freq = {};
    const lastSeen = {};
    order.forEach(z => { freq[z] = 0; lastSeen[z] = window; });
    for (let i = 0; i < window; i++) {
      const z = temaAttrs(rows[i].nums).zodiac;
      freq[z] = (freq[z] || 0) + 1;
      if (lastSeen[z] === window) lastSeen[z] = i;
    }
    const hot = order.map(z => ({ z, c: freq[z] || 0 })).sort((a, b) => b.c - a.c).slice(0, 4).filter(x => x.c > 0);
    const cold = order.map(z => ({ z, gap: lastSeen[z] })).sort((a, b) => b.gap - a.gap).slice(0, 4);
    return { hot, cold, window };
  }

  function renderPredictPanel() {
    const rows = historyRows.filter(r => Array.isArray(r.nums) && r.nums.length === 7);
    const issue = $('#curIssue').attr('title') || getCurrentIssue();
    $('#predictSummary').text(`下一期 · ${issue}`);
    if (!rows.length) {
      $('#predictBody').html(`
        <div class="lhc-long-empty">
          <div class="lhc-long-empty__icon">◎</div>
          <div class="lhc-long-empty__text">暂无开奖数据</div>
          <div class="lhc-long-empty__hint">等待开奖后生成预测</div>
        </div>`);
      return;
    }

    const attrs = rows.map(r => temaAttrs(r.nums));

    if (predictTab === 'side') {
      const sizeData = trendPick(attrs.map(a => a.size));
      const oeData = trendPick(attrs.map(a => a.oe));
      const comboData = trendPick(attrs.map(a => a.combo), 4);
      const heSize = trendPick(attrs.map(a => a.heSize));
      const heOe = trendPick(attrs.map(a => a.heOe));
      const wei = trendPick(attrs.map(a => a.wei));
      const hero = `
        <div class="lhc-predict-hero">
          <div class="lhc-predict-hero__label">核心参考</div>
          <div class="lhc-predict-hero__main">
            <div class="lhc-predict-hero__tags">
              <span class="lhc-predict-card__tag ${longTagClass(sizeData.pick)} is-clickable" data-predict-play="${playForTag(sizeData.pick)}" role="button" tabindex="0">${sizeData.pick}</span>
              <span class="lhc-predict-card__tag ${longTagClass(oeData.pick)} is-clickable" data-predict-play="${playForTag(oeData.pick)}" role="button" tabindex="0">${oeData.pick}</span>
              <span class="lhc-predict-card__tag ${longTagClass(comboData.pick)} is-clickable" data-predict-play="${playForTag(comboData.pick)}" role="button" tabindex="0">${comboData.pick}</span>
            </div>
            <div class="lhc-predict-hero__note">特码倾向 ${sizeData.pick}${oeData.pick} · ${sizeData.reason}</div>
          </div>
        </div>`;
      $('#predictBody').html(hero + `<div class="lhc-predict-grid">
        ${predictCardHtml('特码 · 大小', sizeData)}
        ${predictCardHtml('特码 · 单双', oeData)}
        ${predictCardHtml('特码 · 组合', comboData)}
        ${predictCardHtml('合数 · 大小', heSize)}
        ${predictCardHtml('合数 · 单双', heOe)}
        ${predictCardHtml('特码 · 尾数', wei)}
      </div>`);
      return;
    }

    if (predictTab === 'color') {
      const waveData = trendPick(attrs.map(a => a.wave));
      const counts = {};
      attrs.slice(0, PREDICT_WINDOW).forEach(a => { counts[a.wave] = (counts[a.wave] || 0) + 1; });
      const colorCards = ['红波', '蓝波', '绿波'].map(c => {
        const hit = counts[c] || 0;
        const total = Math.min(PREDICT_WINDOW, attrs.length);
        return predictCardHtml(c, {
          pick: c,
          reason: `近 ${total} 期出现 ${hit} 次`,
          confidence: Math.round(30 + (hit / Math.max(1, total)) * 60),
        });
      }).join('');
      $('#predictBody').html(`
        <div class="lhc-predict-hero">
          <div class="lhc-predict-hero__label">色波参考</div>
          <div class="lhc-predict-hero__main">
            <div class="lhc-predict-hero__tags">
              <span class="lhc-predict-card__tag ${longTagClass(waveData.pick)} is-clickable" data-predict-play="${playForTag(waveData.pick)}" role="button" tabindex="0">${waveData.pick}</span>
            </div>
            <div class="lhc-predict-hero__note">${waveData.reason}</div>
          </div>
        </div>
        <div class="lhc-predict-grid">${predictCardHtml('综合倾向', waveData)}${colorCards}</div>`);
      return;
    }

    if (predictTab === 'zodiac') {
      const zData = trendPick(attrs.map(a => a.zodiac), 2);
      const zooData = trendPick(attrs.map(a => a.zoo));
      const stat = buildZodiacHotCold(rows);
      const hotHtml = stat.hot.map(x =>
        `<button type="button" class="lhc-predict-zx-btn" data-predict-play="${playForTag(x.z)}">${x.z}<small>${x.c}</small></button>`
      ).join('') || '<span class="lhc-predict-card__reason">—</span>';
      const coldHtml = stat.cold.map(x =>
        `<button type="button" class="lhc-predict-zx-btn is-cold" data-predict-play="${playForTag(x.z)}">${x.z}<small>漏${x.gap}</small></button>`
      ).join('');
      $('#predictBody').html(`
        <div class="lhc-predict-hero">
          <div class="lhc-predict-hero__label">生肖参考</div>
          <div class="lhc-predict-hero__main">
            <div class="lhc-predict-hero__tags">
              <span class="lhc-predict-card__tag ${longTagClass(zData.pick)} is-clickable" data-predict-play="${playForTag(zData.pick)}" role="button" tabindex="0">${zData.pick}</span>
              <span class="lhc-predict-card__tag ${longTagClass(zooData.pick)}">${zooData.pick}</span>
            </div>
            <div class="lhc-predict-hero__note">${zData.reason}</div>
          </div>
        </div>
        <div class="lhc-predict-grid">${predictCardHtml('一肖倾向', zData)}</div>
        <div class="lhc-predict-digit-col">
          <div class="lhc-predict-digit-col__label">热肖 · 近 ${stat.window} 期</div>
          <div class="lhc-predict-digit-balls">${hotHtml}</div>
          <div class="lhc-predict-digit-col__label">遗漏生肖</div>
          <div class="lhc-predict-digit-balls">${coldHtml}</div>
        </div>`);
      return;
    }

    /* hot */
    const stat = buildTemaHotCold(rows);
    const hotHtml = stat.hot.map(x =>
      `<button type="button" class="lhc-predict-num-btn ${waveBallClass(x.n)}" data-predict-play="${playForTag(x.n)}">${pad(x.n, 2)}<small>${x.c}次</small></button>`
    ).join('') || '<span class="lhc-predict-card__reason">—</span>';
    const coldHtml = stat.cold.map(x =>
      `<button type="button" class="lhc-predict-num-btn is-cold ${waveBallClass(x.n)}" data-predict-play="${playForTag(x.n)}">${pad(x.n, 2)}<small>漏${x.gap}</small></button>`
    ).join('');
    $('#predictBody').html(`
      <div class="lhc-predict-hero">
        <div class="lhc-predict-hero__label">特码热冷</div>
        <div class="lhc-predict-hero__note">近 ${stat.window} 期特码号码出现频次与遗漏，点号可填入</div>
      </div>
      <div class="lhc-predict-digit-col">
        <div class="lhc-predict-digit-col__label">热号</div>
        <div class="lhc-predict-digit-balls">${hotHtml}</div>
        <div class="lhc-predict-digit-col__label">冷号 / 遗漏</div>
        <div class="lhc-predict-digit-balls">${coldHtml}</div>
      </div>`);
  }

  function openPredictSheet(open) {
    if (open) {
      openLongSheet(false);
      predictTab = 'side';
      $('#predictTabs button').removeClass('is-active').filter('[data-tab="side"]').addClass('is-active');
      $('#predictMask,#predictSheet').prop('hidden', false);
      $('#predictSheet').addClass('is-open');
      renderPredictPanel();
    } else {
      $('#predictSheet').removeClass('is-open');
      $('#predictMask').prop('hidden', true);
      setTimeout(() => { if (!$('#predictSheet').hasClass('is-open')) $('#predictSheet').prop('hidden', true); }, 300);
    }
  }

  initKeypad();
  initPlaySheet();
  restoreBetBook();
  loadServerPayTable();
  startRoomChatPolling();

  function restoreClosedIssues() {
    try {
      const list = JSON.parse(localStorage.getItem(CLOSED_STORAGE_KEY) || '[]');
      if (Array.isArray(list)) closedIssues = new Set(list.slice(-120).map(String));
    } catch (e) { closedIssues = new Set(); }
  }
  function saveClosedIssues() {
    try { localStorage.setItem(CLOSED_STORAGE_KEY, JSON.stringify(Array.from(closedIssues).slice(-120))); } catch (e) { /* ignore */ }
  }
  function hydrateClosedFromChat() {
    /* 聊天里已有封盘/注单核对 → 视为已推过，进房不再重刷 */
    chatLog.forEach(function (m) {
      const html = String(m.html || '');
      if (!/(bot-close-line|bot-card--bets|bot-card--win)/.test(html)) return;
      const hit = html.match(/bot-card__issue[^>]*>([^<]+)</) || html.match(/close-line__issue[^>]*>([^<]+)</);
      if (hit && hit[1]) closedIssues.add(String(hit[1]).trim());
    });
    saveClosedIssues();
  }
  /** @returns {boolean} true = 首次封盘，需要推送封盘线 */
  function markIssueClosed(issue) {
    const id = String(issue || '');
    if (!id || closedIssues.has(id)) return false;
    closedIssues.add(id);
    saveClosedIssues();
    return true;
  }
  function hydrateRevealedFromChat() {
    /* 聊天里已有开奖/中奖卡 → 进房不再重推动画与二次结算 */
    chatLog.forEach(function (m) {
      const html = String(m.html || '');
      if (!/(result-card|bot-card--result|bot-card--win|is-reveal|is-settled|is-drawing)/.test(html)) return;
      let hit = html.match(/data-issue="([^"]+)"/);
      if (!hit) hit = html.match(/bot-card__issue[^>]*>([^<]+)</);
      if (!hit) hit = html.match(/result-card__issue[^>]*>([^<]+)</);
      if (hit && hit[1]) revealedIssues.add(String(hit[1]).trim());
    });
    saveRevealedIssues();
  }
  function restoreRevealedIssues() {
    try {
      const list = JSON.parse(localStorage.getItem(REVEALED_STORAGE_KEY) || '[]');
      if (Array.isArray(list)) revealedIssues = new Set(list.slice(-120).map(String));
    } catch (e) { revealedIssues = new Set(); }
    try {
      const played = JSON.parse(localStorage.getItem(PLAYED_ANIM_STORAGE_KEY) || '[]');
      if (Array.isArray(played)) playedAnimIssues = new Set(played.slice(-120).map(String));
    } catch (e2) { playedAnimIssues = new Set(); }
  }
  function saveRevealedIssues() {
    try { localStorage.setItem(REVEALED_STORAGE_KEY, JSON.stringify(Array.from(revealedIssues).slice(-120))); } catch (e) { /* ignore */ }
  }
  function parseServerHistory(history) {
    return (Array.isArray(history) ? history : []).map(function (row) {
      let nums = [];
      try { nums = JSON.parse(row.drawNumbers || '[]').map(Number); } catch (e) { nums = []; }
      return { issue: String(row.issueNo || ''), nums, gy: nums.length === 7 ? gyMeta(nums).text : '', lh: nums.length === 7 ? lhRow(nums) : '' };
    }).filter(r => r.issue && r.nums.length === 7);
  }

  function isCeremonyHolding() {
    try {
      const phase = roomChat && roomChat.getPhase ? roomChat.getPhase() : '';
      return phase === 'drawing' || phase === 'revealing' || phase === 'settled';
    } catch (e) { return false; }
  }
  function upsertHistoryHeadFromDraw(issue, nums) {
    const iss = String(issue || '').trim();
    if (!iss || !Array.isArray(nums) || nums.length !== 7) return null;
    const row = {
      issue: iss,
      nums: nums.slice(),
      gy: typeof gyMeta === 'function' ? gyMeta(nums).text : '',
      lh: typeof lhRow === 'function' ? lhRow(nums) : '',
    };
    const idx = historyRows.findIndex(function (r) { return String(r.issue) === iss; });
    if (idx >= 0) historyRows[idx] = Object.assign({}, historyRows[idx], row);
    else historyRows.unshift(row);
    if (historyRows.length > 80) historyRows.length = 80;
    return row;
  }
  /** 滚号/揭晓中：顶栏压上一期；号码揭完后立刻跟历史头（含 snapshot 轮询勿再压回去） */
  function pickDrawBarRow(rows) {
    if (!rows || !rows.length) return null;
    try {
      const phase = roomChat && roomChat.getPhase ? String(roomChat.getPhase() || '') : '';
      const hold = roomChat && roomChat.getPhaseIssue ? String(roomChat.getPhaseIssue() || '') : '';
      const revealed = isDrawBarUnlocked(hold) ||
        !!(roomChat && roomChat.isRevealReady && roomChat.isRevealReady(hold));
      if (!revealed && (phase === 'drawing' || phase === 'revealing') && hold && String(rows[0].issue) === hold) {
        return rows[1] || null;
      }
    } catch (e) { /* ignore */ }
    return rows[0];
  }
  /**
   * 号码落定：只刷顶部历史栏。
   * 开盘线 / 顶栏倒计时要等尾动画播完 → notifyDrawCeremonyReady。
   */
  let drawBarRevealIssue = '';
  let drawCeremonyReadyIssue = '';
  function notifyDrawBarNumbersReady(issue, nums, expectLen) {
    try {
      const iss = String(issue || '').trim();
      const need = expectLen > 0 ? expectLen : 0;
      if (Array.isArray(nums) && (!need || nums.length === need)) {
        lastDraw = nums.slice();
        if (iss && typeof upsertHistoryHeadFromDraw === 'function') {
          upsertHistoryHeadFromDraw(iss, nums);
        }
      }
      if (iss) drawBarRevealIssue = iss;
      if (typeof paintDrawBarAfterReveal === 'function') paintDrawBarAfterReveal(iss);
    } catch (e) { /* ignore */ }
  }
  /** 尾动画结束：中奖核对 → 开盘线 → 解冻 → 顶栏倒计时 */
  function notifyDrawCeremonyReady(issue) {
    try {
      const iss = String(issue || '').trim();
      if (iss && drawCeremonyReadyIssue === iss) return;
      if (iss) drawCeremonyReadyIssue = iss;
      if (roomChat && typeof roomChat.advanceReveal === 'function') {
        roomChat.advanceReveal(iss);
      }
      if (typeof refreshAfterServerSettle === 'function') refreshAfterServerSettle();
      if (iss && typeof applyRoomWinVerifyMineLine === 'function') applyRoomWinVerifyMineLine(iss);
      if (typeof requestLotteryResync === 'function') requestLotteryResync();
      else if (typeof syncServerSnapshot === 'function') syncServerSnapshot();
      if (typeof tick === 'function') {
        try { tick(); } catch (eTick) { /* ignore */ }
      }
      [200, 600, 1200].forEach(function (ms) {
        setTimeout(function () {
          try {
            if (typeof refreshAfterServerSettle === 'function') refreshAfterServerSettle();
            if (iss && typeof applyRoomWinVerifyMineLine === 'function') applyRoomWinVerifyMineLine(iss);
            if (typeof requestLotteryResync === 'function') requestLotteryResync();
            if (typeof tick === 'function') tick();
          } catch (e2) { /* ignore */ }
        }, ms);
      });
    } catch (e) { /* ignore */ }
  }
  function isDrawBarUnlocked(issue) {
    const iss = String(issue || '').trim();
    return !!(iss && drawBarRevealIssue && drawBarRevealIssue === iss);
  }
  /** 结果卡号码已出齐：顶栏马上对齐，不跟中奖核对/开盘线抢时间 */
  function paintDrawBarAfterReveal(issueHint) {
    try {
      const iss = String(issueHint || '').trim();
      if (iss && lastDraw && lastDraw.length === 7 && typeof upsertHistoryHeadFromDraw === 'function') {
        upsertHistoryHeadFromDraw(iss, lastDraw);
      }
      let row = null;
      if (iss && Array.isArray(historyRows)) {
        row = historyRows.find(function (r) { return String(r.issue) === iss; }) || null;
      }
      if (!row && historyRows && historyRows[0]) row = historyRows[0];
      if (row && typeof renderDrawBar === 'function') renderDrawBar(row);
      if (typeof flashDrawBarReveal === 'function') flashDrawBarReveal();
      if (typeof renderDrawTable === 'function') renderDrawTable();
    } catch (e) { /* ignore */ }
  }

  function syncServerSnapshot() {
    if (snapshotBusy || !App.fetchLotterySnapshot) return;
    /* 父页 init 未到时发快照会被丢弃并卡 6s 超时，表现为一直「同步中」 */
    if (window.parent !== window && !App._bridgeReady) return;
    snapshotBusy = true;
    App.fetchLotterySnapshot(SERVER_GAME).then(function (snapshot) {
      /* 先校时：后面所有与 lockAt / openAt 的比较都要用校准后的钟 */
      if (snapshot && window.LotteryClock) {
        LotteryClock.sync(snapshot.serverNow, snapshot.sentAt, snapshot.recvAt);
      }
      /* 先标记已同步，避免后续渲染异常把整页永远钉在「同步中」 */
      serverSynced = true;
      App._lhcServerSynced = true;
      syncServerSnapshot._fail = 0;
      try {
        const rows = parseServerHistory(snapshot && snapshot.history);
        historyRows = rows;
        try {
          const holdIss = roomChat && roomChat.getPhaseIssue ? String(roomChat.getPhaseIssue() || '') : '';
          if (
            holdIss &&
            (isDrawBarUnlocked(holdIss) || (roomChat && roomChat.isRevealReady && roomChat.isRevealReady(holdIss))) &&
          lastDraw && lastDraw.length === 7
          ) {
            upsertHistoryHeadFromDraw(holdIss, lastDraw);
          }
        } catch (eKeepHead) { /* ignore */ }
        if (rows.length) {
          const holdNow = roomChat && roomChat.getPhaseIssue ? String(roomChat.getPhaseIssue() || '') : '';
        if (!(isDrawBarUnlocked(holdNow) || (roomChat && roomChat.isRevealReady && roomChat.isRevealReady(holdNow)))) {
          lastDraw = rows[0].nums.slice();
        } else if (!lastDraw || !lastDraw.length) {
            lastDraw = rows[0].nums.slice();
          }
          const barRow = pickDrawBarRow(historyRows);
          if (barRow) {
            try { renderDrawBar(barRow); } catch (eBar) { /* ignore */ }
          }
        } else if (typeof renderDrawBar === 'function') {
          try { renderDrawBar(null); } catch (eBar2) { /* ignore */ }
        }
        const current = snapshot && snapshot.current;
        if (current && current.issueNo) {
          serverCurrent = current;
          App._lhcServerCurrent = current;
        } else if (serverCurrent) {
          const _st = String(serverCurrent.status || '');
          const _openAt = new Date(serverCurrent.openAt).getTime();
          if (_st !== 'PENDING' && _st !== 'LOCKED' && Number.isFinite(_openAt) && srvNow() >= _openAt) {
            serverCurrent = null;
            App._lhcServerCurrent = null;
          }
        }
        try { renderDrawTable(); } catch (eTbl) { /* ignore */ }
        if (!isCeremonyHolding() && serverCurrent && serverCurrent.issueNo) {
          try { setIssueEl($('#curIssue'), serverCurrent.issueNo); } catch (eIss) { /* ignore */ }
        }
        try { settleRestoredResultCards(); } catch (eSettle) { /* ignore */ }
        try { holdBlackLockedResultCards(); } catch (eHold) { /* ignore */ }
        if (rows[0]) {
          const holdIss = roomChat && roomChat.getPhaseIssue ? String(roomChat.getPhaseIssue() || '') : '';
          if (!(isCeremonyHolding() && holdIss && String(rows[0].issue) === holdIss)) {
            revealedIssues.add(rows[0].issue);
            saveRevealedIssues();
          }
          historyHeadBootstrapped = true;
        }
        if ($('#longSheet').hasClass('is-open')) {
          try { renderLongDragonPanel(); } catch (eLong) { /* ignore */ }
        }
        if ($('#predictSheet').hasClass('is-open')) {
          try { renderPredictPanel(); } catch (ePred) { /* ignore */ }
        }
      } catch (e) { /* keep synced flag */ }
      if (typeof tick === 'function') try { tick(); } catch (e2) { /* ignore */ }
    }).catch(function () {
      /* 桥接失败：指数退避，避免打爆父页 */
      if (!serverSynced) {
        const fails = (syncServerSnapshot._fail = (syncServerSnapshot._fail || 0) + 1);
        const wait = Math.min(8000, 800 * Math.pow(2, Math.min(fails, 3)));
        setTimeout(function () {
          if (!serverSynced && !snapshotBusy && typeof syncServerSnapshot === 'function') syncServerSnapshot();
        }, wait);
      }
    }).finally(function () { snapshotBusy = false; });
  }

  function tick() {
    /* App 标记为权威：避免双闭包 / 异常路径导致本地 serverSynced 永远 false */
    if (App._lhcServerSynced) serverSynced = true;
    if (App._lhcServerCurrent) serverCurrent = App._lhcServerCurrent;
    const phase = roomChat && roomChat.getPhase ? roomChat.getPhase() : '';
    /*
     * 仪式中（含出号后尾动画）：顶栏保持「开奖中」。
     * 倒计时与开盘线一起，等 finishToBetting 回到 betting 再放。
     */
    if (phase === 'drawing' || phase === 'revealing' || phase === 'settled') {
      const hold = roomChat.getPhaseIssue ? String(roomChat.getPhaseIssue() || '') : '';
      if (hold) {
        if (typeof setCurIssueDisplay === 'function') setCurIssueDisplay(hold);
        else if (typeof setIssueEl === 'function') setIssueEl($('#curIssue'), hold);
        else $('#curIssue').text(hold);
      }
      updateCountdownDrawing();
      return;
    }
    if (serverSynced && serverCurrent) {
      const lockAt = new Date(serverCurrent.lockAt).getTime();
      const cutoff = betCutoffAt(lockAt);
      const issueCur = String(serverCurrent.issueNo || '');
      const status = String(serverCurrent.status || '');
      const now = srvNow();
      /* 倒计时归零点与停止接单点对齐，玩家看到 0 的那一刻正好点不动 */
      const open = status === 'PENDING' && now < cutoff;
      setCurIssueDisplay(issueCur);
      if (open) {
        updateCountdownUI(Math.max(0, (cutoff - now) / 1000) + PREP_SEC);
        if (roomBetFrozen && sealedIssueNo && issueCur && issueCur !== sealedIssueNo) {
          roomBetFrozen = false;
          sealedIssueNo = '';
        }
      } else if (status === 'LOCKED' || (status === 'PENDING' && now >= cutoff)) {
        /*
         * 停止接单到服务端封盘之间的提前量窗口也走这里，
         * 否则这不到一秒会掉进「等待开盘」分支，每局闪一下。
         */
        updateCountdownDrawing();
        if (Number.isFinite(new Date(serverCurrent.openAt).getTime()) &&
            now >= new Date(serverCurrent.openAt).getTime()) {
          requestLotteryResync();
        }
      } else {
        const $labelWait = $('#cdLabel');
        if ($labelWait.length) $labelWait.text('等待开盘');
        const $boxWait = $('#countdownBox').removeClass('is-preparing is-betting is-freeze is-urgent is-drawing').addClass('is-preparing');
        $boxWait.attr('aria-label', '等待开盘');
        if (typeof renderCountdownDigits === 'function') renderCountdownDigits(0);
        $('#cdPrep').attr('hidden', true).hide();
        $('#cdDigits').removeAttr('hidden').css('display', '').show();
        requestLotteryResync();
      }
      return;
    }
    if (serverSynced) {
      if (typeof setCurIssueDisplay === 'function') setCurIssueDisplay('--------');
      else if (typeof setIssueEl === 'function') setIssueEl($('#curIssue'), '--------');
      else $('#curIssue').text('--------');
      const $labelWait = $('#cdLabel');
      if ($labelWait.length) $labelWait.text('等待开盘');
      const $boxWait = $('#countdownBox').removeClass('is-preparing is-betting is-freeze is-urgent is-drawing').addClass('is-preparing');
      $boxWait.attr('aria-label', '等待开盘');
      if (typeof renderCountdownDigits === 'function') renderCountdownDigits(0);
      return;
    }
    if (typeof setCurIssueDisplay === 'function') setCurIssueDisplay('--------');
    else if (typeof setIssueEl === 'function') setIssueEl($('#curIssue'), '--------');
    else $('#curIssue').text('--------');
    const $label = $('#cdLabel');
    if ($label.length) $label.text('同步中');
    const $box = $('#countdownBox').removeClass('is-preparing is-betting is-freeze is-urgent is-drawing').addClass('is-betting');
    $box.attr('aria-label', '房间同步中');
    if (typeof renderCountdownDigits === 'function') renderCountdownDigits(0);
    $('#cdPrep').prop('hidden', true);
    $('#cdDigits').removeAttr('hidden').css('display', '').show();
  }
  setInterval(tick, 1000);
  restoreRevealedIssues();
  restoreClosedIssues();
  hydrateClosedFromChat();
  hydrateRevealedFromChat();
  App.resyncLottery = function () {
    snapshotBusy = false;
    if (typeof syncServerSnapshot === 'function') syncServerSnapshot();
  };
  /* 父页 init 早于本文件时补拉；已 ready 则立刻同步（链式，保留 room-chat 的 ready） */
  var _prevOnAssetsGameReady = App.onAssetsGameReady;
  App.onAssetsGameReady = function (data) {
    snapshotBusy = false;
    if (typeof syncServerSnapshot === 'function') syncServerSnapshot();
    if (typeof _prevOnAssetsGameReady === 'function') {
      try { _prevOnAssetsGameReady(data); } catch (eReady) { /* ignore */ }
    }
  };
  if (App._pendingResyncLottery || App._bridgeReady) {
    App._pendingResyncLottery = false;
    App.resyncLottery();
  }
  if (App.startAdaptiveInterval) {
    App.startAdaptiveInterval(syncServerSnapshot, 2000, 5000, { runNow: !!App._bridgeReady });
  } else {
    if (App._bridgeReady) syncServerSnapshot();
    setInterval(syncServerSnapshot, 2000);
  }
  /* robot bets from server room chat */

  tick();

  /* 用户首次交互解锁开奖音效（浏览器自动播放策略） */
  $(document).one('pointerdown keydown', function () {
    if (window.LhcAudio && LhcAudio.unlock) LhcAudio.unlock();
  });

  // ===== 事件 =====
  $('#backBtn').on('click', () => {
    if (App.backToLobby) App.backToLobby();
    else App.go('../../client-app/pages/game-lobby/game-lobby.html' + q);
  });

  layoutRail();
  $(window).on('resize orientationchange', function () { layoutRail(); });
  if (typeof ResizeObserver !== 'undefined') {
    const roomEl = document.querySelector('.lhc-room');
    if (roomEl) {
      try {
        new ResizeObserver(function () { layoutRail(); }).observe(roomEl);
      } catch (e) { /* ignore */ }
    }
  }
  
  /* 右侧四钮：默认收起，点梯子展开/收起 */
  (function initRailLadder() {
    const KEY = 'lhc_rail_collapsed';
    const room = document.querySelector('.lhc-room');
    const btn = document.getElementById('btnRailToggle');
    if (!room || !btn) return;
    let collapsed = true;
    try {
      const saved = localStorage.getItem(KEY);
      if (saved === '0') collapsed = false;
      if (saved === '1') collapsed = true;
    } catch (e) { /* ignore */ }
    function apply() {
      room.classList.toggle('is-rail-collapsed', collapsed);
      btn.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
      btn.title = collapsed ? '展开菜单' : '收起菜单';
      const arrow = btn.querySelector('.lhc-rail-ladder__arrow');
      if (arrow) arrow.textContent = collapsed ? '▼' : '▲';
      try { localStorage.setItem(KEY, collapsed ? '1' : '0'); } catch (e) { /* ignore */ }
      if (typeof layoutRail === 'function') layoutRail();
    }
    apply();
    btn.addEventListener('click', function (e) {
      e.preventDefault();
      e.stopPropagation();
      collapsed = !collapsed;
      apply();
    });
  })();

/* === chat-rail handlers (lhc) === */

  /** 官方条文（V66 幸运六合彩游戏规则弹窗），只展示当前玩法 */
  function playCatRulesHtml(cat) {
    const id = (cat && cat.id) || '';
    const map = {
      tema: '● 特码：从49个号码中选择1个号码，所选号码与开奖的特码相同，即中奖。<br><br>投注【01】；开奖号码：*,*,*,*,*,*,01，特码为01，即中奖。',
      temaSide: '● 特码两面：选择1个形态(大:25-48；小:01-24；单:个位数1,3,5,7,9；双:个位数0,2,4,6,8)，与开奖号码中特码的形态相同，即中奖。开出特码49时为和局，退还本金。<br><br>● 特码形态：大单/大双/小单/小双。开出特码49时为和局，退还本金。<br><br>● 特码合数：合大≥7、合小≤6、合单/合双。开出特码49时为和局，退还本金。<br><br>● 特码尾数：尾大5~9、尾小0~4。开出特码49时为和局，退还本金。',
      temaColor: '● 特码色波：将49个号码划分为红、蓝、绿三种颜色，投注色波与特码颜色相同即中奖。<br><br>● 特码半波 / 半半波：色波与大小或单双组合；开出特码49时为和局，退还本金。',
      texiao: '● 特码生肖：用十二生肖当年的年龄，对应1~49球号。选择1个生肖，当开奖特码在该生肖号码范围内，即中奖。本命年生肖号码较多，赔率较低。',
      zhengma: '● 正码：当期开出的前六个号码为正码。选择1个号码，开奖正码包含投注号码即中奖。',
      zhengTe: '● 正码特：开奖号码第1～第6个为正一特～正六特。选择一个正码位置与1个号码，所选号码与该位置开奖号码一致即中奖。',
      zheng16: '● 正码1～6两面/形态/合数/尾数：选择正码位置与形态。该位置开出49时为和局，退还本金。',
      zhengBo: '● 正波：选择一个正码位置与1个色波，与对应位置开出的正码波色相同即中奖。',
      pingTe: '● 平特一肖：选择1个生肖，开奖7个号码所对应生肖包含该生肖即中奖。不论同生肖出现次数，派彩只派一次。',
      pingWei: '● 平特尾数：选择1个尾数，开奖7个号码所对应尾数包含该尾数即中奖。不论同尾数出现次数，派彩只派一次。',
      shengxiaolian: '● 连肖：二连肖～五连肖。复式组合，所选生肖须全部出现在开奖七码（含特码）中；含本命肖取本命赔率。',
      weishulian: '● 连尾：二连尾～五连尾。复式组合，所选尾数须全部出现在开奖七码中；五连尾含0尾取更高赔率。',
      lianma: '● 连码：四全中/三中二/三全中/二全中/二中特/特串。复式选号；三中二、二中特分两档派彩；特串须一正一特。',
      sumSide: '● 总和两面：与当期开出的前六个号码总和形态相同即中奖。总和大≥150；总和小≤149；总和单双看总和个位。<br><br>● 总和尾数：以前六个号码总和个位数判断总尾大/小。',
      temaTouWei: '● 特码头尾数：特码头数看十位0～4；特码尾数看个位0～9。当期开奖特码符合所选项即中奖。',
      heXiao: '● 特码合肖：选择2～11个生肖为一组合，当开奖特码生肖在组合内即中奖。开出特码49时为和局，退还本金。',
      wuxing: '● 五行：选择1个五行属性，开奖特码在投注的五行包含的号码范围内即中奖。',
      zhengXiao: '● 正肖：当期开奖前6个正码（不含特码），其中任一球号在下注生肖范围即中奖。如超过1个正码落在同肖范围内，派彩将自动倍增。',
      duoxuan: '● 自选不中：挑选5～12个号码为一注（选几个对应几不中赔率）。开奖7个号码都未落在所选号码中即中奖。',
    };
    const body = map[id] || '请在盘面点选投注项后确认投注；派彩以服务端为准。';
    return `<div class="lhc-rules-sec"><p>${body}</p></div>`;
  }

  function fullRulesHtml() {
    const o = ODDS;
    return `
        <div class="lhc-rules-sec">
          <h3 class="lhc-rules-sec__title">一、开奖与时间</h3>
          <p>幸运六合彩每期开出 <b>7</b> 个号码：正码 1～6 + <b>特码</b>，号码范围 <b>01～49</b>。</p>
          <p>每期共 <b>${INTERVAL} 秒</b>。顶栏「距封盘」；封盘后显示「开奖中」，不可下注、不可取消。</p>
          <p>开奖结果与派彩以服务端账本为准。本房间主要用「玩法」面板点选；输入框示例仅作口令参考。</p>
        </div>
        <div class="lhc-rules-sec">
          <h3 class="lhc-rules-sec__title">二、如何下注</h3>
          <p>推荐使用右侧 / 底部「玩法」面板点选后投注；也可在键盘区用快捷键：上分、取消、梭哈、重复、下分。</p>
          <span class="lhc-rules-ex">特码08/100　特码大/50　红波/100</span>
          <span class="lhc-rules-ex">正码31/80　一肖鼠/50　二全中 01,08/100</span>
          <p>「梭哈」按余额均分；玩法脚「重复」可跟上一笔。底部「+」含上下分、申请记录、竞猜报表等入口。</p>
        </div>
        <div class="lhc-rules-sec">
          <h3 class="lhc-rules-sec__title">三、玩法与赔率</h3>
          <p>下列为当前房间常用玩法赔率（随后台更新；连肖/不中等见面板分档）。派彩 = 金额 × 赔率（四舍五入到两位小数）。</p>
          <table class="lhc-rules-table">
            <thead><tr><th>玩法</th><th>说明</th><th>赔率</th></tr></thead>
            <tbody>
              <tr><td>特码 / 正码</td><td>特码号码 / 正码六个号中出现</td><td>${o.tema} / ${o.zhengma}</td></tr>
              <tr><td>特码两面 / 色波</td><td>两面、色波/半波/半半波</td><td>两面 ${o.side} · 红 ${o.colorRed} · 半波见盘面</td></tr>
              <tr><td>特码生肖 / 正肖</td><td>特码肖 / 正码任一同肖</td><td>特肖 ${o.zodiac} · 正肖 ${o.zhengXiao}</td></tr>
              <tr><td>正码特 / 正码1~6 / 正波</td><td>定位正码特、位两面、位色波</td><td>正码特 ${o.zhengTe} · 两面 ${o.zhengSide}</td></tr>
              <tr><td>平特一肖 / 平特尾</td><td>七码任一肖/尾；口令一肖X、N尾</td><td>${o.pingTe} / 0尾 ${o.weiShu0}</td></tr>
              <tr><td>连肖 / 连尾 / 连码</td><td>二～五连；连码含四全中等</td><td>见玩法面板 · 四全中 ${o.siQuanZhong}</td></tr>
              <tr><td>特码头尾数 / 合肖 / 五行</td><td>特码头尾；合肖二~十一（49和）；五行</td><td>0头 ${o.temaTou0} · 三合肖 ${o.heXiao[3]}</td></tr>
              <tr><td>总和两面 / 自选不中</td><td>前六正码总和（大≥150）；选 5～12 号全不中</td><td>${o.sumSide} · 五不中 ${o.buZhong[5]} 起</td></tr>
            </tbody>
          </table>
        </div>
        <div class="lhc-rules-sec">
          <h3 class="lhc-rules-sec__title">四、取消与结算</h3>
          <p>当期未封盘前可输入「取消」或点键盘「取消」，撤销本人本期未结算注单；封盘后不可取消。</p>
          <p>开奖后房间会推送结果卡与注单/中奖核对；积分变动以服务端派彩为准。顶部「输赢 / 流水 / 回水」为房间会话统计参考。</p>
        </div>
        <div class="lhc-rules-sec">
          <h3 class="lhc-rules-sec__title">五、温馨提示</h3>
          <ul>
            <li>请理性竞猜，注意自身资金安全</li>
            <li><b>高赔玩法单注限额</b>：赔率超过 500 倍的玩法（四全中 / 三全中）单注最高 50，超出会被退回并提示</li>
            <li>网络延迟可能导致倒计时与封盘线相差约 1～2 秒，以能否成功提交为准</li>
            <li>侧栏「记录」查看本游戏注单；底部「+」里的「竞猜报表」可看全部游戏</li>
            <li>长龙 / 预测仅供走势参考，不构成投注建议</li>
          </ul>
        </div>`;
  }

  function openRulesSheet(open, opts) {
    if (open) {
      const mode = (opts && opts.mode) || 'full';
      let title = '游戏规则';
      let html;
      if (mode === 'playCat') {
        const cat = currentPlayCat();
        title = cat.title || '玩法';
        html = playCatRulesHtml(cat);
      } else {
        html = fullRulesHtml();
      }
      $('#rulesTitle').text(title);
      $('#rulesBody').html(html);
      $('#rulesMask').prop('hidden', false);
      $('#rulesSheet').prop('hidden', false).addClass('is-open');
    } else {
      $('#rulesSheet').removeClass('is-open');
      $('#rulesMask').prop('hidden', true);
      setTimeout(() => { if (!$('#rulesSheet').hasClass('is-open')) $('#rulesSheet').prop('hidden', true); }, 280);
    }
  }

  function goBetRecords() {
    const sep = q.includes('?') ? '&' : '?';
    App.go('../../client-app/pages/bet-records/bet-records.html' + q + sep + 'game=lhc');
  }

  function goAllBetRecords() {
    App.go('../../client-app/pages/bet-records/bet-records.html' + q);
  }

  $('#btnCs').on('click', () => App.go('../../client-app/pages/cs/cs.html' + q));

  $('#btnExpand, #btnComposerPlay').on('click', () => openPlaySheet(true));
  $('#btnRules').on('click', () => openRulesSheet(true, { mode: 'full' }));
  $('#playSheetRules').on('click', () => openRulesSheet(true, { mode: 'playCat' }));
  $('#rulesSheetClose, #rulesMask').on('click', () => openRulesSheet(false));
  $('#btnRecords').on('click', () => goBetRecords());
  $('#playSheetClose, #playMask').on('click', () => openPlaySheet(false));

  $('#playNav').on('click', '.lhc-play-nav__item', function () {
    const next = +$(this).data('idx') || 0;
    if (next === playCatIdx) return;
    saveCurrentPlayCatState();
    playCatIdx = next;
    loadPlayCatState(currentPlayCat().id);
    $('#playNav .lhc-play-nav__item').removeClass('is-active');
    $(this).addClass('is-active');
    // false：切换分类不重置各玩法内部已选
    renderPlayPanel(false);
  });

  $('#playSub').on('click', '.lhc-play-mode, .lhc-play-type, .lhc-play-quick, .lhc-lm-mode, .lhc-lm-play, .lhc-lm-peng__btn', function () {
    const cat = currentPlayCat();
    const $btn = $(this);
    if ($btn.hasClass('lhc-play-quick') && cat.mode === 'balls') {
      applyBallQuick(String($btn.data('quick') || ''));
      return;
    }
    const row = String($btn.data('row') || '');
    const idx = +$btn.data('idx');
    if (cat.mode === 'lianma') {
      if (row === 'play') {
        lianmaPlayIdx = idx;
        renderLianmaPanel(true);
      }
      return;
    }
    if (cat.mode === 'zongshu' && row === 'zongshu') {
      zongshuSubIdx = idx;
      playSelectedList = [];
      renderZongshuPanel();
      updatePlaySelected();
      return;
    }
    if (cat.mode === 'zhengTe' && row === 'zhengTe') {
      zhengTePosIdx = idx;
      playSelectedList = [];
      renderZhengTePanel();
      return;
    }
    if (cat.mode === 'zheng16' && row === 'zheng16') {
      zheng16PosIdx = idx;
      playSelectedList = [];
      renderZheng16Panel();
      return;
    }
    if (cat.mode === 'zhengBo' && row === 'zhengBo') {
      zhengBoPosIdx = idx;
      playSelectedList = [];
      renderZhengBoPanel();
      return;
    }
    if (cat.mode === 'heXiao' && row === 'heXiao') {
      heXiaoTabIdx = idx;
      renderHeXiaoPanel(true);
      return;
    }
    if (cat.mode === 'shengxiaolian') {
      if (row === 'sxl-play') {
        sxlPlayIdx = idx;
        renderShengxiaolianPanel(true);
      }
      return;
    }
    if (cat.mode === 'weishulian') {
      if (row === 'wsl-play') {
        wslPlayIdx = idx;
        renderWeishulianPanel(true);
      }
      return;
    }
    if (cat.mode === 'liuxiao' && row === 'liuxiao') {
      liuxiaoSubIdx = idx;
      renderLiuxiaoPanel(true);
      return;
    }
  });

  $('#playGrid').on('click', '.lhc-play-ball[data-num]', function () {
    const cat = currentPlayCat();
    const play = (cat.prefix || '特码') + pad(+$(this).data('num'), 2);
    // 手动点号后不再跟快捷联动，避免重算覆盖
    ballQuickKeys.clear();
    togglePlaySelect(play);
    renderBallsPanel();
    updatePlaySelected();
  });

  $('#playGrid').on('click', '.lhc-play-ball[data-play]', function () {
    const play = String($(this).data('play'));
    togglePlaySelect(play);
    renderZhengTePanel();
  });

  $('#playGrid').on('click', '[data-lianma]', function () {
    lianmaTogglePick($(this).data('lianma'), $(this).data('side'));
  });

  $('#playGrid').on('click', '[data-sxl]', function () {
    sxlTogglePick($(this).data('sxl'));
  });

  $('#playGrid').on('click', '[data-wsl]', function () {
    wslTogglePick($(this).data('wsl'));
  });

  $('#playGrid').on('click', '[data-lx]', function () {
    liuxiaoTogglePick($(this).data('lx'));
  });

  $('#playGrid').on('click', '[data-hexiao]', function () {
    heXiaoTogglePick($(this).data('hexiao'));
  });

  $('#playGrid').on('click', '[data-dxbz]', function () {
    dxbzTogglePick($(this).data('dxbz'));
  });

  $('#playGrid').on('click', '.lhc-play-item[data-play]', function () {
    const play = String($(this).data('play'));
    togglePlaySelect(play);
    $(this).toggleClass('is-active', isPlaySelected(play));
    updatePlaySelected();
  });

  $('#playAmountChips').on('click', '.lhc-play-foot__chip', function () {
    const amt = +$(this).data('amt');
    setPlayAmount(amt);
    clearPlayAmountChipActive();
    $(this).addClass('is-active');
    syncPlayFootTotals();
    updatePlaySelected();
  });

  $('#playAmountAllin').on('click', function () {
    playAllin = !playAllin;
    syncPlayAmountUI();
    syncPlayFootTotals();
    updatePlaySelected();
  });

  $('#playAmount').on('input change', function () {
    if (playAllin) return;
    const v = parseInt($(this).val(), 10);
    clearPlayAmountChipActive();
    if (v > 0) {
      $(`#playAmountChips .lhc-play-foot__chip[data-amt="${v}"]`).addClass('is-active');
    }
    syncPlayFootTotals();
    updatePlaySelected();
  });

  $('#playClear').on('click', clearPlaySelection);
  $('#playRepeat').on('click', repeatLastBetInPlayPanel);
  $('#playSubmit').on('click', submitPlayBet);
  $('#btnLong').on('click', () => openLongSheet(true));
  $('#longSheetClose, #longMask').on('click', () => openLongSheet(false));
  $('#longTabs').on('click', 'button[data-tab]', function () {
    longTab = String($(this).data('tab'));
    $('#longTabs button').removeClass('is-active'); $(this).addClass('is-active');
    renderLongDragonPanel();
  });
  $('#btnPredict').on('click', () => openPredictSheet(true));
  $('#predictSheetClose, #predictMask').on('click', () => openPredictSheet(false));
  $('#predictTabs').on('click', 'button[data-tab]', function () {
    predictTab = String($(this).data('tab'));
    $('#predictTabs button').removeClass('is-active'); $(this).addClass('is-active');
    renderPredictPanel();
  });
  $('#longBody, #predictBody').on('click', '[data-predict-play]', function () {
    fillPredictPlay(String($(this).data('predict-play') || ''));
  });
  $('#longBody, #predictBody').on('keydown', '[data-predict-play]', function (e) {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      fillPredictPlay(String($(this).data('predict-play') || ''));
    }
  });

  $('#drawToggle').on('click', toggleDrawPanel);

  $('#chatInput').on('input', () => { composerAllin = false; updateComposerAction(); });
  $('#chatInput').on('focus', () => {
    openPlusMenu(false);
    setTimeout(() => showKeypad(true), 0);
  });
  $('#chatInput').on('click', function (e) {
    e.stopPropagation();
    try { this.focus({ preventScroll: true }); } catch (err) { this.focus(); }
    openPlusMenu(false);
    showKeypad(true);
  });

  $('#chatInput').on('keydown', function (e) {
    if (e.key === 'Enter') {
      e.preventDefault();
      sendBetMessage();
    }
  });

  $('#keyGrid').on('click', '.lhc-key', function () {
    const key = $(this).attr('data-key');
    if (key === '删除') return;
    insertInput(key);
  });
  $('#keyGrid').on('pointerdown', '.lhc-key', function (e) {
    if ($(this).attr('data-key') !== '删除') return;
    e.preventDefault();
    stopDeleteHold();
    insertInput('删除');
    delHoldTimer = setTimeout(() => {
      delHoldInterval = setInterval(() => insertInput('删除'), 55);
    }, 380);
  });
  $('#keyGrid').on('pointerup pointerleave pointercancel', '.lhc-key', function () {
    if ($(this).attr('data-key') === '删除') stopDeleteHold();
  });
  $(window).on('pointerup pointercancel', stopDeleteHold);

  $('#keypad').on('click', '[data-cmd]', function () {
    const cmd = $(this).data('cmd');
    if (cmd === 'cancel') {
      $('#chatInput').val('取消');
      updateComposerAction();
      return;
    }
    if (cmd === 'repeat') {
      fillLastBetsToInput();
      return;
    }
    if (cmd === 'allin') {
      applyAllinToInput();
      return;
    }
    if (cmd === 'topup') {
      $('#chatInput').val('上分');
      updateComposerAction();
      return;
    }
    if (cmd === 'withdraw') {
      $('#chatInput').val('下分');
      updateComposerAction();
      return;
    }
  });

  $('#plusBtn').on('click', function () {
    if ($('#chatInput').val().trim()) {
      sendBetMessage();
      return;
    }
    showKeypad(false);
    openPlusMenu(!$('#plusMenu').hasClass('is-open'));
  });

  $('#menuMask').on('click', () => openPlusMenu(false));

    const LINKS = {
    recharge: '/recharge',
    'apply-records': '/apply-records',
    'bet-records': '/bets',
    rebate: '/rebate',
    activities: '/activities',
    settings: '/settings',
  };

  $('#plusMenu').on('click', 'button', function () {
    const key = $(this).data('link');
    openPlusMenu(false);
    if (key === 'bet-records') {
      goAllBetRecords();
      return;
    }
    const url = LINKS[key];
    if (url) App.go(url + q);
    else App.toast('即将开放');
  });

  $(document).on('click', function (e) {
    if (Date.now() < keypadGuardUntil) return;
    if (!$(e.target).closest('#keypad, #chatInput, .lhc-composer').length && $('#keypad').is(':visible')) {
      if (!$(e.target).closest('.lhc-plus-menu, #plusBtn, .lhc-menu-mask').length) {
        showKeypad(false);
      }
    }
  });
  window.addEventListener('gamebox-balance', function () { refreshStats(); });
});
