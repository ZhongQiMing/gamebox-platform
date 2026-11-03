/**
 * 1分快三 · 聊天投注房
 * 3 颗骰子 · 55s 一期（41s 下注 + 14s 准备中，与服务端 lockAt 对齐）
 * BUILD 53 — 与 index.html ?v= 保持一致
 */
$(function () {
  const INTERVAL = 55;
  const PREP_SEC = 14;

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

  function avatarHtml(name, seed) {
    const hue = (seed * 41 + (name.charCodeAt(0) || 0) * 17) % 360;
    const ch = name.charAt(0) || '?';
    return `<div class="k3-msg__avatar k3-msg__avatar--gen" style="--av-hue:${hue}"><span>${ch}</span></div>`;
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
  const REVEALED_STORAGE_KEY = 'k3_revealed_v1';
  const PLAYED_ANIM_STORAGE_KEY = 'k3_played_anim_v1';
  const CLOSED_STORAGE_KEY = 'k3_closed_v1';
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

  /* 本地兜底须与 server kuai3PayTable 同值；启动后由 /pay-table 覆盖 */
  const ODDS = {
    side: 1.995,
    sum: 5,
    dice: 2.3,
    pairN: 11,
    tripletN: 168,
    tripletAny: 26,
    straight: 7.5,
    straightN: 28.5,
    alldiff: 2.16,
    alldiffN: 26,
    long: 5,
  };
  const SUM_ODDS = {
    3: 168, 4: 58, 5: 21, 6: 18, 7: 12.5, 8: 9, 9: 7, 10: 5,
    11: 5, 12: 7, 13: 9, 14: 12.5, 15: 18, 16: 21, 17: 58, 18: 168,
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
    ODDS.straightN = mulOf(pt, 'straightN', ODDS.straightN);
    ODDS.alldiff = mulOf(pt, 'alldiff', ODDS.alldiff);
    ODDS.alldiffN = mulOf(pt, 'alldiffN', ODDS.alldiffN);
    ODDS.long = mulOf(pt, 'long', ODDS.long);
    for (let n = 3; n <= 18; n++) {
      SUM_ODDS[n] = mulOf(pt, 'sum_' + n, SUM_ODDS[n]);
    }
  }
  const SUOHA_WORDS = new Set(['梭哈', '全下', 'allin']);
  const SIDE_CHARS = '大小单双';
  const DICE_CHARS = '123456';

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
    if ((m = t.match(/^和(?:值)?([3-9]|1[0-8])$/))) {
      const sum = +m[1];
      return { type: 'sum', sum, odds: SUM_ODDS[sum] || ODDS.sum };
    }
    if ((m = t.match(/^三军([1-6])$/))) return { type: 'dice', num: +m[1], odds: ODDS.dice };
    if ((m = t.match(/^独([1-6])$/))) return { type: 'dice', num: +m[1], odds: ODDS.dice };
    if ((m = t.match(/^二同(?:号)?([1-6])$/))) return { type: 'pairN', num: +m[1], odds: ODDS.pairN };
    if ((m = t.match(/^三同([1-6])$/))) return { type: 'tripletN', num: +m[1], odds: ODDS.tripletN };
    if ((m = t.match(/^三同号([1-6])$/))) return { type: 'tripletN', num: +m[1], odds: ODDS.tripletN };
    if (t === '三同' || t === '三同号' || t === '豹子' || t === '豹' || t === '三同号通选') {
      return { type: 'tripletAny', odds: ODDS.tripletAny };
    }
    if ((m = t.match(/^三连([1-6]{3})$/))) {
      const a = +m[1][0];
      const b = +m[1][1];
      const c = +m[1][2];
      if (a + 1 === b && b + 1 === c) {
        return { type: 'straightN', a, b, c, odds: ODDS.straightN };
      }
      return null;
    }
    if (t === '三连号' || t === '顺子' || t === '三连' || t === '三连号通选') {
      return { type: 'straight', odds: ODDS.straight };
    }
    if ((m = t.match(/^三不同(?:号)?([1-6]{3})$/))) {
      const digits = m[1].split('').map(Number);
      const sorted = digits.slice().sort((a, b) => a - b);
      if (new Set(sorted).size !== 3) return null;
      return {
        type: 'alldiffN',
        a: sorted[0],
        b: sorted[1],
        c: sorted[2],
        digits: sorted.join(''),
        odds: ODDS.alldiffN,
      };
    }
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
    if (p.type === 'alldiffN') return { betType: 'alldiff', betValue: p.digits || (String(p.a) + String(p.b) + String(p.c)) };
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
        const winAmount = Math.round(amount * ODDS.dice * 100) / 100;
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
      case 'alldiffN': {
        const got = [...new Set(nums)].sort((a, b) => a - b);
        win = got.length === 3 && got[0] === p.a && got[1] === p.b && got[2] === p.c;
        break;
      }
      case 'long':
        win = nums.includes(p.a) && nums.includes(p.b);
        break;
    }
    if (!win) return { winAmount: 0, profit: -amount, hit: '' };
    const winAmount = Math.round(amount * p.odds * 100) / 100;
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

  function expandAllDiffCombo(digitStr) {
    const digits = uniqueDiceDigits(digitStr).sort((a, b) => a - b);
    if (digits.length < 3) return null;
    const plays = [];
    for (let i = 0; i < digits.length; i++) {
      for (let j = i + 1; j < digits.length; j++) {
        for (let k = j + 1; k < digits.length; k++) {
          const play = '三不同' + digits[i] + digits[j] + digits[k];
          if (parsePlay(play)) plays.push(play);
        }
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
        const nums = String(mSum[1]).split(/[\/\s]+/).map(Number).filter((n) => n >= 3 && n <= 18);
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

    m = t.match(/^三不同(?:号)?\/?([1-6]+)$/);
    if (m) return expandAllDiffCombo(m[1]);
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
    /* 余数不下注，留在余额里 */
    return plays.map((play) => ({ play, amount: base }));
  }

  function requiresSlashPlayPart(playPart) {
    const t = String(playPart || '');
    if (/^(三军|二同|独)/.test(t)) return true;
    if (/^三连(?:号)?\/?[1-6]{3,}$/.test(t)) return true;
    if (/^三不同(?:号)?[1-6]{3,}$/.test(t)) return true;
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
    /* 服务端的开奖网格对齐 Unix 纪元，推算必须站在服务端时间轴上 */
    const t = now != null ? now : srvNow();
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
    let r = (openAt - srvNow()) / 1000;
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
    const empty = '<div class="k3-bot-empty">本期暂无下注</div>';
    if (!bets.length) {
      return '<div class="k3-bot-card k3-bot-card--bets"><div class="k3-bot-card__head"><span class="k3-bot-card__title">注单核对</span><span class="k3-bot-card__issue">' + issue + '</span></div>' + empty + '</div>';
    }
    const total = bets.reduce(function (s, b) { return s + (Number(b.amount) || 0); }, 0);
    const groups = App.groupLotteryBetsByType(bets);
    const tags = groups.map(function (g) {
      return '<span class="k3-bot-tag">' + g.label + '×' + g.count + '/' + fmtMoney2(g.amount) + '</span>';
    }).join('');
    let detail = '';
    if (bets.length <= 8) {
      detail = '<div class="k3-bot-user__tags" style="margin-top:6px">' + bets.map(function (b) {
        return '<span class="k3-bot-tag">' + App.labelLotteryBet(b) + '/' + fmtMoney2(b.amount) + '</span>';
      }).join('') + '</div>';
    }
    const userBlock = '<div class="k3-bot-user is-me"><div class="k3-bot-user__head"><span class="k3-bot-user__name">我</span><span class="k3-bot-user__sum">' + fmtMoney2(total) + '</span></div><div class="k3-bot-user__tags">' + tags + '</div>' + detail + '</div>';
    return '<div class="k3-bot-card k3-bot-card--bets"><div class="k3-bot-card__head"><span class="k3-bot-card__title">注单核对</span><span class="k3-bot-card__issue">' + issue + '</span></div><div class="k3-bot-card__body is-full">' + userBlock + '</div></div>';
  }
  function buildMineLineHtmlFromServer(issue, list) {
    const scoped = App.filterLotteryBetsByIssue ? App.filterLotteryBetsByIssue(list, issue) : (Array.isArray(list) ? list : []);
    const bets = scoped.filter(function (b) { return b && b.status !== 'CANCELLED' && b.status !== 'PENDING'; });
    if (!bets.length) return '';
    const myProfit = bets.reduce(function (sum, b) { return sum + serverBetProfit(b); }, 0);
    const myWin = bets.reduce(function (sum, b) { return sum + (Number(b.payout) || 0); }, 0);
    const profitCls = myProfit >= 0 ? 'pos' : 'neg';
    const winText = myWin > 0 ? ('中奖 +' + fmtMoney2(myWin)) : '未中奖';
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
      const tags = bets.map(b => `<span class="k3-bot-tag">${b.play}/${fmtMoney2(b.amount)}</span>`).join('');
      return `<div class="k3-bot-user${name === user.name ? ' is-me' : ''}"><div class="k3-bot-user__head"><span class="k3-bot-user__name">${name}</span><span class="k3-bot-user__sum">${fmtMoney2(total)}</span></div><div class="k3-bot-user__tags">${tags}</div></div>`;
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
      const tags = winRows.map(r => `<span class="k3-bot-tag k3-bot-tag--win">${r.play}/${fmtMoney2(r.amount)}</span>`).join('');
      return `<div class="k3-bot-user"><div class="k3-bot-user__head"><span class="k3-bot-user__name">${name}</span><span class="k3-bot-user__profit ${totalProfit >= 0 ? 'pos' : 'neg'}">${fmtProfit(totalProfit)}</span></div><div class="k3-bot-user__tags">${tags}</div></div>`;
    }).join('') : '<div class="k3-bot-empty">本期暂无中奖</div>';
    let mine = '';
    const myRows = settled && settled[user.name];
    if (myRows && myRows.length) {
      const myProfit = myRows.reduce((s, r) => s + r.profit, 0);
      const myWin = myRows.reduce((s, r) => s + r.winAmount, 0);
      const profitCls = myProfit >= 0 ? 'pos' : 'neg';
      const winText = myWin > 0 ? `中奖 +${fmtMoney2(myWin)}` : '未中奖';
      mine = `<div class="k3-bot-mine-line ${profitCls}"><span class="k3-bot-mine-line__label">您本期</span><span class="k3-bot-mine-line__win">${winText}</span><span class="k3-bot-mine-line__profit">输赢 ${fmtProfit(myProfit)}</span></div>`;
    }
    return `<div class="k3-bot-card k3-bot-card--win"><div class="k3-bot-card__head"><span class="k3-bot-card__title">中奖核对</span><span class="k3-bot-card__issue">${issue}</span></div><div class="k3-bot-card__body is-full">${body}</div>${mine}</div>`;
  }

  /** 用服务端派彩校正顶部输赢/流水（按期号去重后直接累加） */
  function refineUserStatsFromServer(issue, list) {
    const id = String(issue || '');
    if (!id) return;
    const bets = (list || []).filter(function (b) { return b && b.status !== 'CANCELLED' && b.status !== 'PENDING'; });
    if (!bets.length) return;
    const storeKey = 'k3_stats_applied_' + (user && user.uid ? user.uid : 'guest');
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
    /* 铃声只走 armCountdown；此处仅作 3 秒补开 */
    if (window.K3Audio && K3Audio.onCountdownSec) K3Audio.onCountdownSec(displaySec);
  }

  function getStats(uid) {
    try { return JSON.parse(localStorage.getItem('k3_stats_' + uid)) || { turnover: 0, winloss: 0, rebate: 0 }; } catch (e) { return { turnover: 0, winloss: 0, rebate: 0 }; }
  }

  function saveStats(uid, s) { localStorage.setItem('k3_stats_' + uid, JSON.stringify(s)); }

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

  function renderDrawBar(row) {
    if (!row) {
      $('#barIssue').text('--------');
      $('#barBalls').html('');
      $('#barGy').text('等待');
      $('#barLh').text('开奖');
      return;
    }
    $('#barIssue').text(row.issue);
    $('#barBalls').html(row.nums.map(n => diceHtml(n, 'xs')).join(''));
    $('#barGy').text(String(row.gy || '').replace(/\s+/g, ''));
    $('#barLh').text(row.lh || '---');
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

  /** 正版开奖动画：倒计时 3s → 摇骰 5s → 出号 */
  const K3_VIDEO_SRC = './media/kuai3-video/Kuai3_jisu.html?v=1742046&embed=1&mute=1';
  const K3_VIDEO_COUNTDOWN_MS = 3000;
  const K3_VIDEO_MID_MS = 5000;
  /** 正版 stopGame：第 3 骰 1600ms 落地，顶栏/底栏此时揭晓 */
  const K3_VIDEO_LAND_MS = 1600;
  /** 正版 stopGame 后等 2s 再收尾（盖住交错出号） */
  const K3_VIDEO_AFTER_MS = 2000;
  /** mid 只许拉长：出号对齐 openAt，收尾 after 仍原速 */
  const K3_VIDEO_MID_MAX_MS = Math.max(
    K3_VIDEO_MID_MS,
    PREP_SEC * 1000 - K3_VIDEO_COUNTDOWN_MS - K3_VIDEO_LAND_MS - 500
  );

  function k3VideoOrderStr(nums) {
    return (nums || []).map(function (n) { return String(Number(n)); }).join(',');
  }

  function k3IssueNext(issue) {
    const s = String(issue || '').replace(/\D/g, '');
    if (!s) return '';
    if (s.length >= 10) {
      const head = s.slice(0, -6);
      const seq = parseInt(s.slice(-6), 10) + 1;
      return head + pad(Math.max(1, isFinite(seq) ? seq : 1), 6);
    }
    try { return String(BigInt(s) + 1n); } catch (e) { return s; }
  }

  /** 由期号反推开奖点（上海日 + 序号 × INTERVAL） */
  function k3OpenAtFromIssue(issue) {
    /* 返回值落在服务端时间轴上，解析不出时的兜底也必须用校准钟 */
    const s = String(issue || '').replace(/\D/g, '');
    if (s.length < 10) return srvNow();
    const md = s.slice(0, 4);
    const seq = parseInt(s.slice(4), 10);
    if (!isFinite(seq) || seq < 1) return srvNow();
    const m = md.slice(0, 2);
    const d = md.slice(2, 4);
    const y = shanghaiYmdParts(new Date()).y;
    const dayStart = Date.parse(y + '-' + m + '-' + d + 'T00:00:00+08:00');
    if (!isFinite(dayStart)) return srvNow();
    return dayStart + (seq - 1) * INTERVAL * 1000;
  }

  function resultCardHtml(nums, issue, opts) {
    opts = opts || {};
    const meta = sumMeta(nums);
    const shape = shapeRow(nums);
    const sideText = meta.text.replace(/^\d+\s*/, '');
    const order = k3VideoOrderStr(nums);
    const issueShow = String(issue || '').trim();
    const nextIssue = k3IssueNext(issueShow);
    const drawAt = k3OpenAtFromIssue(issueShow);
    const settled = !!opts.settle;
    let srcQ = K3_VIDEO_SRC;
    if (issueShow) srcQ += '&issue=' + encodeURIComponent(issueShow);
    if (nextIssue) srcQ += '&nextIssue=' + encodeURIComponent(nextIssue);
    if (order) srcQ += '&order=' + encodeURIComponent(order);
    if (drawAt) srcQ += '&drawAt=' + encodeURIComponent(String(drawAt));
    if (settled) srcQ += '&settle=1';
    /* 直播揭晓前底部不露号，等动画结束再填 */
    const sumV = settled ? meta.sum : '—';
    const sideV = settled ? sideText : '—';
    const shapeV = settled ? shape : '—';
    return (
      '<div class="k3-video-card k3-bot-card--result is-reveal' +
        (settled ? ' is-result-shown is-frame-ready' : '') +
        '" data-issue="' + issueShow +
        '" data-nums="' + order + '" data-next="' + nextIssue + '" data-draw-at="' + drawAt +
        '" data-sum="' + meta.sum +
        '" data-side="' + sideText +
        '" data-shape="' + shape + '">' +
        '<div class="k3-video-card__stage">' +
          '<iframe class="k3-video-card__frame" title="1分快3开奖动画" src="' + srcQ +
            '" data-nums="' + order + '" data-issue="' + issueShow +
            '" allow="autoplay" loading="eager"></iframe>' +
        '</div>' +
        '<footer class="k3-video-card__foot">' +
          '<div class="k3-video-card__pill" data-k="sum"><span class="k">和值</span><span class="v">' + sumV + '</span></div>' +
          '<div class="k3-video-card__pill" data-k="side"><span class="k">双面</span><span class="v">' + sideV + '</span></div>' +
          '<div class="k3-video-card__pill" data-k="shape"><span class="k">形态</span><span class="v">' + shapeV + '</span></div>' +
        '</footer>' +
      '</div>'
    );
  }

  /** 动画收尾后揭晓底部三格（与顶栏出号同步意图） */
  function revealK3VideoCardFoot(card) {
    if (!card) return;
    /* 已揭晓也要清遮罩（防 settle 漏清后卡在「正在开奖」） */
    card.classList.remove('is-hold-black');
    card.removeAttribute('data-hold-black');
    card._holdBlackExempt = true;
    if (window.LotteryHoldTip) LotteryHoldTip.clear(card);
    if (card.classList.contains('is-result-shown')) return;
    const sum = card.getAttribute('data-sum') || '—';
    const side = card.getAttribute('data-side') || '—';
    const shape = card.getAttribute('data-shape') || '—';
    const setV = function (key, val) {
      const el = card.querySelector('.k3-video-card__pill[data-k="' + key + '"] .v');
      if (el) el.textContent = val;
    };
    setV('sum', sum);
    setV('side', side);
    setV('shape', shape);
    card.classList.add('is-result-shown');
  }

  function resultRevealDurationMs() {
    /* 倒计时 3s + 摇骰 5s + 出号收尾 2s */
    return K3_VIDEO_COUNTDOWN_MS + K3_VIDEO_MID_MS + K3_VIDEO_AFTER_MS;
  }

  /** 把聊天记录里的视频卡标记为 settle，下次进房不再重播；不改直播 iframe.src（避免闪一下） */
  function persistK3VideoSettled(card) {
    if (!card) return;
    const issue = String(card.getAttribute('data-issue') || '').trim();
    card.setAttribute('data-settled', '1');
    try {
      chatLog.forEach(function (m) {
        if (!m || !m.html || m.html.indexOf('k3-video-card') < 0) return;
        if (issue && m.html.indexOf('data-issue="' + issue + '"') < 0) return;
        if (m.html.indexOf('settle=1') >= 0) return;
        m.html = m.html.replace(
          /(k3-video-card__frame[^>]*src="[^"]+)/,
          function (s) { return s.indexOf('settle=1') >= 0 ? s : (s + '&settle=1'); }
        );
      });
      saveChatLog();
    } catch (e) { /* ignore */ }
  }

  function postToK3VideoFrame(frame, payload) {
    if (!frame || !frame.contentWindow) return false;
    try {
      frame.contentWindow.postMessage(
        Object.assign({ source: 'kuai3-video' }, payload || {}), location.origin);
      return true;
    } catch (e) {
      return false;
    }
  }

  function whenK3VideoReady(frame, cb) {
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
      try {
        const card = frame.closest && frame.closest('.k3-video-card');
        if (card) card.classList.add('is-frame-ready');
      } catch (e) { /* ignore */ }
      if (typeof cb === 'function') cb(!!ok);
    };
    /* 必须等 iframe boot（__ready / ready 消息），不能仅凭 API 对象存在就 play */
    const isBooted = function () {
      try {
        const api = frame.contentWindow && frame.contentWindow.K3Video;
        return !!(api && api.__ready && typeof api.play === 'function');
      } catch (e) {
        return false;
      }
    };
    const onMsg = function (ev) {
      const d = ev && ev.data;
      if (!d || d.source !== 'kuai3-video') return;
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

  function playK3VideoCard(card, nums, opts) {
    opts = opts || {};
    const frame = card && card.querySelector('.k3-video-card__frame');
    const order = k3VideoOrderStr(nums);
    const issue = String((opts.issue != null && String(opts.issue).trim())
      || (card && card.getAttribute('data-issue')) || '').trim();
    const nextIssue = String((card && card.getAttribute('data-next')) || k3IssueNext(issue)).trim();
    const drawAt = Number((card && card.getAttribute('data-draw-at')) || k3OpenAtFromIssue(issue));
    if (!frame || !order) {
      if (typeof opts.onDone === 'function') opts.onDone(false);
      return;
    }
    card.classList.add('is-playing');
    card.classList.remove('is-hold-black');
    card.removeAttribute('data-hold-black');
    if (window.LotteryHoldTip) LotteryHoldTip.clear(card);
    card.setAttribute('data-playing', '1');
    card._k3NumsNotified = false;
    card._k3DoneOnce = false;
    whenK3VideoReady(frame, function (booted) {
      const onNumbersReady = function () {
        if (card._k3NumsNotified) return;
        card._k3NumsNotified = true;
        revealK3VideoCardFoot(card);
        if (typeof notifyDrawBarNumbersReady === 'function') {
          notifyDrawBarNumbersReady(issue, nums, 3);
        }
      };
      const onMsg = function (ev) {
        const d = ev && ev.data;
        if (!d || d.source !== 'kuai3-video' || d.action !== 'numbers') return;
        if (ev.source !== frame.contentWindow) return;
        onNumbersReady();
      };
      const doneWrap = function (ok) {
        if (card._k3DoneOnce) return;
        card._k3DoneOnce = true;
        window.removeEventListener('message', onMsg);
        revealK3VideoCardFoot(card);
        onNumbersReady();
        card.classList.remove('is-playing', 'is-hold-black');
        card.removeAttribute('data-playing');
        card.removeAttribute('data-hold-black');
        /* 禁止改 iframe.src（整页重载会闪一下）；只写 chatLog */
        persistK3VideoSettled(card);
        card._k3PlayedLive = true;
        card._holdBlackExempt = true;
        /* 尾动画播完：再开盘线 + 顶栏倒计时 */
        if (typeof notifyDrawCeremonyReady === 'function') {
          notifyDrawCeremonyReady(issue);
        }
        if (window.K3Audio && K3Audio.endDrawCeremony) K3Audio.endDrawCeremony();
        else if (window.K3Audio && K3Audio.onRevealDone) K3Audio.onRevealDone();
        if (typeof opts.onDone === 'function') opts.onDone(ok);
      };
      if (!booted) {
        card.classList.remove('is-playing');
        card.removeAttribute('data-playing');
        try { settleK3VideoCard(card, nums); } catch (e) { /* ignore */ }
        onNumbersReady();
        if (typeof notifyDrawCeremonyReady === 'function') {
          notifyDrawCeremonyReady(issue);
        }
        card._k3DoneOnce = true;
        card._holdBlackExempt = true;
        if (typeof opts.onDone === 'function') opts.onDone(false);
        return;
      }
      window.addEventListener('message', onMsg);
      const cdMs = opts.countdownMs != null ? Number(opts.countdownMs) : K3_VIDEO_COUNTDOWN_MS;
      let midMs = opts.midMs != null ? Number(opts.midMs) : K3_VIDEO_MID_MS;
      const afterMs = opts.afterMs != null ? Number(opts.afterMs) : K3_VIDEO_AFTER_MS;
      const landMs = Math.min(K3_VIDEO_LAND_MS, Math.max(0, afterMs));
      /*
       * 出号点 = 倒计时 + 摇骰 + 最后一骰落地，对齐 openAt。
       * mid 只许拉长；收尾 after 原速，onDone 落在开奖之后。
       */
      if (opts.midMs == null && serverCurrent && String(serverCurrent.issueNo || '') === String(issue || '')) {
        const openAt = new Date(serverCurrent.openAt).getTime();
        if (Number.isFinite(openAt)) {
          const remain = openAt - srvNow();
          const targetMid = remain - Math.max(0, cdMs) - landMs - 200;
          if (Number.isFinite(targetMid) && targetMid >= K3_VIDEO_MID_MS) {
            midMs = Math.min(K3_VIDEO_MID_MAX_MS, targetMid);
          }
        }
      }
      const numbersAtMs = Math.max(0, cdMs) + Math.max(0, midMs) + landMs;
      const totalMs = Math.max(0, cdMs) + Math.max(0, midMs) + Math.max(0, afterMs);
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
        if (window.K3Audio) {
          if (K3Audio.unlock) K3Audio.unlock();
          if (K3Audio.startDrawCeremony) {
            K3Audio.startDrawCeremony({
              countdownMs: cdMs,
              midMs: midMs,
              afterMs: afterMs,
            });
          }
        }
      } catch (eAudio) { /* ignore */ }
      const w = frame.contentWindow;
      if (w && w.K3Video && typeof w.K3Video.play === 'function') {
        try {
          w.K3Video.play(order, {
            issue: issue,
            nextIssue: nextIssue,
            drawAt: drawAt,
            countdownMs: cdMs,
            midMs: midMs,
            afterMs: afterMs,
            muted: true,
            onNumbers: onNumbersReady,
            onDone: doneWrap,
          });
          return;
        } catch (ePlay) { /* 改走 postMessage */ }
      }
      postToK3VideoFrame(frame, {
        action: 'play',
        order: order,
        issue: issue,
        nextIssue: nextIssue,
        drawAt: drawAt,
        countdownMs: cdMs,
        midMs: midMs,
        afterMs: afterMs,
        muted: true,
      });
      setTimeout(onNumbersReady, numbersAtMs);
      setTimeout(function () { doneWrap(true); }, totalMs || resultRevealDurationMs());
    });
  }

  /**
   * 软落定：只调 iframe API + 露脚，禁止改 src。
   * 改 src 加 settle=1 会整页重载，表现为「出号后再闪一下」。
   */
  function settleK3VideoCard(card, nums) {
    if (card && (card.classList.contains('is-playing') || card.getAttribute('data-playing') === '1')) {
      return; /* 摇骰中禁止打断 */
    }
    const alreadySettled = !!(card && (
      card.getAttribute('data-settled') === '1' || card.classList.contains('is-result-shown')
    ));
    if (card) {
      card.removeAttribute('data-hold-black');
      card.classList.remove('is-hold-black');
      if (window.LotteryHoldTip) LotteryHoldTip.clear(card);
      revealK3VideoCardFoot(card);
      card.classList.add('is-frame-ready');
    }
    if (alreadySettled) return;
    const frame = card && card.querySelector('.k3-video-card__frame');
    let order = '';
    if (Array.isArray(nums) && nums.length === 3) order = k3VideoOrderStr(nums);
    else order = String((card && card.getAttribute('data-nums')) || (frame && frame.getAttribute('data-nums')) || '').trim();
    const issue = String((card && card.getAttribute('data-issue')) || '').trim();
    const nextIssue = String((card && card.getAttribute('data-next')) || k3IssueNext(issue)).trim();
    const drawAt = Number((card && card.getAttribute('data-draw-at')) || k3OpenAtFromIssue(issue));
    if (!frame || !order) return;
    whenK3VideoReady(frame, function () {
      const w = frame.contentWindow;
      if (w && w.K3Video && typeof w.K3Video.settle === 'function') {
        w.K3Video.settle(order, {
          issue: issue,
          nextIssue: nextIssue,
          drawAt: drawAt,
          muted: true,
          resumeCountdown: false,
        });
        return;
      }
      postToK3VideoFrame(frame, {
        action: 'settle',
        order: order,
        issue: issue,
        nextIssue: nextIssue,
        drawAt: drawAt,
        muted: true,
      });
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

  /**
   * 中途离房再进 / 历史重放：仪式未完时压成黑卡（倒计时脸、底栏 —），避免泄底。
   */
  function holdBlackK3VideoCard(card) {
    if (!card) return false;
    if (card.classList.contains('is-playing') || card.getAttribute('data-playing') === '1') return false;
    /* 本页已播完/揭晓：禁止快照再压黑（否则会 setRevealPending 清掉 winFlushed，卡住开盘线） */
    if (card._holdBlackExempt || card.classList.contains('is-result-shown') || card.getAttribute('data-settled') === '1') return false;
    if (card.getAttribute('data-hold-black') === '1' && !card.classList.contains('is-result-shown')) {
      const frame0 = card.querySelector('.k3-video-card__frame');
      const src0 = frame0 ? String(frame0.getAttribute('src') || '') : '';
      if (src0 && src0.indexOf('settle=1') < 0) {
        if (window.LotteryHoldTip) LotteryHoldTip.ensure(card, '.k3-video-card__stage');
        return true;
      }
    }
    const order = String(card.getAttribute('data-nums') || '').trim();
    const issue = String(card.getAttribute('data-issue') || '').trim();
    const nextIssue = String(card.getAttribute('data-next') || k3IssueNext(issue)).trim();
    const drawAt = Number(card.getAttribute('data-draw-at') || k3OpenAtFromIssue(issue));
    card.setAttribute('data-hold-black', '1');
    card.removeAttribute('data-settled');
    card.classList.remove('is-result-shown', 'is-frame-ready');
    card.classList.add('is-hold-black');
    const setV = function (key, val) {
      const el = card.querySelector('.k3-video-card__pill[data-k="' + key + '"] .v');
      if (el) el.textContent = val;
    };
    setV('sum', '—');
    setV('side', '—');
    setV('shape', '—');
    const frame = card.querySelector('.k3-video-card__frame');
    if (frame && order) {
      let src = K3_VIDEO_SRC + '&hold=1&order=' + encodeURIComponent(order);
      if (issue) src += '&issue=' + encodeURIComponent(issue);
      if (nextIssue) src += '&nextIssue=' + encodeURIComponent(nextIssue);
      if (isFinite(drawAt)) src += '&drawAt=' + encodeURIComponent(String(drawAt));
      frame.setAttribute('src', src);
    }
    if (window.LotteryHoldTip) LotteryHoldTip.ensure(card, '.k3-video-card__stage');
    return true;
  }

  /** 刷新/重进：开奖中压黑幕，避免泄底 */
  function holdBlackLockedK3VideoCards() {
    if (!serverCurrent) return;
    const issue = String(serverCurrent.issueNo || '').trim();
    if (!issue || !isServerDrawingIssue(issue)) return;
    let newlyHeld = false;
    $('#chatFeed .k3-video-card, #chatDock .k3-video-card').each(function () {
      const card = this;
      if (String(card.getAttribute('data-issue') || '').trim() !== issue) return;
      const frame = card.querySelector('.k3-video-card__frame');
      const src = frame ? String(frame.getAttribute('src') || '') : '';
      if (card.getAttribute('data-hold-black') === '1' && card.classList.contains('is-hold-black') && src.indexOf('settle=1') < 0) return;
      if (holdBlackK3VideoCard(card)) newlyHeld = true;
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
    const feed = document.getElementById('chatFeed');
    if (feed) {
      const cards = feed.querySelectorAll('.k3-result-card.is-settled:not([data-laid="1"])');
      const settled = cards[cards.length - 1];
      if (settled && window.K3ResultCard && K3ResultCard.initSettled) K3ResultCard.initSettled(settled);
    }
    scrollChat();
  }

  /** 进房/恢复：历史视频卡补 settle，跳过正在播的 / 当期开奖中 */
  function settleRestoredK3VideoCards() {
    const holdIssue = (roomChat && typeof roomChat.getCeremonyHoldIssue === 'function')
      ? String(roomChat.getCeremonyHoldIssue() || '').trim()
      : '';
    const phaseIssue = (roomChat && typeof roomChat.getPhaseIssue === 'function')
      ? String(roomChat.getPhaseIssue() || '').trim()
      : '';
    $('#chatFeed .k3-video-card').each(function () {
      const card = this;
      if (card.classList.contains('is-playing') || card.getAttribute('data-playing') === '1') return;
      const issue = String(card.getAttribute('data-issue') || '').trim();
      if (issue && isServerDrawingIssue(issue)) return;
      if (issue && ((holdIssue && issue === holdIssue) || (phaseIssue && issue === phaseIssue))) {
        if (typeof isCeremonyHolding === 'function' && isCeremonyHolding()) return;
      }
      const frame = card.querySelector('.k3-video-card__frame');
      const src = frame ? String(frame.getAttribute('src') || '') : '';
      if (src && src.indexOf('settle=1') >= 0) {
        card.classList.add('is-frame-ready', 'is-result-shown');
        revealK3VideoCardFoot(card);
        return;
      }
      if (card.getAttribute('data-settled') === '1') {
        card.classList.add('is-frame-ready');
        revealK3VideoCardFoot(card);
        return;
      }
      settleK3VideoCard(card);
    });
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
    settleRestoredK3VideoCards();
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
    $('#chatFeed .k3-video-card, #chatDock .k3-video-card').each(function () {
      const card = this;
      if (issue && String(card.getAttribute('data-issue') || '').trim() !== issue) return;
      /* 摇骰/尾段仍在播：勿掐动画，只保证脚注；仪式在 onDone 再推进 */
      if (card.classList.contains('is-playing') || card.getAttribute('data-playing') === '1') {
        revealK3VideoCardFoot(card);
        card._holdBlackExempt = true;
        return;
      }
      card.classList.remove('is-playing');
      card.removeAttribute('data-playing');
      let nums = null;
      const raw = String(card.getAttribute('data-nums') || '').trim();
      if (raw) {
        const arr = raw.split(',').map(Number);
        if (arr.length === 3) nums = arr;
      }
      settleK3VideoCard(card, nums);
      card._holdBlackExempt = true;
      if (typeof persistK3VideoSettled === 'function') persistK3VideoSettled(card);
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
    buildResultHtml: function (p, msg, o) {
      const nums = Array.isArray(p.nums) ? p.nums.map(Number) : [];
      const issue = String(p.issueNo || msg.issueNo || '');
      /*
       * 历史回放先黑卡：若先 settle 再压黑会「漏一下再变黑」。
       * 仅直播且不重播、且服务端已非开奖中，才直接终态。
       */
      const settle = !!(
        o &&
        o.live &&
        !o.animate &&
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
      if (nums.length === 3) {
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
        prefix: "k3",
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
        if (window.K3Audio && K3Audio.onBetting) K3Audio.onBetting();
        if (typeof requestLotteryResync === 'function') requestLotteryResync();
        else if (typeof syncServerSnapshot === 'function') syncServerSnapshot();
        if (typeof tick === 'function') try { tick(); } catch (e) { /* ignore */ }
      } else if (phase === 'drawing' || phase === 'revealing' || phase === 'settled') {
        roomBetFrozen = true;
        if (window.K3Audio && K3Audio.onDrawing) K3Audio.onDrawing();
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
      const card = $('#chatDock .k3-video-card, #chatDock .k3-result-card, #chatDock .k3-bot-card--result, #chatFeed .k3-video-card, #chatFeed .k3-result-card, #chatFeed .k3-bot-card--result').last()[0];
      const readyMs = resultRevealDurationMs() + 800;
      if (card && card.classList.contains('k3-video-card')) {
        if (ctx.animate && ctx.live) {
          ctx.setRevealPending(issue);
          /* scheduleRevealReady 改在 play 真正开播后武装（见 playK3VideoCard） */
          playK3VideoCard(card, nums, { issue: issue });
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
            holdBlackK3VideoCard(card);
            ctx.setRevealPending(issue);
            const openAt = serverCurrent && new Date(serverCurrent.openAt).getTime();
            const remain = Number.isFinite(openAt)
              ? Math.max(1200, openAt - srvNow() + 600)
              : readyMs;
            ctx.scheduleRevealReady(issue, Math.min(remain, readyMs + 400));
          } else {
            settleK3VideoCard(card, nums);
            ctx.setRevealReadyFlag(issue, true);
          }
        } else {
          /* 历史回放：保持黑卡，等 snapshot holdBlack */
          ctx.setRevealReadyFlag(issue, true);
          if (typeof holdBlackLockedK3VideoCards === 'function') {
            setTimeout(function () { try { holdBlackLockedK3VideoCards(); } catch (eR) { /* ignore */ } }, 0);
          }
        }
      } else if (card && window.K3ResultCard) {
        /* 兼容旧 Canvas 卡（历史 localStorage） */
        if (ctx.animate && ctx.live && K3ResultCard.startRoll) {
          ctx.setRevealPending(issue);
          const meta = (typeof sumMeta === 'function') ? sumMeta(nums) : null;
          const shape = (typeof shapeRow === 'function') ? shapeRow(nums) : '';
          K3ResultCard.startRoll(card, nums, issue, meta, shape, resultRevealDurationMs());
          ctx.scheduleRevealReady(issue, readyMs);
        } else if (ctx.live && K3ResultCard.initSettled) {
          K3ResultCard.initSettled(card);
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

  function closeNoticeHtml(issue) {
    return `<div class="k3-bot-close-line"><div class="k3-bot-close-line__bar"><span class="k3-bot-close-line__deco"></span><span class="k3-bot-close-line__text">封 盘 线</span><span class="k3-bot-close-line__deco"></span></div><div class="k3-bot-close-line__sub">第 <span class="k3-bot-close-line__issue">${issue}</span> 期 · 停止下注 · 即将开奖</div></div>`;
  }
  function openNoticeHtml(issue) {
    return `<div class="k3-bot-open-line">
      <div class="k3-bot-open-line__bar">
        <span class="k3-bot-open-line__deco"></span>
        <span class="k3-bot-open-line__text">开 盘 线</span>
        <span class="k3-bot-open-line__deco"></span>
      </div>
      <div class="k3-bot-open-line__sub">第 <span class="k3-bot-open-line__issue">${issue}</span> 期 · 开始下注</div>
    </div>`;
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
      id: 'sideSum',
      title: '和值',
      hint: '',
      subs: null,
      sideItems: () => ['大', '小', '单', '双'].map(p => ({ play: p, label: p, odds: ODDS.side })),
      sumItems: () => Array.from({ length: 16 }, (_, i) => {
        const sum = i + 3;
        return { play: '和' + sum, label: String(sum), odds: SUM_ODDS[sum] || ODDS.sum };
      }),
    },
    {
      id: 'dice',
      title: '三军',
      hint: '',
      subs: null,
      items: () => Array.from({ length: 6 }, (_, i) => {
        const n = i + 1;
        return { play: '三军' + n, label: '三军' + n, odds: ODDS.dice };
      }),
    },
    {
      id: 'pair',
      title: '二同号',
      hint: '',
      subs: null,
      items: () => Array.from({ length: 6 }, (_, i) => {
        const n = i + 1;
        return { play: '二同' + n, label: String(n) + String(n), odds: ODDS.pairN };
      }),
    },
    {
      id: 'triplet',
      title: '三同号',
      hint: '',
      subs: null,
      items: () => [
        ...Array.from({ length: 6 }, (_, i) => {
          const n = i + 1;
          return { play: '三同' + n, label: String(n).repeat(3), odds: ODDS.tripletN };
        }),
        { play: '三同号', label: '三同号通选', odds: ODDS.tripletAny, wide: true },
      ],
    },
    {
      id: 'straight',
      title: '三连号',
      hint: '',
      subs: null,
      items: () => [
        { play: '三连123', label: '123', odds: ODDS.straightN },
        { play: '三连234', label: '234', odds: ODDS.straightN },
        { play: '三连345', label: '345', odds: ODDS.straightN },
        { play: '三连456', label: '456', odds: ODDS.straightN },
        { play: '三连号', label: '三连号通选', odds: ODDS.straight, wide: true },
      ],
    },
    {
      id: 'alldiff',
      title: '三不同号',
      hint: '',
      mode: 'alldiffPick',
      subs: null,
    },
    {
      id: 'long',
      title: '长牌',
      hint: '',
      subs: null,
      items: () => longPairs().map(p => ({
        play: p.play,
        a: p.a,
        b: p.b,
        odds: ODDS.long,
      })),
    },
  ];

  let playCatIdx = 0;
  let playSubIdx = 0;
  let playSelectedList = [];
  let playPickedDigits = [];
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

  function syncAllDiffPickSelection() {
    playSelectedList = playSelectedList.filter((p) => {
      const parsed = parsePlay(p);
      return !(parsed && parsed.type === 'alldiffN');
    });
    if (playPickedDigits.length !== 3) return;
    const sorted = playPickedDigits.slice().sort((a, b) => a - b);
    const play = '三不同' + sorted.join('');
    if (parsePlay(play)) playSelectedList.push(play);
  }

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
    const hasPick = playSelectedList.length > 0 || playPickedDigits.length > 0;
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
    if (!playSelectedList.length && !playPickedDigits.length) return;
    playSelectedList = [];
    playPickedDigits = [];
    renderPlayPanel();
    updatePlaySelected();
  }

  function initPlaySheet() {
    $('#playNav').html(PLAY_CATEGORIES.map((c, i) =>
      `<button type="button" class="k3-play-nav__item${i === playCatIdx ? ' is-active' : ''}" data-idx="${i}">${c.title}</button>`
    ).join(''));
    $('#playAmountChips').html(AMOUNT_CHIPS.map((c) =>
      `<button type="button" class="k3-play-foot__chip${c.amt === 100 ? ' is-active' : ''}" data-amt="${c.amt}" aria-label="${c.label}">` +
        `<span class="k3-play-foot__chip-glow" aria-hidden="true"></span>` +
        `<img src="${CHIP_IMG(c.amt)}" alt="${c.label}" draggable="false">` +
      `</button>`
    ).join(''));
    syncPlayFootTotals();
  }

  function playItemHtml(play, label, odds, extraCls) {
    const cls = ['k3-play-item', extraCls, isPlaySelected(play) ? 'is-active' : ''].filter(Boolean).join(' ');
    const oddsHtml = odds != null ? `<small>${odds}</small>` : '';
    return `<button type="button" class="${cls}" data-play="${play}"><span>${label}</span>${oddsHtml}</button>`;
  }

  function playSectionHtml(title, gridCls, cellsHtml) {
    return `<div class="k3-play-section"><div class="k3-play-section__title">${title}</div><div class="k3-play-section__grid ${gridCls}">${cellsHtml}</div></div>`;
  }

  function playDiceBtn(play, diceInner, odds, extraCls, diceCls) {
    const cls = ['k3-play-item', 'k3-play-item--dice-img', extraCls, isPlaySelected(play) ? 'is-active' : ''].filter(Boolean).join(' ');
    const dCls = ['k3-play-item__dice', diceCls].filter(Boolean).join(' ');
    return `<button type="button" class="${cls}" data-play="${play}"><span class="${dCls}">${diceInner}</span><small>${odds}</small></button>`;
  }

  function renderPlayPanel() {
    const cat = currentPlayCat();
    const $grid = $('#playGrid');
    const hint = typeof cat.hint === 'function' ? cat.hint() : (cat.hint || '');
    $('#playHint').text(hint).toggle(!!hint);
    $('#playSub').addClass('is-hidden').prop('hidden', true).empty();
    let html = '';
    let gridMode = 'is-sectioned';
    const itemsOf = (c) => (typeof c.items === 'function' ? c.items() : (c.items || []));

    if (cat.id === 'sideSum') {
      const sideItems = typeof cat.sideItems === 'function' ? cat.sideItems() : cat.sideItems;
      const sumItems = typeof cat.sumItems === 'function' ? cat.sumItems() : cat.sumItems;
      const sideHtml = sideItems.map(it => playItemHtml(it.play, it.label, it.odds, 'k3-play-item--side')).join('');
      const sumHtml = sumItems.map(it => playItemHtml(it.play, it.label, it.odds, 'k3-play-item--sum')).join('');
      html = playSectionHtml('和值两面', 'is-side', sideHtml)
        + playSectionHtml('和值', 'is-text is-gy-sum', sumHtml);
    } else if (cat.id === 'dice') {
      const cells = itemsOf(cat).map(it => {
        const n = +String(it.play).replace('三军', '');
        return playDiceBtn(it.play, diceHtml(n, 'play'), it.odds);
      }).join('');
      html = playSectionHtml('三军', 'is-dice', cells);
    } else if (cat.id === 'pair') {
      const cells = itemsOf(cat).map(it => {
        const n = +String(it.play).replace('二同', '');
        return playDiceBtn(it.play, diceHtml(n, 'play') + diceHtml(n, 'play'), it.odds, '', 'k3-play-item__dice--pair');
      }).join('');
      html = playSectionHtml('二同号', 'is-dice', cells);
    } else if (cat.id === 'triplet') {
      const cells = itemsOf(cat).map(it => {
        if (it.wide || it.play === '三同号') {
          return playItemHtml(it.play, it.label, it.odds, 'k3-play-item--tri-any k3-play-item--wide');
        }
        const n = +String(it.play).replace('三同', '');
        return playDiceBtn(
          it.play,
          diceHtml(n, 'play') + diceHtml(n, 'play') + diceHtml(n, 'play'),
          it.odds,
          '',
          'k3-play-item__dice--tri'
        );
      }).join('');
      html = playSectionHtml('三同号', 'is-dice is-gy-sum', cells);
    } else if (cat.id === 'straight') {
      const cells = itemsOf(cat).map(it => {
        if (it.wide || it.play === '三连号') {
          return playItemHtml(it.play, it.label, it.odds, 'k3-play-item--wide');
        }
        const digits = String(it.play).replace('三连', '');
        const diceInner = digits.split('').map((d) => diceHtml(+d, 'play')).join('');
        return playDiceBtn(it.play, diceInner, it.odds);
      }).join('');
      html = playSectionHtml('三连号', 'is-dice is-gy-sum', cells);
    } else if (cat.id === 'alldiff' || cat.mode === 'alldiffPick') {
      const cells = Array.from({ length: 6 }, (_, i) => {
        const n = i + 1;
        const picking = playPickedDigits.indexOf(n) >= 0;
        const cls = ['k3-play-item', 'k3-play-item--dice-img', 'k3-play-item--pick', picking ? 'is-picked is-active' : ''].filter(Boolean).join(' ');
        return `<button type="button" class="${cls}" data-pick-digit="${n}"><span class="k3-play-item__dice">${diceHtml(n, 'play')}</span></button>`;
      }).join('');
      html = `<div class="k3-play-section"><div class="k3-play-section__title">三不同号 <small>${ODDS.alldiffN}</small></div><div class="k3-play-section__grid is-dice is-pick">${cells}</div></div>`;
    } else if (cat.id === 'long') {
      const cells = itemsOf(cat).map(it => {
        const cls = ['k3-play-item', 'k3-play-item--dice-img', 'k3-play-item--long', isPlaySelected(it.play) ? 'is-active' : ''].filter(Boolean).join(' ');
        return `<button type="button" class="${cls}" data-play="${it.play}"><span class="k3-play-item__dice k3-play-item__dice--pair">${diceHtml(it.a, 'play')}${diceHtml(it.b, 'play')}</span><small>${it.odds}</small></button>`;
      }).join('');
      html = playSectionHtml('长牌', 'is-dice is-gy-sum', cells);
    } else {
      gridMode = '';
      html = itemsOf(cat).map(it => playItemHtml(it.play, it.label, it.odds)).join('');
    }
    $grid.attr('class', `k3-play-panel__grid${gridMode ? ' ' + gridMode : ''}`).html(html);
    $grid.scrollTop(0);
  }

  /** 右侧栏顶对齐开奖条单行下沿；短屏压缩并保证不压住底部输入 */
  function layoutRail() {
    const room = document.querySelector('.k3-room');
    const rail = room && room.querySelector('.k3-rail');
    const anchor = document.getElementById('drawToggle') || document.getElementById('drawBar');
    const composer = document.querySelector('.k3-composer');
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
      playPickedDigits = [];
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
    $('#playNav .k3-play-nav__item').removeClass('is-active');
    $('#playNav .k3-play-nav__item[data-idx="' + playCatIdx + '"]').addClass('is-active');
    renderPlayPanel();

    playSelectedList = snap.plays.slice();
    playAllin = !!snap.allin;
    if (!playAllin && snap.amount > 0) {
      setPlayAmount(snap.amount);
      clearPlayAmountChipActive();
      $('#playAmountChips .k3-play-foot__chip[data-amt="' + snap.amount + '"]').addClass('is-active');
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
      /* 仅清点选态，保留已选三不同注单 */
      playPickedDigits = [];
      const keep = playSelectedList.find((p) => {
        const parsed = parsePlay(p);
        return parsed && parsed.type === 'alldiffN';
      });
      if (keep) {
        const m = String(keep).match(/([1-6]{3})$/);
        if (m) playPickedDigits = m[1].split('').map(Number);
      }
      $('#playNav .k3-play-nav__item').removeClass('is-active');
      $(this).addClass('is-active');
      renderPlayPanel();
      updatePlaySelected();
    });
    $('#playGrid').on('click', '.k3-play-item', function () {
      const pickRaw = $(this).attr('data-pick-digit');
      if (pickRaw != null && pickRaw !== '') {
        const d = +pickRaw;
        const idx = playPickedDigits.indexOf(d);
        if (idx >= 0) playPickedDigits.splice(idx, 1);
        else if (playPickedDigits.length < 3) playPickedDigits.push(d);
        syncAllDiffPickSelection();
        renderPlayPanel();
        updatePlaySelected();
        return;
      }
      const play = $(this).data('play');
      if (!play) return;
      togglePlaySelect(play);
      $(this).toggleClass('is-active', isPlaySelected(play));
      updatePlaySelected();
    });
    $('#playAmountChips').on('click', '.k3-play-foot__chip', function () {
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
        $(`#playAmountChips .k3-play-foot__chip[data-amt="${v}"]`).addClass('is-active');
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
      if (!/(result-card|video-card|bot-card--result|bot-card--win|is-reveal|is-settled|is-drawing)/.test(html)) return;
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
      const meta = nums.length === 3 ? sumMeta(nums) : { text: '' };
      return {
        issue: String(row.issueNo || ''),
        nums,
        gy: nums.length === 3 ? meta.text : '',
        lh: nums.length === 3 ? shapeRow(nums) : '',
      };
    }).filter(r => r.issue && r.nums.length === 3);
  }

  function isCeremonyHolding() {
    try {
      const phase = roomChat && roomChat.getPhase ? roomChat.getPhase() : '';
      return phase === 'drawing' || phase === 'revealing' || phase === 'settled';
    } catch (e) { return false; }
  }
  function upsertHistoryHeadFromDraw(issue, nums) {
    const iss = String(issue || '').trim();
    if (!iss || !Array.isArray(nums) || nums.length !== 3) return null;
    const meta = sumMeta(nums);
    const row = {
      issue: iss,
      nums: nums.slice(),
      gy: meta.text,
      lh: shapeRow(nums),
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
      if (iss && lastDraw && lastDraw.length === 3 && typeof upsertHistoryHeadFromDraw === 'function') {
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
          lastDraw && lastDraw.length === 3
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
      /* 仪式中期号由 tick/phase 接管，勿被快照 current 盖掉 */
      if (!isCeremonyHolding() && serverCurrent && serverCurrent.issueNo) setCurIssueDisplay(serverCurrent.issueNo);
      if (typeof settleRestoredK3VideoCards === 'function') settleRestoredK3VideoCards();
      try { holdBlackLockedK3VideoCards(); } catch (eHold) { /* ignore */ }
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
        if (window.K3Audio && K3Audio.armCountdown) K3Audio.armCountdown(toLocalMs(cutoff));
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

  layoutRail();
  $(window).on('resize orientationchange', function () { layoutRail(); });
  if (typeof ResizeObserver !== 'undefined') {
    const roomEl = document.querySelector('.k3-room');
    if (roomEl) {
      try {
        new ResizeObserver(function () { layoutRail(); }).observe(roomEl);
      } catch (e) { /* ignore */ }
    }
  }
  
  /* 右侧四钮：默认收起，点梯子展开/收起 */
  (function initRailLadder() {
    const KEY = 'k3_rail_collapsed';
    const room = document.querySelector('.k3-room');
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
      const arrow = btn.querySelector('.k3-rail-ladder__arrow');
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

/* === chat-rail handlers (k3) === */

  function playCatRulesHtml(cat) {
    const id = (cat && cat.id) || '';
    const map = {
      sideSum:
        '● 和值两面：<br>选择1个形态(大:11-17；小:4-10；单:个位数1,3,5,7,9；双:个位数0,2,4,6,8)，与开奖号码之和的形态相同，即中奖。(不含豹子)<br><br>' +
        '投注【小】；开奖号码：1,2,3，即中奖。<br><br>' +
        '● 和值：<br>选择1个数值，与开奖号码之和相同，即中奖。<br><br>' +
        '投注【11】；开奖号码：2,3,6，即中奖。',
      dice:
        '● 三军：<br><br>选择1个号码形成1注，开奖号码包含所选号码，即中奖。<br><br>' +
        '投注【1】；开奖号码：1,1,2，即中奖。所选号码出现1次、2次或3次均只派彩一次。',
      pair:
        '● 二同号：<br><br>选择1个二同号形成1注，所选号码在开奖号码中<b>恰好出现 2 次</b>，即中奖；出现 3 次（豹子）不中。<br><br>' +
        '投注【11】；开奖号码：1,1,2，即中奖；开奖号码：1,1,1，不中奖。',
      triplet:
        '● 三同号：<br><br>选择1个组合形成1注，所选组合与开奖号码相同，即中奖。<br><br>' +
        '投注【111】；开奖号码：1,1,1，即中奖；<br><br>' +
        '投注【三同号通选】；开奖号码：111, 222, 333, 444, 555, 666 中的任一组合，即中奖。',
      straight:
        '● 三连号：<br><br>选择1个组合形成1注，所选组合与开奖号码相同，即中奖。<br><br>' +
        '投注【123】；开奖号码：1,2,3，即中奖。<br><br>' +
        '投注【三连号通选】；开奖号码：123, 234, 345, 456 中的任一组合，即中奖。',
      alldiff:
        '● 三不同号：<br><br>开奖号码全部不相同，即为不同号；选择3个号码形成1注，所选组合与开奖号码相同，即中奖。<br><br>' +
        '投注【123】；开奖号码：1,2,3，即中奖。',
      long:
        '● 长牌：<br><br>任选一长牌组合、当开奖结果任2码与所选组合相同时，即为中奖。<br><br>' +
        '投注【12】【23】【13】；开奖号码：1,2,3，均中奖。',
    };
    const body = map[id] || '请在盘面点选投注项后确认投注；派彩以服务端为准。';
    return `<div class="k3-rules-sec"><p>${body}</p></div>`;
  }

  function fullRulesHtml() {
    const o = ODDS;
    const betSec = INTERVAL - PREP_SEC;
    return `
        <div class="k3-rules-sec">
          <h3 class="k3-rules-sec__title">一、开奖与时间</h3>
          <p>1分快三每期开出 <b>3</b> 颗骰子，点数各为 <b>1～6</b>。</p>
          <p>每期共 <b>${INTERVAL} 秒</b>。顶栏「距封盘」；封盘后显示「开奖中」，不可下注、不可取消。</p>
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
          <span class="k3-rules-ex">二同5/50　三同号/20　长牌12/100　三连123/80　三不同123/50</span>
          <p>「梭哈」按余额均分；玩法脚「重复」可跟上一笔。底部「+」含上下分、申请记录、竞猜报表等入口。</p>
        </div>
        <div class="k3-rules-sec">
          <h3 class="k3-rules-sec__title">三、玩法与赔率</h3>
          <p>下列为当前房间赔率（随后台更新）。派彩 = 金额 × 赔率（四舍五入到两位小数）。</p>
          <table class="k3-rules-table">
            <thead><tr><th>玩法</th><th>说明</th><th>赔率</th></tr></thead>
            <tbody>
              <tr><td>两面</td><td>三骰和值：4～10 小，11～17 大；奇单偶双。开出豹子通杀</td><td>${o.side}</td></tr>
              <tr><td>和值</td><td>猜总和 3～18，各点数赔率不同（面板可见）</td><td>约 ${o.sum} 起</td></tr>
              <tr><td>三军 / 独</td><td>指定点数至少出现 1 次；出现多次也只派彩一次</td><td>${o.dice}</td></tr>
              <tr><td>二同号</td><td>指定点数恰好出现 2 次（非豹子）</td><td>${o.pairN}</td></tr>
              <tr><td>三同号</td><td>指定豹子点数；「三同号」为通选</td><td>单号 ${o.tripletN} · 通选 ${o.tripletAny}</td></tr>
              <tr><td>三连号</td><td>单选 123/234/345/456；通选任意顺子</td><td>单选 ${o.straightN} · 通选 ${o.straight}</td></tr>
              <tr><td>三不同</td><td>指定三点（如三不同123）；「三不同号」为杂六形态</td><td>指定 ${o.alldiffN} · 形态 ${o.alldiff}</td></tr>
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
    App.go('../../client-app/pages/bet-records/bet-records.html' + q + sep + 'game=kuai3');
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
    if (!$(e.target).closest('#keypad, #chatInput, .k3-composer').length && $('#keypad').is(':visible')) {
      if (!$(e.target).closest('.k3-plus-menu, #plusBtn, .k3-menu-mask').length) showKeypad(false);
    }
  });
  updateComposerAction();
  window.addEventListener('gamebox-balance', function () { refreshStats(); });
});
