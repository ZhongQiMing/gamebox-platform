/**
 * 游戏页公共桥接（games-assets ↔ client-app）
 * 权威余额与扣派只在 server；本文件只缓存展示余额并转发下注请求。
 */
(function () {
  const VUE_ROUTE_MAP = [
    [/game-lobby|\/lobby\b|^\/lobby\b/, '/lobby'],
    [/cs\.html|pages\/cs|^\/cs\b/, '/cs'],
    [/bet-records|^\/bets\b/, '/bets'],
    [/recharge|^\/recharge\b/, '/recharge'],
    [/apply-records/, '/apply-records'],
    [/rebate\.html|pages\/rebate|^\/rebate\b/, '/rebate'],
    [/flow\.html|pages\/flow|^\/flow\b/, '/flow'],
    [/points-log/, '/points-log'],
    [/profile\.html|withdraw|^\/settings\b/, '/settings'],
    [/activities|^\/activities\b/, '/activities'],
    [/welfare/, '/rebate'],
  ]

  window.App = window.App || {}

  /* iPhone 长按图片和聊天气泡会出复制条。输入框除外。 */
  ;(function blockCallout() {
    const style = document.createElement('style')
    style.textContent = 'html,body,body *{-webkit-user-select:none;user-select:none;-webkit-touch-callout:none}input,textarea,[contenteditable="true"]{-webkit-user-select:text;user-select:text;-webkit-touch-callout:default}'
    document.head.appendChild(style)
    document.addEventListener('contextmenu', function (ev) {
      const t = ev.target
      if (t && t.closest && t.closest('input, textarea, [contenteditable="true"]')) return
      ev.preventDefault()
    }, true)
  })()

  /**
   * 单笔上下分上限，与 @gamebox/shared 的 PLAYER_FUND_MAX 一致。
   * 各游戏聊天室只卡了最低额，最高额原来要等服务端拒绝才知道；
   * 这里在共享层统一拦下，省一次往返，也免得 11 个游戏各写一份。
   */
  const FUND_MAX = 200000

  App.APP_NAME = '金御汇'
  App.NAME_PREFIX = ['黄金', '银河', '夜行', '闪电', '深海', '炽焰', '疾风', '幻影']
  App.NAME_SUFFIX = ['猎手', '行者', '骑士', '大师', '旅人', '王者', '武士', '侠客']

  /*
   * 壳层暂停时静音。
   *
   * 各游戏只在 document.hidden 时停 BGM，但玩家点返回回到大厅时，
   * 外层是 keep-alive，iframe 根本没卸载，标签页也还是可见的——hidden 一直是 false，
   * 于是游戏音乐会跟着人在大厅里继续放。各游戏的音频对象都是 new Audio() 建的，
   * 不在 DOM 里，选择器找不到，只能在共享层记下谁在播。
   *
   * 恢复时只重启循环轨（房间 BGM）。开奖音这类一次性音效停了就算了，
   * 隔几分钟回来再补播一段旧开奖声是错的。
   */
  var _liveMedia = []
  var _pausedByShell = []

  ;(function patchMediaPlay() {
    if (typeof HTMLMediaElement === 'undefined') return
    var origPlay = HTMLMediaElement.prototype.play
    if (!origPlay || origPlay.__gbTracked) return
    function trackedPlay() {
      if (_liveMedia.indexOf(this) < 0) _liveMedia.push(this)
      return origPlay.apply(this, arguments)
    }
    trackedPlay.__gbTracked = true
    HTMLMediaElement.prototype.play = trackedPlay
  })()

  function pauseMediaForShell() {
    _pausedByShell = []
    /*
     * 短音效是每次 new Audio() 现建的，放完就没人再引用了。
     * 这里顺手把放完的、以及被游戏 src='' 停掉的节点丢出数组，
     * 否则玩一晚上会攒下几百个节点一直被这里引着。
     */
    var keep = []
    for (var i = 0; i < _liveMedia.length; i++) {
      var el = _liveMedia[i]
      if (!el) continue
      var reusable = false
      try {
        reusable = !!el.loop || (!el.ended && !!el.src)
      } catch (e) { /* 取不到属性就当它已经废了 */ }
      if (!reusable) continue
      keep.push(el)
      try {
        if (el.paused) continue
        _pausedByShell.push(el)
        el.pause()
      } catch (e2) { /* ignore */ }
    }
    _liveMedia = keep
  }

  function resumeMediaForShell() {
    var list = _pausedByShell
    _pausedByShell = []
    for (var i = 0; i < list.length; i++) {
      var el = list[i]
      if (!el || !el.loop) continue
      try {
        var p = el.play()
        if (p && p.catch) p.catch(function () { /* 自动播放被拦就算了 */ })
      } catch (e) { /* ignore */ }
    }
  }

  /*
   * 切后台/锁屏也要静音。
   * 彩票几个游戏各自按 document.hidden 停了 BGM，但四个牌桌游戏的
   * visibilitychange 只清筹码飞行层，音乐会在后台一直放。共享层统一兜住，
   * 顺序上本文件先于各游戏脚本加载，重复 pause 是无害的。
   */
  document.addEventListener('visibilitychange', function () {
    if (document.hidden) pauseMediaForShell()
    else if (!App._shellPaused) resumeMediaForShell()
  })

  /** 大脑推送的展示余额（非 localStorage 账本） */
  App._balance = 0
  App._ready = false
  App._reqSeq = 0
  App._pending = Object.create(null)
  App._bridgeToken = ''
  App._roomNo = ''

  /*
   * 跨 Origin iframe 只接受 URL 中声明的父页 Origin，并且消息 source 必须是 window.parent。
   * 该值只决定消息投递目标，不承担授权；真正授权在父页按游戏 Origin + contentWindow 校验。
   */
  App.parentOrigin = (function () {
    try {
      const raw = new URLSearchParams(location.search).get('parentOrigin')
      if (!raw) return location.origin
      const parsed = new URL(raw)
      if (parsed.protocol === 'capacitor:') {
        return raw === 'capacitor://localhost' ? raw : location.origin
      }
      if (!/^https?:$/.test(parsed.protocol)) return location.origin
      return parsed.origin
    } catch (_) {
      return location.origin
    }
  })()

  App._user = null

  App.getUser = function () {
    if (App._user && App._user.uid) return App._user
    try {
      const raw = localStorage.getItem('gamebox_user')
      if (raw) {
        const u = JSON.parse(raw)
        if (u && u.uid) return u
      }
    } catch (_) { /* ignore */ }
    return {
      uid: '',
      name: '玩家',
      avatar: '/images/avatars/001.jpg',
    }
  }

  App.setUser = function (user) {
    App._user = user
    try {
      localStorage.setItem('gamebox_user', JSON.stringify(user))
    } catch (_) { /* iPhone 里游戏页经常写不进本地存储，认人改走内存 */ }
  }

  /** 只读缓存；uid 参数保留兼容，忽略 */
  App.getBalance = function (/* uid */) {
    return App._balance
  }

  /**
   * 禁止游戏写账。旧代码调用将被忽略。
   * 余额只能由父页 assets-game-balance / init 更新。
   */
  App.setBalance = function (/* uid, val */) {
    if (typeof console !== 'undefined' && console.warn) {
      console.warn('[App] setBalance 已禁用：积分只由 server 记账')
    }
  }

  App.adjustBalance = function (/* uid, delta */) {
    if (typeof console !== 'undefined' && console.warn) {
      console.warn('[App] adjustBalance 已禁用：积分只由 server 记账')
    }
    return App._balance
  }

  App.applyServerBalance = function (bal) {
    var n = Math.round((Number(bal) || 0) * 100) / 100
    if (!isFinite(n) || n < 0) n = 0
    App._balance = n
    App._ready = true
    try {
      window.dispatchEvent(new CustomEvent('gamebox-balance', { detail: { balance: App._balance } }))
    } catch (_) { /* ignore */ }
  }

  function postToParent(payload) {
    if (window.parent && window.parent !== window) {
      if (App._bridgeToken && payload && typeof payload === 'object' && !payload.bridgeToken) {
        payload.bridgeToken = App._bridgeToken
      }
      window.parent.postMessage(payload, App.parentOrigin)
      return true
    }
    return false
  }
  App.postToParent = postToParent

  function nextRequestId() {
    App._reqSeq += 1
    return 'r' + Date.now() + '_' + App._reqSeq
  }

  /**
   * 向大脑下彩票注（可多注，父页走 bet-batch 事务）。
   * bets: [{ betType, betValue?, amount }]
   * 未完成前拒绝新请求，防止连点重复提交。
   */
  var _lotteryBetBusy = null
  App.placeLotteryBets = function (gameCode, bets, extra) {
    if (_lotteryBetBusy) {
      return Promise.reject(new Error('下注处理中'))
    }
    _lotteryBetBusy = new Promise(function (resolve, reject) {
      if (!gameCode || !bets || !bets.length) {
        reject(new Error('下注参数无效'))
        return
      }
      const requestId = nextRequestId()
      const timer = setTimeout(function () {
        delete App._pending[requestId]
        reject(new Error('下注超时，请重试'))
      }, 20000)
      App._pending[requestId] = {
        resolve: function (data) {
          clearTimeout(timer)
          resolve(data)
        },
        reject: function (err) {
          clearTimeout(timer)
          reject(err)
        },
      }
      const roomNo = (extra && extra.roomNo) || App.getRoomNo()
      const ok = postToParent({
        type: 'assets-game-bet',
        requestId: requestId,
        kind: 'lottery',
        gameCode: gameCode,
        bets: bets,
        roomNo: roomNo || '',
        chatText: (extra && extra.chatText) || '',
      })
      if (!ok) {
        clearTimeout(timer)
        delete App._pending[requestId]
        reject(new Error('请从大厅进入游戏'))
      }
    }).finally(function () {
      _lotteryBetBusy = null
    })
    return _lotteryBetBusy
  }

  App.getRoomNo = function () {
    if (App._roomNo) return String(App._roomNo)
    try {
      const q = new URLSearchParams(location.search || '')
      const n = (q.get('roomNo') || '').trim()
      if (/^\d{6}$/.test(n)) {
        App._roomNo = n
        return n
      }
    } catch (_) { /* ignore */ }
    return ''
  }

  /*
   * 外壳（Vue 侧 AssetsGameView）把游戏页 keep-alive 起来后，玩家退回大厅时
   * iframe 并不卸载。此时浏览器仍在前台，document.hidden 是 false，游戏自己
   * 判断不出已经离开，轮询会一直打下去。父页会发 assets-game-pause/resume，
   * 这里用一个全局开关统一控制所有 adaptive 轮询。
   */
  App._shellPaused = false
  App._shellWakes = new Set()

  /**
   * 前台 activeMs / 后台 hiddenMs 自适应轮询；切回前台立即跑一轮。
   * opts.runNow === false 时不立刻执行（适合已手动跑过首轮）。
   * 返回 { stop() }
   */
  App.startAdaptiveInterval = function (fn, activeMs, hiddenMs, opts) {
    activeMs = Math.max(500, Number(activeMs) || 2000)
    hiddenMs = Math.max(activeMs, Number(hiddenMs) || 5000)
    const runNow = !(opts && opts.runNow === false)
    let timer = null
    let stopped = false
    function delay() {
      try {
        return document.hidden ? hiddenMs : activeMs
      } catch (_) {
        return activeMs
      }
    }
    function tick() {
      /* 外壳把本页挂起了（玩家回大厅了），别再打接口 */
      if (App._shellPaused) return
      try { fn() } catch (_) { /* ignore */ }
    }
    function schedule() {
      if (stopped) return
      if (timer) clearTimeout(timer)
      timer = setTimeout(function () {
        timer = null
        if (stopped) return
        tick()
        schedule()
      }, delay())
    }
    function onVis() {
      if (stopped) return
      if (!document.hidden) {
        tick()
        schedule()
      }
    }
    try {
      document.addEventListener('visibilitychange', onVis)
    } catch (_) { /* ignore */ }
    /* 外壳 resume 时立刻补一轮，不用干等一个 activeMs */
    const wake = function () {
      if (stopped) return
      tick()
      schedule()
    }
    App._shellWakes.add(wake)
    if (runNow) tick()
    schedule()
    return {
      stop: function () {
        stopped = true
        if (timer) clearTimeout(timer)
        timer = null
        App._shellWakes.delete(wake)
        try { document.removeEventListener('visibilitychange', onVis) } catch (_) { /* ignore */ }
      },
    }
  }

  /** 房间公共聊天：afterId 空=最近 limit 条；有值=增量 */
  App.fetchRoomChat = function (opts) {
    return new Promise(function (resolve, reject) {
      const gameCode = opts && opts.gameCode
      if (!gameCode) {
        reject(new Error('游戏参数无效'))
        return
      }
      const requestId = nextRequestId()
      const timer = setTimeout(function () {
        delete App._pending[requestId]
        reject(new Error('拉取聊天超时'))
      }, 12000)
      App._pending[requestId] = {
        resolve: function (data) {
          clearTimeout(timer)
          resolve(data)
        },
        reject: function (err) {
          clearTimeout(timer)
          reject(err)
        },
      }
      const ok = postToParent({
        type: 'assets-game-room-chat',
        requestId: requestId,
        gameCode: gameCode,
        afterId: (opts && opts.afterId) || '',
        limit: (opts && opts.limit) || 50,
        roomNo: App.getRoomNo() || '',
      })
      if (!ok) {
        clearTimeout(timer)
        delete App._pending[requestId]
        reject(new Error('请从大厅进入游戏'))
      }
    })
  }

  /**
   * 拉取大脑当前期 + 历史开奖
   * resolve: { current, history }
   */
  App.fetchLotterySnapshot = function (gameCode) {
    return new Promise(function (resolve, reject) {
      if (!gameCode) {
        reject(new Error('游戏参数无效'))
        return
      }
      const requestId = nextRequestId()
      const timer = setTimeout(function () {
        delete App._pending[requestId]
        reject(new Error('同步开奖超时'))
      }, 6000)
      App._pending[requestId] = {
        resolve: function (data) {
          clearTimeout(timer)
          resolve(data)
        },
        reject: function (err) {
          clearTimeout(timer)
          reject(err)
        },
      }
      const ok = postToParent({
        type: 'assets-game-lottery-snapshot',
        requestId: requestId,
        gameCode: gameCode,
      })
      if (!ok) {
        clearTimeout(timer)
        delete App._pending[requestId]
        reject(new Error('请从大厅进入游戏'))
      }
    })
  }

  /** 活跃赔率表（与结算同一份） */
  App.fetchLotteryPayTable = function (gameCode) {
    return new Promise(function (resolve, reject) {
      if (!gameCode) {
        reject(new Error('游戏参数无效'))
        return
      }
      const requestId = nextRequestId()
      const timer = setTimeout(function () {
        delete App._pending[requestId]
        reject(new Error('拉取赔率超时'))
      }, 12000)
      App._pending[requestId] = {
        resolve: function (data) {
          clearTimeout(timer)
          resolve(data)
        },
        reject: function (err) {
          clearTimeout(timer)
          reject(err)
        },
      }
      const ok = postToParent({
        type: 'assets-game-lottery-paytable',
        requestId: requestId,
        gameCode: gameCode,
      })
      if (!ok) {
        clearTimeout(timer)
        delete App._pending[requestId]
        reject(new Error('请从大厅进入游戏'))
      }
    })
  }

  App.filterLotteryBetsByIssue = function (list, issueNo) {
    const want = String(issueNo || '')
    if (!want) return []
    return (list || []).filter(function (b) {
      if (!b || b.status === 'CANCELLED') return false
      const no = b.issue && b.issue.issueNo != null ? String(b.issue.issueNo) : ''
      return no === want
    })
  }

  /** 本人某期注单（真实账本） */
  App.fetchMyLotteryBets = function (gameCode, issueNo) {
    return new Promise(function (resolve, reject) {
      if (!gameCode) {
        reject(new Error('游戏参数无效'))
        return
      }
      if (!issueNo) {
        reject(new Error('缺少期号'))
        return
      }
      const requestId = nextRequestId()
      const timer = setTimeout(function () {
        delete App._pending[requestId]
        reject(new Error('拉取注单超时'))
      }, 12000)
      App._pending[requestId] = {
        resolve: function (data) {
          clearTimeout(timer)
          const raw = (data && data.list) || []
          resolve({
            list: App.filterLotteryBetsByIssue(raw, issueNo),
            total: data && data.total != null ? data.total : raw.length,
            issueNo: issueNo,
          })
        },
        reject: function (err) {
          clearTimeout(timer)
          reject(err)
        },
      }
      const ok = postToParent({
        type: 'assets-game-lottery-mybets',
        requestId: requestId,
        gameCode: gameCode,
        issueNo: String(issueNo),
      })
      if (!ok) {
        clearTimeout(timer)
        delete App._pending[requestId]
        reject(new Error('请从大厅进入游戏'))
      }
    })
  }

  /** 等到本期注单结算完（或超时返回当前列表） */
  App.waitMyLotteryBetsSettled = function (gameCode, issueNo, maxTries) {
    const tries = maxTries == null ? 10 : maxTries
    return App.fetchMyLotteryBets(gameCode, issueNo).then(function (res) {
      const list = (res && res.list) || []
      const active = list.filter(function (b) { return b.status !== 'CANCELLED' })
      const pending = active.some(function (b) { return b.status === 'PENDING' })
      if (pending && tries > 0) {
        return new Promise(function (resolve) {
          setTimeout(function () {
            resolve(App.waitMyLotteryBetsSettled(gameCode, issueNo, tries - 1))
          }, 700)
        })
      }
      return res
    })
  }

  App.BET_TYPE_CN = {
    special: '特码', zhengma: '正码', big: '特码大', small: '特码小', odd: '特码单', even: '特码双',
    combo: '组合', color: '色波', temaZodiac: '特肖', pingZodiac: '一肖',
    heSide: '合数', weiSide: '特尾', sumSide: '总和', sumTail: '总尾',
    weiShu: '尾数', weiShuMiss: '尾不中', lianma: '连码', sxLian: '生肖连',
    wsLian: '尾数连', buZhong: '不中', liuxiao: '六肖',
    top2big: '冠亚大', top2small: '冠亚小', top2odd: '冠亚单', top2even: '冠亚双',
    gySum: '冠亚和', posSide: '名次两面', position: '定位', lhh: '龙虎',
    ballSide: '定位两面', anyDigit: '不定位', dragon: '龙', tiger: '虎', tie: '和',
    niu: '牛', niuSide: '牛两面', noNiu: '无牛', triplet: '豹子', pair: '二同',
    straight: '三连', alldiff: '三不同', long: '长牌', sum: '和值',
  }

  App.labelLotteryBet = function (b) {
    if (!b) return ''
    const payload = b.payload || {}
    const type = b.betType || payload.betType || ''
    let val = payload.value != null ? String(payload.value) : ''
    const cn = (App.BET_TYPE_CN && App.BET_TYPE_CN[type]) || type
    const digit5Pos = ['万', '千', '百', '十', '个']
    const sideCn = { big: '大', small: '小', odd: '单', even: '双' }
    if (!val) return cn
    if (val.charAt(0) === '{') {
      try {
        const j = JSON.parse(val)
        if (j.play && j.nums) return String(j.play) + ' ' + [].concat(j.nums).join(',')
        if (j.zodiacs) return cn + ' ' + [].concat(j.zodiacs).join('')
        if (j.tails) return cn + ' ' + [].concat(j.tails).join(',')
        if (j.nums) return cn + ' ' + [].concat(j.nums).join(',')
        if (j.hit != null && j.zodiacs) return cn + (j.hit ? '中' : '不中') + ' ' + [].concat(j.zodiacs).join('')
      } catch (e) { /* ignore */ }
    }
    if (type === 'special' || type === 'zhengma') {
      const n = parseInt(val, 10)
      if (n >= 1 && n <= 49) return cn + String(n).padStart(2, '0')
    }
    if (type === 'color') return val + '波'
    if (type === 'gySum') return cn + val
    if (type === 'posSide' && val.indexOf(':') >= 0) {
      const racePos = ['冠军', '亚军', '季军', '第四名', '第五名', '第六名', '第七名', '第八名', '第九名', '第十名']
      const parts = val.split(':')
      const pos = Number(parts[0])
      return (racePos[pos] || parts[0]) + (sideCn[parts[1]] || parts[1] || '')
    }
    if (type === 'ballSide' && val.indexOf(':') >= 0) {
      const parts = val.split(':')
      return (digit5Pos[Number(parts[0])] || parts[0]) + (sideCn[parts[1]] || parts[1] || '')
    }
    if (type === 'position' && val.indexOf(':') >= 0) {
      const parts = val.split(':')
      const pos = Number(parts[0])
      const racePos = ['冠军', '亚军', '季军', '第四名', '第五名', '第六名', '第七名', '第八名', '第九名', '第十名']
      if (pos >= 0 && pos <= 9 && /^(10|[1-9])$/.test(String(parts[1] || ''))) {
        return (racePos[pos] || parts[0]) + parts[1]
      }
      if (pos >= 0 && pos <= 4) return (digit5Pos[pos] || parts[0]) + parts[1]
      return cn + ' ' + val
    }
    if (type === 'lhh') {
      const m = val.match(/^([0-9]):([0-9]):(龙|虎)$/)
      if (m) {
        const pairs = [[0, 9], [1, 8], [2, 7], [3, 6], [4, 5]]
        const a = Number(m[1])
        const b = Number(m[2])
        const pick = m[3]
        for (let i = 0; i < pairs.length; i++) {
          if (pairs[i][0] === a && pairs[i][1] === b) return String(i + 1) + pick
        }
        return String(a + 1) + '-' + String(b + 1) + pick
      }
      return val || '龙虎'
    }
    if (type === 'niu') {
      const n = Number(val)
      if (n === -1) return '无牛'
      if (n === 10) return '牛牛'
      if (n >= 1 && n <= 9) return '牛' + n
      return cn + ' ' + val
    }
    if (type === 'niuSide') return '牛' + val
    if (type === 'anyDigit' && val.indexOf(':') >= 0) {
      const parts = val.split(':')
      return parts[0] + parts[1]
    }
    if ((type === 'group3' || type === 'group6' || type === 'shape') && val.indexOf(':') >= 0) {
      const parts = val.split(':')
      const tag = type === 'group3' ? '组三' : (type === 'group6' ? '组六' : '')
      return parts[0] + tag + String(parts[1] || '').replace(/,/g, '')
    }
    if (type === 'posSide' || type === 'position' || type === 'lhh') return cn + ' ' + val
    return cn + (val ? (' ' + val) : '')
  }

  /** 按玩法汇总：[{ key, label, count, amount }] */
  App.groupLotteryBetsByType = function (list) {
    const map = {}
    ;(list || []).forEach(function (b) {
      if (!b || b.status === 'CANCELLED') return
      const type = b.betType || (b.payload && b.payload.betType) || 'other'
      if (!map[type]) {
        map[type] = {
          key: type,
          label: (App.BET_TYPE_CN && App.BET_TYPE_CN[type]) || type,
          count: 0,
          amount: 0,
        }
      }
      map[type].count += 1
      map[type].amount += Number(b.amount) || 0
    })
    return Object.keys(map).map(function (k) { return map[k] })
  }

  App.isLotteryBetWon = function (b) {
    return !!(b && (b.status === 'WON' || (Number(b.payout) || 0) > 0))
  }

  /**
   * 牌桌挂单下注（下注阶段扣分，封盘后整局结算）
   * { side, amount } → { balance, roundNo, pending: true }
   * 连点排队串行；同一意图固定 clientKey，超时自动重试同键（配合服务端 DB 幂等防双扣）。
   */
  var _tableBetQueue = []
  var _tableBetBusy = false
  /** 最近一次失败/超时：同向同额 30s 内再点复用 key，避免「以为失败又点」双扣 */
  var _tableLastFail = null

  function _newTableClientKey() {
    return (
      'tb_' +
      Date.now().toString(36) +
      '_' +
      Math.random().toString(36).slice(2, 10)
    )
  }

  function _flushTableBetQueue() {
    if (_tableBetBusy) return
    var job = _tableBetQueue.shift()
    if (!job) return
    _tableBetBusy = true
    var key = job.clientKey
    var attempts = 0
    var maxAttempts = 3

    function finishFail(err) {
      _tableBetBusy = false
      _tableLastFail = {
        gameCode: job.gameCode,
        side: job.side,
        amount: job.amount,
        clientKey: key,
        at: Date.now(),
      }
      job.reject(err)
      _flushTableBetQueue()
    }

    function sendOnce() {
      attempts += 1
      var requestId = nextRequestId()
      var timer = setTimeout(function () {
        delete App._pending[requestId]
        if (attempts < maxAttempts) {
          sendOnce()
          return
        }
        finishFail(new Error('下注超时，请重试'))
      }, 15000)
      App._pending[requestId] = {
        resolve: function (data) {
          clearTimeout(timer)
          _tableBetBusy = false
          _tableLastFail = null
          job.resolve(data)
          _flushTableBetQueue()
        },
        reject: function (err) {
          clearTimeout(timer)
          /* 业务错误不自动重试；超时已在 timer 里处理 */
          finishFail(err instanceof Error ? err : new Error(String(err || '下注失败')))
        },
      }
      var ok = postToParent({
        type: 'assets-game-bet',
        requestId: requestId,
        kind: 'table',
        gameCode: job.gameCode,
        side: job.side,
        amount: job.amount,
        clientKey: key,
        roomNo: App.getRoomNo() || '',
      })
      if (!ok) {
        clearTimeout(timer)
        delete App._pending[requestId]
        finishFail(new Error('请从大厅进入游戏'))
      }
    }

    sendOnce()
  }

  App.placeTableBet = function (gameCode, side, amount, clientKey) {
    return new Promise(function (resolve, reject) {
      if (!gameCode || !side || !(amount > 0)) {
        reject(new Error('下注参数无效'))
        return
      }
      /* 排队上限：防止异常连点撑爆队列 */
      if (_tableBetQueue.length >= 40) {
        reject(new Error('下注排队过多，请稍候'))
        return
      }
      var key = clientKey && String(clientKey).trim()
      if (
        !key &&
        _tableLastFail &&
        _tableLastFail.gameCode === gameCode &&
        _tableLastFail.side === side &&
        Number(_tableLastFail.amount) === Number(amount) &&
        Date.now() - _tableLastFail.at < 30000
      ) {
        key = _tableLastFail.clientKey
      }
      if (!key || key.length < 8) key = _newTableClientKey()
      if (key.length > 64) key = key.slice(0, 64)
      _tableBetQueue.push({
        gameCode: gameCode,
        side: side,
        amount: amount,
        clientKey: key,
        resolve: resolve,
        reject: reject,
      })
      _flushTableBetQueue()
    })
  }

  /** 拉取牌桌快照：相位 / 倒计时 / 本局 outcome / 公平承诺 */
  App.fetchTableSnapshot = function (gameCode) {
    return new Promise(function (resolve, reject) {
      if (!gameCode) {
        reject(new Error('游戏参数无效'))
        return
      }
      const requestId = nextRequestId()
      const timer = setTimeout(function () {
        delete App._pending[requestId]
        reject(new Error('桌台状态超时'))
      }, 12000)
      App._pending[requestId] = {
        resolve: function (data) {
          clearTimeout(timer)
          resolve((data && data.snapshot) || data || {})
        },
        reject: function (err) {
          clearTimeout(timer)
          reject(err)
        },
      }
      const ok = postToParent({
        type: 'assets-game-table-snapshot',
        requestId: requestId,
        gameCode: gameCode,
      })
      if (!ok) {
        clearTimeout(timer)
        delete App._pending[requestId]
        reject(new Error('请从大厅进入游戏'))
      }
    })
  }

  /** 撤销本局我的全部挂单；服务端只在下注期受理 */
  App.cancelTableBets = function (gameCode) {
    return new Promise(function (resolve, reject) {
      if (!gameCode) {
        reject(new Error('游戏参数无效'))
        return
      }
      const requestId = nextRequestId()
      const timer = setTimeout(function () {
        delete App._pending[requestId]
        reject(new Error('撤销超时，请查看余额后重试'))
      }, 12000)
      App._pending[requestId] = {
        resolve: function (data) {
          clearTimeout(timer)
          resolve(data || {})
        },
        reject: function (err) {
          clearTimeout(timer)
          reject(err)
        },
      }
      const ok = postToParent({
        type: 'assets-game-table-cancel',
        requestId: requestId,
        gameCode: gameCode,
      })
      if (!ok) {
        clearTimeout(timer)
        delete App._pending[requestId]
        reject(new Error('请从大厅进入游戏'))
      }
    })
  }

  /** 赔率单源（与服务端结算同源） */
  App.fetchTablePayTable = function (gameCode) {
    return new Promise(function (resolve, reject) {
      if (!gameCode) {
        reject(new Error('游戏参数无效'))
        return
      }
      const requestId = nextRequestId()
      const timer = setTimeout(function () {
        delete App._pending[requestId]
        reject(new Error('赔率表超时'))
      }, 12000)
      App._pending[requestId] = {
        resolve: function (data) {
          clearTimeout(timer)
          resolve((data && data.payTable) || data || {})
        },
        reject: function (err) {
          clearTimeout(timer)
          reject(err)
        },
      }
      const ok = postToParent({
        type: 'assets-game-table-paytable',
        requestId: requestId,
        gameCode: gameCode,
      })
      if (!ok) {
        clearTimeout(timer)
        delete App._pending[requestId]
        reject(new Error('请从大厅进入游戏'))
      }
    })
  }

  /** 可证明公平核验 */
  App.fetchTableVerify = function (gameCode, roundNo) {
    return new Promise(function (resolve, reject) {
      if (!gameCode) {
        reject(new Error('游戏参数无效'))
        return
      }
      const requestId = nextRequestId()
      const timer = setTimeout(function () {
        delete App._pending[requestId]
        reject(new Error('验算超时'))
      }, 12000)
      App._pending[requestId] = {
        resolve: function (data) {
          clearTimeout(timer)
          resolve((data && data.result) || data || {})
        },
        reject: function (err) {
          clearTimeout(timer)
          reject(err)
        },
      }
      const ok = postToParent({
        type: 'assets-game-table-verify',
        requestId: requestId,
        gameCode: gameCode,
        roundNo: roundNo || '',
      })
      if (!ok) {
        clearTimeout(timer)
        delete App._pending[requestId]
        reject(new Error('请从大厅进入游戏'))
      }
    })
  }

  /**
   * 轮询直到进入 DRAWING/SETTLED 且带 outcome（封盘发牌）
   * opts.roundNo / expectedRoundNo：只接受指定局，避免切后台后吃到下一局
   */
  App.waitTableOutcome = function (gameCode, opts) {
    opts = opts || {}
    const timeoutMs = opts.timeoutMs || 20000
    const intervalMs = opts.intervalMs || 400
    const expectedRoundNo = opts.roundNo || opts.expectedRoundNo || null
    const started = Date.now()

    function matchFromHistory(snap) {
      if (!expectedRoundNo || !snap || !Array.isArray(snap.history)) return null
      for (var i = 0; i < snap.history.length; i++) {
        var h = snap.history[i]
        if (h && h.roundNo === expectedRoundNo && h.outcome) {
          return {
            roomId: snap.roomId,
            gameCode: snap.gameCode,
            phase: 'SETTLED',
            roundNo: h.roundNo,
            secondsLeft: 0,
            outcome: h.outcome,
            betSummary: snap.betSummary || {},
            history: snap.history,
          }
        }
      }
      return null
    }

    return new Promise(function (resolve, reject) {
      function tick() {
        App.fetchTableSnapshot(gameCode)
          .then(function (snap) {
            if (snap && snap.outcome && (snap.phase === 'DRAWING' || snap.phase === 'SETTLED')) {
              if (!expectedRoundNo || snap.roundNo === expectedRoundNo) {
                resolve(snap)
                return
              }
            }
            var fromHist = matchFromHistory(snap)
            if (fromHist) {
              resolve(fromHist)
              return
            }
            /* 已进入下一局 BETTING 且历史也没有目标局 → 错过 */
            if (
              expectedRoundNo &&
              snap &&
              snap.phase === 'BETTING' &&
              snap.roundNo &&
              snap.roundNo !== expectedRoundNo
            ) {
              reject(new Error('本局开奖已过，请以下一局为准'))
              return
            }
            if (Date.now() - started > timeoutMs) {
              reject(new Error('等待开奖超时'))
              return
            }
            setTimeout(tick, intervalMs)
          })
          .catch(function (err) {
            if (Date.now() - started > timeoutMs) {
              reject(err)
              return
            }
            setTimeout(tick, intervalMs)
          })
      }
      tick()
    })
  }

  /** 拉取本局（或指定 roundNo）我的挂单与派彩合计 */
  App.fetchMyTableBets = function (gameCode, roundNo) {
    return new Promise(function (resolve, reject) {
      if (!gameCode) {
        reject(new Error('游戏参数无效'))
        return
      }
      const requestId = nextRequestId()
      const timer = setTimeout(function () {
        delete App._pending[requestId]
        reject(new Error('注单查询超时'))
      }, 12000)
      App._pending[requestId] = {
        resolve: function (data) {
          clearTimeout(timer)
          resolve((data && data.result) || data || {})
        },
        reject: function (err) {
          clearTimeout(timer)
          reject(err)
        },
      }
      const ok = postToParent({
        type: 'assets-game-table-my-bets',
        requestId: requestId,
        gameCode: gameCode,
        roundNo: roundNo || '',
      })
      if (!ok) {
        clearTimeout(timer)
        delete App._pending[requestId]
        reject(new Error('请从大厅进入游戏'))
      }
    })
  }

  /**
   * 取消当前期彩票全部未结算注单并退款
   */
  App.cancelLotteryBets = function (gameCode) {
    return new Promise(function (resolve, reject) {
      if (!gameCode) {
        reject(new Error('游戏参数无效'))
        return
      }
      const requestId = nextRequestId()
      const timer = setTimeout(function () {
        delete App._pending[requestId]
        reject(new Error('取消超时，请重试'))
      }, 15000)
      App._pending[requestId] = {
        resolve: function (data) {
          clearTimeout(timer)
          resolve(data)
        },
        reject: function (err) {
          clearTimeout(timer)
          reject(err)
        },
      }
      const ok = postToParent({
        type: 'assets-game-cancel',
        requestId: requestId,
        gameCode: gameCode,
      })
      if (!ok) {
        clearTimeout(timer)
        delete App._pending[requestId]
        reject(new Error('请从大厅进入游戏'))
      }
    })
  }

  /**
   * 申请上分（建单，同步客服；不扣余额）
   */
  App.requestTopup = function (amount, channel) {
    return new Promise(function (resolve, reject) {
      const amt = Math.floor(Number(amount) || 0)
      if (!(amt > 0)) {
        reject(new Error('上分金额无效'))
        return
      }
      if (amt > FUND_MAX) {
        reject(new Error('单笔上分不超过 ' + FUND_MAX))
        return
      }
      const requestId = nextRequestId()
      const timer = setTimeout(function () {
        delete App._pending[requestId]
        reject(new Error('上分申请超时，请重试'))
      }, 15000)
      App._pending[requestId] = {
        resolve: function (data) {
          clearTimeout(timer)
          resolve(data)
        },
        reject: function (err) {
          clearTimeout(timer)
          reject(err)
        },
      }
      const ok = postToParent({
        type: 'assets-game-topup',
        requestId: requestId,
        amount: amt,
        channel: channel || '人工',
      })
      if (!ok) {
        clearTimeout(timer)
        delete App._pending[requestId]
        reject(new Error('请从大厅进入游戏'))
      }
    })
  }

  /**
   * 申请下分（立即扣余额，待客服审核）
   */
  App.requestWithdraw = function (amount) {
    return new Promise(function (resolve, reject) {
      const amt = Math.floor(Number(amount) || 0)
      if (!(amt > 0)) {
        reject(new Error('下分金额无效'))
        return
      }
      if (amt > FUND_MAX) {
        reject(new Error('单笔下分不超过 ' + FUND_MAX))
        return
      }
      const requestId = nextRequestId()
      const timer = setTimeout(function () {
        delete App._pending[requestId]
        reject(new Error('下分申请超时，请重试'))
      }, 15000)
      App._pending[requestId] = {
        resolve: function (data) {
          clearTimeout(timer)
          resolve(data)
        },
        reject: function (err) {
          clearTimeout(timer)
          reject(err)
        },
      }
      const ok = postToParent({
        type: 'assets-game-withdraw',
        requestId: requestId,
        amount: amt,
      })
      if (!ok) {
        clearTimeout(timer)
        delete App._pending[requestId]
        reject(new Error('请从大厅进入游戏'))
      }
    })
  }

  /** 向父页拉取最新余额 */
  App.refreshBalance = function () {
    const requestId = nextRequestId()
    return new Promise(function (resolve) {
      const timer = setTimeout(function () {
        delete App._pending[requestId]
        resolve(App._balance)
      }, 8000)
      App._pending[requestId] = {
        resolve: function (data) {
          clearTimeout(timer)
          resolve(data && (typeof data.balance === 'number' || (typeof data.balance === 'string' && data.balance !== '')) ? Number(data.balance) : App._balance)
        },
        reject: function () {
          clearTimeout(timer)
          resolve(App._balance)
        },
      }
      if (!postToParent({ type: 'assets-game-get-balance', requestId: requestId })) {
        clearTimeout(timer)
        delete App._pending[requestId]
        resolve(App._balance)
      }
    })
  }

  /*
   * 玩家回水比例（小数，0.018 = 1.8%）。
   *
   * 以前每个游戏都写死 0.005，管理端配了多少都跟游戏里显示的对不上；
   * 现在统一问大脑要。拉不到时返回 null，调用方自己决定是不显示还是显示占位，
   * 绝不要再退回一个写死的数字——宁可不显示，也不能显示一个假的点数。
   */
  App._rebateRate = Object.create(null)
  /** 本局游戏的服务端 code，由 assets-game-init 带下来 */
  App._gameCode = ''

  App.fetchRebateRate = function (gameCode) {
    const code = String(gameCode || App._gameCode || '')
    if (Object.prototype.hasOwnProperty.call(App._rebateRate, code)) {
      return Promise.resolve(App._rebateRate[code])
    }
    const requestId = nextRequestId()
    return new Promise(function (resolve) {
      const timer = setTimeout(function () {
        delete App._pending[requestId]
        resolve(null)
      }, 8000)
      App._pending[requestId] = {
        resolve: function (data) {
          clearTimeout(timer)
          const rate = data && typeof data.rate === 'number' && isFinite(data.rate)
            ? data.rate
            : null
          if (rate !== null) App._rebateRate[code] = rate
          resolve(rate)
        },
        reject: function () {
          clearTimeout(timer)
          resolve(null)
        },
      }
      if (!postToParent({ type: 'assets-game-rebate-rate', requestId: requestId, gameCode: code })) {
        clearTimeout(timer)
        delete App._pending[requestId]
        resolve(null)
      }
    })
  }

  /** 同步读已缓存的比例；没拉到过返回 null */
  App.getRebateRate = function (gameCode) {
    const code = String(gameCode || App._gameCode || '')
    return Object.prototype.hasOwnProperty.call(App._rebateRate, code)
      ? App._rebateRate[code]
      : null
  }

  /**
   * 本地统计面板用的回水累计额。
   * 比例还没拉到就记 0——顶栏少一个数总好过显示一个和实际到账对不上的数。
   */
  App.calcRebate = function (turnover, gameCode) {
    const rate = App.getRebateRate(gameCode)
    const amt = Number(turnover) || 0
    if (rate === null || !(amt > 0)) return 0
    return Math.round(amt * rate * 100) / 100
  }

  App.toast = function (msg) {
    let el = document.getElementById('app-toast')
    if (!el) {
      el = document.createElement('div')
      el.id = 'app-toast'
      el.style.cssText = [
        'position:fixed', 'left:50%', 'bottom:80px', 'transform:translateX(-50%)',
        'z-index:9999', 'padding:10px 18px', 'border-radius:8px',
        'background:rgba(26,20,13,0.95)', 'border:1px solid rgba(212,175,55,0.35)',
        'color:#f5ecd6', 'font-size:14px', 'pointer-events:none',
        'opacity:0', 'transition:opacity 0.25s',
      ].join(';')
      document.body.appendChild(el)
    }
    el.textContent = String(msg || '')
    el.style.opacity = '1'
    clearTimeout(App._toastTimer)
    App._toastTimer = setTimeout(function () { el.style.opacity = '0' }, 2200)
  }

  App.resolveVuePath = function (url) {
    const s = String(url || '')
    for (let i = 0; i < VUE_ROUTE_MAP.length; i++) {
      const re = VUE_ROUTE_MAP[i][0]
      const path = VUE_ROUTE_MAP[i][1]
      if (re.test(s)) return path
    }
    return null
  }

  App.go = function (url) {
    const s = String(url || '')
    const vuePath = App.resolveVuePath(s)
    const qIdx = s.indexOf('?')
    const qs = qIdx >= 0 ? s.slice(qIdx) : ''
    if (vuePath && window.parent !== window) {
      postToParent({ type: 'assets-game-nav', path: vuePath + qs })
      return
    }
    if (vuePath) {
      location.href = vuePath + qs
      return
    }
    App.toast('该功能即将开放')
  }

  /** 游戏顶栏返回大厅（iframe 内专用，不依赖旧 html 路径解析） */
  App.backToLobby = function () {
    if (window.parent && window.parent !== window) {
      postToParent({ type: 'assets-game-nav', path: '/lobby' })
      return
    }
    location.href = '/lobby'
  }

  App.mountTabbar = function () { /* 游戏内不显示底部 Tab */ }

  window.addEventListener('message', function (ev) {
    if (!ev.origin || ev.origin !== App.parentOrigin || ev.source !== window.parent) return
    const data = ev.data
    if (!data || typeof data !== 'object') return

    if (data.type === 'assets-game-init') {
      if (data.bridgeToken) App._bridgeToken = String(data.bridgeToken)
      if (data.user && data.user.uid) App.setUser(data.user)
      if ((typeof data.balance === 'number' || (typeof data.balance === 'string' && data.balance !== ''))) App.applyServerBalance(data.balance)
      if (data.roomNo) App._roomNo = String(data.roomNo)
      App._gameCode = String(data.serverGameCode || data.gameCode || '')
      /* 顶栏「回水」要显示真实点数，进游戏就先要一次，结算时同步读缓存 */
      if (App._gameCode) {
        try { App.fetchRebateRate(App._gameCode) } catch (_) { /* ignore */ }
      }
      App._bridgeReady = true
      if (typeof App.onAssetsGameReady === 'function') {
        try { App.onAssetsGameReady(data) } catch (_) { /* ignore */ }
      }
      /* 进房后立刻重拉彩票快照，避免首轮在父页监听前发出而一直「同步中」 */
      if (typeof App.resyncLottery === 'function') {
        try { App.resyncLottery() } catch (_) { /* ignore */ }
      } else {
        /* lhc.js 等尚未执行完时先打标，脚本末尾看到后补拉 */
        App._pendingResyncLottery = true
      }
      return
    }

    /* 外壳 keep-alive 切回：iframe 内往往收不到 visibilitychange，靠父页通知重对开奖轴 */
    if (data.type === 'assets-game-resume') {
      App._shellPaused = false
      resumeMediaForShell()
      App._shellWakes.forEach(function (wake) {
        try { wake() } catch (_) { /* ignore */ }
      })
      if (typeof App.onAssetsGameResume === 'function') {
        try { App.onAssetsGameResume(data) } catch (_) { /* ignore */ }
      }
      if (typeof App.resyncLottery === 'function') {
        try { App.resyncLottery() } catch (_) { /* ignore */ }
      } else {
        App._pendingResyncLottery = true
      }
      return
    }

    if (data.type === 'assets-game-pause') {
      App._shellPaused = true
      pauseMediaForShell()
      if (typeof App.onAssetsGamePause === 'function') {
        try { App.onAssetsGamePause(data) } catch (_) { /* ignore */ }
      }
      return
    }

    if (data.type === 'assets-game-room-chat-ok') {
      const pending = data.requestId && App._pending[data.requestId]
      if (pending) {
        delete App._pending[data.requestId]
        pending.resolve(data.list || [])
      }
      return
    }

    if (data.type === 'assets-game-room-chat-err') {
      const pending = data.requestId && App._pending[data.requestId]
      if (pending) {
        delete App._pending[data.requestId]
        pending.reject(new Error(data.message || '拉取聊天失败'))
      }
      return
    }

    if (data.type === 'assets-game-balance') {
      if ((typeof data.balance === 'number' || (typeof data.balance === 'string' && data.balance !== ''))) App.applyServerBalance(data.balance)
      const pending = data.requestId && App._pending[data.requestId]
      if (pending) {
        delete App._pending[data.requestId]
        pending.resolve({ balance: App._balance })
      }
      return
    }

    if (data.type === 'assets-game-bet-ok') {
      if ((typeof data.balance === 'number' || (typeof data.balance === 'string' && data.balance !== ''))) App.applyServerBalance(data.balance)
      /* 扣款已成功但房间气泡写入失败时轻提示；注单核对仍以账本为准 */
      if (data.kind === 'lottery' && data.chatPosted === false && typeof App.toast === 'function') {
        App.toast('下注成功，房间消息同步失败，可刷新后查看')
      }
      const pending = data.requestId && App._pending[data.requestId]
      if (pending) {
        delete App._pending[data.requestId]
        pending.resolve(data)
      }
      return
    }

    if (data.type === 'assets-game-bet-err') {
      const pending = data.requestId && App._pending[data.requestId]
      if (pending) {
        delete App._pending[data.requestId]
        pending.reject(new Error(data.message || '下注失败'))
      } else if (data.message) {
        App.toast(data.message)
      }
      return
    }

    if (data.type === 'assets-game-table-snapshot-ok') {
      const pending = data.requestId && App._pending[data.requestId]
      if (pending) {
        delete App._pending[data.requestId]
        pending.resolve(data)
      }
      return
    }

    if (data.type === 'assets-game-table-cancel-ok') {
      if ((typeof data.balance === 'number' || (typeof data.balance === 'string' && data.balance !== ''))) App.applyServerBalance(data.balance)
      const pending = data.requestId && App._pending[data.requestId]
      if (pending) {
        delete App._pending[data.requestId]
        pending.resolve(data)
      }
      return
    }

    if (data.type === 'assets-game-table-cancel-err') {
      const pending = data.requestId && App._pending[data.requestId]
      if (pending) {
        delete App._pending[data.requestId]
        pending.reject(new Error(data.message || '撤销失败'))
      } else if (data.message) {
        App.toast(data.message)
      }
      return
    }

    if (data.type === 'assets-game-table-snapshot-err') {
      const pending = data.requestId && App._pending[data.requestId]
      if (pending) {
        delete App._pending[data.requestId]
        pending.reject(new Error(data.message || '桌台状态获取失败'))
      }
      return
    }

    if (data.type === 'assets-game-table-my-bets-ok') {
      const pending = data.requestId && App._pending[data.requestId]
      if (pending) {
        delete App._pending[data.requestId]
        pending.resolve(data)
      }
      return
    }

    if (data.type === 'assets-game-table-my-bets-err') {
      const pending = data.requestId && App._pending[data.requestId]
      if (pending) {
        delete App._pending[data.requestId]
        pending.reject(new Error(data.message || '注单查询失败'))
      }
      return
    }

    if (data.type === 'assets-game-table-paytable-ok') {
      const pending = data.requestId && App._pending[data.requestId]
      if (pending) {
        delete App._pending[data.requestId]
        pending.resolve(data)
      }
      return
    }

    if (data.type === 'assets-game-table-paytable-err') {
      const pending = data.requestId && App._pending[data.requestId]
      if (pending) {
        delete App._pending[data.requestId]
        pending.reject(new Error(data.message || '赔率表获取失败'))
      }
      return
    }

    if (data.type === 'assets-game-table-verify-ok') {
      const pending = data.requestId && App._pending[data.requestId]
      if (pending) {
        delete App._pending[data.requestId]
        pending.resolve(data)
      }
      return
    }

    if (data.type === 'assets-game-table-verify-err') {
      const pending = data.requestId && App._pending[data.requestId]
      if (pending) {
        delete App._pending[data.requestId]
        pending.reject(new Error(data.message || '验算失败'))
      }
      return
    }

    if (data.type === 'assets-game-lottery-snapshot-ok') {
      const pending = data.requestId && App._pending[data.requestId]
      if (pending) {
        delete App._pending[data.requestId]
        pending.resolve({
          current: data.current || null,
          history: data.history || [],
          /* 校时样本：服务端时刻 + 宿主侧收发时刻，游戏内据此算时钟偏移 */
          serverNow: data.serverNow,
          sentAt: data.sentAt,
          recvAt: data.recvAt,
        })
      }
      return
    }

    if (data.type === 'assets-game-lottery-snapshot-err') {
      const pending = data.requestId && App._pending[data.requestId]
      if (pending) {
        delete App._pending[data.requestId]
        pending.reject(new Error(data.message || '同步开奖失败'))
      }
      return
    }

    if (data.type === 'assets-game-rebate-rate-ok') {
      const pending = data.requestId && App._pending[data.requestId]
      if (pending) {
        delete App._pending[data.requestId]
        pending.resolve({ rate: data.rate })
      }
      return
    }

    if (data.type === 'assets-game-rebate-rate-err') {
      const pending = data.requestId && App._pending[data.requestId]
      if (pending) {
        delete App._pending[data.requestId]
        pending.reject(new Error(data.message || '拉取回水比例失败'))
      }
      return
    }

    if (data.type === 'assets-game-lottery-paytable-ok') {
      const pending = data.requestId && App._pending[data.requestId]
      if (pending) {
        delete App._pending[data.requestId]
        pending.resolve(data.payTable || {})
      }
      return
    }

    if (data.type === 'assets-game-lottery-paytable-err') {
      const pending = data.requestId && App._pending[data.requestId]
      if (pending) {
        delete App._pending[data.requestId]
        pending.reject(new Error(data.message || '拉取赔率失败'))
      }
      return
    }

    if (data.type === 'assets-game-lottery-mybets-ok') {
      const pending = data.requestId && App._pending[data.requestId]
      if (pending) {
        delete App._pending[data.requestId]
        pending.resolve({ list: data.list || [], total: data.total || 0, issueNo: data.issueNo || null })
      }
      return
    }

    if (data.type === 'assets-game-lottery-mybets-err') {
      const pending = data.requestId && App._pending[data.requestId]
      if (pending) {
        delete App._pending[data.requestId]
        pending.reject(new Error(data.message || '拉取注单失败'))
      }
      return
    }

    if (data.type === 'assets-game-cancel-ok') {
      if ((typeof data.balance === 'number' || (typeof data.balance === 'string' && data.balance !== ''))) App.applyServerBalance(data.balance)
      const pending = data.requestId && App._pending[data.requestId]
      if (pending) {
        delete App._pending[data.requestId]
        pending.resolve(data)
      }
      return
    }

    if (data.type === 'assets-game-cancel-err') {
      const pending = data.requestId && App._pending[data.requestId]
      if (pending) {
        delete App._pending[data.requestId]
        pending.reject(new Error(data.message || '取消失败'))
      } else if (data.message) {
        App.toast(data.message)
      }
      return
    }

    if (data.type === 'assets-game-topup-ok' || data.type === 'assets-game-withdraw-ok') {
      if ((typeof data.balance === 'number' || (typeof data.balance === 'string' && data.balance !== ''))) App.applyServerBalance(data.balance)
      const pending = data.requestId && App._pending[data.requestId]
      if (pending) {
        delete App._pending[data.requestId]
        pending.resolve(data)
      }
      return
    }

    if (data.type === 'assets-game-topup-err' || data.type === 'assets-game-withdraw-err') {
      const pending = data.requestId && App._pending[data.requestId]
      if (pending) {
        delete App._pending[data.requestId]
        pending.reject(new Error(data.message || '申请失败'))
      } else if (data.message) {
        App.toast(data.message)
      }
    }
  })

  /*
   * 顶栏四格数字固定按 999,999.00 留宽，右对齐。
   * 流水、回水在右列，小数最后一位贴住顶栏右缘，几十万以内小数点始终对齐。
   * 上了百万、格子装不下时，只把这一格数字从右边缩小，格子和另外三格不动。
   * 标题再长也先让位，不把数字挤出屏幕。
   */
  function fitLotteryStatsBar() {
    var stats = document.getElementById('statsBar')
    if (!stats || stats.getAttribute('data-gb-stats-fit') === '1') return
    if (/\b(bjl|zjh|dn|lhd)-stats\b/.test(stats.className || '')) return
    var head = stats.parentElement
    if (!head) return
    stats.setAttribute('data-gb-stats-fit', '1')

    function cells() {
      return stats.children || []
    }

    function slotWidth() {
      var probe = stats.querySelector('.v')
      if (!probe) return 0
      var pcs = getComputedStyle(probe)
      var sample = document.createElement('span')
      sample.textContent = '999,999.00'
      sample.style.position = 'absolute'
      sample.style.left = '-9999px'
      sample.style.top = '0'
      sample.style.visibility = 'hidden'
      sample.style.whiteSpace = 'nowrap'
      sample.style.font = pcs.font
      sample.style.fontWeight = pcs.fontWeight
      sample.style.fontSize = pcs.fontSize
      sample.style.fontFamily = pcs.fontFamily
      sample.style.letterSpacing = pcs.letterSpacing
      sample.style.fontVariantNumeric = 'tabular-nums'
      document.body.appendChild(sample)
      var w = Math.ceil(sample.getBoundingClientRect().width)
      document.body.removeChild(sample)
      return w
    }

    function measure() {
      if (typeof getComputedStyle !== 'function') return
      var slot = slotWidth()
      if (!(slot > 0)) return
      var list = cells()
      for (var i = 0; i < list.length; i++) {
        var cell = list[i]
        cell.style.gridTemplateColumns = 'max-content ' + slot + 'px'
        cell.style.width = 'max-content'
        cell.style.minWidth = '0'
        var v = cell.querySelector('.v')
        if (!v) continue
        v.style.display = 'block'
        v.style.width = slot + 'px'
        v.style.maxWidth = slot + 'px'
        v.style.textAlign = 'right'
        v.style.whiteSpace = 'nowrap'
        v.style.overflow = 'visible'
        v.style.transform = ''
        v.style.transformOrigin = 'right center'
        var textW = v.scrollWidth
        if (textW > slot + 1) {
          v.style.transform = 'scale(' + (slot / textW) + ')'
        }
      }
      stats.style.width = 'max-content'
      stats.style.maxWidth = 'none'
      stats.style.flex = '0 0 auto'
      stats.style.marginLeft = 'auto'
      stats.style.transform = ''

      for (var c = 0; c < head.children.length; c++) {
        if (head.children[c] === stats) continue
        head.children[c].style.flex = '1 1 auto'
        head.children[c].style.minWidth = '0'
      }
    }

    var pending = 0
    function schedule() {
      if (pending) return
      pending = window.requestAnimationFrame
        ? window.requestAnimationFrame(function () { pending = 0; measure() })
        : setTimeout(function () { pending = 0; measure() }, 16)
    }

    window.addEventListener('resize', schedule)
    if (document.fonts && document.fonts.ready && document.fonts.ready.then) {
      document.fonts.ready.then(schedule).catch(function () {})
    }
    if (window.MutationObserver) {
      new MutationObserver(schedule).observe(stats, { subtree: true, characterData: true, childList: true })
    }
    schedule()
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', fitLotteryStatsBar)
  } else {
    fitLotteryStatsBar()
  }

  // 通知父页：桥已就绪，请推送 init（token 在 init 回传后才有）
  if (window.parent && window.parent !== window) {
    try {
      postToParent({ type: 'assets-game-ready' })
    } catch (_) { /* ignore */ }
  }
})()
