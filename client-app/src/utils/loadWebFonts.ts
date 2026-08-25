/**
 * 异步挂载字体样式表，不让它挡在首屏前面。
 *
 * gamebox-fonts.css 是中文字体的分片表：500 条 @font-face、gzip 后仍有 160KB。
 * 它原本写在 <head> 里当普通 stylesheet，浏览器必须下完才肯渲染第一个像素——
 * 在大陆到香港这条单连接约 60KB/s 的线路上，实测阻塞 6 秒，用户看到的就是黑屏。
 *
 * 表里每条都带 font-display: swap，本来就允许「先用系统字体显示、字体到了再换」，
 * 所以把它挪到首屏之后加载没有任何副作用，只是把 6 秒黑屏换成一次字体切换。
 */
const FONT_CSS = '/fonts/gamebox-fonts.css'

export function loadWebFonts(href = FONT_CSS) {
  if (typeof document === 'undefined') return
  if (document.querySelector(`link[data-webfonts][href="${href}"]`)) return

  const link = document.createElement('link')
  link.rel = 'stylesheet'
  link.href = href
  link.setAttribute('data-webfonts', '')
  document.head.appendChild(link)
}

/** 等首屏画完再去取字体，避免和首屏资源抢那几条被限速的连接 */
export function loadWebFontsAfterPaint(href = FONT_CSS) {
  if (typeof window === 'undefined') return
  const start = () => window.setTimeout(() => loadWebFonts(href), 0)
  if (document.readyState === 'complete') start()
  else window.addEventListener('load', start, { once: true })
}
