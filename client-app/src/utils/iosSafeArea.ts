/**
 * 苹果全面屏的安全区。
 * 页面按 430 宽缩放时，系统有时不给 env(safe-area-inset-*)，
 * 灵动岛就会压住标题和返回键，底栏文字也会被 Home 条切掉。
 * 能读到系统值就用系统值，读不到再按机型补一份。
 */
export function installIosSafeArea(): void {
  const apply = () => {
    const root = document.documentElement
    const probe = document.createElement('div')
    probe.style.cssText =
      'position:fixed;visibility:hidden;pointer-events:none;padding-top:constant(safe-area-inset-top);padding-top:env(safe-area-inset-top);padding-bottom:constant(safe-area-inset-bottom);padding-bottom:env(safe-area-inset-bottom);'
    root.appendChild(probe)
    const cs = getComputedStyle(probe)
    const top = parseFloat(cs.paddingTop) || 0
    const bottom = parseFloat(cs.paddingBottom) || 0
    probe.remove()
    if (top > 0 || bottom > 0) {
      root.style.setProperty('--safe-top', `${top}px`)
      root.style.setProperty('--safe-bottom', `${bottom}px`)
      return
    }
    if (!/iPhone|iPad|iPod/.test(navigator.userAgent)) return
    const short = Math.min(window.screen.width, window.screen.height)
    const long = Math.max(window.screen.width, window.screen.height)
    if (long < 800 || short <= 0) return
    const layoutW = root.clientWidth || short
    const factor = layoutW / short
    const island = long >= 852 && short >= 393
    root.style.setProperty('--safe-top', `${Math.round((island ? 59 : 47) * factor)}px`)
    root.style.setProperty('--safe-bottom', `${Math.round(34 * factor)}px`)
  }
  apply()
  window.addEventListener('orientationchange', () => window.setTimeout(apply, 250))
}
