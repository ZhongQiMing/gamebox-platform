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

  App.APP_NAME = '金御汇'
  App.NAME_PREFIX = ['黄金', '银河', '夜行', '闪电', '深海', '炽焰', '疾风', '幻影']
  App.NAME_SUFFIX = ['猎手', '行者', '骑士', '大师', '旅人', '王者', '武士', '侠客']

  /** 大脑推送的展示余额（非 localStorage 账本） */
  App._balance = 0
  App._ready = false
  App._reqSeq = 0
  App._pending = Object.create(null)
  App._bridgeToken = ''
  App._roomNo = ''

  /* URL ?bt=：父页挂载 iframe 时下发，ready/返回前即可带上，减少 postMessage 竞态 */
  try {
    const q0 = new URLSearchParams(location.search || '')
    const bt0 = (q0.get('bt') || '').trim()
    if (bt0) App._bridgeToken = bt0
  } catch (_) { /* ignore */ }

  App.getUser = function () {

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
    localStorage.setItem('gamebox_user', JSON.stringify(user))
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
    App._balance = Math.max(0, Math.floor(Number(bal) || 0))
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
      window.parent.postMessage(payload, '*')
      return true
    }
    return false
  }

  function nextRequestId() {
    App._reqSeq += 1
    return 'r' + Date.now() + '_' + App._reqSeq
  }

  /**
   * 向大脑下彩票注（可多注，父页走 bet-batch 事务）。
   * bets: [{ betType, betValue?, amount }]
   */
  App.placeLotteryBets = function (gameCode, bets, extra) {
    return new Promise(function (resolve, reject) {
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
    })
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
    function schedule() {
      if (stopped) return
      if (timer) clearTimeout(timer)
      timer = setTimeout(function () {
        timer = null
        if (stopped) return
        try { fn() } catch (_) { /* ignore */ }
        schedule()
      }, delay())
    }
    function onVis() {
      if (stopped) return
      if (!document.hidden) {
        try { fn() } catch (_) { /* ignore */ }
        schedule()
      }
    }
    try {
      document.addEventListener('visibilitychange', onVis)
    } catch (_) { /* ignore */ }
    if (runNow) {
      try { fn() } catch (_) { /* ignore */ }
    }
    schedule()
    return {
      stop: function () {
        stopped = true
        if (timer) clearTimeout(timer)
        timer = null
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
   */
  var _tableBetInflight = 0
  App.placeTableBet = function (gameCode, side, amount, clientKey) {
    return new Promise(function (resolve, reject) {
      if (!gameCode || !side || !(amount > 0)) {
        reject(new Error('下注参数无效'))
        return
      }
      if (_tableBetInflight > 0) {
        reject(new Error('操作过快，请稍候'))
        return
      }
      _tableBetInflight += 1
      const key =
        clientKey ||
        ('tb_' +
          Date.now().toString(36) +
          '_' +
          Math.random().toString(36).slice(2, 8))
      const requestId = nextRequestId()
      const timer = setTimeout(function () {
        delete App._pending[requestId]
        _tableBetInflight = Math.max(0, _tableBetInflight - 1)
        reject(new Error('下注超时，请重试'))
      }, 15000)
      App._pending[requestId] = {
        resolve: function (data) {
          clearTimeout(timer)
          setTimeout(function () {
            _tableBetInflight = Math.max(0, _tableBetInflight - 1)
          }, 280)
          resolve(data)
        },
        reject: function (err) {
          clearTimeout(timer)
          _tableBetInflight = Math.max(0, _tableBetInflight - 1)
          reject(err)
        },
      }
      const ok = postToParent({
        type: 'assets-game-bet',
        requestId: requestId,
        kind: 'table',
        gameCode: gameCode,
        side: side,
        amount: amount,
        clientKey: key,
      })
      if (!ok) {
        clearTimeout(timer)
        delete App._pending[requestId]
        _tableBetInflight = Math.max(0, _tableBetInflight - 1)
        reject(new Error('请从大厅进入游戏'))
      }
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
          resolve(data && typeof data.balance === 'number' ? data.balance : App._balance)
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
    const data = ev.data
    if (!data || typeof data !== 'object') return

    if (data.type === 'assets-game-init') {
      if (data.bridgeToken) App._bridgeToken = String(data.bridgeToken)
      if (data.user && data.user.uid) App.setUser(data.user)
      if (typeof data.balance === 'number') App.applyServerBalance(data.balance)
      if (data.roomNo) App._roomNo = String(data.roomNo)
      if (typeof App.onAssetsGameReady === 'function') {
        try { App.onAssetsGameReady(data) } catch (_) { /* ignore */ }
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
      if (typeof data.balance === 'number') App.applyServerBalance(data.balance)
      const pending = data.requestId && App._pending[data.requestId]
      if (pending) {
        delete App._pending[data.requestId]
        pending.resolve({ balance: App._balance })
      }
      return
    }

    if (data.type === 'assets-game-bet-ok') {
      if (typeof data.balance === 'number') App.applyServerBalance(data.balance)
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
        pending.resolve({ current: data.current || null, history: data.history || [] })
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
      if (typeof data.balance === 'number') App.applyServerBalance(data.balance)
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
      if (typeof data.balance === 'number') App.applyServerBalance(data.balance)
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

  // 通知父页：桥已就绪，请推送 init（走 postToParent 以附带 URL bt）
  if (window.parent && window.parent !== window) {
    try {
      postToParent({ type: 'assets-game-ready' })
    } catch (_) { /* ignore */ }
  }
})()
