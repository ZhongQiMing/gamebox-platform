/**
 * 游戏类型: lhc
 *
 * 幸运六合彩 · 聊天投注房
 */
$(function () {
  const GAME_TYPE = 'lhc';

  /** 与服务端开奖引擎一致：60 秒一局，封盘前 10 秒准备开奖。 */
  const INTERVAL = 60;
  const PREP_SEC = 10;
  const BET_SEC = INTERVAL - PREP_SEC;
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
  /** 头像池：001~162（022/078/086 为 png） */
  function avatarFromPool(seed) {
    const n = 1 + (Math.abs(Number(seed) || 0) % 162);
    const ext = (n === 22 || n === 78 || n === 86) ? 'png' : 'jpg';
    return `/images/avatars/${String(n).padStart(3, '0')}.${ext}`;
  }
  const ROBOT = { name: '机器人', avatar: '/images/avatars/001.jpg' };
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
  const REVEALED_STORAGE_KEY = 'lhc_revealed_v1';
  const CLOSED_STORAGE_KEY = 'lhc_closed_v1';
  let revealedIssues = new Set();
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
  const MOCK_NAMES = [];
  /** 当期注单：issue -> { 玩家名: [{ play, amount }] } */
  const issueBetBook = {};

  function getRoundRemain() {
    const elapsed = (Date.now() - todayStartMs()) / 1000;
    return INTERVAL - (elapsed % INTERVAL);
  }
  function getCurrentIssue() {
    if (serverSynced && serverCurrent && serverCurrent.issueNo) return String(serverCurrent.issueNo);
    const elapsed = (Date.now() - todayStartMs()) / 1000;
    return fmtIssue8(Math.floor(elapsed / INTERVAL) + 1);
  }
  function isBettingOpen() {
    if (!serverSynced || !serverCurrent) return false;
    const open = serverCurrent.status === 'PENDING' && Date.now() < new Date(serverCurrent.lockAt).getTime();
    if (!open) return false;
    /* 仅冻结「仍是封盘那一期」；已换新期以服务端 lockAt 为准 */
    if (roomBetFrozen && sealedIssueNo && String(serverCurrent.issueNo) === String(sealedIssueNo)) return false;
    return true;
  }
  function toastBetBlocked(kind) {
    if (!serverSynced) {
      App.toast('房间同步中，请稍候');
      return;
    }
    App.toast(kind === 'cancel' ? '封盘中，无法取消' : '封盘中，无法下注');
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
        status: r.winAmount > 0 ? 'WON' : 'LOST',
        profit: r.profit,
        winAmount: r.winAmount,
        hit: r.hit || '',
      };
      group.totalProfit += item.profit;
      return item;
    });
    saveUserBetLog(log);
  }

  function fmtProfit(n) {
    return (n >= 0 ? '+' : '') + n;
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
    ODDS.side = mulOf(pt, 'big', ODDS.side);
    ODDS.weiXiao = mulOf(pt, 'weiSideSmall', ODDS.weiXiao);
    ODDS.comboSide = mulOf(pt, 'combo', ODDS.comboSide);
    ODDS.colorRed = mulOf(pt, 'colorRed', ODDS.colorRed);
    ODDS.colorBlue = mulOf(pt, 'colorBlue', ODDS.colorBlue);
    ODDS.colorGreen = mulOf(pt, 'colorGreen', ODDS.colorGreen);
    ODDS.zodiac = mulOf(pt, 'zodiac', ODDS.zodiac);
    ODDS.zodiacYear = mulOf(pt, 'zodiacYear', ODDS.zodiacYear);
    ODDS.pingTe = mulOf(pt, 'pingTe', ODDS.pingTe);
    ODDS.pingTeYear = mulOf(pt, 'pingTeYear', ODDS.pingTeYear);
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
    ;[2, 3, 4, 5].forEach(function (n) {
      ODDS.sxLianZhong[n] = mulOf(pt, 'sxLianZhong' + n, ODDS.sxLianZhong[n]);
      ODDS.sxLianBuZhong[n] = mulOf(pt, 'sxLianBuZhong' + n, ODDS.sxLianBuZhong[n]);
    });
    ;[2, 3, 4].forEach(function (n) {
      ODDS.wsLianZhong[n] = mulOf(pt, 'wsLianZhong' + n, ODDS.wsLianZhong[n]);
      ODDS.wsLianBuZhong[n] = mulOf(pt, 'wsLianBuZhong' + n, ODDS.wsLianBuZhong[n]);
    });
    ;[5, 6, 7, 8, 9, 10, 11, 12].forEach(function (n) {
      ODDS.buZhong[n] = mulOf(pt, 'buZhong' + n, ODDS.buZhong[n]);
    });
  }

  /* ================= 玩法 · 赔率（本地兜底；启动后由服务端 pay-table 覆盖） ================= */
  const ODDS = {
    tema: 47,               // 特码
    temaB: 47,
    zhengma: 7,             // 平码（正码）
    zhengmaB: 7,
    side: 1.95,             // 两面 / 合数 / 尾大小
    weiXiao: 1.95,
    comboSide: 3.7,
    colorRed: 2.823,
    colorBlue: 3.003,
    colorGreen: 3.003,
    zodiac: 12.25,          // 特肖 非本命
    zodiacYear: 9.55,       // 特肖 本命
    pingTe: 2,              // 总肖项 / 一肖
    pingTeYear: 2,
    weiShu0: 2,             // 总数项 · 0尾（平特尾同此）
    weiShu: 1.8,            // 总数项 · 1~9尾
    weiShuMiss0: 2,         // 尾数不中 · 0尾
    weiShuMiss: 1.8,        // 尾数不中 · 1~9尾
    sumSide: 1.95,
    sumTail: 1.96,
    liuxiao: 1.95,
    erQuanZhong: 60,        // 二全中
    erZhongTe: 55,          // 二中特 · 中二
    erZhongTeTe: 25,        // 二中特 · 中特
    teChuan: 160,           // 特串
    sanQuanZhong: 600,      // 三全中
    sanZhongEr: 20,         // 三中二 · 中二
    sanZhongSan: 120,       // 三中二 · 中三
    sxLianZhong: { 2: 4, 3: 11, 4: 31, 5: 100 },
    sxLianBuZhong: { 2: 4, 3: 11, 4: 31, 5: 100 },
    wsLianZhong: { 2: 3.05, 3: 6.8, 4: 15.8 },
    wsLianBuZhong: { 2: 3.05, 3: 6.8, 4: 15.8 },
    buZhong: { 5: 2, 6: 2.5, 7: 3, 8: 3.5, 9: 4, 10: 5, 11: 6.2, 12: 7.6 },
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
  const CN_NUM = { 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10, 十一: 11, 十二: 12 };

  const MOCK_SIDES = ['大', '小', '单', '双'];
  const MOCK_COMBO = ['大单', '大双', '小单', '小双'];
  const MOCK_WAVE = ['红波', '蓝波', '绿波'];
  const MOCK_SUM = ['总和大', '总和小', '总和单', '总和双'];
  const MOCK_ZX = ZODIAC_CYCLE.slice();
  const MOCK_TAILS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];
  const ROBOT_COUNT = 10;
  const CN_LIAN = { 2: '二', 3: '三', 4: '四', 5: '五' };

  function pickOne(arr) {
    return arr[Math.floor(Math.random() * arr.length)];
  }
  function pickUnique(arr, n) {
    const copy = arr.slice();
    const out = [];
    while (out.length < n && copy.length) {
      out.push(copy.splice(Math.floor(Math.random() * copy.length), 1)[0]);
    }
    return out;
  }
  /** 各种金额都可能出现，不刻意凑整十/整百 */
  function pickAmt() {
    const w = Math.random();
    if (w < 0.4) return 10 + Math.floor(Math.random() * 90);   // 10~99
    if (w < 0.75) return 20 + Math.floor(Math.random() * 180);  // 20~199
    if (w < 0.92) return 50 + Math.floor(Math.random() * 250);  // 50~299
    return 100 + Math.floor(Math.random() * 400);               // 100~499
  }
  function pickBallNo() {
    return String(1 + Math.floor(Math.random() * 49)).padStart(2, '0');
  }
  function mockSxLian(amt) {
    const n = pickOne([2, 2, 2, 3, 3, 4]);
    const hit = Math.random() < 0.78 ? '中' : '不中';
    const zs = pickUnique(MOCK_ZX, n);
    return `复式${CN_LIAN[n]}肖${hit}${zs.join(',')} ${amt}`;
  }
  function mockWsLian(amt) {
    const n = pickOne([2, 2, 3, 3, 4]);
    const hit = Math.random() < 0.78 ? '中' : '不中';
    const tails = pickUnique(MOCK_TAILS, n);
    return `复式${CN_LIAN[n]}尾${hit}${tails.map(t => t + '尾').join(',')} ${amt}`;
  }
  function mockLianma(amt) {
    const play = pickOne(['二全中', '二全中', '二中特', '二中特', '特串', '三中二']);
    const need = (play === '三全中' || play === '三中二') ? 3 : 2;
    const nums = pickUnique(
      Array.from({ length: 49 }, (_, i) => String(i + 1).padStart(2, '0')),
      need,
    );
    return `复式${play}${nums.join(',')} ${amt}`;
  }
  /** 机器人下注：常用玩法（含特码号/生肖连/尾数连），不对冲 */
  function randomMockBetText() {
    const amt = pickAmt();
    const roll = Math.random();

    // 两面
    if (roll < 0.28) return `${pickOne(MOCK_SIDES)}${amt}`;
    // 组合两面
    if (roll < 0.4) return `${pickOne(MOCK_COMBO)}${amt}`;
    // 特码号
    if (roll < 0.54) {
      const no = pickBallNo();
      return Math.random() < 0.7 ? `${no}/${amt}` : `特码${no} ${amt}`;
    }
    // 总肖项 = 一肖（平特同义，口令统一一肖）
    if (roll < 0.64) {
      const z = pickOne(MOCK_ZX);
      return `一肖${z}${amt}`;
    }
    // 生肖连
    if (roll < 0.74) return mockSxLian(amt);
    // 尾数连
    if (roll < 0.84) return mockWsLian(amt);
    // 色波
    if (roll < 0.9) return `${pickOne(MOCK_WAVE)}${amt}`;
    // 连码
    if (roll < 0.95) return mockLianma(amt);
    // 总和
    if (roll < 0.98) return `${pickOne(MOCK_SUM)}${amt}`;
    // 偶尔两注（方向不冲突）
    const a = Math.random() < 0.6
      ? `${pickOne(MOCK_SIDES)}${pickAmt()}`
      : `${pickOne(MOCK_COMBO)}${pickAmt()}`;
    const b = Math.random() < 0.45
      ? `${pickBallNo()}/${pickAmt()}`
      : (Math.random() < 0.5 ? mockSxLian(pickAmt()) : `一肖${pickOne(MOCK_ZX)}${pickAmt()}`);
    return `${a}<br>${b}`;
  }

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
    return String(str || '').split(/[,，\s]+/).map(s => parseInt(s, 10)).filter(n => n >= 1 && n <= 49);
  }
  function parseZodiacList(str) {
    return String(str || '').split(/[,，\s]+/).filter(z => /^[鼠牛虎兔龙蛇马羊猴鸡狗猪]$/.test(z));
  }
  function parseTailList(str) {
    return String(str || '').split(/[,，\s]+/).map(s => {
      const m = String(s).match(/^(\d)/);
      return m ? +m[1] : NaN;
    }).filter(n => n >= 0 && n <= 9);
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
  function unitAmount() {
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
    // 连码：复式二全中01,08 / 二中特01,02
    if ((m = t.match(/^(复式|拖头|生肖对碰|尾数对碰|生尾对碰|任意对碰)?(二全中|二中特|特串|三全中|三中二)([\d,，]+)$/))) {
      const nums = parseNumList(m[3]);
      const need = (m[2] === '三全中' || m[2] === '三中二') ? 3 : 2;
      if (nums.length < need) return null;
      const oddsMap = {
        二全中: ODDS.erQuanZhong,
        二中特: ODDS.erZhongTe,
        特串: ODDS.teChuan,
        三全中: ODDS.sanQuanZhong,
        三中二: ODDS.sanZhongEr,
      };
      return { type: 'lianma', mode: m[1] || '复式', play: m[2], nums, odds: oddsMap[m[2]], odds2: m[2] === '二中特' ? ODDS.erZhongTeTe : (m[2] === '三中二' ? ODDS.sanZhongSan : 0) };
    }
    // 生肖连：复式二肖中鼠,牛
    if ((m = t.match(/^(复式|拖头)?([二三四五])肖(中|不中)([鼠牛虎兔龙蛇马羊猴鸡狗猪,，]+)$/))) {
      const n = CN_NUM[m[2]];
      const zs = parseZodiacList(m[4]);
      if (!n || zs.length < n) return null;
      const hit = m[3] === '中';
      const table = hit ? ODDS.sxLianZhong : ODDS.sxLianBuZhong;
      return { type: 'sxLian', mode: m[1] || '复式', n, hit, zodiacs: zs, odds: table[n] || 1 };
    }
    // 尾数连：复式二尾中0尾,1尾（无五尾）
    if ((m = t.match(/^(复式|拖头)?([二三四])尾(中|不中)((?:\d尾?[,，]*)+)$/))) {
      const n = CN_NUM[m[2]];
      const tails = parseTailList(m[4]);
      if (!n || tails.length < n) return null;
      const hit = m[3] === '中';
      const table = hit ? ODDS.wsLianZhong : ODDS.wsLianBuZhong;
      return { type: 'wsLian', mode: m[1] || '复式', n, hit, tails, odds: table[n] || 1 };
    }
    // 六肖中/不中
    if ((m = t.match(/^(六肖中|六肖不中)([鼠牛虎兔龙蛇马羊猴鸡狗猪,，]+)$/))) {
      const zs = parseZodiacList(m[2]);
      if (zs.length !== 6) return null;
      return { type: 'liuxiao', hit: m[1] === '六肖中', zodiacs: zs, odds: ODDS.liuxiao };
    }
    // 多选不中：复式五不中01,02,...
    if ((m = t.match(/^(复式|多组)?(十一|十二|五|六|七|八|九|十)不中([\d,，]+)$/))) {
      const n = CN_NUM[m[2]];
      const nums = parseNumList(m[3]);
      if (!n || nums.length < n) return null;
      return { type: 'buZhong', mode: m[1] || '复式', n, nums, odds: ODDS.buZhong[n] || 1 };
    }
    // 特码号码
    if ((m = t.match(/^(?:特码|特)(0?[1-9]|[1-4][0-9])$/))) {
      const num = +m[1];
      if (num < 1 || num > 49) return null;
      return { type: 'tema', num, odds: ODDS.tema };
    }
    // 正码号码
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
      return { type: 'heSide', side: m[1], odds: ODDS.side };
    }
    if ((m = t.match(/^(?:特码)?尾(大|小)$/) ) || (m = t.match(/^特尾(大|小)$/))) {
      return { type: 'weiSide', side: m[1], odds: m[1] === '小' ? ODDS.weiXiao : ODDS.side };
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
    // 总数项·尾数（平特尾同义）：七码含该尾；0尾 2 倍，其余 1.8
    if ((m = t.match(/^(?:平特)?([0-9])尾$/))) {
      const tail = +m[1];
      return { type: 'weiShu', tail, odds: tail === 0 ? ODDS.weiShu0 : ODDS.weiShu };
    }
    if ((m = t.match(/^(?:平特)?([0-9])尾不中$/))) {
      const tail = +m[1];
      return { type: 'weiShuMiss', tail, odds: tail === 0 ? ODDS.weiShuMiss0 : ODDS.weiShuMiss };
    }
    // 总肖项 / 一肖（七码任一）；平特与一肖同义；裸生肖同义
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
    if (p.type === 'temaCombo') return { betType: 'combo', betValue: p.combo };
    if (p.type === 'color') return { betType: 'color', betValue: p.color };
    if (p.type === 'temaZodiac' || p.type === 'pingZodiac') return { betType: p.type, betValue: p.z };
    if (p.type === 'heSide' || p.type === 'weiSide' || p.type === 'sumSide' || p.type === 'sumTail') return { betType: p.type, betValue: p.side };
    if (p.type === 'weiShu' || p.type === 'weiShuMiss') return { betType: p.type, betValue: String(p.tail) };
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
        parts = expandByMode(parsed.mode || '复式', parsed.nums, parsed.play === '三全中' || parsed.play === '三中二' ? 3 : 2)
          .map(nums => ({ play: `${parsed.mode || '复式'}${parsed.play}${nums.map(n => pad(n, 2)).join(',')}`, amount: l.amount }));
      } else if (parsed && parsed.type === 'sxLian') {
        parts = expandByMode(parsed.mode || '复式', parsed.zodiacs, parsed.n)
          .map(zs => ({ play: `${parsed.mode || '复式'}${NUM_CN[parsed.n]}肖${parsed.hit ? '中' : '不中'}${zs.join(',')}`, amount: l.amount }));
      } else if (parsed && parsed.type === 'wsLian') {
        parts = expandByMode(parsed.mode || '复式', parsed.tails, parsed.n)
          .map(ts => ({ play: `${parsed.mode || '复式'}${NUM_CN[parsed.n]}尾${parsed.hit ? '中' : '不中'}${ts.map(t => t + '尾').join(',')}`, amount: l.amount }));
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
    二中特: '二中特', 二全中: '二全中', 特串: '特串',
  };
  const LM_NEED = { 二全中: 2, 二中特: 2, 特串: 2, 三全中: 3, 三中二: 3 };

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

    // 键盘简口令：大各100 → 该属性下每个特码号各买
    let m = t.match(/^([大小单双])各(\d+)$/);
    if (m) {
      const lines = temaLines(ballNumsByQuick(m[1]), +m[2]);
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

    // J: 30,49,27,45,32,43复式二中特各5
    m = t.match(/^([\d,，]+)复式?(二中特|二全中|特串|三全中|三中二|三中三)各(\d+)$/);
    if (m) {
      const playName = LM_ALIAS[m[2]] || m[2];
      const nums = extractNums(m[1]);
      const amount = +m[3];
      const need = LM_NEED[playName];
      if (nums.length >= need && amount > 0) {
        const lines = expandFushi(nums, need).map(c => ({
          play: '复式' + playName + c.map(n => pad(n, 2)).join(','),
          amount,
        })).filter(l => parsePlay(l.play));
        if (lines.length) return lines;
      }
    }

    // I: 11,15,05三中三20
    m = t.match(/^([\d,，]+)(三中三|三全中|三中二|二中特|二全中|特串)(\d+)$/);
    if (m) {
      const playName = LM_ALIAS[m[2]] || m[2];
      const nums = extractNums(m[1]);
      const amount = +m[3];
      const need = LM_NEED[playName];
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
    const rem = bal - base * plays.length;
    return plays.map((play, i) => ({
      play,
      amount: base + (i === 0 ? rem : 0),
    }));
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
        parts = expandByMode(parsed.mode || '复式', parsed.nums, parsed.play === '三全中' || parsed.play === '三中二' ? 3 : 2)
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

  function ballHtml(n, cls) {
    const c = cls ? ' ' + cls : '';
    const num = String(n).padStart(2, '0');
    return `<img class="lhc-ball-img${c}" src="./assets/balls/ball_${num}.png" alt="${n}" loading="lazy">`;
  }
  /** 球号 + 生肖（历史表 / 开奖条） */
  function ballZodiacHtml(n, cls) {
    return `<span class="ball-wrap">${ballHtml(n, cls)}<span class="zx">${zodiacOf(n)}</span></span>`;
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
  function renderDrawBar(row) {
    if (!row) return;
    const meta = temaMeta(row.nums);
    setIssueEl($('#barIssue'), row.issue);
    $('#barBalls').html(row.nums.map(n => ballZodiacHtml(n, 'xs')).join(''));
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
  function resultCardHtml(nums, issue) {
    if (window.LhcResultCard && typeof LhcResultCard.build === 'function') {
      return LhcResultCard.build(nums, issue);
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

  /** 七球滚停大致时长（ms）；中奖核对兜底 = 此值 + 余量 */
  function resultRevealDurationMs() {
    return 2600;
  }

  function payoutResult(amount, odds, hitLabel) {
    const winAmount = Math.floor(amount * odds);
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
        winAmount += Math.floor(amount * r.odds);
      }
    });
    return {
      winAmount,
      profit: winAmount - stake,
      hit: hits ? `${hits}组` : '',
    };
  }

  /** 本地展示结算仅用于聊天统计；49 与服务端一致按大单正常结算。 */
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

    switch (p.type) {
      case 'tema':
        win = sp === p.num;
        break;
      case 'zhengma':
        win = zhengSet.has(p.num);
        break;
      case 'temaSide':
        win = matchSide(p.side, sideOfTema(sp));
        break;
      case 'temaCombo': {
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
        const hs = digitSum(sp);
        win = matchSide(p.side, { big: hs >= 7, odd: hs % 2 === 1 });
        break;
      }
      case 'weiSide': {
        const w = sp % 10;
        win = p.side === '大' ? w >= 5 : w <= 4;
        break;
      }
      case 'color':
        // 色波：49 仍结算（绿），不和
        win = waveColor(sp) === p.color;
        break;
      case 'sumSide': {
        const s = all.reduce((a, b) => a + b, 0);
        win = matchSide(p.side, { big: s >= 175, odd: s % 2 === 1 });
        break;
      }
      case 'sumTail': {
        const s = all.reduce((a, b) => a + b, 0) % 10;
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
        const need = (p.play === '三全中' || p.play === '三中二') ? 3 : 2;
        // 提交已拆成单注时 nums.length===need；聊天整串复式/拖头仍按 mode 展开
        const combos = expandByMode(p.mode || '复式', p.nums, need);
        return settleComboGroup(combos, amount, (balls) => {
          const hitZ = balls.filter(n => zhengSet.has(n)).length;
          const hitT = balls.filter(n => n === sp).length;
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
      case 'sxLian': {
        const combos = expandByMode(p.mode || '复式', p.zodiacs, p.n);
        return settleComboGroup(combos, amount, (zs) => {
          const hit = zs.filter(z => sxSet.has(z)).length;
          if (p.hit) return { win: hit >= zs.length, odds: p.odds };
          return { win: hit === 0, odds: p.odds };
        });
      }
      case 'wsLian': {
        const combos = expandByMode(p.mode || '复式', p.tails, p.n);
        return settleComboGroup(combos, amount, (ts) => {
          const hit = ts.filter(x => wsSet.has(x)).length;
          if (p.hit) return { win: hit >= ts.length, odds: p.odds };
          return { win: hit === 0, odds: p.odds };
        });
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

    if (!win) return { winAmount: 0, profit: -amount, hit: '' };
    return payoutResult(amount, odds, play);
  }
  const HISTORY_SHOW = 10;

  function settleIssue(issue, nums) {
    const book = roomBetBook(issue);
    if (!book) return {};
    const out = {};
    Object.keys(book).forEach(name => {
      out[name] = book[name].map(b => {
        const r = settleBet(b.play, b.amount, nums);
        return { play: b.play, amount: b.amount, ...r };
      });
    });
    return out;
  }

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
      return name + '  中奖金额：+' + totalWin + '\n' + hits.join('、') + '\n输赢：' + fmtProfit(totalProfit);
    });
    return issue + '期\n中奖核对\n——————————\n' + blocks.join('\n\n');
  }


  function closeNoticeHtml(issue) {
    return '<div class="lhc-bot-close-line"><div class="lhc-bot-close-line__bar"><span class="lhc-bot-close-line__deco"></span><span class="lhc-bot-close-line__text">封 盘 线</span><span class="lhc-bot-close-line__deco"></span></div><div class="lhc-bot-close-line__sub">第 <span class="lhc-bot-close-line__issue">' + issue + '</span> 期 · 停止下注 · 即将开奖</div></div>';
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
      return '<span class="lhc-bot-tag">' + g.label + '×' + g.count + '/' + g.amount + '</span>';
    }).join('');
    const userBlock = '<div class="lhc-bot-user is-me"><div class="lhc-bot-user__head"><span class="lhc-bot-user__name">我</span><span class="lhc-bot-user__sum">' + total + '</span></div><div class="lhc-bot-user__tags">' + tags + '</div></div>';
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
    if (myProfit === 0 && myWin > 0 && myWin === stake) winText = '和·退本 ' + myWin;
    else if (myWin > 0) winText = '中奖 +' + myWin;
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
      const tags = bets.map(function (b) { return '<span class="lhc-bot-tag">' + b.play + '/' + b.amount + '</span>'; }).join('');
      return '<div class="lhc-bot-user' + (name === user.name ? ' is-me' : '') + '"><div class="lhc-bot-user__head"><span class="lhc-bot-user__name">' + name + '</span><span class="lhc-bot-user__sum">' + total + '</span></div><div class="lhc-bot-user__tags">' + tags + '</div></div>';
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
      const winText = myWin > 0 ? ('中奖 +' + myWin) : '未中奖';
      mine = '<div class="lhc-bot-mine-line ' + profitCls + '"><span class="lhc-bot-mine-line__label">您本期</span><span class="lhc-bot-mine-line__win">' + winText + '</span><span class="lhc-bot-mine-line__profit">输赢 ' + fmtProfit(myProfit) + '</span></div>';
    }
    return '<div class="lhc-bot-card lhc-bot-card--win"><div class="lhc-bot-card__head"><span class="lhc-bot-card__title">中奖核对</span><span class="lhc-bot-card__issue">' + issue + '</span></div><div class="lhc-bot-card__body is-full">' + body + '</div>' + mine + '</div>';
  }

  function applyUserSettle(issue, settled) {
    const rows = settled[user.name];
    if (!rows) return;
    let profit = 0;
    let turnover = 0;
    rows.forEach(r => {
      profit += r.profit;
      turnover += r.amount;
      // 真派彩只由 server 账本完成；此处不再 setBalance
    });
    const stats = getStats(user.uid);
    stats.winloss += profit;
    stats.turnover += turnover;
    stats.rebate = (stats.rebate || 0) + Math.floor(turnover * 0.005);
    saveStats(user.uid, stats);
    settleUserBetLog(issue, lastDraw || [], rows);
    if (App.refreshBalance) {
      App.refreshBalance().then(function () { refreshStats(); });
    } else {
      refreshStats();
    }
  }


  function refineUserStatsFromServer(issue, list) {
    const bets = (list || []).filter(function (b) { return b && b.status !== 'CANCELLED' && b.status !== 'PENDING'; });
    if (!bets.length) return;
    const serverProfit = bets.reduce(function (s, b) { return s + serverBetProfit(b); }, 0);
    const serverTurnover = bets.reduce(function (s, b) { return s + (Number(b.amount) || 0); }, 0);
    const localRows = (issueBetBook[issue] && issueBetBook[issue][user.name]) || [];
    const localReal = localRows.filter(function (b) { return !b.mock; });
    let localProfit = 0;
    let localTurnover = 0;
    const nums = lastDraw || [];
    localReal.forEach(function (b) {
      const r = settleBet(b.play, b.amount, nums);
      localProfit += r.profit;
      localTurnover += b.amount;
    });
    const dProfit = serverProfit - localProfit;
    const dTurnover = serverTurnover - localTurnover;
    if (!dProfit && !dTurnover) return;
    const stats = getStats(user.uid);
    stats.winloss += dProfit;
    stats.turnover += dTurnover;
    stats.rebate = (stats.rebate || 0) - Math.floor(localTurnover * 0.005) + Math.floor(serverTurnover * 0.005);
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
    const $box = $('#countdownBox').removeClass('is-freeze is-preparing is-betting');
    const betRemain = r - PREP_SEC;
    let displaySec = Math.max(0, Math.ceil(betRemain));
    const inPrep = r <= PREP_SEC || displaySec <= 0;
    const $label = $('#cdLabel');
    if (inPrep) {
      $box.addClass('is-preparing');
      displaySec = Math.max(0, Math.ceil(Math.min(r, PREP_SEC)));
      if ($label.length) $label.text('距开奖');
      $box.attr('aria-label', '封盘中，距开奖 ' + fmtMmss(displaySec));
    } else {
      $box.addClass('is-betting');
      if ($label.length) $label.text('距封盘');
      $box.attr('aria-label', '距封盘 ' + fmtMmss(displaySec));
    }
    $('#cdDigits').prop('hidden', false).attr('aria-label', $box.attr('aria-label'));
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
    $('#statBalance').text(bal.toLocaleString('en-US'));
    $('#statTurnover').text(Math.round(s.turnover).toLocaleString('en-US'));
    const $wl = $('#statWinloss').text((s.winloss >= 0 ? '+' : '') + Math.round(s.winloss).toLocaleString('en-US'));
    $wl.toggleClass('is-plus', s.winloss > 0).toggleClass('is-minus', s.winloss < 0);
    $('#statRebate').text(Math.round(s.rebate).toLocaleString('en-US'));
    $('#playFootBalance').text(bal.toLocaleString('en-US'));
  }
  function scrollChat() {
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
    $('#chatFeed').append(html);
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
      // 兜底：未写回最终态的开奖卡，至少去掉滚动态
      if (String(html).indexOf('lhc-result-card') >= 0) {
        html = String(html)
          .replace(/\bis-drawing\b/g, 'is-reveal')
          .replace(/\bis-hidden\b/g, 'is-show');
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

  const roomChat = LotteryRoomChat.create({
    gameCode: SERVER_GAME,
    appendMsg: appendMsg,
    clearFeed: function () {
      $('#chatFeed').empty();
      if (typeof chatLog !== 'undefined') chatLog.length = 0;
    },
    getUserName: function () { return user.name; },
    robotFallbackName: (typeof ROBOT !== 'undefined' && ROBOT.name) ? ROBOT.name : '机器人',
    fmtTime: typeof fmtTime === 'function' ? fmtTime : undefined,
    buildBetHtml: function (p) {
      return (typeof escapeHtml === 'function') ? escapeHtml(String(p.text || '')) : String(p.text || '');
    },
    buildCloseHtml: function (issue) {
      return (typeof closeNoticeHtml === 'function') ? closeNoticeHtml(issue) : ('封盘 ' + issue);
    },
    buildResultHtml: function (p, msg) {
      const nums = Array.isArray(p.nums) ? p.nums.map(Number) : [];
      const issue = String(p.issueNo || msg.issueNo || '');
      if (typeof resultCardHtml === 'function') return resultCardHtml(nums, issue);
      return '开奖 ' + issue;
    },
    buildBetVerifyHtml: function (p) { return buildBetVerifyFromPayload(p); },
    buildWinVerifyHtml: function (p) { return buildWinVerifyFromPayload(p); },
    buildWinVerifyCalculatingHtml: function (issue) {
      return buildWinListVerifyHtml(issue, null);
    },
    onClose: function (issue) {
      roomBetFrozen = true;
      sealedIssueNo = String(issue || '');
      if (typeof closedIssues !== 'undefined' && closedIssues.add) closedIssues.add(sealedIssueNo);
    },
    onResultMeta: function (p, msg) {
      const nums = Array.isArray(p.nums) ? p.nums.map(Number) : [];
      const issue = String(p.issueNo || msg.issueNo || '');
      if (typeof revealedIssues !== 'undefined' && revealedIssues.add) revealedIssues.add(issue);
      if (nums.length) lastDraw = nums.slice();
    },
    onWinVerifyUnlocked: function () {
      roomBetFrozen = false;
      sealedIssueNo = '';
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
        robotName: (typeof ROBOT !== 'undefined' && ROBOT.name) ? ROBOT.name : '机器人',
      });
      roomBetFrozen = false;
      sealedIssueNo = '';
      applyRoomWinVerifyMineLine(issue);
    },
    afterResultAppended: function (ctx) {
      const nums = Array.isArray(ctx.payload.nums) ? ctx.payload.nums.map(Number) : [];
      const issue = ctx.issue;
      const card = $('#chatFeed .lhc-result-card').last()[0];
      if (card && window.LhcResultCard) {
        if (ctx.animate && ctx.live && LhcResultCard.bindReveal) {
          ctx.setRevealPending(issue);
          const est = LhcResultCard.bindReveal(card, nums, function () {
            ctx.markRevealReady(issue);
          });
          ctx.scheduleRevealReady(issue, (est || resultRevealDurationMs()) + 300);
        } else if (LhcResultCard.settle) {
          LhcResultCard.settle(card, nums);
          ctx.setRevealReadyFlag(issue, true);
        } else {
          ctx.setRevealReadyFlag(issue, true);
        }
      } else {
        ctx.setRevealReadyFlag(issue, true);
      }
    },
    getRevealFallbackMs: function () {
      return resultRevealDurationMs() + 800;
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

  function seedMockNames() {
    const names = App.NAME_PREFIX || ['黄金', '银河', '夜行', '闪电', '深海', '炽焰', '疾风', '幻影'];
    const suffix = App.NAME_SUFFIX || ['猎手', '行者', '骑士', '大师', '旅人', '王者', '武士', '侠客'];
    MOCK_NAMES.length = 0;
    const used = new Set();
    let i = 0;
    while (MOCK_NAMES.length < ROBOT_COUNT && i < 64) {
      const name = names[i % names.length] + suffix[(i * 3 + 1) % suffix.length];
      i += 1;
      if (used.has(name)) continue;
      used.add(name);
      MOCK_NAMES.push({ name, avatar: avatarFromPool(11 + MOCK_NAMES.length * 17) });
    }
    // 兜底补满 10 个
    while (MOCK_NAMES.length < ROBOT_COUNT) {
      const idx = MOCK_NAMES.length + 1;
      MOCK_NAMES.push({ name: '玩家' + idx, avatar: avatarFromPool(30 + idx * 9) });
    }
  }

  function recordMockBetLines(name, betText, opts) {
    const o = Object.assign({ mock: true }, opts || {});
    let ok = false;
    String(betText || '').split(/<br\s*\/?>/i).forEach((line) => {
      const t = String(line || '').trim();
      if (t && recordBet(name, t, o)) ok = true;
    });
    return ok;
  }

  function seedChat() {
    seedMockNames();
    for (let i = 0; i < ROBOT_COUNT; i++) {
      const n = MOCK_NAMES[i];
      const betText = randomMockBetText();
      appendMsg({ name: n.name, avatar: n.avatar, html: betText });
      recordMockBetLines(n.name, betText);
    }
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
      if ($img.length) $img.attr('src', '/images/chat-rail/send.png?v=1');
    } else {
      $btn.removeClass('is-send').attr('aria-label', '更多');
      if ($img.length) $img.attr('src', '/images/chat-rail/plus.png?v=1');
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
      appendMsg({ name: user.name, avatar: fixAvatar(user.avatar), self: true, html: '已取消本期注单' });
      $('#chatInput').val('');
      updateComposerAction();
      showKeypad(false);
      App.toast(count ? `已取消 ${count} 注，退回 ${refunded}` : '已取消本期注单');
    }).catch(function (e) { App.toast((e && e.message) || '取消失败'); });
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
      App.toast('部分玩法暂未接入大脑：' + mapped.unsupported.slice(0, 3).join('、') + '（请先下特码大小单双/特码号）');
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
    $('#drawToggle').attr('aria-expanded', drawPanelOpen);
  }

  function pushRandomBet() {
    if (!MOCK_NAMES.length || !isBettingOpen()) return;
    const n = MOCK_NAMES[Math.floor(Math.random() * MOCK_NAMES.length)];
    const betText = randomMockBetText();
    appendMsg({ name: n.name, avatar: n.avatar, html: betText });
    recordMockBetLines(n.name, betText);
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
    if ($('#playSheet').hasClass('is-open')) layoutPlayOverlay();
  });

  // ===== 初始化（服务端快照到达前仅显示空状态，绝不伪造官方历史） =====
  refreshStats();
  renderDrawTable();
  setIssueEl($('#curIssue'), getCurrentIssue());
  updateCountdownUI(INTERVAL - ((Date.now() - todayStartMs()) / 1000 % INTERVAL));
  /* 左侧玩法分类 */
  const TEMA_ATTR_SUBS = ['两面', '色波', '总和', '总尾'];
  const TEMA_ATTR_ITEMS = {
    两面: [
      { label: '大', play: '特码大' },
      { label: '小', play: '特码小' },
      { label: '单', play: '特码单' },
      { label: '双', play: '特码双' },
      { label: '大单', play: '特大单' },
      { label: '大双', play: '特大双' },
      { label: '小单', play: '特小单' },
      { label: '小双', play: '特小双' },
      { label: '合大', play: '合大' },
      { label: '合小', play: '合小' },
      { label: '合单', play: '合单' },
      { label: '合双', play: '合双' },
      { label: '尾大', play: '尾大' },
      { label: '尾小', play: '尾小' },
    ],
    色波: [
      { label: '红波', play: '红波' },
      { label: '蓝波', play: '蓝波' },
      { label: '绿波', play: '绿波' },
    ],
    总和: [
      { label: '大', play: '总和大' },
      { label: '小', play: '总和小' },
      { label: '单', play: '总和单' },
      { label: '双', play: '总和双' },
    ],
    总尾: [
      { label: '尾大', play: '总尾大' },
      { label: '尾小', play: '总尾小' },
    ],
  };
  const PLAY_CATEGORIES = [
    { id: 'tema', title: '特码', hint: () => `点选号码 · 赔率 ${ODDS.tema}`, mode: 'balls', prefix: '特码', odds: ODDS.tema },
    { id: 'zhengma', title: '正码', hint: () => `点选号码 · 赔率 ${ODDS.zhengma}`, mode: 'balls', prefix: '正码', odds: ODDS.zhengma },
    {
      id: 'temaAttr',
      title: '特码属性',
      hint: () => `两面 ${ODDS.side} · 色波 · 总和 ${ODDS.sumSide} · 总尾 ${ODDS.sumTail}`,
      mode: 'temaAttr',
    },
    { id: 'lianma', title: '连码', hint: '先选副玩法，再选连码玩法', mode: 'lianma' },
    {
      id: 'zongxiao',
      title: '总肖项',
      hint: () => `一肖（七码任一）· 赔率 ${ODDS.pingTe}`,
      items: ['鼠', '牛', '虎', '兔', '龙', '蛇', '马', '羊', '猴', '鸡', '狗', '猪'].map(z => ({
        label: z,
        play: '一肖' + z,
      })),
    },
    { id: 'zongshu', title: '总数项', hint: () => `尾数/尾数不中（平特尾同）· 0尾 ${ODDS.weiShu0} · 其余 ${ODDS.weiShu}`, mode: 'zongshu' },
    {
      id: 'shengxiaolian',
      title: '生肖连',
      hint: () => `二肖 ${ODDS.sxLianZhong[2]} · 三肖 ${ODDS.sxLianZhong[3]} · 四肖 ${ODDS.sxLianZhong[4]} · 五肖 ${ODDS.sxLianZhong[5]}`,
      mode: 'shengxiaolian',
    },
    {
      id: 'weishulian',
      title: '尾数连',
      hint: () => `二尾 ${ODDS.wsLianZhong[2]} · 三尾 ${ODDS.wsLianZhong[3]} · 四尾 ${ODDS.wsLianZhong[4]}`,
      mode: 'weishulian',
    },
    { id: 'liuxiao', title: '六肖', hint: () => `中奖 / 不中 · 赔率 ${ODDS.liuxiao}`, mode: 'liuxiao' },
    {
      id: 'duoxuan',
      title: '多选不中',
      hint: () => `五 ${ODDS.buZhong[5]} · 六 ${ODDS.buZhong[6]} · 七 ${ODDS.buZhong[7]} · 八 ${ODDS.buZhong[8]} · 九 ${ODDS.buZhong[9]} · 十 ${ODDS.buZhong[10]} · 十一 ${ODDS.buZhong[11]} · 十二 ${ODDS.buZhong[12]}`,
      mode: 'duoxuan',
    },
  ];
  /**
   * 特码/正码快捷 · 6 列优化排布（同色上下对齐，便于扫读）
   * 1 红蓝绿·单双  2 红蓝绿·大小  3 大小单双+家野
   * 4 合大小/合单双/尾  5–6 十二生肖
   */
  const BALL_QUICK = [
    { key: '红单', cls: 'is-red' }, { key: '红双', cls: 'is-red' },
    { key: '蓝单', cls: 'is-blue' }, { key: '蓝双', cls: 'is-blue' },
    { key: '绿单', cls: 'is-green' }, { key: '绿双', cls: 'is-green' },

    { key: '红大', cls: 'is-red' }, { key: '红小', cls: 'is-red' },
    { key: '蓝大', cls: 'is-blue' }, { key: '蓝小', cls: 'is-blue' },
    { key: '绿大', cls: 'is-green' }, { key: '绿小', cls: 'is-green' },

    { key: '大', cls: '' }, { key: '小', cls: '' },
    { key: '单', cls: '' }, { key: '双', cls: '' },
    { key: '家禽', cls: 'is-zoo' }, { key: '野兽', cls: 'is-zoo' },

    { key: '合大', cls: '' }, { key: '合小', cls: '' },
    { key: '合单', cls: '' }, { key: '合双', cls: '' },
    { key: '尾大', cls: '' }, { key: '尾小', cls: '' },

    { key: '鼠', cls: 'is-zx' }, { key: '牛', cls: 'is-zx' }, { key: '虎', cls: 'is-zx' },
    { key: '兔', cls: 'is-zx' }, { key: '龙', cls: 'is-zx' }, { key: '蛇', cls: 'is-zx' },
    { key: '马', cls: 'is-zx' }, { key: '羊', cls: 'is-zx' }, { key: '猴', cls: 'is-zx' },
    { key: '鸡', cls: 'is-zx' }, { key: '狗', cls: 'is-zx' }, { key: '猪', cls: 'is-zx' },
  ];
  const POULTRY_ZODIAC = new Set(['牛', '马', '羊', '鸡', '狗', '猪']);
  const BEAST_ZODIAC = new Set(['鼠', '虎', '兔', '龙', '蛇', '猴']);
  const LIANMA_MODES = ['复式', '拖头', '生肖对碰', '尾数对碰', '生尾对碰', '任意对碰'];
  const LIANMA_PLAYS = ['二全中', '二中特', '特串', '三全中', '三中二'];
  /** 对碰类仅二码玩法 */
  const LIANMA_PLAYS_ER = ['二全中', '二中特', '特串'];
  const LIANMA_DUIPENG_MODES = new Set(['生肖对碰', '尾数对碰', '生尾对碰', '任意对碰']);
  const LIANMA_ZODIAC = ['鼠', '牛', '虎', '兔', '龙', '蛇', '马', '羊', '猴', '鸡', '狗', '猪'];
  const ZONGSHU_SUBS = ['尾数', '尾数不中'];
  const SXL_MODES = ['复式', '拖头'];
  const SXL_PLAYS = ['二肖中', '三肖中', '四肖中', '五肖中', '二肖不中', '三肖不中', '四肖不中', '五肖不中'];
  const WSL_MODES = ['复式', '拖头'];
  const WSL_PLAYS = ['二尾中', '三尾中', '四尾中', '二尾不中', '三尾不中', '四尾不中'];
  const LIUXIAO_SUBS = ['中奖', '不中'];
  const DXBZ_MODES = ['复式', '多组'];
  const DXBZ_PLAYS = ['五不中', '六不中', '七不中', '八不中', '九不中', '十不中', '十一不中', '十二不中'];
  const AMOUNT_CHIPS = [10, 20, 50, 100, 200, 500];
  const COMBO_MODES = new Set(['lianma', 'shengxiaolian', 'weishulian', 'liuxiao', 'duoxuan']);
  let playCatIdx = 0;
  let playSelectedList = [];
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
  let sxlModeIdx = 0;
  let sxlPlayIdx = 0;
  let sxlPicked = [];
  let wslModeIdx = 0;
  let wslPlayIdx = 0;
  let wslPicked = [];
  let liuxiaoSubIdx = 0;
  let liuxiaoPicked = [];
  let dxbzModeIdx = 0;
  let dxbzPlayIdx = 0;
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
        return `<button type="button" class="lhc-lm-play${active ? ' is-active' : ''}" data-row="${playRow}" data-idx="${dataIdx}">${p}</button>`;
      }).join('');
      html += `<div class="lhc-lm-row">
        <span class="lhc-lm-row__lab is-play">玩法</span>
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
  function setPlaySelectedText(main, betCount) {
    const amt = unitAmount();
    const sum = betCount > 0 ? ` · ${fmtBetSummary(betCount, amt)}` : '';
    $('#playSelected').text(`${main}${sum}`);
  }

  /** 当前面板可拆注数（用于底部合计预览） */
  function previewComboBetCount() {
    const cat = currentPlayCat();
    if (cat.mode === 'lianma') return expandLianmaCombos().length;
    if (cat.mode === 'shengxiaolian') {
      const k = sxlMinPick();
      return expandByMode(sxlMode(), sxlPicked, k).length;
    }
    if (cat.mode === 'weishulian') {
      const k = wslMinPick();
      return expandByMode(wslMode(), wslPicked.map(Number), k).length;
    }
    if (cat.mode === 'liuxiao') return liuxiaoPicked.length === 6 ? 1 : 0;
    if (cat.mode === 'duoxuan') {
      if (dxbzMode() === '多组') return dxbzGroups.length;
      return expandFushi(dxbzPicked.map(Number), dxbzMinPick()).length;
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
      const lmMode = lianmaMode();
      const min = lianmaMinPick();
      const betCount = expandLianmaCombos().length;
      if (lmMode === '任意对碰') {
        const main = `A[${lianmaPickedA.map(fmtPickNum).join(',') || '—'}]#B[${lianmaPickedB.map(fmtPickNum).join(',') || '—'}]`;
        setPlaySelectedText(`${lmMode}·${lianmaPlay()} · ${main}`, betCount);
        return;
      }
      if (!lianmaPicked.length) {
        setPlaySelectedText(`已选 0/${min}`, 0);
      } else {
        const picks = lianmaPicked.map(fmtPickNum).join(',');
        const danHint = lmMode === '拖头' ? `（前${min - 1}胆）` : '';
        setPlaySelectedText(`${lmMode}·${lianmaPlay()}${danHint} · ${picks}`, betCount);
      }
      return;
    }
    if (mode === 'shengxiaolian') {
      const k = sxlMinPick();
      const betCount = expandByMode(sxlMode(), sxlPicked, k).length;
      if (!sxlPicked.length) setPlaySelectedText(`已选 0/${k}`, 0);
      else {
        const danHint = sxlMode() === '拖头' ? `（前${k - 1}胆）` : '';
        setPlaySelectedText(`${sxlMode()}·${sxlPlay()}${danHint} · ${sxlPicked.join(',')}`, betCount);
      }
      return;
    }
    if (mode === 'weishulian') {
      const k = wslMinPick();
      const betCount = expandByMode(wslMode(), wslPicked.map(Number), k).length;
      if (!wslPicked.length) setPlaySelectedText(`已选 0/${k}`, 0);
      else {
        const picks = wslPicked.map(t => `${t}尾`).join(',');
        const danHint = wslMode() === '拖头' ? `（前${k - 1}胆）` : '';
        setPlaySelectedText(`${wslMode()}·${wslPlay()}${danHint} · ${picks}`, betCount);
      }
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
    if (mode === 'duoxuan') {
      const k = dxbzMinPick();
      if (dxbzMode() === '多组') {
        const cur = dxbzPicked.map(n => pad(+n, 2)).join(',');
        const betCount = dxbzGroups.length;
        setPlaySelectedText(`已封${betCount}组 · 当前[${cur || '—'}] ${dxbzPicked.length}/${k}`, betCount);
      } else {
        const betCount = expandFushi(dxbzPicked.map(Number), k).length;
        if (!dxbzPicked.length) setPlaySelectedText(`已选 0/${k}`, 0);
        else {
          const picks = dxbzPicked.map(n => pad(+n, 2)).join(',');
          setPlaySelectedText(`${dxbzMode()}·${dxbzPlay()} · ${picks}`, betCount);
        }
      }
      return;
    }
    const n = playSelectedList.length;
    if (!n) {
      setPlaySelectedText('—', 0);
      return;
    }
    const preview = playSelectedList.slice(0, 4).join('、');
    const main = n > 4 ? `${preview}… 共${n}项` : (n > 1 ? `${preview}（${n}项）` : preview);
    setPlaySelectedText(main, n);
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
        plays: combos.map(c => `${prefix}${play} ${c.map(n => pad(+n, 2)).join(',')}`),
      };
    }
    if (cat.mode === 'shengxiaolian') {
      const k = sxlMinPick();
      const mode = sxlMode();
      const combos = expandByMode(mode, sxlPicked, k);
      if (!combos.length) {
        return { err: mode === '拖头' ? `拖头请先选 ${k - 1} 个胆再选托肖` : `请至少选择 ${k} 个生肖` };
      }
      return { plays: combos.map(c => `${mode}${sxlPlay()} ${c.join(',')}`) };
    }
    if (cat.mode === 'weishulian') {
      const k = wslMinPick();
      const mode = wslMode();
      const combos = expandByMode(mode, wslPicked.map(Number), k);
      if (!combos.length) {
        return { err: mode === '拖头' ? `拖头请先选 ${k - 1} 个胆再选托尾` : `请至少选择 ${k} 个尾` };
      }
      return { plays: combos.map(c => `${mode}${wslPlay()} ${c.map(t => `${t}尾`).join(',')}`) };
    }
    if (cat.mode === 'liuxiao') {
      if (liuxiaoPicked.length !== 6) return { err: '请选择 6 个生肖' };
      const sub = LIUXIAO_SUBS[liuxiaoSubIdx] || LIUXIAO_SUBS[0];
      const tag = sub === '不中' ? '六肖不中' : '六肖中';
      return { plays: [`${tag} ${liuxiaoPicked.join(',')}`] };
    }
    if (cat.mode === 'duoxuan') {
      const k = dxbzMinPick();
      const mode = dxbzMode();
      let combos;
      if (mode === '多组') {
        if (!dxbzGroups.length) return { err: `多组：每满 ${k} 个号自动封一组，请先封组` };
        combos = expandDuozu(dxbzGroups);
      } else {
        combos = expandFushi(dxbzPicked.map(Number), k);
        if (!combos.length) return { err: `请至少选择 ${k} 个号码` };
      }
      return { plays: combos.map(c => `复式${dxbzPlay()} ${c.map(n => pad(+n, 2)).join(',')}`) };
    }
    return { err: '当前玩法不支持' };
  }

  function submitPlayBet() {
    const cat = currentPlayCat();
    if (!isBettingOpen()) {
      toastBetBlocked('bet');
      return;
    }
    const amount = unitAmount();
    if (!amount) {
      App.toast('请输入有效金额');
      return;
    }
    let lines = [];
    if (isComboPlayMode(cat.mode)) {
      const built = buildComboBetPlays();
      if (built.err) {
        App.toast(built.err);
        return;
      }
      lines = built.plays.map(p => `${p} ${amount}`);
    } else {
      if (!playSelectedList.length) {
        App.toast('请先选择玩法');
        return;
      }
      lines = playSelectedList.map(p => `${p} ${amount}`);
    }
    const expanded = [];
    lines.forEach((line) => {
      const b = parseBet(line);
      if (b) expanded.push(b);
    });
    if (!expanded.length) {
      App.toast('玩法无效，请重新选择');
      return;
    }
    const total = expanded.reduce((s, b) => s + b.amount, 0);
    if (total > App.getBalance(user.uid)) { App.toast('余额不足'); return; }
    const mapped = mapLinesToServerBets(expanded);
    if (mapped.unsupported.length) {
      App.toast('部分玩法暂未接入大脑：' + mapped.unsupported.slice(0, 3).join('、') + '（请先下特码大小单双/特码号）');
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
      openPlaySheet(false);
      App.toast(`投注成功 · ${fmtBetSummary(ok.length, amount)}`);
    }).catch(function (e) {
      App.toast((e && e.message) || '下注失败');
    });
  }

  function ballNumsByQuick(key) {
    const all = Array.from({ length: 49 }, (_, i) => i + 1);
    const he = (n) => digitSum(n);
    const tail = (n) => n % 10;
    const big = (n) => n >= 25;
    const small = (n) => n <= 24;
    const odd = (n) => n % 2 === 1;
    const even = (n) => n % 2 === 0;
    const wave = (c) => (n) => waveColor(n) === c;

    if (key === '红') return all.filter(wave('红'));
    if (key === '蓝') return all.filter(wave('蓝'));
    if (key === '绿') return all.filter(wave('绿'));
    if (key === '大') return all.filter(big);
    if (key === '小') return all.filter(small);
    if (key === '单') return all.filter(odd);
    if (key === '双') return all.filter(even);

    if (key === '红单') return all.filter(n => wave('红')(n) && odd(n));
    if (key === '红双') return all.filter(n => wave('红')(n) && even(n));
    if (key === '蓝单') return all.filter(n => wave('蓝')(n) && odd(n));
    if (key === '蓝双') return all.filter(n => wave('蓝')(n) && even(n));
    if (key === '绿单') return all.filter(n => wave('绿')(n) && odd(n));
    if (key === '绿双') return all.filter(n => wave('绿')(n) && even(n));

    if (key === '红大') return all.filter(n => wave('红')(n) && big(n));
    if (key === '红小') return all.filter(n => wave('红')(n) && small(n));
    if (key === '蓝大') return all.filter(n => wave('蓝')(n) && big(n));
    if (key === '蓝小') return all.filter(n => wave('蓝')(n) && small(n));
    if (key === '绿大') return all.filter(n => wave('绿')(n) && big(n));
    if (key === '绿小') return all.filter(n => wave('绿')(n) && small(n));

    // 合数大小与服务端一致：7 起为大；49 同样按实际属性结算。
    if (key === '合单') return all.filter(n => he(n) % 2 === 1);
    if (key === '合双') return all.filter(n => he(n) % 2 === 0);
    if (key === '合大') return all.filter(n => he(n) >= 7);
    if (key === '合小') return all.filter(n => he(n) <= 6);
    if (key === '尾大') return all.filter(n => tail(n) >= 5);
    if (key === '尾小') return all.filter(n => tail(n) <= 4);

    if (key === '家禽') return all.filter(n => POULTRY_ZODIAC.has(zodiacOf(n)));
    if (key === '野兽') return all.filter(n => BEAST_ZODIAC.has(zodiacOf(n)));
    if (/^[鼠牛虎兔龙蛇马羊猴鸡狗猪]$/.test(key)) {
      return all.filter(n => zodiacOf(n) === key);
    }
    return [];
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
      : (nSel ? ` · 已选 ${nSel} 个` : ' · 快捷可多选，号码取并集');
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
      return `<button type="button" class="lhc-play-ball${on ? ' is-on' : ''}" data-num="${n}">
        ${ballHtml(n, 'play')}
        <small>1:${odds}</small>
      </button>`;
    }).join('');
    $('#playGrid').attr('class', 'lhc-play-panel__grid is-tema').html(balls);
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
    return (play === '三全中' || play === '三中二') ? 3 : 2;
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
    ensureLianmaPlayValid();
    const mode = lianmaMode();
    const play = lianmaPlay();
    const plays = lianmaPlaysForMode(mode);
    const min = lianmaMinPick();
    const danN = min - 1;
    const betCount = expandLianmaCombos().length;
    let hint = `${mode} · ${play}`;
    if (mode === '复式') hint += ` · C(n,${min})`;
    else if (mode === '拖头') hint += ` · 前${danN}胆+托`;
    else if (mode === '任意对碰') hint += ' · 左A右B各选号';
    else if (mode === '生肖对碰') hint += ' · 选2肖';
    else if (mode === '尾数对碰') hint += ' · 选2尾';
    else if (mode === '生尾对碰') hint += ' · 生肖×尾数';
    if (LIANMA_DUIPENG_MODES.has(mode)) hint += ' · 仅二码';
    if (betCount) hint += ` · 共${betCount}注`;
    $('#playHint').text(hint);

    setPlaySubBar(buildLmBar({
      modes: LIANMA_MODES,
      modeIdx: lianmaModeIdx,
      modeRow: 'mode',
      modeCols: 3,
      plays,
      playRow: 'play',
      playCols: plays.length === 3 ? 3 : 5,
      playDataIdx: (p) => LIANMA_PLAYS.indexOf(p),
      isPlayActive: (p) => LIANMA_PLAYS.indexOf(p) === lianmaPlayIdx,
    }));

    let body = '';
    let gridCls = 'lhc-play-panel__grid is-tema';
    const picked = new Set(lianmaPicked);

    if (mode === '生肖对碰') {
      gridCls = 'lhc-play-panel__grid is-lianma-block';
      body = `<div class="lhc-lm-section">
        <div class="lhc-lm-section__hd">选择 2 个生肖</div>
        <div class="lhc-lm-section__grid is-zx">${LIANMA_ZODIAC.map(z =>
          `<button type="button" class="lhc-play-item${picked.has(z) ? ' is-active' : ''}" data-lianma="${z}"><span>${z}</span></button>`
        ).join('')}</div>
      </div>`;
    } else if (mode === '尾数对碰') {
      gridCls = 'lhc-play-panel__grid is-lianma-block';
      body = `<div class="lhc-lm-section">
        <div class="lhc-lm-section__hd">选择 2 个尾数</div>
        <div class="lhc-lm-section__grid is-tail">${Array.from({ length: 10 }, (_, i) => {
          const t = String(i);
          return `<button type="button" class="lhc-play-item${picked.has(t) ? ' is-active' : ''}" data-lianma="${t}"><span>${t}尾</span></button>`;
        }).join('')}</div>
      </div>`;
    } else if (mode === '生尾对碰') {
      gridCls = 'lhc-play-panel__grid is-lianma-block';
      body = `<div class="lhc-lm-section">
        <div class="lhc-lm-section__hd">生肖（可多选）</div>
        <div class="lhc-lm-section__grid is-zx">${LIANMA_ZODIAC.map(z =>
          `<button type="button" class="lhc-play-item${picked.has(z) ? ' is-active' : ''}" data-lianma="${z}"><span>${z}</span></button>`
        ).join('')}</div>
      </div>
      <div class="lhc-lm-section">
        <div class="lhc-lm-section__hd">尾数（可多选）</div>
        <div class="lhc-lm-section__grid is-tail">${Array.from({ length: 10 }, (_, i) => {
          const t = String(i);
          return `<button type="button" class="lhc-play-item${picked.has(t) ? ' is-active' : ''}" data-lianma="${t}"><span>${t}尾</span></button>`;
        }).join('')}</div>
      </div>`;
    } else if (mode === '复式' || mode === '拖头') {
      body = Array.from({ length: 49 }, (_, i) => {
        const n = i + 1;
        const key = String(n);
        const idx = lianmaPicked.indexOf(key);
        const on = idx >= 0;
        const role = mode === '拖头' && on ? (idx < danN ? ' is-on is-dan' : ' is-on is-tuo') : (on ? ' is-on' : '');
        return `<button type="button" class="lhc-play-ball${role}" data-lianma="${key}">${ballHtml(n, 'play')}</button>`;
      }).join('');
    } else if (mode === '任意对碰') {
      const setA = new Set(lianmaPickedA);
      const setB = new Set(lianmaPickedB);
      const mkBalls = (side, onSet) => Array.from({ length: 49 }, (_, i) => {
        const n = i + 1;
        const key = String(n);
        const role = onSet.has(key) ? (side === 'A' ? ' is-on is-dan' : ' is-on is-tuo') : '';
        return `<button type="button" class="lhc-play-ball${role}" data-lianma="${key}" data-side="${side}">${ballHtml(n, 'play')}</button>`;
      }).join('');
      gridCls = 'lhc-play-panel__grid is-lianma-block';
      body = `<div class="lhc-lm-ab">
        <div class="lhc-lm-ab__col is-a">
          <div class="lhc-lm-ab__hd">A组（左）</div>
          <div class="lhc-lm-ab__grid">${mkBalls('A', setA)}</div>
        </div>
        <div class="lhc-lm-ab__col is-b">
          <div class="lhc-lm-ab__hd">B组（右）</div>
          <div class="lhc-lm-ab__grid">${mkBalls('B', setB)}</div>
        </div>
      </div>`;
    }

    $('#playGrid').attr('class', gridCls).html(body);
    updatePlaySelected();
  }

  function renderZongshuPanel() {
    const sub = ZONGSHU_SUBS[zongshuSubIdx] || ZONGSHU_SUBS[0];
    const isMiss = sub === '尾数不中';
    $('#playHint').text(`总数项 · ${sub}（0~9 尾，平特尾同）`);
    setPlaySubBar(buildLmBar({
      modes: ZONGSHU_SUBS,
      modeIdx: zongshuSubIdx,
      modeRow: 'zongshu',
      modeCols: 2,
    }));
    $('#playGrid').attr('class', 'lhc-play-panel__grid is-lianma-block').html(
      `<div class="lhc-lm-section">
        <div class="lhc-lm-section__hd">${sub}</div>
        <div class="lhc-lm-section__grid is-tail">${Array.from({ length: 10 }, (_, i) => {
          const play = isMiss ? `${i}尾不中` : `${i}尾`;
          const odds = playOddsLabel(play);
          const active = isPlaySelected(play);
          return `<button type="button" class="lhc-play-item${active ? ' is-active' : ''}" data-play="${play}"><span>${i}尾</span>${odds ? `<small>1:${odds}</small>` : ''}</button>`;
        }).join('')}</div>
      </div>`
    );
  }

  function renderTemaAttrPanel() {
    const sub = TEMA_ATTR_SUBS[temaAttrSubIdx] || TEMA_ATTR_SUBS[0];
    const items = TEMA_ATTR_ITEMS[sub] || [];
    const hints = {
      两面: `特码两面 · 两面 ${ODDS.side} · 组合 ${ODDS.comboSide}`,
      色波: `色波 · 红 ${ODDS.colorRed} · 蓝 ${ODDS.colorBlue} · 绿 ${ODDS.colorGreen}`,
      总和: `七码合计 · 赔率 ${ODDS.sumSide}`,
      总尾: `七码合计尾数 · 赔率 ${ODDS.sumTail}`,
    };
    $('#playHint').text(hints[sub] || `特码属性 · ${sub}`);
    setPlaySubBar(buildLmBar({
      modes: TEMA_ATTR_SUBS,
      modeIdx: temaAttrSubIdx,
      modeRow: 'temaAttr',
      modeCols: 4,
    }));
    $('#playGrid').attr('class', 'lhc-play-panel__grid').html(items.map(it => {
      const play = it.play;
      const label = it.label || play;
      const odds = playOddsLabel(play);
      const active = isPlaySelected(play);
      const cls = sub === '色波' && label.includes('红') ? ' is-red'
        : sub === '色波' && label.includes('蓝') ? ' is-blue'
        : sub === '色波' && label.includes('绿') ? ' is-green' : '';
      return `<button type="button" class="lhc-play-item${cls}${active ? ' is-active' : ''}" data-play="${play}"><span>${label}</span>${odds ? `<small>1:${odds}</small>` : ''}</button>`;
    }).join(''));
    updatePlaySelected();
  }

  function sxlMode() {
    return SXL_MODES[sxlModeIdx] || SXL_MODES[0];
  }
  function sxlPlay() {
    return SXL_PLAYS[sxlPlayIdx] || SXL_PLAYS[0];
  }
  function sxlMinPick() {
    const m = sxlPlay().match(/^[二三四五]/);
    const map = { 二: 2, 三: 3, 四: 4, 五: 5 };
    return m ? (map[m[0]] || 2) : 2;
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
    const mode = sxlMode();
    const play = sxlPlay();
    const min = sxlMinPick();
    const danN = min - 1;
    const hint = mode === '拖头'
      ? `生肖连 · 拖头 · ${play}（先选 ${danN} 胆再选托，注数=托数）`
      : `生肖连 · 复式 · ${play}（C(n,${min})，单注金额×注数）`;
    $('#playHint').text(hint);
    setPlaySubBar(buildLmBar({
      modes: SXL_MODES,
      modeIdx: sxlModeIdx,
      modeRow: 'sxl-mode',
      modeCols: 2,
      plays: SXL_PLAYS,
      playIdx: sxlPlayIdx,
      playRow: 'sxl-play',
      playCols: 4,
    }));
    $('#playGrid').attr('class', 'lhc-play-panel__grid is-lianma-block').html(
      `<div class="lhc-lm-section">
        <div class="lhc-lm-section__hd">${mode === '拖头' ? `先选 ${danN} 胆再选托肖` : `至少选 ${min} 个生肖`}</div>
        <div class="lhc-lm-section__grid is-zx">${LIANMA_ZODIAC.map(z => {
          const idx = sxlPicked.indexOf(z);
          return `<button type="button" class="lhc-play-item${pickRoleClass(idx >= 0, idx, mode, min)}" data-sxl="${z}"><span>${z}</span></button>`;
        }).join('')}</div>
      </div>`
    );
    updatePlaySelected();
  }

  function wslMode() {
    return WSL_MODES[wslModeIdx] || WSL_MODES[0];
  }
  function wslPlay() {
    return WSL_PLAYS[wslPlayIdx] || WSL_PLAYS[0];
  }
  function wslMinPick() {
    const m = wslPlay().match(/^[二三四]/);
    const map = { 二: 2, 三: 3, 四: 4, 五: 5 };
    return m ? (map[m[0]] || 2) : 2;
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
    const mode = wslMode();
    const play = wslPlay();
    const min = wslMinPick();
    const danN = min - 1;
    const hint = mode === '拖头'
      ? `尾数连 · 拖头 · ${play}（先选 ${danN} 胆再选托，注数=托数）`
      : `尾数连 · 复式 · ${play}（C(n,${min})，单注金额×注数）`;
    $('#playHint').text(hint);
    setPlaySubBar(buildLmBar({
      modes: WSL_MODES,
      modeIdx: wslModeIdx,
      modeRow: 'wsl-mode',
      modeCols: 2,
      plays: WSL_PLAYS,
      playIdx: wslPlayIdx,
      playRow: 'wsl-play',
      playCols: 3,
    }));
    $('#playGrid').attr('class', 'lhc-play-panel__grid is-lianma-block').html(
      `<div class="lhc-lm-section">
        <div class="lhc-lm-section__hd">${mode === '拖头' ? `先选 ${danN} 胆再选托尾` : `至少选 ${min} 个尾`}</div>
        <div class="lhc-lm-section__grid is-tail">${Array.from({ length: 10 }, (_, i) => {
          const t = String(i);
          const idx = wslPicked.indexOf(t);
          return `<button type="button" class="lhc-play-item${pickRoleClass(idx >= 0, idx, mode, min)}" data-wsl="${t}"><span>${t}尾</span></button>`;
        }).join('')}</div>
      </div>`
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

  function dxbzMode() {
    return DXBZ_MODES[dxbzModeIdx] || DXBZ_MODES[0];
  }
  function dxbzPlay() {
    return DXBZ_PLAYS[dxbzPlayIdx] || DXBZ_PLAYS[0];
  }
  function dxbzMinPick() {
    const m = dxbzPlay().match(/^(十一|十二|五|六|七|八|九|十)/);
    const map = { 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10, 十一: 11, 十二: 12 };
    return m ? (map[m[1]] || 5) : 5;
  }
  function dxbzTogglePick(num) {
    const s = String(num);
    const k = dxbzMinPick();
    const i = dxbzPicked.indexOf(s);
    if (i >= 0) {
      dxbzPicked.splice(i, 1);
    } else {
      // 多组已封号码不可再选
      if (dxbzMode() === '多组' && dxbzGroups.some(g => g.map(String).includes(s))) {
        App.toast('该号已在已封组中');
        return;
      }
      dxbzPicked.push(s);
      if (dxbzMode() === '多组' && dxbzPicked.length === k) {
        dxbzGroups.push(dxbzPicked.map(Number));
        dxbzPicked = [];
        App.toast(`已封第 ${dxbzGroups.length} 组`);
      }
    }
    renderDuoxuanPanel(false);
  }
  function renderDuoxuanPanel(resetPick) {
    if (resetPick !== false) {
      dxbzPicked = [];
      dxbzGroups = [];
    }
    const mode = dxbzMode();
    const play = dxbzPlay();
    const min = dxbzMinPick();
    const picked = new Set(dxbzPicked);
    const sealed = new Set(dxbzGroups.flatMap(g => g.map(String)));
    const hint = mode === '多组'
      ? `多选不中 · 多组 · ${play}（每满 ${min} 个自动封 1 组）`
      : `多选不中 · 复式 · ${play}（C(n,${min})，单注金额×注数）`;
    $('#playHint').text(hint);
    setPlaySubBar(buildLmBar({
      modes: DXBZ_MODES,
      modeIdx: dxbzModeIdx,
      modeRow: 'dxbz-mode',
      modeCols: 2,
      plays: DXBZ_PLAYS,
      playIdx: dxbzPlayIdx,
      playRow: 'dxbz-play',
      playCols: 4,
    }));
    $('#playGrid').attr('class', 'lhc-play-panel__grid is-tema').html(
      Array.from({ length: 49 }, (_, i) => {
        const n = i + 1;
        const key = String(n);
        let role = '';
        if (picked.has(key)) role = ' is-on';
        else if (sealed.has(key)) role = ' is-on is-dan';
        return `<button type="button" class="lhc-play-ball${role}" data-dxbz="${key}">
          ${ballHtml(n, 'play')}
        </button>`;
      }).join('')
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
    if (cat.mode === 'lianma') {
      renderLianmaPanel(doReset);
      return;
    }
    if (cat.mode === 'zongshu') {
      renderZongshuPanel();
      updatePlaySelected();
      return;
    }
    if (cat.mode === 'temaAttr') {
      renderTemaAttrPanel();
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
    $('#playHint').text(typeof cat.hint === 'function' ? cat.hint() : (cat.hint || ''));
    $('#playGrid').attr('class', 'lhc-play-panel__grid');
    const items = Array.isArray(cat.items) ? cat.items : [];
    if (!items.length) {
      $('#playGrid').html('<div class="lhc-play-panel__empty">具体玩法待添加</div>');
      updatePlaySelected();
      return;
    }
    $('#playGrid').html(items.map(it => {
      const play = typeof it === 'string' ? it : it.play;
      const label = typeof it === 'string' ? it : (it.label || it.play);
      const odds = playOddsLabel(play);
      const active = isPlaySelected(play);
      return `<button type="button" class="lhc-play-item${active ? ' is-active' : ''}" data-play="${play}"><span>${label}</span>${odds ? `<small>1:${odds}</small>` : ''}</button>`;
    }).join(''));
    updatePlaySelected();
  }

  function initPlaySheet() {
    renderPlayNav();
    $('#playAmountChips').html(AMOUNT_CHIPS.map(a =>
      `<button type="button" class="lhc-play-foot__chip${a === 100 ? ' is-active' : ''}" data-amt="${a}">${a}</button>`
    ).join(''));
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
  seedMockNames();
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
  function syncServerSnapshot() {
    if (snapshotBusy || !App.fetchLotterySnapshot) return;
    snapshotBusy = true;
    App.fetchLotterySnapshot(SERVER_GAME).then(function (snapshot) {
      /* 历史与当前期解耦：即使短暂没有 current，上期栏也要能刷新 */
      const rows = parseServerHistory(snapshot && snapshot.history);
      const headChanged = rows[0] && (!historyRows[0] || rows[0].issue !== historyRows[0].issue);
      historyRows = rows;
      if (rows.length) {
        lastDraw = rows[0].nums.slice();
        renderDrawBar(rows[0]);
      } else if (typeof renderDrawBar === 'function') {
        try { renderDrawBar(null); } catch (e) { /* ignore */ }
      }
      const current = snapshot && snapshot.current;
      if (current && current.issueNo) {
        serverCurrent = current;
        serverSynced = true;
        if (typeof tick === 'function') try { tick(); } catch (e) { /* ignore */ }
      }
      renderDrawTable();
      if (serverCurrent && serverCurrent.issueNo) setIssueEl($('#curIssue'), serverCurrent.issueNo);
      if (rows[0]) {
        revealedIssues.add(rows[0].issue);
        saveRevealedIssues();
        historyHeadBootstrapped = true;
      }
      if ($('#longSheet').hasClass('is-open')) renderLongDragonPanel();
      if ($('#predictSheet').hasClass('is-open')) renderPredictPanel();
    }).catch(function () {
      /* Parent bridge can be unavailable when a static H5 is opened directly. */
    }).finally(function () { snapshotBusy = false; });
  }

  function tick() {
    if (serverSynced && serverCurrent) {
      const lockAt = new Date(serverCurrent.lockAt).getTime();
      const openAt = new Date(serverCurrent.openAt).getTime();
      const issueCur = String(serverCurrent.issueNo || '');
      const open = serverCurrent.status === 'PENDING' && Date.now() < lockAt;
      setIssueEl($('#curIssue'), issueCur);
      updateCountdownUI(open
        ? Math.max(0, (lockAt - Date.now()) / 1000) + PREP_SEC
        : Math.max(0, (openAt - Date.now()) / 1000));
      if (!open && issueCur && markIssueClosed(issueCur)) {
        roomBetFrozen = true;
        sealedIssueNo = issueCur;
      }
      /* unfreeze-if-next-pending */
      if (roomBetFrozen && sealedIssueNo && issueCur && issueCur !== sealedIssueNo && open) {
        /* 下一期已开盘：以服务端为准解冻（不强制等历史，避免漏推卡死） */
        roomBetFrozen = false;
        sealedIssueNo = '';
      }
      return;
    }
    /* 未同步服务端：禁止本地钟（期号会差 1），只显示同步中 */
    if (typeof setCurIssueDisplay === 'function') setCurIssueDisplay('--------');
    else if (typeof setIssueEl === 'function') setIssueEl($('#curIssue'), '--------');
    else $('#curIssue').text('--------');
    const $label = $('#cdLabel');
    if ($label.length) $label.text('同步中');
    const $box = $('#countdownBox').removeClass('is-preparing is-betting is-freeze').addClass('is-betting');
    $box.attr('aria-label', '房间同步中');
    if (typeof renderCountdownDigits === 'function') renderCountdownDigits(0);
    $('#cdPrep').prop('hidden', true);
    $('#cdDigits').prop('hidden', false);
  }
  setInterval(tick, 1000);
  restoreRevealedIssues();
  restoreClosedIssues();
  hydrateClosedFromChat();
  hydrateRevealedFromChat();
  if (App.startAdaptiveInterval) App.startAdaptiveInterval(syncServerSnapshot, 2000, 5000); else { syncServerSnapshot(); setInterval(syncServerSnapshot, 2000); }
  /* robot bets from server room chat */

  tick();

  // ===== 事件 =====
  $('#backBtn').on('click', () => {
    if (App.backToLobby) App.backToLobby();
    else App.go('../../client-app/pages/game-lobby/game-lobby.html' + q);
  });

  /* === chat-rail handlers (lhc) === */

  function openRulesSheet(open) {
    if (open) {
      const o = ODDS;
      const betSec = (typeof BET_SEC !== 'undefined') ? BET_SEC : (INTERVAL - PREP_SEC);
      const html = `
        <div class="lhc-rules-sec">
          <h3 class="lhc-rules-sec__title">一、开奖与时间</h3>
          <p>幸运六合彩每期开出 <b>7</b> 个号码：正码 1～6 + <b>特码</b>，号码范围 <b>01～49</b>。</p>
          <p>每期共 <b>${INTERVAL} 秒</b>：可下注 <b>${betSec} 秒</b>，提前 <b>${PREP_SEC} 秒</b> 封盘。顶栏「距封盘 / 距开奖」；封盘后不可下注、不可取消。</p>
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
          <p>下列为当前房间常用玩法赔率（随后台更新；连肖/不中等见面板分档）。派彩 = 金额 × 赔率（向下取整）。</p>
          <table class="lhc-rules-table">
            <thead><tr><th>玩法</th><th>说明</th><th>赔率</th></tr></thead>
            <tbody>
              <tr><td>特码</td><td>猜特码号码 01～49</td><td>${o.tema}</td></tr>
              <tr><td>正码</td><td>猜正码六个号中出现指定号码</td><td>${o.zhengma}</td></tr>
              <tr><td>两面 / 色波</td><td>特码大小单双、合数、红蓝绿波等</td><td>两面 ${o.side} · 红 ${o.colorRed}</td></tr>
              <tr><td>一肖（总肖项）</td><td>七码任一出现该生肖即中；口令一肖X（平特X 同义）</td><td>平特 ${o.pingTe} · 本命 ${o.pingTeYear}</td></tr>
              <tr><td>总和 / 总尾</td><td>七码总和大小单双；总和尾数大小</td><td>${o.sumSide} / ${o.sumTail}</td></tr>
              <tr><td>六肖</td><td>从十二肖中选满 6 个猜中/不中</td><td>${o.liuxiao}</td></tr>
              <tr><td>连肖 / 连尾</td><td>二～五肖连中或不中；二～四尾连中或不中</td><td>见玩法面板</td></tr>
              <tr><td>连码</td><td>二全中 / 二中特 / 特串 / 三全中 / 三中二等</td><td>二全 ${o.erQuanZhong} · 三全 ${o.sanQuanZhong}</td></tr>
              <tr><td>自选不中</td><td>选 5～12 个号码，开奖七码均未命中即中</td><td>五不中 ${o.buZhong[5]} 起</td></tr>
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
            <li>网络延迟可能导致倒计时与封盘线相差约 1～2 秒，以能否成功提交为准</li>
            <li>侧栏「记录」查看本游戏注单；底部「+」里的「竞猜报表」可看全部游戏</li>
            <li>长龙 / 预测仅供走势参考，不构成投注建议</li>
          </ul>
        </div>`;
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
  $('#btnRules').on('click', () => openRulesSheet(true));
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
      if (row === 'mode') {
        lianmaModeIdx = idx;
        renderLianmaPanel(true);
      } else if (row === 'play') {
        lianmaPlayIdx = idx;
        renderLianmaPanel(false);
      } else if (row === 'peng-side') {
        lianmaPengSide = String($btn.data('side') || 'A') === 'B' ? 'B' : 'A';
        renderLianmaPanel(false);
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
    if (cat.mode === 'temaAttr' && row === 'temaAttr') {
      temaAttrSubIdx = idx;
      renderTemaAttrPanel();
      return;
    }
    if (cat.mode === 'shengxiaolian') {
      if (row === 'sxl-mode') {
        sxlModeIdx = idx;
        renderShengxiaolianPanel(true);
      } else if (row === 'sxl-play') {
        sxlPlayIdx = idx;
        renderShengxiaolianPanel(false);
      }
      return;
    }
    if (cat.mode === 'weishulian') {
      if (row === 'wsl-mode') {
        wslModeIdx = idx;
        renderWeishulianPanel(true);
      } else if (row === 'wsl-play') {
        wslPlayIdx = idx;
        renderWeishulianPanel(false);
      }
      return;
    }
    if (cat.mode === 'liuxiao' && row === 'liuxiao') {
      liuxiaoSubIdx = idx;
      renderLiuxiaoPanel(true);
      return;
    }
    if (cat.mode === 'duoxuan') {
      if (row === 'dxbz-mode') {
        dxbzModeIdx = idx;
        renderDuoxuanPanel(true);
      } else if (row === 'dxbz-play') {
        dxbzPlayIdx = idx;
        renderDuoxuanPanel(false);
      }
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
    $('#playAmount').val(amt);
    $('#playAmountChips .lhc-play-foot__chip').removeClass('is-active');
    $(this).addClass('is-active');
    updatePlaySelected();
  });

  $('#playAmountMinus').on('click', () => {
    const v = Math.max(1, (parseInt($('#playAmount').val(), 10) || 1) - 10);
    $('#playAmount').val(v);
    $('#playAmountChips .lhc-play-foot__chip').removeClass('is-active');
    updatePlaySelected();
  });
  $('#playAmountPlus').on('click', () => {
    const v = (parseInt($('#playAmount').val(), 10) || 0) + 10;
    $('#playAmount').val(v);
    $('#playAmountChips .lhc-play-foot__chip').removeClass('is-active');
    updatePlaySelected();
  });
  $('#playAmount').on('input change', () => updatePlaySelected());

  $('#playClear').on('click', clearPlaySelection);
  $('#playRepeat').on('click', fillLastBetsToInput);
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
    recharge: '../../client-app/pages/recharge/recharge.html',
    'apply-records': '../../client-app/pages/apply-records/apply-records.html',
    'bet-records': '../../client-app/pages/bet-records/bet-records.html',
    rebate: '../../client-app/pages/rebate/rebate.html',
    activities: '../../client-app/pages/activities/activities.html',
    settings: '../../client-app/pages/profile/profile.html',
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
