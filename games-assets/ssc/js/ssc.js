/**
 * 游戏类型: digit5
 *
 * 快乐时时彩 · 聊天投注房
 * 玩法与规则对齐官方「幸运时时彩」：
 * 两面 / 定位胆 / 不定位 / 三星组三 / 三星组六 / 龙虎和 / 斗牛 / 前中后
 */
$(function () {
  const GAME_TYPE = 'digit5';

  // 总周期 60s = 46s 可下注 + 14s 封盘准备（与服务端 lockAt = openAt - 14s 一致）
  const INTERVAL = 60;
  /** 开奖中窗口：盖住滚号 6s + 出号约 3.2s（与 shared lotteryPrepSec('ssc') 对齐） */
  const PREP_SEC = 14;
  const BET_SEC = INTERVAL - PREP_SEC;

  function fixAvatar(url) {
    const fallback = '/images/avatars/001.jpg';
    if (!url) return fallback;
    if (url.startsWith('http://') || url.startsWith('https://')) return url;
    if (url.startsWith('/legacy/images/avatars/')) {
      return '/images/avatars/' + url.slice('/legacy/images/avatars/'.length);
    }
    if (url.startsWith('../../client-app/assets/images/avatars/')) {
      return '/images/avatars/' + url.slice('../../client-app/assets/images/avatars/'.length);
    }
    if (url.startsWith('/')) return url;
    if (url.startsWith('../../assets/') || url.startsWith('../assets/')) {
      return '/images/avatars/001.jpg';
    }
    return url;
  }
  /** 头像池：001~162（022/078/086 为 png） */
  function avatarFromPool(seed) {
    const n = 1 + (Math.abs(Number(seed) || 0) % 162);
    const ext = (n === 22 || n === 78 || n === 86) ? 'png' : 'jpg';
    return `/images/avatars/${String(n).padStart(3, '0')}.${ext}`;
  }
  function avatarHtml(name, seed) {
    const hue = (seed * 41 + (name.charCodeAt(0) || 0) * 17) % 360;
    const ch = name.charAt(0) || '?';
    return `<div class="ssc-msg__avatar ssc-msg__avatar--gen" style="--av-hue:${hue}"><span>${ch}</span></div>`;
  }
  const ROBOT = { name: '机器人', avatar: '/images/avatars/001.jpg' };
  const params = new URLSearchParams(location.search);
  const roomNo = (params.get('roomNo') || '').trim();
  let user = App.getUser();
  const _setUser = App.setUser;
  App.setUser = function (u) {
    _setUser(u);
    user = App.getUser();
  };
  const q = roomNo ? '?roomNo=' + encodeURIComponent(roomNo) : '';
  /** 大脑彩票 gameCode */
  const SERVER_GAME = 'ssc';

  function mulOf(pt, key) {
    const row = pt && pt[key];
    return row && typeof row.multiplier === 'number' ? row.multiplier : null;
  }
  function fmtOdds(v) {
    return typeof v === 'number' && Number.isFinite(v) ? String(v) : '—';
  }
  function loadServerPayTable() {
    if (!App.fetchLotteryPayTable) return;
    App.fetchLotteryPayTable(SERVER_GAME).then(function (pt) {
      App._lotteryPayTable = pt || {};
      if (typeof applyServerPayTable === 'function') applyServerPayTable(App._lotteryPayTable);
    }).catch(function () { /* 展示保持 —，结算始终以服务端为准 */ });
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

  const SIDE_TO_SERVER = { '大': 'big', '小': 'small', '单': 'odd', '双': 'even' };

  /** H5 玩法 → 大脑 { betType, betValue? } */
  function mapPlayToServer(play) {
    const parsed = parsePlay(play);
    if (!parsed) return null;
    switch (parsed.type) {
      case 'sumSide':
        return { betType: SIDE_TO_SERVER[parsed.side] };
      case 'ballSide':
        return { betType: 'ballSide', betValue: parsed.pos + ':' + SIDE_TO_SERVER[parsed.side] };
      case 'position':
        return { betType: 'position', betValue: parsed.pos + ':' + parsed.digit };
      case 'anyDigit':
        return { betType: 'anyDigit', betValue: parsed.seg + ':' + parsed.digit };
      case 'group3':
        return { betType: 'group3', betValue: parsed.seg + ':' + parsed.a + ',' + parsed.b };
      case 'group6':
        return { betType: 'group6', betValue: parsed.seg + ':' + parsed.digits.join(',') };
      case 'lhh':
        return { betType: 'lhh', betValue: parsed.a + ':' + parsed.b + ':' + parsed.pick };
      case 'niu':
        return { betType: 'niu', betValue: String(parsed.val) };
      case 'niuSide':
        return { betType: 'niuSide', betValue: parsed.side };
      case 'shape':
        return { betType: 'shape', betValue: parsed.seg + ':' + parsed.shape };
      default:
        return null;
    }
  }

  function mapLinesToServerBets(lines) {
    const bets = [];
    for (let i = 0; i < lines.length; i++) {
      const m = mapPlayToServer(lines[i].play);
      if (!m || !m.betType) return { bets: [], unsupported: [lines[i].play] };
      const row = { betType: m.betType, amount: lines[i].amount };
      if (m.betValue !== undefined && m.betValue !== null) row.betValue = m.betValue;
      bets.push(row);
    }
    return { bets: bets, unsupported: [] };
  }

  let historyRows = [];
  let lastDraw = [];
  let lastIssueSeq = 0;
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
    /* 铃声只走 armCountdown / onPhaseChange，避免 tick 每帧重播长铃 */
  }
  function requestLotteryResync() {
    const now = Date.now();
    if (openAtResyncAt && now - openAtResyncAt < 800) return;
    openAtResyncAt = now;
    snapshotBusy = false;
    if (typeof App.resyncLottery === 'function') App.resyncLottery();
    else if (typeof syncServerSnapshot === 'function') syncServerSnapshot();
  }
  const REVEALED_STORAGE_KEY = 'ssc_revealed_v1';
  const CLOSED_STORAGE_KEY = 'ssc_closed_v1';
  let revealedIssues = new Set();
  /** 进房后首次拉到历史头：只对齐顶栏，不往聊天推「进房前已开奖」 */
  let historyHeadBootstrapped = false;
  let lastBetText = '';
  /** 输入框由「梭哈」填入时，发送再按余额均分多注 */
  let composerAllin = false;
  let drawPanelOpen = false;
  let closedIssues = new Set();
  /** 封盘后冻结下注，开奖核对展示完再解冻（避免下一期过早冒注） */
  let roomBetFrozen = false;
  let sealedIssueNo = '';
  /** 当期注单：issue -> { 玩家名: [{ play, amount }] } */
  const issueBetBook = {};

  /* ================= 官方玩法 · 赔率（本地兜底 = server sscFfcPayTable；/pay-table 覆盖） ================= */
  const ODDS = {
    sumSide: 1.995,
    ballSide: 1.995,
    position: 9.95,
    anyDigit: 3.6,
    group3: 260,
    group6: 125,
    dragon: 1.99,
    tiger: 1.99,
    tie: 9,
    noNiu: 2.02,
    niu: 9.22,
    niuSide: 1.98
  };

  const POS = { 万: 0, 千: 1, 百: 2, 十: 3, 个: 4 };
  const SEG = { 前三: [0, 3], 中三: [1, 4], 后三: [2, 5] };
  /** 龙虎和全部对阵（球位 0-4），口令用 几/几龙，如 1/2龙 */
  const LHH_PAIRS = [];
  for (let a = 0; a < 5; a++) {
    for (let b = a + 1; b < 5; b++) LHH_PAIRS.push([a, b]);
  }
  const SHAPE_ODDS = { 豹子: 75, 顺子: 14.5, 对子: 3.3, 半顺: 2.5, 杂六: 3 };

  function lhhPickOdds(pick) {
    return pick === '和' ? ODDS.tie : (pick === '虎' ? ODDS.tiger : ODDS.dragon);
  }
  function lhhPlayOf(a, b, pick) {
    return (a + 1) + '/' + (b + 1) + pick;
  }

  function applyServerPayTable(pt) {
    if (!pt) return;
    ODDS.sumSide = mulOf(pt, 'big');
    ODDS.ballSide = mulOf(pt, 'ballSide');
    ODDS.position = mulOf(pt, 'position');
    ODDS.anyDigit = mulOf(pt, 'anyDigit');
    ODDS.group3 = mulOf(pt, 'group3');
    ODDS.group6 = mulOf(pt, 'group6');
    ODDS.dragon = mulOf(pt, 'dragon');
    ODDS.tiger = mulOf(pt, 'tiger');
    ODDS.tie = mulOf(pt, 'tie');
    ODDS.noNiu = mulOf(pt, 'noNiu');
    ODDS.niu = mulOf(pt, 'niu');
    ODDS.niuSide = mulOf(pt, 'niuSide');
    ;['豹子', '顺子', '对子', '半顺', '杂六'].forEach(function (k) {
      SHAPE_ODDS[k] = mulOf(pt, 'shape_' + k);
    });
    if (typeof renderPlayPanel === 'function' && $('#playSheet').hasClass('is-open')) {
      try { renderPlayPanel(); } catch (e) { /* ignore */ }
    }
  }

  /**
   * 解析玩法文本 → { type, ..., odds }；不合法返回 null
   */
  function parsePlay(raw) {
    const t = String(raw || '').replace(/\s+/g, '');
    let m;
    if ((m = t.match(/^(?:总和|总)?(大|小|单|双)$/))) {
      return { type: 'sumSide', side: m[1], odds: ODDS.sumSide };
    }
    if ((m = t.match(/^([万千百十个])(大|小|单|双)$/))) {
      return { type: 'ballSide', pos: POS[m[1]], side: m[2], odds: ODDS.ballSide };
    }
    if ((m = t.match(/^([万千百十个])([0-9])$/))) {
      return { type: 'position', pos: POS[m[1]], digit: +m[2], odds: ODDS.position };
    }
    if ((m = t.match(/^(前三|中三|后三)(豹子|顺子|对子|半顺|杂六)$/))) {
      return { type: 'shape', seg: m[1], shape: m[2], odds: SHAPE_ODDS[m[2]] };
    }
    if ((m = t.match(/^(前三|中三|后三)组三([0-9])[,，]?([0-9])$/))) {
      if (m[2] === m[3]) return null;
      return { type: 'group3', seg: m[1], a: +m[2], b: +m[3], odds: ODDS.group3 };
    }
    if ((m = t.match(/^(前三|中三|后三)组六([0-9])[,，]?([0-9])[,，]?([0-9])$/))) {
      const set = new Set([m[2], m[3], m[4]]);
      if (set.size !== 3) return null;
      return { type: 'group6', seg: m[1], digits: [+m[2], +m[3], +m[4]], odds: ODDS.group6 };
    }
    if ((m = t.match(/^(前三|中三|后三)([0-9])$/))) {
      return { type: 'anyDigit', seg: m[1], digit: +m[2], odds: ODDS.anyDigit };
    }
    // 龙虎和：1/2龙（主口令）· 1vs2龙（兼容）
    if ((m = t.match(/^([1-5])\/([1-5])(龙|虎|和)$/))) {
      const a = +m[1] - 1;
      const b = +m[2] - 1;
      if (a >= b) return null;
      return { type: 'lhh', a, b, pick: m[3], odds: lhhPickOdds(m[3]) };
    }
    if ((m = t.match(/^([1-5])(?:vs|v)([1-5])(龙|虎|和)$/i))) {
      const a = +m[1] - 1;
      const b = +m[2] - 1;
      if (a >= b) return null;
      return { type: 'lhh', a, b, pick: m[3], odds: lhhPickOdds(m[3]) };
    }
    // 裸 龙/虎/和 = 1/5（万 vs 个）
    if (t === '龙' || t === '虎' || t === '和') {
      return { type: 'lhh', a: 0, b: 4, pick: t, odds: lhhPickOdds(t) };
    }
    if (t === '无牛') return { type: 'niu', val: -1, odds: ODDS.noNiu };
    if (t === '牛牛') return { type: 'niu', val: 10, odds: ODDS.niu };
    if ((m = t.match(/^牛([1-9])$/))) return { type: 'niu', val: +m[1], odds: ODDS.niu };
    if ((m = t.match(/^牛(大|小|单|双)$/))) return { type: 'niuSide', side: m[1], odds: ODDS.niuSide };
    return null;
  }

  /* ---------- 判定工具 ---------- */
  function sumOf(nums) { return nums.reduce((a, b) => a + b, 0); }
  function sideOfSum(s) { return { big: s >= 23, odd: s % 2 === 1 }; }
  function sideOfBall(n) { return { big: n >= 5, odd: n % 2 === 1 }; }
  function segOf(nums, seg) { const r = SEG[seg]; return nums.slice(r[0], r[1]); }

  /** 斗牛：返回 -1 无牛，10 牛牛，1~9 牛几 */
  function niuValue(nums) {
    const total = sumOf(nums);
    for (let i = 0; i < 3; i++) {
      for (let j = i + 1; j < 4; j++) {
        for (let k = j + 1; k < 5; k++) {
          if ((nums[i] + nums[j] + nums[k]) % 10 === 0) {
            const v = (total - nums[i] - nums[j] - nums[k]) % 10;
            return v === 0 ? 10 : v;
          }
        }
      }
    }
    return -1;
  }
  function niuLabel(v) {
    if (v === -1) return '无牛';
    if (v === 10) return '牛牛';
    return '牛' + v;
  }

  /** 前中后形态：豹子 / 顺子 / 对子 / 半顺 / 杂六（9-0、0-1 相连） */
  function shapeOf(arr3) {
    const s = arr3.slice().sort((a, b) => a - b);
    if (s[0] === s[2]) return '豹子';
    if (s[0] === s[1] || s[1] === s[2]) return '对子';
    for (let a = 0; a < 10; a++) {
      const set = new Set([a, (a + 1) % 10, (a + 2) % 10]);
      if (set.has(s[0]) && set.has(s[1]) && set.has(s[2])) return '顺子';
    }
    const adjacent = (x, y) => { const d = Math.abs(x - y); return d === 1 || d === 9; };
    if (adjacent(s[0], s[1]) || adjacent(s[1], s[2]) || adjacent(s[0], s[2])) return '半顺';
    return '杂六';
  }

  function matchSide(side, meta) {
    if (side === '大') return meta.big;
    if (side === '小') return !meta.big;
    if (side === '单') return meta.odd;
    return !meta.odd;
  }

  /** 官方规则结算：返回 { winAmount, profit, hit } */
  function settleBet(play, amount, nums) {
    const p = parsePlay(play);
    if (!p) return { winAmount: 0, profit: -amount, hit: '' };
    let win = false;
    switch (p.type) {
      case 'sumSide':
        win = matchSide(p.side, sideOfSum(sumOf(nums)));
        break;
      case 'ballSide':
        win = matchSide(p.side, sideOfBall(nums[p.pos]));
        break;
      case 'position':
        win = nums[p.pos] === p.digit;
        break;
      case 'anyDigit':
        win = segOf(nums, p.seg).includes(p.digit);
        break;
      case 'group3': {
        const seg = segOf(nums, p.seg).slice().sort((a, b) => a - b);
        const aab = [p.a, p.a, p.b].sort((a, b) => a - b);
        const abb = [p.a, p.b, p.b].sort((a, b) => a - b);
        const same = (x, y) => x[0] === y[0] && x[1] === y[1] && x[2] === y[2];
        win = same(seg, aab) || same(seg, abb);
        break;
      }
      case 'group6': {
        const seg = segOf(nums, p.seg);
        const set = new Set(seg);
        win = set.size === 3 && p.digits.every(d => set.has(d));
        break;
      }
      case 'lhh': {
        const x = nums[p.a], y = nums[p.b];
        const res = x > y ? '龙' : (x < y ? '虎' : '和');
        win = res === p.pick;
        break;
      }
      case 'niu':
        win = niuValue(nums) === p.val;
        break;
      case 'niuSide': {
        const v = niuValue(nums);
        if (v === -1) { win = false; break; }
        if (p.side === '大') win = v >= 6;        // 牛6~牛牛
        else if (p.side === '小') win = v <= 5;   // 牛1~牛5
        else if (p.side === '单') win = v % 2 === 1;
        else win = v % 2 === 0;                   // 牛2/4/6/8/牛牛
        break;
      }
      case 'shape':
        win = shapeOf(segOf(nums, p.seg)) === p.shape;
        break;
    }
    if (!win) return { winAmount: 0, profit: -amount, hit: '' };
    /* 与服务端 lottery.service 派彩一致：四舍五入到 2 位小数 */
    const winAmount = Math.round(amount * p.odds * 100) / 100;
    return { winAmount, profit: winAmount - amount, hit: play };
  }

  /* ================= 期号 / 时间 ================= */
  function pad(n, w) { return String(n).padStart(w, '0'); }
  /** Asia/Shanghai 日历部件（与服务端 genIssueNo 日切一致） */
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
  function dateKeyMD() {
    const p = shanghaiYmdParts(new Date());
    return '' + p.m + p.d;
  }
  /** 与服务端 genIssueNo 一致：MMDD + 6 位当日序号 */
  function fmtIssue(seq) {
    return dateKeyMD() + pad(Math.max(1, seq), 6);
  }
  function setCurIssueDisplay(issue) {
    $('#curIssue').text(issue).attr('title', issue);
  }
  function fmtTime(d) {
    return pad(d.getHours(), 2) + ':' + pad(d.getMinutes(), 2) + ':' + pad(d.getSeconds(), 2);
  }

  function nextOpenAtMs(now) {
    const intervalMs = INTERVAL * 1000;
    const t = now != null ? now : Date.now();
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
    let r = (openAt - Date.now()) / 1000;
    if (r <= 0) r = INTERVAL;
    return r;
  }
  function getCurrentIssue() {
    if (serverSynced && serverCurrent && serverCurrent.issueNo) return String(serverCurrent.issueNo);
    return fmtIssueFromOpenAt(nextOpenAtMs());
  }
  function isBettingOpen() {
    if (!serverSynced || !serverCurrent) return false;
    const open = serverCurrent.status === 'PENDING' && Date.now() < new Date(serverCurrent.lockAt).getTime();
    if (!open) return false;
    /* 仅冻结「仍是封盘那一期」；已换新期以服务端 lockAt 为准 */
    if (roomBetFrozen && sealedIssueNo && String(serverCurrent.issueNo) === String(sealedIssueNo)) return false;
    return true;
  }
  /** 未同步 / 封盘：统一 toast，避免误导 */
  function toastBetBlocked(kind) {
    if (!serverSynced) {
      App.toast('房间同步中，请稍候');
      return;
    }
    App.toast(kind === 'cancel' ? '当前期无可取消注单' : '封盘中，无法下注');
  }

  /* ================= 注单 ================= */
  const POS_CHARS = '万千百十个';
  const SIDE_CHARS = '大小单双';
  const SUOHA_WORDS = new Set(['梭哈', '全下', 'allin']);
  const AMOUNT_RE = '(?:\\d+|梭哈|全下|allin)';

  /** 玩法段拆成不重复的位置列表（保持顺序） */
  function splitPositions(posStr) {
    const out = [];
    const seen = new Set();
    for (const c of posStr) {
      if (!POS_CHARS.includes(c) || seen.has(c)) continue;
      seen.add(c);
      out.push(c);
    }
    return out;
  }

  /** 号码串去重（保序） */
  function uniqueDigitChars(digitStr) {
    const out = [];
    const seen = new Set();
    for (const c of String(digitStr || '')) {
      if (!/[0-9]/.test(c) || seen.has(c)) continue;
      seen.add(c);
      out.push(c);
    }
    return out;
  }

  /** 选号类：号码与金额之间必须 /（定位胆、牛几、不定位、组三组六） */
  function requiresSlashPlayPart(playPart) {
    const t = String(playPart || '');
    if (/^[万千百十个]+[0-9]+$/.test(t)) return true;
    if (/^牛[1-9]+$/.test(t)) return true;
    if (/^(前三|中三|后三)(?:组三|组六)?[0-9]+$/.test(t)) return true;
    return false;
  }

  /** 不定位复式：前三0123456 → 前三0…前三6 */
  function expandAnyDigitDuplex(seg, digitStr) {
    const digits = uniqueDigitChars(digitStr);
    if (!digits.length) return null;
    const plays = [];
    for (const d of digits) {
      const play = seg + d;
      if (!parsePlay(play)) return null;
      plays.push(play);
    }
    return plays;
  }

  /** 组三复式：选 n 个号 → C(n,2) 注（每注两个不同号，含对子形态） */
  function expandGroup3Duplex(seg, digitStr) {
    const digits = uniqueDigitChars(digitStr);
    if (digits.length < 2) return null;
    const plays = [];
    for (let i = 0; i < digits.length; i++) {
      for (let j = i + 1; j < digits.length; j++) {
        const play = seg + '组三' + digits[i] + digits[j];
        if (!parsePlay(play)) return null;
        plays.push(play);
      }
    }
    return plays.length ? plays : null;
  }

  /** 组六复式：选 n 个号 → C(n,3) 注 */
  function expandGroup6Duplex(seg, digitStr) {
    const digits = uniqueDigitChars(digitStr);
    if (digits.length < 3) return null;
    const plays = [];
    for (let i = 0; i < digits.length; i++) {
      for (let j = i + 1; j < digits.length; j++) {
        for (let k = j + 1; k < digits.length; k++) {
          const play = seg + '组六' + digits[i] + digits[j] + digits[k];
          if (!parsePlay(play)) return null;
          plays.push(play);
        }
      }
    }
    return plays.length ? plays : null;
  }

  const SHAPE_WORDS = ['豹子', '顺子', '半顺', '对子', '杂六'];

  /**
   * 形态组合：前三豹子顺子、前三中三豹子顺子杂六
   * → 每个段 × 每个形态各一注
   */
  function expandShapePlayPart(t) {
    let rest = t;
    const segs = [];
    while (/^(前三|中三|后三)/.test(rest)) {
      const seg = rest.match(/^(前三|中三|后三)/)[1];
      segs.push(seg);
      rest = rest.slice(seg.length);
    }
    if (!segs.length || !rest) return null;
    const shapes = [];
    while (rest) {
      let hit = null;
      for (const w of SHAPE_WORDS) {
        if (rest.startsWith(w)) { hit = w; break; }
      }
      if (!hit) return null;
      shapes.push(hit);
      rest = rest.slice(hit.length);
    }
    if (!shapes.length) return null;
    const plays = [];
    for (const seg of segs) {
      for (const sh of shapes) {
        const play = seg + sh;
        if (!parsePlay(play)) return null;
        plays.push(play);
      }
    }
    return plays;
  }

  /** 胶连多对：1/2龙1/3虎、1/2龙3/5和 */
  function expandLhhFromGlued(t) {
    const plays = [];
    const re = /([1-5])\/([1-5])(龙|虎|和)/g;
    let m;
    let consumed = '';
    while ((m = re.exec(t)) !== null) {
      const play = m[1] + '/' + m[2] + m[3];
      if (!parsePlay(play)) return null;
      plays.push(play);
      consumed += m[0];
    }
    if (!plays.length || consumed !== t) return null;
    return plays;
  }

  /** 解析玩法段 → 玩法名数组 */
  function expandPlayPart(playPart) {
    const t = String(playPart || '').replace(/\s+/g, '');
    if (!t) return null;

    // 多选总和两面：总大总小、大小单双、大单（键盘连点常见）
    if (/^(?:(?:总和|总)?[大小单双])+$/.test(t) || /^[大小单双]+$/.test(t)) {
      const compact = t.replace(/总和/g, '').replace(/总/g, '');
      if (/^[大小单双]+$/.test(compact)) {
        const plays = [];
        const seen = new Set();
        for (const c of compact) {
          if (seen.has(c)) continue;
          seen.add(c);
          if (parsePlay(c)) plays.push(c);
        }
        if (plays.length) return plays;
      }
    }

    // 多选龙虎和：龙虎、龙虎和
    if (/^[龙虎和]+$/.test(t)) {
      const plays = [];
      const seen = new Set();
      for (const c of t) {
        if (seen.has(c)) continue;
        seen.add(c);
        if (parsePlay(c)) plays.push(c);
      }
      if (plays.length) return plays;
    }

    // 多对龙虎胶连：1/2龙1/3虎
    {
      const lhGlued = expandLhhFromGlued(t);
      if (lhGlued) return lhGlued;
    }

    // 多选牛两面：牛大牛小
    if (/^(?:牛[大小单双])+$/.test(t)) {
      const plays = [];
      const seen = new Set();
      const re = /牛([大小单双])/g;
      let mSide;
      while ((mSide = re.exec(t))) {
        const play = '牛' + mSide[1];
        if (seen.has(play)) continue;
        seen.add(play);
        if (parsePlay(play)) plays.push(play);
      }
      if (plays.length) return plays;
    }

    // 多位置 + 两面：万千百十个单 → 五位各买单（任意子集均可）
    let m = t.match(/^([万千百十个]+)([大小单双])$/);
    if (m) {
      const plays = [];
      for (const p of splitPositions(m[1])) {
        const play = p + m[2];
        if (!parsePlay(play)) return null;
        plays.push(play);
      }
      return plays.length ? plays : null;
    }

    // 多位置 + 号码：十个59 → 十5、十9、个5、个9（号码与金额必须 /）
    m = t.match(/^([万千百十个]+)([0-9]+)$/);
    if (m) {
      const positions = splitPositions(m[1]);
      const plays = [];
      for (const p of positions) {
        for (const d of m[2]) {
          const play = p + d;
          if (!parsePlay(play)) return null;
          plays.push(play);
        }
      }
      return plays.length ? plays : null;
    }

    // 形态：前三豹子顺子、前三中三豹子顺子杂六（金额可无 /）
    if (/^(?:前三|中三|后三)+(?:豹子|顺子|半顺|对子|杂六)+$/.test(t)) {
      return expandShapePlayPart(t);
    }

    // 组三复式：前三组三012345 → C(n,2) 注（号码与金额必须 /）
    m = t.match(/^(前三|中三|后三)组三([0-9]{2,})$/);
    if (m) return expandGroup3Duplex(m[1], m[2]);

    // 组六复式：前三组六012345 → C(n,3) 注（号码与金额必须 /）
    m = t.match(/^(前三|中三|后三)组六([0-9]{3,})$/);
    if (m) return expandGroup6Duplex(m[1], m[2]);

    // 不定位复式：前三0123456 → 每位号一注（号码与金额必须 /）
    m = t.match(/^(前三|中三|后三)([0-9]{2,})$/);
    if (m) return expandAnyDigitDuplex(m[1], m[2]);

    // 牛 → 牛牛；牛123456 → 牛1…牛6（牛几与金额必须 /）
    if (t === '牛') return ['牛牛'];
    m = t.match(/^牛([1-9]+)$/);
    if (m) {
      const plays = [];
      for (const d of m[1]) {
        const play = '牛' + d;
        if (!parsePlay(play)) return null;
        plays.push(play);
      }
      return plays;
    }

    if (!parsePlay(t)) return null;
    return [t];
  }

  /** 梭哈：单注全下；多注按余额均分 */
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

  function finalizeBetLines(plays, amountPart) {
    if (!plays || !plays.length) return null;
    for (const play of plays) {
      if (!parsePlay(play)) return null;
    }
    return resolveBetAmounts(plays, amountPart);
  }

  /**
   * 解析一条聊天投注 → [{ play, amount }, ...]
   * 规则摘要：
   * - 两面 / 龙虎和 / 无牛·牛牛·牛两面 / 形态：金额可带 / 或不带 /
   * - 凡带选号数字（定位胆、不定位、组三组六、牛几）：号码与金额之间必须 /
   * - 形态可组合：前三豹子顺子、前三中三豹子顺子杂六
   * - 组三复式 C(n,2)；组六复式 C(n,3)；/金额 = 每注金额
   */
  function parseBetLines(text) {
    const raw = String(text || '').trim().replace(/\s+/g, '');
    if (!raw) return null;

    // 定位胆多位同号：万千百十个/5/100（位可省略组合）
    let m = raw.match(new RegExp('^([万千百十个]+)\\/([0-9]+)\\/(' + AMOUNT_RE + ')$', 'i'));
    if (m) {
      const plays = [];
      for (const p of splitPositions(m[1])) {
        for (const d of m[2]) {
          const play = p + d;
          if (!parsePlay(play)) return null;
          plays.push(play);
        }
      }
      return finalizeBetLines(plays, m[3]);
    }

    // 玩法/金额
    m = raw.match(new RegExp('^(.+)\\/(' + AMOUNT_RE + ')$', 'i'));
    if (m) {
      const plays = expandPlayPart(m[1]);
      return finalizeBetLines(plays, m[2]);
    }

    // 无 /：末尾金额（定位胆、牛几、不定位/组三/组六复式禁止）
    m = raw.match(/^(.+?)(\d+)$/);
    if (!m) return null;
    const playPart = m[1];
    if (requiresSlashPlayPart(playPart)) return null;
    const plays = expandPlayPart(playPart);
    return finalizeBetLines(plays, m[2]);
  }

  /** 解析聊天框投注（支持空格分隔多注） */
  function parseBetInput(text) {
    const raw = String(text || '').trim();
    if (!raw) return null;
    const parts = raw.split(/\s+/).filter(Boolean);
    const all = [];
    for (const part of parts) {
      const lines = parseBetLines(part);
      if (!lines) return null;
      all.push(...lines);
    }
    return all.length ? all : null;
  }

  function formatResolvedBets(lines) {
    return lines.map(l => `${l.play}/${l.amount}`).join(' ');
  }

  /** 梭哈/发送前去掉末尾金额；保留定位胆 万千百十个/5 的选号 / */
  function stripComposerAmount(part) {
    const raw = String(part || '').trim();
    const compact = raw.replace(/\s+/g, '');
    if (/^[万千百十个]+\/[0-9]+$/.test(compact)) return compact;
    return raw.replace(/\/(\d+|梭哈|全下|allin)$/i, '').replace(/\/$/, '').trim();
  }

  /** 玩法与金额之间：没有 / 就补上；已有 / 或 各 则不再加 */
  function joinPlayAmount(play, amount) {
    const p = String(play || '').replace(/\s+$/g, '');
    const a = String(amount);
    if (!p) return a;
    const compact = p.replace(/\s+/g, '');
    if (/^[万千百十个]+\/[0-9]+$/.test(compact)) return p + '/' + a;
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
    const raw = $in.val().replace(/\s+/g, ' ').trim();
    if (!raw) {
      App.toast('请先输入玩法，再点梭哈');
      return false;
    }
    const parts = raw.split(/\s+/).filter(Boolean);
    const allPlays = [];
    for (const part of parts) {
      let plays = null;
      const stripped = stripComposerAmount(part);
      let via = parseBetLines(stripped + '/梭哈');
      if (via && via.length) {
        plays = via.map(l => l.play);
      } else {
        plays = expandPlayPart(stripped);
      }
      if ((!plays || !plays.length)) {
        const existing = parseBetLines(part);
        if (existing && existing.length) plays = existing.map(l => l.play);
      }
      if ((!plays || !plays.length)) {
        const gm = stripped.match(/^(.+?)(\d+)$/);
        if (gm && !requiresSlashPlayPart(gm[1])) {
          plays = expandPlayPart(gm[1]);
        }
      }
      if (!plays || !plays.length) {
        App.toast('玩法无效，请检查后再点梭哈');
        return false;
      }
      allPlays.push(...plays);
    }
    const lines = resolveBetAmounts(allPlays, '梭哈');
    if (!lines) {
      App.toast('余额不足，无法梭哈');
      return false;
    }
    /* 输入框写入「实际每注金额」，与发送时实扣一致（余数落在第一注） */
    $in.val(lines.map(function (l) { return joinPlayAmount(l.play, l.amount); }).join(' '));
    composerAllin = false;
    const total = lines.reduce(function (s, l) { return s + l.amount; }, 0);
    updateComposerAction();
    App.toast('梭哈已分配 · ' + lines.length + '注 · 合计' + total);
    return true;
  }

  function parseBet(text) {
    const lines = parseBetLines(text);
    if (!lines || lines.length !== 1) return lines || null;
    return lines[0];
  }

  function recordBetLine(name, play, amount, opts) {
    if (!isBettingOpen()) return false;
    if (!parsePlay(play) || !amount) return false;
    const issue = getCurrentIssue();
    if (!issueBetBook[issue]) issueBetBook[issue] = {};
    if (!issueBetBook[issue][name]) issueBetBook[issue][name] = [];
    const row = { play, amount };
    if (opts && opts.mock) row.mock = true;
    issueBetBook[issue][name].push(row);
    saveBetBook();
    if (!(opts && opts.mock) && name === user.name) appendUserBetLog(issue, play, amount);
    return true;
  }

  function betBookStorageKey() {
    const uid = (user && user.uid) ? user.uid : 'guest';
    return 'ssc_betbook_v1_' + uid + (roomNo ? '_' + roomNo : '');
  }
  function saveBetBook() {
    try {
      const keys = Object.keys(issueBetBook);
      const keep = keys.slice(-8);
      const slim = {};
      keep.forEach((k) => { slim[k] = issueBetBook[k]; });
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

  /* ================= 注单持久化（供竞猜记录页） ================= */
  function betLogKey() {
    return 'ssc_bet_log_' + user.uid;
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
      window.dispatchEvent(new CustomEvent('ssc-bet-log-updated'));
    } catch (e) { /* */ }
  }
  function appendUserBetLog(issue, play, amount) {
    const log = loadUserBetLog();
    let group = log.find(g => g.issue === issue);
    if (!group) {
      group = {
        game: 'ssc',
        issue,
        createdAt: new Date().toISOString(),
        settled: false,
        bets: [],
        totalAmount: 0,
        totalProfit: 0
      };
      log.unshift(group);
    }
    group.bets.push({
      play,
      amount,
      status: 'PENDING',
      profit: 0,
      winAmount: 0,
      hit: ''
    });
    group.totalAmount += amount;
    saveUserBetLog(log);
  }
  function clearUserPendingBetLog(issue) {
    const log = loadUserBetLog();
    const group = log.find(g => g.issue === issue);
    if (!group || group.settled) return;
    group.bets = [];
    group.totalAmount = 0;
    group.totalProfit = 0;
    group.cancelled = true;
    saveUserBetLog(log);
  }
  function recordBetLines(name, lines, opts) {
    if (!lines || !lines.length) return false;
    let ok = false;
    lines.forEach(({ play, amount }) => {
      if (recordBetLine(name, play, amount, opts)) ok = true;
    });
    return ok;
  }

  function recordBet(name, text, opts) {
    const lines = parseBetInput(text);
    if (!lines) return false;
    return recordBetLines(name, lines, opts);
  }
  function fmtMoney2(n) {
    return (Math.round((Number(n) || 0) * 100) / 100).toFixed(2);
  }
  function fmtProfit(n) {
    const v = Math.round((Number(n) || 0) * 100) / 100;
    return (v >= 0 ? '+' : '') + v.toFixed(2);
  }
  function buildBetListVerifyFromServer(issue, list) {
    const scoped = App.filterLotteryBetsByIssue ? App.filterLotteryBetsByIssue(list, issue) : (Array.isArray(list) ? list : []);
    const bets = scoped.filter(function (b) { return b && b.status !== 'CANCELLED'; });
    const empty = '<div class="ssc-bot-empty">本期暂无下注</div>';
    if (!bets.length) {
      return '<div class="ssc-bot-card ssc-bot-card--bets"><div class="ssc-bot-card__head"><span class="ssc-bot-card__title">注单核对</span><span class="ssc-bot-card__issue">' + issue + '</span></div>' + empty + '</div>';
    }
    const total = bets.reduce(function (s, b) { return s + (Number(b.amount) || 0); }, 0);
    const groups = App.groupLotteryBetsByType(bets);
    const tags = groups.map(function (g) {
      return '<span class="ssc-bot-tag">' + g.label + '×' + g.count + '/' + fmtMoney2(g.amount) + '</span>';
    }).join('');
    let detail = '';
    if (bets.length <= 8) {
      detail = '<div class="ssc-bot-user__tags" style="margin-top:6px">' + bets.map(function (b) {
        return '<span class="ssc-bot-tag">' + App.labelLotteryBet(b) + '/' + fmtMoney2(b.amount) + '</span>';
      }).join('') + '</div>';
    }
    const userBlock = '<div class="ssc-bot-user is-me"><div class="ssc-bot-user__head"><span class="ssc-bot-user__name">我</span><span class="ssc-bot-user__sum">' + fmtMoney2(total) + '</span></div><div class="ssc-bot-user__tags">' + tags + '</div>' + detail + '</div>';
    return '<div class="ssc-bot-card ssc-bot-card--bets"><div class="ssc-bot-card__head"><span class="ssc-bot-card__title">注单核对</span><span class="ssc-bot-card__issue">' + issue + '</span></div><div class="ssc-bot-card__body is-full">' + userBlock + '</div></div>';
  }
  /** 用服务端账本生成「您本期」行（氛围卡主体仍用本地 settled） */
  function buildMineLineHtmlFromServer(issue, list) {
    const scoped = App.filterLotteryBetsByIssue ? App.filterLotteryBetsByIssue(list, issue) : (Array.isArray(list) ? list : []);
    const bets = scoped.filter(function (b) { return b && b.status !== 'CANCELLED' && b.status !== 'PENDING'; });
    if (!bets.length) return '';
    const myProfit = bets.reduce(function (sum, b) { return sum + serverBetProfit(b); }, 0);
    const myWin = bets.reduce(function (sum, b) { return sum + (Number(b.payout) || 0); }, 0);
    const profitCls = myProfit >= 0 ? 'pos' : 'neg';
    const winText = myWin > 0 ? ('中奖 +' + fmtMoney2(myWin)) : '未中奖';
    return '<div class="ssc-bot-mine-line ' + profitCls + '">' +
      '<span class="ssc-bot-mine-line__label">您本期</span>' +
      '<span class="ssc-bot-mine-line__win">' + winText + '</span>' +
      '<span class="ssc-bot-mine-line__profit">输赢 ' + fmtProfit(myProfit) + '</span>' +
      '</div>';
  }
  function applyMineLineToWinHtml(html, mineHtml) {
    if (!mineHtml) return html;
    const re = /<div class="ssc-bot-mine-line[\s\S]*?<\/div>/;
    if (re.test(html)) return html.replace(re, mineHtml);
    return html.replace(/<\/div>\s*$/, mineHtml + '</div>');
  }

  function buildBetListVerifyHtml(issue) {
    const book = issueBetBook[issue];
    if (!book || !Object.keys(book).length) {
      return `<div class="ssc-bot-card ssc-bot-card--bets">
        <div class="ssc-bot-card__head"><span class="ssc-bot-card__title">注单核对</span><span class="ssc-bot-card__issue">${issue}</span></div>
        <div class="ssc-bot-empty">本期暂无下注</div>
      </div>`;
    }
    const names = Object.keys(book);
    const users = names.map(name => {
      const bets = book[name];
      const total = bets.reduce((s, b) => s + b.amount, 0);
      const tags = bets.map(b => `<span class="ssc-bot-tag">${b.play}/${fmtMoney2(b.amount)}</span>`).join('');
      const me = name === user.name ? ' is-me' : '';
      return `<div class="ssc-bot-user${me}">
        <div class="ssc-bot-user__head"><span class="ssc-bot-user__name">${name}</span><span class="ssc-bot-user__sum">${fmtMoney2(total)}</span></div>
        <div class="ssc-bot-user__tags">${tags}</div>
      </div>`;
    }).join('');
    return `<div class="ssc-bot-card ssc-bot-card--bets">
      <div class="ssc-bot-card__head"><span class="ssc-bot-card__title">注单核对</span><span class="ssc-bot-card__issue">${issue}</span></div>
<div class="ssc-bot-card__body is-full">${users}</div>
    </div>`;
  }

  function buildWinListVerifyHtml(issue, settled) {
    const pending = settled == null;
    if (pending) {
      return `<div class="ssc-bot-card ssc-bot-card--win is-calculating">
      <div class="ssc-bot-card__head"><span class="ssc-bot-card__title">中奖核对</span><span class="ssc-bot-card__issue">${issue}</span></div>
      <div class="ssc-bot-card__body is-full">
        <div class="ssc-bot-calc-line">
          <span class="ssc-bot-calc-line__icon" aria-hidden="true"></span>
          <span class="ssc-bot-calc-line__text">正在核对中奖注单</span>
        </div>
      </div>
    </div>`;
    }
    const winners = Object.keys(settled || {}).filter(name =>
      settled[name].some(r => r.winAmount > 0)
    );
    let body = '';
    if (winners.length) {
      winners.sort((a, b) => {
        const pa = settled[a].reduce((s, r) => s + r.profit, 0);
        const pb = settled[b].reduce((s, r) => s + r.profit, 0);
        return pb - pa;
      });
      body = winners.map(name => {
        const winRows = settled[name].filter(r => r.winAmount > 0);
        const totalWin = winRows.reduce((s, r) => s + r.winAmount, 0);
        const totalProfit = settled[name].reduce((s, r) => s + r.profit, 0);
        const tags = winRows.map(r =>
          `<span class="ssc-bot-tag ssc-bot-tag--win">${r.play}/${fmtMoney2(r.amount)}</span>`
        ).join('');
        const profitCls = totalProfit >= 0 ? 'pos' : 'neg';
        return `<div class="ssc-bot-user">
          <div class="ssc-bot-user__head">
            <span class="ssc-bot-user__name">${name}</span>
            <span class="ssc-bot-user__profit ${profitCls}">${fmtProfit(totalProfit)}</span>
          </div>
          <div class="ssc-bot-user__tags">${tags}</div>
          <div class="ssc-bot-user__sub">中奖 +${fmtMoney2(totalWin)}</div>
        </div>`;
      }).join('');
    } else {
      body = '<div class="ssc-bot-empty">本期暂无中奖</div>';
    }
    let mine = '';
    const myRows = settled && settled[user.name];
    if (myRows && myRows.length) {
      const myProfit = myRows.reduce((s, r) => s + r.profit, 0);
      const myWin = myRows.reduce((s, r) => s + r.winAmount, 0);
      const profitCls = myProfit >= 0 ? 'pos' : 'neg';
      const winText = myWin > 0 ? `中奖 +${fmtMoney2(myWin)}` : '未中奖';
      mine = `<div class="ssc-bot-mine-line ${profitCls}">
        <span class="ssc-bot-mine-line__label">您本期</span>
        <span class="ssc-bot-mine-line__win">${winText}</span>
        <span class="ssc-bot-mine-line__profit">输赢 ${fmtProfit(myProfit)}</span>
      </div>`;
    }
    return `<div class="ssc-bot-card ssc-bot-card--win">
      <div class="ssc-bot-card__head"><span class="ssc-bot-card__title">中奖核对</span><span class="ssc-bot-card__issue">${issue}</span></div>
      <div class="ssc-bot-card__body is-full">${body}</div>
      ${mine}
    </div>`;
  }

  /** 正版开奖动画：滚号 mid + 出号约 3.2s（对齐 video-host play） */
  const SSC_VIDEO_SRC = './media/ssc-video/xyssx_index.html?v=17&embed=1&logo=kl&mute=1';
  /** 滚号 6s 后出号；出号后约 3.2s（over→回待机 BGM） */
  const SSC_VIDEO_MID_MS = 6000;
  const SSC_VIDEO_AFTER_MS = 3200;
  /** 开奖仪式跳动时长：占满封盘准备窗（扣掉核对后 1s + 钉底 1s） */
  function ceremonyRevealMs() {
    return Math.max(5000, ((typeof PREP_SEC === 'number' ? PREP_SEC : 10) - 2) * 1000);
  }
  function resultRevealDurationMs() {
    return SSC_VIDEO_MID_MS + SSC_VIDEO_AFTER_MS;
  }
  function sscVideoOrderStr(nums) {
    return (nums || []).map(function (n) { return String(Number(n)); }).join(',');
  }

  function closeNoticeHtml(issue) {
    return `<div class="ssc-bot-close-line">
      <div class="ssc-bot-close-line__bar">
        <span class="ssc-bot-close-line__deco"></span>
        <span class="ssc-bot-close-line__text">封 盘 线</span>
        <span class="ssc-bot-close-line__deco"></span>
      </div>
      <div class="ssc-bot-close-line__sub">第 <span class="ssc-bot-close-line__issue">${issue}</span> 期 · 停止下注 · 即将开奖</div>
    </div>`;
  }
  function openNoticeHtml(issue) {
    return `<div class="ssc-bot-open-line">
      <div class="ssc-bot-open-line__bar">
        <span class="ssc-bot-open-line__deco"></span>
        <span class="ssc-bot-open-line__text">开 盘 线</span>
        <span class="ssc-bot-open-line__deco"></span>
      </div>
      <div class="ssc-bot-open-line__sub">第 <span class="ssc-bot-open-line__issue">${issue}</span> 期 · 开始下注</div>
    </div>`;
  }

  /* ================= 开奖 ================= */
  function ballHtml(n, cls) {
    const c = cls ? ' ' + cls : '';
    return `<span class="ssc-ball-digit${c}">${n}</span>`;
  }
  function gyMeta(nums) {
    const s = sumOf(nums);
    return { text: `${s} ${s >= 23 ? '大' : '小'} ${s % 2 ? '单' : '双'}`, sum: s };
  }
  /** 斗牛文案（历史列沿用 lh 字段名） */
  function lhRow(nums) {
    return niuLabel(niuValue(nums));
  }
  /** 万位 vs 个位 · 龙虎和 */
  function dragonTigerOf(nums) {
    const wan = nums[0];
    const ge = nums[4];
    return wan > ge ? '龙' : wan < ge ? '虎' : '和';
  }
  function barSummaryHtml(row) {
    const gy = row.gy || gyMeta(row.nums).text;
    const dt = row.dt || dragonTigerOf(row.nums);
    const lh = row.lh || lhRow(row.nums);
    return `${gy}<span class="sep">·</span>${dt}<span class="sep">·</span>${lh}`;
  }
  function renderDrawBar(row) {
    if (!row) return;
    $('#barIssue').text(row.issue);
    $('#barBalls').html(row.nums.map(n => ballHtml(n, 'xs')).join(''));
    $('#barSummary').html(barSummaryHtml(row));
  }
  function renderDrawTable() {
    $('#drawTableBody').html(historyRows.slice(0, HISTORY_SHOW).map(r => `
      <tr><td class="ssc-draw-table__issue">${r.issue}</td>
      ${r.nums.map(n => `<td>${ballHtml(n, 'tbl')}</td>`).join('')}
      <td class="cell-gy">${r.gy.replace(/\s+/g, '')}</td>
      <td class="cell-dt">${r.dt || dragonTigerOf(r.nums)}</td>
      <td class="cell-lh">${r.lh}</td></tr>`).join(''));
  }
  function resultCardHtml(nums, issue, opts) {
    opts = opts || {};
    const meta = gyMeta(nums);
    const sideText = String(meta.text || '').replace(/^\d+\s*/, '').replace(/\s+/g, '');
    const order = sscVideoOrderStr(nums);
    const issueShow = String(issue || '').trim();
    let srcQ = SSC_VIDEO_SRC;
    if (issueShow) srcQ += '&issue=' + encodeURIComponent(issueShow);
    if (order) srcQ += '&order=' + encodeURIComponent(order);
    if (opts.settle) srcQ += '&settle=1';
    return (
      '<div class="ssc-video-card ssc-bot-card--result is-reveal" data-issue="' + issueShow +
        '" data-nums="' + order + '" data-sum="' + meta.sum + '">' +
        '<div class="ssc-video-card__stage">' +
          '<iframe class="ssc-video-card__frame" title="快乐时时彩开奖动画" src="' + srcQ +
            '" data-nums="' + order + '" data-issue="' + issueShow +
            '" allow="autoplay" loading="eager"></iframe>' +
        '</div>' +
        '<footer class="ssc-video-card__foot">' +
          '<div class="ssc-video-card__pill"><span class="k">和值</span><span class="v">' + meta.sum + '</span></div>' +
          '<div class="ssc-video-card__pill"><span class="k">双面</span><span class="v">' + sideText + '</span></div>' +
          '<div class="ssc-video-card__pill"><span class="k">龙虎</span><span class="v">' + dragonTigerOf(nums) + '</span></div>' +
          '<div class="ssc-video-card__pill"><span class="k">斗牛</span><span class="v">' + lhRow(nums) + '</span></div>' +
        '</footer>' +
      '</div>'
    );
  }

  function postToSscVideoFrame(frame, payload) {
    if (!frame || !frame.contentWindow) return false;
    try {
      frame.contentWindow.postMessage(
        Object.assign({ source: 'ssc-video' }, payload || {}), location.origin);
      return true;
    } catch (e) {
      return false;
    }
  }

  function whenSscVideoReady(frame, cb) {
    if (!frame) {
      if (typeof cb === 'function') cb(false);
      return;
    }
    let done = false;
    let pollTimer = null;
    const finish = function (ok) {
      if (done) return;
      done = true;
      if (pollTimer) clearInterval(pollTimer);
      window.removeEventListener('message', onMsg);
      if (typeof cb === 'function') cb(!!ok);
    };
    const hasApi = function () {
      try {
        return !!(frame.contentWindow && frame.contentWindow.SscVideo);
      } catch (e) {
        return false;
      }
    };
    const onMsg = function (ev) {
      const d = ev && ev.data;
      if (!d || d.source !== 'ssc-video') return;
      if (d.action === 'ready' && ev.source === frame.contentWindow) finish(true);
    };
    window.addEventListener('message', onMsg);
    if (hasApi()) {
      finish(true);
      return;
    }
    frame.addEventListener('load', function () {
      setTimeout(function () { finish(true); }, 80);
    });
    let n = 0;
    pollTimer = setInterval(function () {
      n += 1;
      if (hasApi() || n >= 40) finish(!!hasApi() || n >= 40);
    }, 50);
  }

  function playSscVideoCard(card, nums, opts) {
    opts = opts || {};
    const frame = card && card.querySelector('.ssc-video-card__frame');
    const order = sscVideoOrderStr(nums);
    const issue = String((opts.issue != null && String(opts.issue).trim())
      || (card && card.getAttribute('data-issue')) || '').trim();
    if (!frame || !order) {
      if (typeof opts.onDone === 'function') opts.onDone(false);
      return;
    }
    /* 标记播放中，防止 snapshot 的 settleRestored 把 iframe 强制 settle 掉 */
    card.classList.add('is-playing');
    card.setAttribute('data-playing', '1');
    whenSscVideoReady(frame, function () {
      const doneWrap = function (ok) {
        card.classList.remove('is-playing');
        card.removeAttribute('data-playing');
        if (window.SscAudio && SscAudio.endDrawCeremony) SscAudio.endDrawCeremony();
        else if (window.SscAudio && SscAudio.onRevealDone) SscAudio.onRevealDone();
        if (typeof opts.onDone === 'function') opts.onDone(ok);
      };
      if (window.SscAudio) {
        if (SscAudio.unlock) SscAudio.unlock();
        if (SscAudio.startDrawCeremony) {
          SscAudio.startDrawCeremony({ midMs: SSC_VIDEO_MID_MS });
        }
      }
      const w = frame.contentWindow;
      if (w && w.SscVideo && typeof w.SscVideo.play === 'function') {
        /* iframe 静音，音效由父页 SscAudio 播，避免双轨与自动播放拦截 */
        w.SscVideo.play(order, {
          issue: issue,
          midMs: SSC_VIDEO_MID_MS,
          muted: true,
          onDone: doneWrap,
        });
        return;
      }
      postToSscVideoFrame(frame, {
        action: 'play',
        order: order,
        issue: issue,
        midMs: SSC_VIDEO_MID_MS,
        muted: true,
      });
      setTimeout(function () { doneWrap(true); }, resultRevealDurationMs());
    });
  }

  function settleSscVideoCard(card, nums) {
    if (card && (card.classList.contains('is-playing') || card.getAttribute('data-playing') === '1')) {
      return; /* 滚号中禁止改 src / settle */
    }
    const frame = card && card.querySelector('.ssc-video-card__frame');
    let order = '';
    if (Array.isArray(nums) && nums.length === 5) order = sscVideoOrderStr(nums);
    else order = String((card && card.getAttribute('data-nums')) || (frame && frame.getAttribute('data-nums')) || '').trim();
    const issue = String((card && card.getAttribute('data-issue')) || '').trim();
    if (!frame || !order) return;
    try {
      const cur = String(frame.getAttribute('src') || '');
      if (cur && cur.indexOf('settle=1') < 0) {
        let next = cur;
        if (next.indexOf('order=') < 0) next += '&order=' + encodeURIComponent(order);
        if (issue && next.indexOf('issue=') < 0) next += '&issue=' + encodeURIComponent(issue);
        next += '&settle=1';
        frame.setAttribute('src', next);
        return;
      }
    } catch (e) { /* fall through */ }
    whenSscVideoReady(frame, function () {
      const w = frame.contentWindow;
      if (w && w.SscVideo && typeof w.SscVideo.settle === 'function') {
        w.SscVideo.settle(order, { issue: issue, muted: true });
        return;
      }
      postToSscVideoFrame(frame, { action: 'settle', order: order, issue: issue, muted: true });
    });
  }
  const HISTORY_SHOW = 10;
  const POS_LABELS = ['万', '千', '百', '十', '个'];
  const MIN_LONG_STREAK = 2;
  const ROAD_WINDOW = 24;
  let longTab = 'side';

  function playForLongName(name) {
    const sum = name.match(/^总(.+)$/);
    if (sum) return sum[1];
    if (/^[万千百十个][大小单双]$/.test(name)) return name;
    if (/^[万千百十个][0-9]$/.test(name)) return name;
    if (/^[1-5]\/[1-5](龙|虎|和)$/.test(name)) return name;
    if (/^[1-5]vs[1-5](龙|虎|和)$/.test(name)) return name;
    if (name === '龙' || name === '虎' || name === '和') return name;
    if (name === '无牛' || name.startsWith('牛')) return name;
    if (/^(前三|中三|后三)/.test(name)) return name;
    return '';
  }

  function pushLongDim(list, group, labels, namePrefix) {
    const s = streakAtHead(labels);
    if (!s.tag) return;
    const name = (namePrefix || '') + s.tag;
    list.push({
      name,
      group,
      count: s.count,
      play: playForLongName(name),
    });
  }

  function roadLabelsForTab(tab) {
    const rows = historyRows.filter(r => Array.isArray(r.nums) && r.nums.length === 5).slice(0, ROAD_WINDOW);
    if (tab === 'lhh') {
      /* 路珠默认看 1vs5（万vs个），与大厅龙虎摘要一致 */
      return rows.map(r => {
        const x = r.nums[0];
        const y = r.nums[4];
        return x > y ? '龙' : (x < y ? '虎' : '和');
      });
    }
    if (tab === 'niu') return rows.map(r => niuLabel(niuValue(r.nums)));
    const sumMeta = rows.map(r => sideOfSum(sumOf(r.nums)));
    return sumMeta.map(m => (m.big ? '大' : '小') + (m.odd ? '单' : '双'));
  }

  function roadHtml(labels) {
    if (!labels.length) return '';
    const chips = labels.map((tag, i) =>
      `<span class="ssc-long-road__chip ${longTagClass(tag)}${i === 0 ? ' is-latest' : ''}">${tag}</span>`
    ).join('');
    return `<div class="ssc-long-road"><div class="ssc-long-road__label">近 ${labels.length} 期走势 · 左新右旧</div><div class="ssc-long-road__row">${chips}</div></div>`;
  }

  function currentShapeHtml(items) {
    if (!items.length) return '';
    const cards = items.map(item => {
      const play = item.play || playForLongName(item.name);
      const playAttr = play && parsePlay(play) ? ` data-predict-play="${play}"` : '';
      const clickable = playAttr ? ' is-clickable' : '';
      return `<div class="ssc-long-shape${clickable}"${playAttr} role="${playAttr ? 'button' : 'group'}"${playAttr ? ' tabindex="0"' : ''}>
        <span class="ssc-long-shape__group">${item.group}</span>
        <span class="ssc-long-shape__tag ${longTagClass(item.name)}">${item.name}</span>
        <span class="ssc-long-shape__count">${item.count}<small>连</small></span>
      </div>`;
    }).join('');
    return `<div class="ssc-long-shape-wrap"><div class="ssc-long-road__label">当前形态</div><div class="ssc-long-shape-grid">${cards}</div></div>`;
  }

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

  function buildLongDragonGroups() {
    const rows = historyRows.filter(r => Array.isArray(r.nums) && r.nums.length === 5);
    const side = [];
    const lhh = [];
    const niu = [];
    if (!rows.length) return { side, lhh, niu };

    const sumMeta = rows.map(r => sideOfSum(sumOf(r.nums)));
    pushLongDim(side, '总和大小', sumMeta.map(m => (m.big ? '大' : '小')), '总');
    pushLongDim(side, '总和单双', sumMeta.map(m => (m.odd ? '单' : '双')), '总');

    POS_LABELS.forEach((pos, idx) => {
      const ballMeta = rows.map(r => sideOfBall(r.nums[idx]));
      pushLongDim(side, pos + '位大小', ballMeta.map(m => (m.big ? '大' : '小')), pos);
      pushLongDim(side, pos + '位单双', ballMeta.map(m => (m.odd ? '单' : '双')), pos);
    });

    LHH_PAIRS.forEach(([a, b]) => {
      const title = (a + 1) + '/' + (b + 1);
      pushLongDim(lhh, title, rows.map(r => {
        const x = r.nums[a];
        const y = r.nums[b];
        return x > y ? '龙' : (x < y ? '虎' : '和');
      }), title);
    });

    pushLongDim(niu, '有无斗牛', rows.map(r => (niuValue(r.nums) === -1 ? '无牛' : '有牛')));
    pushLongDim(niu, '斗牛大小', rows.map(r => {
      const v = niuValue(r.nums);
      if (v === -1) return '无牛';
      return (v >= 6 || v === 10) ? '牛大' : '牛小';
    }));
    pushLongDim(niu, '斗牛单双', rows.map(r => {
      const v = niuValue(r.nums);
      if (v === -1) return '无牛';
      return v % 2 === 1 ? '牛单' : '牛双';
    }));
    pushLongDim(niu, '斗牛点数', rows.map(r => niuLabel(niuValue(r.nums))));

    const sortDesc = arr => arr.sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, 'zh'));
    return {
      side: sortDesc(side.filter(x => x.count >= MIN_LONG_STREAK)),
      lhh: sortDesc(lhh.filter(x => x.count >= MIN_LONG_STREAK)),
      niu: sortDesc(niu.filter(x => x.count >= MIN_LONG_STREAK && x.name !== '有牛')),
    };
  }

  function longItemParts(name) {
    const pos = name.match(/^([万千百十个])(.+)$/);
    if (pos) return { group: pos[1] + '位', tag: pos[2], full: name };
    const sum = name.match(/^总(.+)$/);
    if (sum) return { group: '总和', tag: sum[1], full: name };
    const lhhSlash = name.match(/^([1-5]\/[1-5])(龙|虎|和)$/);
    if (lhhSlash) return { group: '龙虎', tag: lhhSlash[2], full: `${lhhSlash[1]} · ${lhhSlash[2]}` };
    const lhhVs = name.match(/^([1-5]vs[1-5])(龙|虎|和)$/);
    if (lhhVs) return { group: '龙虎', tag: lhhVs[2], full: `${lhhVs[1]} · ${lhhVs[2]}` };
    if (name === '龙' || name === '虎' || name === '和') {
      return { group: '龙虎', tag: name, full: `1/5 · ${name}` };
    }
    if (name === '无牛' || name.startsWith('牛')) return { group: '斗牛', tag: name, full: name };
    return { group: '形态', tag: name, full: name };
  }

  function longTagClass(tag) {
    if (['大', '龙', '牛大'].includes(tag)) return 'tag-red';
    if (['小', '虎', '牛小'].includes(tag)) return 'tag-blue';
    if (['单', '牛单'].includes(tag)) return 'tag-gold';
    if (['双', '牛双'].includes(tag)) return 'tag-purple';
    if (tag === '和') return 'tag-green';
    if (tag === '无牛') return 'tag-muted';
    return 'tag-gold';
  }

  function longStreakBar(count) {
    const pct = Math.min(100, Math.round((count / 10) * 100));
    return `<div class="ssc-long-item__bar"><span style="width:${pct}%"></span></div>`;
  }

  function longTierClass(count) {
    if (count >= 5) return 'is-fire';
    if (count >= 3) return 'is-hot';
    return 'is-warm';
  }

  function renderLongDragonPanel() {
    const groups = buildLongDragonGroups();
    const all = groups[longTab] || [];
    const list = all.filter(x => x.count >= MIN_LONG_STREAK);
    const tabLabel = { side: '两面', lhh: '龙虎', niu: '斗牛' }[longTab] || '';
    const rows = historyRows.filter(r => Array.isArray(r.nums) && r.nums.length === 5);

    if (!rows.length) {
      $('#longSummary').text(`${tabLabel} · 等待开奖`);
      $('#longBody').html(`
        <div class="ssc-long-empty">
          <div class="ssc-long-empty__icon">◎</div>
          <div class="ssc-long-empty__text">暂无开奖数据</div>
          <div class="ssc-long-empty__hint">接入官方开奖后会自动统计长龙</div>
        </div>`);
      return;
    }

    $('#longSummary').text(list.length
      ? `${tabLabel} · ${list.length} 条长龙 · 样本 ${rows.length} 期`
      : `${tabLabel} · 暂无 2 连以上 · 样本 ${rows.length} 期`);

    let hero = '';
    if (list.length) {
      const top = list[0];
      const topParts = longItemParts(top.name);
      hero = `
        <div class="ssc-long-hero ${longTierClass(top.count)}">
          <div class="ssc-long-hero__label">当前最长</div>
          <div class="ssc-long-hero__main">
            <span class="ssc-long-hero__tag ${longTagClass(topParts.tag)}">${topParts.tag}</span>
            <span class="ssc-long-hero__text">${top.group || topParts.full}</span>
            <span class="ssc-long-hero__num">${top.count}</span>
            <span class="ssc-long-hero__unit">期</span>
          </div>
        </div>`;
    }

    const listHtml = list.length
      ? `<div class="ssc-long-list">${list.map((item, idx) => {
          const parts = longItemParts(item.name);
          return `
          <div class="ssc-long-item ${longTierClass(item.count)}${item.play && parsePlay(item.play) ? ' is-clickable' : ''}"${item.play && parsePlay(item.play) ? ` data-predict-play="${item.play}" role="button" tabindex="0"` : ''}>
            <div class="ssc-long-item__rank">${idx + 1}</div>
            <div class="ssc-long-item__tag ${longTagClass(parts.tag)}">${parts.tag}</div>
            <div class="ssc-long-item__info">
              <div class="ssc-long-item__name">${item.group || parts.group}<span class="sep">·</span>${parts.full}</div>
              ${longStreakBar(item.count)}
            </div>
            <div class="ssc-long-item__count"><b>${item.count}</b><small>连</small></div>
          </div>`;
        }).join('')}</div>`
      : `<div class="ssc-long-empty ssc-long-empty--soft">
          <div class="ssc-long-empty__text">暂无 2 期以上长龙</div>
          <div class="ssc-long-empty__hint">下方仍可看近期走势与当前形态</div>
        </div>`;

    $('#longBody').html(hero + roadHtml(roadLabelsForTab(longTab)) + currentShapeHtml(all) + listHtml);
  }

  function openLongSheet(open) {
    const $room = $('.ssc-room');
    if (open) {
      openPlaySheet(false);
      openPredictSheet(false);
      longTab = 'side';
      $('#longTabs button').removeClass('is-active');
      $('#longTabs button[data-tab="side"]').addClass('is-active');
      $('#longMask').prop('hidden', false);
      $('#longSheet').prop('hidden', false).addClass('is-open');
      $room.addClass('has-long');
      renderLongDragonPanel();
    } else {
      $('#longSheet').removeClass('is-open');
      $('#longMask').prop('hidden', true);
      setTimeout(() => {
        if (!$('#longSheet').hasClass('is-open')) $('#longSheet').prop('hidden', true);
      }, 300);
      $room.removeClass('has-long');
    }
  }

  /* ================= 智能预测 ================= */
  let predictTab = 'side';
  const PREDICT_WINDOW = 20;
  const PREDICT_STREAK_BREAK = 3;

  function flipSideTag(tag) {
    if (tag === '大') return '小';
    if (tag === '小') return '大';
    if (tag === '单') return '双';
    if (tag === '双') return '单';
    if (tag === '龙') return '虎';
    if (tag === '虎') return '龙';
    return tag;
  }

  function pickByTrend(labels, streakBreak) {
    const recent = labels.slice(0, PREDICT_WINDOW);
    if (!recent.length) return { pick: '—', reason: '数据不足', confidence: 0 };
    const s = streakAtHead(recent);
    if (s.count >= streakBreak && s.tag) {
      return {
        pick: flipSideTag(s.tag),
        reason: `已连续 ${s.count} 期「${s.tag}」，看反转`,
        confidence: Math.min(88, 52 + s.count * 9)
      };
    }
    const count = {};
    recent.forEach(l => { count[l] = (count[l] || 0) + 1; });
    const pick = Object.keys(count).sort((a, b) => count[b] - count[a] || a.localeCompare(b, 'zh'))[0];
    const ratio = count[pick] / recent.length;
    return {
      pick,
      reason: `近 ${recent.length} 期「${pick}」出现 ${count[pick]} 次`,
      confidence: Math.round(48 + ratio * 42)
    };
  }

  function predictTagClass(tag) {
    return longTagClass(tag);
  }

  function predictCardHtml(name, data, play) {
    const pct = Math.max(0, Math.min(100, data.confidence || 0));
    const playAttr = play && parsePlay(play) ? ` data-predict-play="${play}"` : '';
    return `<div class="ssc-predict-card is-clickable"${playAttr} role="button" tabindex="0">
      <div class="ssc-predict-card__name">${name}</div>
      <div class="ssc-predict-card__pick">
        <span class="ssc-predict-card__tag ${predictTagClass(data.pick)}">${data.pick}</span>
        <span class="ssc-predict-card__conf">${pct}%</span>
      </div>
      <div class="ssc-predict-card__reason">${data.reason}</div>
      <div class="ssc-predict-card__bar"><span style="width:${pct}%"></span></div>
    </div>`;
  }

  function buildDigitPredict(rows, posIdx) {
    const window = Math.min(PREDICT_WINDOW, rows.length);
    const freq = Array(10).fill(0);
    const lastSeen = Array(10).fill(window);
    for (let i = 0; i < window; i++) {
      const d = rows[i].nums[posIdx];
      freq[d]++;
      if (lastSeen[d] === window) lastSeen[d] = i;
    }
    const hot = freq
      .map((c, d) => ({ d, c }))
      .sort((a, b) => b.c - a.c || a.d - b.d)
      .slice(0, 2)
      .filter(x => x.c > 0);
    const cold = lastSeen
      .map((gap, d) => ({ d, gap }))
      .sort((a, b) => b.gap - a.gap || a.d - b.d)
      .slice(0, 2);
    return { hot, cold };
  }

  function getPredictIssue() {
    return $('#curIssue').attr('title') || getCurrentIssue();
  }

  function defaultPredictAmount() {
    return Math.max(1, parseInt($('#playAmount').val(), 10) || 100);
  }

  function fillPredictPlay(play) {
    if (!play || !parsePlay(play)) return;
    const amount = defaultPredictAmount();
    $('#chatInput').val(`${play}/${amount}`);
    composerAllin = false;
    updateComposerAction();
    showKeypad(true);
    openPredictSheet(false);
    openLongSheet(false);
    App.toast(`已填入 ${play}/${amount}`);
  }

  function renderPredictPanel() {
    const rows = historyRows.filter(r => Array.isArray(r.nums) && r.nums.length === 5);
    const issue = getPredictIssue();
    $('#predictSummary').text(`下一期 · ${issue}`);
    if (!rows.length) {
      $('#predictBody').html(`
        <div class="ssc-long-empty">
          <div class="ssc-long-empty__icon">◎</div>
          <div class="ssc-long-empty__text">暂无开奖数据</div>
          <div class="ssc-long-empty__hint">等待开奖后生成预测</div>
        </div>`);
      return;
    }

    if (predictTab === 'side') {
      const sumMeta = rows.map(r => sideOfSum(sumOf(r.nums)));
      const sumBig = pickByTrend(sumMeta.map(m => (m.big ? '大' : '小')), PREDICT_STREAK_BREAK);
      const sumOdd = pickByTrend(sumMeta.map(m => (m.odd ? '单' : '双')), PREDICT_STREAK_BREAK);
      const cards = [
        predictCardHtml('总和 · 大小', sumBig, sumBig.pick),
        predictCardHtml('总和 · 单双', sumOdd, sumOdd.pick)
      ];
      POS_LABELS.forEach((pos, idx) => {
        const ballMeta = rows.map(r => sideOfBall(r.nums[idx]));
        const bigData = pickByTrend(ballMeta.map(m => (m.big ? '大' : '小')), PREDICT_STREAK_BREAK);
        const oddData = pickByTrend(ballMeta.map(m => (m.odd ? '单' : '双')), PREDICT_STREAK_BREAK);
        cards.push(predictCardHtml(`${pos}位 · 大小`, bigData, pos + bigData.pick));
        cards.push(predictCardHtml(`${pos}位 · 单双`, oddData, pos + oddData.pick));
      });
      const hero = `
        <div class="ssc-predict-hero">
          <div class="ssc-predict-hero__label">核心参考</div>
          <div class="ssc-predict-hero__main">
            <div class="ssc-predict-hero__tags">
              <span class="ssc-predict-card__tag ${predictTagClass(sumBig.pick)} is-clickable" data-predict-play="${sumBig.pick}" role="button" tabindex="0">${sumBig.pick}</span>
              <span class="ssc-predict-card__tag ${predictTagClass(sumOdd.pick)} is-clickable" data-predict-play="${sumOdd.pick}" role="button" tabindex="0">${sumOdd.pick}</span>
            </div>
            <div class="ssc-predict-hero__note">总和倾向 ${sumBig.pick}${sumOdd.pick}，${sumBig.reason}</div>
          </div>
        </div>`;
      $('#predictBody').html(hero + `<div class="ssc-predict-grid">${cards.join('')}</div>`);
      return;
    }

    if (predictTab === 'digit') {
      const cols = POS_LABELS.map((pos, idx) => {
        const stat = buildDigitPredict(rows, idx);
        const hotHtml = stat.hot.length
          ? stat.hot.map(x =>
            `<span class="ssc-ball-digit is-clickable" data-predict-play="${pos}${x.d}" role="button" tabindex="0">${x.d}</span>`
          ).join('')
          : '<span class="ssc-predict-card__reason">—</span>';
        const coldHtml = stat.cold.map(x =>
          `<span class="ssc-ball-digit is-cold is-clickable" data-predict-play="${pos}${x.d}" role="button" tabindex="0">${x.d}</span>`
        ).join('');
        return `<div class="ssc-predict-digit-col">
          <div class="ssc-predict-digit-col__pos">${pos}</div>
          <div class="ssc-predict-digit-col__label">热号</div>
          <div class="ssc-predict-digit-balls">${hotHtml}</div>
          <div class="ssc-predict-digit-col__label">遗漏</div>
          <div class="ssc-predict-digit-balls">${coldHtml}</div>
        </div>`;
      }).join('');
      $('#predictBody').html(`
        <div class="ssc-predict-hero">
          <div class="ssc-predict-hero__label">定位参考</div>
          <div class="ssc-predict-hero__note">近 ${Math.min(PREDICT_WINDOW, rows.length)} 期各位置热号与遗漏号，可作定位胆参考</div>
        </div>
        <div class="ssc-predict-digit-grid">${cols}</div>`);
      return;
    }

    const shapeRows = [
      { seg: '前三', key: '前三' },
      { seg: '中三', key: '中三' },
      { seg: '后三', key: '后三' }
    ].map(item => {
      const labels = rows.map(r => shapeOf(segOf(r.nums, item.key)));
      return { ...item, data: pickByTrend(labels, 2) };
    });
    const niuLabels = rows.map(r => niuLabel(niuValue(r.nums)));
    const niuData = pickByTrend(niuLabels, 2);
    const list = shapeRows.map(item => {
      const play = item.key + item.data.pick;
      return `
      <div class="ssc-predict-shape-item is-clickable" data-predict-play="${play}" role="button" tabindex="0">
        <div class="ssc-predict-shape-item__seg">${item.seg}</div>
        <div class="ssc-predict-shape-item__info">
          <div class="ssc-predict-shape-item__pick">${item.data.pick}</div>
          <div class="ssc-predict-shape-item__reason">${item.data.reason}</div>
        </div>
        <div class="ssc-predict-shape-item__conf">${item.data.confidence}%</div>
      </div>`;
    }).join('');
    const niuBlock = `
      <div class="ssc-predict-shape-item is-clickable" data-predict-play="${niuData.pick}" role="button" tabindex="0">
        <div class="ssc-predict-shape-item__seg">斗牛</div>
        <div class="ssc-predict-shape-item__info">
          <div class="ssc-predict-shape-item__pick">${niuData.pick}</div>
          <div class="ssc-predict-shape-item__reason">${niuData.reason}</div>
        </div>
        <div class="ssc-predict-shape-item__conf">${niuData.confidence}%</div>
      </div>`;
    $('#predictBody').html(`
      <div class="ssc-predict-hero">
        <div class="ssc-predict-hero__label">形态参考</div>
        <div class="ssc-predict-hero__note">前三 / 中三 / 后三形态与斗牛走势预测</div>
      </div>
      <div class="ssc-predict-shape-list">${list}${niuBlock}</div>`);
  }

  function openPredictSheet(open) {
    const $room = $('.ssc-room');
    if (open) {
      openPlaySheet(false);
      openLongSheet(false);
      predictTab = 'side';
      $('#predictTabs button').removeClass('is-active');
      $('#predictTabs button[data-tab="side"]').addClass('is-active');
      $('#predictMask').prop('hidden', false);
      $('#predictSheet').prop('hidden', false).addClass('is-open');
      $room.addClass('has-predict');
      renderPredictPanel();
    } else {
      $('#predictSheet').removeClass('is-open');
      $('#predictMask').prop('hidden', true);
      setTimeout(() => {
        if (!$('#predictSheet').hasClass('is-open')) $('#predictSheet').prop('hidden', true);
      }, 300);
      $room.removeClass('has-predict');
    }
  }

  /** 用服务端派彩校正顶部输赢/流水（以服务端为准） */
  function refineUserStatsFromServer(issue, list) {
    const id = String(issue || '');
    if (!id) return;
    const bets = (list || []).filter(function (b) { return b && b.status !== 'CANCELLED' && b.status !== 'PENDING'; });
    if (!bets.length) return;
    const storeKey = 'ssc_stats_applied_' + (user && user.uid ? user.uid : 'guest');
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
    stats.rebate = (stats.rebate || 0) + Math.round(serverTurnover * 0.005 * 100) / 100;
    saveStats(user.uid, stats);
    refreshStats();
  }

  /* ================= 倒计时：距封盘 → 开奖中 ================= */
  function fmtMmss(sec) {
    const s = Math.max(0, Math.floor(sec));
    return pad(Math.floor(s / 60), 2) + ':' + pad(s % 60, 2);
  }
  function renderCountdownDigits(sec) {
    const s = Math.max(0, Math.floor(sec));
    const text = pad(Math.floor(s / 60), 2) + pad(s % 60, 2);
    const $cells = $('#cdDigits .ssc-timer__cell');
    for (let i = 0; i < 4; i++) {
      $cells.eq(i).text(text[i]);
    }
  }
  function updateCountdownUI(phaseOrRemain, maybeSec) {
    /* 只保留：距封盘；归零 / 封盘后 → 开奖中 */
    let sec = 0;
    if (phaseOrRemain === 'bet' || phaseOrRemain === 'prep') {
      if (phaseOrRemain === 'prep') {
        updateCountdownDrawing();
        return;
      }
      sec = Math.max(0, Number(maybeSec) || 0);
    } else {
      const r = Math.max(0, Number(phaseOrRemain) || 0);
      if (r <= PREP_SEC) {
        updateCountdownDrawing();
        return;
      }
      sec = Math.max(0, r - PREP_SEC);
    }
    const displaySec = Math.max(0, Math.ceil(sec));
    if (displaySec <= 0) {
      updateCountdownDrawing();
      return;
    }
    const $box = $('#countdownBox').removeClass('is-preparing is-betting is-freeze is-urgent is-drawing').addClass('is-betting');
    if (displaySec <= 5) $box.addClass('is-urgent');
    const $label = $('#cdLabel');
    $label.text('距封盘');
    $box.attr('aria-label', '距封盘 ' + fmtMmss(displaySec));
    $('#cdDigits').removeAttr('hidden').css('display', '').show().attr('aria-label', $box.attr('aria-label'));
    $('#cdPrep').prop('hidden', true);
    renderCountdownDigits(displaySec);
    if (window.SscAudio && SscAudio.onCountdownSec) SscAudio.onCountdownSec(displaySec);
  }

  /* ================= 统计 ================= */
  function getStats(uid) {
    const key = 'ssc_stats_' + uid;
    let s = null;
    try { s = JSON.parse(localStorage.getItem(key)); } catch (e) { /* */ }
    return s || { turnover: 0, winloss: 0, rebate: 0 };
  }
  function saveStats(uid, s) {
    localStorage.setItem('ssc_stats_' + uid, JSON.stringify(s));
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
    if (typeof syncPlayFootTotals === 'function') syncPlayFootTotals();
  }
  function hasLastDraw() {
    return Array.isArray(lastDraw) && lastDraw.length > 0;
  }

  const CHAT_KEEP = 50;
  const chatLog = [];

  function chatStorageKey() {
    const uid = (user && user.uid) ? user.uid : 'guest';
    return 'ssc_chat_v3_' + uid + (roomNo ? '_' + roomNo : '');
  }
  function saveChatLog() {
    try {
      localStorage.setItem(chatStorageKey(), JSON.stringify(chatLog.slice(-CHAT_KEEP)));
    } catch (e) { /* quota / private mode */ }
  }
  function trimChatDom() {
    const $msgs = $('#chatFeed > .ssc-msg');
    const extra = $msgs.length - CHAT_KEEP;
    if (extra > 0) $msgs.slice(0, extra).remove();
  }
  function escapeHtml(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, function (ch) {
      return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch];
    });
  }

  function scrollChat() {
    /* 揭晓期间只暂停自动滚（停留），不钉死；用户手滑后 room-chat 会解除 */
    if (roomChat && roomChat.isAutoScrollPaused && roomChat.isAutoScrollPaused()) return;
    const el = document.getElementById('chatFeed');
    if (el) el.scrollTop = el.scrollHeight;
  }
  function appendMsg(opts) {
    const time = opts.time || fmtTime(new Date());
    const isSelf = opts.self;
    const isRobot = opts.robot;
    const avatar = opts.avatarHtml
      ? opts.avatarHtml
      : `<div class="ssc-msg__avatar"><img src="${fixAvatar(opts.avatar)}" alt=""></div>`;
    const meta = `<div class="ssc-msg__meta">
            <span class="ssc-msg__name">${escapeHtml(opts.name)}</span>
            <span class="ssc-msg__time">${escapeHtml(time)}</span>
          </div>`;
    const bubbleCls = isRobot ? ' ssc-msg__bubble--bot' : '';
    const bubble = `<div class="ssc-msg__bubble${bubbleCls}">${opts.html}</div>`;
    const html = isSelf
      ? `<div class="ssc-msg is-self">
        <div class="ssc-msg__top">${meta}${avatar}</div>
        ${bubble}
      </div>`
      : `<div class="ssc-msg${isRobot ? ' is-robot' : ''}">
        ${avatar}
        <div class="ssc-msg__body">
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
        avatarHtml: opts.avatarHtml || '',
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
  /* ========== 房间公共聊天（服务端时间线 · 共享内核） ========== */
  function applyRoomWinVerifyMineLine(issue) {
    issue = String(issue || '').trim();
    if (!App.fetchMyLotteryBets) return;
    App.fetchMyLotteryBets(SERVER_GAME, issue).then(function (res) {
      const list = (res && res.list) || [];
      if (list.length) refineUserStatsFromServer(issue, list);
      const mine = buildMineLineHtmlFromServer(issue, list);
      if (!mine) return;
      const $card = $('#chatFeed .ssc-msg').has('.ssc-bot-card--win').filter(function () {
        return String($(this).find('.ssc-bot-card__issue').text() || '').trim() === issue;
      }).last();
      if (!$card.length) return;
      let h = $card.find('.ssc-msg__bubble').html() || '';
      h = applyMineLineToWinHtml(h, mine);
      $card.find('.ssc-msg__bubble').html(h);
    }).catch(function () { /* ignore */ });
  }

  function buildBetVerifyFromPayload(p) {
    return LotteryRoomChat.buildBetVerifyHtml("ssc", p, {
      escapeHtml: typeof escapeHtml === 'function' ? escapeHtml : undefined,
      userName: user.name,
    });
  }

  function buildWinVerifyFromPayload(p) {
    return LotteryRoomChat.buildWinVerifyHtml("ssc", p, {
      escapeHtml: typeof escapeHtml === 'function' ? escapeHtml : undefined,
      fmtProfit: typeof fmtProfit === 'function' ? fmtProfit : undefined,
    });
  }

  const roomChat = LotteryRoomChat.create({
    gameCode: SERVER_GAME,
    appendMsg: appendMsg,
    clearFeed: function () {
      $('#chatFeed').empty();
      chatLog.length = 0;
    },
    getUserName: function () { return user.name; },
    robotFallbackName: (typeof ROBOT !== 'undefined' && ROBOT.name) ? ROBOT.name : '机器人',
    fmtTime: typeof fmtTime === 'function' ? fmtTime : undefined,
    buildBetHtml: function (p) {
      return (typeof escapeHtml === 'function') ? escapeHtml(String(p.text || '')) : String(p.text || '');
    },
    buildOpenHtml: function (issue) {
      return (typeof openNoticeHtml === 'function') ? openNoticeHtml(issue) : ('开盘 ' + issue);
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
      revealedIssues.add(issue);
      if (nums.length === 5) lastDraw = nums.slice();
    },
    onWinVerifyUnlocked: function () {
      /* 解冻只在 phase=betting（onPhaseChange / onCeremonyComplete） */
    },
    onWinVerifyShown: function (issue) {
      applyRoomWinVerifyMineLine(issue);
    },
    onFlushWinVerify: function (issue, pending) {
      const html = buildWinVerifyFromPayload(pending);
      LotteryRoomChat.replaceCalculatingWinCard({
        prefix: "ssc",
        issue: issue,
        html: html,
        appendMsg: appendMsg,
        robotName: (typeof ROBOT !== 'undefined' && ROBOT.name) ? ROBOT.name : '机器人',
      });
      applyRoomWinVerifyMineLine(issue);
    },
    onPhaseChange: function (phase) {
      if (phase === 'betting') {
        roomBetFrozen = false;
        sealedIssueNo = '';
        if (window.SscAudio && SscAudio.onBetting) SscAudio.onBetting();
        if (typeof requestLotteryResync === 'function') requestLotteryResync();
        else if (typeof syncServerSnapshot === 'function') syncServerSnapshot();
        if (typeof tick === 'function') try { tick(); } catch (e) { /* ignore */ }
      } else if (phase === 'drawing' || phase === 'revealing' || phase === 'settled') {
        roomBetFrozen = true;
        if (window.SscAudio && SscAudio.onDrawing) SscAudio.onDrawing();
        if (typeof tick === 'function') try { tick(); } catch (e) { /* ignore */ }
      }
    },
    onCeremonyComplete: function () {
      /* 兼容：finishToBetting 也会调；主逻辑在 onPhaseChange('betting') */
      roomBetFrozen = false;
      sealedIssueNo = '';
      if (typeof requestLotteryResync === 'function') requestLotteryResync();
      else if (typeof syncServerSnapshot === 'function') syncServerSnapshot();
      if (typeof tick === 'function') try { tick(); } catch (e) { /* ignore */ }
    },

    afterResultAppended: function (ctx) {
      const nums = Array.isArray(ctx.payload.nums) ? ctx.payload.nums.map(Number) : [];
      const issue = ctx.issue;
      const card = $('#chatDock .ssc-video-card, #chatFeed .ssc-video-card, #chatDock .ssc-bot-card--result, #chatFeed .ssc-bot-card--result').last()[0];
      const readyMs = resultRevealDurationMs() + 1000 + 400;
      if (card && nums.length === 5 && card.classList.contains('ssc-video-card')) {
        if (ctx.animate && ctx.live) {
          ctx.setRevealPending(issue);
          playSscVideoCard(card, nums, {
            issue: issue,
            onDone: function () {
              setTimeout(function () {
                if (typeof persistBotCardHtml === 'function') persistBotCardHtml(card);
              }, 400);
            },
          });
          ctx.scheduleRevealReady(issue, readyMs);
        } else {
          settleSscVideoCard(card, nums);
          ctx.setRevealReadyFlag(issue, true);
        }
      } else if (card && nums.length === 5 && window.SscResultCard) {
        /* 兼容旧版球卡历史消息 */
        if (ctx.animate && ctx.live && SscResultCard.bindReveal) {
          ctx.setRevealPending(issue);
          if (window.SscAudio && SscAudio.startRoll) SscAudio.startRoll();
          SscResultCard.bindReveal(card, nums, function () {
            if (window.SscAudio && SscAudio.onRevealDone) SscAudio.onRevealDone();
            setTimeout(function () {
              if (typeof persistBotCardHtml === 'function') persistBotCardHtml(card);
            }, 1000);
          }, { durationMs: resultRevealDurationMs() });
          ctx.scheduleRevealReady(issue, readyMs);
        } else if (SscResultCard.settle) {
          SscResultCard.settle(card, nums);
          ctx.setRevealReadyFlag(issue, true);
        } else {
          ctx.setRevealReadyFlag(issue, true);
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

  /** 滚号落定后把最终 HTML 写回 chatLog，避免下次进房仍是占位动画 */
  function persistBotCardHtml(card) {
    if (!card || !chatLog.length) return;
    const issue = String(
      card.getAttribute('data-issue') ||
      ($(card).find('.ssc-bot-card__issue').first().text() || '')
    ).trim();
    /* 历史重载时用 settle=1，避免再次自动滚号 */
    if (card.classList.contains('ssc-video-card')) {
      const frame = card.querySelector('.ssc-video-card__frame');
      if (frame) {
        let src = String(frame.getAttribute('src') || '');
        if (src && src.indexOf('settle=1') < 0) {
          src += '&settle=1';
          frame.setAttribute('src', src);
        }
      }
    }
    const html = card.outerHTML;
    for (let i = chatLog.length - 1; i >= 0; i--) {
      const m = chatLog[i];
      if (!m || !m.robot) continue;
      if (!/ssc-bot-card--result|ssc-video-card/.test(String(m.html || ''))) continue;
      if (issue && String(m.html).indexOf(issue) < 0) continue;
      m.html = html;
      saveChatLog();
      break;
    }
  }

  /** 进房/同步后：正版动画卡 settle；兼容旧球卡 */
  function settleRestoredResultCards() {
    const holdIssue = (roomChat && typeof roomChat.getCeremonyHoldIssue === 'function')
      ? String(roomChat.getCeremonyHoldIssue() || '').trim()
      : '';
    const phaseIssue = (roomChat && typeof roomChat.getPhaseIssue === 'function')
      ? String(roomChat.getPhaseIssue() || '').trim()
      : '';
    $('#chatFeed .ssc-video-card').each(function () {
      const card = this;
      if (card.classList.contains('is-playing') || card.getAttribute('data-playing') === '1') return;
      const issue = String(card.getAttribute('data-issue') || '').trim();
      /* 当期开奖仪式中的卡：交给 playSscVideoCard，禁止被 snapshot 强制 settle */
      if (issue && ((holdIssue && issue === holdIssue) || (phaseIssue && issue === phaseIssue))) {
        if (isCeremonyHolding && isCeremonyHolding()) return;
      }
      const frame = card.querySelector('.ssc-video-card__frame');
      const src = frame ? String(frame.getAttribute('src') || '') : '';
      /* 已是 settle 态则只需 API 落定；未 settle 且非仪式中才改 src */
      let nums = null;
      const raw = card.getAttribute('data-nums') || '';
      if (raw) {
        const arr = raw.split(',').map(Number);
        if (arr.length === 5 && arr.every(function (n) { return !Number.isNaN(n) && n >= 0 && n <= 9; })) {
          nums = arr;
        }
      }
      if (!nums) {
        const row = historyRows.find(function (r) { return String(r.issue) === issue; });
        if (row && row.nums && row.nums.length === 5) nums = row.nums;
      }
      if (!nums) return;
      settleSscVideoCard(card, nums);
    });
    if (!window.SscResultCard || !SscResultCard.settle) return;
    $('#chatFeed .ssc-bot-card--result').not('.ssc-video-card').each(function () {
      const card = this;
      if (card.querySelector('.ssc-bot-result__ball-roll.is-rolling')) return;
      let nums = null;
      const raw = card.getAttribute('data-nums') || '';
      if (raw) {
        const arr = raw.split(',').map(Number);
        if (arr.length === 5 && arr.every(function (n) { return !Number.isNaN(n) && n >= 0 && n <= 9; })) {
          nums = arr;
        }
      }
      if (!nums) {
        const issue = String($(card).find('.ssc-bot-card__issue').first().text() || '').trim();
        const row = historyRows.find(function (r) { return String(r.issue) === issue; });
        if (row && row.nums && row.nums.length === 5) nums = row.nums;
      }
      if (!nums) return;
      const nodes = card.querySelectorAll('.ssc-bot-result__ball-num');
      let allMatch = nodes.length === 5;
      nodes.forEach(function (el, i) {
        if (parseInt(el.textContent, 10) !== Number(nums[i])) allMatch = false;
      });
      if (allMatch && card.classList.contains('is-settled')) return;
      SscResultCard.settle(card, nums);
      persistBotCardHtml(card);
    });
  }

  /* ================= 键盘 ================= */
  function initKeypad() {
    const rows = [
      { left: '万', mid: ['1', '2', '3'], right: '删除', del: true },
      { left: '千', mid: ['4', '5', '6'], right: '大' },
      { left: '百', mid: ['7', '8', '9'], right: '小' },
      { left: '十', mid: ['无牛', '0', '/'], right: '单' },
      { left: '个', mid: ['牛', '龙', '虎'], right: '双' }
    ];
    let html = '';
    rows.forEach(row => {
      const leftCls = ['万', '千', '百', '十', '个'].includes(row.left) ? 'ssc-key--pos' : 'ssc-key--side';
      html += `<button type="button" class="ssc-key ${leftCls}" data-key="${row.left}">${row.left}</button>`;
      row.mid.forEach(k => {
        html += `<button type="button" class="ssc-key" data-key="${k}">${k}</button>`;
      });
      const cls = row.del ? ' ssc-key--del' : ' ssc-key--side';
      html += `<button type="button" class="ssc-key${cls}" data-key="${row.right}">${row.right}</button>`;
    });
    $('#keyGrid').html(html);
  }

  let keypadArmTimer = 0;
  let keypadGuardUntil = 0;
  let delHoldTimer = 0;
  let delHoldInterval = 0;

  function stopDeleteHold() {
    if (delHoldTimer) {
      clearTimeout(delHoldTimer);
      delHoldTimer = 0;
    }
    if (delHoldInterval) {
      clearInterval(delHoldInterval);
      delHoldInterval = 0;
    }
  }

  function showKeypad(show) {
    const $room = $('.ssc-room');
    const $pad = $('#keypad');
    if (show) {
      $pad.prop('hidden', false);
      $room.addClass('has-keypad');
      /* 弹出瞬间：禁点防误触 + 短时不响应「点外面关闭」（避免版面顶起后同一次点击被当成点外面） */
      keypadGuardUntil = Date.now() + 450;
      $pad.addClass('is-arming');
      if (keypadArmTimer) clearTimeout(keypadArmTimer);
      keypadArmTimer = setTimeout(() => {
        $pad.removeClass('is-arming');
        keypadArmTimer = 0;
      }, 320);
    } else {
      stopDeleteHold();
      if (keypadArmTimer) {
        clearTimeout(keypadArmTimer);
        keypadArmTimer = 0;
      }
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
      updateComposerAction();
      return;
    }
    if (SIDE_CHARS.includes(text)) {
      const trimmed = v.replace(/\s+$/, '');
      const last = trimmed.slice(-1);
      if (trimmed && (POS_CHARS.includes(last) || last === '牛')) {
        $in.val(trimmed + text);
      } else {
        $in.val(trimmed + '总' + text);
      }
      updateComposerAction();
      return;
    }
    $in.val(appendKeyWithSlash(v, text));
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

  /** 取消：输入「取消」再发送 → 撤销本期本人全部注单并退款 */
  function trySendCancel(text) {
    if (String(text || '').trim() !== '取消') return false;
    if (!isBettingOpen()) {
      toastBetBlocked('cancel');
      return true;
    }
    if (!App.cancelLotteryBets) {
      App.toast('请从大厅进入游戏');
      return true;
    }
    App.cancelLotteryBets(SERVER_GAME).then(function (res) {
      refreshStats();
      const issue = getCurrentIssue();
      if (issueBetBook[issue] && issueBetBook[issue][user.name]) {
        delete issueBetBook[issue][user.name];
      }
      clearUserPendingBetLog(issue);
      const refunded = res && res.refunded != null ? res.refunded : 0;
      const count = res && res.count != null ? res.count : 0;
      appendMsg({
        name: user.name,
        avatar: fixAvatar(user.avatar),
        self: true,
        html: '本期注单已取消'
      });
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

  /** 上分：上分200 / 上分/200 → 建单并同步客服 */
  function trySendTopup(text) {
    const m = String(text || '').match(/^上分\s*\/?\s*(\d+)$/);
    if (!m) {
      if (/^上分/.test(String(text || '').trim())) {
        App.toast('格式：上分200 或 上分/200');
        return true;
      }
      return false;
    }
    const amount = parseInt(m[1], 10);
    if (!(amount > 0)) {
      App.toast('请输入有效上分金额');
      return true;
    }
    if (amount < 200) {
      App.toast('上分最低 200 积分');
      return true;
    }
    if (!App.requestTopup) {
      App.toast('请从大厅进入游戏');
      return true;
    }
    App.requestTopup(amount, '人工').then(function () {
      appendMsg({
        name: user.name,
        avatar: fixAvatar(user.avatar),
        self: true,
        html: '上分' + amount
      });
      $('#chatInput').val('');
      updateComposerAction();
      showKeypad(false);
      App.toast('上分申请已发给客服');
    }).catch(function (e) {
      App.toast((e && e.message) || '上分申请失败');
    });
    return true;
  }

  /** 下分：下分500 / 下分/500 → 立即扣余额并建单，同步给客服审核 */
  function trySendWithdraw(text) {
    const m = String(text || '').match(/^下分\s*\/?\s*(\d+)$/);
    if (!m) {
      if (/^下分/.test(String(text || '').trim())) {
        App.toast('格式：下分500 或 下分/500');
        return true;
      }
      return false;
    }
    const amount = parseInt(m[1], 10);
    if (!(amount > 0)) {
      App.toast('请输入有效下分金额');
      return true;
    }
    if (amount < 500) {
      App.toast('下分最低 500 积分');
      return true;
    }
    const bal = App.getBalance(user.uid);
    if (amount > bal) {
      App.toast('下分金额不能大于当前积分');
      return true;
    }
    if (!App.requestWithdraw) {
      App.toast('请从大厅进入游戏');
      return true;
    }
    App.requestWithdraw(amount).then(function () {
      refreshStats();
      appendMsg({
        name: user.name,
        avatar: fixAvatar(user.avatar),
        self: true,
        html: '下分' + amount
      });
      $('#chatInput').val('');
      updateComposerAction();
      showKeypad(false);
      App.toast('已扣除 ' + amount + '，申请已发给客服');
    }).catch(function (e) {
      App.toast((e && e.message) || '下分申请失败');
    });
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
    let lines;
    if (composerAllin) {
      composerAllin = false;
      const parts = text.split(/\s+/).filter(Boolean);
      const allPlays = [];
      for (let i = 0; i < parts.length; i++) {
        const stripped = stripComposerAmount(parts[i]);
        let via = parseBetLines(stripped + '/梭哈');
        let plays = via && via.length ? via.map(function (l) { return l.play; }) : expandPlayPart(stripped);
        if (!plays || !plays.length) { App.toast('格式错误'); return; }
        allPlays.push.apply(allPlays, plays);
      }
      lines = resolveBetAmounts(allPlays, '梭哈');
      if (!lines) {
        App.toast('余额不足，无法梭哈');
        return;
      }
    } else {
      lines = parseBetInput(text);
      if (!lines) {
        App.toast('格式错误');
        return;
      }
    }
    const bal = App.getBalance(user.uid);
    const total = lines.reduce((s, l) => s + l.amount, 0);
    if (total > bal) { App.toast('余额不足'); return; }
    const mapped = mapLinesToServerBets(lines);
    if (mapped.unsupported.length || !mapped.bets.length) {
      App.toast('格式错误');
      return;
    }
    if (!App.placeLotteryBets) {
      App.toast('请从大厅进入游戏');
      return;
    }
    App.placeLotteryBets(SERVER_GAME, mapped.bets, {
      /* 核对卡/气泡用原口令折叠展示，与机器人一致；账本仍按拆注 bets */
      chatText: text.replace(/\s+/g, ' '),
    }).then(function () {
      refreshStats();
      recordBetLines(user.name, lines);
      lastBetText = formatResolvedBets(lines);
      $('#chatInput').val('');
      updateComposerAction();
      if (lines.length > 1) App.toast(`投注成功 · ${lines.length}注`);
      /* 聊天气泡由服务端时间线推送，立即拉增量 */
      syncRoomChat(false);
    }).catch(function (e) {
      App.toast((e && e.message) || '下注失败');
    });
  }

  function toggleDrawPanel() {
    drawPanelOpen = !drawPanelOpen;
    $('#drawBar').toggleClass('is-open', drawPanelOpen);
    layoutRail();
    setTimeout(layoutRail, 360);
    $('#drawToggle').attr('aria-expanded', drawPanelOpen);
  }

  function openPlusMenu(open) {
    const $room = $('.ssc-room');
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
    const room = document.querySelector('.ssc-room');
    const rail = room && room.querySelector('.ssc-rail');
    const anchor = document.getElementById('drawToggle') || document.getElementById('drawBar');
    const composer = document.querySelector('.ssc-composer');
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
    document.documentElement.style.setProperty('--ssc-play-top', top + 'px');
  }
  function openPlaySheet(open) {
    const $room = $('.ssc-room');
    if (open) {
      if (typeof drawPanelOpen !== 'undefined' && drawPanelOpen) {
        drawPanelOpen = false;
        $('#drawBar').removeClass('is-open');
        $('#drawToggle').attr('aria-expanded', false);
      } else if ($('#drawBar').hasClass('is-open')) {
        $('#drawBar').removeClass('is-open');
        $('#drawToggle').attr('aria-expanded', false);
      }
      layoutPlayOverlay();

      $('#playMask').prop('hidden', false);
      $('#playSheet').prop('hidden', false).addClass('is-open');
      $room.addClass('has-play');
      renderPlayPanel();
      updatePlaySelected();
    } else {
      $('#playSheet').removeClass('is-open');
      $('#playMask').prop('hidden', true);
      setTimeout(() => { if (!$('#playSheet').hasClass('is-open')) $('#playSheet').prop('hidden', true); }, 300);
      $room.removeClass('has-play');
    }
  }

  /* ================= 玩法面板：左分类 · 右选项 · 底投注 ================= */
  /** 共用筹码图：client-app/public/images/chips（与斗牛同源；1W/5W 为万面额） */
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
  const PLAY_CATEGORIES = [
    {
      id: 'twoSide',
      title: '两面',
      hint: () => `总和≥23为大 · 单球≥5为大 · 赔率 ${fmtOdds(ODDS.sumSide)}`,
      subs: null,
      sideGroups: () => {
        const ballLabs = ['第一球', '第二球', '第三球', '第四球', '第五球'];
        return [
          { label: '总和', prefix: '总', odds: ODDS.sumSide },
          ...Object.keys(POS).map((p, i) => ({
            label: ballLabs[i] || p + '位',
            prefix: p,
            odds: ODDS.ballSide
          }))
        ];
      }
    },
    {
      id: 'position',
      title: '定位胆',
      hint: () => `选位置与号码 · 赔率 ${fmtOdds(ODDS.position)}`,
      subs: null,
      mode: 'positionAll',
      odds: () => ODDS.position
    },
    {
      id: 'anyDigit',
      title: '不定位',
      hint: () => `三位含所选号码即中 · 赔率 ${fmtOdds(ODDS.anyDigit)}`,
      subs: Object.keys(SEG),
      mode: 'segDigit',
      odds: () => ODDS.anyDigit
    },
    {
      id: 'group3',
      title: '三星组三',
      hint: () => `选2个及以上为复式 · 注数C(n,2) · 赔率 ${fmtOdds(ODDS.group3)}`,
      subs: Object.keys(SEG),
      mode: 'group3',
      minPick: 2,
      odds: () => ODDS.group3
    },
    {
      id: 'group6',
      title: '三星组六',
      hint: () => `选3个及以上为复式 · 注数C(n,3) · 赔率 ${fmtOdds(ODDS.group6)}`,
      subs: Object.keys(SEG),
      mode: 'group6',
      minPick: 3,
      odds: () => ODDS.group6
    },
    {
      id: 'lhh',
      title: '龙虎和',
      hint: () => `任意两球比大小 · 龙/虎 ${fmtOdds(ODDS.dragon)} · 和 ${fmtOdds(ODDS.tie)} · 口令：1/2龙/100`,
      subs: null
    },
    {
      id: 'niu',
      title: '斗牛',
      hint: '任意3位和为10的倍数有牛',
      subs: null,
      items() {
        const list = [{ play: '无牛', label: '无牛', odds: ODDS.noNiu }];
        for (let i = 1; i <= 9; i++) list.push({ play: '牛' + i, label: '牛' + i, odds: ODDS.niu });
        list.push({ play: '牛牛', label: '牛牛', odds: ODDS.niu });
        ['牛大', '牛小', '牛单', '牛双'].forEach(x => list.push({ play: x, label: x, odds: ODDS.niuSide }));
        return list;
      }
    },
    {
      id: 'shape',
      title: '前中后',
      hint: () => `豹子${fmtOdds(SHAPE_ODDS['豹子'])} 顺子${fmtOdds(SHAPE_ODDS['顺子'])} 对子${fmtOdds(SHAPE_ODDS['对子'])} 半顺${fmtOdds(SHAPE_ODDS['半顺'])} 杂六${fmtOdds(SHAPE_ODDS['杂六'])}`,
      subs: null,
      mode: 'shapeAll',
      shapes: ['豹子', '顺子', '对子', '半顺', '杂六']
    }
  ];

  let playCatIdx = 0;
  let playSubIdx = 0;
  /** @type {string[]} 已选玩法（可多选） */
  let playSelectedList = [];
  let playPickedDigits = [];
  /** 玩法脚金额栏是否处于梭哈 */
  let playAllin = false;

  function clearPlayAmountChipActive() {
    $('#playAmountChips .ssc-play-foot__chip').removeClass('is-active');
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

  function currentPlayCat() {
    return PLAY_CATEGORIES[playCatIdx];
  }
  function currentPlaySub() {
    const cat = currentPlayCat();
    return cat.subs ? cat.subs[playSubIdx] : '';
  }

  function samePlay(a, b) {
    if (a === b) return true;
    const pa = parsePlay(a);
    const pb = parsePlay(b);
    if (!pa || !pb || pa.type !== pb.type) return false;
    if (pa.type === 'lhh') {
      return pa.a === pb.a && pa.b === pb.b && pa.pick === pb.pick;
    }
    return false;
  }

  function togglePlaySelect(play) {
    if (!play || !parsePlay(play)) return;
    const idx = playSelectedList.findIndex((p) => samePlay(p, play));
    if (idx >= 0) playSelectedList.splice(idx, 1);
    else playSelectedList.push(play);
  }

  function isPlaySelected(play) {
    return playSelectedList.some((p) => samePlay(p, play));
  }


  const BALL_POS_LABELS = ['第一球', '第二球', '第三球', '第四球', '第五球'];
  const POS_KEYS = Object.keys(POS);

  function playBallBtn(opts) {
    const prefix = opts.clsPrefix || 'ssc';
    const active = opts.active ? ' is-active' : '';
    const picked = opts.picked ? ' is-picked' : '';
    const digitAttr = opts.digitAttr ? ' data-digit="1"' : '';
    const oddsHtml = opts.odds != null && opts.odds !== ''
      ? `<small>${opts.odds}</small>`
      : '';
    return `<button type="button" class="${prefix}-play-ball${active}${picked}" data-play="${opts.play}"${digitAttr}><span class="${prefix}-play-ball__num">${opts.label}</span>${oddsHtml}</button>`;
  }

  function playTextCell(opts) {
    const prefix = opts.clsPrefix || 'ssc';
    const active = opts.active ? ' is-active' : '';
    const wide = opts.wide ? ` ${prefix}-play-item--wide` : '';
    const odds = opts.odds != null ? `<small>${opts.odds}</small>` : '';
    return `<button type="button" class="${prefix}-play-item ${prefix}-play-item--cell${wide}${active}" data-play="${opts.play}"><span>${opts.label}</span>${odds}</button>`;
  }

  function renderPosBallSections(prefix, odds) {
    const show = fmtOdds(odds);
    return POS_KEYS.map((p, i) => {
      const cells = Array.from({ length: 10 }, (_, d) => {
        const play = p + d;
        return playBallBtn({
          clsPrefix: prefix,
          play: play,
          label: String(d),
          odds: show,
          active: isPlaySelected(play)
        });
      }).join('');
      return `<div class="${prefix}-play-section"><div class="${prefix}-play-section__title">${BALL_POS_LABELS[i] || p}</div><div class="${prefix}-play-section__grid is-balls">${cells}</div></div>`;
    }).join('');
  }

  function renderSegDigitPanel(prefix, cat, liveOdds) {
    const sub = currentPlaySub();
    const show = fmtOdds(liveOdds);
    const cells = Array.from({ length: 10 }, (_, d) => {
      const playStr = sub + d;
      return playBallBtn({
        clsPrefix: prefix,
        play: String(d),
        label: String(d),
        odds: show,
        active: isPlaySelected(playStr),
        digitAttr: true
      });
    }).join('');
    return `<div class="${prefix}-play-section"><div class="${prefix}-play-section__title">${sub}</div><div class="${prefix}-play-section__grid is-balls">${cells}</div></div>`;
  }

  function renderGroupDigitPanel(prefix, cat, liveOdds) {
    const show = fmtOdds(liveOdds);
    const cells = Array.from({ length: 10 }, (_, d) => {
      const picking = playPickedDigits.indexOf(d) >= 0;
      return playBallBtn({
        clsPrefix: prefix,
        play: String(d),
        label: String(d),
        odds: '',
        picked: picking,
        digitAttr: true
      });
    }).join('');
    return `<div class="${prefix}-play-odds-line">赔率: <em>${show}</em></div><div class="${prefix}-play-section__grid is-balls is-group">${cells}</div>`;
  }

  function renderNiuPanel(prefix) {
    const mains = [{ play: '无牛', label: '无牛', odds: ODDS.noNiu }];
    for (let i = 1; i <= 9; i++) mains.push({ play: '牛' + i, label: '牛' + i, odds: ODDS.niu });
    const mainHtml = mains.map((it) => playTextCell({
      clsPrefix: prefix,
      play: it.play,
      label: it.label,
      odds: fmtOdds(it.odds),
      active: isPlaySelected(it.play)
    })).join('');
    const niuNiu = playTextCell({
      clsPrefix: prefix,
      play: '牛牛',
      label: '牛牛',
      odds: fmtOdds(ODDS.niu),
      active: isPlaySelected('牛牛'),
      wide: true
    });
    const sides = ['牛大', '牛小', '牛单', '牛双'].map((x) => playTextCell({
      clsPrefix: prefix,
      play: x,
      label: x,
      odds: fmtOdds(ODDS.niuSide),
      active: isPlaySelected(x)
    })).join('');
    return `<div class="${prefix}-play-section"><div class="${prefix}-play-section__title">斗牛</div><div class="${prefix}-play-section__grid is-text">${mainHtml}</div>${niuNiu}</div><div class="${prefix}-play-section"><div class="${prefix}-play-section__title">斗牛两面</div><div class="${prefix}-play-section__grid is-text">${sides}</div></div>`;
  }

  function renderLhhPanel(prefix) {
    const picks = [
      { pick: '龙', odds: ODDS.dragon },
      { pick: '和', odds: ODDS.tie },
      { pick: '虎', odds: ODDS.tiger }
    ];
    return LHH_PAIRS.map(([a, b]) => {
      const title = `${a + 1}/${b + 1}`;
      const cells = picks.map(({ pick, odds }) => {
        const play = lhhPlayOf(a, b, pick);
        return playTextCell({
          clsPrefix: prefix,
          play,
          label: pick,
          odds: fmtOdds(odds),
          active: isPlaySelected(play)
        });
      }).join('');
      return `<div class="${prefix}-play-section"><div class="${prefix}-play-section__title">${title}</div><div class="${prefix}-play-section__grid is-text is-lhh">${cells}</div></div>`;
    }).join('');
  }

  function renderShapeAllPanel(prefix) {
    const shapesMain = ['豹子', '顺子', '对子', '半顺'];
    return Object.keys(SEG).map((seg) => {
      const cells = shapesMain.map((sh) => {
        const play = seg + sh;
        return playTextCell({
          clsPrefix: prefix,
          play: play,
          label: sh,
          odds: fmtOdds(SHAPE_ODDS[sh]),
          active: isPlaySelected(play)
        });
      }).join('');
      const zaPlay = seg + '杂六';
      const za = playTextCell({
        clsPrefix: prefix,
        play: zaPlay,
        label: '杂六',
        odds: fmtOdds(SHAPE_ODDS['杂六']),
        active: isPlaySelected(zaPlay),
        wide: true
      });
      return `<div class="${prefix}-play-section"><div class="${prefix}-play-section__title">${seg}</div><div class="${prefix}-play-section__grid is-text">${cells}</div>${za}</div>`;
    }).join('');
  }


  function digitItems(odds) {
    const show = fmtOdds(odds);
    return Array.from({ length: 10 }, (_, d) => ({
      play: String(d),
      label: String(d),
      odds: show,
      isDigit: true
    }));
  }

  function buildPlayFromDigits(cat) {
    const sub = currentPlaySub();
    const digits = playPickedDigits.slice().sort((a, b) => a - b);
    if (cat.mode === 'positionDigit' && digits.length === 1) {
      return sub + digits[0];
    }
    if (cat.mode === 'segDigit' && digits.length === 1) {
      return sub + digits[0];
    }
    return '';
  }

  /** 组三/组六：按已点号码同步复式注单到已选列表 */
  function syncGroupDuplexSelection(cat) {
    if (cat.mode !== 'group3' && cat.mode !== 'group6') return;
    const seg = currentPlaySub();
    const wantType = cat.mode === 'group3' ? 'group3' : 'group6';
    playSelectedList = playSelectedList.filter((p) => {
      const parsed = parsePlay(p);
      return !(parsed && parsed.type === wantType && parsed.seg === seg);
    });
    const minPick = cat.minPick || (cat.mode === 'group3' ? 2 : 3);
    if (playPickedDigits.length < minPick) return;
    const digitStr = playPickedDigits.slice().sort((a, b) => a - b).join('');
    const plays = cat.mode === 'group3'
      ? expandGroup3Duplex(seg, digitStr)
      : expandGroup6Duplex(seg, digitStr);
    if (plays && plays.length) playSelectedList.push(...plays);
  }

  function groupDuplexBetCount(cat, n) {
    if (cat.mode === 'group3') return n >= 2 ? (n * (n - 1)) / 2 : 0;
    if (cat.mode === 'group6') return n >= 3 ? (n * (n - 1) * (n - 2)) / 6 : 0;
    return 0;
  }

  function currentPlayBetCount() {
    const cat = currentPlayCat();
    if ((cat.mode === 'group3' || cat.mode === 'group6') && playPickedDigits.length) {
      return groupDuplexBetCount(cat, playPickedDigits.length);
    }
    return playSelectedList.length;
  }

  function syncPlayFootTotals() {
    const n = currentPlayBetCount();
    let total = 0;
    if (playAllin) {
      const bal = Math.floor(App.getBalance(user.uid) || 0);
      if (n >= 1 && bal >= 1) total = n === 1 ? bal : Math.floor(bal / n) * n;
    } else {
      const unit = Math.max(0, parseInt($('#playAmount').val(), 10) || 0);
      total = n * unit;
    }
    $('#playBetTotal').text(total.toLocaleString('en-US'));
    const hasPick = !!(playSelectedList.length || playPickedDigits.length);
    $('#playClear').prop('disabled', !hasPick);
  }

  function updatePlaySelected() {
    const cat = currentPlayCat();
    const $tip = $('#playSelected');
    if ((cat.mode === 'group3' || cat.mode === 'group6') && playPickedDigits.length) {
      const n = playPickedDigits.length;
      const bets = groupDuplexBetCount(cat, n);
      const minPick = cat.minPick || (cat.mode === 'group3' ? 2 : 3);
      const codes = playPickedDigits.slice().sort((a, b) => a - b).join('');
      const name = cat.mode === 'group3' ? '组三' : '组六';
      if (n < minPick) {
        $tip.prop('hidden', false).text(`${currentPlaySub()}${name} 已选${codes || '—'}（还需${minPick - n}个号）`);
      } else {
        $tip.prop('hidden', false).text(`${currentPlaySub()}${name}${codes} · ${bets}注复式`);
      }
      syncPlayFootTotals();
      return;
    }
    if (!playSelectedList.length) {
      $tip.prop('hidden', true).text('');
      syncPlayFootTotals();
      return;
    }
    const n = playSelectedList.length;
    const list = playSelectedList.join('、');
    $tip.prop('hidden', false).text(n > 1 ? `${list}（共${n}项）` : list);
    syncPlayFootTotals();
  }

  function resetPlayPick(clearAll) {
    playPickedDigits = [];
    if (clearAll) playSelectedList = [];
    updatePlaySelected();
  }

  function clearPlaySelection() {
    resetPlayPick(true);
    renderPlayPanel();
    $('#playClear').prop('disabled', true);
  }

  function initPlaySheet() {
    $('#playNav').html(PLAY_CATEGORIES.map((c, i) =>
      `<button type="button" class="ssc-play-nav__item${i === playCatIdx ? ' is-active' : ''}" data-idx="${i}">${c.title}</button>`
    ).join(''));

    $('#playAmountChips').html(AMOUNT_CHIPS.map((c) =>
      `<button type="button" class="ssc-play-foot__chip${c.amt === 100 ? ' is-active' : ''}" data-amt="${c.amt}" aria-label="${c.label}">` +
        `<span class="ssc-play-foot__chip-glow" aria-hidden="true"></span>` +
        `<img src="${CHIP_IMG(c.amt)}" alt="${c.label}" draggable="false">` +
      `</button>`
    ).join(''));
    syncPlayFootTotals();
  }

  /** 副玩法栏（前三/中三/后三） */
  function renderPlaySubBar(cat) {
    const $sub = $('#playSub');
    if (!cat.subs || !cat.subs.length) {
      $sub.addClass('is-hidden').prop('hidden', true).empty();
      return;
    }
    const n = cat.subs.length;
    const modeHtml = cat.subs.map((s, i) =>
      `<button type="button" class="ssc-lm-mode${i === playSubIdx ? ' is-active' : ''}" data-sub="${i}">${s}</button>`
    ).join('');
    $sub.removeClass('is-hidden').prop('hidden', false).html(
      `<div class="ssc-lm-bar ssc-lm-bar--compact">
        <div class="ssc-lm-modes is-n${n}">${modeHtml}</div>
      </div>`
    );
  }

  function renderPlayPanel() {
    const cat = currentPlayCat();
    const prefix = 'ssc';
    const hintText = typeof cat.hint === 'function' ? cat.hint() : cat.hint;
    const hideHint = cat.id === 'twoSide' || cat.id === 'position' || cat.id === 'niu' || cat.id === 'shape'
      || cat.id === 'lhh' || cat.mode === 'segDigit' || cat.mode === 'group3' || cat.mode === 'group6';
    if (hideHint) $('#playHint').text('').hide();
    else $('#playHint').show().text(hintText || '');
    renderPlaySubBar(cat);

    const $grid = $('#playGrid');
    let html = '';
    const liveOdds = typeof cat.odds === 'function' ? cat.odds() : cat.odds;
    const sideGroups = typeof cat.sideGroups === 'function' ? cat.sideGroups() : cat.sideGroups;

    if (cat.id === 'position') {
      html = renderPosBallSections(prefix, liveOdds);
    } else if (cat.mode === 'segDigit') {
      html = renderSegDigitPanel(prefix, cat, liveOdds);
    } else if (cat.mode === 'group3' || cat.mode === 'group6') {
      const nPick = playPickedDigits.length;
      const bets = groupDuplexBetCount(cat, nPick);
      const minPick = cat.minPick || (cat.mode === 'group3' ? 2 : 3);
      const name = cat.mode === 'group3' ? '组三' : '组六';
      if (nPick > 0) {
        $('#playHint').show().text(
          nPick < minPick
            ? `已选${nPick}码 · 至少选${minPick}个 · ${name}复式 · 赔率 ${fmtOdds(liveOdds)}`
            : `已选${nPick}码 · ${name}复式 ${bets}注 · 每注金额见下方 · 赔率 ${fmtOdds(liveOdds)}`
        );
      }
      html = renderGroupDigitPanel(prefix, cat, liveOdds);
    } else if (cat.id === 'shape') {
      html = renderShapeAllPanel(prefix);
    } else if (cat.id === 'twoSide' && sideGroups) {
      html = sideGroups.map(g => {
        const cells = ['大', '小', '单', '双'].map(s => {
          const play = g.prefix + s;
          const active = isPlaySelected(play);
          return `<button type="button" class="ssc-play-item ssc-play-item--side${active ? ' is-active' : ''}" data-play="${play}"><span>${s}</span><small>${fmtOdds(g.odds)}</small></button>`;
        }).join('');
        return `<div class="ssc-play-section"><div class="ssc-play-section__title">${g.label}</div><div class="ssc-play-section__grid">${cells}</div></div>`;
      }).join('');
    } else if (cat.id === 'lhh') {
      html = renderLhhPanel(prefix);
    } else if (cat.id === 'niu') {
      html = renderNiuPanel(prefix);
    } else if (typeof cat.items === 'function') {
      html = cat.items().map(it => {
        const active = isPlaySelected(it.play);
        const sub = it.tip ? it.tip : fmtOdds(it.odds);
        return `<button type="button" class="ssc-play-item${active ? ' is-active' : ''}" data-play="${it.play}"><span>${it.label}</span><small>${sub}</small></button>`;
      }).join('');
    }

    $grid
      .removeClass('is-digits is-two-side is-ball-panel is-niu-panel is-shape-panel is-group-panel is-lhh-panel')
      .toggleClass('is-two-side', cat.id === 'twoSide')
      .toggleClass('is-ball-panel', cat.id === 'position' || cat.mode === 'segDigit' || cat.mode === 'group3' || cat.mode === 'group6')
      .toggleClass('is-group-panel', cat.mode === 'group3' || cat.mode === 'group6')
      .toggleClass('is-niu-panel', cat.id === 'niu')
      .toggleClass('is-shape-panel', cat.id === 'shape')
      .toggleClass('is-lhh-panel', cat.id === 'lhh')
      .html(html);
    $grid.scrollTop(0);
    updatePlaySelected();
  }

  $(window).on('resize orientationchange', () => {
    layoutRail();
    if ($('#playSheet').hasClass('is-open')) layoutPlayOverlay();
  });

  function submitPlayBet() {
    if (!playSelectedList.length) {
      App.toast('请先选择玩法');
      return;
    }
    if (!isBettingOpen()) {
      toastBetBlocked('bet');
      return;
    }
    const validPlays = playSelectedList.filter(p => parsePlay(p));
    if (!validPlays.length) {
      App.toast('玩法无效，请重新选择');
      return;
    }
    let lines;
    if (playAllin) {
      lines = resolveBetAmounts(validPlays, '梭哈');
      if (!lines) { App.toast('余额不足，无法梭哈'); return; }
    } else {
      const amount = Math.max(1, parseInt($('#playAmount').val(), 10) || 0);
      if (!amount) {
        App.toast('请输入有效金额');
        return;
      }
      lines = resolveBetAmounts(validPlays, String(amount));
      if (!lines) {
        App.toast('请输入有效金额');
        return;
      }
      const bal = App.getBalance(user.uid);
      const total = lines.reduce((s, l) => s + l.amount, 0);
      if (total > bal) { App.toast('余额不足'); return; }
    }
    const mapped = mapLinesToServerBets(lines);
    if (mapped.unsupported.length || !mapped.bets.length) {
      App.toast('格式错误');
      return;
    }
    if (!App.placeLotteryBets) {
      App.toast('请从大厅进入游戏');
      return;
    }
    App.placeLotteryBets(SERVER_GAME, mapped.bets, {
      chatText: lines.map(function (l) { return l.play + '/' + l.amount; }).join(' '),
    }).then(function () {
      refreshStats();
      recordBetLines(user.name, lines);
      lastBetText = lines.map(l => l.play + '/' + l.amount).join(' ');
      playSelectedList = [];
      playPickedDigits = [];
      playAllin = false;
      syncPlayAmountUI();
      openPlaySheet(false);
      App.toast(`投注成功 · ${lines.length}注`);
      syncRoomChat(false);
    }).catch(function (e) {
      App.toast((e && e.message) || '下注失败');
    });
  }

  function initPlaySheetEvents() {
    $('#playNav').on('click', '.ssc-play-nav__item', function () {
      playCatIdx = +$(this).data('idx');
      playSubIdx = 0;
      resetPlayPick(true);
      $('#playNav .ssc-play-nav__item').removeClass('is-active');
      $(this).addClass('is-active');
      renderPlayPanel();
    });

    $('#playSub').on('click', '.ssc-lm-mode', function () {
      playSubIdx = +$(this).data('sub');
      playPickedDigits = [];
      renderPlayPanel();
      updatePlaySelected();
    });
    $('#playSub').on('click', '.ssc-lm-play[data-shape]', function () {
      const shape = String($(this).data('shape') || '');
      if (!shape) return;
      togglePlaySelect(currentPlaySub() + shape);
      renderPlayPanel();
      updatePlaySelected();
    });

    $('#playGrid').on('click', '.ssc-play-item, .ssc-play-ball', function () {
      const cat = currentPlayCat();
      const play = String($(this).data('play'));
      const isDigit = $(this).data('digit');

      if (isDigit && (cat.mode === 'group3' || cat.mode === 'group6')) {
        const d = +play;
        const idx = playPickedDigits.indexOf(d);
        if (idx >= 0) playPickedDigits.splice(idx, 1);
        else playPickedDigits.push(d);
        syncGroupDuplexSelection(cat);
        renderPlayPanel();
        updatePlaySelected();
        return;
      }

      if (isDigit && cat.mode === 'segDigit') {
        const playStr = currentPlaySub() + play;
        togglePlaySelect(playStr);
        $(this).toggleClass('is-active', isPlaySelected(playStr));
        updatePlaySelected();
        return;
      }

      togglePlaySelect(play);
      $(this).toggleClass('is-active', isPlaySelected(play));
      updatePlaySelected();
    });

    $('#playAmountChips').on('click', '.ssc-play-foot__chip', function () {
      const amt = +$(this).data('amt');
      setPlayAmount(amt);
      clearPlayAmountChipActive();
      $(this).addClass('is-active');
      syncPlayFootTotals();
    });

    $('#playAmountAllin').on('click', function () {
      playAllin = !playAllin;
      syncPlayAmountUI();
      syncPlayFootTotals();
    });

    $('#playAmount').on('input change', function () {
      if (playAllin) return;
      const v = parseInt($(this).val(), 10);
      clearPlayAmountChipActive();
      if (v > 0) {
        $(`#playAmountChips .ssc-play-foot__chip[data-amt="${v}"]`).addClass('is-active');
      }
      syncPlayFootTotals();
    });

    $('#playSubmit').on('click', submitPlayBet);
  }

  // ===== 初始化 =====
  refreshStats();
  initKeypad();
  initPlaySheet();
  $('#playClear').prop('disabled', true);
  initPlaySheetEvents();
  restoreBetBook();
  loadServerPayTable();
  /* 聊天权威在服务端：进房只拉房间时间线，禁止本机 seed / localStorage 造事件 */
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
      return { issue: String(row.issueNo || ''), nums, gy: nums.length === 5 ? gyMeta(nums).text : '', dt: nums.length === 5 ? dragonTigerOf(nums) : '', lh: nums.length === 5 ? lhRow(nums) : '' };
    }).filter(r => r.issue && r.nums.length === 5);
  }

  function isCeremonyHolding() {
    try {
      const phase = roomChat && roomChat.getPhase ? roomChat.getPhase() : '';
      return phase === 'drawing' || phase === 'revealing' || phase === 'settled';
    } catch (e) { return false; }
  }
  /** 开奖仪式中：顶栏用上一期；揭晓完再跟历史头 */
  function pickDrawBarRow(rows) {
    if (!rows || !rows.length) return null;
    try {
      const hold = roomChat && roomChat.getPhaseIssue ? String(roomChat.getPhaseIssue() || '') : '';
      if (isCeremonyHolding() && hold && String(rows[0].issue) === hold) {
        return rows[1] || null;
      }
    } catch (e) { /* ignore */ }
    return rows[0];
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
        /* 仪式未结束前顶栏仍显示上一期，避免比结果卡更早露号 */
        const barRow = pickDrawBarRow(rows);
        if (barRow) renderDrawBar(barRow);
      } else if (typeof renderDrawBar === 'function') {
        try { renderDrawBar(null); } catch (e) { /* ignore */ }
      }
      const current = snapshot && snapshot.current;
      /* 快照成功即视为桥已通；无 current 时显示等待开盘，而不是永久「同步中」 */
      serverSynced = true;
      if (current && current.issueNo) {
        serverCurrent = current;
      } else if (serverCurrent) {
        const _st = String(serverCurrent.status || '');
        const _openAt = new Date(serverCurrent.openAt).getTime();
        /* 无新 current 且旧期已开完才清空；LOCKED/PENDING 仍保留给 tick 显示开奖中 */
        if (_st !== 'PENDING' && _st !== 'LOCKED' && Number.isFinite(_openAt) && Date.now() >= _openAt) {
          serverCurrent = null;
        }
      }
      if (typeof tick === 'function') try { tick(); } catch (e) { /* ignore */ }
      renderDrawTable();
      /* 仪式中期号由 tick/phase 接管，勿被快照 current 盖掉 */
      if (!isCeremonyHolding() && serverCurrent && serverCurrent.issueNo) setCurIssueDisplay(serverCurrent.issueNo);
      settleRestoredResultCards();
      /* 开奖卡由房间公共聊天写入，snapshot 只更新顶栏/历史 */
      if (rows[0]) {
        const holdIss = roomChat && roomChat.getPhaseIssue ? String(roomChat.getPhaseIssue() || '') : '';
        if (!(isCeremonyHolding() && holdIss && String(rows[0].issue) === holdIss)) {
          revealedIssues.add(rows[0].issue);
          saveRevealedIssues();
        }
        historyHeadBootstrapped = true;
      }
      if ($('#longSheet').hasClass('is-open')) renderLongDragonPanel();
      if ($('#predictSheet').hasClass('is-open')) renderPredictPanel();
    }).catch(function () {
      /* 桥接失败不卡死：限流/超时后指数退避，避免把 429 打得更狠 */
      if (!serverSynced) {
        const fails = (syncServerSnapshot._fail = (syncServerSnapshot._fail || 0) + 1);
        const wait = Math.min(8000, 800 * Math.pow(2, Math.min(fails, 3)));
        setTimeout(function () {
          if (!serverSynced && !snapshotBusy && typeof syncServerSnapshot === 'function') syncServerSnapshot();
        }, wait);
      }
    }).finally(function () {
      snapshotBusy = false;
      if (serverSynced) syncServerSnapshot._fail = 0;
    });
  }

  function tick() {
    const phase = roomChat && roomChat.getPhase ? roomChat.getPhase() : '';
    const hold = roomChat && roomChat.getPhaseIssue ? roomChat.getPhaseIssue() : '';
    const ceremony = phase === 'drawing' || phase === 'revealing' || phase === 'settled';
    /* 仪式未收干净时，若服务端已进入更新一期可下注，顶栏立即跟 serverCurrent，避免卡在上期 */
    let releaseCeremonyHold = false;
    if (ceremony && hold && serverSynced && serverCurrent) {
      const nextIssue = String(serverCurrent.issueNo || '');
      const nextLock = new Date(serverCurrent.lockAt).getTime();
      const nextOpen = new Date(serverCurrent.openAt).getTime();
      const nowHold = Date.now();
      const nextBetting = String(serverCurrent.status || '') === 'PENDING'
        && Number.isFinite(nextLock) && nowHold < nextLock;
      if (nextIssue && nextIssue !== hold && (nextBetting || (Number.isFinite(nextOpen) && nowHold >= nextOpen))) {
        releaseCeremonyHold = true;
        if (typeof requestLotteryResync === 'function') requestLotteryResync();
      }
    }
    if (ceremony && !releaseCeremonyHold) {
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
      const issueCur = String(serverCurrent.issueNo || '');
      const status = String(serverCurrent.status || '');
      const now = Date.now();
      const open = status === 'PENDING' && now < lockAt;
      setCurIssueDisplay(issueCur);
      if (open) {
        updateCountdownUI('bet', Math.max(0, (lockAt - now) / 1000));
        if (window.SscAudio && SscAudio.armCountdown) SscAudio.armCountdown(lockAt);
        if (roomBetFrozen && sealedIssueNo && issueCur && issueCur !== sealedIssueNo) {
          roomBetFrozen = false;
          sealedIssueNo = '';
        }
      } else if (status === 'LOCKED' || (status === 'PENDING' && now >= lockAt)) {
        /* 快照已封盘但聊天 close 尚未到：先显示开奖中，等 phase 接管 */
        updateCountdownDrawing();
        if (Number.isFinite(new Date(serverCurrent.openAt).getTime()) &&
            now >= new Date(serverCurrent.openAt).getTime()) {
          requestLotteryResync();
        }
      } else {
        /* DRAWN 等：拉下一期，短暂显示等待 */
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
  if (App.startAdaptiveInterval) App.startAdaptiveInterval(syncServerSnapshot, 2000, 5000); else { syncServerSnapshot(); setInterval(syncServerSnapshot, 2000); }
  /* 机器人氛围下注改由服务端房间聊天写入 */
  tick();

  // ===== 事件 =====
  $('#backBtn').on('click', () => {
    if (App.backToLobby) App.backToLobby();
    else App.go('../../client-app/pages/game-lobby/game-lobby.html' + q);
  });

  layoutRail();
  $(window).on('resize orientationchange', function () { layoutRail(); });
  if (typeof ResizeObserver !== 'undefined') {
    const roomEl = document.querySelector('.ssc-room');
    if (roomEl) {
      try {
        new ResizeObserver(function () { layoutRail(); }).observe(roomEl);
      } catch (e) { /* ignore */ }
    }
  }
  /* === chat-rail handlers (ssc) === */

  function openRulesSheet(open) {
    if (open) {
      const o = ODDS;
      const so = SHAPE_ODDS;
      const html = `
        <div class="ssc-rules-sec">
          <h3 class="ssc-rules-sec__title">一、开奖与时间</h3>
          <p>快乐时时彩每期开出 <b>5</b> 个号码（万、千、百、十、个），每位为 <b>0～9</b>。</p>
          <p>每期共 <b>${INTERVAL} 秒</b>。顶栏显示「距封盘」；封盘后显示「开奖中」，不可下注、不可取消。</p>
          <p>开奖结果、历史栏与核对派彩均以服务端账本为准。</p>
        </div>
        <div class="ssc-rules-sec">
          <h3 class="ssc-rules-sec__title">二、如何下注</h3>
          <p>支持三种方式：</p>
          <ul>
            <li>点右侧 / 底部「玩法」面板点选号码后投注</li>
            <li>底部输入口令，格式：<b>玩法/金额</b>（空格可下多注）</li>
            <li>键盘快捷：上分、取消、梭哈、重复、下分</li>
          </ul>
          <span class="ssc-rules-ex">大/100　万单/50　龙 虎/20</span>
          <span class="ssc-rules-ex">十百59/100　前三组六258/50　万5/梭哈</span>
          <p>金额可用「梭哈」：按当前可用积分均分到所选玩法（向下取整）。玩法脚「重复」可快速跟上一笔。</p>
          <p>底部「+」可进入：上下分、申请记录、竞猜报表、自助回水、福利活动、我的账户。</p>
        </div>
        <div class="ssc-rules-sec">
          <h3 class="ssc-rules-sec__title">三、玩法与赔率</h3>
          <p>下列为当前房间赔率（会随后台赔率表更新）。中奖派彩 = 投注金额 × 赔率（四舍五入到分）。</p>
          <table class="ssc-rules-table">
            <thead><tr><th>玩法</th><th>赔率</th><th>说明</th></tr></thead>
            <tbody>
              <tr><td>总和两面</td><td>${fmtOdds(o.sumSide)}</td><td>五星和值：≥23 大，≤22 小；奇单偶双</td></tr>
              <tr><td>定位两面</td><td>${fmtOdds(o.ballSide)}</td><td>万/千/百/十/个 + 大(≥5)/小(≤4)/单/双</td></tr>
              <tr><td>定位胆</td><td>${fmtOdds(o.position)}</td><td>指定某一位为某数字，如「万5」「个0」</td></tr>
              <tr><td>不定位</td><td>${fmtOdds(o.anyDigit)}</td><td>前三/中三/后三中出现指定数字（不限位置）</td></tr>
              <tr><td>三星组三</td><td>${fmtOdds(o.group3)}</td><td>前/中/后三开出对子形态，且两枚选号都出现</td></tr>
              <tr><td>三星组六</td><td>${fmtOdds(o.group6)}</td><td>前/中/后三三个不同号，且三枚选号都出现</td></tr>
              <tr><td>龙虎和</td><td>龙/虎 ${fmtOdds(o.dragon)}<br>和 ${fmtOdds(o.tie)}</td><td>任意两球比大小：左&gt;右龙，左&lt;右虎，相等为和；口令「1/2龙/100」「1/3虎/50」，可胶连「1/2龙1/3虎/100」</td></tr>
              <tr><td>斗牛</td><td>无牛 ${fmtOdds(o.noNiu)}<br>牛 ${fmtOdds(o.niu)}</td><td>任三张和为 10 倍数则有牛；余两码和个位为牛几（0=牛牛）</td></tr>
              <tr><td>牛两面</td><td>${fmtOdds(o.niuSide)}</td><td>牛大(6～牛牛)/牛小(1～5)/牛单/牛双；开无牛判输</td></tr>
              <tr><td>前中后形态</td><td>豹 ${fmtOdds(so['豹子'])}<br>顺 ${fmtOdds(so['顺子'])}<br>对 ${fmtOdds(so['对子'])}<br>半 ${fmtOdds(so['半顺'])}<br>杂 ${fmtOdds(so['杂六'])}</td><td>豹子 / 顺子 / 对子 / 半顺 / 杂六（含 9-0、0-1）</td></tr>
            </tbody>
          </table>
        </div>

        <div class="ssc-rules-sec">
          <h3 class="ssc-rules-sec__title">四、取消与结算</h3>
          <p>当期未封盘前可输入「取消」或点键盘「取消」，撤销本人本期未结算注单；封盘后不可取消。</p>
          <p>开奖后房间会推送结果卡与注单/中奖核对；积分变动以服务端派彩为准。顶部「输赢 / 流水 / 回水」为房间会话统计参考。</p>
        </div>
        <div class="ssc-rules-sec">
          <h3 class="ssc-rules-sec__title">五、温馨提示</h3>
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
    App.go('../../client-app/pages/bet-records/bet-records.html' + q + sep + 'game=ssc');
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
  $('#playClear').on('click', clearPlaySelection);
  $('#playRepeat').on('click', function () {
    if (!lastBetText) {
      App.toast('暂无上次投注');
      return;
    }
    openPlaySheet(false);
    $('#chatInput').val(lastBetText);
    updateComposerAction();
    App.toast('已填入上次投注，确认后发送');
  });
  $('#btnLong').on('click', () => openLongSheet(true));
  $('#longSheetClose, #longMask').on('click', () => openLongSheet(false));
  $('#longTabs').on('click', 'button[data-tab]', function () {
    longTab = $(this).data('tab');
    $('#longTabs button').removeClass('is-active');
    $(this).addClass('is-active');
    renderLongDragonPanel();
  });
  $('#longBody').on('click', '[data-predict-play]', function () {
    fillPredictPlay(String($(this).data('predict-play') || ''));
  });
  $('#longBody').on('keydown', '[data-predict-play]', function (e) {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      fillPredictPlay(String($(this).data('predict-play') || ''));
    }
  });
  $('#btnPredict').on('click', () => openPredictSheet(true));
  $('#predictSheetClose, #predictMask').on('click', () => openPredictSheet(false));
  $('#predictTabs').on('click', 'button[data-tab]', function () {
    predictTab = $(this).data('tab');
    $('#predictTabs button').removeClass('is-active');
    $(this).addClass('is-active');
    renderPredictPanel();
  });
  $('#predictBody').on('click', '[data-predict-play]', function () {
    fillPredictPlay(String($(this).data('predict-play') || ''));
  });
  $('#predictBody').on('keydown', '[data-predict-play]', function (e) {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      fillPredictPlay(String($(this).data('predict-play') || ''));
    }
  });

  $('#drawToggle').on('click', toggleDrawPanel);

  $('#chatInput').on('focus', () => {
    openPlusMenu(false);
    /* 等当前手势的 click 冒泡完再弹，避免立刻被 document 关闭 */
    setTimeout(() => showKeypad(true), 0);
  });

  $('#chatInput').on('click', function (e) {
    e.stopPropagation();
    try { this.focus({ preventScroll: true }); } catch (err) { this.focus(); }
    openPlusMenu(false);
    showKeypad(true);
  });

  $('#chatInput').on('input', () => {
    composerAllin = false;
    updateComposerAction();
  });

  $('#chatInput').on('keydown', function (e) {
    if (e.key === 'Enter') {
      e.preventDefault();
      sendBetMessage();
    }
  });

  $('#keyGrid').on('click', '.ssc-key', function () {
    const key = $(this).attr('data-key');
    if (key === '删除') return; /* 删除走 pointer 长按逻辑，避免连删双触发 */
    insertInput(key);
  });

  $('#keyGrid').on('pointerdown', '.ssc-key', function (e) {
    if ($(this).attr('data-key') !== '删除') return;
    e.preventDefault();
    stopDeleteHold();
    insertInput('删除');
    delHoldTimer = setTimeout(() => {
      delHoldInterval = setInterval(() => insertInput('删除'), 55);
    }, 380);
  });

  $('#keyGrid').on('pointerup pointerleave pointercancel', '.ssc-key', function () {
    if ($(this).attr('data-key') === '删除') stopDeleteHold();
  });
  $(window).on('pointerup pointercancel', stopDeleteHold);

  $('#keypad').on('click', '[data-key]', function () {
    const key = String($(this).attr('data-key') ?? '');
    if (!key || $(this).closest('#keyGrid').length) return;
    insertInput(key);
  });

  $('#keypad').on('click', '[data-cmd]', function () {
    const cmd = $(this).data('cmd');
    if (cmd === 'cancel') {
      composerAllin = false;
      $('#chatInput').val('取消');
      updateComposerAction();
      return;
    }
    if (cmd === 'repeat') {
      if (!lastBetText) {
        App.toast('暂无上次投注');
        return;
      }
      composerAllin = false;
      $('#chatInput').val(lastBetText);
      updateComposerAction();
      return;
    }
    if (cmd === 'allin') {
      applyAllinToInput();
      return;
    }
    if (cmd === 'topup') {
      composerAllin = false;
      $('#chatInput').val('上分');
      updateComposerAction();
      return;
    }
    if (cmd === 'withdraw') {
      $('#chatInput').val('下分');
      composerAllin = false;
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
    if (!$(e.target).closest('#keypad, #chatInput, .ssc-composer').length && $('#keypad').is(':visible')) {
      if (!$(e.target).closest('.ssc-plus-menu, #plusBtn, .ssc-menu-mask').length) {
        showKeypad(false);
      }
    }
  });

  updateComposerAction();
  window.addEventListener('gamebox-balance', function () { refreshStats(); });
});
