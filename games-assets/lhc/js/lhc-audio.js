/**
 * 幸运六合彩音效
 * - bg.mp3：房间背景音乐（Inkpot）
 * - bgsound.mp3：开奖摇珠 BGM
 * - one~seven + 1~49：报号
 */
(function (global) {
  var BASE = '/audio/lhc/';
  var VER = '2';
  var LS_KEY = 'lhc_audio_v1';

  var ORDINAL = ['one', 'two', 'three', 'four', 'five', 'six', 'seven'];
  var LOBBY_VOL = 0.42;
  var LOBBY_DUCK = 0.12;
  var DRAW_BG_VOL = 0.55;

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
  var lobbyBgm = null;
  var drawBg = null;
  var drawActive = false;
  var drawTimers = [];
  var activeNodes = [];

  function url(name) {
    return BASE + name + '.mp3?v=' + VER;
  }

  function savePref() {
    try { localStorage.setItem(LS_KEY, JSON.stringify(pref)); } catch (e) { /* ignore */ }
  }

  function stopNode(n) {
    if (!n) return;
    try { n.pause(); } catch (e) { /* ignore */ }
    try { n.currentTime = 0; } catch (e2) { /* ignore */ }
  }

  function ensureLobbyBgm(playNow) {
    if (!lobbyBgm) {
      lobbyBgm = new Audio(url('bg'));
      lobbyBgm.loop = true;
      lobbyBgm.preload = 'auto';
      lobbyBgm.volume = LOBBY_VOL;
    }
    lobbyBgm.volume = drawActive ? LOBBY_DUCK : LOBBY_VOL;
    if (!pref.music) return;
    if (playNow && lobbyBgm.paused) {
      var p = lobbyBgm.play();
      if (p && p.catch) p.catch(function () {});
    }
  }

  function unlock() {
    if (unlocked) {
      ensureLobbyBgm(true);
      return;
    }
    unlocked = true;
    try {
      var a = new Audio(url('empt'));
      a.volume = 0;
      a.play().then(function () { a.pause(); }).catch(function () {});
    } catch (e) { /* ignore */ }
    ensureLobbyBgm(true);
  }

  function clearDrawTimers() {
    for (var i = 0; i < drawTimers.length; i++) clearTimeout(drawTimers[i]);
    drawTimers = [];
    for (var j = 0; j < activeNodes.length; j++) stopNode(activeNodes[j]);
    activeNodes = [];
    stopNode(drawBg);
    drawBg = null;
  }

  function playOne(name, vol) {
    if (!pref.sfx) return null;
    try {
      var a = new Audio(url(name));
      a.volume = vol == null ? 0.85 : vol;
      a.preload = 'auto';
      var p = a.play();
      if (p && p.catch) p.catch(function () {});
      activeNodes.push(a);
      return a;
    } catch (e) {
      return null;
    }
  }

  function startDrawBg() {
    if (!pref.music) return;
    stopNode(drawBg);
    try {
      drawBg = new Audio(url('bgsound'));
      drawBg.loop = true;
      drawBg.volume = DRAW_BG_VOL;
      drawBg.preload = 'auto';
      var p = drawBg.play();
      if (p && p.catch) p.catch(function () {});
    } catch (e) { /* ignore */ }
  }

  function startDrawCeremony(opts) {
    opts = opts || {};
    unlock();
    clearDrawTimers();
    drawActive = true;
    ensureLobbyBgm(true);

    var nums = Array.isArray(opts.nums) ? opts.nums.map(Number) : [];
    if (nums.length !== 7) return;

    var spinMs = opts.spinMs != null ? Number(opts.spinMs) : 2500;
    var gapMs = opts.ballGapMs != null ? Number(opts.ballGapMs) : 3800;
    var revealMs = opts.ballRevealMs != null ? Number(opts.ballRevealMs) : 1900;
    var holdMs = opts.holdMs != null ? Number(opts.holdMs) : 1200;
    if (!(spinMs >= 0)) spinMs = 2500;
    if (!(gapMs >= 0)) gapMs = 3800;
    if (!(revealMs >= 0)) revealMs = 1900;
    if (!(holdMs >= 0)) holdMs = 1200;

    startDrawBg();

    for (var i = 0; i < 7; i++) {
      (function (idx, num) {
        var t0 = spinMs + idx * gapMs;
        drawTimers.push(setTimeout(function () {
          playOne(ORDINAL[idx], 0.9);
        }, t0));
        drawTimers.push(setTimeout(function () {
          if (num >= 1 && num <= 49) playOne(String(num), 0.95);
        }, t0 + revealMs));
      })(i, nums[i]);
    }

    var total = spinMs + gapMs * 7 + holdMs;
    drawTimers.push(setTimeout(function () {
      endDrawCeremony();
    }, total));
  }

  function endDrawCeremony() {
    clearDrawTimers();
    drawActive = false;
    ensureLobbyBgm(true);
  }

  function setMusicOn(on) {
    pref.music = !!on;
    savePref();
    if (!pref.music) {
      stopNode(lobbyBgm);
      stopNode(drawBg);
    } else if (unlocked) {
      ensureLobbyBgm(true);
    }
  }

  function setSfxOn(on) {
    pref.sfx = !!on;
    savePref();
  }

  global.LhcAudio = {
    unlock: unlock,
    ensureLobbyBgm: ensureLobbyBgm,
    startDrawCeremony: startDrawCeremony,
    endDrawCeremony: endDrawCeremony,
    setMusicOn: setMusicOn,
    setSfxOn: setSfxOn,
    isMusicOn: function () { return !!pref.music; },
    isSfxOn: function () { return !!pref.sfx; },
  };
})(typeof window !== 'undefined' ? window : this);
