(function () {
  function hideNativeSplash() {
    try {
      var c = window.Capacitor
      var p = c && c.Plugins && c.Plugins.SplashScreen
      if (p && p.hide) p.hide()
    } catch (e) { /* 网页版没有这个插件，忽略 */ }
  }

  // 立刻收掉系统开屏，别用中间那枚皇冠把封面图挡住
  hideNativeSplash()

  function fadeIntro() {
    var el = document.getElementById('app-intro')
    if (!el) return
    el.classList.add('hide')
    setTimeout(function () { el.remove() }, 500)
  }

  var img = new Image()
  var done = false
  function once() {
    if (done) return
    done = true
    setTimeout(fadeIntro, 1100)
  }
  img.onload = once
  img.onerror = once
  img.src = '/images/app-intro.webp'
  setTimeout(once, 2500)
})()
