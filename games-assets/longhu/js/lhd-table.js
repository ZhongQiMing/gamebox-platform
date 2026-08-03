/* 龙虎斗桌台：倒计时 / 下注 / 筹码 / 路单 / 发牌翻牌 / 结算 */
(function () {
  if (window.__lhdBooted) return;
  window.__lhdBooted = true;

  var SERVER_GAME = 'longhu';

  /* 总周期 60s：下注 + 开奖流程(2 张发牌翻牌报点≈9s) + 派奖 4s；与大厅墙钟对齐 */
  /* 下注统一 45s；发牌/派奖时长本游戏不变；整局 = 45+9+4=58s */
  var BETTING_SEC = 45;
  var DRAW_EST_SEC = 9;
  var PAYOUT_SECS = 4;
  var ROUND_SEC = BETTING_SEC + DRAW_EST_SEC + PAYOUT_SECS;
  var TOTAL = BETTING_SEC;
  var alignWaitTimer = null;
  /* 与服务端 alignedBettingEndsAt 一致：Unix epoch 60s 网格 */
  function getAlignedBetRemain() {
    var cycleMs = ROUND_SEC * 1000;
    var bettingMs = TOTAL * 1000;
    var now = Date.now();
    var cycleStart = Math.floor(now / cycleMs) * cycleMs;
    var end = cycleStart + bettingMs;
    if (now >= end) return 0;
    return (end - now) / 1000;
  }
  function getAlignedWaitRemain() {
    var cycleMs = ROUND_SEC * 1000;
    var bettingMs = TOTAL * 1000;
    var now = Date.now();
    var cycleStart = Math.floor(now / cycleMs) * cycleMs;
    var end = cycleStart + bettingMs;
    if (now < end) return 0;
    return (cycleStart + cycleMs - now) / 1000;
  }
  function clearAlignWait() {
    if (alignWaitTimer) {
      clearTimeout(alignWaitTimer);
      alignWaitTimer = null;
    }
  }

  var serverClock = (window.TableShell && TableShell.createServerClock)
    ? TableShell.createServerClock()
    : { phase: '', secondsLeft: 0, syncedAt: 0, roundNo: '', timing: null };

  function applyServerSnap(snap) {
    if (!snap) return;
    if (window.TableShell && TableShell.applyServerSnap) {
      TableShell.applyServerSnap(serverClock, snap);
    } else {
      serverClock.phase = String(snap.phase || '');
      serverClock.secondsLeft = Number(snap.secondsLeft) || 0;
      serverClock.syncedAt = Date.now();
      serverClock.roundNo = snap.roundNo ? String(snap.roundNo) : '';
    }
    if (snap.timing && snap.timing.bettingMs) {
      BETTING_SEC = Math.max(1, Math.round(snap.timing.bettingMs / 1000));
      DRAW_EST_SEC = Math.max(1, Math.round((snap.timing.drawMs || DRAW_EST_SEC * 1000) / 1000));
      PAYOUT_SECS = Math.max(1, Math.round((snap.timing.settleMs || PAYOUT_SECS * 1000) / 1000));
      ROUND_SEC = BETTING_SEC + DRAW_EST_SEC + PAYOUT_SECS;
      TOTAL = BETTING_SEC;
    }
    if (snap.roundNo && typeof setRoundNoLabel === 'function') {
      setRoundNoLabel(snap.roundNo);
    }
  }

  function getBetRemainSec() {
    if (window.TableShell && TableShell.bettingLeftSec) {
      return TableShell.bettingLeftSec(serverClock, getAlignedBetRemain);
    }
    return getAlignedBetRemain();
  }
  var BANNER_MS = 1500;
  var FLY_MS = 360;
  var GAP_MS = 140;
  var FLIP_MS = 420;
  var FLIP_GAP_MS = 80;
  var DEAL_HOLD_MS = 240;
  var CARD_BACK = './assets/cards/card-back.png?v=9';
  var DECKS = 8;
  var phase = 'bet'; /* bet | draw | payout */
  var left = TOTAL;
  var betDeadline = 0;
  var payoutDeadline = 0;
  var lastBeatSec = -1;
  var roundBusy = false;
  /** 进房时正逢大厅封盘：等待下一周期，UI 显示「准备中」而非「派奖中」 */
  var alignWaiting = false;
  var selectedChip = 10;
  var chipPage = 0;
  var betTotals = { dragon: 0, tiger: 0, tie: 0 };
  var roundPlacements = [];
  var lastRoundPlacements = [];
  var usedUndo = false;
  var usedRebet = false;
  var roadHistory = [];
  var roadStats = { dragon: 0, tiger: 0, tie: 0 };
  var roadRoundNos = {};
  var ROAD_ROWS = 6;
  var ROAD_LABELS = { dragon: '龙', tiger: '虎', tie: '和' };
  var ROAD_ALLOWED = { dragon: 1, tiger: 1, tie: 1 };
  var SUITS = ['spade', 'heart', 'club', 'diamond'];
  var RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
  var CHIP_SRC = {
    1: './assets/ui/chips/chip-1.png?v=4',
    5: './assets/ui/chips/chip-5.png?v=4',
    10: './assets/ui/chips/chip-10.png?v=4',
    50: './assets/ui/chips/chip-50.png?v=4',
    100: './assets/ui/chips/chip-100.png?v=4',
    500: './assets/ui/chips/chip-500.png?v=4',
    1000: './assets/ui/chips/chip-1000.png?v=1',
    2000: './assets/ui/chips/chip-2000.png?v=1',
    3000: './assets/ui/chips/chip-3000.png?v=1',
    4000: './assets/ui/chips/chip-4000.png?v=1',
    5000: './assets/ui/chips/chip-5000.png?v=1',
    10000: './assets/ui/chips/chip-10000.png?v=1'
  };
  var CHIP_PAGES = [
    [1, 5, 10, 50, 100, 500],
    [1000, 2000, 3000, 4000, 5000, 10000]
  ];
  /* 赔率按「押 1 赔 X」利润倍率；与 @gamebox/shared 同源，启动后 TableShell 覆盖并同步 DOM */
  var ODDS = { dragon: 0.95, tiger: 1, tie: 8 };
  if (window.TableShell) {
    TableShell.loadPayTable(SERVER_GAME, { odds: ODDS, domRoot: document.getElementById('betArea') });
  }
  var TIE_REFUND = 1;
  var DEAL_ORDER = ['d1', 't1'];

  var timeEl = document.getElementById('cdTime');
  var timerBox = document.getElementById('timerBox');
  var shoe = document.getElementById('shoeBox');
  var chipBar = document.getElementById('chipBar');
  var actionBar = document.getElementById('actionBar');
  var betArea = document.getElementById('betArea');
  var beadGrid = document.getElementById('beadGrid');
  var bigGrid = document.getElementById('bigGrid');
  var beadScroll = document.getElementById('beadScroll');
  var bigScroll = document.getElementById('bigScroll');
  var dragonHand = document.getElementById('dragonHand');
  var tigerHand = document.getElementById('tigerHand');
  var dragonType = document.getElementById('dragonType');
  var tigerType = document.getElementById('tigerType');
  var flyLayer = document.getElementById('flyLayer');
  var payoutFlyLayer = document.getElementById('payoutFlyLayer');
  var room = document.querySelector('.lhd-room');
  var CHIP_FLY_MS = 420;
  var CHIP_LAND_SCALE = 2 / 3;
  var COLLECT_MS = 420;
  var TO_SCORE_MS = 520;
  var SLOT_COUNT = { dragon: 20, tiger: 20, tie: 20 };
  var slotCache = {};
  var slotStacks = {};
  /* ---------- 本房间其他人：从人数图标飞出下注 ---------- */
  var OTHER_BET_KEYS = ['dragon', 'tiger', 'tie'];
  var OTHER_CHIP_VALUES = [1, 5, 10, 50, 100, 500, 1000, 2000];
  var otherBetTimer = null;

  function delay(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

  function localRect(el) {
    if (!room || !el) return { left: 0, top: 0, width: 0, height: 0 };
    var rr = room.getBoundingClientRect();
    var er = el.getBoundingClientRect();
    var sx = rr.width / room.offsetWidth || 1;
    var sy = rr.height / room.offsetHeight || 1;
    return {
      left: (er.left - rr.left) / sx,
      top: (er.top - rr.top) / sy,
      width: er.width / sx,
      height: er.height / sy
    };
  }

  function layerRect(el) {
    if (!payoutFlyLayer || !el) return { left: 0, top: 0, width: 0, height: 0, cx: 0, cy: 0 };
    var layer = payoutFlyLayer.getBoundingClientRect();
    var er = el.getBoundingClientRect();
    return {
      left: er.left - layer.left,
      top: er.top - layer.top,
      width: er.width,
      height: er.height,
      cx: er.left - layer.left + er.width / 2,
      cy: er.top - layer.top + er.height / 2
    };
  }

  function buildSlots(count) {
    var slots = [];
    var minDist = count >= 20 ? 14 : 18;
    var padX = 8;
    var padY = 10;
    var tries = 0;
    var maxTries = count * 80;
    while (slots.length < count && tries < maxTries) {
      tries++;
      var x = padX + Math.random() * (100 - padX * 2);
      var y = padY + Math.random() * (100 - padY * 2);
      var ok = true;
      for (var i = 0; i < slots.length; i++) {
        var dx = x - slots[i].x;
        var dy = y - slots[i].y;
        if (dx * dx + dy * dy < minDist * minDist) { ok = false; break; }
      }
      if (ok) slots.push({ x: x, y: y });
    }
    while (slots.length < count) {
      slots.push({
        x: padX + Math.random() * (100 - padX * 2),
        y: padY + Math.random() * (100 - padY * 2)
      });
    }
    return slots;
  }

  function getSlots(key) {
    if (!slotCache[key]) slotCache[key] = buildSlots(SLOT_COUNT[key] || 10);
    return slotCache[key];
  }

  function pickSlot(key) {
    var slots = getSlots(key);
    var idx = Math.floor(Math.random() * slots.length);
    if (!slotStacks[key]) slotStacks[key] = [];
    var stack = slotStacks[key];
    var layer = stack[idx] || 0;
    stack[idx] = layer + 1;
    var base = slots[idx];
    var rx = (Math.random() - 0.5) * 6;
    var ry = (Math.random() - 0.5) * 5;
    return {
      idx: idx,
      layer: layer,
      x: Math.max(5, Math.min(95, base.x + rx + (layer % 3) * 0.9)),
      y: Math.max(6, Math.min(94, base.y + ry - layer * 2.1))
    };
  }

  function barChipSize() {
    if (!chipBar) return 48;
    var srcChip = qs('.lhd-chip.is-selected', chipBar) || qs('.lhd-chip', chipBar);
    if (!srcChip) return 48;
    var r = localRect(srcChip);
    return Math.min(r.width, r.height) || 48;
  }

  function betBtn(key) {
    return qs('.lhd-bet-btn[data-bet="' + key + '"]', betArea);
  }

  function placeChipOnBtn(btn, value, slot, landSize, owner) {
    var box = qs('.lhd-bet-btn__chips', btn);
    if (!box) return;
    var img = document.createElement('img');
    img.src = CHIP_SRC[value] || CHIP_SRC[1];
    img.alt = '';
    img.draggable = false;
    img.setAttribute('data-owner', owner || 'me');
    img.setAttribute('data-value', String(value));
    img.style.setProperty('--chip-x', slot.x + '%');
    img.style.setProperty('--chip-y', slot.y + '%');
    img.style.setProperty('--chip-w', landSize + 'px');
    img.style.setProperty('--chip-z', String(10 + slot.layer));
    box.appendChild(img);
  }

  function flyChipToBet(btn, value, slot, landSize, flyMs, owner) {
    if (!chipBar || !flyLayer || !btn) {
      placeChipOnBtn(btn, value, slot, landSize, owner || 'me');
      return;
    }
    var srcChip = qs('.lhd-chip[data-chip="' + value + '"]', chipBar) ||
      qs('.lhd-chip.is-selected', chipBar);
    if (!srcChip) {
      placeChipOnBtn(btn, value, slot, landSize, owner || 'me');
      return;
    }
    var duration = typeof flyMs === 'number' ? flyMs : CHIP_FLY_MS;
    var who = owner || 'me';
    var from = localRect(srcChip);
    var chipBox = qs('.lhd-bet-btn__chips', btn);
    var area = chipBox ? localRect(chipBox) : localRect(btn);
    var size = Math.min(from.width, from.height) || 40;
    var startX = from.left + from.width / 2 - size / 2;
    var startY = from.top + from.height / 2 - size / 2;
    var endCX = area.left + area.width * (slot.x / 100);
    var endCY = area.top + area.height * (slot.y / 100);
    var endX = endCX - size / 2;
    var endY = endCY - size / 2;
    var fly = document.createElement('div');
    fly.className = 'lhd-fly-chip';
    fly.style.width = size + 'px';
    fly.style.height = size + 'px';
    fly.style.left = startX + 'px';
    fly.style.top = startY + 'px';
    fly.style.transitionDuration = duration + 'ms';
    fly.style.setProperty('--fly-x', (endX - startX) + 'px');
    fly.style.setProperty('--fly-y', (endY - startY) + 'px');
    fly.style.setProperty('--fly-scale', String(landSize / size));
    fly.innerHTML = '<img src="' + (CHIP_SRC[value] || CHIP_SRC[1]) + '" alt="" draggable="false">';
    flyLayer.appendChild(fly);
    requestAnimationFrame(function () {
      requestAnimationFrame(function () { fly.classList.add('is-flying'); });
    });
    setTimeout(function () {
      if (fly.parentNode) fly.parentNode.removeChild(fly);
      placeChipOnBtn(btn, value, slot, landSize, who);
    }, duration);
  }

  function flyChipAbs(srcRect, dstRect, srcUrl, duration, endScale) {
    return new Promise(function (resolve) {
      if (!payoutFlyLayer) { resolve(); return; }
      var size = Math.max(12, Math.min(srcRect.width, srcRect.height) || 24);
      var startX = srcRect.cx - size / 2;
      var startY = srcRect.cy - size / 2;
      var endSize = size * (endScale || 1);
      var endX = dstRect.cx - endSize / 2;
      var endY = dstRect.cy - endSize / 2;
      var fly = document.createElement('div');
      fly.className = 'lhd-fly-chip lhd-fly-chip--payout';
      fly.style.width = size + 'px';
      fly.style.height = size + 'px';
      fly.style.left = startX + 'px';
      fly.style.top = startY + 'px';
      fly.style.transitionDuration = duration + 'ms';
      fly.style.setProperty('--fly-x', (endX - startX) + 'px');
      fly.style.setProperty('--fly-y', (endY - startY) + 'px');
      fly.style.setProperty('--fly-scale', String(endScale || 1));
      fly.innerHTML = '<img src="' + srcUrl + '" alt="" draggable="false">';
      payoutFlyLayer.appendChild(fly);
      requestAnimationFrame(function () {
        requestAnimationFrame(function () { fly.classList.add('is-flying'); });
      });
      setTimeout(function () {
        if (fly.parentNode) fly.parentNode.removeChild(fly);
        resolve();
      }, duration);
    });
  }

  function stopOtherBetting() {
    if (otherBetTimer) {
      clearTimeout(otherBetTimer);
      otherBetTimer = null;
    }
  }

  function flyChipFromPlayers(btn, value, slot, landSize) {
    var fromEl = qs('.lhd-players__icon') || document.getElementById('playersBox');
    if (!fromEl || !btn || !payoutFlyLayer) {
      placeChipOnBtn(btn, value, slot, landSize, 'other');
      return;
    }
    var src = layerRect(fromEl);
    var chipBox = qs('.lhd-bet-btn__chips', btn) || btn;
    var area = layerRect(chipBox);
    var dst = {
      cx: area.left + area.width * (slot.x / 100),
      cy: area.top + area.height * (slot.y / 100),
      width: landSize,
      height: landSize
    };
    var duration = 380 + Math.floor(Math.random() * 80);
    flyChipAbs(
      src, dst, CHIP_SRC[value] || CHIP_SRC[1], duration,
      landSize / Math.max(18, Math.min(src.width, src.height) || 36)
    ).then(function () {
      placeChipOnBtn(btn, value, slot, landSize, 'other');
    });
  }

  function spawnOtherBet() {
    if (phase !== 'bet' || roundBusy) return;
    var key = OTHER_BET_KEYS[Math.floor(Math.random() * OTHER_BET_KEYS.length)];
    if (Math.random() < 0.58) key = Math.random() < 0.5 ? 'dragon' : 'tiger';
    var btn = betBtn(key);
    if (!btn) return;
    var box = qs('.lhd-bet-btn__chips', btn);
    if (box && box.querySelectorAll('img').length >= 10) return;
    var value = OTHER_CHIP_VALUES[Math.floor(Math.random() * OTHER_CHIP_VALUES.length)];
    var slot = pickSlot(key);
    var landSize = barChipSize() * CHIP_LAND_SCALE;
    flyChipFromPlayers(btn, value, slot, landSize);
    sfx('bet', { vol: 0.2, dedupeMs: 160 });
  }

  function startOtherBetting() {
    stopOtherBetting();
    function schedule() {
      if (phase !== 'bet') return;
      var wait = 1400 + Math.random() * 2400;
      otherBetTimer = setTimeout(function () {
        if (phase !== 'bet') return;
        var n = 1 + Math.floor(Math.random() * 2);
        for (var i = 0; i < n; i++) {
          setTimeout(spawnOtherBet, i * 120);
        }
        schedule();
      }, wait);
    }
    schedule();
  }

  /* ---------- 音频 ---------- */
  var AUDIO_BASE = './assets/audio/';
  var AUDIO_V = '2';
  var audioUnlocked = false;
  var bgmAudio = null;
  var voiceAudio = null;
  var sfxLastAt = {};
  var AUDIO_PREF_KEY = 'lhd_audio';
  var audioPref = window.TableShell
    ? TableShell.loadAudioPref(AUDIO_PREF_KEY)
    : { music: true, sfx: true };
  function saveAudioPref() {
    if (window.TableShell) {
      TableShell.saveAudioPref(AUDIO_PREF_KEY, audioPref);
    } else {
      try { localStorage.setItem(AUDIO_PREF_KEY, JSON.stringify(audioPref)); } catch (e) { /* ignore */ }
    }
  }
  function applyAudioPrefSilent(pref) {
    if (!pref) return;
    audioPref.music = !!pref.music;
    audioPref.sfx = !!pref.sfx;
    if (audioPref.music) {
      if (typeof ensureBgm === 'function') ensureBgm(true);
    } else if (typeof bgmAudio !== 'undefined' && bgmAudio) {
      try { bgmAudio.pause(); } catch (e) { /* ignore */ }
    }
    if (!audioPref.sfx && typeof voiceAudio !== 'undefined' && voiceAudio) {
      try { voiceAudio.pause(); } catch (e) { /* ignore */ }
      voiceAudio = null;
    }
  }
  if (window.TableShell && TableShell.watchAppAudioPref) {
    TableShell.watchAppAudioPref(AUDIO_PREF_KEY, applyAudioPrefSilent);
  }
  function audioUrl(name) { return AUDIO_BASE + name + '.mp3?v=' + AUDIO_V; }
  function unlockAudio() {
    if (audioUnlocked) return;
    audioUnlocked = true;
    try {
      var silent = new Audio(audioUrl('bet'));
      silent.volume = 0;
      silent.play().then(function () { silent.pause(); }).catch(function () {});
    } catch (e) { /* ignore */ }
    ensureBgm(true);
  }
  function ensureBgm(playNow) {
    if (!bgmAudio) {
      bgmAudio = new Audio(audioUrl('bgm'));
      bgmAudio.loop = true;
      bgmAudio.volume = 0.32;
      bgmAudio.preload = 'auto';
    }
    if (!audioPref.music) return;
    if (playNow && bgmAudio.paused) {
      var p = bgmAudio.play();
      if (p && p.catch) p.catch(function () {});
    }
  }
  function setMusicOn(on) {
    audioPref.music = !!on;
    saveAudioPref();
    if (audioPref.music) ensureBgm(true);
    else if (bgmAudio) { try { bgmAudio.pause(); } catch (e) {} }
  }
  function setSfxOn(on) {
    audioPref.sfx = !!on;
    saveAudioPref();
    if (!audioPref.sfx && voiceAudio) {
      try { voiceAudio.pause(); } catch (e) {}
      voiceAudio = null;
    }
  }
  function sfx(name, opt) {
    if (!name || !audioPref.sfx) return;
    opt = opt || {};
    var now = Date.now();
    var gap = typeof opt.dedupeMs === 'number' ? opt.dedupeMs : 80;
    if (sfxLastAt[name] && now - sfxLastAt[name] < gap) return;
    sfxLastAt[name] = now;
    try {
      var node = new Audio(audioUrl(name));
      node.volume = typeof opt.vol === 'number' ? opt.vol : 0.85;
      var p = node.play();
      if (p && p.catch) p.catch(function () {});
    } catch (e) { /* ignore */ }
  }
  function playVoice(name, vol) {
    return new Promise(function (resolve) {
      var done = false;
      function finish() {
        if (done) return;
        done = true;
        resolve();
      }
      if (!name || !audioPref.sfx) { finish(); return; }
      try {
        if (voiceAudio) {
          voiceAudio.onended = null;
          voiceAudio.onerror = null;
          try { voiceAudio.pause(); } catch (e1) {}
          voiceAudio = null;
        }
        var node = new Audio(audioUrl(name));
        voiceAudio = node;
        node.volume = typeof vol === 'number' ? vol : 1;
        node.onended = finish;
        node.onerror = finish;
        var p = node.play();
        if (p && p.catch) p.catch(finish);
        setTimeout(finish, 2600);
      } catch (e) { finish(); }
    });
  }

  /** 单注返还（含本金）：利润倍率；开和龙/虎全退 */
  function calcBetReturn(key, stake, result) {
    if (!(stake > 0)) return 0;
    if (key === result) {
      var odds = ODDS[key];
      if (!(typeof odds === 'number')) return 0;
      if (window.TableShell && TableShell.profitReturn) {
        return TableShell.profitReturn(stake, odds);
      }
      return stake + Math.floor(stake * odds);
    }
    if (result === 'tie' && (key === 'dragon' || key === 'tiger')) {
      return Math.floor(stake * TIE_REFUND);
    }
    return 0;
  }

  function qs(sel, root) { return (root || document).querySelector(sel); }
  function qsa(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }
  function setText(id, v) { var el = document.getElementById(id); if (el) el.textContent = v; }
  function pct(n, total) { return total ? Math.round((n / total) * 100) + '%' : '0%'; }
  function isClosed() { return phase !== 'bet' || roundBusy; }
  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

  var user = (window.App && App.getUser) ? App.getUser() : { uid: '100000001' };
  var params = new URLSearchParams(location.search);
  var roomNo = (params.get('roomNo') || '').trim();
  var q = roomNo ? '?roomNo=' + encodeURIComponent(roomNo) : '';

  function uid() { return (user && user.uid) ? user.uid : '100000001'; }

  function getStats() {
    try {
      return JSON.parse(localStorage.getItem('lhd_stats_' + uid())) || { turnover: 0, winloss: 0, rebate: 0 };
    } catch (e) {
      return { turnover: 0, winloss: 0, rebate: 0 };
    }
  }
  function saveStats(s) {
    localStorage.setItem('lhd_stats_' + uid(), JSON.stringify(s));
  }
  function refreshBalance() {
    var el = qs('#statBalance');
    if (!el || !window.App || !App.getBalance) return;
    try { el.textContent = Number(App.getBalance(uid())).toLocaleString('en-US'); } catch (e) {}
    var s = getStats();
    var wl = qs('#statWinloss');
    var to = qs('#statTurnover');
    var rb = qs('#statRebate');
    if (wl) {
      wl.textContent = (s.winloss >= 0 ? '+' : '') + Math.round(s.winloss).toLocaleString('en-US');
      wl.classList.toggle('is-plus', s.winloss > 0);
      wl.classList.toggle('is-minus', s.winloss < 0);
    }
    if (to) to.textContent = Math.round(s.turnover).toLocaleString('en-US');
    if (rb) rb.textContent = Math.round(s.rebate || 0).toLocaleString('en-US');
  }

  function canAfford(amount) {
    if (!(amount > 0) || !window.App || !App.getBalance) return false;
    return App.getBalance(uid()) >= amount;
  }

  /** 真账禁止本地加减；仅刷新展示 */
  function debitBalance() { return false; }
  function creditBalance() { /* no-op */ }

  /* ---------- 下注注单日志（供“下注记录”页 /bets?game=longhu 读取） ---------- */
  var PLAY_LABELS = {
    dragon: '龙', tiger: '虎', tie: '和'
  };
  var currentBetIssue = '';
  var lastSettledRoundNo = '';
  var roundNoLabel = document.getElementById('roundNoLabel');

  function setRoundNoLabel(no) {
    /* 顶栏短显当日序号；下注/验算仍用完整 roundNo */
    var full = no ? String(no) : '';
    var m = full.match(/^[A-Z]{2,4}\d{8}-(\d{1,6})$/i);
    var text = m ? ('0000' + m[1]).slice(-4) : (full || '—');
    if (roundNoLabel) roundNoLabel.textContent = text;
  }

  function pad2(n) { return n < 10 ? '0' + n : '' + n; }
  function pad3(n) { return n < 10 ? '00' + n : (n < 100 ? '0' + n : '' + n); }
  function ymd() {
    var d = new Date();
    return '' + d.getFullYear() + pad2(d.getMonth() + 1) + pad2(d.getDate());
  }
  function nextBetIssue() {
    var day = ymd();
    var rec = null;
    try { rec = JSON.parse(localStorage.getItem('lhd_issue') || 'null'); } catch (e) { rec = null; }
    if (!rec || rec.day !== day) rec = { day: day, seq: 0 };
    rec.seq += 1;
    try { localStorage.setItem('lhd_issue', JSON.stringify(rec)); } catch (e) { /* ignore */ }
    return day + '-' + pad3(rec.seq);
  }
  function betLogKey() { return 'lhd_bet_log_' + uid(); }
  function loadBetLog() {
    try { return JSON.parse(localStorage.getItem(betLogKey())) || []; } catch (e) { return []; }
  }
  function saveBetLog(list) {
    try { localStorage.setItem(betLogKey(), JSON.stringify(list.slice(0, 120))); } catch (e) { /* ignore */ }
    try { window.dispatchEvent(new CustomEvent('lhd-bet-log-updated')); } catch (e) { /* ignore */ }
  }
  function findBetGroup(log, issue) {
    for (var i = 0; i < log.length; i++) { if (log[i].issue === issue) return log[i]; }
    return null;
  }
  function appendBetLog(playKey, amount) {
    if (!currentBetIssue) currentBetIssue = nextBetIssue();
    var log = loadBetLog();
    var group = findBetGroup(log, currentBetIssue);
    if (!group) {
      group = {
        game: 'longhu', issue: currentBetIssue, createdAt: new Date().toISOString(),
        settled: false, bets: [], totalAmount: 0, totalProfit: 0
      };
      log.unshift(group);
    }
    group.bets.push({
      play: PLAY_LABELS[playKey] || playKey, key: playKey,
      amount: amount, status: 'PENDING', profit: 0, winAmount: 0, hit: ''
    });
    group.totalAmount += amount;
    saveBetLog(log);
  }
  function clearCurrentBetLog() {
    if (!currentBetIssue) return;
    var log = loadBetLog();
    var kept = [];
    for (var j = 0; j < log.length; j++) {
      if (log[j].issue !== currentBetIssue) kept.push(log[j]);
    }
    if (kept.length !== log.length) saveBetLog(kept);
    currentBetIssue = '';
  }
  function settleBetLog(issue, outcome) {
    if (!issue || !outcome) return;
    var log = loadBetLog();
    var group = findBetGroup(log, issue);
    if (!group || group.settled) return;
    var resName = outcome.result === 'dragon' ? '龙赢'
      : (outcome.result === 'tiger' ? '虎赢' : '和局');
    group.drawSummary = '龙' + outcome.dragonRank + ' · 虎' + outcome.tigerRank + ' · ' + resName;
    var totalProfit = 0;
    for (var i = 0; i < group.bets.length; i++) {
      var b = group.bets[i];
      var key = b.key;
      var win = key === outcome.result;
      var ret = calcBetReturn(key, b.amount, outcome.result);
      b.winAmount = ret;
      b.profit = ret - b.amount;
      if (win) { b.status = 'WON'; b.hit = (PLAY_LABELS[key] || '') + ' 中'; }
      else if (ret > 0) { b.status = 'WON'; b.hit = '和 · 全退'; }
      else { b.status = 'LOST'; b.hit = ''; }
      totalProfit += b.profit;
    }
    group.settled = true;
    group.settledAt = new Date().toISOString();
    group.totalProfit = totalProfit;
    saveBetLog(log);
  }

  /* A=1 … K=13，比点数大小 */
  function rankValue(rank) {
    if (rank === 'A') return 1;
    if (rank === 'J') return 11;
    if (rank === 'Q') return 12;
    if (rank === 'K') return 13;
    return parseInt(rank, 10);
  }
  function makeCard(suit, rank) { return { suit: suit, rank: rank }; }
  function cardSrc(c) { return './assets/cards/' + c.suit + '_' + c.rank + '.png?v=1'; }

  function buildDeck() {
    var deck = [];
    for (var d = 0; d < DECKS; d++) {
      for (var si = 0; si < SUITS.length; si++) {
        for (var r = 0; r < RANKS.length; r++) deck.push(makeCard(SUITS[si], RANKS[r]));
      }
    }
    for (var i = deck.length - 1; i > 0; i--) {
      var j = (Math.random() * (i + 1)) | 0;
      var t = deck[i]; deck[i] = deck[j]; deck[j] = t;
    }
    return deck;
  }

  function resolveHands(deck) {
    var dragon = deck[0];
    var tiger = deck[1];
    var dr = rankValue(dragon.rank);
    var tr = rankValue(tiger.rank);
    var result = dr > tr ? 'dragon' : (tr > dr ? 'tiger' : 'tie');
    return {
      dragon: dragon,
      tiger: tiger,
      result: result,
      dragonRank: dr,
      tigerRank: tr
    };
  }

  function resetCards() {
    qsa('.lhd-card').forEach(function (el) {
      el.classList.remove('is-dealt', 'is-flipped');
      var front = qs('.lhd-card__face--front img', el);
      if (front) front.src = './assets/cards/card-back.png?v=9';
    });
    if (flyLayer) flyLayer.innerHTML = '';
    if (payoutFlyLayer) payoutFlyLayer.innerHTML = '';
    clearCompare();
    clearWinBets();
  }

  function clearCompare() {
    if (dragonHand) dragonHand.classList.remove('is-winner', 'is-loser');
    if (tigerHand) tigerHand.classList.remove('is-winner', 'is-loser');
    [dragonType, tigerType].forEach(function (el) {
      if (!el) return;
      el.hidden = true;
      el.classList.remove('is-show');
      el.textContent = '';
    });
  }

  function clearWinBets() {
    if (!betArea) return;
    qsa('.lhd-bet-btn.is-win', betArea).forEach(function (btn) {
      btn.classList.remove('is-win');
    });
  }

  function showCompare(outcome) {
    clearCompare();
    if (dragonType) {
      dragonType.hidden = false;
      dragonType.textContent = outcome.dragonRank;
      dragonType.classList.add('is-show');
    }
    if (tigerType) {
      tigerType.hidden = false;
      tigerType.textContent = outcome.tigerRank;
      tigerType.classList.add('is-show');
    }
    if (outcome.result === 'dragon') {
      if (dragonHand) dragonHand.classList.add('is-winner');
      if (tigerHand) tigerHand.classList.add('is-loser');
    } else if (outcome.result === 'tiger') {
      if (tigerHand) tigerHand.classList.add('is-winner');
      if (dragonHand) dragonHand.classList.add('is-loser');
    }
  }

  function highlightWinningBets(outcome) {
    clearWinBets();
    if (!betArea) return;
    var keys = [];
    if (outcome.result === 'dragon') keys.push('dragon');
    if (outcome.result === 'tiger') keys.push('tiger');
    if (outcome.result === 'tie') keys.push('tie');
    keys.forEach(function (key) {
      var btn = betBtn(key);
      if (btn) btn.classList.add('is-win');
    });
  }

  function showScorePop(amount) {
    if (!amount) return;
    var target = document.getElementById('statBalance');
    var host = document.querySelector('.lhd-head') || document.body;
    if (!target || !host) return;
    var tr = target.getBoundingClientRect();
    var hr = host.getBoundingClientRect();
    var pop = document.createElement('div');
    pop.className = 'lhd-score-pop';
    pop.textContent = (amount > 0 ? '+' : '') + Number(amount).toLocaleString('en-US');
    pop.style.left = (tr.left + tr.width / 2 - hr.left) + 'px';
    pop.style.top = (tr.bottom - hr.top + 2) + 'px';
    host.appendChild(pop);
    setTimeout(function () { if (pop.parentNode) pop.parentNode.removeChild(pop); }, 1450);
  }

  function showPhaseBanner(kind) {
    var box = document.getElementById('phaseBanner');
    var img = document.getElementById('phaseBannerImg');
    if (!box || !img) return Promise.resolve();
    var isStop = kind === 'stop';
    img.src = isStop
      ? './assets/ui/banners/bet-stop.png?v=1'
      : './assets/ui/banners/bet-start.png?v=1';
    img.alt = isStop ? '停止下注' : '开始下注';
    if (box._bannerTimer) clearTimeout(box._bannerTimer);
    if (box._bannerHideTimer) clearTimeout(box._bannerHideTimer);
    box.classList.remove('is-show', 'is-hide');
    void box.offsetWidth;
    box.classList.add('is-show');
    box.setAttribute('aria-hidden', 'false');
    return new Promise(function (resolve) {
      box._bannerTimer = setTimeout(function () {
        box.classList.remove('is-show');
        box.classList.add('is-hide');
        box._bannerHideTimer = setTimeout(function () {
          box.classList.remove('is-hide');
          box.setAttribute('aria-hidden', 'true');
          box._bannerTimer = null;
          box._bannerHideTimer = null;
        }, 340);
        resolve();
      }, BANNER_MS);
    });
  }

  function beat() {
    if (!timeEl) return;
    timeEl.classList.remove('is-beat');
    void timeEl.offsetWidth;
    timeEl.classList.add('is-beat');
  }

  var roomEl = qs('.lhd-room');

  function paint(doBeat) {
    if (!timerBox || !timeEl) return;
    timerBox.classList.remove('is-urgent', 'is-critical', 'is-draw', 'is-payout');
    timeEl.classList.remove('is-beat');
    if (alignWaiting) {
      timerBox.classList.add('is-payout');
      timeEl.textContent = '准备中';
      if (window.TableShell && TableShell.syncFocusUi) TableShell.syncFocusUi(roomEl, 'payout');
      return;
    }
    if (phase === 'draw') {
      timerBox.classList.add('is-draw');
      timeEl.textContent = '开奖中';
      if (window.TableShell && TableShell.syncFocusUi) TableShell.syncFocusUi(roomEl, 'draw');
      return;
    }
    if (phase === 'payout') {
      timerBox.classList.add('is-payout');
      timeEl.textContent = '派奖中';
      if (window.TableShell && TableShell.syncFocusUi) TableShell.syncFocusUi(roomEl, 'payout');
      return;
    }
    timeEl.textContent = String(left);
    if (left <= 10) timerBox.classList.add('is-urgent');
    if (left <= 5 && left > 0) {
      timerBox.classList.add('is-critical');
      if (doBeat) {
        beat();
        sfx('countdown', { vol: 0.7, dedupeMs: 400 });
      }
    }
    if (window.TableShell && TableShell.syncFocusUi) TableShell.syncFocusUi(roomEl, 'bet');
  }

  function setCardFront(slot, card) {
    var el = qs('.lhd-card[data-slot="' + slot + '"]');
    if (!el) return;
    var front = qs('.lhd-card__face--front img', el);
    if (front) front.src = cardSrc(card);
  }

  async function dealSlot(slot, card) {
    setCardFront(slot, card);
    var el = qs('.lhd-card[data-slot="' + slot + '"]');
    if (!el || !flyLayer || !shoe || !room) {
      if (el) el.classList.add('is-dealt');
      sfx('deal', { vol: 0.7 });
      await sleep(GAP_MS);
      return;
    }
    sfx('deal', { vol: 0.7 });
    var from = localRect(shoe);
    var to = localRect(el);
    var w = to.width;
    var h = to.height;
    var startX = from.left + from.width * 0.55 - w / 2;
    var startY = from.top + from.height * 0.72 - h / 2;
    var dx = to.left - startX;
    var dy = to.top - startY;
    var fly = document.createElement('div');
    fly.className = 'lhd-fly-card';
    fly.style.width = w + 'px';
    fly.style.height = h + 'px';
    fly.style.left = startX + 'px';
    fly.style.top = startY + 'px';
    fly.style.setProperty('--fly-x', dx + 'px');
    fly.style.setProperty('--fly-y', dy + 'px');
    fly.innerHTML = '<img src="' + CARD_BACK + '" alt="" draggable="false">';
    flyLayer.appendChild(fly);
    shoe.classList.remove('is-dealing');
    void shoe.offsetWidth;
    shoe.classList.add('is-dealing');
    await new Promise(function (resolve) {
      requestAnimationFrame(function () {
        requestAnimationFrame(function () {
          fly.classList.add('is-flying');
        });
      });
      setTimeout(function () {
        if (fly.parentNode) fly.parentNode.removeChild(fly);
        el.classList.add('is-dealt');
        shoe.classList.remove('is-dealing');
        resolve();
      }, FLY_MS);
    });
    await sleep(GAP_MS);
  }

  async function flipSlot(slot) {
    var el = qs('.lhd-card[data-slot="' + slot + '"]');
    if (el) el.classList.add('is-flipped');
    sfx('open', { vol: 0.75, dedupeMs: 40 });
    await sleep(FLIP_MS);
    await sleep(FLIP_GAP_MS);
  }

  async function dealAndReveal(outcome) {
    var map = { d1: outcome.dragon, t1: outcome.tiger };
    var i;
    for (i = 0; i < DEAL_ORDER.length; i++) {
      await dealSlot(DEAL_ORDER[i], map[DEAL_ORDER[i]]);
    }
    await sleep(DEAL_HOLD_MS);
    for (i = 0; i < DEAL_ORDER.length; i++) {
      await flipSlot(DEAL_ORDER[i]);
    }
    showCompare(outcome);
    sfx('vs', { vol: 0.75 });
    await playVoice('voice/dragon');
    await playVoice('voice/point-' + outcome.dragonRank);
    await playVoice('voice/tiger');
    await playVoice('voice/point-' + outcome.tigerRank);
    if (outcome.result === 'dragon') {
      sfx('dragon-win-sfx', { vol: 0.8 });
      await playVoice('voice/dragon-win');
    } else if (outcome.result === 'tiger') {
      sfx('tiger-win-sfx', { vol: 0.8 });
      await playVoice('voice/tiger-win');
    } else {
      await playVoice('voice/tie');
    }
  }

  function calcSettlement(outcome) {
    var stakeTotal = 0;
    var returnTotal = 0;
    Object.keys(betTotals).forEach(function (key) {
      var stake = betTotals[key] || 0;
      if (!stake) return;
      stakeTotal += stake;
      returnTotal += calcBetReturn(key, stake, outcome.result);
    });
    return {
      stakeTotal: stakeTotal,
      returnTotal: Math.round(returnTotal),
      profit: Math.round(returnTotal - stakeTotal)
    };
  }

  function applySettlement(settlement) {
    if (!settlement) return;
    // 真派彩在封盘结算由大脑完成；此处只更新本地展示统计
    var s = getStats();
    s.turnover = (s.turnover || 0) + (settlement.stakeTotal || 0);
    s.winloss = (s.winloss || 0) + (settlement.profit || 0);
    s.rebate = (s.rebate || 0) + Math.floor((settlement.stakeTotal || 0) * 0.005);
    saveStats(s);
    if (window.App && App.refreshBalance) {
      App.refreshBalance().then(function () { refreshBalance(); });
    } else {
      refreshBalance();
    }
    if (settlement.returnTotal > 0) showScorePop(settlement.returnTotal);
  }

  function chipsOn(key) {
    var btn = betBtn(key);
    if (!btn) return [];
    return Array.prototype.slice.call(btn.querySelectorAll('.lhd-bet-btn__chips img'));
  }

  function getWinLoseKeys(outcome) {
    var all = ['dragon', 'tiger', 'tie'];
    var win = [];
    var lose = [];
    /* 主胜区始终作为飞入目标（即使该区暂无筹码） */
    if (outcome.result === 'dragon') win.push('dragon');
    else if (outcome.result === 'tiger') win.push('tiger');
    else if (outcome.result === 'tie') win.push('tie');
    all.forEach(function (k) {
      var has = chipsOn(k).length > 0;
      var isWin = false;
      if (k === 'dragon') isWin = outcome.result === 'dragon';
      else if (k === 'tiger') isWin = outcome.result === 'tiger';
      else if (k === 'tie') isWin = outcome.result === 'tie';
      /* 和局：龙/虎退半，视觉上保留筹码飞回积分 */
      if (outcome.result === 'tie' && (k === 'dragon' || k === 'tiger')) isWin = true;
      if (isWin) {
        if (win.indexOf(k) < 0 && (has || k === 'dragon' || k === 'tiger' || k === 'tie')) win.push(k);
      } else if (has) {
        lose.push(k);
      }
    });
    return { win: win, lose: lose };
  }

  function clearBetVisual(key) {
    var btn = betBtn(key);
    if (!btn) return;
    var box = qs('.lhd-bet-btn__chips', btn);
    if (box) box.innerHTML = '';
  }

  function collectPayout(outcome, settlement) {
    return new Promise(function (resolve) {
      stopOtherBetting();
      if (settlement && settlement.returnTotal > 0) sfx('credit-loop-in', { vol: 0.7 });
      if (!payoutFlyLayer) {
        applySettlement(settlement);
        resolve();
        return;
      }
      payoutFlyLayer.innerHTML = '';
      var scoreEl = document.getElementById('statBalance');
      var playersIcon = qs('.lhd-players__icon') || document.getElementById('playersBox');
      var scoreRect = scoreEl ? layerRect(scoreEl) : null;
      var playersRect = playersIcon ? layerRect(playersIcon) : null;
      var landSize = barChipSize() * CHIP_LAND_SCALE;
      var wl = getWinLoseKeys(outcome);
      var winKeys = wl.win;
      var loseKeys = wl.lose;
      var moving = [];
      loseKeys.forEach(function (lk) {
        chipsOn(lk).forEach(function (img) {
          moving.push({
            img: img,
            owner: img.getAttribute('data-owner') || 'other',
            value: parseInt(img.getAttribute('data-value'), 10) || 1,
            src: img.getAttribute('src') || CHIP_SRC[1]
          });
        });
      });

      var phase1 = [];
      if (moving.length && winKeys.length) {
        moving.forEach(function (chip, idx) {
          var targetKey = winKeys[idx % winKeys.length];
          var winBtn = betBtn(targetKey);
          if (!winBtn) return;
          var winBox = qs('.lhd-bet-btn__chips', winBtn) || winBtn;
          var winArea = layerRect(winBox);
          var src = layerRect(chip.img);
          var jx = (Math.random() - 0.5) * winArea.width * 0.55;
          var jy = (Math.random() - 0.5) * winArea.height * 0.45;
          var dst = { cx: winArea.cx + jx, cy: winArea.cy + jy, width: landSize, height: landSize };
          var slot = pickSlot(targetKey);
          phase1.push(delay(idx * 35).then(function () {
            chip.img.style.opacity = '0';
            return flyChipAbs(
              src, dst, chip.src, COLLECT_MS,
              landSize / Math.max(12, Math.min(src.width, src.height) || landSize)
            ).then(function () {
              var potOwner = (betTotals[targetKey] || 0) > 0 ? 'me' : 'other';
              placeChipOnBtn(winBtn, chip.value, slot, landSize, potOwner);
            });
          }));
        });
      } else if (moving.length && playersRect) {
        moving.forEach(function (chip, idx) {
          var src = layerRect(chip.img);
          phase1.push(delay(idx * 30).then(function () {
            chip.img.style.opacity = '0';
            return flyChipAbs(src, playersRect, chip.src, TO_SCORE_MS, 0.35);
          }));
        });
      }

      Promise.all(phase1).then(function () {
        loseKeys.forEach(clearBetVisual);

        var meList = [];
        var otherList = [];
        winKeys.forEach(function (wk) {
          chipsOn(wk).forEach(function (img) {
            if ((img.getAttribute('data-owner') || 'other') === 'me') meList.push(img);
            else otherList.push(img);
          });
        });

        function trimList(arr, maxN) {
          if (arr.length <= maxN) return arr;
          var step = Math.ceil(arr.length / maxN);
          return arr.filter(function (_, i) { return i % step === 0; }).slice(0, maxN);
        }
        meList = trimList(meList, 12);
        otherList = trimList(otherList, 12);

        var phase2 = [];
        meList.forEach(function (img, idx) {
          if (!scoreRect) return;
          phase2.push(delay(idx * 38).then(function () {
            var src = layerRect(img);
            var srcUrl = img.getAttribute('src') || CHIP_SRC[1];
            img.style.opacity = '0';
            return flyChipAbs(src, scoreRect, srcUrl, TO_SCORE_MS, 0.42);
          }));
        });
        otherList.forEach(function (img, idx) {
          if (!playersRect) return;
          phase2.push(delay(idx * 38).then(function () {
            var src = layerRect(img);
            var srcUrl = img.getAttribute('src') || CHIP_SRC[1];
            img.style.opacity = '0';
            return flyChipAbs(src, playersRect, srcUrl, TO_SCORE_MS, 0.35);
          }));
        });

        return Promise.all(phase2).then(function () {
          ['dragon', 'tiger', 'tie'].forEach(clearBetVisual);
          if (settlement && settlement.returnTotal > 0) sfx('win', { vol: 0.85 });
          applySettlement(settlement);
          resolve();
        });
      }).catch(function () {
        applySettlement(settlement);
        resolve();
      });
    });
  }

  function clearBetsVisual() {
    Object.keys(betTotals).forEach(function (k) { betTotals[k] = 0; });
    slotStacks = {};
    qsa('.lhd-bet-btn').forEach(function (btn) {
      var chips = qs('.lhd-bet-btn__chips', btn);
      var stake = qs('.lhd-bet-btn__stake', btn);
      if (chips) chips.innerHTML = '';
      if (stake) { stake.hidden = true; stake.textContent = '0'; }
    });
  }

  function updateStakeLabel(key) {
    var btn = betBtn(key);
    if (!btn) return;
    var stake = qs('.lhd-bet-btn__stake', btn);
    var v = betTotals[key] || 0;
    if (!stake) return;
    if (v > 0) {
      var text = Number(v).toLocaleString('en-US');
      stake.hidden = false;
      stake.textContent = text;
      var digits = String(Math.floor(v)).length;
      stake.classList.toggle('is-long', digits >= 5);
      stake.classList.toggle('is-xl', digits >= 6);
    } else {
      stake.hidden = true;
      stake.textContent = '0';
      stake.classList.remove('is-long', 'is-xl');
    }
  }

  function placeBet(key) {
    if (isClosed() || !key) return;
    if (
      (key === 'dragon' && (betTotals.tiger || 0) > 0) ||
      (key === 'tiger' && (betTotals.dragon || 0) > 0)
    ) {
      if (window.App && App.toast) App.toast('同局不可龙虎对冲');
      return;
    }

    unlockAudio();
    var value = selectedChip;
    var btn = betBtn(key);
    if (!btn) return;
    if (!canAfford(value)) {
      if (window.App && App.toast) App.toast('积分不足');
      return;
    }
    if (!window.App || !App.placeTableBet) {
      if (window.App && App.toast) App.toast('请从大厅进入游戏');
      return;
    }
    App.placeTableBet(SERVER_GAME, key, value).then(function (res) {
      if (res && res.roundNo) {
        currentBetIssue = String(res.roundNo);
        setRoundNoLabel(currentBetIssue);
      }
      betTotals[key] = (betTotals[key] || 0) + value;
      roundPlacements.push({ key: key, value: value });
      appendBetLog(key, value);
      var slot = pickSlot(key);
      var landSize = barChipSize() * CHIP_LAND_SCALE;
      flyChipToBet(btn, value, slot, landSize, undefined, 'me');
      updateStakeLabel(key);
      sfx('bet', { vol: 0.9 });
      refreshBalance();
      syncActions();
    }).catch(function (e) {
      if (window.App && App.toast) App.toast((e && e.message) || '下注失败');
    });
  }

  function undoAllBets() {
    if (window.App && App.toast) App.toast('已提交真账，不可撤销');
  }

  function rebetLastRound() {
    if (isClosed() || usedRebet || !lastRoundPlacements.length) return;
    var need = 0;
    lastRoundPlacements.forEach(function (p) {
      need += p.value;
    });
    if (!canAfford(need)) {
      if (window.App && App.toast) App.toast('积分不足');
      return;
    }
    if (!window.App || !App.placeTableBet) {
      if (window.App && App.toast) App.toast('请从大厅进入游戏');
      return;
    }
    usedRebet = true;
    var chain = Promise.resolve();
    lastRoundPlacements.forEach(function (p, i) {
      chain = chain.then(function () {
        return App.placeTableBet(SERVER_GAME, p.key, p.value).then(function () {
          betTotals[p.key] = (betTotals[p.key] || 0) + p.value;
          roundPlacements.push({ key: p.key, value: p.value });
          appendBetLog(p.key, p.value);
          var btn = betBtn(p.key);
          if (btn) {
            var slot = pickSlot(p.key);
            var landSize = barChipSize() * CHIP_LAND_SCALE;
            flyChipToBet(btn, p.value, slot, landSize, CHIP_FLY_MS + i * 40, 'me');
          }
          updateStakeLabel(p.key);
        });
      });
    });
    chain.then(function () {
      sfx('rebet', { vol: 0.8 });
      refreshBalance();
      syncActions();
    }).catch(function (e) {
      if (window.App && App.toast) App.toast((e && e.message) || '续押失败');
      refreshBalance();
      syncActions();
    });
  }

  function syncActions() {
    if (!actionBar) return;
    var undoBtn = qs('[data-action="undo"]', actionBar);
    var rebetBtn = qs('[data-action="rebet"]', actionBar);
    var canRebet = !isClosed() && !usedRebet && lastRoundPlacements.length > 0 && roundPlacements.length === 0;
    if (undoBtn) {
      if (window.TableShell && TableShell.disableUndoButton) TableShell.disableUndoButton(undoBtn);
      else {
        undoBtn.classList.add('is-disabled');
        undoBtn.setAttribute('aria-disabled', 'true');
        undoBtn.setAttribute('aria-label', '真账已锁，不可撤销');
        undoBtn.setAttribute('title', '真账已提交，不可撤销');
      }
    }
    if (rebetBtn) {
      rebetBtn.classList.toggle('is-disabled', !canRebet);
      rebetBtn.setAttribute('aria-disabled', canRebet ? 'false' : 'true');
    }
  }

  function applyChipPage() {
    var page = CHIP_PAGES[chipPage] || CHIP_PAGES[0];
    var btns = qsa('.lhd-chip', chipBar);
    btns.forEach(function (btn, i) {
      var v = page[i];
      if (v == null) { btn.style.visibility = 'hidden'; return; }
      btn.style.visibility = 'visible';
      btn.setAttribute('data-chip', String(v));
      btn.setAttribute('aria-label', String(v));
      var img = qs('img', btn);
      if (img) img.src = CHIP_SRC[v];
      btn.classList.toggle('is-selected', v === selectedChip);
    });
    if (page.indexOf(selectedChip) < 0) {
      selectedChip = page[0];
      btns.forEach(function (btn) {
        btn.classList.toggle('is-selected', Number(btn.getAttribute('data-chip')) === selectedChip);
      });
    }
  }

  function buildBigRoad(history) {
    var cols = [];
    var lastSide = null;
    function place(side, ties) {
      if (!cols.length || lastSide !== side) cols.push({ cells: [] });
      var col = cols[cols.length - 1];
      if (col.cells.length >= ROAD_ROWS) {
        cols.push({ cells: [] });
        col = cols[cols.length - 1];
      }
      col.cells.push({ side: side, ties: ties || 0 });
    }
    history.forEach(function (r) {
      if (r === 'tie') {
        if (!cols.length) place('dragon', 1);
        else {
          var col = cols[cols.length - 1];
          var cell = col.cells[col.cells.length - 1];
          cell.ties = (cell.ties || 0) + 1;
        }
        return;
      }
      place(r, 0);
      lastSide = r;
    });
    return cols;
  }

  function syncRoadGridWidth(grid, cols) {
    if (!grid || !cols) return;
    var sample = grid.querySelector('.lhd-bead, .lhd-big');
    var gap = 2;
    var cell = sample ? sample.getBoundingClientRect().width : 0;
    if (!(cell > 4)) {
      var sc = grid.closest('.lhd-roadmap__scroll');
      var h = sc ? sc.clientHeight : 0;
      cell = h > 8 ? (h - 6 - 5 * gap) / 6 : 22;
    }
    grid.style.width = (cols * (cell + gap) - gap) + 'px';
  }

  function measureRoadViewCols(scrollEl) {
    if (window.TableShell && TableShell.measureRoadViewCols) {
      return TableShell.measureRoadViewCols(scrollEl, ROAD_ROWS);
    }
    return 12;
  }

  function resetRoadForNewDay(roundNo) {
    if (!roundNo || !window.TableShell) return;
    var ymd = TableShell.roundNoYmd(roundNo);
    if (!ymd) return;
    var keys = Object.keys(roadRoundNos);
    if (!keys.length) return;
    var prev = TableShell.roundNoYmd(keys[0]);
    if (prev && prev !== ymd) {
      roadHistory = [];
      roadRoundNos = {};
      roadStats = { dragon: 0, tiger: 0, tie: 0 };
    }
  }

  function renderBead() {
    if (!beadGrid) return;
    var viewCols = measureRoadViewCols(beadScroll);
    var viewSeq = window.TableShell
      ? TableShell.roadBeadViewSeq(roadHistory, viewCols, ROAD_ROWS)
      : roadHistory.slice();
    var filledCols = Math.ceil(viewSeq.length / ROAD_ROWS) || 0;
    var cols = viewCols;
    var lastIdx = viewSeq.length - 1;
    var html = '';
    for (var c = 0; c < cols; c++) {
      for (var r = 0; r < ROAD_ROWS; r++) {
        var idx = c * ROAD_ROWS + r;
        if (idx < viewSeq.length) {
          var kind = viewSeq[idx];
          var latest = idx === lastIdx ? ' is-latest' : '';
          html += '<span class="lhd-bead lhd-bead--' + kind + latest + '" role="listitem">' + ROAD_LABELS[kind] + '</span>';
        } else {
          html += '<span class="lhd-bead lhd-bead--empty" aria-hidden="true"></span>';
        }
      }
    }
    beadGrid.innerHTML = html;
    beadGrid.style.setProperty('--road-cols', String(cols));
    beadGrid.setAttribute('data-filled-cols', String(filledCols));
    syncRoadGridWidth(beadGrid, cols);
    if (beadScroll) beadScroll.scrollLeft = 0;
  }

  function renderBig() {
    if (!bigGrid) return;
    var viewCols = measureRoadViewCols(bigScroll);
    var colsData = buildBigRoad(roadHistory);
    if (window.TableShell) colsData = TableShell.roadBigViewCols(colsData, viewCols);
    var filledCols = colsData.length;
    var cols = viewCols;
    var html = '';
    var lastCol = filledCols - 1;
    var lastRow = lastCol >= 0 ? colsData[lastCol].cells.length - 1 : -1;
    for (var c = 0; c < cols; c++) {
      var col = colsData[c];
      for (var r = 0; r < ROAD_ROWS; r++) {
        if (col && r < col.cells.length) {
          var cell = col.cells[r];
          var latest = (c === lastCol && r === lastRow) ? ' is-latest' : '';
          var tieHtml = '';
          if (cell.ties > 0) {
            var n = cell.ties > 9 ? 9 : cell.ties;
            tieHtml = '<i class="lhd-big__tie" data-n="' + n + '">' + (n > 1 ? String(n) : '') + '</i>';
          }
          html += '<span class="lhd-big lhd-big--' + cell.side + latest + '" role="listitem">' + tieHtml + '</span>';
        } else {
          html += '<span class="lhd-big lhd-big--empty" aria-hidden="true"></span>';
        }
      }
    }
    bigGrid.innerHTML = html;
    bigGrid.style.setProperty('--road-cols', String(cols));
    bigGrid.setAttribute('data-filled-cols', String(filledCols));
    syncRoadGridWidth(bigGrid, cols);
    if (bigScroll) bigScroll.scrollLeft = 0;
  }

  function renderRoad() {
    var total = roadStats.dragon + roadStats.tiger + roadStats.tie;
    setText('roadD', String(roadStats.dragon));
    setText('roadTg', String(roadStats.tiger));
    setText('roadTie', String(roadStats.tie));
    setText('roadN', String(total));
    setText('roadDpct', pct(roadStats.dragon, total));
    setText('roadTgpct', pct(roadStats.tiger, total));
    setText('roadTiepct', pct(roadStats.tie, total));
    renderBead();
    renderBig();
  }

  function pushRoad(result, roundNo) {
    if (!ROAD_LABELS[result]) return;
    if (roundNo && roadRoundNos[roundNo]) return;
    resetRoadForNewDay(roundNo);
    if (roundNo) roadRoundNos[roundNo] = 1;
    if (roadStats[result] != null) roadStats[result] += 1;
    roadHistory.push(result);
    renderRoad();
  }

  function applyServerRoad(packed) {
    if (!packed) return;
    var incoming = packed.seq || [];
    if (roadHistory.length > incoming.length) return;
    roadHistory = incoming.slice();
    roadStats = { dragon: 0, tiger: 0, tie: 0 };
    var st = packed.stats || {};
    Object.keys(roadStats).forEach(function (k) {
      roadStats[k] = st[k] || 0;
    });
    roadRoundNos = {};
    (packed.roundNos || []).forEach(function (rn) {
      if (rn) roadRoundNos[String(rn)] = 1;
    });
    renderRoad();
  }

  function buildBeadCells(history) {
    var cols = Math.max(1, Math.ceil(history.length / ROAD_ROWS));
    var last = history.length - 1;
    var html = '';
    for (var c = 0; c < cols; c++) {
      for (var r = 0; r < ROAD_ROWS; r++) {
        var idx = c * ROAD_ROWS + r;
        if (idx < history.length) {
          var kind = history[idx];
          var latest = idx === last ? ' is-latest' : '';
          html += '<span class="lhd-bead lhd-bead--' + kind + latest + '">' + ROAD_LABELS[kind] + '</span>';
        } else {
          html += '<span class="lhd-bead lhd-bead--empty"></span>';
        }
      }
    }
    return html;
  }

  function buildBigCells(history) {
    var data = buildBigRoad(history);
    var cols = Math.max(1, data.length);
    var lastCol = data.length - 1;
    var lastRow = lastCol >= 0 ? data[lastCol].cells.length - 1 : -1;
    var html = '';
    for (var c = 0; c < cols; c++) {
      var col = data[c];
      for (var r = 0; r < ROAD_ROWS; r++) {
        if (col && r < col.cells.length) {
          var cell = col.cells[r];
          var latest = (c === lastCol && r === lastRow) ? ' is-latest' : '';
          var tie = '';
          if (cell.ties > 0) {
            var n = cell.ties > 9 ? 9 : cell.ties;
            tie = '<i class="lhd-big__tie" data-n="' + n + '">' + (n > 1 ? String(n) : '') + '</i>';
          }
          html += '<span class="lhd-big lhd-big--' + cell.side + latest + '">' + tie + '</span>';
        } else {
          html += '<span class="lhd-big lhd-big--empty"></span>';
        }
      }
    }
    return html;
  }

  function setPhase(next) {
    phase = next;
    syncActions();
    paint(false);
  }

  function tick() {
    if (alignWaiting) {
      if (Date.now() >= payoutDeadline || getBetRemainSec() > 0) {
        startBet();
        return;
      }
      paint(false);
      return;
    }
    if (phase === 'bet') {
      /* 每拍跟墙钟对齐，与大厅剩余秒一致 */
      left = Math.max(0, Math.ceil(getBetRemainSec()));
      var doBeat = left !== lastBeatSec;
      lastBeatSec = left;
      paint(doBeat && left <= 5 && left > 0);
      if (left <= 0) startDraw();
      return;
    }
    if (phase === 'payout') {
      paint(false);
      return;
    }
    paint(false);
  }

  async function startDraw() {
    if (roundBusy) return;
    roundBusy = true;
    stopOtherBetting();
    setPhase('draw');
    await showPhaseBanner('stop');
    sfx('stop-bet', { vol: 0.7 });
    playVoice('voice/stop-bet');

    var outcome;
    var expectedRound = currentBetIssue || '';
    try {
      if (!window.App || !App.waitTableOutcome) throw new Error('请从大厅进入游戏');
      if (!expectedRound && App.fetchTableSnapshot) {
        var pre = await App.fetchTableSnapshot(SERVER_GAME);
        if (pre && pre.roundNo) expectedRound = String(pre.roundNo);
      }
      var snap = await App.waitTableOutcome(SERVER_GAME, {
        timeoutMs: 25000,
        roundNo: expectedRound || undefined,
      });
      if (!snap || !snap.outcome) throw new Error('开奖结果缺失');
      outcome = snap.outcome;
      if (snap.roundNo) {
        currentBetIssue = String(snap.roundNo);
        setRoundNoLabel(currentBetIssue);
      }
    } catch (e) {
      if (window.App && App.toast) App.toast((e && e.message) || '开奖失败，请稍候');
      clearBetsVisual();
      roundPlacements = [];
      currentBetIssue = '';
      if (window.App && App.refreshBalance) App.refreshBalance();
      roundBusy = false;
      startBet();
      return;
    }
    await dealAndReveal(outcome);

    highlightWinningBets(outcome);
    var settlement = calcSettlement(outcome);
    var roundIssue = currentBetIssue;
    if (window.App && App.fetchMyTableBets && roundIssue) {
      try {
        var mine = await App.fetchMyTableBets(SERVER_GAME, roundIssue);
        if (mine && typeof mine.totalPayout === 'number') {
          settlement.returnTotal = Math.floor(mine.totalPayout);
          if (typeof mine.totalStake === 'number') settlement.stakeTotal = mine.totalStake;
          settlement.profit = settlement.returnTotal - settlement.stakeTotal;
        }
      } catch (e2) { /* 本地估算兜底 */ }
    }
    setPhase('payout');
    payoutDeadline = Date.now() + Math.max(PAYOUT_SECS, 3) * 1000;
    await collectPayout(outcome, settlement);
    settleBetLog(roundIssue, outcome);
    if (roundIssue) lastSettledRoundNo = String(roundIssue);
    currentBetIssue = '';
    pushRoad(outcome.result, roundIssue);
    if (window.App && App.refreshBalance) App.refreshBalance();
    else if (typeof refreshBalance === 'function') refreshBalance();

    lastRoundPlacements = roundPlacements.slice();
    roundPlacements = [];
    usedUndo = false;
    usedRebet = false;
    /* 筹码视觉已在 collectPayout 清掉，这里只清注额 */
    Object.keys(betTotals).forEach(function (k) { betTotals[k] = 0; });
    slotStacks = {};
    qsa('.lhd-bet-btn__stake').forEach(function (stake) {
      stake.hidden = true;
      stake.textContent = '0';
    });
    var remain = Math.max(0, payoutDeadline - Date.now());
    if (remain > 0) await sleep(remain);
    resetCards();
    roundBusy = false;
    startBet();
  }

  function startBet() {
    clearAlignWait();
    var remain = getBetRemainSec();
    /* 大厅已封盘：等到下一周期再开下注，避免进房又从满倒计时重开 */
    if (remain <= 0) {
      alignWaiting = true;
      setPhase('payout');
      currentBetIssue = '';
      left = 0;
      lastBeatSec = -1;
      var wait = Math.max(0.05, getAlignedWaitRemain());
      payoutDeadline = Date.now() + wait * 1000;
      if (typeof stopOtherBetting === 'function') stopOtherBetting();
      paint(false);
      syncActions();
      alignWaitTimer = setTimeout(startBet, Math.ceil(wait * 1000));
      return;
    }
    alignWaiting = false;
    setPhase('bet');
    currentBetIssue = '';
    betDeadline = Date.now() + remain * 1000;
    left = Math.max(1, Math.ceil(remain));
    lastBeatSec = -1;
    paint(false);
    var isFresh = remain >= TOTAL - 1.5;
    if (isFresh) {
      showPhaseBanner('start');
      sfx('start-bet', { vol: 0.65 });
      playVoice('voice/start-bet');
    }
    startOtherBetting();
    syncActions();
  }

  /* events */
  var backBtn = document.getElementById('backBtn');
  if (backBtn) {
    backBtn.addEventListener('click', function () {
      if (window.App && App.go) App.go('../../client-app/pages/game-lobby/game-lobby.html' + q);
      else if (window.parent !== window) window.parent.postMessage({ type: 'assets-game-nav', path: '/lobby' + q }, location.origin);
      else history.back();
    });
  }

  if (betArea) {
    betArea.addEventListener('click', function (e) {
      var btn = e.target.closest('.lhd-bet-btn');
      if (!btn) return;
      placeBet(btn.getAttribute('data-bet'));
    });
  }

  if (chipBar) {
    chipBar.addEventListener('click', function (e) {
      unlockAudio();
      if (e.target.closest('.lhd-chip-more')) {
        chipPage = (chipPage + 1) % CHIP_PAGES.length;
        applyChipPage();
        return;
      }
      var chip = e.target.closest('.lhd-chip');
      if (!chip) return;
      selectedChip = Number(chip.getAttribute('data-chip')) || 1;
      qsa('.lhd-chip', chipBar).forEach(function (c) {
        c.classList.toggle('is-selected', c === chip);
      });
    });
  }

  if (actionBar) {
    actionBar.addEventListener('click', function (e) {
      unlockAudio();
      var btn = e.target.closest('.lhd-action');
      if (!btn || btn.classList.contains('is-disabled')) return;
      var act = btn.getAttribute('data-action');
      if (act === 'undo') undoAllBets();
      else if (act === 'rebet') rebetLastRound();
    });
  }

  document.addEventListener('pointerdown', unlockAudio, { once: true });
  document.addEventListener('touchstart', unlockAudio, { once: true });

  applyChipPage();
  renderRoad();
  if (window.TableShell && TableShell.hydrateRoad) {
    TableShell.hydrateRoad(SERVER_GAME, ROAD_ALLOWED, function (packed) {
      applyServerRoad(packed);
      if (packed && packed.snap && packed.snap.roundNo) {
        setRoundNoLabel(packed.snap.roundNo);
      }
    });
  }
  resetCards();
  refreshBalance();
  setInterval(refreshBalance, 2000);
  startBet();
  window.__lhdTickTimer = setInterval(function () {
    tick();
  }, 200);
  if (window.TableShell && TableShell.startSnapshotPoll) {
    window.__lhdSnapTimer = TableShell.startSnapshotPoll(SERVER_GAME, function (snap) {
      applyServerSnap(snap);
      if (alignWaiting && snap.phase === 'BETTING' && Number(snap.secondsLeft) > 0) {
        startBet();
        return;
      }
      if (phase === 'bet' && !roundBusy) {
        left = Math.max(0, Math.ceil(getBetRemainSec()));
        paint(false);
      }
    }, {
      intervalMs: 1500,
      shouldPoll: function () { return (phase === 'bet' && !roundBusy) || alignWaiting; },
    });
  }


  var playersEl = document.getElementById('playersCount');
  var playersBox = document.getElementById('playersBox');
  if (playersBox) {
    playersBox.setAttribute('aria-label', '气氛人数（非实时在线）');
    playersBox.setAttribute('title', '桌面气氛人数，非实时在线');
  }
  var playersN = 36;
  window.__lhdPlayersTimer = setInterval(function () {
    playersN = Math.max(22, Math.min(64, playersN + ((Math.random() * 3) | 0) - 1));
    if (playersEl) playersEl.textContent = String(playersN);
  }, 8000);

  /* ---------- 右侧快捷栏 + 弹层 ---------- */
  (function initRail() {
    var mask = document.getElementById('lhdSheetMask');
    var sheet = document.getElementById('lhdSheet');
    var sheetTitle = document.getElementById('lhdSheetTitle');
    var sheetBody = document.getElementById('lhdSheetBody');
    var closeBtn = document.getElementById('lhdSheetClose');

    function openSheet(title, html) {
      if (!sheet) return;
      sheetTitle.textContent = title;
      sheetBody.innerHTML = html;
      if (mask) mask.hidden = false;
      sheet.hidden = false;
      sheet.setAttribute('aria-hidden', 'false');
    }
    function closeSheet() {
      if (!sheet) return;
      sheet.hidden = true;
      sheet.setAttribute('aria-hidden', 'true');
      if (mask) mask.hidden = true;
      sheetBody.innerHTML = '';
    }
    if (mask) mask.addEventListener('click', closeSheet);
    if (closeBtn) closeBtn.addEventListener('click', closeSheet);

    function nav(path) {
      if (window.App && App.go) App.go(path);
      else if (window.parent !== window) {
        window.parent.postMessage({ type: 'assets-game-nav', path: path }, location.origin);
      }
    }

    var csBtn = document.getElementById('railCs');
    if (csBtn) csBtn.addEventListener('click', function () {
      nav('../../client-app/pages/cs/cs.html' + q);
    });

    var recBtn = document.getElementById('railRecords');
    if (recBtn) recBtn.addEventListener('click', function () {
      var sep = q.indexOf('?') >= 0 ? '&' : '?';
      nav('../../client-app/pages/bet-records/bet-records.html' + q + sep + 'game=longhu');
    });

    var histBtn = document.getElementById('railHistory');
    if (histBtn) histBtn.addEventListener('click', function () {
      var total = roadStats.dragon + roadStats.tiger + roadStats.tie;
      var html = '<div class="lhd-sheet-road__stats">' +
        '<span>龙 <b class="dragon">' + roadStats.dragon + '</b></span>' +
        '<span>虎 <b class="tiger">' + roadStats.tiger + '</b></span>' +
        '<span>和 <b class="tie">' + roadStats.tie + '</b></span>' +
        '<span>总局 <b>' + total + '</b></span></div>' +
        '<div class="lhd-sheet-road__label">珠盘路（今日 ' + roadHistory.length + ' 局）</div>' +
        '<div class="lhd-sheet-road__scroll"><div class="lhd-sheet-road__grid">' + buildBeadCells(roadHistory) + '</div></div>' +
        '<div class="lhd-sheet-road__label">大路</div>' +
        '<div class="lhd-sheet-road__scroll"><div class="lhd-sheet-road__grid">' + buildBigCells(roadHistory) + '</div></div>';
      openSheet('历史记录', html);
      var scrolls = document.querySelectorAll('.lhd-sheet-road__scroll');
      for (var i = 0; i < scrolls.length; i++) scrolls[i].scrollLeft = scrolls[i].scrollWidth;
    });

    var rulesBtn = document.getElementById('railRules');
    if (rulesBtn) rulesBtn.addEventListener('click', function () {
      var fmt = function (n) {
        return window.TableShell ? TableShell.formatOddsLabel(n) : ('1:' + n);
      };
      var html = window.TableShell
        ? TableShell.buildFormalRulesHtml({
            sections: [
              {
                title: '一、游戏简介',
                paragraphs: [
                  '本桌为龙虎比牌玩法。每局龙、虎各派一张牌，无须补牌；以牌面点数定胜负，点数相同则为和。',
                ],
              },
              {
                title: '二、胜负判定',
                list: [
                  '点数大小：K &gt; Q &gt; J &gt; 10 &gt; … &gt; 2 &gt; A（K 最大，A 最小）',
                  '龙点数大于虎，则龙胜；虎点数大于龙，则虎胜',
                  '点数相同为和',
                  '开和时，龙/虎注单本金全额退还',
                ],
              },
              {
                title: '三、结算说明',
                paragraphs: [
                  '下注期内可投注；封盘后停止接受注单，开牌后按结果结算。',
                  '路单展示本桌近期开奖走势，仅供参考。',
                ],
              },
            ],
            oddsHeaders: ['玩法', '获胜条件', '赔率', '备注'],
            oddsRows: [
              ['龙', '龙点数大于虎', fmt(ODDS.dragon), '开和退本'],
              ['虎', '虎点数大于龙', fmt(ODDS.tiger), '开和退本'],
              ['和', '龙虎点数相同', fmt(ODDS.tie), '—'],
            ],
            notes: [
              '请理性投注，量力而行。',
              '最终以当局开牌结果与系统结算为准。',
            ],
          })
        : '<p>玩法规则加载失败，请刷新重试。</p>';
      openSheet('玩法规则', html);
    });

    var setBtn = document.getElementById('railSettings');
    if (setBtn) setBtn.addEventListener('click', function () {
      var html = window.TableShell
        ? TableShell.buildAudioSettingsHtml(audioPref)
        : '<p>设置加载失败</p>';
      openSheet('设置', html);
      if (window.TableShell) {
        TableShell.bindAudioSettings({
          onMusic: function (on) { if (typeof unlockAudio === 'function') unlockAudio(); setMusicOn(on); },
          onSfx: function (on) { if (typeof unlockAudio === 'function') unlockAudio(); setSfxOn(on); },
        });
      }
    });
  })();

  window.addEventListener('gamebox-balance', function () { refreshBalance(); });
})();
