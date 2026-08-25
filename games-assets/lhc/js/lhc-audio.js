/**
 * 幸运六合彩 · 三路音频（互不混控）
 *
 * 1) music  房间 BGM：bg.mp3
 * 2) sfx    房间音效：预留（当前无独立房间 SFX）
 * 3) drawSfx 开奖动画：摇珠 bgsound + 报号 one~seven / 1~49
 *    - 仅开奖卡喇叭 → setDrawSfxOn
 */
(function (global) {
  var BASE = '/audio/lhc/';
  var VER = '4';
  var LS_KEY = 'lhc_audio_v1';

  var ORDINAL = ['one', 'two', 'three', 'four', 'five', 'six', 'seven'];
    function isAppBgmOn() {
    try { return localStorage.getItem('app_bgm_off') !== '1'; } catch (e) { return true; }
  }
  function isAppSfxOn() {
    try { return localStorage.getItem('sound_off') !== '1'; } catch (e) { return true; }
  }

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
  function lobbyDuckVol() { return musicVol() * 0.3; }
  function applyLevels() {
    if (lobbyBgm) {
      try { lobbyBgm.volume = drawActive ? lobbyDuckVol() : musicVol(); } catch (e) {}
    }
    /* 仪式音轨要认「开奖音效」这一路的开关：关着时它们静音待命，别在这里被拉回音量 */
    var dv = pref.drawSfx ? sfxVol() : 0;
    var dm = !pref.drawSfx;
    if (drawBg) { try { drawBg.muted = dm; drawBg.volume = dv; } catch (e2) {} }
    activeNodes.forEach(function (n) { try { n.muted = dm; n.volume = dv; } catch (e3) {} });
  }

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
      try { if (typeof ensureLobbyBgm === 'function') ensureLobbyBgm(true); } catch (e3) { /* ignore */ }
    } else {
      try { if (lobbyBgm) lobbyBgm.pause(); } catch (e5) { /* ignore */ }
    }
    /* 关掉这一路只静音、不销毁（见 setDrawSfxOn）；drawActive 交给仪式自己收尾 */
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

  /* ───────── 1) 房间 BGM ───────── */
  function ensureLobbyBgm(playNow) {
    if (!lobbyBgm) {
      lobbyBgm = new Audio(url('bg'));
      lobbyBgm.loop = true;
      lobbyBgm.preload = 'auto';
      lobbyBgm.volume = musicVol();
    }
    lobbyBgm.volume = drawActive ? lobbyDuckVol() : musicVol();
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

  function setMusicOn(on) {
    pref.music = !!on;
    savePref();
    if (!pref.music) {
      stopNode(lobbyBgm);
    } else if (unlocked) {
      ensureLobbyBgm(true);
    }
  }

  /* ───────── 2) 房间音效（预留） ───────── */
  function setSfxOn(on) {
    pref.sfx = !!on;
    savePref();
  }

  /* ───────── 3) 开奖动画音效 ───────── */
  /** 仪式音轨目标音量：关掉这一路时为 0（节点仍在，见 setDrawSfxOn） */
  function drawTrackVol() {
    return pref.drawSfx ? sfxVol() : 0;
  }

  /**
   * 收尾用：停摇珠循环轨与待触发定时器，正在响的报号让它说完。
   * 一期要报 7 个球、14 段语音，硬停会把最后那句掐掉半截。
   */
  function stopDrawLoops() {
    for (var i = 0; i < drawTimers.length; i++) clearTimeout(drawTimers[i]);
    drawTimers = [];
    stopNode(drawBg);
    drawBg = null;
  }

  /** 硬停：离页 / 新一期顶掉上一期，报号也一并掐 */
  function clearDrawTimers() {
    stopDrawLoops();
    for (var j = 0; j < activeNodes.length; j++) stopNode(activeNodes[j]);
    activeNodes = [];
  }

  /**
   * 关掉这一路时不再拦着不建节点，而是建出来静音播。
   * 原先是「关掉就 clearDrawTimers()」：报号节点和 14 段语音的定时器一起销毁，
   * 再打开只是把开关置回 true，这一期剩下的球就再也不报了，得等下一期。
   * 六合彩一期仪式有三十秒，中途关一下等于后面全哑，所以必须保留定时器、只压音量。
   */
  function playOne(name) {
    try {
      var a = new Audio(url(name));
      a.muted = !pref.drawSfx;
      a.volume = drawTrackVol();
      a.preload = 'auto';
      var p = a.play();
      if (p && p.catch) p.catch(function () {});
      activeNodes.push(a);
      /* 报号是一次性的，播完自己从表里摘掉，避免越攒越长 */
      var drop = function () {
        var i = activeNodes.indexOf(a);
        if (i >= 0) activeNodes.splice(i, 1);
      };
      a.addEventListener('ended', drop, { once: true });
      a.addEventListener('error', drop, { once: true });
      return a;
    } catch (e) {
      return null;
    }
  }

  function startDrawBg() {
    stopNode(drawBg);
    try {
      drawBg = new Audio(url('bgsound'));
      drawBg.loop = true;
      drawBg.muted = !pref.drawSfx;
      drawBg.volume = drawTrackVol();
      drawBg.preload = 'auto';
      var p = drawBg.play();
      if (p && p.catch) p.catch(function () {});
    } catch (e) { /* ignore */ }
  }

  function setDrawSfxOn(on) {
    pref.drawSfx = !!on;
    savePref();
    applyLevels();
    /* 仪式仍在跑时 BGM 该压的继续压，别因为切了开关就把音乐顶回来 */
    ensureLobbyBgm(true);
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
          playOne(ORDINAL[idx]);
        }, t0));
        drawTimers.push(setTimeout(function () {
          if (num >= 1 && num <= 49) playOne(String(num));
        }, t0 + revealMs));
      })(i, nums[i]);
    }

    var total = spinMs + gapMs * 7 + holdMs;
    drawTimers.push(setTimeout(function () {
      endDrawCeremony();
    }, total));
  }

  function endDrawCeremony() {
    /* 只收循环轨：动画结束这一下常常压在最后一句报号上，硬停就把它掐半截 */
    stopDrawLoops();
    drawActive = false;
    ensureLobbyBgm(true);
  }

  global.LhcAudio = {
    unlock: unlock,
    ensureLobbyBgm: ensureLobbyBgm,
    startDrawCeremony: startDrawCeremony,
    endDrawCeremony: endDrawCeremony,
    setMusicOn: setMusicOn,
    isMusicOn: function () { return !!pref.music; },
    setSfxOn: setSfxOn,
    isSfxOn: function () { return !!pref.sfx; },
    setDrawSfxOn: setDrawSfxOn,
    isDrawSfxOn: function () { return !!pref.drawSfx; },
    stopDrawSfx: clearDrawTimers,
    pref: pref,
  };
})(typeof window !== 'undefined' ? window : this);
