/**
 * 幸运飞艇 · 聊天投注房
 * 界面对齐时时彩；玩法对齐官方 PK10/幸运飞艇：
 * 名次两面 / 龙虎 / 冠亚和值 / 定位艇号
 * BUILD 119 — 与 index.html ?v= 保持一致
 */
$(function () {
  /** 与服务端一致：60 秒一局；下注 41 秒，开奖中 19 秒（盖住约 17s 竞速动画，对齐极速赛车）。 */
  const INTERVAL = 60;
  const PREP_SEC = 19;

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
    if (url.startsWith('/')) return url;
    return fallback;
  }

  function avatarHtml(name, seed) {
    const hue = (seed * 41 + (name.charCodeAt(0) || 0) * 17) % 360;
    const ch = name.charAt(0) || '?';
    return `<div class="jsb-msg__avatar jsb-msg__avatar--gen" style="--av-hue:${hue}"><span>${ch}</span></div>`;
  }

  const ROBOT = { name: '开奖员', avatar: '/images/avatars/001.jpg' };
  const params = new URLSearchParams(location.search);
  const roomNo = (params.get('roomNo') || '').trim();
  let user = App.getUser();
  const _setUser = App.setUser;
  App.setUser = function (u) {
    _setUser(u);
    user = App.getUser();
  };
  const q = roomNo ? '?roomNo=' + encodeURIComponent(roomNo) : '';
  const SERVER_GAME = 'speed-boat';

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

  const SIDE_TO_SERVER = { '大': 'big', '小': 'small', '单': 'odd', '双': 'even' };
  const GY_SIDE_TO_SERVER = { '大': 'top2big', '小': 'top2small', '单': 'top2odd', '双': 'top2even' };

  /** H5 玩法 → 大脑 { betType, betValue? } */
  function mapPlayToServer(play) {
    const parsed = parsePlay(play);
    if (!parsed) return null;
    switch (parsed.type) {
      case 'gySide':
        return { betType: GY_SIDE_TO_SERVER[parsed.side] };
      case 'gySum':
        return { betType: 'gySum', betValue: String(parsed.sum) };
      case 'posSide':
        return { betType: 'posSide', betValue: parsed.pos + ':' + SIDE_TO_SERVER[parsed.side] };
      case 'position':
        return { betType: 'position', betValue: parsed.pos + ':' + parsed.num };
      case 'lhh':
        return { betType: 'lhh', betValue: parsed.a + ':' + parsed.b + ':' + parsed.pick };
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
    if (window.JsbAudio && JsbAudio.onDrawing) JsbAudio.onDrawing();
  }
  function requestLotteryResync() {
    const now = Date.now();
    if (openAtResyncAt && now - openAtResyncAt < 800) return;
    openAtResyncAt = now;
    snapshotBusy = false;
    if (typeof App.resyncLottery === 'function') App.resyncLottery();
    else if (typeof syncServerSnapshot === 'function') syncServerSnapshot();
  }
  const REVEALED_STORAGE_KEY = 'jsb_revealed_v1';
  const PLAYED_ANIM_STORAGE_KEY = 'jsb_played_anim_v1';
  const CLOSED_STORAGE_KEY = 'jsb_closed_v1';
  let revealedIssues = new Set();
  let playedAnimIssues = new Set();
  /** 进房后首次拉到历史头：只对齐顶栏，不往聊天推「进房前已开奖」 */
  let historyHeadBootstrapped = false;
  let lastBetText = '';
  let composerAllin = false;
  let drawPanelOpen = false;
  let closedIssues = new Set();
  /** 封盘后冻结下注，开奖核对展示完再解冻（避免下一期过早冒注） */
  let roomBetFrozen = false;
  let sealedIssueNo = '';
  const issueBetBook = {};

  const POS_NAMES = ['冠军', '亚军', '季军', '第四名', '第五名', '第六名', '第七名', '第八名', '第九名', '第十名'];
  const POS = {};
  POS_NAMES.forEach((n, i) => { POS[n] = i; });
  const LHH_PAIRS = [[0, 9], [1, 8], [2, 7], [3, 6], [4, 5]];
  /* 与 bjsc / speed-racing / server bjscPayTable 同值 */
  const ODDS = { side: 1.995, dragon: 1.995, position: 9.95 };
  const GY_SUM_ODDS = {
    3: 42.5, 4: 42.5, 5: 21.5, 6: 21.5, 7: 14.5, 8: 14.5,
    9: 10.5, 10: 10.5, 11: 8.5, 12: 10.5, 13: 10.5, 14: 14.5,
    15: 14.5, 16: 21.5, 17: 21.5, 18: 42.5, 19: 42.5
  };

  function applyServerPayTable(pt) {
    if (!pt) return;
    // 冠亚两面与名次两面产品同为 1.995，本地共用 ODDS.side
    ODDS.side = mulOf(pt, 'posSide', mulOf(pt, 'top2big', ODDS.side));
    ODDS.dragon = mulOf(pt, 'lhh', ODDS.dragon);
    ODDS.position = mulOf(pt, 'position', ODDS.position);
    for (let n = 3; n <= 19; n++) {
      GY_SUM_ODDS[n] = mulOf(pt, 'gySum_' + n, GY_SUM_ODDS[n]);
    }
  }
  const SUOHA_WORDS = new Set(['梭哈', '全下', 'allin']);
  const DEFAULT_TRACK_IDX = 0;

  function sideOfBall(n) { return { big: n >= 6, odd: n % 2 === 1 }; }
  function gyMeta(nums) {
    const s = nums[0] + nums[1];
    if (s === 11) return { sum: s, size: '和', parity: '和', text: '11 和' };
    return { sum: s, size: s >= 12 ? '大' : '小', parity: s % 2 ? '单' : '双', text: `${s} ${s >= 12 ? '大' : '小'} ${s % 2 ? '单' : '双'}` };
  }
  function lhRow(nums) {
    return LHH_PAIRS.map(([a, b]) => (nums[a] > nums[b] ? '龙' : '虎')).join('');
  }
  function matchSide(side, meta) {
    if (side === '大') return meta.big;
    if (side === '小') return !meta.big;
    if (side === '单') return meta.odd;
    return !meta.odd;
  }
  function parsePlay(raw) {
    const t = String(raw || '').replace(/\s+/g, '');
    let m;
    if ((m = t.match(/^冠亚(大|小|单|双)$/))) return { type: 'gySide', side: m[1], odds: ODDS.side };
    if ((m = t.match(/^冠亚和(1[0-9]|[3-9])$/))) {
      const sum = +m[1];
      if (sum < 3 || sum > 19) return null;
      return { type: 'gySum', sum, odds: GY_SUM_ODDS[sum] || 8.5 };
    }
    // 赛道号两面：1单 0大（0=第10道）
    if ((m = t.match(/^([0-9])(大|小|单|双)$/))) {
      const pos = digitToNum(m[1]) - 1;
      if (pos < 0 || pos > 9) return null;
      return { type: 'posSide', pos, side: m[2], odds: ODDS.side };
    }
    // 赛道定位：1/5 / 0/3（车号 0=10；兼容旧「定」）
    if ((m = t.match(/^([0-9])[\/定](10|[0-9])$/))) {
      const pos = digitToNum(m[1]) - 1;
      const num = m[2] === '10' ? 10 : digitToNum(m[2]);
      if (pos < 0 || pos > 9 || !num || num < 1 || num > 10) return null;
      return { type: 'position', pos, num, odds: ODDS.position };
    }
    for (const name of POS_NAMES) {

      if ((m = t.match(new RegExp('^' + name + '(大|小|单|双)$')))) return { type: 'posSide', pos: POS[name], side: m[1], odds: ODDS.side };
      if ((m = t.match(new RegExp('^' + name + '(10|[1-9])$')))) {
        const num = +m[1];
        if (num < 1 || num > 10) return null;
        return { type: 'position', pos: POS[name], num, odds: ODDS.position };
      }
    }
    if ((m = t.match(/^([1-5])v(6|7|8|9|10)(龙|虎)$/))) {
      const a = +m[1] - 1; const b = +m[2] - 1;
      if (a >= b) return null;
      return { type: 'lhh', a, b, pick: m[3], odds: ODDS.dragon };
    }
    if ((m = t.match(/^([1-5])(龙|虎)$/))) {
      const pairIdx = +m[1] - 1;
      const [a, b] = LHH_PAIRS[pairIdx];
      return { type: 'lhh', a, b, pick: m[2], odds: ODDS.dragon };
    }
    if (t === '龙' || t === '虎') return { type: 'lhh', a: 0, b: 9, pick: t, odds: ODDS.dragon };
    if ((m = t.match(/^(大|小|单|双)$/))) return { type: 'posSide', pos: 0, side: m[1], odds: ODDS.side };
    return null;
  }
  function settleBet(play, amount, nums) {
    const p = parsePlay(play);
    if (!p) return { winAmount: 0, profit: -amount, hit: '' };
    let win = false;
    switch (p.type) {
      case 'gySide': {
        const gy = gyMeta(nums);
        if (gy.sum === 11) return { winAmount: amount, profit: 0, hit: '和' };
        if (p.side === '大') win = gy.sum >= 12;
        else if (p.side === '小') win = gy.sum <= 10;
        else if (p.side === '单') win = gy.sum % 2 === 1;
        else win = gy.sum % 2 === 0;
        break;
      }
      case 'gySum': win = nums[0] + nums[1] === p.sum; break;
      case 'posSide': win = matchSide(p.side, sideOfBall(nums[p.pos])); break;
      case 'position': win = nums[p.pos] === p.num; break;
      case 'lhh': {
        const res = nums[p.a] > nums[p.b] ? '龙' : '虎';
        win = res === p.pick;
        break;
      }
    }
    if (!win) return { winAmount: 0, profit: -amount, hit: '' };
    const winAmount = Math.round(amount * p.odds * 100) / 100;
    return { winAmount, profit: winAmount - amount, hit: play };
  }
  function digitToNum(ch) {
    if (ch === '0') return 10;
    if (ch >= '1' && ch <= '9') return +ch;
    return null;
  }
  function trackLabel(idx) {
    return idx === 9 ? '0' : String(idx + 1);
  }
  function carLabel(num) {
    return num === 10 ? '0' : String(num);
  }
  function parseTrackDigits(s) {
    if (!s || !/^[0-9]+$/.test(s)) return null;
    const indices = [], seen = new Set();
    for (let i = 0; i < s.length; i++) {
      const n = digitToNum(s[i]);
      if (n === null) return null;
      if (seen.has(n)) continue;
      seen.add(n);
      indices.push(n - 1);
    }
    return indices.length ? indices : null;
  }
  function parseNumberDigits(s) {
    if (!s || !/^[0-9]+$/.test(s)) return null;
    const out = [];
    for (let i = 0; i < s.length; i++) {
      const n = digitToNum(s[i]);
      if (n === null) return null;
      out.push(n);
    }
    return out.length ? out : null;
  }
  function parseTracksFromStart(s) {
    const indices = [], seen = new Set();
    let i = 0;
    while (i < s.length) {
      const n = digitToNum(s[i]);
      if (n === null) break;
      i += 1;
      if (seen.has(n)) continue;
      seen.add(n);
      indices.push(n - 1);
    }
    return indices.length ? { indices, rest: s.slice(i) } : null;
  }
  function parsePairIndices(s) {
    if (!s || !/^[0-9]+$/.test(s)) return null;
    const out = [], seen = new Set();
    for (let i = 0; i < s.length; i++) {
      const n = digitToNum(s[i]);
      if (n === null || n < 1 || n > 5) continue;
      if (seen.has(n)) continue;
      seen.add(n);
      out.push(n);
    }
    return out.length ? out : null;
  }
  function expandLhhTracksPlay(pairStr, pick) {
    if (!/^[龙虎]$/.test(pick)) return null;
    const pairs = parsePairIndices(pairStr);
    if (!pairs) return null;
    const plays = [];
    pairs.forEach(n => { const play = n + pick; if (parsePlay(play)) plays.push(play); });
    return plays.length ? plays : null;
  }
  function expandLhhFromGlued(t) {
    const plays = [], re = /([1-5])([龙虎])/g;
    let m, consumed = '';
    while ((m = re.exec(t)) !== null) {
      const play = m[1] + m[2];
      if (!parsePlay(play)) return null;
      plays.push(play);
      consumed += m[0];
    }
    if (!plays.length || consumed !== t) return null;
    return plays;
  }
  function expandTrackPlay(trackIndices, playSeg) {
    const seg = String(playSeg || '').replace(/\s+/g, '');
    if (!seg) return null;
    const plays = [];
    if (/^[大小单双]$/.test(seg)) {
      trackIndices.forEach(idx => {
        const play = trackLabel(idx) + seg;
        if (parsePlay(play)) plays.push(play);
      });
      return plays.length ? plays : null;
    }
    const nums = parseNumberDigits(seg);
    if (nums) {
      trackIndices.forEach(idx => nums.forEach(num => {
        const play = trackLabel(idx) + '/' + carLabel(num);
        if (parsePlay(play)) plays.push(play);
      }));
      return plays.length ? plays : null;
    }
    if (parsePlay(seg)) return [seg];
    return null;
  }
  function expandDefaultTrackPlay(t) {
    if (!t || !/^[0-9]+$/.test(t)) return null;
    return expandTrackPlay([DEFAULT_TRACK_IDX], t);
  }
  function expandPlayPart(playPart) {
    const t0 = String(playPart || '').trim();
    const t = t0.replace(/\s+/g, '');
    if (!t) return null;
    /* 多选两面（默认冠军）：大小、单双、大小单双 */
    if (/^[大小单双]+$/.test(t)) {
      const plays = [];
      const seen = new Set();
      for (const c of t) {
        if (seen.has(c)) continue;
        seen.add(c);
        if (parsePlay(c)) plays.push(c);
      }
      if (plays.length) return plays;
    }
    /* 冠亚多选两面：冠亚大小、冠亚大单 */
    {
      const mGySide = t.match(/^冠亚([大小单双]+)$/);
      if (mGySide) {
        const plays = [];
        const seen = new Set();
        for (const c of mGySide[1]) {
          if (seen.has(c)) continue;
          seen.add(c);
          const play = '冠亚' + c;
          if (parsePlay(play)) plays.push(play);
        }
        if (plays.length) return plays;
      }
    }
    /* 多选龙虎：龙虎 */
    if (/^[龙虎]+$/.test(t)) {
      const plays = [];
      const seen = new Set();
      for (const c of t) {
        if (seen.has(c)) continue;
        seen.add(c);
        if (parsePlay(c)) plays.push(c);
      }
      if (plays.length) return plays;
    }
    /* 冠亚和多选：冠亚和3/5/12 或 冠亚和3 5 12（有空格时优先按 t0 拆，避免和712175 粘连） */
    {
      const mGy = t0.match(/^冠亚和\s*([0-9]+(?:\s*[\/\s]\s*[0-9]+)*)$/)
        || t.match(/^冠亚和([0-9/]+)$/);
      if (mGy) {
        const nums = String(mGy[1]).split(/[\/\s]+/).map(Number).filter((n) => n >= 3 && n <= 19);
        const plays = [];
        const seen = new Set();
        nums.forEach((n) => {
          if (seen.has(n)) return;
          seen.add(n);
          const play = '冠亚和' + n;
          if (parsePlay(play)) plays.push(play);
        });
        if (plays.length) return plays;
      }
    }
    const slashParts = t.split('/').filter(Boolean);
    if (slashParts.length === 2) {
      if (/^[龙虎]$/.test(slashParts[1])) {
        const lh = expandLhhTracksPlay(slashParts[0], slashParts[1]);
        if (lh) return lh;
      }
      const tracks = parseTrackDigits(slashParts[0]);
      if (tracks) {
        const expanded = expandTrackPlay(tracks, slashParts[1]);
        if (expanded) return expanded;
      }
    }
    if (/^[0-9]+[龙虎]$/.test(t)) {
      const m = t.match(/^([0-9]+)([龙虎])$/);
      if (m) { const lh = expandLhhTracksPlay(m[1], m[2]); if (lh) return lh; }
    }
    const lhGlued = expandLhhFromGlued(t);
    if (lhGlued) return lhGlued;
    const glued = parseTracksFromStart(t);
    if (glued && glued.rest && /^[大小单双]+$/.test(glued.rest)) {
      const plays = [];
      const seen = new Set();
      for (const c of glued.rest) {
        glued.indices.forEach(idx => {
          const play = trackLabel(idx) + c;
          if (seen.has(play) || !parsePlay(play)) return;
          seen.add(play);
          plays.push(play);
        });
      }
      if (plays.length) return plays;
    }
    if (/^[0-9]+$/.test(t)) {
      const def = expandDefaultTrackPlay(t);
      if (def) return def;
    }
    if (parsePlay(t)) return [t];
    return null;
  }
  function resolveBetAmounts(plays, amountPart) {
    const key = String(amountPart || '').trim();
    if (!SUOHA_WORDS.has(key)) {
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
  function parseBetLines(text) {
    const raw = String(text || '').trim();
    const m = raw.match(/^(.+)\/(\d+|梭哈|全下|allin)$/i);
    if (!m) return null;
    const plays = expandPlayPart(m[1].trim());
    if (!plays || !plays.length) return null;
    return resolveBetAmounts(plays, m[2].trim());
  }
  function formatResolvedBets(lines) {
    return lines.map(l => `${l.play}/${l.amount}`).join(' ');
  }
  /** 空格多注：玩法段可含空格（如 冠亚和3 5 12/100），按最长可解析片段切分 */
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
  function parseBetInput(text) {
    const raw = String(text || '').trim();
    if (!raw) return null;
    const parts = splitChatBetTokens(raw, parseBetLines);
    const all = [];
    for (const part of parts) {
      const lines = parseBetLines(part);
      if (!lines) return null;
      all.push(...lines);
    }
    return all.length ? all : null;
  }

  function pad(n, w) { return String(n).padStart(w, '0'); }

  function shanghaiYmdParts(date) {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit',
    }).formatToParts(date || new Date());
    const get = function (t) {
      const hit = parts.find(function (p) { return p.type === t; });
      return hit ? hit.value : '01';
    };
    return { y: get('year'), m: get('month'), d: get('day') };
  }
  /** 与服务端 genIssueNo 一致：UTC 对齐 openAt → 上海日 MMDD + 当日序号 */
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
  function fmtIssue(seq) {
    void seq;
    return fmtIssueFromOpenAt(nextOpenAtMs());
  }
  function setCurIssueDisplay(issue) {
    $('#curIssue').text(issue).attr('title', issue);
  }
  function fmtTime(d) {
    return pad(d.getHours(), 2) + ':' + pad(d.getMinutes(), 2) + ':' + pad(d.getSeconds(), 2);
  }
  function getRoundRemain() {
    const openAt = nextOpenAtMs();
    let r = (openAt - srvNow()) / 1000;
    if (r <= 0) r = INTERVAL;
    return r;
  }
  function getBettingIssueSeq() {
    return fmtIssueFromOpenAt(nextOpenAtMs());
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
    /* 开奖仪式未回到 betting：禁止下注（避免冲线后、开盘线前误注下一期） */
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

  const SIDE_CHARS = '大小单双';

  /** 玩法与金额之间：没有 / 就补上；已有 / 或 各 则不再加 */
  function joinPlayAmount(play, amount) {
    const p = String(play || '').replace(/\s+$/g, '');
    const a = String(amount);
    if (!p) return a;
    if (/[\/各]$/.test(p)) return p + a;
    return p + '/' + a;
  }

  /** 键盘数字：玩法后补 /；「和」后第一段数字不加 /；号码/金额之间用键盘 / 分隔（末段为金额） */
  function appendKeyWithSlash(base, key) {
    const v = String(base || '');
    const t = (key === 0 || key === '0') ? '0' : String(key == null ? '' : key);
    if (!t || t === '/' || t === '各' || t === '删除' || t === '空格') return v + t;
    const isAmt = /^\d+$/.test(t);
    if (!isAmt) return v + t;
    if (!v) return t;
    if (/[\/各]$/.test(v)) return v + t;
    if (/\d$/.test(v)) return v + t;
    /* 冠亚和3/5/12/100：和后贴第一个号，其余号与金额按 / 分 */
    if (/和$/.test(v)) return v + t;
    return v + '/' + t;
  }

  function applyAllinToInput() {
    const $in = $('#chatInput');
    let v = $in.val().replace(/\s+/g, ' ').trim();
    if (!v) {
      App.toast('请先输入玩法，再点梭哈');
      return false;
    }
    const parts = v.split(/\s+/).filter(Boolean);
    const allPlays = [];
    const compactParts = [];
    for (const part of parts) {
      let plays = null;
      const stripped = part.replace(/\/(\d+|梭哈|全下|allin)$/i, '').replace(/\/$/, '');
      compactParts.push(stripped);
      plays = expandPlayPart(stripped);
      if (!plays || !plays.length) {
        const existing = parseBetLines(part);
        if (existing && existing.length) plays = existing.map(l => l.play);
      }
      if (!plays || !plays.length) {
        const via = parseBetLines(stripped + '/梭哈');
        if (via && via.length) plays = via.map(l => l.play);
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
    const per = allPlays.length === 1
      ? lines[0].amount
      : Math.floor(App.getBalance(user.uid) / allPlays.length);
    /* 输入框保持紧凑写法，发送时再拆注并按余额重算均分 */
    $in.val(compactParts.map(function (c) { return joinPlayAmount(c, per); }).join(' '));
    composerAllin = true;
    updateComposerAction();
    App.toast('梭哈已均分 · ' + allPlays.length + '注 · 每注约' + per);
    return true;
  }

  function betLogKey() { return 'jsb_bet_log_' + user.uid; }
  function loadUserBetLog() {
    try { return JSON.parse(localStorage.getItem(betLogKey())) || []; } catch (e) { return []; }
  }
  function saveUserBetLog(list) {
    localStorage.setItem(betLogKey(), JSON.stringify(list.slice(0, 120)));
    try { window.dispatchEvent(new CustomEvent('jsb-bet-log-updated')); } catch (e) { /* */ }
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

  function appendUserBetLog(issue, play, amount) {
    const log = loadUserBetLog();
    let group = log.find(g => g.issue === issue);
    if (!group) {
      group = { game: 'speed-boat', issue, createdAt: new Date().toISOString(), settled: false, bets: [], totalAmount: 0, totalProfit: 0 };
      log.unshift(group);
    }
    group.bets.push({ play, amount, status: 'PENDING', profit: 0, winAmount: 0, hit: '' });
    group.totalAmount += amount;
    saveUserBetLog(log);
  }

  
  function settleUserBetLog(issue, nums, rows) {
    const log = loadUserBetLog();
    const group = log.find(g => g.issue === issue);
    if (!group || !group.bets.length) return;
    group.settled = true;
    group.settledAt = new Date().toISOString();
    group.drawNums = (nums || []).slice();
    group.drawSummary = nums && nums.length === 10
      ? (gyMeta(nums).text + ' · ' + lhRow(nums))
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

  function betBookStorageKey() {
    const uid = (user && user.uid) ? user.uid : 'guest';
    return 'jsb_betbook_v1_' + uid + (roomNo ? '_' + roomNo : '');
  }
  function saveBetBook() {
    try {
      const keys = Object.keys(issueBetBook);
      const keep = keys.slice(-8);
      const slim = {};
      keep.forEach((k) => { slim[k] = issueBetBook[k]; });
      keys.forEach((k) => { if (!slim[k]) delete issueBetBook[k]; });
      localStorage.setItem(betBookStorageKey(), JSON.stringify(slim));
    } catch (e) { /* ignore */ }
  }
  function restoreBetBook() {
    try {
      const raw = JSON.parse(localStorage.getItem(betBookStorageKey()) || '{}');
      if (raw && typeof raw === 'object') Object.keys(raw).forEach((k) => { issueBetBook[k] = raw[k]; });
    } catch (e) { /* ignore */ }
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

  function recordBet(name, text, opts) {
    const lines = parseBetInput(text);
    if (!lines) return false;
    let ok = false;
    lines.forEach(({ play, amount }) => { if (recordBetLine(name, play, amount, opts)) ok = true; });
    return ok;
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

  
  function buildBetListVerifyFromServer(issue, list) {
    const scoped = App.filterLotteryBetsByIssue ? App.filterLotteryBetsByIssue(list, issue) : (Array.isArray(list) ? list : []);
    const bets = scoped.filter(function (b) { return b && b.status !== 'CANCELLED'; });
    const empty = '<div class="jsb-bot-empty">本期暂无下注</div>';
    if (!bets.length) {
      return '<div class="jsb-bot-card jsb-bot-card--bets"><div class="jsb-bot-card__head"><span class="jsb-bot-card__title">注单核对</span><span class="jsb-bot-card__issue">' + issue + '</span></div>' + empty + '</div>';
    }
    const total = bets.reduce(function (s, b) { return s + (Number(b.amount) || 0); }, 0);
    const groups = App.groupLotteryBetsByType(bets);
    const tags = groups.map(function (g) {
      return '<span class="jsb-bot-tag">' + g.label + '×' + g.count + '/' + fmtMoney2(g.amount) + '</span>';
    }).join('');
    let detail = '';
    if (bets.length <= 8) {
      detail = '<div class="jsb-bot-user__tags" style="margin-top:6px">' + bets.map(function (b) {
        return '<span class="jsb-bot-tag">' + App.labelLotteryBet(b) + '/' + fmtMoney2(b.amount) + '</span>';
      }).join('') + '</div>';
    }
    const userBlock = '<div class="jsb-bot-user is-me"><div class="jsb-bot-user__head"><span class="jsb-bot-user__name">我</span><span class="jsb-bot-user__sum">' + fmtMoney2(total) + '</span></div><div class="jsb-bot-user__tags">' + tags + '</div>' + detail + '</div>';
    return '<div class="jsb-bot-card jsb-bot-card--bets"><div class="jsb-bot-card__head"><span class="jsb-bot-card__title">注单核对</span><span class="jsb-bot-card__issue">' + issue + '</span></div><div class="jsb-bot-card__body is-full">' + userBlock + '</div></div>';
  }
  function buildMineLineHtmlFromServer(issue, list) {
    const scoped = App.filterLotteryBetsByIssue ? App.filterLotteryBetsByIssue(list, issue) : (Array.isArray(list) ? list : []);
    const bets = scoped.filter(function (b) { return b && b.status !== 'CANCELLED' && b.status !== 'PENDING'; });
    if (!bets.length) return '';
    const myProfit = bets.reduce(function (sum, b) { return sum + serverBetProfit(b); }, 0);
    const myWin = bets.reduce(function (sum, b) { return sum + (Number(b.payout) || 0); }, 0);
    const profitCls = myProfit >= 0 ? 'pos' : 'neg';
    const winText = myWin > 0 ? ('中奖 +' + fmtMoney2(myWin)) : '未中奖';
    return '<div class="jsb-bot-mine-line ' + profitCls + '">' +
      '<span class="jsb-bot-mine-line__label">您本期</span>' +
      '<span class="jsb-bot-mine-line__win">' + winText + '</span>' +
      '<span class="jsb-bot-mine-line__profit">输赢 ' + fmtProfit(myProfit) + '</span>' +
      '</div>';
  }
  function applyMineLineToWinHtml(html, mineHtml) {
    if (!mineHtml) return html;
    const re = /<div class="jsb-bot-mine-line[\s\S]*?<\/div>/;
    if (re.test(html)) return html.replace(re, mineHtml);
    return html.replace(/<\/div>\s*$/, mineHtml + '</div>');
  }

  function buildBetListVerifyHtml(issue) {
    const book = issueBetBook[issue];
    if (!book || !Object.keys(book).length) {
      return `<div class="jsb-bot-card jsb-bot-card--bets"><div class="jsb-bot-card__head"><span class="jsb-bot-card__title">注单核对</span><span class="jsb-bot-card__issue">${issue}</span></div><div class="jsb-bot-empty">本期暂无下注</div></div>`;
    }
    const names = Object.keys(book);
    const users = names.map(name => {
      const bets = book[name];
      const total = bets.reduce((s, b) => s + b.amount, 0);
      const tags = bets.map(b => `<span class="jsb-bot-tag">${b.play}/${fmtMoney2(b.amount)}</span>`).join('');
      return `<div class="jsb-bot-user${name === user.name ? ' is-me' : ''}"><div class="jsb-bot-user__head"><span class="jsb-bot-user__name">${name}</span><span class="jsb-bot-user__sum">${fmtMoney2(total)}</span></div><div class="jsb-bot-user__tags">${tags}</div></div>`;
    }).join('');
    return `<div class="jsb-bot-card jsb-bot-card--bets"><div class="jsb-bot-card__head"><span class="jsb-bot-card__title">注单核对</span><span class="jsb-bot-card__issue">${issue}</span></div><div class="jsb-bot-card__body is-full">${users}</div></div>`;
  }

  function buildWinListVerifyHtml(issue, settled) {
    const pending = settled == null;
    if (pending) {
      return '<div class="jsb-bot-card jsb-bot-card--win is-calculating"><div class="jsb-bot-card__head"><span class="jsb-bot-card__title">中奖核对</span><span class="jsb-bot-card__issue">' + issue + '</span></div><div class="jsb-bot-card__body is-full"><div class="jsb-bot-calc-line"><span class="jsb-bot-calc-line__icon" aria-hidden="true"></span><span class="jsb-bot-calc-line__text">正在核对中奖注单</span></div></div></div>';
    }
    const winners = Object.keys(settled || {}).filter(n => settled[n].some(r => r.winAmount > 0));
    let body = winners.length ? winners.map(name => {
      const winRows = settled[name].filter(r => r.winAmount > 0);
      const totalProfit = settled[name].reduce((s, r) => s + r.profit, 0);
      const tags = winRows.map(r => `<span class="jsb-bot-tag jsb-bot-tag--win">${r.play}/${fmtMoney2(r.amount)}</span>`).join('');
      return `<div class="jsb-bot-user"><div class="jsb-bot-user__head"><span class="jsb-bot-user__name">${name}</span><span class="jsb-bot-user__profit ${totalProfit >= 0 ? 'pos' : 'neg'}">${fmtProfit(totalProfit)}</span></div><div class="jsb-bot-user__tags">${tags}</div></div>`;
    }).join('') : '<div class="jsb-bot-empty">本期暂无中奖</div>';
    let mine = '';
    const myRows = settled && settled[user.name];
    if (myRows && myRows.length) {
      const myProfit = myRows.reduce((s, r) => s + r.profit, 0);
      const myWin = myRows.reduce((s, r) => s + r.winAmount, 0);
      const profitCls = myProfit >= 0 ? 'pos' : 'neg';
      const winText = myWin > 0 ? `中奖 +${fmtMoney2(myWin)}` : '未中奖';
      mine = `<div class="jsb-bot-mine-line ${profitCls}"><span class="jsb-bot-mine-line__label">您本期</span><span class="jsb-bot-mine-line__win">${winText}</span><span class="jsb-bot-mine-line__profit">输赢 ${fmtProfit(myProfit)}</span></div>`;
    }
    return `<div class="jsb-bot-card jsb-bot-card--win"><div class="jsb-bot-card__head"><span class="jsb-bot-card__title">中奖核对</span><span class="jsb-bot-card__issue">${issue}</span></div><div class="jsb-bot-card__body is-full">${body}</div>${mine}</div>`;
  }

  /** 用服务端派彩校正顶部输赢/流水（按期号去重后直接累加） */
  function refineUserStatsFromServer(issue, list) {
    const id = String(issue || '');
    if (!id) return;
    const bets = (list || []).filter(function (b) { return b && b.status !== 'CANCELLED' && b.status !== 'PENDING'; });
    if (!bets.length) return;
    const storeKey = 'jsb_stats_applied_' + (user && user.uid ? user.uid : 'guest');
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

  function ballHtml(n, cls) {
    const c = cls ? ` ${cls}` : '';
    const file = './assets/balls/ball-' + String(n).padStart(2, '0') + '.png?v=n2';
    return `<span class="jsb-ball${c}" data-n="${n}"><img class="jsb-ball__img" src="${file}" alt="${n}" loading="lazy"></span>`;
  }

  function renderCountdownDigits(sec) {
    const s = Math.max(0, Math.ceil(sec));
    const mm = pad(Math.floor(s / 60), 2);
    const ss = pad(s % 60, 2);
    const cells = $('#cdDigits .jsb-timer__cell');
    if (cells.length >= 4) {
      cells.eq(0).text(mm[0]);
      cells.eq(1).text(mm[1]);
      cells.eq(2).text(ss[0]);
      cells.eq(3).text(ss[1]);
    }
  }

  function fmtMmss(sec) {
    const s = Math.max(0, Math.floor(Number(sec) || 0));
    return pad(Math.floor(s / 60), 2) + ':' + pad(s % 60, 2);
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
    try { return JSON.parse(localStorage.getItem('jsb_stats_' + uid)) || { turnover: 0, winloss: 0, rebate: 0 }; } catch (e) { return { turnover: 0, winloss: 0, rebate: 0 }; }
  }
  function saveStats(uid, s) { localStorage.setItem('jsb_stats_' + uid, JSON.stringify(s)); }
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

  const HISTORY_SHOW = 10;

  function barSummaryHtml(row) {
    return `${row.gy.replace(/\s+/g, '')}<span class="sep">·</span>${row.lh}`;
  }

  /** 顶栏显示期号（服务端日切 MMDD+序号；有同步用服务端） */
  function formatBarIssue(issue) {
    const s = String(issue || '');
    return s || '------';
  }

  function renderDrawBar(row) {
    if (!row) return;
    const full = String(row.issue || '');
    $('#barIssue').text(formatBarIssue(full)).attr('title', full || '');
    $('#barBalls').html(row.nums.map(n => ballHtml(n, 'xs')).join(''));
    $('#barSummary').html(row.nums.length ? barSummaryHtml(row) : '等待开奖');
  }

  function flashDrawBarReveal() {
    const $bar = $('#drawBar');
    $bar.removeClass('is-reveal');
    void $bar[0].offsetWidth;
    $bar.addClass('is-reveal');
    setTimeout(() => $bar.removeClass('is-reveal'), 900);
  }

  function renderDrawTable() {
    $('#drawTableBody').html(historyRows.slice(0, HISTORY_SHOW).map(r => `
      <tr><td class="jsb-draw-table__issue">${r.issue}</td>
      ${r.nums.map(n => `<td>${ballHtml(n, 'tbl')}</td>`).join('')}
      <td class="cell-gy">${r.gy.replace(/\s+/g, '')}</td><td class="cell-lh">${r.lh}</td></tr>`).join(''));
  }

  /* 官网 xingyft → jisuft_video/index.html；时长不压缩 */
  const PK10_RACE_SRC = './media/pk10-race/index.html?v=16&embed=1';
  const PK10_RACE_COUNTDOWN_SEC = 3;
  const PK10_RACE_MID_MS = 8000;
  const PK10_RACE_AFTER_FINISH_MS = 6000;
  /** finishgame 内冲线画面（与 race-host FINISH_VISUAL_MS / flashlight 对齐） */
  const PK10_RACE_FINISH_VISUAL_MS = 3300;
  /** 绿灯竞速只允许拉长对齐 openAt，禁止缩短（缩短会早 finishgame、画面未冲线） */
  const PK10_RACE_MID_MAX_MS = Math.max(
    PK10_RACE_MID_MS,
    PREP_SEC * 1000 - PK10_RACE_COUNTDOWN_SEC * 1000 - PK10_RACE_FINISH_VISUAL_MS - 500
  );
  const PK10_RACE_NATIVE_W = 1334;
  const PK10_RACE_NATIVE_H = 780;

  function pk10RaceOrderStr(nums) {
    return (nums || []).map(function (n) { return String(Number(n)); }).join(',');
  }

  function resultRevealDurationMs() {
    return (
      PK10_RACE_COUNTDOWN_SEC * 1000 +
      PK10_RACE_MID_MS +
      PK10_RACE_AFTER_FINISH_MS
    );
  }

  function resultCardHtml(nums, issue, opts) {
    opts = opts || {};
    const meta = gyMeta(nums);
    const lh = lhRow(nums);
    const gyText = String(meta.text || '').replace(/\s+/g, ' ').trim();
    const order = pk10RaceOrderStr(nums);
    const issueShow = String(issue || '').trim();
    const settled = !!opts.settle;
    let srcQ = PK10_RACE_SRC;
    if (issueShow) srcQ += '&issue=' + encodeURIComponent(issueShow);
    if (order) srcQ += '&order=' + encodeURIComponent(order);
    if (settled) srcQ += '&settle=1';
    return (
      '<div class="jsb-race-card' + (settled ? ' is-reveal is-settled' : ' is-drawing') +
        '" data-issue="' + issueShow + '" data-nums="' + order +
        '" data-gy="' + gyText + '" data-lh="' + lh + '">' +
        '<div class="jsb-race-card__stage">' +
          '<iframe class="jsb-race-card__frame" title="幸运飞艇开奖动画" src="' + srcQ +
            '" data-nums="' + order + '" data-issue="' + issueShow + '" allow="autoplay" loading="eager"></iframe>' +
        '</div>' +
        '<footer class="jsb-race-card__foot' + (settled ? ' is-show' : ' is-hidden') + '">' +
          '<div class="jsb-race-card__pill"><span class="k">冠亚和</span><span class="v jsb-race-card__gy">' +
            (settled ? gyText : '—') + '</span></div>' +
          '<div class="jsb-race-card__pill"><span class="k">1-5龙虎</span><span class="v jsb-race-card__lh">' +
            (settled ? lh : '—') + '</span></div>' +
        '</footer>' +
      '</div>'
    );
  }

  function revealRaceCardFoot(card, nums, opts) {
    if (!card) return;
    opts = opts || {};
    let gy = String(card.getAttribute('data-gy') || '').trim();
    let lh = String(card.getAttribute('data-lh') || '').trim();
    if (Array.isArray(nums) && nums.length === 10) {
      gy = String(gyMeta(nums).text || '').replace(/\s+/g, ' ').trim();
      lh = lhRow(nums);
      card.setAttribute('data-gy', gy);
      card.setAttribute('data-lh', lh);
    }
    const gyEl = card.querySelector('.jsb-race-card__gy');
    const lhEl = card.querySelector('.jsb-race-card__lh');
    if (gyEl && gy) gyEl.textContent = gy;
    if (lhEl && lh) lhEl.textContent = lh;
    const foot = card.querySelector('.jsb-race-card__foot');
    if (foot) {
      foot.classList.remove('is-hidden');
      foot.classList.add('is-show');
    }
    card.classList.remove('is-drawing', 'is-hold-black');
    /* 直播播完勿再加 is-reveal：入场动画会整卡从透明淡入，像闪一下 */
    card.classList.add('is-settled');
    if (!opts.noEnterAnim) card.classList.add('is-reveal');
    card.removeAttribute('data-hold-black');
    card._holdBlackExempt = true;
    if (window.LotteryHoldTip) LotteryHoldTip.clear(card);
  }

  function fitRaceFrame(card) {
    if (!card) return;
    const stage = card.querySelector('.jsb-race-card__stage');
    const frame = card.querySelector('.jsb-race-card__frame');
    if (!stage || !frame) return;
    const w = stage.clientWidth || stage.offsetWidth || 0;
    const h = stage.clientHeight || stage.offsetHeight || 0;
    if (w < 8 || h < 8) return;
    const s = Math.min(w / PK10_RACE_NATIVE_W, h / PK10_RACE_NATIVE_H);
    frame.style.transform = 'scale(' + s + ')';
    frame.style.left = ((w - PK10_RACE_NATIVE_W * s) / 2) + 'px';
    frame.style.top = ((h - PK10_RACE_NATIVE_H * s) / 2) + 'px';
    card.classList.add('is-frame-ready');
  }

  function postToRaceFrame(frame, payload) {
    if (!frame || !frame.contentWindow) return false;
    try {
      frame.contentWindow.postMessage(
        Object.assign({ source: 'jsb-pk10-race' }, payload || {}), location.origin);
      return true;
    } catch (e) {
      return false;
    }
  }

  function whenRaceFrameReady(frame, cb) {
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
    /* 必须等 iframe boot（__ready / ready 消息），不能仅凭 API 对象存在就 play */
    const isBooted = function () {
      try {
        const api = frame.contentWindow && frame.contentWindow.JsbPk10Race;
        return !!(api && api.__ready && typeof api.play === 'function');
      } catch (e) {
        return false;
      }
    };
    const onMsg = function (ev) {
      const d = ev && ev.data;
      if (!d || d.source !== 'jsb-pk10-race') return;
      if (d.action === 'ready' && ev.source === frame.contentWindow && isBooted()) finish(true);
    };
    window.addEventListener('message', onMsg);
    if (isBooted()) {
      finish(true);
      return;
    }
    frame.addEventListener('load', function () {
      setTimeout(function () { if (isBooted()) finish(true); }, 80);
    });
    let n = 0;
    pollTimer = setInterval(function () {
      n += 1;
      if (isBooted()) finish(true);
      else if (n >= 80) finish(false);
    }, 50);
  }

  function raceCardIssue(card, opts) {
    if (opts && opts.issue != null && String(opts.issue).trim()) return String(opts.issue).trim();
    return String((card && card.getAttribute('data-issue')) || '').trim();
  }

  function playRaceCard(card, nums, opts) {
    opts = opts || {};
    const frame = card && card.querySelector('.jsb-race-card__frame');
    const order = pk10RaceOrderStr(nums);
    const issue = raceCardIssue(card, opts);
    if (!frame || !order) {
      if (typeof opts.onDone === 'function') opts.onDone(false);
      return;
    }
    /* 标记播放中，防止 snapshot 的 settleRestored 把直播动画强制 settle 掉 */
    card.classList.remove('is-hold-black');
    if (window.LotteryHoldTip) LotteryHoldTip.clear(card);
    card.removeAttribute('data-hold-black');
    card.setAttribute('data-playing', '1');
    card._jsbLiveAnim = true;
    fitRaceFrame(card);
    card.classList.add('is-playing');
    requestAnimationFrame(function () {
      fitRaceFrame(card);
      card.classList.add('is-playing');
    });
    card._jsbNumsNotified = false;
    card._jsbDoneOnce = false;
    whenRaceFrameReady(frame, function (ready) {
      fitRaceFrame(card);
      const onNumbersReady = function () {
        if (card._jsbNumsNotified) return;
        card._jsbNumsNotified = true;
        if (typeof notifyDrawBarNumbersReady === 'function') {
          notifyDrawBarNumbersReady(issue, nums, 10);
        }
      };
      const onMsg = function (ev) {
        const d = ev && ev.data;
        if (!d || d.source !== 'jsb-pk10-race' || d.action !== 'finish') return;
        if (ev.source !== frame.contentWindow) return;
        onNumbersReady();
      };
      const doneWrap = function (ok) {
        if (card._jsbDoneOnce) return;
        card._jsbDoneOnce = true;
        window.removeEventListener('message', onMsg);
        /*
         * 先标 is-settled 再摘 is-playing，避免中间一帧 iframe 被 CSS 藏掉；
         * 直播收尾禁止 is-reveal 入场动画（否则领奖台再淡入一次）。
         */
        card.classList.add('is-settled', 'is-frame-ready');
        revealRaceCardFoot(card, nums, { noEnterAnim: true });
        card.classList.remove('is-playing', 'is-hold-black', 'is-drawing');
        if (window.LotteryHoldTip) LotteryHoldTip.clear(card);
        card.removeAttribute('data-playing');
        card.removeAttribute('data-hold-black');
        card._jsbLiveAnim = false;
        card._jsbPlayedLive = true;
        card._jsbSettled = true;
        card._holdBlackExempt = true;
        onNumbersReady();
        /* 领奖台尾段播完：再开盘线 + 顶栏倒计时 */
        if (typeof notifyDrawCeremonyReady === 'function') {
          notifyDrawCeremonyReady(issue);
        }
        if (window.JsbAudio && JsbAudio.endRaceCeremony) JsbAudio.endRaceCeremony();
        if (typeof opts.onDone === 'function') opts.onDone(ok);
      };
      if (!ready) {
        /* iframe 未就绪：软落定 + 同步，避免空跑定时、脚出了动画还停起点 */
        card.classList.remove('is-playing');
        card.removeAttribute('data-playing');
        card._jsbLiveAnim = false;
        try { settleRaceCard(card, nums); } catch (e) { /* ignore */ }
        onNumbersReady();
        if (typeof notifyDrawCeremonyReady === 'function') {
          notifyDrawCeremonyReady(issue);
        }
        card._jsbDoneOnce = true;
        card._holdBlackExempt = true;
        if (window.JsbAudio && JsbAudio.endRaceCeremony) JsbAudio.endRaceCeremony();
        if (typeof opts.onDone === 'function') opts.onDone(false);
        return;
      }
      window.addEventListener('message', onMsg);
      const cdSec = opts.countdownSec != null ? Number(opts.countdownSec) : PK10_RACE_COUNTDOWN_SEC;
      let midMs = opts.midRaceMs != null ? Number(opts.midRaceMs) : PK10_RACE_MID_MS;
      let afterMs = opts.afterFinishMs != null ? Number(opts.afterFinishMs) : PK10_RACE_AFTER_FINISH_MS;
      const finishVisualMs = opts.finishVisualMs != null ? Number(opts.finishVisualMs) : PK10_RACE_FINISH_VISUAL_MS;
      /*
       * 出号点 = finishgame 调用 + 冲线画面。
       * mid 只许拉长对齐 openAt，不许缩短（缩短会提前 finishgame，历史早于冲线）。
       */
      if (opts.midRaceMs == null && serverCurrent && String(serverCurrent.issueNo || '') === String(issue || '')) {
        const openAt = new Date(serverCurrent.openAt).getTime();
        if (Number.isFinite(openAt)) {
          const remain = openAt - srvNow();
          const cdMs = Math.max(0, cdSec) * 1000;
          const targetMid = remain - cdMs - finishVisualMs - 200;
          if (Number.isFinite(targetMid) && targetMid >= PK10_RACE_MID_MS) {
            midMs = Math.min(PK10_RACE_MID_MAX_MS, targetMid);
          }
        }
      }
      const numbersAtMs = Math.max(0, cdSec) * 1000 + Math.max(0, midMs) + Math.max(0, finishVisualMs);
      const totalMs = Math.max(0, cdSec) * 1000 + Math.max(0, midMs) + Math.max(0, afterMs);
      /* 兜底从真正开播起算，避免 iframe ready 慢时提前 forceSettle */
      try {
        if (roomChat && typeof roomChat.scheduleRevealReady === 'function') {
          let armMs = Math.max(totalMs, numbersAtMs) + 1200;
          if (serverCurrent && String(serverCurrent.issueNo || '') === String(issue || '')) {
            const openAt = new Date(serverCurrent.openAt).getTime();
            if (Number.isFinite(openAt)) {
              armMs = Math.max(armMs, openAt - srvNow() + 1200);
            }
          }
          roomChat.scheduleRevealReady(issue, armMs);
        }
      } catch (eArm) { /* ignore */ }
      try {
        if (window.JsbAudio && JsbAudio.startRaceCeremony) {
          if (JsbAudio.unlock) JsbAudio.unlock();
          JsbAudio.startRaceCeremony({
            countdownSec: cdSec,
            midRaceMs: midMs,
            afterFinishMs: afterMs,
            finishVisualMs: finishVisualMs,
          });
        }
      } catch (eAudio) { /* 音效失败不得阻断开奖动画 */ }
      const w = frame.contentWindow;
      if (w && w.JsbPk10Race && typeof w.JsbPk10Race.play === 'function') {
        try {
          w.JsbPk10Race.play(order, {
            issue: issue,
            countdownSec: cdSec,
            midRaceMs: midMs,
            afterFinishMs: afterMs,
            finishVisualMs: finishVisualMs,
            onFinish: onNumbersReady,
            onDone: doneWrap,
          });
          return;
        } catch (ePlay) { /* 改走 postMessage */ }
      }
      postToRaceFrame(frame, {
        action: 'play',
        order: order,
        issue: issue,
        countdownSec: cdSec,
        midRaceMs: midMs,
        afterFinishMs: afterMs,
        finishVisualMs: finishVisualMs,
      });
      setTimeout(onNumbersReady, numbersAtMs);
      setTimeout(function () { doneWrap(true); }, totalMs || resultRevealDurationMs());
    });
  }

  /**
   * 软落定：只调 iframe API + 露脚，禁止改 src。
   * 改 src 加 settle=1 会整页重载，冲线后再闪一下/掐领奖台。
   */
  function settleRaceCard(card, nums) {
    if (card && (card.classList.contains('is-playing') || card.getAttribute('data-playing') === '1' || card._jsbLiveAnim)) {
      return; /* 竞速中禁止打断 */
    }
    /* 本页已完整播过：只保证脚注/可见，勿再调 iframe settle（会重跑领奖台） */
    if (card && card._jsbPlayedLive) {
      revealRaceCardFoot(card, nums, { noEnterAnim: true });
      card.classList.add('is-settled', 'is-frame-ready');
      card._jsbSettled = true;
      card._holdBlackExempt = true;
      fitRaceFrame(card);
      return;
    }
    const alreadySettled = !!(card && (card._jsbSettled || card.classList.contains('is-settled')));
    if (card) {
      card.removeAttribute('data-hold-black');
      card.classList.remove('is-hold-black', 'is-drawing');
      if (window.LotteryHoldTip) LotteryHoldTip.clear(card);
    }
    revealRaceCardFoot(card, nums, alreadySettled ? { noEnterAnim: true } : null);
    if (card) {
      card._jsbSettled = true;
      card._holdBlackExempt = true;
    }
    fitRaceFrame(card);
    requestAnimationFrame(function () { fitRaceFrame(card); });
    if (alreadySettled) return;
    const frame = card && card.querySelector('.jsb-race-card__frame');
    let order = '';
    if (Array.isArray(nums) && nums.length === 10) order = pk10RaceOrderStr(nums);
    else order = String((card && card.getAttribute('data-nums')) || (frame && frame.getAttribute('data-nums')) || '').trim();
    const issue = raceCardIssue(card, null);
    if (!frame || !order) return;
    whenRaceFrameReady(frame, function () {
      fitRaceFrame(card);
      const w = frame.contentWindow;
      if (w && w.JsbPk10Race && typeof w.JsbPk10Race.settle === 'function') {
        w.JsbPk10Race.settle(order, { issue: issue });
        return;
      }
      postToRaceFrame(frame, { action: 'settle', order: order, issue: issue });
    });
  }

  function isServerDrawingIssue(issue) {
    issue = String(issue || '').trim();
    if (!issue || !serverCurrent) return false;
    if (String(serverCurrent.issueNo || '') !== issue) return false;
    const st = String(serverCurrent.status || '');
    const lockAt = new Date(serverCurrent.lockAt).getTime();
    const now = srvNow();
    return st === 'LOCKED' || (st === 'PENDING' && Number.isFinite(lockAt) && now >= lockAt);
  }

  function holdBlackRaceCard(card) {
    if (!card) return false;
    if (card.classList.contains('is-playing') || card.getAttribute('data-playing') === '1' || card._jsbLiveAnim) return false;
    /* 本页已播完/揭晓：禁止快照再压黑（否则会 setRevealPending 清掉 winFlushed，卡住开盘线） */
    if (card._holdBlackExempt || card._jsbSettled || card.classList.contains('is-settled') || card.classList.contains('is-reveal')) return false;
    if (card.getAttribute('data-hold-black') === '1' && card.classList.contains('is-hold-black')) {
      if (window.LotteryHoldTip) LotteryHoldTip.ensure(card, '.jsb-race-card__stage');
      return true;
    }

    card.setAttribute('data-hold-black', '1');
    card._jsbSettled = false;
    card.classList.remove('is-reveal', 'is-settled', 'is-result-shown', 'is-frame-ready');
    card.classList.add('is-drawing', 'is-hold-black');
    const foot = card.querySelector('.jsb-race-card__foot');
    if (foot) {
      foot.classList.add('is-hidden');
      foot.classList.remove('is-show');
    }
    const gyEl = card.querySelector('.jsb-race-card__gy');
    const lhEl = card.querySelector('.jsb-race-card__lh');
    if (gyEl) gyEl.textContent = '—';
    if (lhEl) lhEl.textContent = '—';
    /* 压黑只藏画面，不改 iframe.src，避免重载露出放大 Logo */
    if (window.LotteryHoldTip) LotteryHoldTip.ensure(card, '.jsb-race-card__stage');
    return true;
  }

  /** 刷新/重进：开奖中压黑幕，避免泄底 */
  function holdBlackLockedRaceCards() {
    if (!serverCurrent) return;
    const issue = String(serverCurrent.issueNo || '').trim();
    if (!issue || !isServerDrawingIssue(issue)) return;
    let newlyHeld = false;
    $('#chatFeed .jsb-race-card, #chatDock .jsb-race-card').each(function () {
      const card = this;
      if (String(card.getAttribute('data-issue') || '').trim() !== issue) return;
      const frame = card.querySelector('.jsb-race-card__frame');
      const src = frame ? String(frame.getAttribute('src') || '') : '';
      if (card.getAttribute('data-hold-black') === '1' && card.classList.contains('is-hold-black') && src.indexOf('settle=1') < 0) return;
      if (holdBlackRaceCard(card)) newlyHeld = true;
    });
    if (!newlyHeld || !roomChat) return;
    /* 仪式已过揭晓/已在等开盘：勿重置 revealDone/winFlushed */
    if (roomChat.isRevealReady && roomChat.isRevealReady(issue)) return;
    if (typeof roomChat.getPhase === 'function' && roomChat.getPhase() === 'settled') return;
    if (typeof roomChat.beginCeremonyHold === 'function') roomChat.beginCeremonyHold(issue);
    if (typeof roomChat.setRevealPending === 'function') roomChat.setRevealPending(issue);
    const openAt = new Date(serverCurrent.openAt).getTime();
    const readyMs = resultRevealDurationMs() + 1400;
    const remain = Number.isFinite(openAt)
      ? Math.max(1200, openAt - srvNow() + 600)
      : readyMs;
    if (typeof roomChat.scheduleRevealReady === 'function') {
      roomChat.scheduleRevealReady(issue, Math.min(remain, readyMs + 400));
    }
  }

  const CHAT_KEEP = 50;
  const chatLog = [];

  function chatStorageKey() {
    const uid = (user && user.uid) ? user.uid : 'guest';
    return 'jsb_chat_v3_' + uid + (roomNo ? '_' + roomNo : '');
  }
  function saveChatLog() {
    try { localStorage.setItem(chatStorageKey(), JSON.stringify(chatLog.slice(-CHAT_KEEP))); } catch (e) { /* ignore */ }
  }
  function trimChatDom() {
    const $msgs = $('#chatFeed > .jsb-msg');
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
    const avatar = opts.avatarHtml || `<div class="jsb-msg__avatar"><img src="${fixAvatar(opts.avatar)}" alt=""></div>`;
    const metaOther = `<div class="jsb-msg__meta"><span class="jsb-msg__name">${escapeHtml(opts.name)}</span><span class="jsb-msg__time">${escapeHtml(time)}</span></div>`;
    const metaSelf = `<div class="jsb-msg__meta"><span class="jsb-msg__time">${escapeHtml(time)}</span><span class="jsb-msg__name">${escapeHtml(opts.name)}</span></div>`;
    const bubbleCls = opts.robot ? 'jsb-msg__bubble jsb-msg__bubble--bot' : 'jsb-msg__bubble';
    const bubble = `<div class="${bubbleCls}">${opts.html}</div>`;
    const html = opts.self
      ? `<div class="jsb-msg is-self"><div class="jsb-msg__top">${metaSelf}${avatar}</div>${bubble}</div>`
      : `<div class="jsb-msg${opts.robot ? ' is-robot' : ''}">${avatar}<div class="jsb-msg__body">${metaOther}${bubble}</div></div>`;
    if (opts.dock) {
      const $dock = $('#chatDock');
      if ($dock.length) { $dock.prop('hidden', false).append(html); }
      else $('#chatFeed').append(html);
    } else {
      $('#chatFeed').append(html);
    }
    if (!opts.skipPersist) {
      chatLog.push({ name: opts.name, avatar: opts.avatar || '', html: opts.html, self: !!opts.self, robot: !!opts.robot, time });
      if (chatLog.length > CHAT_KEEP) chatLog.splice(0, chatLog.length - CHAT_KEEP);
      trimChatDom();
      saveChatLog();
    }
    scrollChat();
  }

  function restoreChat() {
    let list = [];
    try { list = JSON.parse(localStorage.getItem(chatStorageKey()) || '[]'); } catch (e) { list = []; }
    if (!Array.isArray(list) || !list.length) return false;
    chatLog.length = 0;
    $('#chatFeed').empty();
    list.slice(-CHAT_KEEP).forEach((m) => {
      if (!m || !m.html) return;
      appendMsg({ name: m.name || '玩家', avatar: m.avatar || '', html: m.html, self: !!m.self, robot: !!m.robot, time: m.time || '', skipPersist: true });
      chatLog.push({ name: m.name || '玩家', avatar: m.avatar || '', html: m.html, self: !!m.self, robot: !!m.robot, time: m.time || '' });
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
      const $card = $('#chatFeed').find('.' + "jsb" + '-bot-card--win').filter(function () {
        return String($(this).find('.' + "jsb" + '-bot-card__issue').text() || '').trim() === issue;
      }).last().closest('[class*="-msg"]');
      if (!$card.length) return;
      const $bubble = $card.find('[class*="msg__bubble"]').first();
      let h = $bubble.html() || '';
      h = applyMineLineToWinHtml(h, mine);
      $bubble.html(h);
    }).catch(function () {});
  }

  function buildBetVerifyFromPayload(p) {
    return LotteryRoomChat.buildBetVerifyHtml("jsb", p, {
      escapeHtml: typeof escapeHtml === 'function' ? escapeHtml : undefined,
      userName: user.name,
    });
  }

  function buildWinVerifyFromPayload(p) {
    return LotteryRoomChat.buildWinVerifyHtml("jsb", p, {
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
  /** 揭晓到点 / 切页回来：强制终态，不补播 */
  function forceSettleResultCard(issue) {
    issue = String(issue || '').trim();
    $('#chatFeed .jsb-race-card, #chatDock .jsb-race-card').each(function () {
      const card = this;
      if (issue && String(card.getAttribute('data-issue') || '').trim() !== issue) return;
      /* 竞速/领奖台仍在播：勿掐动画，只保证脚注；仪式在 onDone 再推进 */
      if (card.classList.contains('is-playing') || card.getAttribute('data-playing') === '1' || card._jsbLiveAnim) {
        let numsPlay = null;
        const rawPlay = String(card.getAttribute('data-nums') || '').trim();
        if (rawPlay) {
          const arrP = rawPlay.split(',').map(Number);
          if (arrP.length === 10) numsPlay = arrP;
        }
        revealRaceCardFoot(card, numsPlay, { noEnterAnim: true });
        card._holdBlackExempt = true;
        return;
      }
      card.classList.remove('is-playing');
      card.removeAttribute('data-playing');
      card._jsbLiveAnim = false;
      let nums = null;
      const raw = String(card.getAttribute('data-nums') || '').trim();
      if (raw) {
        const arr = raw.split(',').map(Number);
        if (arr.length === 10) nums = arr;
      }
      settleRaceCard(card, nums);
      card._jsbSettled = true;
      card._holdBlackExempt = true;
      if (typeof persistBotCardHtml === 'function') persistBotCardHtml(card);
    });
  }

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
      if (typeof resultCardHtml !== 'function') return '开奖 ' + issue;
      /* 历史先进黑卡，避免先进房泄底再压黑 */
      const settle = !!(
        ctx &&
        ctx.live &&
        !ctx.animate &&
        !(typeof isServerDrawingIssue === 'function' && isServerDrawingIssue(issue))
      );
      return resultCardHtml(nums, issue, { settle: settle });
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
      if (nums.length) lastDraw = nums.slice();
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
        prefix: "jsb",
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
        if (window.JsbAudio && JsbAudio.onBetting) JsbAudio.onBetting();
        if (typeof requestLotteryResync === 'function') requestLotteryResync();
        else if (typeof syncServerSnapshot === 'function') syncServerSnapshot();
        if (typeof tick === 'function') try { tick(); } catch (e) { /* ignore */ }
      } else if (phase === 'drawing' || phase === 'revealing' || phase === 'settled') {
        roomBetFrozen = true;
        if (window.JsbAudio && JsbAudio.onDrawing) JsbAudio.onDrawing();
        if (typeof tick === 'function') try { tick(); } catch (e) { /* ignore */ }
      }
    },
    onCeremonyComplete: function () {
      roomBetFrozen = false;
      sealedIssueNo = '';
      if (window.JsbAudio && JsbAudio.onBetting) JsbAudio.onBetting();
      /* 开盘线已出：立刻拉下一期快照，避免顶栏继续卡在上一期「开奖中」 */
      if (typeof requestLotteryResync === 'function') requestLotteryResync();
      else if (typeof syncServerSnapshot === 'function') syncServerSnapshot();
      if (typeof tick === 'function') try { tick(); } catch (e) { /* ignore */ }
    },

    afterResultAppended: function (ctx) {
      const issue = ctx.issue;
      const nums = Array.isArray(ctx.payload.nums) ? ctx.payload.nums.map(Number) : [];
      const issueKey = String(issue || '').trim();
      const $cards = $(
        '#chatDock .jsb-race-card, #chatFeed .jsb-race-card, #chatDock .jsb-result-card, #chatFeed .jsb-result-card'
      );
      const card = (issueKey
        ? $cards.filter(function () {
            return String(this.getAttribute('data-issue') || '').trim() === issueKey;
          })
        : $cards
      ).last()[0] || $cards.last()[0];
      const readyMs = resultRevealDurationMs() + 800;
      if (card && card.classList.contains('jsb-race-card')) {
        if (ctx.animate && ctx.live && nums.length === 10) {
          ctx.setRevealPending(issue);
          playRaceCard(card, nums, {
            issue: issueKey,
            onDone: function () {
              card._jsbLiveAnim = false;
              card._jsbSettled = true;
              card._holdBlackExempt = true;
              if (typeof persistBotCardHtml === 'function') persistBotCardHtml(card);
            },
          });
          /* scheduleRevealReady 改在 play 真正开播后武装（见 playRaceCard） */
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
            holdBlackRaceCard(card);
            ctx.setRevealPending(issue);
            const openAt = serverCurrent && new Date(serverCurrent.openAt).getTime();
            const remain = Number.isFinite(openAt)
              ? Math.max(1200, openAt - srvNow() + 600)
              : readyMs;
            ctx.scheduleRevealReady(issue, Math.min(remain, readyMs + 400));
          } else {
            settleRaceCard(card, nums.length === 10 ? nums : null);
            card._jsbSettled = true;
            ctx.setRevealReadyFlag(issue, true);
          }
        } else {
          /* 历史回放：保持黑卡，等 snapshot holdBlack */
          ctx.setRevealReadyFlag(issue, true);
          if (typeof holdBlackLockedRaceCards === 'function') {
            setTimeout(function () { try { holdBlackLockedRaceCards(); } catch (eR) { /* ignore */ } }, 0);
          }
        }
        return;
      }
      if (card && window.JsbResultCard && JsbResultCard.bindStage) {
        if (ctx.animate && ctx.live) {
          ctx.setRevealPending(issue);
          card._jsbLiveAnim = true;
          JsbResultCard.bindStage(card, function () {
            card._jsbLiveAnim = false;
            card._jsbSettled = true;
            setTimeout(function () {
              if (typeof persistBotCardHtml === 'function') persistBotCardHtml(card);
            }, 1000);
          }, { durationMs: Math.max(5000, ((typeof PREP_SEC === 'number' ? PREP_SEC : 10) - 2) * 1000) });
          ctx.scheduleRevealReady(issue, readyMs);
        } else {
          JsbResultCard.bindStage(card, function () {
            card._jsbSettled = true;
            if (typeof persistBotCardHtml === 'function') persistBotCardHtml(card);
          });
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
      return resultRevealDurationMs() + 1200;
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

  /** 动画落定后写回 chatLog（iframe 内状态靠进房 settle 恢复） */
  function persistBotCardHtml(card) {
    if (!card || !chatLog.length) return;
    const issue = String(card.getAttribute('data-issue') || '').trim();
    /*
     * 只改写入 chatLog 的 HTML 字符串，加上 settle=1。
     * 禁止改直播 iframe.src：否则冲线后再整页重载会闪一下。
     */
    let html = card.outerHTML;
    if (card.classList.contains('jsb-race-card')) {
      html = html.replace(
        /(<iframe[^>]*class="[^"]*jsb-race-card__frame[^"]*"[^>]*src=")([^"]+)(")/,
        function (_m, a, src, c) {
          let next = String(src || '');
          if (next.indexOf('settle=1') < 0) next += (next.indexOf('?') >= 0 ? '&' : '?') + 'settle=1';
          return a + next + c;
        }
      );
      if (html.indexOf('is-frame-ready') < 0) {
        html = html.replace('jsb-race-card ', 'jsb-race-card is-frame-ready ');
      }
      if (html.indexOf('is-settled') < 0) {
        html = html.replace('jsb-race-card ', 'jsb-race-card is-settled ');
      }
    }
    for (let i = chatLog.length - 1; i >= 0; i--) {
      const m = chatLog[i];
      if (!m || !m.robot) continue;
      if (!/(jsb-race-card|jsb-result-card)/.test(String(m.html || ''))) continue;
      if (issue && String(m.html).indexOf(issue) < 0) continue;
      m.html = html;
      saveChatLog();
      break;
    }
  }

  /** 进房/同步后：竞速卡瞬落领奖台；旧 Canvas 卡仍走 bindStage */
  function settleRestoredResultCards() {
    const holdIssue = (roomChat && typeof roomChat.getCeremonyHoldIssue === 'function')
      ? String(roomChat.getCeremonyHoldIssue() || '').trim()
      : '';
    const phaseIssue = (roomChat && typeof roomChat.getPhaseIssue === 'function')
      ? String(roomChat.getPhaseIssue() || '').trim()
      : '';
    $('#chatFeed .jsb-race-card').each(function () {
      const card = this;
      if (card._jsbLiveAnim || card._jsbSettled) return;
      if (card.classList.contains('is-playing') || card.getAttribute('data-playing') === '1') return;
      const issue = String(card.getAttribute('data-issue') || '').trim();
      if (issue && isServerDrawingIssue(issue)) return;
      /* 当期开奖仪式中的卡：交给 playRaceCard，禁止被 snapshot 强制 settle */
      if (issue && ((holdIssue && issue === holdIssue) || (phaseIssue && issue === phaseIssue))) {
        if (isCeremonyHolding()) return;
      }
      settleRaceCard(card, null);
      card._jsbSettled = true;
    });
    if (!window.JsbResultCard || !JsbResultCard.bindStage) return;
    $('#chatFeed .jsb-result-card').each(function () {
      const card = this;
      if (card._jsbLiveAnim || card._jsbSettled) return;
      const canvas = card.querySelector('.jsb-rc-canvas');
      if (!canvas || !canvas.dataset.nums) return;
      card.classList.remove('is-drawing');
      card.classList.add('is-reveal');
      JsbResultCard.bindStage(card, function () {
        card._jsbSettled = true;
        persistBotCardHtml(card);
      });
    });
  }

  $(window).on('resize.jsbRaceCard', function () {
    $('#chatFeed .jsb-race-card, #chatDock .jsb-race-card').each(function () {
      fitRaceFrame(this);
    });
  });

  function startRoomChatPolling() {
    roomChat.startPolling();
  }

  function closeNoticeHtml(issue) {
    return `<div class="jsb-bot-close-line"><div class="jsb-bot-close-line__bar"><span class="jsb-bot-close-line__deco"></span><span class="jsb-bot-close-line__text">封 盘 线</span><span class="jsb-bot-close-line__deco"></span></div><div class="jsb-bot-close-line__sub">第 <span class="jsb-bot-close-line__issue">${issue}</span> 期 · 停止下注 · 即将开奖</div></div>`;
  }
  function openNoticeHtml(issue) {
    return `<div class="jsb-bot-open-line">
      <div class="jsb-bot-open-line__bar">
        <span class="jsb-bot-open-line__deco"></span>
        <span class="jsb-bot-open-line__text">开 盘 线</span>
        <span class="jsb-bot-open-line__deco"></span>
      </div>
      <div class="jsb-bot-open-line__sub">第 <span class="jsb-bot-open-line__issue">${issue}</span> 期 · 开始下注</div>
    </div>`;
  }

  function initKeypad() {
    const left = ['大', '小', '单', '双'];
    const right = ['删除', '龙', '虎', '冠亚'];
    const mid = [['1', '2', '3'], ['4', '5', '6'], ['7', '8', '9'], ['和', '0', '/']];
    let html = '';
    for (let r = 0; r < 4; r++) {
      html += `<button type="button" class="jsb-key jsb-key--side" data-key="${left[r]}">${left[r]}</button>`;
      mid[r].forEach(k => { html += `<button type="button" class="jsb-key" data-key="${k}">${k}</button>`; });
      const rk = right[r];
      const cls = rk === '删除' ? ' jsb-key--del' : (rk === '冠亚' ? ' jsb-key--gy' : ' jsb-key--side');
      html += `<button type="button" class="jsb-key${cls}" data-key="${rk}">${rk}</button>`;
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
    const $room = $('.jsb-room');
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
    if (text === '删除') { $in.val(v.slice(0, -1)); updateComposerAction(); return; }
    if (text === '空格') { $in.val(v + ' '); return; }
    if (text === '冠亚') { $in.val(v + '冠亚'); return; }
    $in.val(appendKeyWithSlash(v, text));
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
      clearUserPendingBetLog(issue);
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
    if (!isBettingOpen()) { toastBetBlocked('bet'); return; }
    let lines;
    if (composerAllin) {
      composerAllin = false;
      const parts = text.split(/\s+/).filter(Boolean);
      const allPlays = [];
      for (let i = 0; i < parts.length; i++) {
        const stripped = parts[i].replace(/\/(\d+|梭哈|全下|allin)$/i, '').replace(/\/$/, '');
        let plays = expandPlayPart(stripped);
        if (!plays || !plays.length) {
          const via = parseBetLines(stripped + '/梭哈');
          if (via && via.length) plays = via.map(function (l) { return l.play; });
        }
        if (!plays || !plays.length) { App.toast('格式错误'); return; }
        allPlays.push.apply(allPlays, plays);
      }
      lines = resolveBetAmounts(allPlays, '梭哈');
      if (!lines) { App.toast('余额不足，无法梭哈'); return; }
    } else {
      lines = parseBetInput(text);
      if (!lines) {
        App.toast('格式：12345单/100、1龙/100、冠亚和12/100、12345/12345/100');
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
    App.placeLotteryBets(SERVER_GAME, mapped.bets, { chatText: text.replace(/\s+/g, ' ') }).then(function () {
      refreshStats();
      const display = lines.length > 1 ? formatResolvedBets(lines) : text.replace(/\s+/g, ' ');
      syncRoomChat(false);
      lines.forEach(function (l) { recordBetLine(user.name, l.play, l.amount); });
      lastBetText = formatResolvedBets(lines);
      $('#chatInput').val('');
      updateComposerAction();
      if (lines.length > 1) App.toast('投注成功 · ' + lines.length + '注');
    }).catch(function (e) {
      App.toast((e && e.message) || '下注失败');
    });
  }

  function repeatLastBet() {
    if (!lastBetText) {
      App.toast('暂无上次投注');
      return;
    }
    /* 只填入聊天栏，是否发送由玩家自行点发送 */
    composerAllin = false;
    $('#chatInput').val(lastBetText);
    updateComposerAction();
  }

  function setDrawPanelOpen(open) {
    drawPanelOpen = !!open;
    $('#drawBar').toggleClass('is-open', drawPanelOpen);
    layoutRail();
    setTimeout(layoutRail, 360);
    $('#drawToggle').attr('aria-expanded', drawPanelOpen);
  }

  function toggleDrawPanel() {
    setDrawPanelOpen(!drawPanelOpen);
  }

  /* ================= 玩法面板 ================= */
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
      id: 'position', title: '名次定位', hint: '',
      subs: null,
      mode: 'positionNum',
      odds: ODDS.position
    },
    {
      id: 'gySum', title: '冠亚和值', hint: '',
      subs: null,
      items: Array.from({ length: 17 }, (_, i) => {
        const sum = i + 3;
        return { play: '冠亚和' + sum, label: String(sum), odds: GY_SUM_ODDS[sum] || 8.5 };
      })
    },
    {
      id: 'twoSide', title: '两面', hint: '',
      subs: null
    },
    {
      id: 'lhh', title: '龙虎', hint: '',
      subs: null
    }
  ];

  let playCatIdx = 0;
  let playSubIdx = 0;
  let playSelectedList = [];
  let playAllin = false;
  /**
   * 上一次从玩法面板提交的选中快照，给面板里的「重复」用。
   * 面板的重复要把玩法重新点回来、金额留着可改，而不是把文本塞进聊天框
   * —— 塞进聊天框就没法换金额了。键盘里的「重复」仍然是写输入框，两者分工不同。
   * @type {{plays:string[],catIdx:number,subIdx:number,amount:number,allin:boolean}|null}
   */
  let lastPanelPick = null;

  function playAmountStep(val) {
    const n = parseInt(val, 10) || 0;
    if (n >= 500) return 100;
    if (n >= 100) return 50;
    return 10;
  }

  function clearPlayAmountChipActive() {
    $('#playAmountChips .jsb-play-foot__chip').removeClass('is-active');
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

  function currentPlayCat() { return PLAY_CATEGORIES[playCatIdx]; }
  function currentPlaySub() {
    const cat = currentPlayCat();
    return cat.subs ? cat.subs[playSubIdx] : '';
  }
  function togglePlaySelect(play) {
    if (!play || !parsePlay(play)) return;
    const idx = playSelectedList.indexOf(play);
    if (idx >= 0) playSelectedList.splice(idx, 1);
    else playSelectedList.push(play);
  }
  function isPlaySelected(play) { return playSelectedList.indexOf(play) >= 0; }
  function syncPlayFootTotals() {
    const n = playSelectedList.length;
    let total = 0;
    if (playAllin) {
      const bal = Math.floor(App.getBalance(user.uid) || 0);
      if (n >= 1 && bal >= 1) total = n === 1 ? bal : Math.floor(bal / n) * n;
    } else {
      const unit = Math.max(0, parseInt($('#playAmount').val(), 10) || 0);
      total = n * unit;
    }
    $('#playBetTotal').text(total.toLocaleString('en-US'));
    const hasPick = playSelectedList.length > 0;
    $('#playClear').prop('disabled', !hasPick);
  }

  function updatePlaySelected() {
    const $tip = $('#playSelected');
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

  function clearPlaySelection() {
    if (!playSelectedList.length) return;
    playSelectedList = [];
    renderPlayPanel();
    updatePlaySelected();
  }

  function initPlaySheet() {
    $('#playNav').html(PLAY_CATEGORIES.map((c, i) =>
      `<button type="button" class="jsb-play-nav__item${i === playCatIdx ? ' is-active' : ''}" data-idx="${i}">${c.title}</button>`
    ).join(''));
    $('#playAmountChips').html(AMOUNT_CHIPS.map((c) =>
      `<button type="button" class="jsb-play-foot__chip${c.amt === 100 ? ' is-active' : ''}" data-amt="${c.amt}" aria-label="${c.label}">` +
        `<span class="jsb-play-foot__chip-glow" aria-hidden="true"></span>` +
        `<img src="${CHIP_IMG(c.amt)}" alt="${c.label}" draggable="false">` +
      `</button>`
    ).join(''));
    syncPlayFootTotals();
  }

  function playItemHtml(play, label, odds, extraCls) {
    const cls = ['jsb-play-item', extraCls, isPlaySelected(play) ? 'is-active' : ''].filter(Boolean).join(' ');
    const oddsHtml = odds != null ? `<small>${odds}</small>` : '';
    return `<button type="button" class="${cls}" data-play="${play}"><span>${label}</span>${oddsHtml}</button>`;
  }

  function playNumItemHtml(posName, n, odds) {
    const play = String(posName).includes('/') ? String(posName) : (String(posName) + n);
    const cls = ['jsb-play-item', 'jsb-play-item--num', isPlaySelected(play) ? 'is-active' : ''].filter(Boolean).join(' ');
    const oddsHtml = odds != null ? `<small>${odds}</small>` : '';
    return `<button type="button" class="${cls}" data-play="${play}">${ballHtml(n, 'play')}${oddsHtml}</button>`;
  }

  function playSectionHtml(title, gridCls, cellsHtml) {
    return `<div class="jsb-play-section"><div class="jsb-play-section__title">${title}</div><div class="jsb-play-section__grid ${gridCls}">${cellsHtml}</div></div>`;
  }

  function renderPlayPanel() {
    const cat = currentPlayCat();
    const $grid = $('#playGrid');
    const hint = typeof cat.hint === 'function' ? cat.hint() : (cat.hint || '');
    $('#playHint').text(hint).toggle(!!hint);
    const $sub = $('#playSub');
    if (cat.subs && cat.subs.length) {
      $sub.removeClass('is-hidden').prop('hidden', false).html(
        cat.subs.map((s, i) => `<button type="button" class="jsb-play-sub__btn${i === playSubIdx ? ' is-active' : ''}" data-sub="${i}">${s}</button>`).join('')
      );
    } else {
      $sub.addClass('is-hidden').prop('hidden', true).empty();
    }

    let html = '';
    let gridMode = 'is-sectioned';

    if (cat.id === 'position' && cat.mode === 'positionNum') {
      const odds = ODDS.position;
      html = POS_NAMES.map((name, i) => {
        const t = trackLabel(i);
        const nums = Array.from({ length: 10 }, (_, d) => {
          const n = d + 1;
          return playNumItemHtml(t + '/' + carLabel(n), n, odds);
        }).join('');
        return playSectionHtml(name, 'is-balls', nums);
      }).join('');
    } else if (cat.id === 'gySum') {
      const items = typeof cat.items === 'function' ? cat.items() : cat.items;
      const cells = (items || []).map((it) => playItemHtml(it.play, it.label, it.odds)).join('');
      html = playSectionHtml('冠亚和值', 'is-text is-gy-sum', cells);
    } else if (cat.id === 'twoSide') {
      const gyCells = ['大', '小', '单', '双'].map((side) =>
        playItemHtml('冠亚' + side, side, ODDS.side, 'jsb-play-item--side')
      ).join('');
      html = playSectionHtml('冠亚和值', 'is-side', gyCells);
      html += POS_NAMES.map((name, i) => {
        const t = trackLabel(i);
        const cells = ['大', '小', '单', '双'].map((side) =>
          playItemHtml(t + side, side, ODDS.side, 'jsb-play-item--side')
        ).join('');
        return playSectionHtml(name, 'is-side', cells);
      }).join('');
    } else if (cat.id === 'lhh') {
      html = LHH_PAIRS.map(([a, b], i) => {
        const n = i + 1;
        const cells = ['龙', '虎'].map((pick) =>
          playItemHtml(n + pick, pick, ODDS.dragon, 'jsb-play-item--lhh')
        ).join('');
        return playSectionHtml((a + 1) + ' vs ' + (b + 1), 'is-lhh-pair', cells);
      }).join('');
    } else {
      gridMode = '';
      const items = typeof cat.items === 'function' ? cat.items() : cat.items;
      html = (items || []).map(it => playItemHtml(it.play, it.label, it.odds)).join('');
    }

    $grid.attr('class', `jsb-play-panel__grid${gridMode ? ' ' + gridMode : ''}`).html(html);
    $grid.scrollTop(0);
  }

  /** 右侧栏顶对齐开奖条单行下沿；短屏压缩并保证不压住底部输入 */
  function layoutRail() {
    const room = document.querySelector('.jsb-room');
    const rail = room && room.querySelector('.jsb-rail');
    const anchor = document.getElementById('drawToggle') || document.getElementById('drawBar');
    const composer = document.querySelector('.jsb-composer');
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
    document.documentElement.style.setProperty('--jsb-play-top', top + 'px');
  }
  function openPlaySheet(open, catId) {
    const $room = $('.jsb-room');
    if (open) {
      layoutPlayOverlay();

      if (drawPanelOpen) setDrawPanelOpen(false);
      openLongSheet(false);
      openPredictSheet(false);
      const catIdx = typeof catId === 'string'
        ? PLAY_CATEGORIES.findIndex(c => c.id === catId)
        : -1;
      playCatIdx = catIdx >= 0 ? catIdx : 0;
      playSubIdx = 0;
      playSelectedList = [];
      playAllin = false;
      $('#playAmount').val(100);
      syncPlayAmountUI();
      clearPlayAmountChipActive();
      $('#playAmountChips .jsb-play-foot__chip[data-amt="100"]').addClass('is-active');
      refreshStats();
      initPlaySheet(); renderPlayPanel(); updatePlaySelected();
      $('#playMask').prop('hidden', false);
      $('#playSheet').prop('hidden', false).addClass('is-open');
      $room.addClass('has-play');
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

  /**
   * 玩法面板里的「重复」：把上次的玩法重新点选回来，金额也填回去但仍可改，
   * 不关面板、不写聊天框。想直接发上次那单请用键盘里的「重复」。
   */
  function repeatLastBetInPlayPanel() {
    const snap = lastPanelPick;
    if (!snap || !snap.plays.length) {
      /* 没有面板快照说明上次是从键盘下的，退回填输入框的老行为，别让按钮没反应 */
      if (lastBetText) {
        openPlaySheet(false);
        $('#chatInput').val(lastBetText);
        if (typeof updateComposerAction === 'function') updateComposerAction();
        App.toast('上次是键盘下单，已填入输入框');
      } else {
        App.toast('暂无上次投注');
      }
      return;
    }
    /* openPlaySheet(true) 会清空选中，所以先开面板再回填 */
    if (!$('#playSheet').hasClass('is-open')) openPlaySheet(true);

    playCatIdx = snap.catIdx;
    if (typeof playSubIdx !== 'undefined') playSubIdx = snap.subIdx;
    $('#playNav .jsb-play-nav__item').removeClass('is-active');
    $('#playNav .jsb-play-nav__item[data-idx="' + playCatIdx + '"]').addClass('is-active');
    renderPlayPanel();

    playSelectedList = snap.plays.slice();
    playAllin = !!snap.allin;
    if (!playAllin && snap.amount > 0) {
      setPlayAmount(snap.amount);
      clearPlayAmountChipActive();
      $('#playAmountChips .jsb-play-foot__chip[data-amt="' + snap.amount + '"]').addClass('is-active');
    }
    if (typeof syncPlayAmountUI === 'function') syncPlayAmountUI();
    updatePlaySelected();
    App.toast('已点选上次玩法 · ' + snap.plays.length + '项');
  }

  function submitPlayBet() {
    if (!isBettingOpen()) { toastBetBlocked('bet'); return; }
    const plays = playSelectedList.filter(p => parsePlay(p));
    if (!plays.length) { App.toast('请选择玩法'); return; }
    /*
     * 存一份面板快照，供「重复」原样点回来。
     * 存面板自己的键而不是事后拿注单反推——玩法名到面板键的映射每个游戏都不一样，
     * 反推既要给每种玩法写一套，还容易在组合玩法上对不上。
     */
    lastPanelPick = {
      plays: plays.slice(),
      catIdx: playCatIdx,
      subIdx: typeof playSubIdx === 'number' ? playSubIdx : 0,
      amount: Math.max(1, parseInt($('#playAmount').val(), 10) || 0),
      allin: !!playAllin,
    };
    let lines;
    if (playAllin) {
      lines = resolveBetAmounts(plays, '梭哈');
      if (!lines) { App.toast('余额不足，无法梭哈'); return; }
    } else {
      const amount = parseInt($('#playAmount').val(), 10);
      if (!amount || amount < 1) { App.toast('请输入有效金额'); return; }
      lines = resolveBetAmounts(plays, String(amount));
      if (!lines) { App.toast('请输入有效金额'); return; }
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
    App.placeLotteryBets(SERVER_GAME, mapped.bets, { chatText: formatResolvedBets(lines) }).then(function () {
      refreshStats();
      syncRoomChat(false);
      lines.forEach(function (l) { recordBetLine(user.name, l.play, l.amount); });
      lastBetText = formatResolvedBets(lines);
      playAllin = false;
      playSelectedList = [];
      syncPlayAmountUI();
      openPlaySheet(false);
      App.toast('投注成功 · ' + lines.length + '注');
    }).catch(function (e) {
      App.toast((e && e.message) || '下注失败');
    });
  }

  function initPlaySheetEvents() {
    $('#playNav').on('click', '.jsb-play-nav__item', function () {
      playCatIdx = +$(this).data('idx');
      playSubIdx = 0;
      $('#playNav .jsb-play-nav__item').removeClass('is-active');
      $(this).addClass('is-active');
      renderPlayPanel();
    });
    $('#playSub').on('click', '.jsb-play-sub__btn', function () {
      playSubIdx = +$(this).data('sub');
      $('#playSub .jsb-play-sub__btn').removeClass('is-active');
      $(this).addClass('is-active');
      renderPlayPanel();
    });
    $('#playGrid').on('click', '.jsb-play-item', function () {
      const play = $(this).data('play');
      togglePlaySelect(play);
      $(this).toggleClass('is-active', isPlaySelected(play));
      updatePlaySelected();
    });
    $('#playAmountChips').on('click', '.jsb-play-foot__chip', function () {
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
    $('#playRepeat').on('click', repeatLastBetInPlayPanel);
    $('#playAmount').on('input change', function () {
      if (playAllin) return;
      const v = parseInt($(this).val(), 10);
      clearPlayAmountChipActive();
      if (v > 0) {
        $(`#playAmountChips .jsb-play-foot__chip[data-amt="${v}"]`).addClass('is-active');
      }
      syncPlayFootTotals();
    });
    $('#playClear').on('click', clearPlaySelection);
    $('#playSubmit').on('click', submitPlayBet);
  }

  /* ================= 长龙 / 预测 ================= */
  const MIN_LONG_STREAK = 2;
  const ROAD_WINDOW = 24;
  let longTab = 'side';
  let predictTab = 'side';
  const PREDICT_WINDOW = 20;
  const PREDICT_STREAK_BREAK = 3;

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

  function pushLongItem(list, name, count) {
    if (count >= MIN_LONG_STREAK) list.push({ name, count });
  }

  function buildLongDragonGroups() {
    const rows = historyRows.filter(r => Array.isArray(r.nums) && r.nums.length === 10);
    const side = [];
    const lhh = [];
    const gy = [];
    if (!rows.length) return { side, lhh, gy };
    POS_NAMES.forEach((pos, idx) => {
      const ballMeta = rows.map(r => sideOfBall(r.nums[idx]));
      pushLongDim(side, pos, ballMeta.map(m => (m.big ? '大' : '小')), pos);
      pushLongDim(side, pos, ballMeta.map(m => (m.odd ? '单' : '双')), pos);
    });
    LHH_PAIRS.forEach(([a, b]) => {
      const pr = (a + 1) + 'v' + (b + 1);
      pushLongDim(lhh, pr, rows.map(r => (r.nums[a] > r.nums[b] ? '龙' : '虎')), pr);
    });
    const gyRows = rows.map(r => gyMeta(r.nums));
    pushLongDim(gy, '冠亚', gyRows.map(m => m.size), '冠亚');
    pushLongDim(gy, '冠亚', gyRows.map(m => m.parity), '冠亚');
    const sortDesc = arr => arr.sort((a, b) => b.count - a.count || String(a.group).localeCompare(String(b.group), 'zh'));
    return { side: sortDesc(side), lhh: sortDesc(lhh), gy: sortDesc(gy) };
  }

  function playForLongName(name) {
    return parsePlay(name) ? name : '';
  }

  function pushLongDim(list, group, labels, playPrefix) {
    const st = streakAtHead(labels);
    if (!st.tag) return;
    const full = (playPrefix || group) + st.tag;
    list.push({ name: st.tag, group, count: st.count, play: playForLongName(full) || playForLongName(st.tag) });
  }

  function roadLabelsForTab(tab) {
    const rows = historyRows.filter(r => Array.isArray(r.nums) && r.nums.length === 10).slice(0, ROAD_WINDOW);
    if (tab === 'lhh') return rows.map(r => (r.nums[0] > r.nums[9] ? '龙' : '虎'));
    if (tab === 'gy') return rows.map(r => gyMeta(r.nums).size);
    return rows.map(r => {
      const m = sideOfBall(r.nums[0]);
      return (m.big ? '大' : '小') + (m.odd ? '单' : '双');
    });
  }

  function roadHtml(labels) {
    if (!labels.length) return '';
    const chips = labels.map((tag, i) =>
      '<span class="jsb-long-road__chip ' + longTagClass(tag) + (i === 0 ? ' is-latest' : '') + '">' + tag + '</span>'
    ).join('');
    return '<div class="jsb-long-road"><div class="jsb-long-road__label">近 ' + labels.length + ' 期走势 · 左新右旧</div><div class="jsb-long-road__row">' + chips + '</div></div>';
  }

  function currentShapeHtml(items) {
    if (!items.length) return '';
    const cards = items.slice(0, 6).map(item => {
      const play = item.play || playForLongName((item.group || '') + item.name) || '';
      const playAttr = play ? ' data-predict-play="' + play + '"' : '';
      const clickable = playAttr ? ' is-clickable' : '';
      return '<div class="jsb-long-shape' + clickable + '"' + playAttr + (playAttr ? ' role="button" tabindex="0"' : '') + '>' +
        '<span class="jsb-long-shape__group">' + (item.group || '') + '</span>' +
        '<span class="jsb-long-shape__tag ' + longTagClass(item.name) + '">' + item.name + '</span>' +
        '<span class="jsb-long-shape__count">' + item.count + '<small>连</small></span></div>';
    }).join('');
    return '<div class="jsb-long-shape-wrap"><div class="jsb-long-road__label">当前形态</div><div class="jsb-long-shape-grid">' + cards + '</div></div>';
  }
  function longItemParts(name) {
    for (const pos of POS_NAMES) {
      const m = name.match(new RegExp('^' + pos + '(大|小|单|双)$'));
      if (m) return { group: pos, tag: m[1], full: name };
    }
    const gyM = name.match(/^冠亚(大|小|单|双)$/);
    if (gyM) return { group: '冠亚和', tag: gyM[1], full: name };
    const lhhM = name.match(/^(\d+)v(\d+)(龙|虎)$/);
    if (lhhM) {
      const a = +lhhM[1];
      const b = +lhhM[2];
      const posA = POS_NAMES[a - 1] || a;
      const posB = POS_NAMES[b - 1] || b;
      return { group: '龙虎', tag: lhhM[3], full: `${posA} vs ${posB}` };
    }
    return { group: '形态', tag: name, full: name };
  }

  function longTagClass(tag) {
    if (['大', '龙'].includes(tag)) return 'tag-red';
    if (['小', '虎'].includes(tag)) return 'tag-blue';
    if (tag === '单') return 'tag-gold';
    if (tag === '双') return 'tag-purple';
    return 'tag-gold';
  }

  function longStreakBar(count) {
    const pct = Math.min(100, Math.round((count / 10) * 100));
    return `<div class="jsb-long-item__bar"><span style="width:${pct}%"></span></div>`;
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
    const tabLabel = { side: '两面', lhh: '龙虎', gy: '冠亚' }[longTab] || '';
    const rows = historyRows.filter(r => Array.isArray(r.nums) && r.nums.length === 10);
    if (!rows.length) {
      $('#longSummary').text(`${tabLabel} · 等待开奖`);
      $('#longBody').html(`
        <div class="jsb-long-empty">
          <div class="jsb-long-empty__icon">◎</div>
          <div class="jsb-long-empty__text">暂无开奖数据</div>
          <div class="jsb-long-empty__hint">接入官方开奖后会自动统计长龙</div>
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
        <div class="jsb-long-hero ${longTierClass(top.count)}">
          <div class="jsb-long-hero__label">当前最长</div>
          <div class="jsb-long-hero__main">
            <span class="jsb-long-hero__tag ${longTagClass(top.name)}">${top.name}</span>
            <span class="jsb-long-hero__text">${top.group || ''}</span>
            <span class="jsb-long-hero__num">${top.count}</span>
            <span class="jsb-long-hero__unit">期</span>
          </div>
        </div>`;
    }
    const listHtml = list.length
      ? `<div class="jsb-long-list">${list.map((item, idx) => {
          const play = item.play || playForLongName((item.group || '') + item.name) || '';
          const click = play ? ` data-predict-play="${play}" role="button" tabindex="0"` : '';
          return `
        <div class="jsb-long-item ${longTierClass(item.count)}${click ? ' is-clickable' : ''}"${click}>
          <div class="jsb-long-item__rank">${idx + 1}</div>
          <div class="jsb-long-item__tag ${longTagClass(item.name)}">${item.name}</div>
          <div class="jsb-long-item__info">
            <div class="jsb-long-item__name">${item.group || ''}<span class="sep">·</span>${item.name}</div>
            ${longStreakBar(item.count)}
          </div>
          <div class="jsb-long-item__count"><b>${item.count}</b><small>连</small></div>
        </div>`;
        }).join('')}</div>`
      : `<div class="jsb-long-empty jsb-long-empty--soft">
          <div class="jsb-long-empty__text">暂无 2 期以上长龙</div>
          <div class="jsb-long-empty__hint">下方仍可看近期走势与当前形态</div>
        </div>`;
    $('#longBody').html(hero + roadHtml(roadLabelsForTab(longTab)) + currentShapeHtml(all) + listHtml);
  }

  function openLongSheet(open) {
    const $room = $('.jsb-room');
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
      setTimeout(() => { if (!$('#longSheet').hasClass('is-open')) $('#longSheet').prop('hidden', true); }, 300);
      $room.removeClass('has-long');
    }
  }

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
    return `<div class="jsb-predict-card is-clickable"${playAttr} role="button" tabindex="0">
      <div class="jsb-predict-card__name">${name}</div>
      <div class="jsb-predict-card__pick">
        <span class="jsb-predict-card__tag ${predictTagClass(data.pick)}">${data.pick}</span>
        <span class="jsb-predict-card__conf">${pct}%</span>
      </div>
      <div class="jsb-predict-card__reason">${data.reason}</div>
      <div class="jsb-predict-card__bar"><span style="width:${pct}%"></span></div>
    </div>`;
  }

  function buildDigitPredict(rows, posIdx) {
    const window = Math.min(PREDICT_WINDOW, rows.length);
    const freq = Array(11).fill(0);
    const lastSeen = Array(11).fill(window);
    for (let i = 0; i < window; i++) {
      const d = rows[i].nums[posIdx];
      freq[d]++;
      if (lastSeen[d] === window) lastSeen[d] = i;
    }
    const hot = freq
      .map((c, d) => ({ d, c }))
      .filter(x => x.d >= 1)
      .sort((a, b) => b.c - a.c || a.d - b.d)
      .slice(0, 2)
      .filter(x => x.c > 0);
    const cold = lastSeen
      .map((gap, d) => ({ d, gap }))
      .filter(x => x.d >= 1)
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
    updateComposerAction();
    showKeypad(true);
    openPredictSheet(false);
    App.toast(`已填入 ${play}/${amount}`);
  }

  function renderPredictPanel() {
    const rows = historyRows.filter(r => Array.isArray(r.nums) && r.nums.length === 10);
    const issue = getPredictIssue();
    $('#predictSummary').text(`下一期 · ${issue}`);
    if (!rows.length) {
      $('#predictBody').html(`
        <div class="jsb-long-empty">
          <div class="jsb-long-empty__icon">◎</div>
          <div class="jsb-long-empty__text">暂无开奖数据</div>
          <div class="jsb-long-empty__hint">等待开奖后生成预测</div>
        </div>`);
      return;
    }

    if (predictTab === 'side') {
      const cards = [];
      POS_NAMES.forEach((pos, idx) => {
        const ballMeta = rows.map(r => sideOfBall(r.nums[idx]));
        const bigData = pickByTrend(ballMeta.map(m => (m.big ? '大' : '小')), PREDICT_STREAK_BREAK);
        const oddData = pickByTrend(ballMeta.map(m => (m.odd ? '单' : '双')), PREDICT_STREAK_BREAK);
        cards.push(predictCardHtml(`${pos} · 大小`, bigData, pos + bigData.pick));
        cards.push(predictCardHtml(`${pos} · 单双`, oddData, pos + oddData.pick));
      });
      const champMeta = rows.map(r => sideOfBall(r.nums[0]));
      const champBig = pickByTrend(champMeta.map(m => (m.big ? '大' : '小')), PREDICT_STREAK_BREAK);
      const champOdd = pickByTrend(champMeta.map(m => (m.odd ? '单' : '双')), PREDICT_STREAK_BREAK);
      const hero = `
        <div class="jsb-predict-hero">
          <div class="jsb-predict-hero__label">核心参考</div>
          <div class="jsb-predict-hero__main">
            <div class="jsb-predict-hero__tags">
              <span class="jsb-predict-card__tag ${predictTagClass(champBig.pick)} is-clickable" data-predict-play="1${champBig.pick}" role="button" tabindex="0">赛道1${champBig.pick}</span>
              <span class="jsb-predict-card__tag ${predictTagClass(champOdd.pick)} is-clickable" data-predict-play="1${champOdd.pick}" role="button" tabindex="0">赛道1${champOdd.pick}</span>
            </div>
            <div class="jsb-predict-hero__note">赛道1倾向 ${champBig.pick}${champOdd.pick}，${champBig.reason}</div>
          </div>
        </div>`;
      $('#predictBody').html(hero + `<div class="jsb-predict-grid">${cards.join('')}</div>`);
      return;
    }

    if (predictTab === 'num') {
      const cols = POS_NAMES.map((pos, idx) => {
        const stat = buildDigitPredict(rows, idx);
        const hotHtml = stat.hot.length
          ? stat.hot.map(x =>
            `<span class="jsb-ball-digit is-clickable" data-predict-play="${pos}${x.d}" role="button" tabindex="0">${x.d}</span>`
          ).join('')
          : '<span class="jsb-predict-card__reason">—</span>';
        const coldHtml = stat.cold.map(x =>
          `<span class="jsb-ball-digit is-cold is-clickable" data-predict-play="${pos}${x.d}" role="button" tabindex="0">${x.d}</span>`
        ).join('');
        return `<div class="jsb-predict-digit-col">
          <div class="jsb-predict-digit-col__pos">${pos}</div>
          <div class="jsb-predict-digit-col__label">热号</div>
          <div class="jsb-predict-digit-balls">${hotHtml}</div>
          <div class="jsb-predict-digit-col__label">遗漏</div>
          <div class="jsb-predict-digit-balls">${coldHtml}</div>
        </div>`;
      }).join('');
      $('#predictBody').html(`
        <div class="jsb-predict-hero">
          <div class="jsb-predict-hero__label">定位参考</div>
          <div class="jsb-predict-hero__note">近 ${Math.min(PREDICT_WINDOW, rows.length)} 期各名次热号与遗漏号，可作定位艇号参考</div>
        </div>
        <div class="jsb-predict-digit-grid">${cols}</div>`);
      return;
    }

    const gyRows = rows.map(r => gyMeta(r.nums));
    const sizeData = pickByTrend(gyRows.map(m => m.size).filter(v => v !== '和'), PREDICT_STREAK_BREAK);
    const oddData = pickByTrend(gyRows.map(m => m.parity).filter(v => v !== '和'), PREDICT_STREAK_BREAK);
    const sumFreq = {};
    rows.slice(0, PREDICT_WINDOW).forEach(r => {
      const s = gyMeta(r.nums).sum;
      sumFreq[s] = (sumFreq[s] || 0) + 1;
    });
    const hotSums = Object.keys(sumFreq)
      .map(Number)
      .sort((a, b) => sumFreq[b] - sumFreq[a] || a - b)
      .slice(0, 3);
    const sumCards = hotSums.map(s => {
      const ratio = sumFreq[s] / Math.min(PREDICT_WINDOW, rows.length);
      const conf = Math.round(45 + ratio * 40);
      return predictCardHtml(`冠亚和 ${s}`, {
        pick: String(s),
        reason: `近 ${Math.min(PREDICT_WINDOW, rows.length)} 期出现 ${sumFreq[s]} 次`,
        confidence: conf
      }, `冠亚和${s}`);
    }).join('');
    const lhhCards = LHH_PAIRS.map(([a, b], i) => {
      const labels = rows.map(r => (r.nums[a] > r.nums[b] ? '龙' : '虎'));
      const data = pickByTrend(labels, PREDICT_STREAK_BREAK);
      const play = `${i + 1}${data.pick}`;
      return predictCardHtml(`${POS_NAMES[a]} vs ${POS_NAMES[b]}`, data, play);
    }).join('');
    const hero = `
      <div class="jsb-predict-hero">
        <div class="jsb-predict-hero__label">冠亚参考</div>
        <div class="jsb-predict-hero__main">
          <div class="jsb-predict-hero__tags">
            <span class="jsb-predict-card__tag ${predictTagClass(sizeData.pick)} is-clickable" data-predict-play="冠亚${sizeData.pick}" role="button" tabindex="0">冠亚${sizeData.pick}</span>
            <span class="jsb-predict-card__tag ${predictTagClass(oddData.pick)} is-clickable" data-predict-play="冠亚${oddData.pick}" role="button" tabindex="0">冠亚${oddData.pick}</span>
          </div>
          <div class="jsb-predict-hero__note">${sizeData.reason}</div>
        </div>
      </div>`;
    $('#predictBody').html(hero
      + `<div class="jsb-predict-grid">${predictCardHtml('冠亚 · 大小', sizeData, '冠亚' + sizeData.pick)}${predictCardHtml('冠亚 · 单双', oddData, '冠亚' + oddData.pick)}</div>`
      + `<div class="jsb-predict-hero" style="margin-top:12px"><div class="jsb-predict-hero__label">热和值</div></div>`
      + `<div class="jsb-predict-grid">${sumCards}</div>`
      + `<div class="jsb-predict-hero" style="margin-top:12px"><div class="jsb-predict-hero__label">龙虎走势</div></div>`
      + `<div class="jsb-predict-grid">${lhhCards}</div>`);
  }

  function openPredictSheet(open) {
    const $room = $('.jsb-room');
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
      setTimeout(() => { if (!$('#predictSheet').hasClass('is-open')) $('#predictSheet').prop('hidden', true); }, 300);
      $room.removeClass('has-predict');
    }
  }

  function openPlusMenu(open) {
    const $room = $('.jsb-room');
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

  // ===== 初始化 =====
  refreshStats();
  initKeypad();
  initPlaySheet();
  initPlaySheetEvents();
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
      if (!/(jsb-race-card|result-card|bot-card--result|bot-card--win|is-reveal|is-settled|is-drawing)/.test(html)) return;
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
      return { issue: String(row.issueNo || ''), nums, gy: nums.length === 10 ? gyMeta(nums).text : '', lh: nums.length === 10 ? lhRow(nums) : '' };
    }).filter(r => r.issue && r.nums.length === 10);
  }

  function isCeremonyHolding() {
    try {
      const phase = roomChat && roomChat.getPhase ? roomChat.getPhase() : '';
      return phase === 'drawing' || phase === 'revealing' || phase === 'settled';
    } catch (e) { return false; }
  }
  function upsertHistoryHeadFromDraw(issue, nums) {
    const iss = String(issue || '').trim();
    if (!iss || !Array.isArray(nums) || nums.length !== 10) return null;
    const row = {
      issue: iss,
      nums: nums.slice(),
      gy: gyMeta(nums).text,
      lh: lhRow(nums),
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
   * 冲线出号：只刷顶部历史栏（号码已定）。
   * 开盘线 / 顶栏倒计时要等领奖台尾动画播完 → notifyDrawCeremonyReady。
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
  /** 领奖台/尾动画结束：中奖核对 → 开盘线 → 解冻 → 顶栏倒计时 */
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
      if (iss && lastDraw && lastDraw.length === 10 && typeof upsertHistoryHeadFromDraw === 'function') {
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
    snapshotBusy = true;
    App.fetchLotterySnapshot(SERVER_GAME).then(function (snapshot) {
      /* 先校时：后面所有与 lockAt / openAt 的比较都要用校准后的钟 */
      if (snapshot && window.LotteryClock) {
        LotteryClock.sync(snapshot.serverNow, snapshot.sentAt, snapshot.recvAt);
      }
      /* 历史与当前期解耦：即使短暂没有 current，上期栏也要能刷新 */
      const rows = parseServerHistory(snapshot && snapshot.history);
      const headChanged = rows[0] && (!historyRows[0] || rows[0].issue !== historyRows[0].issue);
      historyRows = rows;
      try {
        const holdIss = roomChat && roomChat.getPhaseIssue ? String(roomChat.getPhaseIssue() || '') : '';
        if (
          holdIss &&
          (isDrawBarUnlocked(holdIss) || (roomChat && roomChat.isRevealReady && roomChat.isRevealReady(holdIss))) &&
          lastDraw && lastDraw.length === 10
        ) {
          upsertHistoryHeadFromDraw(holdIss, lastDraw);
        }
      } catch (eKeepHead) { /* ignore */ }
      if (historyRows.length) {
        const holdNow = roomChat && roomChat.getPhaseIssue ? String(roomChat.getPhaseIssue() || '') : '';
        if (!(isDrawBarUnlocked(holdNow) || (roomChat && roomChat.isRevealReady && roomChat.isRevealReady(holdNow)))) {
          lastDraw = historyRows[0].nums.slice();
        } else if (!lastDraw || !lastDraw.length) {
          lastDraw = historyRows[0].nums.slice();
        }
        /* 仪式未结束前顶栏仍显示上一期，避免比结果卡更早露号 */
        const barRow = pickDrawBarRow(historyRows);
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
        if (_st !== 'PENDING' && _st !== 'LOCKED' && Number.isFinite(_openAt) && srvNow() >= _openAt) {
          serverCurrent = null;
        }
      }
      if (typeof tick === 'function') try { tick(); } catch (e) { /* ignore */ }
      renderDrawTable();
      if (!isCeremonyHolding() && serverCurrent && serverCurrent.issueNo) setCurIssueDisplay(String(serverCurrent.issueNo));
      settleRestoredResultCards();
      try { holdBlackLockedRaceCards(); } catch (eHold) { /* ignore */ }
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
      /* 桥接失败不卡死：松开 busy 后尽快再拉 */
      if (!serverSynced) {
        setTimeout(function () {
          if (!serverSynced && !snapshotBusy && typeof syncServerSnapshot === 'function') syncServerSnapshot();
        }, 600);
      }
    }).finally(function () { snapshotBusy = false; });
  }

  function tick() {
    const phase = roomChat && roomChat.getPhase ? roomChat.getPhase() : '';
    if (phase === 'drawing' || phase === 'revealing' || phase === 'settled') {
      const hold = roomChat.getPhaseIssue ? roomChat.getPhaseIssue() : '';
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
        /* 铃声排程走本地钟，这里把服务端时刻换算回去 */
        if (window.JsbAudio && JsbAudio.armCountdown) JsbAudio.armCountdown(toLocalMs(cutoff));
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
  if (App.startAdaptiveInterval) App.startAdaptiveInterval(syncServerSnapshot, 2000, 5000); else { syncServerSnapshot(); setInterval(syncServerSnapshot, 2000); }
  /* robot bets from server room chat */

  tick();

  $('#backBtn').on('click', () => {
    if (App.backToLobby) App.backToLobby();
    else App.go('../../client-app/pages/game-lobby/game-lobby.html' + q);
  });
  window.addEventListener('gamebox-balance', function () { refreshStats(); });

  layoutRail();
  $(window).on('resize orientationchange', function () { layoutRail(); });
  if (typeof ResizeObserver !== 'undefined') {
    const roomEl = document.querySelector('.jsb-room');
    if (roomEl) {
      try {
        new ResizeObserver(function () { layoutRail(); }).observe(roomEl);
      } catch (e) { /* ignore */ }
    }
  }
  
  /* 右侧四钮：默认收起，点梯子展开/收起 */
  (function initRailLadder() {
    const KEY = 'jsb_rail_collapsed';
    const room = document.querySelector('.jsb-room');
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
      const arrow = btn.querySelector('.jsb-rail-ladder__arrow');
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

/* === chat-rail handlers (jsb) === */

  function playCatRulesHtml(cat) {
    const id = (cat && cat.id) || '';
    const map = {
      position:
        '● 名次定位：<br><br>在冠军～第十名中的任意位置上选择1个号码，与对应名次上的开奖号码一致，即中奖。<br><br>' +
        '投注冠军【3】；开奖号码：3,*,*,*,*,*,*,*,*,*，即中奖。',
      gySum:
        '● 冠亚和值：<br><br>选择1个数值，与开奖号码中冠军、亚军2个号码之和相同，即中奖。<br><br>' +
        '投注【3】；开奖号码：1,2,*,*,*,*,*,*,*,*，即中奖。',
      twoSide:
        '● 冠亚和两面：<br>选择1个形态(大:12-19；小:3-10；单:个位数1,3,5,7,9；双:个位数0,2,4,6,8)，与开奖号码中冠军、亚军2个号码之和的形态相同，即中奖。开出和值11时为和局，退还本金。<br><br>' +
        '投注【大】；开奖号码：10,9,*,*,*,*,*,*,*,*，即中奖。<br><br>' +
        '● 名次两面：<br>在冠军～第十名中的任意位置上选择1个形态(大:≥6；小:≤5；单:个位数1,3,5,7,9；双:个位数0,2,4,6,8)，与对应名次上的形态相同，即中奖。<br><br>' +
        '投注冠军【大】；开奖号码：10,*,*,*,*,*,*,*,*,*，即中奖。',
      lhh:
        '● 龙虎：<br><br>两个位置的开奖号码进行比较(1最小，10最大)，前大于后为“龙”，反之为“虎”。<br><br>' +
        '冠军龙虎：冠军号大于第十名号视为【龙】中奖、反之为【虎】中奖。<br>' +
        '亚军龙虎：亚军号大于第九名号视为【龙】中奖、反之为【虎】中奖。<br>' +
        '第三名龙虎：第三名号大于第八名号视为【龙】中奖、反之视为【虎】中奖。<br>' +
        '第四名龙虎：第四名号大于第七名号视为【龙】中奖、反之为【虎】中奖。<br>' +
        '第五名龙虎：第五名号大于第六名号视为【龙】中奖、反之为【虎】中奖。<br><br>' +
        '投注冠军龙虎【龙】；开奖号码：10,*,*,*,*,*,*,*,*,1，即中奖。',
    };
    const body = map[id] || '请在盘面点选投注项后确认投注；派彩以服务端为准。';
    return `<div class="jsb-rules-sec"><p>${body}</p></div>`;
  }

  function fullRulesHtml() {
    const o = ODDS;
    const betSec = INTERVAL - PREP_SEC;
    return `
        <div class="jsb-rules-sec">
          <h3 class="jsb-rules-sec__title">一、开奖与时间</h3>
          <p>幸运飞艇每期开出 <b>1～10</b> 共十个不重复名次（冠军→第十）。</p>
          <p>每期共 <b>${INTERVAL} 秒</b>。顶栏「距封盘」；封盘后显示「开奖中」，不可下注、不可取消。</p>
          <p>开奖结果与派彩以服务端账本为准。</p>
        </div>
        <div class="jsb-rules-sec">
          <h3 class="jsb-rules-sec__title">二、如何下注</h3>
          <p>支持三种方式：</p>
          <ul>
            <li>点右侧 / 底部「玩法」面板点选后投注</li>
            <li>底部输入口令：<b>玩法/金额</b>（空格可下多注）</li>
            <li>键盘快捷：上分、取消、梭哈、重复、下分</li>
          </ul>
          <span class="jsb-rules-ex">冠亚大/100　1龙/50　1单/80　1/5/100</span>
          <span class="jsb-rules-ex">冠亚和12/100　12345/12345/100　龙/梭哈</span>
          <p>「梭哈」按余额均分；玩法脚「重复」可跟上一笔。底部「+」含上下分、申请记录、竞猜报表等入口。</p>
        </div>
        <div class="jsb-rules-sec">
          <h3 class="jsb-rules-sec__title">三、玩法与赔率</h3>
          <p>下列为当前房间赔率（随后台更新）。派彩 = 金额 × 赔率（四舍五入到两位小数）。</p>
          <table class="jsb-rules-table">
            <thead><tr><th>玩法</th><th>说明</th><th>赔率</th></tr></thead>
            <tbody>
              <tr><td>冠亚两面</td><td>冠亚和：大12～19、小3～10、单双；和值11和局退本</td><td>${o.side}</td></tr>
              <tr><td>名次两面</td><td>指定名次猜大(≥6)/小(≤5)/单/双</td><td>${o.side}</td></tr>
              <tr><td>龙虎</td><td>五组对位：1龙9虎、2龙8虎…5龙6虎</td><td>${o.dragon}</td></tr>
              <tr><td>冠亚和值</td><td>猜冠亚军号码之和（3～19），各和值赔率不同</td><td>见玩法面板</td></tr>
              <tr><td>名次定位</td><td>猜指定名次开出的号码；可多选名次/号码</td><td>${o.position}</td></tr>
            </tbody>
          </table>
        </div>
        <div class="jsb-rules-sec">
          <h3 class="jsb-rules-sec__title">四、取消与结算</h3>
          <p>当期未封盘前可输入「取消」或点键盘「取消」，撤销本人本期未结算注单；封盘后不可取消。</p>
          <p>开奖后房间会推送结果卡与注单/中奖核对；积分变动以服务端派彩为准。顶部「输赢 / 流水 / 回水」为房间会话统计参考。</p>
        </div>
        <div class="jsb-rules-sec">
          <h3 class="jsb-rules-sec__title">五、温馨提示</h3>
          <ul>
            <li>请理性竞猜，注意自身资金安全</li>
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
        title = (cat && cat.title) || '玩法';
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
    App.go('../../client-app/pages/bet-records/bet-records.html' + q + sep + 'game=speed-boat');
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
$('#btnLong').on('click', () => openLongSheet(true));
  $('#longSheetClose, #longMask').on('click', () => openLongSheet(false));
  $('#longTabs').on('click', 'button[data-tab]', function () {
    longTab = $(this).data('tab');
    $('#longTabs button').removeClass('is-active');
    $(this).addClass('is-active');
    renderLongDragonPanel();
  });
  $('#btnPredict').on('click', () => openPredictSheet(true));
  $('#predictSheetClose, #predictMask').on('click', () => openPredictSheet(false));
  $('#predictTabs').on('click', 'button[data-tab]', function () {
    predictTab = $(this).data('tab');
    $('#predictTabs button').removeClass('is-active');
    $(this).addClass('is-active');
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
  $('#drawToggle').on('click', function (e) {
    e.stopPropagation();
    toggleDrawPanel();
  });

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
  $('#chatInput').on('input', () => { composerAllin = false; updateComposerAction(); });
  $('#chatInput').on('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); sendBetMessage(); } });
  $('#keyGrid').on('click', '.jsb-key', function () {
    const raw = $(this).attr('data-key');
    const key = (raw === 0 || raw === '0') ? '0' : String(raw == null ? '' : raw);
    if (key === '删除') return; /* 删除走 pointer 长按逻辑，避免连删双触发 */
    /* 与快三一致：点「和」打开冠亚和值面板；若刚输入「冠亚」则继续拼口令 */
    if (key === '和') {
      const cur = String($('#chatInput').val() || '');
      if (/冠亚$/.test(cur)) {
        insertInput('和');
        updateComposerAction();
        return;
      }
      showKeypad(false);
      openPlaySheet(true, 'gySum');
      return;
    }
    insertInput(key);
    updateComposerAction();
  });
  $('#keyGrid').on('pointerdown', '.jsb-key', function (e) {
    if ($(this).attr('data-key') !== '删除') return;
    e.preventDefault();
    stopDeleteHold();
    insertInput('删除');
    delHoldTimer = setTimeout(() => {
      delHoldInterval = setInterval(() => insertInput('删除'), 55);
    }, 380);
  });
  $('#keyGrid').on('pointerup pointerleave pointercancel', '.jsb-key', function () {
    if ($(this).attr('data-key') === '删除') stopDeleteHold();
  });
  $(window).on('pointerup pointercancel', stopDeleteHold);
  $('#keypad').on('click', '[data-cmd]', function () {
    const cmd = $(this).data('cmd');
    if (cmd === 'cancel') { $('#chatInput').val('取消'); updateComposerAction(); return; }
    if (cmd === 'repeat') { repeatLastBet(); return; }
    if (cmd === 'allin') { applyAllinToInput(); return; }
    if (cmd === 'topup') { $('#chatInput').val('上分'); updateComposerAction(); return; }
    if (cmd === 'withdraw') { $('#chatInput').val('下分'); updateComposerAction(); return; }
  });
  $('#plusBtn').on('click', function () {
    if ($('#chatInput').val().trim()) { sendBetMessage(); return; }
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
    if (drawPanelOpen && !$(e.target).closest('#drawBar').length) {
      setDrawPanelOpen(false);
    }
    if (Date.now() < keypadGuardUntil) return;
    if (!$(e.target).closest('#keypad, #chatInput, .jsb-composer').length && $('#keypad').is(':visible')) {
      if (!$(e.target).closest('.jsb-plus-menu, #plusBtn, .jsb-menu-mask').length) showKeypad(false);
    }
  });
  updateComposerAction();
});
