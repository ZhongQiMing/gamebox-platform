/**
 * 快乐时时彩 · 三路音频（互不混控）
 *
 * 1) music  房间 BGM：official-bg.mp3
 *    - 账号「背景音乐」→ app_bgm_off / setMusicOn
 *    - 开奖仪式进行中会压低音量，不关掉
 *
 * 2) sfx    房间音效：封盘前 3 秒铃声 rings/RING_01
 *    - 账号「音效」→ sound_off / setSfxOn
 *    - 与开奖卡按钮无关
 *
 * 3) drawSfx 开奖动画音效：official-opening / official-over（父页播，iframe 静音）
 *    - 仅开奖卡右上角喇叭按钮 → setDrawSfxOn
 *    - 关掉立刻停仪式音，不影响 BGM / 铃声
 */
(function (global) {
  var BASE = '/audio/ssc/';
  var VER = '17';
  var LS_KEY = 'ssc_audio_v1';
  /** 倒计时还剩 3 秒时开始响铃，持续到 00:00 */
  var RING_LEAD_MS = 3000;
  var RING_FADE_MS = 160;

  function isAppBgmOn() {
    try { return localStorage.getItem('app_bgm_off') !== '1'; } catch (e) { return true; }
  }
  function isAppSfxOn() {
    try { return localStorage.getItem('sound_off') !== '1'; } catch (e) { return true; }
  }

  /* 账号音量：BGM / SFX（含开奖动画 drawSfx）统一基准 */
  var BASE_BGM = 0.4;
  var BASE_SFX = 0.75;
  function appBgmLevel() {
    try { if (global.AppAudioLevel) return AppAudioLevel.getBgm(); } catch (e) {}
    return 0.8;
  }
  function appSfxLevel() {
    try { if (global.AppAudioLevel) return AppAudioLevel.getSfx(); } catch (e) {}
    return 0.8;
  }
  function musicVol() { return BASE_BGM * appBgmLevel(); }
  function sfxVol() { return Math.min(1, BASE_SFX * appSfxLevel()); }
  function applyLevels() {
    baseVol = musicVol();
    if (typeof bgm !== 'undefined' && bgm) {
      try {
        var duck = false;
        try { if (typeof drawActive !== 'undefined' && drawActive) duck = true; } catch (e1) {}
        try { if (typeof raceActive !== 'undefined' && raceActive) duck = true; } catch (e2) {}
        bgm.volume = duck ? baseVol * 0.15 : baseVol;
      } catch (e3) {}
    }
    if (typeof ringNode !== 'undefined' && ringNode) {
      try { ringNode.volume = sfxVol(); } catch (e4) {}
    }
    if (typeof liveSfx !== 'undefined' && liveSfx && liveSfx.forEach) {
      liveSfx.forEach(function (n) { try { n.volume = sfxVol(); } catch (e5) {} });
    }
    if (typeof drawNodes !== 'undefined' && drawNodes && drawNodes.forEach) {
      drawNodes.forEach(function (n) { try { n.volume = sfxVol(); } catch (e6) {} });
    }
  }

  /* 无本游戏记录时跟随账号管理；有记录则用本游戏覆盖 */
  var pref = {
    music: isAppBgmOn(),
    sfx: isAppSfxOn(),
    drawSfx: isAppSfxOn(),
  };
  try {
    var raw = JSON.parse(localStorage.getItem(LS_KEY) || 'null');
    if (raw && typeof raw === 'object') {
      if (typeof raw.music === 'boolean') pref.music = raw.music;
      if (typeof raw.sfx === 'boolean') pref.sfx = raw.sfx;
      if (typeof raw.drawSfx === 'boolean') pref.drawSfx = raw.drawSfx;
      /* 旧存档没有 drawSfx：跟当时的 sfx，避免行为突变 */
      else if (typeof raw.sfx === 'boolean') pref.drawSfx = raw.sfx;
    }
  } catch (e) { /* ignore */ }

  function syncFromAppIfNeeded() {
    try {
      var stored = localStorage.getItem(LS_KEY);
      if (stored && stored !== 'null') return;
    } catch (e) { return; }
    pref.music = isAppBgmOn();
    pref.sfx = isAppSfxOn();
    pref.drawSfx = isAppSfxOn();
    if (pref.music) {
      try { if (typeof ensureBgm === 'function') ensureBgm(true); } catch (e2) { /* ignore */ }
    } else {
      try { if (bgm) bgm.pause(); } catch (e4) { /* ignore */ }
    }
    if (!pref.sfx) {
      try { if (typeof clearCountdownArm === 'function') clearCountdownArm(); } catch (e6) { /* ignore */ }
      try { if (typeof stopRing === 'function') stopRing(); } catch (e7) { /* ignore */ }
      try { if (typeof stopLiveSfx === 'function') stopLiveSfx(); } catch (e8) { /* ignore */ }
    }
    if (!pref.drawSfx) {
      try { if (typeof stopDrawSfx === 'function') stopDrawSfx(); } catch (e9) { /* ignore */ }
      drawActive = false;
      if (bgm && pref.music) {
        try { bgm.volume = baseVol; } catch (e10) { /* ignore */ }
      }
    }
    applyLevels();
  }
  window.addEventListener('storage', function (ev) {
    if (!ev) return;
    if (ev.key === 'app_bgm_off' || ev.key === 'sound_off' || ev.key === 'app_bgm_vol' || ev.key === 'app_sfx_vol' || ev.key === LS_KEY) { syncFromAppIfNeeded(); applyLevels(); }
  });
  document.addEventListener('visibilitychange', function () {
    if (!document.hidden) { syncFromAppIfNeeded(); applyLevels(); }
  });
  window.addEventListener('app-audio-pref-changed', function () { syncFromAppIfNeeded(); applyLevels(); });

  var unlocked = false;
  var bgm = null;
  var lastSfxAt = {};
  var liveSfx = [];
  var cdTimers = [];
  var drawTimers = [];
  var drawNodes = [];
  var ringNode = null;
  var ringStopTimer = 0;
  var ringFadeTimer = 0;
  var cdArmedLockAt = 0;
  var ringPlayedForLock = 0;
  var ringPlayedThisDraw = false;
  var baseVol = musicVol();
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

  /* ───────── 1) 房间 BGM ───────── */
  function ensureBgm(playNow) {
    baseVol = musicVol();
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

  /* ───────── 2) 房间音效（铃声等） ───────── */
  function stopLiveSfx() {
    liveSfx.forEach(function (node) {
      try { node.pause(); node.src = ''; } catch (e) { /* ignore */ }
    });
    liveSfx = [];
  }

  function setSfxOn(on) {
    pref.sfx = !!on;
    savePref();
    if (!pref.sfx) {
      clearCountdownArm();
      stopRing();
      stopLiveSfx();
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
      node.volume = sfxVol();
      liveSfx.push(node);
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
    var from = typeof n.volume === 'number' ? n.volume : sfxVol();
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

  /** 末 3 秒铃声：房间音效，不受开奖卡按钮影响 */
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
      node.volume = sfxVol();
      ringNode = node;
      var p = node.play();
      if (p && p.catch) p.catch(function () {});
    } catch (e) {
      return;
    }

    var now = Date.now();
    var remain = lockAt ? Math.max(280, lockAt - now) : RING_LEAD_MS;
    var playMs = Math.min(Math.max(remain, 280), RING_LEAD_MS + 250);
    ringStopTimer = setTimeout(function () {
      ringStopTimer = 0;
      fadeStopRing();
    }, playMs);
  }

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

  function onCountdownSec(sec) {
    var s = Math.ceil(Number(sec));
    if (!(s <= 3) || s < 0) return;
    if (ringPlayedThisDraw) return;
    if (cdArmedLockAt) playCountdownRing(cdArmedLockAt);
  }

  function onDrawing() {
    clearCountdownArm();
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

  /* ───────── 3) 开奖动画音效 ───────── */
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
    if (!pref.drawSfx || !unlocked) return null;
    try {
      var node = new Audio(url(name, 'mp3'));
      node.loop = !!opt.loop;
      node.volume = sfxVol();
      drawNodes.push(node);
      var p = node.play();
      if (p && p.catch) p.catch(function () {});
      return node;
    } catch (e) {
      return null;
    }
  }

  function setDrawSfxOn(on) {
    pref.drawSfx = !!on;
    savePref();
    if (!pref.drawSfx) {
      /* 只停开奖仪式音；BGM / 铃声不动 */
      stopDrawSfx();
      drawActive = false;
      if (bgm && pref.music) {
        try { bgm.volume = baseVol; } catch (e) { /* ignore */ }
        ensureBgm(true);
      }
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

    /* drawSfx 关着：只压 BGM、不播 opening/over */
    playDrawTrack('official-opening', { loop: false, vol: sfxVol() });

    drawTimers.push(setTimeout(function () {
      drawNodes.slice().forEach(function (node) {
        try { node.pause(); node.src = ''; } catch (e) { /* ignore */ }
      });
      drawNodes = [];
      playDrawTrack('official-over', { loop: false, vol: sfxVol() });
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

  global.SscAudio = {
    unlock: unlock,
    ensureBgm: ensureBgm,
    /* 1 音乐 */
    setMusicOn: setMusicOn,
    isMusicOn: function () { return !!pref.music; },
    /* 2 房间音效 */
    setSfxOn: setSfxOn,
    isSfxOn: function () { return !!pref.sfx; },
    /* 3 开奖动画音效（开奖卡按钮只用这一路） */
    setDrawSfxOn: setDrawSfxOn,
    isDrawSfxOn: function () { return !!pref.drawSfx; },
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
    stopDrawSfx: stopDrawSfx,
    pref: pref,
  };
})(typeof window !== 'undefined' ? window : this);
