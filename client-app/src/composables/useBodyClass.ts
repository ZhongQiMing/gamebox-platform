import { onActivated, onDeactivated, onMounted, onUnmounted } from 'vue'

/**
 * 原型页面把 deco-bg / lobby-bg / welcome-login 等 class 挂在 <body> 上，
 * 大量 CSS 规则以 body.xxx 为前缀。SPA 里用本组合函数在进入页面时
 * 给 body 挂上同样的 class，离开时移除，使原型 CSS 原样生效。
 *
 * 必须同时挂 activated/deactivated：底部 Tab 五页在 keep-alive 里，
 * 从「我的」点进子页再返回时只触发 activated、不触发 mounted。此前只挂了
 * mounted/unmounted，导致返回后 body 上没有 deco-bg——四角装饰失去
 * `position: absolute`，变成文档流里四张 400px 大图把正文顶到一屏半以下，
 * 用户看到的就是「返回后满屏花纹，要往下滑才找得到内容」。
 *
 * 计数而不是直接增删：相邻两页常用同一个 class，Vue 不保证
 * 「新页 mounted」与「旧页 deactivated」的先后顺序，直接 remove 有可能
 * 把新页刚加上的 class 抹掉。计数到 0 才真正摘掉就与顺序无关了。
 */
const holders = new Map<string, number>()

function retain(classes: string[]) {
  for (const name of classes) {
    holders.set(name, (holders.get(name) ?? 0) + 1)
    document.body.classList.add(name)
  }
}

function release(classes: string[]) {
  for (const name of classes) {
    const left = (holders.get(name) ?? 1) - 1
    if (left > 0) {
      holders.set(name, left)
      continue
    }
    holders.delete(name)
    document.body.classList.remove(name)
  }
}

export function useBodyClass(...classes: string[]) {
  /* 首次挂载时 mounted 与 activated 会连着触发，用它保证一个实例只占一份计数 */
  let held = false
  const acquire = () => {
    if (held) return
    held = true
    retain(classes)
  }
  const drop = () => {
    if (!held) return
    held = false
    release(classes)
  }

  onMounted(acquire)
  onActivated(acquire)
  onDeactivated(drop)
  onUnmounted(drop)
}
