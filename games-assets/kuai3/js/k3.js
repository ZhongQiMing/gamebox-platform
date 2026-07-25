/**
 * 1分快三 · 聊天投注房
 * 3 颗骰子 · 55s 一期（45s 下注 + 10s 准备中，与服务端 lockAt 对齐）
 * BUILD 51 — 与 index.html ?v= 保持一致
 */
$(function () {
  const INTERVAL = 55;
  const PREP_SEC = 10;

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
    if (url.startsWith('/')) return url;
    return fallback;
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
    return `<div class="k3-msg__avatar k3-msg__avatar--gen" style="--av-hue:${hue}"><span>${ch}</span></div>`;
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
  const SERVER_GAME = 'kuai3';

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
  const REVEALED_STORAGE_KEY = 'k3_revealed_v1';
  const CLOSED_STORAGE_KEY = 'k3_closed_v1';
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
  const ROBOT_COUNT = 10;

  const ODDS = {
    side: 1.98,
    sum: 6.5, // 兜底；实际按 SUM_ODDS 分档
    dice: 2.0, // 出现 1 次基准；结算按出现次数 2/3/4
    pairN: 10,
    tripletN: 150,
    tripletAny: 24,
    straight: 8,
    alldiff: 1.95,
    long: 5.8,
  };
  /** 和值分档赔率（含本返还） */
  const SUM_ODDS = {
    4: 50, 5: 18, 6: 14, 7: 12, 8: 8, 9: 6.5, 10: 6,
    11: 6, 12: 6.5, 13: 8, 14: 12, 15: 14, 16: 18, 17: 50,
  };

  function applyServerPayTable(pt) {
    if (!pt) return;
    ODDS.side = mulOf(pt, 'big', ODDS.side);
    ODDS.sum = mulOf(pt, 'sum', ODDS.sum);
    ODDS.dice = mulOf(pt, 'dice1', ODDS.dice);
    ODDS.pairN = mulOf(pt, 'pair', ODDS.pairN);
    ODDS.tripletN = mulOf(pt, 'tripletN', ODDS.tripletN);
    ODDS.tripletAny = mulOf(pt, 'triplet', ODDS.tripletAny);
    ODDS.straight = mulOf(pt, 'straight', ODDS.straight);
    ODDS.alldiff = mulOf(pt, 'alldiff', ODDS.alldiff);
    ODDS.long = mulOf(pt, 'long', ODDS.long);
    for (let n = 4; n <= 17; n++) {
      SUM_ODDS[n] = mulOf(pt, 'sum_' + n, SUM_ODDS[n]);
    }
  }
  const SUOHA_WORDS = new Set(['梭哈', '全下', 'allin']);
  const SIDE_CHARS = '大小单双';
  const DICE_CHARS = '123456';

  function pickOne(arr) {
    return arr[Math.floor(Math.random() * arr.length)];
  }

  /** 各种金额都可能出现，不刻意凑整十/整百 */
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
    if (roll < 0.24) return `${pickOne(['大', '小', '单', '双'])}/${amt}`;
    if (roll < 0.4) return `和${pickOne([4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17])}/${amt}`;
    if (roll < 0.55) return `三军${1 + Math.floor(Math.random() * 6)}/${amt}`;
    if (roll < 0.68) return `二同${1 + Math.floor(Math.random() * 6)}/${amt}`;
    if (roll < 0.8) return `${pickOne(['三同号', '三连号', '三不同号'])}/${amt}`;
    if (roll < 0.9) {
      const pairs = longPairs();
      const p = pairs[Math.floor(Math.random() * pairs.length)];
      return `${p.play}/${amt}`;
    }
    const side = pickOne(['大', '小', '单', '双']);
    const dice = `三军${1 + Math.floor(Math.random() * 6)}`;
    const a = Math.max(10, Math.min(amt - 1, Math.floor(amt * (0.35 + Math.random() * 0.25))));
    const b = Math.max(1, amt - a);
    return `${side}/${a}<br>${dice}/${b}`;
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

  function isTriplet(nums) {
    return nums[0] === nums[1] && nums[1] === nums[2];
  }

  function countOf(nums, n) {
    return nums.filter(x => x === n).length;
  }

  function isStraightShape(nums) {
    if (isTriplet(nums)) return false;
    const s = nums.slice().sort((a, b) => a - b);
    return s[0] + 1 === s[1] && s[1] + 1 === s[2];
  }

  function isPairShape(nums) {
    if (isTriplet(nums)) return false;
    return nums[0] === nums[1] || nums[1] === nums[2] || nums[0] === nums[2];
  }

  function isSanButong(nums) {
    if (isTriplet(nums) || isPairShape(nums) || isStraightShape(nums)) return false;
    return true;
  }

  function longPairs() {
    const out = [];
    for (let a = 1; a <= 6; a++) {
      for (let b = a + 1; b <= 6; b++) out.push({ a, b, play: '长牌' + a + b });
    }
    return out;
  }

  function sumMeta(nums) {
    const sum = nums.reduce((a, b) => a + b, 0);
    const triplet = isTriplet(nums);
    let size = '—';
    if (!triplet) size = sum >= 11 ? '大' : '小';
    const parity = sum % 2 ? '单' : '双';
    const text = triplet ? `${sum} 豹` : `${sum} ${size} ${parity}`;
    return { sum, text, size, parity, triplet };
  }

  function shapeRow(nums) {
    if (isTriplet(nums)) return '三同号';
    if (isPairShape(nums)) return '二同号';
    if (isStraightShape(nums)) return '三连号';
    return '三不同号';
  }

  function diceHtml(n, cls) {
    return K3ResultCard.diceHtml(n, cls);
  }

  function predictDiceBtn(n, cold) {
    const coldCls = cold ? ' is-cold' : '';
    return `<button type="button" class="k3-predict-dice-btn${coldCls}" data-predict-play="三军${n}">${diceHtml(n, 'sm')}</button>`;
  }

  function parsePlay(raw) {
    const t = String(raw || '').replace(/\s+/g, '');
    let m;
    if ((m = t.match(/^(大|小|单|双)$/))) return { type: 'side', side: m[1], odds: ODDS.side };
    if ((m = t.match(/^和(?:值)?([4-9]|1[0-7])$/))) {
      const sum = +m[1];
      return { type: 'sum', sum, odds: SUM_ODDS[sum] || ODDS.sum };
    }
    if ((m = t.match(/^三军([1-6])$/))) return { type: 'dice', num: +m[1], odds: ODDS.dice };
    if ((m = t.match(/^独([1-6])$/))) return { type: 'dice', num: +m[1], odds: ODDS.dice };
    if ((m = t.match(/^二同(?:号)?([1-6])$/))) return { type: 'pairN', num: +m[1], odds: ODDS.pairN };
    if ((m = t.match(/^三同([1-6])$/))) return { type: 'tripletN', num: +m[1], odds: ODDS.tripletN };
    if ((m = t.match(/^三同号([1-6])$/))) return { type: 'tripletN', num: +m[1], odds: ODDS.tripletN };
    if (t === '三同' || t === '三同号' || t === '豹子' || t === '豹') {
      return { type: 'tripletAny', odds: ODDS.tripletAny };
    }
    if ((m = t.match(/^三连([1-6]{3})$/))) {
      const a = +m[1][0];
      const b = +m[1][1];
      const c = +m[1][2];
      if (a + 1 === b && b + 1 === c) {
        return { type: 'straightN', a, b, c, odds: ODDS.straight };
      }
      return null;
    }
    if (t === '三连号' || t === '顺子' || t === '三连') return { type: 'straight', odds: ODDS.straight };
    if (t === '三不同号' || t === '三不同' || t === '杂六') return { type: 'alldiff', odds: ODDS.alldiff };
    if ((m = t.match(/^长牌([1-6])([1-6])$/))) {
      const a = +m[1];
      const b = +m[2];
      if (a !== b) {
        return { type: 'long', a: Math.min(a, b), b: Math.max(a, b), odds: ODDS.long };
      }
    }
    return null;
  }

  function mapPlayToServer(play) {
    const p = parsePlay(play);
    if (!p) return null;
    if (p.type === 'side') {
      const sideMap = { '大': 'big', '小': 'small', '单': 'odd', '双': 'even' };
      const betType = sideMap[p.side];
      return betType ? { betType: betType } : null;
    }
    if (p.type === 'sum') return { betType: 'sum', betValue: String(p.sum) };
    if (p.type === 'tripletAny') return { betType: 'triplet' };
    if (p.type === 'tripletN') return { betType: 'tripletN', betValue: String(p.num) };
    if (p.type === 'dice') return { betType: 'dice', betValue: String(p.num) };
    if (p.type === 'pairN') return { betType: 'pair', betValue: String(p.num) };
    if (p.type === 'straight') return { betType: 'straight', betValue: 'any' };
    if (p.type === 'straightN') return { betType: 'straight', betValue: String(p.a) + String(p.b) + String(p.c) };
    if (p.type === 'alldiff') return { betType: 'alldiff' };
    if (p.type === 'long') return { betType: 'long', betValue: p.a + ':' + p.b };
    return null;
  }

  function mapLinesToServerBets(lines) {
    const bets = [];
    const unsupported = [];
    lines.forEach(function (l) {
      const m = mapPlayToServer(l.play);
      if (!m) unsupported.push(l.play);
      else {
        const row = { betType: m.betType, amount: l.amount };
        if (m.betValue != null) row.betValue = m.betValue;
        bets.push(row);
      }
    });
    return { bets: bets, unsupported: unsupported };
  }

  function settleBet(play, amount, nums) {
    const p = parsePlay(play);
    if (!p) return { winAmount: 0, profit: -amount, hit: '' };
    const triplet = isTriplet(nums);
    const meta = sumMeta(nums);
    let win = false;
    switch (p.type) {
      case 'side':
        if (!triplet) {
          if (p.side === '大') win = meta.sum >= 11 && meta.sum <= 17;
          else if (p.side === '小') win = meta.sum >= 4 && meta.sum <= 10;
          else if (p.side === '单') win = meta.sum % 2 === 1;
          else win = meta.sum % 2 === 0;
        }
        break;
      case 'sum':
        win = meta.sum === p.sum;
        break;
      case 'dice': {
        const c = countOf(nums, p.num);
        if (c <= 0) return { winAmount: 0, profit: -amount, hit: '' };
        const diceOdds = c === 1 ? 2 : (c === 2 ? 3 : 4);
        const winAmount = Math.floor(amount * diceOdds);
        return { winAmount, profit: winAmount - amount, hit: play };
      }
      case 'pairN':
        win = countOf(nums, p.num) === 2;
        break;
      case 'tripletN':
        win = countOf(nums, p.num) === 3;
        break;
      case 'tripletAny':
        win = triplet;
        break;
      case 'straight':
        win = isStraightShape(nums);
        break;
      case 'straightN': {
        const got = nums.slice().sort((a, b) => a - b);
        win = got[0] === p.a && got[1] === p.b && got[2] === p.c;
        break;
      }
      case 'alldiff':
        win = isSanButong(nums);
        break;
      case 'long':
        win = nums.includes(p.a) && nums.includes(p.b);
        break;
    }
    if (!win) return { winAmount: 0, profit: -amount, hit: '' };
    const winAmount = Math.floor(amount * p.odds);
    return { winAmount, profit: winAmount - amount, hit: play };
  }

  function uniqueDiceDigits(s) {
    const out = [];
    const seen = new Set();
    for (const c of String(s || '')) {
      if (!DICE_CHARS.includes(c) || seen.has(c)) continue;
      seen.add(c);
      out.push(+c);
    }
    return out;
  }

  function expandDicePrefix(prefix, digitStr) {
    const digits = uniqueDiceDigits(digitStr);
    if (!digits.length) return null;
    const plays = [];
    digits.forEach((n) => {
      const play = prefix + n;
      if (parsePlay(play)) plays.push(play);
    });
    return plays.length ? plays : null;
  }

  function expandLongCombo(digitStr) {
    const digits = uniqueDiceDigits(digitStr).sort((a, b) => a - b);
    if (digits.length < 2) return null;
    const plays = [];
    for (let i = 0; i < digits.length; i++) {
      for (let j = i + 1; j < digits.length; j++) {
        const play = '长牌' + digits[i] + digits[j];
        if (parsePlay(play)) plays.push(play);
      }
    }
    return plays.length ? plays : null;
  }

  function expandStraightCombo(digitStr) {
    const digits = uniqueDiceDigits(digitStr).sort((a, b) => a - b);
    if (digits.length < 3) return null;
    const plays = [];
    for (let i = 0; i <= digits.length - 3; i++) {
      const a = digits[i];
      const b = digits[i + 1];
      const c = digits[i + 2];
      if (a + 1 === b && b + 1 === c) {
        const play = '三连' + a + b + c;
        if (parsePlay(play)) plays.push(play);
      }
    }
    return plays.length ? plays : null;
  }

  function expandPlayPart(playPart) {
    const t0 = String(playPart || '').trim();
    const t = t0.replace(/\s+/g, '');
    if (!t) return null;

    /* 和值多选：和4/7/10 或 和4 7 10（有空格时优先 t0，避免和1614910 粘连） */
    {
      const mSum = t0.match(/^和(?:值)?\s*([0-9]+(?:\s*[\/\s]\s*[0-9]+)*)$/)
        || t.match(/^和(?:值)?([0-9/]+)$/);
      if (mSum) {
        const nums = String(mSum[1]).split(/[\/\s]+/).map(Number).filter((n) => n >= 4 && n <= 17);
        const plays = [];
        const seen = new Set();
        nums.forEach((n) => {
          if (seen.has(n)) return;
          seen.add(n);
          const play = '和' + n;
          if (parsePlay(play)) plays.push(play);
        });
        if (plays.length) return plays;
      }
    }

    if (/^[大小单双]+$/.test(t)) {
      const plays = [];
      const seen = new Set();
      for (const c of t) {
        if (SIDE_CHARS.includes(c) && !seen.has(c)) {
          seen.add(c);
          if (parsePlay(c)) plays.push(c);
        }
      }
      return plays.length ? plays : null;
    }

    if (t === '三同' || t === '三同号' || t === '豹子' || t === '豹') {
      return ['三同'];
    }

    let m = t.match(/^(三军|二同|三同|独)\/?([1-6]+)$/);
    if (m) {
      if (m[1] === '独') return expandDicePrefix('独', m[2]);
      return expandDicePrefix(m[1], m[2]);
    }

    m = t.match(/^三连(?:号)?\/?([1-6]+)$/);
    if (m) return expandStraightCombo(m[1]);
    if (t === '三连' || t === '三连号' || t === '顺子') return ['三连号'];

    if (t === '三不同' || t === '三不同号' || t === '杂六') return ['三不同'];

    m = t.match(/^长牌\/?([1-6]{2,})$/);
    if (m) return expandLongCombo(m[1]);

    if (parsePlay(t)) return [t];
    return null;
  }

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
    return plays.map((play, i) => ({ play, amount: base + (i === 0 ? rem : 0) }));
  }

  function requiresSlashPlayPart(playPart) {
    const t = String(playPart || '');
    if (/^(三军|二同|独)/.test(t)) return true;
    if (/^三连(?:号)?\/?[1-6]{3,}$/.test(t)) return true;
    if (/^长牌/.test(t)) return true;
    return false;
  }

  function finalizeBetLines(plays, amountPart) {
    if (!plays || !plays.length) return null;
    for (let i = 0; i < plays.length; i++) {
      if (!parsePlay(plays[i])) return null;
    }
    return resolveBetAmounts(plays, amountPart);
  }

  function parseBetLines(text) {
    const raw = String(text || '').trim();
    if (!raw) return null;
    const AMOUNT_RE = '(?:\\d+|梭哈|全下|allin)';

    let m = raw.match(new RegExp('^(.+)\\/(' + AMOUNT_RE + ')$', 'i'));
    if (m) {
      const plays = expandPlayPart(m[1].trim());
      return finalizeBetLines(plays, m[2]);
    }

    // 无 /：从短到长试拆末尾金额，优先更长玩法段（如 三同123100 → 三同123/100）
    for (let amtLen = 1; amtLen < raw.length && amtLen <= 8; amtLen++) {
      const amountPart = raw.slice(-amtLen);
      if (!/^\d+$/.test(amountPart) || amountPart[0] === '0') continue;
      const playPart = raw.slice(0, -amtLen);
      if (!playPart) continue;
      if (requiresSlashPlayPart(playPart)) continue;
      const plays = expandPlayPart(playPart);
      const lines = finalizeBetLines(plays, amountPart);
      if (lines) return lines;
    }
    return null;
  }

  function formatResolvedBets(lines) {
    return lines.map(l => `${l.play}/${l.amount}`).join(' ');
  }

  /** 空格多注：玩法段可含空格（如 和4 7 10/100），按最长可解析片段切分 */
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
      timeZone: 'Asia/Shanghai',
      year: 'numeric', month: '2-digit', day: '2-digit',
    }).formatToParts(date || new Date());
    const get = function (t) {
      const hit = parts.find(function (p) { return p.type === t; });
      return hit ? hit.value : '01';
    };
    return { y: get('year'), m: get('month'), d: get('day') };
  }
  /** 55s 与服务端 _nextAlignedTime 一致：UTC epoch 对齐后再算上海 MMDD 序号 */
  function nextOpenAtMs(now) {
    const intervalMs = INTERVAL * 1000;
    const t = now != null ? now : Date.now();
    return Math.ceil(t / intervalMs) * intervalMs;
  }
  function fmtIssueFromOpenAt(openAtMs) {
    const p = shanghaiYmdParts(new Date(openAtMs));
    const dayStart = Date.parse(p.y + '-' + p.m + '-' + p.d + 'T00:00:00+08:00');
    const seq = Math.floor((openAtMs - dayStart) / (INTERVAL * 1000)) + 1;
    return '' + p.m + p.d + pad(Math.max(1, seq), 6);
  }
  function todayStartMs() {
    const p = shanghaiYmdParts(new Date());
    return Date.parse(p.y + '-' + p.m + '-' + p.d + 'T00:00:00+08:00');
  }
  function dateKeyMD() {
    const p = shanghaiYmdParts(new Date());
    return '' + p.m + p.d;
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
    let r = (openAt - Date.now()) / 1000;
    if (r <= 0) r = INTERVAL;
    return r;
  }

  function getBettingIssueSeq() {
    const openAt = nextOpenAtMs();
    const p = shanghaiYmdParts(new Date(openAt));
    const dayStart = Date.parse(p.y + '-' + p.m + '-' + p.d + 'T00:00:00+08:00');
    return Math.max(1, Math.floor((openAt - dayStart) / (INTERVAL * 1000)) + 1);
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
    /* 和4/7/10/100：和后贴第一个号，其余号与金额按 / 分 */
    if (/和(?:值)?$/.test(v)) return v + t;
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
    const compactParts = [];
    for (const part of parts) {
      let plays = null;
      let stripped = part.replace(/\/(\d+|梭哈|全下|allin)$/i, '');
      const hadSlash = stripped.includes('/') || part !== stripped;
      stripped = stripped.replace(/\/$/, '');
      compactParts.push(stripped);
      if (requiresSlashPlayPart(stripped) && !hadSlash && !stripped.includes('/')) {
        App.toast('格式错误：该玩法号码与金额之间请用 /');
        return false;
      }
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
          compactParts[compactParts.length - 1] = gm[1];
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
    const per = allPlays.length === 1
      ? lines[0].amount
      : Math.floor(App.getBalance(user.uid) / allPlays.length);
    $in.val(compactParts.map(function (c) { return joinPlayAmount(c, per); }).join(' '));
    composerAllin = true;
    updateComposerAction();
    App.toast('梭哈已均分 · ' + allPlays.length + '注 · 每注约' + per);
    return true;
  }


  function betLogKey() { return 'k3_bet_log_' + user.uid; }

  function loadUserBetLog() {
    try { return JSON.parse(localStorage.getItem(betLogKey())) || []; } catch (e) { return []; }
  }

  function saveUserBetLog(list) {
    localStorage.setItem(betLogKey(), JSON.stringify(list.slice(0, 120)));
    try { window.dispatchEvent(new CustomEvent('k3-bet-log-updated')); } catch (e) { /* */ }
  }

  function appendUserBetLog(issue, play, amount) {
    const log = loadUserBetLog();
    let group = log.find(g => g.issue === issue);
    if (!group) {
      group = {
        game: 'kuai3',
        issue,
        createdAt: new Date().toISOString(),
        settled: false,
        bets: [],
        totalAmount: 0,
        totalProfit: 0
      };
      log.unshift(group);
    }
    group.bets.push({ play, amount, status: 'PENDING', profit: 0, winAmount: 0, hit: '' });
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

  function settleUserBetLog(issue, nums, rows) {
    const log = loadUserBetLog();
    const group = log.find(g => g.issue === issue);
    if (!group || !group.bets.length) return;
    group.settled = true;
    group.settledAt = new Date().toISOString();
    group.drawNums = nums.slice();
    group.drawSummary = `${sumMeta(nums).text} · ${shapeRow(nums)}`;
    group.totalProfit = 0;
    const rowQueue = rows && rows.length ? rows.slice() : [];
    group.bets = group.bets.map((b, i) => {
      let r = rowQueue[i];
      if (!r || r.play !== b.play || r.amount !== b.amount) {
        r = settleBet(b.play, b.amount, nums);
      }
      const item = {
        play: b.play,
        amount: b.amount,
        status: r.winAmount > 0 ? 'WON' : 'LOST',
        profit: r.profit,
        winAmount: r.winAmount,
        hit: r.hit || ''
      };
      group.totalProfit += item.profit;
      return item;
    });
    saveUserBetLog(log);
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
    if (!(opts && opts.mock) && name === user.name) appendUserBetLog(issue, play, amount);
    saveBetBook();
    return true;
  }

  function recordBet(name, text, opts) {
    const force = !!(opts && opts.force);
    if (!force && !isBettingOpen()) return false;
    const issue = (opts && opts.issue) || getCurrentIssue();
    if (!issue) return false;
    const lines = parseBetInput(text);
    if (!lines) return false;
    if (!issueBetBook[issue]) issueBetBook[issue] = {};
    if (!issueBetBook[issue][name]) issueBetBook[issue][name] = [];
    const mock = !!(opts && opts.mock);
    lines.forEach(({ play, amount }) => {
      if (play && amount > 0) {
        const row = { play, amount };
        if (mock) row.mock = true;
        issueBetBook[issue][name].push(row);
      }
      if (!mock && name === user.name) appendUserBetLog(issue, play, amount);
    });
    saveBetBook();
    return issueBetBook[issue][name].length > 0;
  }

  function betBookStorageKey() {
    const uid = (user && user.uid) ? user.uid : 'guest';
    return 'k3_betbook_v1_' + uid + (roomNo ? '_' + roomNo : '');
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
      if (raw && typeof raw === 'object') {
        Object.keys(raw).forEach((k) => { issueBetBook[k] = raw[k]; });
      }
    } catch (e) { /* ignore */ }
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
    const empty = '<div class="k3-bot-empty">本期暂无下注</div>';
    if (!bets.length) {
      return '<div class="k3-bot-card k3-bot-card--bets"><div class="k3-bot-card__head"><span class="k3-bot-card__title">注单核对</span><span class="k3-bot-card__issue">' + issue + '</span></div>' + empty + '</div>';
    }
    const total = bets.reduce(function (s, b) { return s + (Number(b.amount) || 0); }, 0);
    const groups = App.groupLotteryBetsByType(bets);
    const tags = groups.map(function (g) {
      return '<span class="k3-bot-tag">' + g.label + '×' + g.count + '/' + g.amount + '</span>';
    }).join('');
    let detail = '';
    if (bets.length <= 8) {
      detail = '<div class="k3-bot-user__tags" style="margin-top:6px">' + bets.map(function (b) {
        return '<span class="k3-bot-tag">' + App.labelLotteryBet(b) + '/' + b.amount + '</span>';
      }).join('') + '</div>';
    }
    const userBlock = '<div class="k3-bot-user is-me"><div class="k3-bot-user__head"><span class="k3-bot-user__name">我</span><span class="k3-bot-user__sum">' + total + '</span></div><div class="k3-bot-user__tags">' + tags + '</div>' + detail + '</div>';
    return '<div class="k3-bot-card k3-bot-card--bets"><div class="k3-bot-card__head"><span class="k3-bot-card__title">注单核对</span><span class="k3-bot-card__issue">' + issue + '</span></div><div class="k3-bot-card__body is-full">' + userBlock + '</div></div>';
  }
  function buildMineLineHtmlFromServer(issue, list) {
    const scoped = App.filterLotteryBetsByIssue ? App.filterLotteryBetsByIssue(list, issue) : (Array.isArray(list) ? list : []);
    const bets = scoped.filter(function (b) { return b && b.status !== 'CANCELLED' && b.status !== 'PENDING'; });
    if (!bets.length) return '';
    const myProfit = bets.reduce(function (sum, b) { return sum + serverBetProfit(b); }, 0);
    const myWin = bets.reduce(function (sum, b) { return sum + (Number(b.payout) || 0); }, 0);
    const profitCls = myProfit >= 0 ? 'pos' : 'neg';
    const winText = myWin > 0 ? ('中奖 +' + myWin) : '未中奖';
    return '<div class="k3-bot-mine-line ' + profitCls + '">' +
      '<span class="k3-bot-mine-line__label">您本期</span>' +
      '<span class="k3-bot-mine-line__win">' + winText + '</span>' +
      '<span class="k3-bot-mine-line__profit">输赢 ' + fmtProfit(myProfit) + '</span>' +
      '</div>';
  }
  function applyMineLineToWinHtml(html, mineHtml) {
    if (!mineHtml) return html;
    const re = /<div class="k3-bot-mine-line[\s\S]*?<\/div>/;
    if (re.test(html)) return html.replace(re, mineHtml);
    return html.replace(/<\/div>\s*$/, mineHtml + '</div>');
  }

  function buildBetListVerifyHtml(issue) {
    const book = issueBetBook[issue];
    if (!book || !Object.keys(book).length) {
      return `<div class="k3-bot-card k3-bot-card--bets"><div class="k3-bot-card__head"><span class="k3-bot-card__title">注单核对</span><span class="k3-bot-card__issue">${issue}</span></div><div class="k3-bot-empty">本期暂无下注</div></div>`;
    }
    const names = Object.keys(book);
    const users = names.map(name => {
      const bets = book[name];
      const total = bets.reduce((s, b) => s + b.amount, 0);
      const tags = bets.map(b => `<span class="k3-bot-tag">${b.play}/${b.amount}</span>`).join('');
      return `<div class="k3-bot-user${name === user.name ? ' is-me' : ''}"><div class="k3-bot-user__head"><span class="k3-bot-user__name">${name}</span><span class="k3-bot-user__sum">${total}</span></div><div class="k3-bot-user__tags">${tags}</div></div>`;
    }).join('');
    return `<div class="k3-bot-card k3-bot-card--bets"><div class="k3-bot-card__head"><span class="k3-bot-card__title">注单核对</span><span class="k3-bot-card__issue">${issue}</span></div><div class="k3-bot-card__body is-full">${users}</div></div>`;
  }

  function buildWinListVerifyHtml(issue, settled) {
    const pending = settled == null;
    if (pending) {
      return '<div class="k3-bot-card k3-bot-card--win is-calculating"><div class="k3-bot-card__head"><span class="k3-bot-card__title">中奖核对</span><span class="k3-bot-card__issue">' + issue + '</span></div><div class="k3-bot-card__body is-full"><div class="k3-bot-calc-line"><span class="k3-bot-calc-line__icon" aria-hidden="true"></span><span class="k3-bot-calc-line__text">正在核对中奖注单</span></div></div></div>';
    }
    const winners = Object.keys(settled || {}).filter(n => settled[n].some(r => r.winAmount > 0));
    let body = winners.length ? winners.map(name => {
      const winRows = settled[name].filter(r => r.winAmount > 0);
      const totalProfit = settled[name].reduce((s, r) => s + r.profit, 0);
      const tags = winRows.map(r => `<span class="k3-bot-tag k3-bot-tag--win">${r.play}/${r.amount}</span>`).join('');
      return `<div class="k3-bot-user"><div class="k3-bot-user__head"><span class="k3-bot-user__name">${name}</span><span class="k3-bot-user__profit ${totalProfit >= 0 ? 'pos' : 'neg'}">${fmtProfit(totalProfit)}</span></div><div class="k3-bot-user__tags">${tags}</div></div>`;
    }).join('') : '<div class="k3-bot-empty">本期暂无中奖</div>';
    let mine = '';
    const myRows = settled && settled[user.name];
    if (myRows && myRows.length) {
      const myProfit = myRows.reduce((s, r) => s + r.profit, 0);
      const myWin = myRows.reduce((s, r) => s + r.winAmount, 0);
      const profitCls = myProfit >= 0 ? 'pos' : 'neg';
      const winText = myWin > 0 ? `中奖 +${myWin}` : '未中奖';
      mine = `<div class="k3-bot-mine-line ${profitCls}"><span class="k3-bot-mine-line__label">您本期</span><span class="k3-bot-mine-line__win">${winText}</span><span class="k3-bot-mine-line__profit">输赢 ${fmtProfit(myProfit)}</span></div>`;
    }
    return `<div class="k3-bot-card k3-bot-card--win"><div class="k3-bot-card__head"><span class="k3-bot-card__title">中奖核对</span><span class="k3-bot-card__issue">${issue}</span></div><div class="k3-bot-card__body is-full">${body}</div>${mine}</div>`;
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
      stats.winloss += profit;
      stats.turnover += turnover;
      stats.rebate = (stats.rebate || 0) + Math.floor(turnover * 0.005);
      saveStats(user.uid, stats);
      if (App.refreshBalance) {
        App.refreshBalance().then(function () { refreshStats(); });
      } else {
        refreshStats();
      }
    }
    settleUserBetLog(issue, nums || lastDraw, rows);
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

  function renderCountdownDigits(sec) {
    const s = Math.max(0, Math.ceil(sec));
    const mm = pad(Math.floor(s / 60), 2);
    const ss = pad(s % 60, 2);
    const cells = $('#cdDigits .k3-timer__cell');
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
    try { return JSON.parse(localStorage.getItem('k3_stats_' + uid)) || { turnover: 0, winloss: 0, rebate: 0 }; } catch (e) { return { turnover: 0, winloss: 0, rebate: 0 }; }
  }

  function saveStats(uid, s) { localStorage.setItem('k3_stats_' + uid, JSON.stringify(s)); }

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

  function renderDrawBar(row) {
    if (!row) {
      $('#barIssue').text('--------');
      $('#barBalls').html('');
      $('#barSummary').html('等待开奖');
      return;
    }
    $('#barIssue').text(row.issue);
    $('#barBalls').html(row.nums.map(n => diceHtml(n, 'xs')).join(''));
    $('#barSummary').html(barSummaryHtml(row));
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
      <tr><td class="k3-draw-table__issue">${r.issue}</td>
      ${r.nums.map(n => `<td>${diceHtml(n, 'tbl')}</td>`).join('')}
      <td class="cell-gy">${r.gy.replace(/\s+/g, '')}</td><td class="cell-lh">${r.lh}</td></tr>`).join(''));
  }

  function resultCardHtml(nums, issue) {
    const meta = sumMeta(nums);
    const shape = shapeRow(nums);
    return K3ResultCard.build(nums, issue, meta, shape);
  }

  /** 骰子滚动大致时长（ms）；中奖核对兜底 = 此值 + 余量 */
  function resultRevealDurationMs() {
    return 1400;
  }

  function scrollChat() {
    const el = document.getElementById('chatFeed');
    if (el) el.scrollTop = el.scrollHeight;
  }

  const CHAT_KEEP = 50;
  const chatLog = [];

  function chatStorageKey() {
    const uid = (user && user.uid) ? user.uid : 'guest';
    return 'k3_chat_v3_' + uid + (roomNo ? '_' + roomNo : '');
  }
  function saveChatLog() {
    try {
      localStorage.setItem(chatStorageKey(), JSON.stringify(chatLog.slice(-CHAT_KEEP)));
    } catch (e) { /* quota / private mode */ }
  }
  function trimChatDom() {
    const $msgs = $('#chatFeed > .k3-msg');
    const extra = $msgs.length - CHAT_KEEP;
    if (extra > 0) $msgs.slice(0, extra).remove();
  }
  function escapeHtml(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, function (ch) {
      return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch];
    });
  }

  function appendMsg(opts) {
    const time = opts.time || fmtTime(new Date());
    const isSelf = opts.self;
    const isRobot = opts.robot;
    const avatar = opts.avatarHtml || `<div class="k3-msg__avatar"><img src="${fixAvatar(opts.avatar)}" alt="" onerror="this.onerror=null;this.src='/images/avatars/001.jpg'"></div>`;
    const metaOther = `<div class="k3-msg__meta"><span class="k3-msg__name">${escapeHtml(opts.name)}</span><span class="k3-msg__time">${escapeHtml(time)}</span></div>`;
    const metaSelf = `<div class="k3-msg__meta"><span class="k3-msg__time">${escapeHtml(time)}</span><span class="k3-msg__name">${escapeHtml(opts.name)}</span></div>`;
    const bubbleCls = isRobot ? 'k3-msg__bubble k3-msg__bubble--bot' : 'k3-msg__bubble';
    const bubble = `<div class="${bubbleCls}">${opts.html}</div>`;
    const html = isSelf
      ? `<div class="k3-msg is-self"><div class="k3-msg__top">${metaSelf}${avatar}</div>${bubble}</div>`
      : `<div class="k3-msg${isRobot ? ' is-robot' : ''}">${avatar}<div class="k3-msg__body">${metaOther}${bubble}</div></div>`;
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
    const feed = document.getElementById('chatFeed');
    if (feed) {
      const cards = feed.querySelectorAll('.k3-result-card.is-settled:not([data-laid="1"])');
      const settled = cards[cards.length - 1];
      if (settled) K3ResultCard.initSettled(settled);
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
      appendMsg({
        name: m.name || '玩家',
        avatar: m.avatar || '',
        html: m.html,
        self: !!m.self,
        robot: !!m.robot,
        time: m.time || '',
        skipPersist: true,
      });
      chatLog.push({
        name: m.name || '玩家',
        avatar: m.avatar || '',
        html: m.html,
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
      const $card = $('#chatFeed').find('.' + "k3" + '-bot-card--win').filter(function () {
        return String($(this).find('.' + "k3" + '-bot-card__issue').text() || '').trim() === issue;
      }).last().closest('[class*="-msg"]');
      if (!$card.length) return;
      const $bubble = $card.find('[class*="msg__bubble"]').first();
      let h = $bubble.html() || '';
      h = applyMineLineToWinHtml(h, mine);
      $bubble.html(h);
    }).catch(function () {});
  }

  function buildBetVerifyFromPayload(p) {
    return LotteryRoomChat.buildBetVerifyHtml("k3", p, {
      escapeHtml: typeof escapeHtml === 'function' ? escapeHtml : undefined,
      userName: user.name,
    });
  }

  function buildWinVerifyFromPayload(p) {
    return LotteryRoomChat.buildWinVerifyHtml("k3", p, {
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
    buildResultHtml: function (p, msg, o) {
      const nums = Array.isArray(p.nums) ? p.nums.map(Number) : [];
      const issue = String(p.issueNo || msg.issueNo || '');
      if (o && o.animate && o.live && window.K3ResultCard && K3ResultCard.buildRolling) {
        return K3ResultCard.buildRolling(issue);
      }
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
        prefix: "k3",
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
      const card = $('#chatFeed .k3-result-card, #chatFeed .k3-bot-card--result').last()[0];
      if (card && window.K3ResultCard) {
        if (ctx.animate && ctx.live && K3ResultCard.startRoll) {
          ctx.setRevealPending(issue);
          const rollMs = resultRevealDurationMs();
          const meta = (typeof sumMeta === 'function') ? sumMeta(nums) : null;
          const shape = (typeof shapeRow === 'function') ? shapeRow(nums) : '';
          K3ResultCard.startRoll(card, nums, issue, meta, shape, rollMs, function () {
            ctx.markRevealReady(issue);
          });
          ctx.scheduleRevealReady(issue, rollMs + 300);
        } else if (K3ResultCard.initSettled) {
          K3ResultCard.initSettled(card);
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


  function closeNoticeHtml(issue) {
    return `<div class="k3-bot-close-line"><div class="k3-bot-close-line__bar"><span class="k3-bot-close-line__deco"></span><span class="k3-bot-close-line__text">封 盘 线</span><span class="k3-bot-close-line__deco"></span></div><div class="k3-bot-close-line__sub">第 <span class="k3-bot-close-line__issue">${issue}</span> 期 · 停止下注 · 即将开奖</div></div>`;
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
    // 左：两面 → 中：数字+和+/ → 右：删除+形态前缀（与口令分类一致）
    const rows = [
      { left: '大', mid: ['1', '2', '3'], right: '删除', del: true },
      { left: '小', mid: ['4', '5', '6'], right: '三军', kind: 'dice' },
      { left: '单', mid: ['7', '8', '9'], right: '二同', kind: 'tri' },
      { left: '双', mid: ['和', '0', '/'], right: '三同', kind: 'tri' },
      { left: '三连', mid: ['长牌', '三不同', '空格'], right: '豹子', kind: 'shape' },
    ];
    let html = '';
    rows.forEach((row) => {
      const leftKind = ['大', '小', '单', '双'].includes(row.left) ? 'side' : 'shape';
      html += `<button type="button" class="k3-key k3-key--${leftKind}" data-key="${row.left}">${row.left}</button>`;
      row.mid.forEach((k) => {
        let midCls = '';
        if (k === '和') midCls = ' k3-key--sum';
        else if (k === '长牌' || k === '三不同') midCls = ' k3-key--shape';
        else if (k === '空格') midCls = ' k3-key--space';
        html += `<button type="button" class="k3-key${midCls}" data-key="${k}">${k}</button>`;
      });
      let rightCls = ' k3-key--side';
      if (row.del) rightCls = ' k3-key--del';
      else if (row.kind === 'tri') rightCls = ' k3-key--tri';
      else if (row.kind === 'dice') rightCls = ' k3-key--dice';
      else if (row.kind === 'shape') rightCls = ' k3-key--shape';
      html += `<button type="button" class="k3-key${rightCls}" data-key="${row.right}">${row.right}</button>`;
    });
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
    const $room = $('.k3-room');
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
    if (text === '删除') { $in.val(v.slice(0, -1)); updateComposerAction(); return; }
    if (text === '空格') { $in.val(v + ' '); updateComposerAction(); return; }
    // 「豹子」= 任意三同（口令「三同」）
    if (text === '豹子') { $in.val(v + '三同'); updateComposerAction(); return; }
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
    if (!isBettingOpen()) { toastBetBlocked('bet'); return; }
    let lines;
    if (composerAllin) {
      composerAllin = false;
      const parts = text.split(/\s+/).filter(Boolean);
      const allPlays = [];
      for (let i = 0; i < parts.length; i++) {
        let stripped = parts[i].replace(/\/(\d+|梭哈|全下|allin)$/i, '').replace(/\/$/, '');
        let via = parseBetLines(stripped + '/梭哈');
        let plays = via && via.length ? via.map(function (l) { return l.play; }) : expandPlayPart(stripped);
        if (!plays || !plays.length) { App.toast('格式错误'); return; }
        allPlays.push.apply(allPlays, plays);
      }
      lines = resolveBetAmounts(allPlays, '梭哈');
      if (!lines) { App.toast('余额不足，无法梭哈'); return; }
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
    if (mapped.unsupported.length) {
      App.toast('格式错误');
      return;
    }
    if (!mapped.bets.length) {
      App.toast('暂无可用玩法');
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
      recordBet(user.name, text);
      lastBetText = formatResolvedBets(lines);
      $('#chatInput').val('');
      updateComposerAction();
      if (lines.length > 1) App.toast('投注成功 · ' + lines.length + '注');
    }).catch(function (e) {
      App.toast((e && e.message) || '下注失败');
    });
  }

  function repeatLastBet() {
    if (!lastBetText) { App.toast('暂无上次投注'); return; }
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
      id: 'sideSum',
      title: '和值两面',
      hint: () => `两面：4-10 小 · 11-17 大 · 豹子通杀 · ${ODDS.side}｜和值：猜总和 4-17 · ${ODDS.sum}`,
      subs: null,
      sideItems: ['大', '小', '单', '双'].map(p => ({ play: p, label: p, odds: ODDS.side })),
      sumItems: Array.from({ length: 14 }, (_, i) => {
        const sum = i + 4;
        return { play: '和' + sum, label: String(sum), odds: SUM_ODDS[sum] || ODDS.sum };
      }),
    },
    {
      id: 'dice',
      title: '三军',
      hint: () => `指定点数至少出现 1 次 · 赔率 ${ODDS.dice}`,
      subs: null,
      items: Array.from({ length: 6 }, (_, i) => {
        const n = i + 1;
        return { play: '三军' + n, label: '三军' + n, odds: ODDS.dice };
      }),
    },
    {
      id: 'pair',
      title: '二同号',
      hint: () => `指定点数恰好出现 2 次（非豹子）· 赔率 ${ODDS.pairN}`,
      subs: null,
      items: Array.from({ length: 6 }, (_, i) => {
        const n = i + 1;
        return { play: '二同' + n, label: String(n) + String(n), odds: ODDS.pairN };
      }),
    },
    {
      id: 'triplet',
      title: '三同号',
      hint: () => `指定豹子点数 · 单号 ${ODDS.tripletN}｜任意豹子输入三同号 · ${ODDS.tripletAny}`,
      subs: null,
      items: [
        { play: '三同号', label: '任意', odds: ODDS.tripletAny },
        ...Array.from({ length: 6 }, (_, i) => {
          const n = i + 1;
          return { play: '三同' + n, label: String(n).repeat(3), odds: ODDS.tripletN };
        }),
      ],
    },
    {
      id: 'straight',
      title: '三连号',
      hint: () => `三颗骰子为连续点数 123 / 234 / 345 / 456 · 赔率 ${ODDS.straight}`,
      subs: null,
      items: [{ play: '三连号', label: '三连号', odds: ODDS.straight }],
    },
    {
      id: 'alldiff',
      title: '三不同号',
      hint: () => `三颗点数互不相同且不成顺子 · 赔率 ${ODDS.alldiff}`,
      subs: null,
      items: [{ play: '三不同号', label: '三不同', odds: ODDS.alldiff }],
    },
    {
      id: 'long',
      title: '长牌',
      hint: () => `两个不同点数各至少出现 1 次 · 赔率 ${ODDS.long}`,
      subs: null,
      items: longPairs().map(p => ({
        play: p.play,
        label: p.a + '·' + p.b,
        odds: ODDS.long,
      })),
    },
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
    $('#playAmountChips .k3-play-foot__chip').removeClass('is-active');
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
      `<button type="button" class="k3-play-nav__item${i === playCatIdx ? ' is-active' : ''}" data-idx="${i}">${c.title}</button>`
    ).join(''));
    $('#playAmountChips').html(AMOUNT_CHIPS.map(a =>
      `<button type="button" class="k3-play-foot__chip${a === 100 ? ' is-active' : ''}" data-amt="${a}">${a}</button>`
    ).join(''));
  }

  function playItemHtml(play, label, odds, extraCls) {
    const cls = ['k3-play-item', extraCls, isPlaySelected(play) ? 'is-active' : ''].filter(Boolean).join(' ');
    const oddsHtml = odds != null ? `<small>${odds}</small>` : '';
    return `<button type="button" class="${cls}" data-play="${play}"><span>${label}</span>${oddsHtml}</button>`;
  }

  function renderPlayPanel() {
    const cat = currentPlayCat();
    const $grid = $('#playGrid');
    $('#playHint').text(typeof cat.hint === 'function' ? cat.hint() : cat.hint);
    $('#playSub').addClass('is-hidden').prop('hidden', true).empty();
    let html = '';
    let gridMode = '';
    if (cat.id === 'sideSum') {
      gridMode = 'is-side-sum';
      const sideHtml = cat.sideItems.map(it => playItemHtml(it.play, it.label, it.odds, 'k3-play-item--side')).join('');
      const sumHtml = cat.sumItems.map(it => playItemHtml(it.play, it.label, it.odds, 'k3-play-item--sum')).join('');
      html = `<div class="k3-play-section"><div class="k3-play-section__title">两面</div><div class="k3-play-section__grid is-gy-side">${sideHtml}</div></div>`
        + `<div class="k3-play-section"><div class="k3-play-section__title">和值</div><div class="k3-play-section__grid is-digits">${sumHtml}</div></div>`;
    } else if (cat.id === 'dice') {
      gridMode = 'is-dice-grid';
      html = cat.items.map(it => {
        const n = +String(it.play).replace('三军', '');
        const cls = ['k3-play-item', 'k3-play-item--dice-img', isPlaySelected(it.play) ? 'is-active' : ''].filter(Boolean).join(' ');
        return `<button type="button" class="${cls}" data-play="${it.play}"><span class="k3-play-item__dice">${diceHtml(n, 'play')}</span><small>${it.odds}</small></button>`;
      }).join('');
    } else if (cat.id === 'pair') {
      gridMode = 'is-dice-grid';
      html = cat.items.map(it => {
        const n = +String(it.play).replace('二同', '');
        const cls = ['k3-play-item', 'k3-play-item--dice-img', isPlaySelected(it.play) ? 'is-active' : ''].filter(Boolean).join(' ');
        return `<button type="button" class="${cls}" data-play="${it.play}"><span class="k3-play-item__dice k3-play-item__dice--pair">${diceHtml(n, 'play')}${diceHtml(n, 'play')}</span><small>${it.odds}</small></button>`;
      }).join('');
    } else if (cat.id === 'triplet') {
      gridMode = 'is-triplet-grid';
      html = cat.items.map(it => {
        if (it.play === '三同号') {
          return playItemHtml(it.play, it.label, it.odds, 'k3-play-item--tri-any');
        }
        const n = +String(it.play).replace('三同', '');
        const cls = ['k3-play-item', 'k3-play-item--dice-img', isPlaySelected(it.play) ? 'is-active' : ''].filter(Boolean).join(' ');
        return `<button type="button" class="${cls}" data-play="${it.play}"><span class="k3-play-item__dice k3-play-item__dice--tri">${diceHtml(n, 'play')}${diceHtml(n, 'play')}${diceHtml(n, 'play')}</span><small>${it.odds}</small></button>`;
      }).join('');
    } else if (cat.id === 'long') {
      gridMode = 'is-long-grid';
      html = cat.items.map(it => playItemHtml(it.play, it.label, it.odds, 'k3-play-item--long')).join('');
    } else {
      html = cat.items.map(it => playItemHtml(it.play, it.label, it.odds)).join('');
    }
    $grid.attr('class', `k3-play-panel__grid${gridMode ? ' ' + gridMode : ''}`).html(html);
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
    document.documentElement.style.setProperty('--k3-play-top', top + 'px');
  }
  function openPlaySheet(open, catId) {
    const $room = $('.k3-room');
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
      $('#playAmountChips .k3-play-foot__chip[data-amt="100"]').addClass('is-active');
      refreshStats();
      initPlaySheet();
      renderPlayPanel();
      updatePlaySelected();
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
      const total = lines.reduce((s, l) => s + l.amount, 0);
      if (total > App.getBalance(user.uid)) { App.toast('余额不足'); return; }
    }
    const text = formatResolvedBets(lines);
    $('#chatInput').val(text);
    playAllin = false;
    syncPlayAmountUI();
    openPlaySheet(false);
    showKeypad(true);
    sendBetMessage();
  }

  function initPlaySheetEvents() {
    $('#playNav').on('click', '.k3-play-nav__item', function () {
      playCatIdx = +$(this).data('idx');
      playSubIdx = 0;
      $('#playNav .k3-play-nav__item').removeClass('is-active');
      $(this).addClass('is-active');
      renderPlayPanel();
    });
    $('#playGrid').on('click', '.k3-play-item', function () {
      const play = $(this).data('play');
      togglePlaySelect(play);
      $(this).toggleClass('is-active', isPlaySelected(play));
      updatePlaySelected();
    });
    $('#playAmountChips').on('click', '.k3-play-foot__chip', function () {
      setPlayAmount(+$(this).data('amt'));
      clearPlayAmountChipActive();
      $(this).addClass('is-active');
    });
    $('#playAmountMinus').on('click', () => {
      const cur = parseInt($('#playAmount').val(), 10) || 100;
      setPlayAmount(cur - playAmountStep(cur));
      clearPlayAmountChipActive();
    });
    $('#playAmountPlus').on('click', () => {
      const cur = parseInt($('#playAmount').val(), 10) || 0;
      setPlayAmount(cur + playAmountStep(cur));
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

  function sideLabelForRow(nums) {
    if (isTriplet(nums)) return null;
    return sumMeta(nums);
  }

  function pushLongDim(list, group, labels) {
    const s = streakAtHead(labels);
    if (!s.tag) return;
    list.push({
      name: s.tag,
      group,
      count: s.count,
      play: playForTag(s.tag, group),
    });
  }

  function playForTag(tag, group) {
    if (['大', '小', '单', '双'].includes(tag)) return tag;
    if (tag === '三同号') return '三同号';
    if (tag === '三连号') return '三连号';
    if (tag === '三不同号') return '三不同号';
    if (/^和\d+$/.test(String(tag))) return String(tag);
    if (group && String(group).indexOf('和值') >= 0 && ['大', '小', '单', '双'].includes(String(tag).replace(/^和值/, ''))) {
      return String(tag).replace(/^和值/, '');
    }
    return '';
  }

  function buildLongDragonGroups() {
    const rows = historyRows.filter(r => Array.isArray(r.nums) && r.nums.length === 3);
    const side = [];
    const shape = [];
    const sumTab = [];
    if (!rows.length) return { side, shape, sum: sumTab };

    pushLongDim(side, '和值大小', rows.map(r => {
      const m = sideLabelForRow(r.nums);
      return m ? m.size : null;
    }).filter(Boolean));
    pushLongDim(side, '和值单双', rows.map(r => {
      const m = sideLabelForRow(r.nums);
      return m ? m.parity : null;
    }).filter(Boolean));
    pushLongDim(shape, '形态', rows.map(r => shapeRow(r.nums)));
    pushLongDim(sumTab, '和值大小', rows.map(r => {
      const m = sideLabelForRow(r.nums);
      return m ? '和值' + m.size : null;
    }).filter(Boolean));
    pushLongDim(sumTab, '和值单双', rows.map(r => {
      const m = sideLabelForRow(r.nums);
      return m ? '和值' + m.parity : null;
    }).filter(Boolean));
    pushLongDim(sumTab, '和值点数', rows.map(r => '和' + sumMeta(r.nums).sum));

    const sortDesc = arr => arr.sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, 'zh'));
    return { side: sortDesc(side), shape: sortDesc(shape), sum: sortDesc(sumTab) };
  }

  function roadLabelsForTab(tab) {
    const rows = historyRows.filter(r => Array.isArray(r.nums) && r.nums.length === 3).slice(0, ROAD_WINDOW);
    if (tab === 'shape') return rows.map(r => shapeRow(r.nums));
    if (tab === 'sum') return rows.map(r => String(sumMeta(r.nums).sum));
    return rows.map(r => {
      const m = sideLabelForRow(r.nums);
      return m ? m.size : '—';
    });
  }

  function roadHtml(labels) {
    if (!labels.length) return '';
    const chips = labels.map((tag, i) =>
      `<span class="k3-long-road__chip ${longTagClass(tag)}${i === 0 ? ' is-latest' : ''}">${tag}</span>`
    ).join('');
    return `<div class="k3-long-road"><div class="k3-long-road__label">近 ${labels.length} 期走势 · 左新右旧</div><div class="k3-long-road__row">${chips}</div></div>`;
  }

  function currentShapeHtml(items) {
    if (!items.length) return '';
    const cards = items.map(item => {
      const playAttr = item.play && parsePlay(item.play) ? ` data-predict-play="${item.play}"` : '';
      const clickable = playAttr ? ' is-clickable' : '';
      return `<div class="k3-long-shape${clickable}"${playAttr} role="${playAttr ? 'button' : 'group'}"${playAttr ? ' tabindex="0"' : ''}>
        <span class="k3-long-shape__group">${item.group}</span>
        <span class="k3-long-shape__tag ${longTagClass(item.name)}">${item.name}</span>
        <span class="k3-long-shape__count">${item.count}<small>连</small></span>
      </div>`;
    }).join('');
    return `<div class="k3-long-shape-wrap"><div class="k3-long-road__label">当前形态</div><div class="k3-long-shape-grid">${cards}</div></div>`;
  }

  function longItemParts(name) {
    if (['大', '小', '单', '双'].includes(name)) return { group: '和值两面', tag: name, full: name };
    if (name.startsWith('和值')) return { group: '和值', tag: name.slice(2), full: name };
    if (/^和\d+$/.test(String(name))) return { group: '和值', tag: name.slice(1), full: name };
    return { group: '形态', tag: name, full: name };
  }

  function longTagClass(tag) {
    if (['大'].includes(tag)) return 'tag-red';
    if (['小'].includes(tag)) return 'tag-blue';
    if (['单'].includes(tag)) return 'tag-gold';
    if (['双'].includes(tag)) return 'tag-purple';
    if (tag === '三同号') return 'tag-red';
    if (tag === '三连号') return 'tag-green';
    if (tag === '二同号') return 'tag-gold';
    if (tag === '三不同号') return 'tag-muted';
    return 'tag-muted';
  }

  function longStreakBar(count) {
    const pct = Math.min(100, Math.round((count / 10) * 100));
    return `<div class="k3-long-item__bar"><span style="width:${pct}%"></span></div>`;
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
    const tabLabel = { side: '和值两面', shape: '形态', sum: '和值' }[longTab] || '';
    const rows = historyRows.filter(r => Array.isArray(r.nums) && r.nums.length === 3);

    if (!rows.length) {
      $('#longSummary').text(`${tabLabel} · 等待开奖`);
      $('#longBody').html(`
        <div class="k3-long-empty">
          <div class="k3-long-empty__icon">◎</div>
          <div class="k3-long-empty__text">暂无开奖数据</div>
          <div class="k3-long-empty__hint">接入官方开奖后会自动统计长龙</div>
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
        <div class="k3-long-hero ${longTierClass(top.count)}">
          <div class="k3-long-hero__label">当前最长</div>
          <div class="k3-long-hero__main">
            <span class="k3-long-hero__tag ${longTagClass(topParts.tag)}">${topParts.tag}</span>
            <span class="k3-long-hero__text">${top.group || topParts.full}</span>
            <span class="k3-long-hero__num">${top.count}</span>
            <span class="k3-long-hero__unit">期</span>
          </div>
        </div>`;
    }

    const listHtml = list.length
      ? `<div class="k3-long-list">${list.map((item, idx) => {
          const parts = longItemParts(item.name);
          const playAttr = item.play && parsePlay(item.play) ? ` data-predict-play="${item.play}"` : '';
          return `
        <div class="k3-long-item ${longTierClass(item.count)}${playAttr ? ' is-clickable' : ''}"${playAttr ? `${playAttr} role="button" tabindex="0"` : ''}>
          <div class="k3-long-item__rank">${idx + 1}</div>
          <div class="k3-long-item__tag ${longTagClass(parts.tag)}">${parts.tag}</div>
          <div class="k3-long-item__info">
            <div class="k3-long-item__name">${item.group || parts.group}<span class="sep">·</span>${parts.full}</div>
            ${longStreakBar(item.count)}
          </div>
          <div class="k3-long-item__count"><b>${item.count}</b><small>连</small></div>
        </div>`;
        }).join('')}</div>`
      : `<div class="k3-long-empty k3-long-empty--soft">
          <div class="k3-long-empty__text">暂无 2 期以上长龙</div>
          <div class="k3-long-empty__hint">下方仍可看近期走势与当前形态</div>
        </div>`;

    $('#longBody').html(hero + roadHtml(roadLabelsForTab(longTab)) + currentShapeHtml(all) + listHtml);
  }

  function openLongSheet(open) {
    const $room = $('.k3-room');
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
    return `<div class="k3-predict-card is-clickable"${playAttr} role="button" tabindex="0">
      <div class="k3-predict-card__name">${name}</div>
      <div class="k3-predict-card__pick">
        <span class="k3-predict-card__tag ${predictTagClass(data.pick)}">${data.pick}</span>
        <span class="k3-predict-card__conf">${pct}%</span>
      </div>
      <div class="k3-predict-card__reason">${data.reason}</div>
      <div class="k3-predict-card__bar"><span style="width:${pct}%"></span></div>
    </div>`;
  }

  function buildDicePredict(rows) {
    const window = Math.min(PREDICT_WINDOW, rows.length);
    const freq = Array(7).fill(0);
    const lastSeen = Array(7).fill(window);
    for (let i = 0; i < window; i++) {
      rows[i].nums.forEach(d => {
        freq[d]++;
        if (lastSeen[d] === window) lastSeen[d] = i;
      });
    }
    const hot = freq
      .map((c, d) => ({ d, c }))
      .filter(x => x.d >= 1)
      .sort((a, b) => b.c - a.c || a.d - b.d)
      .slice(0, 3)
      .filter(x => x.c > 0);
    const cold = lastSeen
      .map((gap, d) => ({ d, gap }))
      .filter(x => x.d >= 1)
      .sort((a, b) => b.gap - a.gap || a.d - b.d)
      .slice(0, 3);
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
    const rows = historyRows.filter(r => Array.isArray(r.nums) && r.nums.length === 3);
    const issue = getPredictIssue();
    $('#predictSummary').text(`下一期 · ${issue}`);
    if (!rows.length) {
      $('#predictBody').html(`
        <div class="k3-long-empty">
          <div class="k3-long-empty__icon">◎</div>
          <div class="k3-long-empty__text">暂无开奖数据</div>
          <div class="k3-long-empty__hint">等待开奖后生成预测</div>
        </div>`);
      return;
    }

    if (predictTab === 'side') {
      const sizeLabels = rows.map(r => {
        const m = sideLabelForRow(r.nums);
        return m ? m.size : null;
      }).filter(Boolean);
      const oddLabels = rows.map(r => {
        const m = sideLabelForRow(r.nums);
        return m ? m.parity : null;
      }).filter(Boolean);
      const sizeData = pickByTrend(sizeLabels, PREDICT_STREAK_BREAK);
      const oddData = pickByTrend(oddLabels, PREDICT_STREAK_BREAK);
      const hero = `
        <div class="k3-predict-hero">
          <div class="k3-predict-hero__label">核心参考</div>
          <div class="k3-predict-hero__main">
            <div class="k3-predict-hero__tags">
              <span class="k3-predict-card__tag ${predictTagClass(sizeData.pick)} is-clickable" data-predict-play="${sizeData.pick}" role="button" tabindex="0">${sizeData.pick}</span>
              <span class="k3-predict-card__tag ${predictTagClass(oddData.pick)} is-clickable" data-predict-play="${oddData.pick}" role="button" tabindex="0">${oddData.pick}</span>
            </div>
            <div class="k3-predict-hero__note">和值倾向 ${sizeData.pick}${oddData.pick}，${sizeData.reason}</div>
          </div>
        </div>`;
      $('#predictBody').html(hero + `<div class="k3-predict-grid">${predictCardHtml('和值 · 大小', sizeData, sizeData.pick)}${predictCardHtml('和值 · 单双', oddData, oddData.pick)}</div>`);
      return;
    }

    if (predictTab === 'sum') {
      const sumFreq = {};
      rows.slice(0, PREDICT_WINDOW).forEach(r => {
        const s = sumMeta(r.nums).sum;
        sumFreq[s] = (sumFreq[s] || 0) + 1;
      });
      const hotSums = Object.keys(sumFreq)
        .map(Number)
        .sort((a, b) => sumFreq[b] - sumFreq[a] || a - b)
        .slice(0, 6);
      const sumCards = hotSums.map(s => {
        const ratio = sumFreq[s] / Math.min(PREDICT_WINDOW, rows.length);
        const conf = Math.round(45 + ratio * 40);
        return predictCardHtml(`和 ${s}`, {
          pick: String(s),
          reason: `近 ${Math.min(PREDICT_WINDOW, rows.length)} 期出现 ${sumFreq[s]} 次`,
          confidence: conf
        }, '和' + s);
      }).join('');
      $('#predictBody').html(`
        <div class="k3-predict-hero">
          <div class="k3-predict-hero__label">热和值</div>
          <div class="k3-predict-hero__note">近 ${Math.min(PREDICT_WINDOW, rows.length)} 期高频总和，可作和值投注参考</div>
        </div>
        <div class="k3-predict-grid">${sumCards || '<div class="k3-bot-empty">数据不足</div>'}</div>`);
      return;
    }

    const stat = buildDicePredict(rows);
    const hotHtml = stat.hot.length
      ? stat.hot.map(x => predictDiceBtn(x.d, false)).join('')
      : '<span class="k3-predict-card__reason">—</span>';
    const coldHtml = stat.cold.map(x => predictDiceBtn(x.d, true)).join('');
    $('#predictBody').html(`
      <div class="k3-predict-hero">
        <div class="k3-predict-hero__label">骰点参考</div>
        <div class="k3-predict-hero__note">近 ${Math.min(PREDICT_WINDOW, rows.length)} 期各点数出现频次与遗漏</div>
      </div>
      <div class="k3-predict-digit-col">
        <div class="k3-predict-digit-col__label">热号</div>
        <div class="k3-predict-digit-balls">${hotHtml}</div>
        <div class="k3-predict-digit-col__label">遗漏</div>
        <div class="k3-predict-digit-balls">${coldHtml}</div>
      </div>`);
  }

  function openPredictSheet(open) {
    const $room = $('.k3-room');
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
    const $room = $('.k3-room');
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

  // ===== 初始化（服务端快照到达前仅显示空状态，绝不伪造官方历史） =====
  refreshStats();
  renderDrawTable();
  setCurIssueDisplay(getCurrentIssue());
  updateCountdownUI(getRoundRemain());
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
      const meta = nums.length === 3 ? sumMeta(nums) : { text: '' };
      return {
        issue: String(row.issueNo || ''),
        nums,
        gy: nums.length === 3 ? meta.text : '',
        lh: nums.length === 3 ? shapeRow(nums) : '',
      };
    }).filter(r => r.issue && r.nums.length === 3);
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
      if (serverCurrent && serverCurrent.issueNo) setCurIssueDisplay(serverCurrent.issueNo);
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
      setCurIssueDisplay(issueCur);
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

  $('#backBtn').on('click', () => {
    if (App.backToLobby) App.backToLobby();
    else App.go('../../client-app/pages/game-lobby/game-lobby.html' + q);
  });
  /* === chat-rail handlers (k3) === */

  function openRulesSheet(open) {
    if (open) {
      const o = ODDS;
      const betSec = INTERVAL - PREP_SEC;
      const html = `
        <div class="k3-rules-sec">
          <h3 class="k3-rules-sec__title">一、开奖与时间</h3>
          <p>1分快三每期开出 <b>3</b> 颗骰子，点数各为 <b>1～6</b>。</p>
          <p>每期共 <b>${INTERVAL} 秒</b>：可下注 <b>${betSec} 秒</b>，提前 <b>${PREP_SEC} 秒</b> 封盘。顶栏「距封盘 / 距开奖」；封盘后不可下注、不可取消。</p>
          <p>开奖结果与派彩以服务端账本为准。</p>
        </div>
        <div class="k3-rules-sec">
          <h3 class="k3-rules-sec__title">二、如何下注</h3>
          <p>支持三种方式：</p>
          <ul>
            <li>点右侧 / 底部「玩法」面板点选后投注</li>
            <li>底部输入口令：<b>玩法/金额</b>（空格可下多注）</li>
            <li>键盘快捷：上分、取消、梭哈、重复、下分</li>
          </ul>
          <span class="k3-rules-ex">大/100　和11/50　三军3/100</span>
          <span class="k3-rules-ex">二同5/50　三同号/20　长牌12/100　三连号/80</span>
          <p>「梭哈」按余额均分；玩法脚「重复」可跟上一笔。底部「+」含上下分、申请记录、竞猜报表等入口。</p>
        </div>
        <div class="k3-rules-sec">
          <h3 class="k3-rules-sec__title">三、玩法与赔率</h3>
          <p>下列为当前房间赔率（随后台更新）。派彩 = 金额 × 赔率（向下取整）。</p>
          <table class="k3-rules-table">
            <thead><tr><th>玩法</th><th>说明</th><th>赔率</th></tr></thead>
            <tbody>
              <tr><td>两面</td><td>三骰和值：4～10 小，11～17 大；奇单偶双。开出豹子通杀</td><td>${o.side}</td></tr>
              <tr><td>和值</td><td>猜总和 4～17，各点数赔率不同（面板可见）</td><td>约 ${o.sum} 起</td></tr>
              <tr><td>三军 / 独</td><td>指定点数至少出现 1 次（出现越多派彩规则按服务端）</td><td>${o.dice}</td></tr>
              <tr><td>二同号</td><td>指定点数恰好出现 2 次（非豹子）</td><td>${o.pairN}</td></tr>
              <tr><td>三同号</td><td>指定豹子点数；「三同号」为任意豹子</td><td>单号 ${o.tripletN} · 任意 ${o.tripletAny}</td></tr>
              <tr><td>三连号</td><td>三颗为连续点数 123/234/345/456</td><td>${o.straight}</td></tr>
              <tr><td>三不同</td><td>三颗互不相同且不成顺子</td><td>${o.alldiff}</td></tr>
              <tr><td>长牌</td><td>两个不同点数各至少出现 1 次，如「长牌12」</td><td>${o.long}</td></tr>
            </tbody>
          </table>
        </div>

        <div class="k3-rules-sec">
          <h3 class="k3-rules-sec__title">四、取消与结算</h3>
          <p>当期未封盘前可输入「取消」或点键盘「取消」，撤销本人本期未结算注单；封盘后不可取消。</p>
          <p>开奖后房间会推送结果卡与注单/中奖核对；积分变动以服务端派彩为准。顶部「输赢 / 流水 / 回水」为房间会话统计参考。</p>
        </div>
        <div class="k3-rules-sec">
          <h3 class="k3-rules-sec__title">五、温馨提示</h3>
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
    App.go('../../client-app/pages/bet-records/bet-records.html' + q + sep + 'game=kuai3');
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
  $('#predictBody').on('click', '[data-predict-play]', function () {
    fillPredictPlay(String($(this).data('predict-play') || ''));
  });
  $('#predictBody, #longBody').on('keydown', '[data-predict-play]', function (e) {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      fillPredictPlay(String($(this).data('predict-play') || ''));
    }
  });
  $('#longBody').on('click', '[data-predict-play]', function () {
    fillPredictPlay(String($(this).data('predict-play') || ''));
  });
  $('#drawToggle').on('click', function (e) {
    e.stopPropagation();
    toggleDrawPanel();
  });

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
  $('#chatInput').on('input', () => { composerAllin = false; updateComposerAction(); });
  $('#chatInput').on('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); sendBetMessage(); } });
  $('#keyGrid').on('click', '.k3-key', function () {
    const key = $(this).attr('data-key');
    if (key === '删除') return;
    if (key === '和') {
      showKeypad(false);
      openPlaySheet(true, 'sideSum');
      return;
    }
    insertInput(key);
  });
  $('#keyGrid').on('pointerdown', '.k3-key', function (e) {
    if ($(this).attr('data-key') !== '删除') return;
    e.preventDefault();
    stopDeleteHold();
    insertInput('删除');
    delHoldTimer = setTimeout(() => {
      delHoldInterval = setInterval(() => insertInput('删除'), 55);
    }, 380);
  });
  $('#keyGrid').on('pointerup pointerleave pointercancel', '.k3-key', function () {
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
    if (!$(e.target).closest('#keypad, #chatInput, .k3-composer').length && $('#keypad').is(':visible')) {
      if (!$(e.target).closest('.k3-plus-menu, #plusBtn, .k3-menu-mask').length) showKeypad(false);
    }
  });
  updateComposerAction();
  window.addEventListener('gamebox-balance', function () { refreshStats(); });
});
