/**
 * 聊天室类游戏的服务端校准时钟。
 *
 * 为什么需要：封盘线 lockAt / 开奖点 openAt 都是服务端下发的绝对时间戳，
 * 而玩家设备的 Date.now() 可能与服务端差出几秒甚至几分钟（关掉自动对时、
 * 模拟器、掉电后 RTC 归零）。直接相减，倒计时和下注闸门就会整体偏移：
 * 走快了玩家白丢最后几秒，走慢了玩家点得进去却被服务端打回。
 *
 * 怎么做：每次快照都带回服务端时刻，配合宿主侧量到的收发时刻估出偏移量，
 * 之后所有与服务端时间戳的比较都用 now() 而不是 Date.now()。
 *
 * 另外提供封盘提前量：即使时钟完全准，玩家在剩 0.1 秒时点下注，请求飞过
 * 网络也会落在封盘线之后被拒。客户端提前一点收口，让倒计时归零与停止接单
 * 同时发生，玩家就不会再遇到「明明还有时间却被拒绝」。
 */
(function (global) {
  /** 客户端比服务端封盘线提前收口的毫秒数 */
  var BET_CUTOFF_MS = 800;

  /** 偏移超过这个量视为设备时钟严重不准，直接采信而不做平滑，避免慢慢爬 */
  var JUMP_MS = 5000;

  var state = {
    offsetMs: 0,
    synced: false,
    bestRtt: Infinity,
  };

  /**
   * 用一次快照校时。
   *
   * @param serverNowMs 服务端在处理这次请求时的时刻
   * @param sentAt 宿主发出请求的本地时刻
   * @param recvAt 宿主收到响应的本地时刻
   */
  function sync(serverNowMs, sentAt, recvAt) {
    var srv = Number(serverNowMs);
    var t0 = Number(sentAt);
    var t1 = Number(recvAt);
    if (!isFinite(srv) || !isFinite(t0) || !isFinite(t1)) return;
    if (srv <= 0 || t1 < t0) return;

    var rtt = t1 - t0;
    /* 响应大致反映的是请求飞到一半时的服务端状态 */
    var offset = srv - (t0 + rtt / 2);

    if (!state.synced) {
      state.offsetMs = offset;
      state.bestRtt = rtt;
      state.synced = true;
      return;
    }

    /* 设备时钟被人为改动：立刻跟上，不要慢慢逼近 */
    if (Math.abs(offset - state.offsetMs) > JUMP_MS) {
      state.offsetMs = offset;
      state.bestRtt = rtt;
      return;
    }

    /*
     * 只全盘采信往返更快的样本，慢样本的中点假设误差大。
     * 往返相当时做慢平滑，避免个别抖动把基准拽走导致倒计时跳秒。
     */
    if (rtt <= state.bestRtt) {
      state.bestRtt = rtt;
      state.offsetMs = offset;
    } else {
      state.offsetMs += (offset - state.offsetMs) * 0.1;
      state.bestRtt = state.bestRtt * 0.9 + rtt * 0.1;
    }
  }

  /** 按服务端的钟，现在几点 */
  function now() {
    return Date.now() + state.offsetMs;
  }

  /**
   * 服务端时刻 → 本地时刻。
   * setTimeout 只认本地钟，排程前先换算过去。
   */
  function toLocal(serverMs) {
    var t = Number(serverMs);
    return isFinite(t) ? t - state.offsetMs : NaN;
  }

  /** 客户端停止接单的时刻（仍是服务端时间基准） */
  function cutoffAt(lockAtMs) {
    var t = Number(lockAtMs);
    return isFinite(t) ? t - BET_CUTOFF_MS : NaN;
  }

  /** 距客户端停止接单还有多少毫秒；已过则为 0 */
  function remainMs(lockAtMs) {
    var t = cutoffAt(lockAtMs);
    if (!isFinite(t)) return 0;
    return Math.max(0, t - now());
  }

  /** 现在还能不能下注（只看时间，不含期号/相位等其他条件） */
  function canBet(lockAtMs) {
    var t = cutoffAt(lockAtMs);
    return isFinite(t) && now() < t;
  }

  global.LotteryClock = {
    sync: sync,
    now: now,
    toLocal: toLocal,
    cutoffAt: cutoffAt,
    remainMs: remainMs,
    canBet: canBet,
    BET_CUTOFF_MS: BET_CUTOFF_MS,
    /* 调试与自检用 */
    state: state,
    isSynced: function () { return state.synced; },
    getOffsetMs: function () { return state.offsetMs; },
  };
})(typeof window !== 'undefined' ? window : this);
