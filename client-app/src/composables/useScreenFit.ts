import { onBeforeUnmount, onMounted, type ComponentPublicInstance } from 'vue'

/** 再往下缩就不是「小一点」而是看不清了，宁可让它继续溢出 */
const MIN_SCALE = 0.62
/** 100vh 与实际可视高度之间常有 1~2px 取整差，不该触发缩放 */
const SLACK_PX = 2

function isTypingField(node: Element | null): boolean {
  if (!node) return false
  if (node instanceof HTMLElement && node.isContentEditable) return true
  return node.tagName === 'INPUT' || node.tagName === 'TEXTAREA' || node.tagName === 'SELECT'
}

/**
 * 单屏页面等比适配。
 *
 * 登录、注册这类页面按固定像素排版，外层是 min-height:100vh + overflow:hidden。
 * 屏幕一矮，多出来的部分被直接切掉——最先没的是最底下的按钮，而不是缩小。
 * 这里量出内容真实高度，超过一屏就整页等比缩到刚好放得下，排版比例不变。
 *
 * 用 transform 而不是 zoom：transform 不参与布局，scrollHeight 读到的始终是未缩放的
 * 真实高度，量一次就够，不必先还原再测；代价是布局高度不变，所以要补一段负边距，
 * 否则页面下方会多出一小截空白可滚区。
 *
 * 用法：`<div :ref="pageEl" class="page ...">`，样式里读 --screen-fit / --screen-fit-trim。
 */
export function useScreenFit() {
  let el: HTMLElement | null = null
  let frame = 0
  let observer: ResizeObserver | null = null

  function apply() {
    if (!el) return
    const natural = el.scrollHeight
    const available = document.documentElement.clientHeight
    if (!natural || !available) return

    if (natural <= available + SLACK_PX) {
      el.style.setProperty('--screen-fit', '1')
      el.style.setProperty('--screen-fit-trim', '0px')
      return
    }

    const scale = Math.max(available / natural, MIN_SCALE)
    el.style.setProperty('--screen-fit', scale.toFixed(4))
    /* 缩到底仍然放不下时保留滚动，别用负边距把内容锁死 */
    const trim = scale > MIN_SCALE ? Math.round(natural * (1 - scale)) : 0
    el.style.setProperty('--screen-fit-trim', `${-trim}px`)
  }

  function schedule() {
    /* 软键盘弹出会让可视高度骤降，这时重算会把整页缩成一团 */
    if (isTypingField(document.activeElement)) return
    cancelAnimationFrame(frame)
    frame = requestAnimationFrame(apply)
  }

  function bind(node: Element | ComponentPublicInstance | null) {
    const next = node instanceof HTMLElement ? node : null
    if (next === el) return
    observer?.disconnect()
    observer = null
    el = next
    if (next && typeof ResizeObserver !== 'undefined') {
      observer = new ResizeObserver(schedule)
      observer.observe(next)
    }
    schedule()
  }

  onMounted(() => {
    schedule()
    window.addEventListener('resize', schedule)
    window.addEventListener('orientationchange', schedule)
    /* 自定义字体换上后文字高度会变，字体到位再量一次 */
    document.fonts?.ready.then(schedule).catch(() => {})
  })

  onBeforeUnmount(() => {
    cancelAnimationFrame(frame)
    window.removeEventListener('resize', schedule)
    window.removeEventListener('orientationchange', schedule)
    observer?.disconnect()
  })

  return bind
}
