/** 蹇箰鏃舵椂褰?路 bg 澶у巺 BGM + 鏈?3 绉掗搩澹?+ opening/over 寮€濂?*/
(function (global) {
  var BASE = '/audio/ffc/';
  var VER = '14';
  var LS_KEY = 'ffc_audio_v1';
  /** 鍊掕鏃惰繕鍓?3 绉掓椂寮€濮嬪搷閾冿紝鎸佺画鍒?00:00 */
  var RING_LEAD_MS = 3000;
  var RING_FADE_MS = 160;

  function isAppBgmOn() {
    try { return localStorage.getItem('app_bgm_off') !== '1'; } catch (e) { return true; }
  }
  function isAppSfxOn() {
    try { return localStorage.getItem('sound_off') !== '1'; } catch (e) { return true; }
  }
  /* 无本游戏记录时跟随账号管理；有记录则用本游戏覆盖 */
  var pref = { music: isAppBgmOn(), sfx: isAppSfxOn() };
  try {
    var raw = JSON.parse(localStorage.getItem(LS_KEY) || 'null');
    if (raw && typeof raw === 'object') {
      if (typeof raw.music === 'boolean') pref.music = raw.music;
      if (typeof raw.sfx === 'boolean') pref.sfx = raw.sfx;
    }
  } catch (e) { /* ignore */ }

  function syncFromAppIfNeeded() {
    try {
      var stored = localStorage.getItem(LS_KEY);
      if (stored && stored !== 'null') return;
    } catch (e) { return; }
    pref.music = isAppBgmOn();
    pref.sfx = isAppSfxOn();
    if (pref.music) {
      try { if (typeof ensureBgm === 'function') ensureBgm(true); } catch (e2) { /* ignore */ }
      try { if (typeof ensureLobbyBgm === 'function') ensureLobbyBgm(true); } catch (e3) { /* ignore */ }
    } else {
      try { if (bgm) bgm.pause(); } catch (e4) { /* ignore */ }
      try { if (lobbyBgm) lobbyBgm.pause(); } catch (e5) { /* ignore */ }
    }
    if (!pref.sfx) {
      try { if (typeof clearCountdownArm === 'function') clearCountdownArm(); } catch (e6) { /* ignore */ }
      try { if (typeof stopRing === 'function') stopRing(); } catch (e7) { /* ignore */ }
      try { if (typeof stopDrawSfx === 'function') stopDrawSfx(); } catch (e8) { /* ignore */ }
      try { if (typeof stopRaceSfx === 'function') stopRaceSfx(); } catch (e9) { /* ignore */ }
    }
  }
  window.addEventListener('storage', function (ev) {
    if (!ev) return;
    if (ev.key === 'app_bgm_off' || ev.key === 'sound_off' || ev.key === LS_KEY) syncFromAppIfNeeded();
  });
  document.addEventListener('visibilitychange', function () {
    if (!document.hidden) syncFromAppIfNeeded();
  });

  var unlocked = false;
  var bgm = null;
  var lastSfxAt = {};
  var cdTimers = [];
  var drawTimers = [];
  var drawNodes = [];
  var ringNode = null;
  var ringStopTimer = 0;
  var ringFadeTimer = 0;
  var cdArmedLockAt = 0;
  var ringPlayedForLock = 0;
  var ringPlayedThisDraw = false;
  var baseVol = 0.42;
  var drawActive = false;

  function url(name, ext) {
    return BASE + name + '.' + (ext || 'wav') + '?v=' + VER;
  }

  function savePref() {
    try { localStorage.setItem(LS_KEY, JSON.stringify(pref)); } catch (e) { /* ignore */ }
  }

  function unlock() {
    if (unlocked) return;
    unlocked = true;
    try {
      var silent = new Audio(url('rings/RING_01'));
      silent.volume = 0;
      silent.play().then(function () { silent.pause(); }).catch(function () {});
    } catch (e) { /* ignore */ }
    ensureBgm(true);
  }

  function ensureBgm(playNow) {
    if (!bgm) {
      bgm = new Audio(url('official-bg', 'mp3'));
      bgm.loop = true;
      bgm.preload = 'auto';
      bgm.volume = baseVol;
    } else {
      bgm.volume = drawActive ? baseVol * 0.12 : baseVol;
    }
    if (!pref.music) return;
    if (playNow && bgm.paused) {
      var p = bgm.play();
      if (p && p.catch) p.catch(function () {});
    }
  }

  function setMusicOn(on) {
    pref.music = !!on;
    savePref();
    if (pref.music) ensureBgm(true);
    else if (bgm) {
      try { bgm.pause(); } catch (e) { /* ignore */ }
    }
  }

  function setSfxOn(on) {
    pref.sfx = !!on;
    savePref();
    if (!pref.sfx) {
      clearCountdownArm();
      stopRing();
      stopDrawSfx();
    }
  }

  function sfx(name, opt) {
    if (!pref.sfx || !unlocked) return null;
    opt = opt || {};
    var now = Date.now();
    var gap = typeof opt.dedupeMs === 'number' ? opt.dedupeMs : 40;
    var key = name + (opt.ext || '');
    if (lastSfxAt[key] && now - lastSfxAt[key] < gap) return null;
    lastSfxAt[key] = now;
    try {
      var node = new Audio(url(name, opt.ext));
      node.volume = typeof opt.vol === 'number' ? opt.vol : 0.7;
      var p = node.play();
      if (p && p.catch) p.catch(function () {});
      return node;
    } catch (e) {
      return null;
    }
  }

  function clearRingFade() {
    if (ringFadeTimer) {
      clearInterval(ringFadeTimer);
      ringFadeTimer = 0;
    }
  }

  function stopRing() {
    if (ringStopTimer) {
      clearTimeout(ringStopTimer);
      ringStopTimer = 0;
    }
    clearRingFade();
    if (ringNode) {
      try { ringNode.pause(); ringNode.src = ''; } catch (e) { /* ignore */ }
      ringNode = null;
    }
  }

  function fadeStopRing() {
    var n = ringNode;
    if (!n) return;
    clearRingFade();
    var from = typeof n.volume === 'number' ? n.volume : 0.75;
    var steps = 5;
    var i = 0;
    ringFadeTimer = setInterval(function () {
      i += 1;
      try { n.volume = Math.max(0, from * (1 - i / steps)); } catch (e) { /* ignore */ }
      if (i >= steps) {
        clearRingFade();
        try { n.pause(); n.src = ''; } catch (e2) { /* ignore */ }
        if (ringNode === n) ringNode = null;
      }
    }, Math.max(24, Math.floor(RING_FADE_MS / steps)));
  }

  function clearCountdownArm() {
    cdTimers.forEach(function (id) { clearTimeout(id); });
    cdTimers = [];
    cdArmedLockAt = 0;
  }

  /**
   * 鏈?3 绉掗搩澹帮細浠?00:03 璧锋挱 RING_01锛屾挱鍒扮害 00:00锛堝紑濂栦华寮忓紑濮嬫椂鎺愭柇锛夈€?   */
  function playCountdownRing(lockAtMs) {
    if (!pref.sfx || !unlocked) return;
    var lockAt = Number(lockAtMs) || 0;
    if (lockAt && ringPlayedForLock === lockAt) return;
    if (ringPlayedThisDraw) return;
    if (lockAt) ringPlayedForLock = lockAt;
    ringPlayedThisDraw = true;

    stopRing();
    var node = null;
    try {
      node = new Audio(url('rings/RING_01'));
      node.volume = 0.75;
      ringNode = node;
      var p = node.play();
      if (p && p.catch) p.catch(function () {});
    } catch (e) {
      return;
    }

    var now = Date.now();
    var remain = lockAt ? Math.max(280, lockAt - now) : RING_LEAD_MS;
    /* 鐩栦綇 3鈫?锛岀暐鐣欎綑閲忥紱寮€濂?ceremony 浼?stopRing */
    var playMs = Math.min(Math.max(remain, 280), RING_LEAD_MS + 250);
    ringStopTimer = setTimeout(function () {
      ringStopTimer = 0;
      fadeStopRing();
    }, playMs);
  }

  /**
   * 鍦?lockAt 鍓?3 绉掑紑鐏紱鑻ヨ繘鎴挎椂宸蹭笉瓒?3 绉掑垯绔嬪埢寮€濮嬨€?   */
  function armCountdown(lockAtMs) {
    var lockAt = Number(lockAtMs) || 0;
    if (!lockAt || !isFinite(lockAt)) return;
    if (cdArmedLockAt === lockAt) return;
    clearCountdownArm();
    cdArmedLockAt = lockAt;

    var now = Date.now();
    if (now >= lockAt) return;

    var startAt = lockAt - RING_LEAD_MS;
    var delay = startAt - now;
    var fire = function () { playCountdownRing(lockAt); };
    if (delay <= 0) fire();
    else cdTimers.push(setTimeout(fire, delay));
  }

  /** 澶囩敤锛歎I 鏄剧ず鍒?3 绉掓椂鑻ュ畾鏃跺櫒娌℃墦鍒帮紝琛ュ紑閾?*/
  function onCountdownSec(sec) {
    var s = Math.ceil(Number(sec));
    if (!(s <= 3) || s < 0) return;
    if (ringPlayedThisDraw) return;
    if (cdArmedLockAt) playCountdownRing(cdArmedLockAt);
  }

  function onDrawing() {
    /* 灏佺洏鍚庡仠鍊掕鏃堕搩锛屽紑濂栭煶鏁堜氦缁?ceremony */
    clearCountdownArm();
    /* 鑻ユ暣娈?3 绉掗搩閮芥病鍝嶅埌锛屼笉鍐嶈ˉ闀块搩锛岄伩鍏嶅拰 opening 鍙?*/
  }

  function onBetting() {
    ringPlayedThisDraw = false;
    ringPlayedForLock = 0;
    stopRing();
    endDrawCeremony();
    ensureBgm(true);
  }

  function startRoll() {}
  function stopRoll() {}
  function rollTick() {}
  function ballStop() {}
  function onRevealDone() {
    endDrawCeremony();
  }

  function stopDrawSfx() {
    drawTimers.forEach(function (id) { clearTimeout(id); });
    drawTimers = [];
    drawNodes.forEach(function (node) {
      try { node.pause(); node.src = ''; } catch (e) { /* ignore */ }
    });
    drawNodes = [];
  }

  function playDrawTrack(name, opt) {
    opt = opt || {};
    if (!pref.sfx || !unlocked) return null;
    try {
      var node = new Audio(url(name, 'mp3'));
      node.loop = !!opt.loop;
      node.volume = typeof opt.vol === 'number' ? opt.vol : 0.72;
      drawNodes.push(node);
      var p = node.play();
      if (p && p.catch) p.catch(function () {});
      return node;
    } catch (e) {
      return null;
    }
  }

  function startDrawCeremony(opts) {
    opts = opts || {};
    var mid = opts.midMs != null ? Number(opts.midMs) : 6000;
    if (!(mid >= 0)) mid = 6000;

    stopRing();
    stopDrawSfx();
    drawActive = true;
    ringPlayedThisDraw = true;
    if (bgm && pref.music) {
      try { bgm.volume = baseVol * 0.12; } catch (e) { /* ignore */ }
    }

    playDrawTrack('official-opening', { loop: false, vol: 0.7 });

    drawTimers.push(setTimeout(function () {
      drawNodes.slice().forEach(function (node) {
        try { node.pause(); node.src = ''; } catch (e) { /* ignore */ }
      });
      drawNodes = [];
      playDrawTrack('official-over', { loop: false, vol: 0.78 });
    }, mid));
  }

  function endDrawCeremony() {
    drawActive = false;
    stopDrawSfx();
    if (bgm && pref.music) {
      try { bgm.volume = baseVol; } catch (e) { /* ignore */ }
      ensureBgm(true);
    }
  }

  document.addEventListener('pointerdown', unlock, { once: true });
  document.addEventListener('touchstart', unlock, { once: true });
  document.addEventListener('visibilitychange', function () {
    if (document.hidden) {
      if (bgm) try { bgm.pause(); } catch (e) { /* ignore */ }
      clearCountdownArm();
      stopRing();
      stopDrawSfx();
      drawActive = false;
    } else if (pref.music && unlocked) {
      ensureBgm(true);
    }
  });

  global.FfcAudio = {
    unlock: unlock,
    ensureBgm: ensureBgm,
    setMusicOn: setMusicOn,
    setSfxOn: setSfxOn,
    armCountdown: armCountdown,
    clearCountdownArm: clearCountdownArm,
    onCountdownSec: onCountdownSec,
    onDrawing: onDrawing,
    onBetting: onBetting,
    startRoll: startRoll,
    stopRoll: stopRoll,
    rollTick: rollTick,
    ballStop: ballStop,
    onRevealDone: onRevealDone,
    startDrawCeremony: startDrawCeremony,
    endDrawCeremony: endDrawCeremony,
    pref: pref
  };
})(typeof window !== 'undefined' ? window : this);

