/**
 * 牌桌两路音频（互不混控）
 *
 * 1) music  背景音乐：bgm.mp3 循环
 *    - setMusicOn / isMusicOn
 *    - 账号「背景音乐」→ app_bgm_off / app_bgm_vol
 *
 * 2) sfx    游戏音效：短音效 + 报牌/胜负语音（统一响度）
 *    - setSfxOn / isSfxOn
 *    - 账号「音效」→ sound_off / app_sfx_vol
 *    - 关掉立刻停当前短音与语音，不影响 BGM
 *
 * 用法：
 *   var TA = TableAudio.create({ prefKey, base, ver, exportAs, voiceTimeoutMs });
 */
(function (global) {
  var TableAudio = global.TableAudio || {};
  /** 全游戏统一基准（再乘账号音量滑条） */
  var BASE_BGM = 0.4;
  var BASE_SFX = 0.75;

  function appBgmLevel() {
    try {
      if (global.AppAudioLevel) return AppAudioLevel.getBgm();
    } catch (e) { /* ignore */ }
    return 0.8;
  }
  function appSfxLevel() {
    try {
      if (global.AppAudioLevel) return AppAudioLevel.getSfx();
    } catch (e) { /* ignore */ }
    return 0.8;
  }
  function musicVol() { return BASE_BGM * appBgmLevel(); }
  function sfxVol() { return Math.min(1, BASE_SFX * appSfxLevel()); }

  function create(opts) {
    opts = opts || {};
    var PREF_KEY = opts.prefKey || 'table_audio';
    var BASE = opts.base || './assets/audio/';
    var VER = String(opts.ver != null ? opts.ver : '1');
    var BGM_NAME = opts.bgm || 'bgm';
    var UNLOCK_SAMPLE = opts.unlockSample || 'bet';
    var voiceTimeoutMs = opts.voiceTimeoutMs;
    if (typeof voiceTimeoutMs !== 'function') {
      var fixedMs = typeof voiceTimeoutMs === 'number' ? voiceTimeoutMs : 2200;
      voiceTimeoutMs = function () { return fixedMs; };
    }

    var pref = window.TableShell
      ? TableShell.loadAudioPref(PREF_KEY)
      : { music: true, sfx: true };

    var unlocked = false;
    var bgmAudio = null;
    var voiceAudio = null;
    var sfxLastAt = {};
    var liveSfx = [];

    function url(name) {
      return BASE + name + '.mp3?v=' + VER;
    }

    function savePref() {
      if (window.TableShell) {
        TableShell.saveAudioPref(PREF_KEY, pref);
      } else {
        try {
          localStorage.setItem(PREF_KEY, JSON.stringify({
            music: !!pref.music,
            sfx: !!pref.sfx,
          }));
        } catch (e) { /* ignore */ }
      }
    }

    function stopVoice() {
      if (!voiceAudio) return;
      voiceAudio.onended = null;
      voiceAudio.onerror = null;
      try { voiceAudio.pause(); } catch (e) { /* ignore */ }
      try { voiceAudio.src = ''; } catch (e2) { /* ignore */ }
      voiceAudio = null;
    }

    function stopLiveSfx() {
      liveSfx.forEach(function (node) {
        try { node.pause(); node.src = ''; } catch (e) { /* ignore */ }
      });
      liveSfx = [];
    }

    function stopAllSfx() {
      stopVoice();
      stopLiveSfx();
    }

    function applyLevels() {
      if (bgmAudio) {
        try { bgmAudio.volume = musicVol(); } catch (e) { /* ignore */ }
      }
      if (voiceAudio) {
        try { voiceAudio.volume = sfxVol(); } catch (e2) { /* ignore */ }
      }
      liveSfx.forEach(function (node) {
        try { node.volume = sfxVol(); } catch (e3) { /* ignore */ }
      });
    }

    function ensureBgm(playNow) {
      if (!bgmAudio) {
        bgmAudio = new Audio(url(BGM_NAME));
        bgmAudio.loop = true;
        bgmAudio.volume = musicVol();
        bgmAudio.preload = 'auto';
      } else {
        bgmAudio.volume = musicVol();
      }
      if (!pref.music) return;
      if (playNow && bgmAudio.paused) {
        var p = bgmAudio.play();
        if (p && p.catch) p.catch(function () { /* 需用户手势后再播 */ });
      }
    }

    function applyPrefSilent(next) {
      if (!next) return;
      pref.music = !!next.music;
      pref.sfx = !!next.sfx;
      if (pref.music) {
        ensureBgm(true);
      } else if (bgmAudio) {
        try { bgmAudio.pause(); } catch (e) { /* ignore */ }
      }
      if (!pref.sfx) stopAllSfx();
      applyLevels();
    }

    if (window.TableShell && TableShell.watchAppAudioPref) {
      TableShell.watchAppAudioPref(PREF_KEY, applyPrefSilent);
    }
    if (global.AppAudioLevel && AppAudioLevel.onChange) {
      AppAudioLevel.onChange(function () {
        applyLevels();
        if (window.TableShell && !TableShell.hasStoredAudioPref(PREF_KEY)) {
          applyPrefSilent(TableShell.loadAudioPref(PREF_KEY));
        }
      });
    }

    function unlock() {
      if (unlocked) return;
      unlocked = true;
      try {
        var silent = new Audio(url(UNLOCK_SAMPLE));
        silent.volume = 0;
        silent.play().then(function () { silent.pause(); }).catch(function () {});
      } catch (e) { /* ignore */ }
      ensureBgm(true);
    }

    /* ───────── 1) 背景音乐 ───────── */
    function setMusicOn(on) {
      pref.music = !!on;
      savePref();
      if (pref.music) ensureBgm(true);
      else if (bgmAudio) {
        try { bgmAudio.pause(); } catch (e) { /* ignore */ }
      }
    }

    /* ───────── 2) 游戏音效（短音 + 语音，统一响度） ───────── */
    function setSfxOn(on) {
      pref.sfx = !!on;
      savePref();
      if (!pref.sfx) stopAllSfx();
    }

    function sfx(name, opt) {
      if (!name || !pref.sfx) return null;
      opt = opt || {};
      var now = Date.now();
      var gap = typeof opt.dedupeMs === 'number' ? opt.dedupeMs : 80;
      if (sfxLastAt[name] && now - sfxLastAt[name] < gap) return null;
      sfxLastAt[name] = now;
      try {
        var node = new Audio(url(name));
        /* 响度统一走账号音量；opt.vol 忽略，避免各调用点忽大忽小 */
        node.volume = sfxVol();
        liveSfx.push(node);
        node.addEventListener('ended', function () {
          var i = liveSfx.indexOf(node);
          if (i >= 0) liveSfx.splice(i, 1);
        });
        var p = node.play();
        if (p && p.catch) p.catch(function () {});
        return node;
      } catch (e) {
        return null;
      }
    }

    function playVoice(name) {
      return new Promise(function (resolve) {
        var done = false;
        function finish() {
          if (done) return;
          done = true;
          resolve();
        }
        if (!name || !pref.sfx) { finish(); return; }
        try {
          stopVoice();
          var node = new Audio(url(name));
          voiceAudio = node;
          node.volume = sfxVol();
          node.onended = finish;
          node.onerror = finish;
          var p = node.play();
          if (p && p.catch) p.catch(finish);
          setTimeout(finish, voiceTimeoutMs(name) || 2200);
        } catch (e) {
          finish();
        }
      });
    }

    var api = {
      pref: pref,
      prefKey: PREF_KEY,
      url: url,
      unlock: unlock,
      ensureBgm: ensureBgm,
      setMusicOn: setMusicOn,
      setSfxOn: setSfxOn,
      isMusicOn: function () { return !!pref.music; },
      isSfxOn: function () { return !!pref.sfx; },
      sfx: sfx,
      playVoice: playVoice,
      stopVoice: stopVoice,
      stopAllSfx: stopAllSfx,
      savePref: savePref,
      applyPrefSilent: applyPrefSilent,
      applyLevels: applyLevels,
    };

    if (opts.exportAs) {
      global[opts.exportAs] = api;
    }
    return api;
  }

  TableAudio.create = create;
  global.TableAudio = TableAudio;
})(typeof window !== 'undefined' ? window : this);
