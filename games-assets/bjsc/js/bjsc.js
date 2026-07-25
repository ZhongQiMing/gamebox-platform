/**
 * 北京赛车 · 聊天投注房
 * 界面对齐时时彩；玩法对齐官方 PK10/北京赛车：
 * 名次两面 / 龙虎 / 冠亚和值 / 定位车号
 * BUILD 80 — 与 index.html ?v= 保持一致
 */
$(function () {
    /** 与服务端开奖引擎一致：60 秒一局，封盘前 10 秒准备开奖。 */
  const INTERVAL = 60;
  const PREP_SEC = 10;

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
    return `<div class="bjsc-msg__avatar bjsc-msg__avatar--gen" style="--av-hue:${hue}"><span>${ch}</span></div>`;
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
  const SERVER_GAME = 'bjsc';

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
  const REVEALED_STORAGE_KEY = 'bjsc_revealed_v1';
  const CLOSED_STORAGE_KEY = 'bjsc_closed_v1';
  let revealedIssues = new Set();
  /** 进房后首次拉到历史头：只对齐顶栏，不往聊天推「进房前已开奖」 */
  let historyHeadBootstrapped = false;
  let lastBetText = '';
  let composerAllin = false;
  let drawPanelOpen = false;
  let closedIssues = new Set();
  /** 封盘后冻结下注，开奖核对展示完再解冻（避免下一期过早冒注） */
  let roomBetFrozen = false;
  let sealedIssueNo = '';
  const MOCK_NAMES = [];
  const issueBetBook = {};

  const POS_NAMES = ['冠军', '亚军', '季军', '第四名', '第五名', '第六名', '第七名', '第八名', '第九名', '第十名'];
  const POS = {};
  POS_NAMES.forEach((n, i) => { POS[n] = i; });
  const LHH_PAIRS = [[0, 9], [1, 8], [2, 7], [3, 6], [4, 5]];
  const ODDS = { side: 1.98, dragon: 1.98, position: 9.8 };
  const GY_SUM_ODDS = {
    3: 44.55, 4: 44.55, 5: 22.27, 6: 22.27, 7: 14.85, 8: 14.85,
    9: 11.13, 10: 11.13, 11: 8.91, 12: 8.91, 13: 11.13, 14: 11.13,
    15: 14.85, 16: 14.85, 17: 22.27, 18: 22.27, 19: 44.55
  };

  function applyServerPayTable(pt) {
    if (!pt) return;
    // 冠亚两面与名次两面服务端同为 1.98，本地共用 ODDS.side
    ODDS.side = mulOf(pt, 'posSide', mulOf(pt, 'top2big', ODDS.side));
    ODDS.dragon = mulOf(pt, 'lhh', ODDS.dragon);
    ODDS.position = mulOf(pt, 'position', ODDS.position);
    for (let n = 3; n <= 19; n++) {
      GY_SUM_ODDS[n] = mulOf(pt, 'gySum_' + n, GY_SUM_ODDS[n]);
    }
  }
  const SUOHA_WORDS = new Set(['梭哈', '全下', 'allin']);
  const ROBOT_COUNT = 10;
  const MOCK_GY = ['冠亚大', '冠亚小', '冠亚单', '冠亚双'];
  const MOCK_SIDES = ['大', '小', '单', '双'];
  const MOCK_LHH = ['龙', '虎'];
  const MOCK_GY_SUM = [3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19];
  function pickOne(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
  function pickAmt() {
    const w = Math.random();
    if (w < 0.4) return 10 + Math.floor(Math.random() * 90);
    if (w < 0.75) return 20 + Math.floor(Math.random() * 180);
    if (w < 0.92) return 50 + Math.floor(Math.random() * 250);
    return 100 + Math.floor(Math.random() * 400);
  }
  function randomMockBetText() {
    const amt = pickAmt();
    const roll = Math.random();
    const pos = pickOne(POS_NAMES);
    const track = trackLabel(Math.floor(Math.random() * 10));
    if (roll < 0.22) return track + pickOne(MOCK_SIDES) + '/' + amt;
    if (roll < 0.38) return track + pickOne(MOCK_SIDES) + '/' + amt;
    if (roll < 0.52) return pickOne(MOCK_GY) + '/' + amt;
    if (roll < 0.62) return (1 + Math.floor(Math.random() * 5)) + pickOne(MOCK_LHH) + '/' + amt;
    if (roll < 0.72) return '冠亚和' + pickOne(MOCK_GY_SUM) + '/' + amt;
    if (roll < 0.82) return track + '/' + carLabel(1 + Math.floor(Math.random() * 10)) + '/' + amt;
    if (roll < 0.9) {
      const tracks = String(1 + Math.floor(Math.random() * 5)) + String(1 + Math.floor(Math.random() * 5));
      return tracks + pickOne(MOCK_SIDES) + '/' + amt;
    }
    return pickOne(MOCK_LHH) + '/' + amt;
  }
  const DEFAULT_TRACK_IDX = 0;

  function sideOfBall(n) { return { big: n >= 6, odd: n % 2 === 1 }; }
  function gyMeta(nums) {
    const s = nums[0] + nums[1];
    return { sum: s, size: s > 11 ? '大' : '小', parity: s % 2 ? '单' : '双', text: `${s} ${s > 11 ? '大' : '小'} ${s % 2 ? '单' : '双'}` };
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
      return { type: 'gySum', sum, odds: GY_SUM_ODDS[sum] || 8.91 };
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
        if (p.side === '大') win = gy.sum > 11;
        else if (p.side === '小') win = gy.sum <= 11;
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
    const winAmount = Math.floor(amount * p.odds);
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
    const rem = bal - base * plays.length;
    return plays.map((play, i) => ({ play, amount: base + (i === 0 ? rem : 0) }));
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
  /** 与服务端 _nextAlignedTime / 短号一致：UTC epoch 整除对齐 */
  const ISSUE_BASE_MS = Date.UTC(2024, 0, 1);
  function nextOpenAtMs(now) {
    const intervalMs = INTERVAL * 1000;
    const t = now != null ? now : Date.now();
    return Math.ceil(t / intervalMs) * intervalMs;
  }
  function fmtIssueFromOpenAt(openAtMs) {
    const intervalMs = INTERVAL * 1000;
    return String(Math.max(1, Math.floor((openAtMs - ISSUE_BASE_MS) / intervalMs) + 1));
  }
  function fmtIssue(seq) {
    /* 兼容旧调用：seq 仅作占位，权威用 UTC 对齐 openAt */
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
    let r = (openAt - Date.now()) / 1000;
    if (r <= 0) r = INTERVAL;
    return r;
  }
  function getBettingIssueSeq() {
    return Math.max(1, Math.floor((nextOpenAtMs() - ISSUE_BASE_MS) / (INTERVAL * 1000)) + 1);
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
  function toastBetBlocked(kind) {
    if (!serverSynced) {
      App.toast('房间同步中，请稍候');
      return;
    }
    App.toast(kind === 'cancel' ? '封盘中，无法取消' : '封盘中，无法下注');
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


  function betLogKey() { return 'bjsc_bet_log_' + user.uid; }
  function loadUserBetLog() {
    try { return JSON.parse(localStorage.getItem(betLogKey())) || []; } catch (e) { return []; }
  }
  function saveUserBetLog(list) {
    localStorage.setItem(betLogKey(), JSON.stringify(list.slice(0, 120)));
    try { window.dispatchEvent(new CustomEvent('bjsc-bet-log-updated')); } catch (e) { /* */ }
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
      group = { game: 'bjsc', issue, createdAt: new Date().toISOString(), settled: false, bets: [], totalAmount: 0, totalProfit: 0 };
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
    return 'bjsc_betbook_v1_' + uid + (roomNo ? '_' + roomNo : '');
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

  function fmtProfit(n) { return (n >= 0 ? '+' : '') + n; }

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
    const empty = '<div class="bjsc-bot-empty">本期暂无下注</div>';
    if (!bets.length) {
      return '<div class="bjsc-bot-card bjsc-bot-card--bets"><div class="bjsc-bot-card__head"><span class="bjsc-bot-card__title">注单核对</span><span class="bjsc-bot-card__issue">' + issue + '</span></div>' + empty + '</div>';
    }
    const total = bets.reduce(function (s, b) { return s + (Number(b.amount) || 0); }, 0);
    const groups = App.groupLotteryBetsByType(bets);
    const tags = groups.map(function (g) {
      return '<span class="bjsc-bot-tag">' + g.label + '×' + g.count + '/' + g.amount + '</span>';
    }).join('');
    let detail = '';
    if (bets.length <= 8) {
      detail = '<div class="bjsc-bot-user__tags" style="margin-top:6px">' + bets.map(function (b) {
        return '<span class="bjsc-bot-tag">' + App.labelLotteryBet(b) + '/' + b.amount + '</span>';
      }).join('') + '</div>';
    }
    const userBlock = '<div class="bjsc-bot-user is-me"><div class="bjsc-bot-user__head"><span class="bjsc-bot-user__name">我</span><span class="bjsc-bot-user__sum">' + total + '</span></div><div class="bjsc-bot-user__tags">' + tags + '</div>' + detail + '</div>';
    return '<div class="bjsc-bot-card bjsc-bot-card--bets"><div class="bjsc-bot-card__head"><span class="bjsc-bot-card__title">注单核对</span><span class="bjsc-bot-card__issue">' + issue + '</span></div><div class="bjsc-bot-card__body is-full">' + userBlock + '</div></div>';
  }
  function buildMineLineHtmlFromServer(issue, list) {
    const scoped = App.filterLotteryBetsByIssue ? App.filterLotteryBetsByIssue(list, issue) : (Array.isArray(list) ? list : []);
    const bets = scoped.filter(function (b) { return b && b.status !== 'CANCELLED' && b.status !== 'PENDING'; });
    if (!bets.length) return '';
    const myProfit = bets.reduce(function (sum, b) { return sum + serverBetProfit(b); }, 0);
    const myWin = bets.reduce(function (sum, b) { return sum + (Number(b.payout) || 0); }, 0);
    const profitCls = myProfit >= 0 ? 'pos' : 'neg';
    const winText = myWin > 0 ? ('中奖 +' + myWin) : '未中奖';
    return '<div class="bjsc-bot-mine-line ' + profitCls + '">' +
      '<span class="bjsc-bot-mine-line__label">您本期</span>' +
      '<span class="bjsc-bot-mine-line__win">' + winText + '</span>' +
      '<span class="bjsc-bot-mine-line__profit">输赢 ' + fmtProfit(myProfit) + '</span>' +
      '</div>';
  }
  function applyMineLineToWinHtml(html, mineHtml) {
    if (!mineHtml) return html;
    const re = /<div class="bjsc-bot-mine-line[\s\S]*?<\/div>/;
    if (re.test(html)) return html.replace(re, mineHtml);
    return html.replace(/<\/div>\s*$/, mineHtml + '</div>');
  }

  function buildBetListVerifyHtml(issue) {
    const book = issueBetBook[issue];
    if (!book || !Object.keys(book).length) {
      return `<div class="bjsc-bot-card bjsc-bot-card--bets"><div class="bjsc-bot-card__head"><span class="bjsc-bot-card__title">注单核对</span><span class="bjsc-bot-card__issue">${issue}</span></div><div class="bjsc-bot-empty">本期暂无下注</div></div>`;
    }
    const names = Object.keys(book);
    const users = names.map(name => {
      const bets = book[name];
      const total = bets.reduce((s, b) => s + b.amount, 0);
      const tags = bets.map(b => `<span class="bjsc-bot-tag">${b.play}/${b.amount}</span>`).join('');
      return `<div class="bjsc-bot-user${name === user.name ? ' is-me' : ''}"><div class="bjsc-bot-user__head"><span class="bjsc-bot-user__name">${name}</span><span class="bjsc-bot-user__sum">${total}</span></div><div class="bjsc-bot-user__tags">${tags}</div></div>`;
    }).join('');
    return `<div class="bjsc-bot-card bjsc-bot-card--bets"><div class="bjsc-bot-card__head"><span class="bjsc-bot-card__title">注单核对</span><span class="bjsc-bot-card__issue">${issue}</span></div><div class="bjsc-bot-card__body is-full">${users}</div></div>`;
  }

  function buildWinListVerifyHtml(issue, settled) {
    const pending = settled == null;
    if (pending) {
      return '<div class="bjsc-bot-card bjsc-bot-card--win is-calculating"><div class="bjsc-bot-card__head"><span class="bjsc-bot-card__title">中奖核对</span><span class="bjsc-bot-card__issue">' + issue + '</span></div><div class="bjsc-bot-card__body is-full"><div class="bjsc-bot-calc-line"><span class="bjsc-bot-calc-line__icon" aria-hidden="true"></span><span class="bjsc-bot-calc-line__text">正在核对中奖注单</span></div></div></div>';
    }
    const winners = Object.keys(settled || {}).filter(n => settled[n].some(r => r.winAmount > 0));
    let body = winners.length ? winners.map(name => {
      const winRows = settled[name].filter(r => r.winAmount > 0);
      const totalProfit = settled[name].reduce((s, r) => s + r.profit, 0);
      const tags = winRows.map(r => `<span class="bjsc-bot-tag bjsc-bot-tag--win">${r.play}/${r.amount}</span>`).join('');
      return `<div class="bjsc-bot-user"><div class="bjsc-bot-user__head"><span class="bjsc-bot-user__name">${name}</span><span class="bjsc-bot-user__profit ${totalProfit >= 0 ? 'pos' : 'neg'}">${fmtProfit(totalProfit)}</span></div><div class="bjsc-bot-user__tags">${tags}</div></div>`;
    }).join('') : '<div class="bjsc-bot-empty">本期暂无中奖</div>';
    let mine = '';
    const myRows = settled && settled[user.name];
    if (myRows && myRows.length) {
      const myProfit = myRows.reduce((s, r) => s + r.profit, 0);
      const myWin = myRows.reduce((s, r) => s + r.winAmount, 0);
      const profitCls = myProfit >= 0 ? 'pos' : 'neg';
      const winText = myWin > 0 ? `中奖 +${myWin}` : '未中奖';
      mine = `<div class="bjsc-bot-mine-line ${profitCls}"><span class="bjsc-bot-mine-line__label">您本期</span><span class="bjsc-bot-mine-line__win">${winText}</span><span class="bjsc-bot-mine-line__profit">输赢 ${fmtProfit(myProfit)}</span></div>`;
    }
    return `<div class="bjsc-bot-card bjsc-bot-card--win"><div class="bjsc-bot-card__head"><span class="bjsc-bot-card__title">中奖核对</span><span class="bjsc-bot-card__issue">${issue}</span></div><div class="bjsc-bot-card__body is-full">${body}</div>${mine}</div>`;
  }

  function settleIssue(issue, nums) {
    const book = issueBetBook[issue];
    if (!book || !Object.keys(book).length) return {};
    const out = {};
    Object.keys(book).forEach(name => {
      out[name] = book[name].map(b => ({ play: b.play, amount: b.amount, ...settleBet(b.play, b.amount, nums) }));
    });
    return out;
  }

  function applyUserSettle(issue, settled, nums) {
    const rows = settled[user.name];
    if (rows) {
      let profit = 0;
      let turnover = 0;
      rows.forEach(r => {
        profit += r.profit;
        turnover += r.amount;
        // 真派彩只由 server 账本完成；此处不再 setBalance
      });
      const stats = getStats(user.uid);
      stats.winloss += profit; // 仅展示
      stats.turnover += turnover; // 仅展示
      stats.rebate = (stats.rebate || 0) + Math.floor(turnover * 0.005); // 仅展示
      saveStats(user.uid, stats);
      if (App.refreshBalance) {
        App.refreshBalance().then(function () { refreshStats(); });
      } else {
        refreshStats();
      }
    }
    settleUserBetLog(issue, nums || lastDraw || [], rows);
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

  function ballHtml(n, cls) {
    const c = cls ? ` ${cls}` : '';
    const file = './assets/balls/ball-' + String(n).padStart(2, '0') + '.png';
    return `<span class="bjsc-ball${c}" data-n="${n}"><img class="bjsc-ball__img" src="${file}" alt="${n}" loading="lazy"></span>`;
  }

  function renderCountdownDigits(sec) {
    const s = Math.max(0, Math.ceil(sec));
    const mm = pad(Math.floor(s / 60), 2);
    const ss = pad(s % 60, 2);
    const cells = $('#cdDigits .bjsc-timer__cell');
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
    try { return JSON.parse(localStorage.getItem('bjsc_stats_' + uid)) || { turnover: 0, winloss: 0, rebate: 0 }; } catch (e) { return { turnover: 0, winloss: 0, rebate: 0 }; }
  }
  function saveStats(uid, s) { localStorage.setItem('bjsc_stats_' + uid, JSON.stringify(s)); }
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

  const HISTORY_SHOW = 10;


  function barSummaryHtml(row) {
    return `${row.gy.replace(/\s+/g, '')}<span class="sep">·</span>${row.lh}`;
  }

  /** 顶栏直接显示短期号（服务端已是连续短号） */
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
      <tr><td class="bjsc-draw-table__issue">${r.issue}</td>
      ${r.nums.map(n => `<td>${ballHtml(n, 'tbl')}</td>`).join('')}
      <td class="cell-gy">${r.gy.replace(/\s+/g, '')}</td><td class="cell-lh">${r.lh}</td></tr>`).join(''));
  }

  function resultCardHtml(nums, issue) {
    const meta = gyMeta(nums);
    const lh = lhRow(nums);
    return BjscResultCard.build(nums, issue, meta, lh);
  }

  /** 领奖台合成大致时长（ms）；中奖核对兜底 = 此值 + 余量 */
  function resultRevealDurationMs() {
    return 2500;
  }

  const CHAT_KEEP = 50;
  const chatLog = [];

  function chatStorageKey() {
    const uid = (user && user.uid) ? user.uid : 'guest';
    return 'bjsc_chat_v3_' + uid + (roomNo ? '_' + roomNo : '');
  }
  function saveChatLog() {
    try { localStorage.setItem(chatStorageKey(), JSON.stringify(chatLog.slice(-CHAT_KEEP))); } catch (e) { /* ignore */ }
  }
  function trimChatDom() {
    const $msgs = $('#chatFeed > .bjsc-msg');
    const extra = $msgs.length - CHAT_KEEP;
    if (extra > 0) $msgs.slice(0, extra).remove();
  }
  function escapeHtml(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, function (ch) {
      return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch];
    });
  }

  function scrollChat() {
    const el = document.getElementById('chatFeed');
    if (el) el.scrollTop = el.scrollHeight;
  }

  function appendMsg(opts) {
    const time = opts.time || fmtTime(new Date());
    const avatar = opts.avatarHtml || `<div class="bjsc-msg__avatar"><img src="${fixAvatar(opts.avatar)}" alt=""></div>`;
    const metaOther = `<div class="bjsc-msg__meta"><span class="bjsc-msg__name">${escapeHtml(opts.name)}</span><span class="bjsc-msg__time">${escapeHtml(time)}</span></div>`;
    const metaSelf = `<div class="bjsc-msg__meta"><span class="bjsc-msg__time">${escapeHtml(time)}</span><span class="bjsc-msg__name">${escapeHtml(opts.name)}</span></div>`;
    const bubbleCls = opts.robot ? 'bjsc-msg__bubble bjsc-msg__bubble--bot' : 'bjsc-msg__bubble';
    const bubble = `<div class="${bubbleCls}">${opts.html}</div>`;
    const html = opts.self
      ? `<div class="bjsc-msg is-self"><div class="bjsc-msg__top">${metaSelf}${avatar}</div>${bubble}</div>`
      : `<div class="bjsc-msg${opts.robot ? ' is-robot' : ''}">${avatar}<div class="bjsc-msg__body">${metaOther}${bubble}</div></div>`;
    $('#chatFeed').append(html);
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
      if (list.length && typeof refineUserStatsFromServer === 'function') refineUserStatsFromServer(issue, list);
      if (typeof buildMineLineHtmlFromServer !== 'function' || typeof applyMineLineToWinHtml !== 'function') return;
      const mine = buildMineLineHtmlFromServer(issue, list);
      if (!mine) return;
      const $card = $('#chatFeed').find('.' + "bjsc" + '-bot-card--win').filter(function () {
        return String($(this).find('.' + "bjsc" + '-bot-card__issue').text() || '').trim() === issue;
      }).last().closest('[class*="-msg"]');
      if (!$card.length) return;
      const $bubble = $card.find('[class*="msg__bubble"]').first();
      let h = $bubble.html() || '';
      h = applyMineLineToWinHtml(h, mine);
      $bubble.html(h);
    }).catch(function () {});
  }

  function buildBetVerifyFromPayload(p) {
    return LotteryRoomChat.buildBetVerifyHtml("bjsc", p, {
      escapeHtml: typeof escapeHtml === 'function' ? escapeHtml : undefined,
      userName: user.name,
    });
  }

  function buildWinVerifyFromPayload(p) {
    return LotteryRoomChat.buildWinVerifyHtml("bjsc", p, {
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
        prefix: "bjsc",
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
      const issue = ctx.issue;
      const card = $('#chatFeed .bjsc-bot-card--result, #chatFeed .bjsc-result-card').last()[0];
      if (card && window.BjscResultCard && BjscResultCard.bindStage) {
        if (ctx.animate && ctx.live) {
          ctx.setRevealPending(issue);
          const readyMs = resultRevealDurationMs() + 300;
          BjscResultCard.bindStage(card, function () {
            ctx.markRevealReady(issue);
          });
          ctx.scheduleRevealReady(issue, readyMs);
        } else {
          BjscResultCard.bindStage(card);
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


  function closeNoticeHtml(issue) {
    return `<div class="bjsc-bot-close-line"><div class="bjsc-bot-close-line__bar"><span class="bjsc-bot-close-line__deco"></span><span class="bjsc-bot-close-line__text">封 盘 线</span><span class="bjsc-bot-close-line__deco"></span></div><div class="bjsc-bot-close-line__sub">第 <span class="bjsc-bot-close-line__issue">${issue}</span> 期 · 停止下注 · 即将开奖</div></div>`;
  }


  function avatarFromPool(seed) {
    const n = 1 + (Math.abs(Number(seed) || 0) % 162);
    const ext = (n === 22 || n === 78 || n === 86) ? 'png' : 'jpg';
    return '/images/avatars/' + String(n).padStart(3, '0') + '.' + ext;
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
    while (MOCK_NAMES.length < ROBOT_COUNT) {
      MOCK_NAMES.push({ name: '玩家' + (MOCK_NAMES.length + 1), avatar: avatarFromPool(30 + MOCK_NAMES.length * 9) });
    }
  }
  function recordMockBetLines(name, betText) {
    let ok = false;
    String(betText || '').split(/<br\s*\/?>/i).forEach((line) => {
      const t = String(line || '').trim();
      if (t && recordBet(name, t, { mock: true })) ok = true;
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
    const right = ['删除', '龙', '虎', '冠亚'];
    const mid = [['1', '2', '3'], ['4', '5', '6'], ['7', '8', '9'], ['和', '0', '/']];
    let html = '';
    for (let r = 0; r < 4; r++) {
      html += `<button type="button" class="bjsc-key bjsc-key--side" data-key="${left[r]}">${left[r]}</button>`;
      mid[r].forEach(k => { html += `<button type="button" class="bjsc-key" data-key="${k}">${k}</button>`; });
      const rk = right[r];
      const cls = rk === '删除' ? ' bjsc-key--del' : (rk === '冠亚' ? ' bjsc-key--gy' : ' bjsc-key--side');
      html += `<button type="button" class="bjsc-key${cls}" data-key="${rk}">${rk}</button>`;
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
    const $room = $('.bjsc-room');
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
      clearUserPendingBetLog(issue);
      const refunded = res && res.refunded != null ? res.refunded : 0;
      const count = res && res.count != null ? res.count : 0;
      appendMsg({ name: user.name, avatar: fixAvatar(user.avatar), self: true, html: '已取消本期注单' });
      $('#chatInput').val('');
      updateComposerAction();
      showKeypad(false);
      App.toast(count ? ('已取消 ' + count + ' 注，退回 ' + refunded) : '已取消本期注单');
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
    $('#drawToggle').attr('aria-expanded', drawPanelOpen);
  }

  function toggleDrawPanel() {
    setDrawPanelOpen(!drawPanelOpen);
  }

  function pushRandomBet() {
    if (!MOCK_NAMES.length || !isBettingOpen()) return;
    const n = MOCK_NAMES[Math.floor(Math.random() * MOCK_NAMES.length)];
    const betText = randomMockBetText();
    appendMsg({ name: n.name, avatar: n.avatar, html: betText });
    recordMockBetLines(n.name, betText);
  }

  /* ================= 玩法面板 ================= */
  const AMOUNT_CHIPS = [10, 20, 50, 100, 200, 500];
  const PLAY_CATEGORIES = [
    {
      id: 'gySide', title: '冠亚两面', hint: () => `冠亚和 3-11 小 · 12-19 大 · 赔率 ${ODDS.side}`,
      subs: null,
      items: ['冠亚大', '冠亚小', '冠亚单', '冠亚双'].map(p => ({ play: p, label: p, odds: ODDS.side }))
    },
    {
      id: 'posSide', title: '名次两面', hint: () => `赛道 1234567890 · 如 12345单/100 · 赔率 ${ODDS.side}`,
      subs: null,
      sideGroups: Array.from({ length: 10 }, (_, i) => {
        const t = i === 9 ? '0' : String(i + 1);
        return { label: '赛道' + t, prefix: t, odds: ODDS.side };
      })
    },
    {
      id: 'lhh', title: '龙虎', hint: () => `1龙=第1组 · 可多选 · 赔率 ${ODDS.dragon}`,
      subs: null,
      items() {
        const list = [];
        LHH_PAIRS.forEach(([a, b]) => {
          const pr = (a + 1) + 'v' + (b + 1);
          ['龙', '虎'].forEach(x => list.push({ play: pr + x, label: x, pair: pr, odds: ODDS.dragon }));
        });
        return list;
      }
    },
    {
      id: 'gySum', title: '冠亚和值', hint: '猜冠亚军号码之和 3-19',
      subs: null,
      items: Array.from({ length: 17 }, (_, i) => {
        const sum = i + 3;
        return { play: '冠亚和' + sum, label: String(sum), odds: GY_SUM_ODDS[sum] || 8.91 };
      })
    },
    {
      id: 'position', title: '定位车号', hint: () => `赛道/车号 · 如 12345/12345/100 · 赔率 ${ODDS.position}`,
      subs: null,
      mode: 'positionNum',
      odds: ODDS.position
    }
  ];

  let playCatIdx = 0;
  let playSubIdx = 0;
  let playSelectedList = [];
  let playAllin = false;

  function playAmountStep(val) {
    const n = parseInt(val, 10) || 0;
    if (n >= 500) return 100;
    if (n >= 100) return 50;
    return 10;
  }

  function clearPlayAmountChipActive() {
    $('#playAmountChips .bjsc-play-foot__chip').removeClass('is-active');
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
  function updatePlaySelected() {
    if (!playSelectedList.length) {
      $('#playSelected').text('—');
      $('#playClear').prop('disabled', true);
      return;
    }
    $('#playClear').prop('disabled', false);
    const preview = playSelectedList.slice(0, 3).join('、');
    $('#playSelected').text(playSelectedList.length > 3 ? `${preview}… 共${playSelectedList.length}项` : preview);
  }

  function clearPlaySelection() {
    if (!playSelectedList.length) return;
    playSelectedList = [];
    renderPlayPanel();
    updatePlaySelected();
  }

  function initPlaySheet() {
    $('#playNav').html(PLAY_CATEGORIES.map((c, i) =>
      `<button type="button" class="bjsc-play-nav__item${i === playCatIdx ? ' is-active' : ''}" data-idx="${i}">${c.title}</button>`
    ).join(''));
    $('#playAmountChips').html(AMOUNT_CHIPS.map(a =>
      `<button type="button" class="bjsc-play-foot__chip${a === 100 ? ' is-active' : ''}" data-amt="${a}">${a}</button>`
    ).join(''));
  }

  function playItemHtml(play, label, odds, extraCls) {
    const cls = ['bjsc-play-item', extraCls, isPlaySelected(play) ? 'is-active' : ''].filter(Boolean).join(' ');
    const oddsHtml = odds != null ? `<small>${odds}</small>` : '';
    return `<button type="button" class="${cls}" data-play="${play}"><span>${label}</span>${oddsHtml}</button>`;
  }

  function playNumItemHtml(posName, n) {
    const play = String(posName).includes('/') ? String(posName) : (String(posName) + n);
    const cls = ['bjsc-play-item', 'bjsc-play-item--num', isPlaySelected(play) ? 'is-active' : ''].filter(Boolean).join(' ');
    return `<button type="button" class="${cls}" data-play="${play}">${ballHtml(n, 'play')}</button>`;
  }

  function renderPlayPanel() {
    const cat = currentPlayCat();
    const $grid = $('#playGrid');
    $('#playHint').text(typeof cat.hint === 'function' ? cat.hint() : cat.hint);
    const $sub = $('#playSub');
    if (cat.subs && cat.subs.length) {
      $sub.removeClass('is-hidden').prop('hidden', false).html(
        cat.subs.map((s, i) => `<button type="button" class="bjsc-play-sub__btn${i === playSubIdx ? ' is-active' : ''}" data-sub="${i}">${s}</button>`).join('')
      );
    } else {
      $sub.addClass('is-hidden').prop('hidden', true).empty();
    }

    let html = '';
    let gridMode = '';

    if (cat.id === 'gySide') {
      gridMode = 'is-gy-side';
      const items = typeof cat.items === 'function' ? cat.items() : cat.items;
      html = items.map(it => {
        const short = it.label.replace(/^冠亚/, '');
        return playItemHtml(it.play, short, it.odds, 'bjsc-play-item--side');
      }).join('');
    } else if (cat.id === 'posSide' && cat.sideGroups) {
      gridMode = 'is-pos-num';
      html = cat.sideGroups.map(g => {
        const cells = ['大', '小', '单', '双'].map(side =>
          playItemHtml(g.prefix + side, side, g.odds, 'bjsc-play-item--side')
        ).join('');
        return `<div class="bjsc-play-pos-block bjsc-play-pos-block--side">
          <div class="bjsc-play-pos-block__head">
            <span class="bjsc-play-pos-block__title">${g.label}</span>
            <span class="bjsc-play-pos-block__hint">大小单双 · ${g.odds}</span>
          </div>
          <div class="bjsc-play-pos-block__side">${cells}</div>
        </div>`;
      }).join('');
    } else if (cat.id === 'lhh') {
      gridMode = 'is-lhh';
      html = LHH_PAIRS.map((_, i) => {
        const n = i + 1;
        const cells = ['龙', '虎'].map(pick =>
          playItemHtml(n + pick, pick, ODDS.dragon, 'bjsc-play-item--lhh')
        ).join('');
        return `<div class="bjsc-play-lhh-row"><span class="bjsc-play-lhh-row__label">${n}组</span>${cells}</div>`;
      }).join('');
    } else if (cat.id === 'position' && cat.mode === 'positionNum') {
      gridMode = 'is-pos-num';
      html = Array.from({ length: 10 }, (_, i) => {
        const t = trackLabel(i);
        const nums = Array.from({ length: 10 }, (_, d) => playNumItemHtml(t + '/' + carLabel(d + 1), d + 1)).join('');
        return `<div class="bjsc-play-pos-block">
          <div class="bjsc-play-pos-block__head">
            <span class="bjsc-play-pos-block__title">赛道${t}</span>
            <span class="bjsc-play-pos-block__hint">选该车号 · 赔率 ${cat.odds}</span>
          </div>
          <div class="bjsc-play-pos-block__nums">${nums}</div>
        </div>`;
      }).join('');
    } else {
      const items = typeof cat.items === 'function' ? cat.items() : cat.items;
      html = (items || []).map(it => playItemHtml(it.play, it.label, it.odds)).join('');
    }

    $grid.attr('class', `bjsc-play-panel__grid${gridMode ? ' ' + gridMode : ''}`).html(html);
    $grid.scrollTop(0);
  }


  /** 玩法面板顶边对齐历史开奖栏下沿，盖住聊天区、露出倒计时 */
  function layoutPlayOverlay() {
    const bar = document.getElementById('drawBar');
    let top = 210;
    if (bar) {
      const rect = bar.getBoundingClientRect();
      top = Math.max(120, Math.ceil(rect.bottom + 4));
    }
    document.documentElement.style.setProperty('--bjsc-play-top', top + 'px');
  }
  function openPlaySheet(open, catId) {
    const $room = $('.bjsc-room');
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
      $('#playAmountChips .bjsc-play-foot__chip[data-amt="100"]').addClass('is-active');
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
    if ($('#playSheet').hasClass('is-open')) layoutPlayOverlay();
  });

  function submitPlayBet() {
    if (!isBettingOpen()) { toastBetBlocked('bet'); return; }
    const plays = playSelectedList.filter(p => parsePlay(p));
    if (!plays.length) { App.toast('请选择玩法'); return; }
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
    $('#playNav').on('click', '.bjsc-play-nav__item', function () {
      playCatIdx = +$(this).data('idx');
      playSubIdx = 0;
      $('#playNav .bjsc-play-nav__item').removeClass('is-active');
      $(this).addClass('is-active');
      renderPlayPanel();
    });
    $('#playSub').on('click', '.bjsc-play-sub__btn', function () {
      playSubIdx = +$(this).data('sub');
      $('#playSub .bjsc-play-sub__btn').removeClass('is-active');
      $(this).addClass('is-active');
      renderPlayPanel();
    });
    $('#playGrid').on('click', '.bjsc-play-item', function () {
      const play = $(this).data('play');
      togglePlaySelect(play);
      $(this).toggleClass('is-active', isPlaySelected(play));
      updatePlaySelected();
    });
    $('#playAmountChips').on('click', '.bjsc-play-foot__chip', function () {
      setPlayAmount(+$(this).data('amt'));
      clearPlayAmountChipActive();
      $(this).addClass('is-active');
    });
    $('#playAmountMinus').on('click', () => {
      const cur = parseInt($('#playAmount').val(), 10) || 100;
      const step = playAmountStep(cur);
      setPlayAmount(cur - step);
      clearPlayAmountChipActive();
    });
    $('#playAmountPlus').on('click', () => {
      const cur = parseInt($('#playAmount').val(), 10) || 0;
      const step = playAmountStep(cur);
      setPlayAmount(cur + step);
      clearPlayAmountChipActive();
    });
    $('#playRepeat').on('click', () => {
      openPlaySheet(false);
      repeatLastBet();
    });
    $('#playAmount').on('input', () => {
      if (playAllin) return;
      clearPlayAmountChipActive();
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
      '<span class="bjsc-long-road__chip ' + longTagClass(tag) + (i === 0 ? ' is-latest' : '') + '">' + tag + '</span>'
    ).join('');
    return '<div class="bjsc-long-road"><div class="bjsc-long-road__label">近 ' + labels.length + ' 期走势 · 左新右旧</div><div class="bjsc-long-road__row">' + chips + '</div></div>';
  }

  function currentShapeHtml(items) {
    if (!items.length) return '';
    const cards = items.slice(0, 6).map(item => {
      const play = item.play || playForLongName((item.group || '') + item.name) || '';
      const playAttr = play ? ' data-predict-play="' + play + '"' : '';
      const clickable = playAttr ? ' is-clickable' : '';
      return '<div class="bjsc-long-shape' + clickable + '"' + playAttr + (playAttr ? ' role="button" tabindex="0"' : '') + '>' +
        '<span class="bjsc-long-shape__group">' + (item.group || '') + '</span>' +
        '<span class="bjsc-long-shape__tag ' + longTagClass(item.name) + '">' + item.name + '</span>' +
        '<span class="bjsc-long-shape__count">' + item.count + '<small>连</small></span></div>';
    }).join('');
    return '<div class="bjsc-long-shape-wrap"><div class="bjsc-long-road__label">当前形态</div><div class="bjsc-long-shape-grid">' + cards + '</div></div>';
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
    return `<div class="bjsc-long-item__bar"><span style="width:${pct}%"></span></div>`;
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
        <div class="bjsc-long-empty">
          <div class="bjsc-long-empty__icon">◎</div>
          <div class="bjsc-long-empty__text">暂无开奖数据</div>
          <div class="bjsc-long-empty__hint">接入官方开奖后会自动统计长龙</div>
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
        <div class="bjsc-long-hero ${longTierClass(top.count)}">
          <div class="bjsc-long-hero__label">当前最长</div>
          <div class="bjsc-long-hero__main">
            <span class="bjsc-long-hero__tag ${longTagClass(top.name)}">${top.name}</span>
            <span class="bjsc-long-hero__text">${top.group || ''}</span>
            <span class="bjsc-long-hero__num">${top.count}</span>
            <span class="bjsc-long-hero__unit">期</span>
          </div>
        </div>`;
    }
    const listHtml = list.length
      ? `<div class="bjsc-long-list">${list.map((item, idx) => {
          const play = item.play || playForLongName((item.group || '') + item.name) || '';
          const click = play ? ` data-predict-play="${play}" role="button" tabindex="0"` : '';
          return `
        <div class="bjsc-long-item ${longTierClass(item.count)}${click ? ' is-clickable' : ''}"${click}>
          <div class="bjsc-long-item__rank">${idx + 1}</div>
          <div class="bjsc-long-item__tag ${longTagClass(item.name)}">${item.name}</div>
          <div class="bjsc-long-item__info">
            <div class="bjsc-long-item__name">${item.group || ''}<span class="sep">·</span>${item.name}</div>
            ${longStreakBar(item.count)}
          </div>
          <div class="bjsc-long-item__count"><b>${item.count}</b><small>连</small></div>
        </div>`;
        }).join('')}</div>`
      : `<div class="bjsc-long-empty bjsc-long-empty--soft">
          <div class="bjsc-long-empty__text">暂无 2 期以上长龙</div>
          <div class="bjsc-long-empty__hint">下方仍可看近期走势与当前形态</div>
        </div>`;
    $('#longBody').html(hero + roadHtml(roadLabelsForTab(longTab)) + currentShapeHtml(all) + listHtml);
  }

  function openLongSheet(open) {
    const $room = $('.bjsc-room');
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
    return `<div class="bjsc-predict-card is-clickable"${playAttr} role="button" tabindex="0">
      <div class="bjsc-predict-card__name">${name}</div>
      <div class="bjsc-predict-card__pick">
        <span class="bjsc-predict-card__tag ${predictTagClass(data.pick)}">${data.pick}</span>
        <span class="bjsc-predict-card__conf">${pct}%</span>
      </div>
      <div class="bjsc-predict-card__reason">${data.reason}</div>
      <div class="bjsc-predict-card__bar"><span style="width:${pct}%"></span></div>
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
        <div class="bjsc-long-empty">
          <div class="bjsc-long-empty__icon">◎</div>
          <div class="bjsc-long-empty__text">暂无开奖数据</div>
          <div class="bjsc-long-empty__hint">等待开奖后生成预测</div>
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
        <div class="bjsc-predict-hero">
          <div class="bjsc-predict-hero__label">核心参考</div>
          <div class="bjsc-predict-hero__main">
            <div class="bjsc-predict-hero__tags">
              <span class="bjsc-predict-card__tag ${predictTagClass(champBig.pick)} is-clickable" data-predict-play="1${champBig.pick}" role="button" tabindex="0">赛道1${champBig.pick}</span>
              <span class="bjsc-predict-card__tag ${predictTagClass(champOdd.pick)} is-clickable" data-predict-play="1${champOdd.pick}" role="button" tabindex="0">赛道1${champOdd.pick}</span>
            </div>
            <div class="bjsc-predict-hero__note">赛道1倾向 ${champBig.pick}${champOdd.pick}，${champBig.reason}</div>
          </div>
        </div>`;
      $('#predictBody').html(hero + `<div class="bjsc-predict-grid">${cards.join('')}</div>`);
      return;
    }

    if (predictTab === 'num') {
      const cols = POS_NAMES.map((pos, idx) => {
        const stat = buildDigitPredict(rows, idx);
        const hotHtml = stat.hot.length
          ? stat.hot.map(x =>
            `<span class="bjsc-ball-digit is-clickable" data-predict-play="${pos}${x.d}" role="button" tabindex="0">${x.d}</span>`
          ).join('')
          : '<span class="bjsc-predict-card__reason">—</span>';
        const coldHtml = stat.cold.map(x =>
          `<span class="bjsc-ball-digit is-cold is-clickable" data-predict-play="${pos}${x.d}" role="button" tabindex="0">${x.d}</span>`
        ).join('');
        return `<div class="bjsc-predict-digit-col">
          <div class="bjsc-predict-digit-col__pos">${pos}</div>
          <div class="bjsc-predict-digit-col__label">热号</div>
          <div class="bjsc-predict-digit-balls">${hotHtml}</div>
          <div class="bjsc-predict-digit-col__label">遗漏</div>
          <div class="bjsc-predict-digit-balls">${coldHtml}</div>
        </div>`;
      }).join('');
      $('#predictBody').html(`
        <div class="bjsc-predict-hero">
          <div class="bjsc-predict-hero__label">定位参考</div>
          <div class="bjsc-predict-hero__note">近 ${Math.min(PREDICT_WINDOW, rows.length)} 期各名次热号与遗漏号，可作定位车号参考</div>
        </div>
        <div class="bjsc-predict-digit-grid">${cols}</div>`);
      return;
    }

    const gyRows = rows.map(r => gyMeta(r.nums));
    const sizeData = pickByTrend(gyRows.map(m => m.size), PREDICT_STREAK_BREAK);
    const oddData = pickByTrend(gyRows.map(m => m.parity), PREDICT_STREAK_BREAK);
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
      <div class="bjsc-predict-hero">
        <div class="bjsc-predict-hero__label">冠亚参考</div>
        <div class="bjsc-predict-hero__main">
          <div class="bjsc-predict-hero__tags">
            <span class="bjsc-predict-card__tag ${predictTagClass(sizeData.pick)} is-clickable" data-predict-play="冠亚${sizeData.pick}" role="button" tabindex="0">冠亚${sizeData.pick}</span>
            <span class="bjsc-predict-card__tag ${predictTagClass(oddData.pick)} is-clickable" data-predict-play="冠亚${oddData.pick}" role="button" tabindex="0">冠亚${oddData.pick}</span>
          </div>
          <div class="bjsc-predict-hero__note">${sizeData.reason}</div>
        </div>
      </div>`;
    $('#predictBody').html(hero
      + `<div class="bjsc-predict-grid">${predictCardHtml('冠亚 · 大小', sizeData, '冠亚' + sizeData.pick)}${predictCardHtml('冠亚 · 单双', oddData, '冠亚' + oddData.pick)}</div>`
      + `<div class="bjsc-predict-hero" style="margin-top:12px"><div class="bjsc-predict-hero__label">热和值</div></div>`
      + `<div class="bjsc-predict-grid">${sumCards}</div>`
      + `<div class="bjsc-predict-hero" style="margin-top:12px"><div class="bjsc-predict-hero__label">龙虎走势</div></div>`
      + `<div class="bjsc-predict-grid">${lhhCards}</div>`);
  }

  function openPredictSheet(open) {
    const $room = $('.bjsc-room');
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
    const $room = $('.bjsc-room');
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
      return { issue: String(row.issueNo || ''), nums, gy: nums.length === 10 ? gyMeta(nums).text : '', lh: nums.length === 10 ? lhRow(nums) : '' };
    }).filter(r => r.issue && r.nums.length === 10);
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
      if (serverCurrent && serverCurrent.issueNo) setCurIssueDisplay(String(serverCurrent.issueNo));
      if (rows[0]) {
        revealedIssues.add(rows[0].issue);
        saveRevealedIssues();
        historyHeadBootstrapped = true;
      }
      if ($('#longSheet').hasClass('is-open')) renderLongDragonPanel();
      if ($('#predictSheet').hasClass('is-open')) renderPredictPanel();
    }).catch(function () { /* static H5 */ }).finally(function () { snapshotBusy = false; });
  }

  function tick() {
    if (serverSynced && serverCurrent) {
      const lockAt = new Date(serverCurrent.lockAt).getTime();
      const openAt = new Date(serverCurrent.openAt).getTime();
      const issueCur = String(serverCurrent.issueNo || '');
      const open = serverCurrent.status === 'PENDING' && Date.now() < lockAt;
      setCurIssueDisplay(issueCur);
      updateCountdownUI(open ? Math.max(0, (lockAt - Date.now()) / 1000) + PREP_SEC : Math.max(0, (openAt - Date.now()) / 1000));
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

  $('#backBtn').on('click', () => {
    if (App.backToLobby) App.backToLobby();
    else App.go('../../client-app/pages/game-lobby/game-lobby.html' + q);
  });
  window.addEventListener('gamebox-balance', function () { refreshStats(); });
  /* === chat-rail handlers (bjsc) === */

  function openRulesSheet(open) {
    if (open) {
      const o = ODDS;
      const betSec = INTERVAL - PREP_SEC;
      const gyHint = '3～11 小 · 12～19 大；奇单偶双';
      const html = `
        <div class="bjsc-rules-sec">
          <h3 class="bjsc-rules-sec__title">一、开奖与时间</h3>
          <p>北京赛车每期开出 <b>1～10</b> 共十个不重复名次（冠军→第十）。</p>
          <p>每期共 <b>${INTERVAL} 秒</b>：可下注 <b>${betSec} 秒</b>，提前 <b>${PREP_SEC} 秒</b> 封盘。顶栏「距封盘 / 距开奖」；封盘后不可下注、不可取消。</p>
          <p>开奖结果与派彩以服务端账本为准。</p>
        </div>
        <div class="bjsc-rules-sec">
          <h3 class="bjsc-rules-sec__title">二、如何下注</h3>
          <p>支持三种方式：</p>
          <ul>
            <li>点右侧 / 底部「玩法」面板点选后投注</li>
            <li>底部输入口令：<b>玩法/金额</b>（空格可下多注）</li>
            <li>键盘快捷：上分、取消、梭哈、重复、下分</li>
          </ul>
          <span class="bjsc-rules-ex">冠亚大/100　1龙/50　1单/80　1/5/100</span>
          <span class="bjsc-rules-ex">冠亚和12/100　12345/12345/100　龙/梭哈</span>
          <p>「梭哈」按余额均分；玩法脚「重复」可跟上一笔。底部「+」含上下分、申请记录、竞猜报表等入口。</p>
        </div>
        <div class="bjsc-rules-sec">
          <h3 class="bjsc-rules-sec__title">三、玩法与赔率</h3>
          <p>下列为当前房间赔率（随后台更新）。派彩 = 金额 × 赔率（向下取整）。</p>
          <table class="bjsc-rules-table">
            <thead><tr><th>玩法</th><th>说明</th><th>赔率</th></tr></thead>
            <tbody>
              <tr><td>冠亚两面</td><td>猜冠亚军号码之和的大小单双（${gyHint}）</td><td>${o.side}</td></tr>
              <tr><td>名次两面</td><td>指定名次（或赛道口令）猜大(≥6)/小(≤5)/单/双</td><td>${o.side}</td></tr>
              <tr><td>龙虎</td><td>五组对位：1龙9虎、2龙8虎…5龙6虎；也可只打「龙」「虎」默认第1组</td><td>${o.dragon}</td></tr>
              <tr><td>冠亚和值</td><td>猜冠亚军号码之和（3～19），各和值赔率不同</td><td>见玩法面板</td></tr>
              <tr><td>定位车号</td><td>猜指定名次开出的车号；可多选名次/号码</td><td>${o.position}</td></tr>
            </tbody>
          </table>
        </div>

        <div class="bjsc-rules-sec">
          <h3 class="bjsc-rules-sec__title">四、取消与结算</h3>
          <p>当期未封盘前可输入「取消」或点键盘「取消」，撤销本人本期未结算注单；封盘后不可取消。</p>
          <p>开奖后房间会推送结果卡与注单/中奖核对；积分变动以服务端派彩为准。顶部「输赢 / 流水 / 回水」为房间会话统计参考。</p>
        </div>
        <div class="bjsc-rules-sec">
          <h3 class="bjsc-rules-sec__title">五、温馨提示</h3>
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
    App.go('../../client-app/pages/bet-records/bet-records.html' + q + sep + 'game=bjsc');
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
  $('#keyGrid').on('click', '.bjsc-key', function () {
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
  $('#keyGrid').on('pointerdown', '.bjsc-key', function (e) {
    if ($(this).attr('data-key') !== '删除') return;
    e.preventDefault();
    stopDeleteHold();
    insertInput('删除');
    delHoldTimer = setTimeout(() => {
      delHoldInterval = setInterval(() => insertInput('删除'), 55);
    }, 380);
  });
  $('#keyGrid').on('pointerup pointerleave pointercancel', '.bjsc-key', function () {
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
    if (drawPanelOpen && !$(e.target).closest('#drawBar').length) {
      setDrawPanelOpen(false);
    }
    if (Date.now() < keypadGuardUntil) return;
    if (!$(e.target).closest('#keypad, #chatInput, .bjsc-composer').length && $('#keypad').is(':visible')) {
      if (!$(e.target).closest('.bjsc-plus-menu, #plusBtn, .bjsc-menu-mask').length) showKeypad(false);
    }
  });
  updateComposerAction();
});
