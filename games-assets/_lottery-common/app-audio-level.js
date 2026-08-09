/**
 * 账号管理全局音量（与 client-app appSoundPrefs 键名一致）
 * - app_bgm_vol / app_sfx_vol：0～100，缺省 80
 * - 聊天室：sfx 与 drawSfx（开奖动画）都乘 sfx 音量
 */
(function (global) {
  var BGM_KEY = 'app_bgm_vol';
  var SFX_KEY = 'app_sfx_vol';
  var DEFAULT = 80;

  function clamp(n) {
    n = Math.round(Number(n));
    if (!isFinite(n)) return DEFAULT;
    if (n < 0) return 0;
    if (n > 100) return 100;
    return n;
  }

  function readPercent(key) {
    try {
      var raw = localStorage.getItem(key);
      if (raw == null || raw === '') return DEFAULT;
      return clamp(raw);
    } catch (e) {
      return DEFAULT;
    }
  }

  function getBgm() {
    return readPercent(BGM_KEY) / 100;
  }

  function getSfx() {
    return readPercent(SFX_KEY) / 100;
  }

  function onChange(fn) {
    if (typeof fn !== 'function') return;
    window.addEventListener('storage', function (ev) {
      if (!ev) return;
      if (
        ev.key === BGM_KEY ||
        ev.key === SFX_KEY ||
        ev.key === 'app_bgm_off' ||
        ev.key === 'sound_off'
      ) {
        fn();
      }
    });
    window.addEventListener('app-audio-pref-changed', fn);
    document.addEventListener('visibilitychange', function () {
      if (!document.hidden) fn();
    });
  }

  global.AppAudioLevel = {
    getBgm: getBgm,
    getSfx: getSfx,
    getBgmPercent: function () { return readPercent(BGM_KEY); },
    getSfxPercent: function () { return readPercent(SFX_KEY); },
    onChange: onChange,
  };
})(typeof window !== 'undefined' ? window : this);
