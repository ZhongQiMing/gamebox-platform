/**
 * 正版 PG Logo 机制（shell b526e03cc3.89a5b.js）
 *
 * DOM：#gradient-color(z:-99) + #svg-logo-container(白字) + #pg-svg-text
 * 换色：opacity 交叉淡入（2s linear），不改 path fill
 * 时序：3500ms 后首次 JY；5500ms 后 Jx；之后每 12000ms：JY + 8000ms 后 Jx
 * JY=彩色态 beginElement；Jx=白色态，再过 2000ms endElement 停彩虹
 */

const NS = 'http://www.w3.org/2000/svg'

/** 与正版 JI 一致（中间 stop 的 values 保留正版缺 # 写法） */
export const PG_COLOR_STOPS = [
  ['0', '#d888f3', '#d888f3;#fee8a1;#a0f5b2;#30f4e1;#42b1ff;#78fbf0;#a3bdfa;#d888f3;'],
  ['0.5', '#8aadff', '#8aadff;#78fbf0;#42b1ff;#8aadff;#a0f5b2;fee8a1;#d888f3;#8aadff;'],
  ['1', '#30f4e1', '#30f4e1;#d888f3;#42b1ff;#8aadff;#a0f5b2;#78fbf0;#78fbf0;#30f4e1;'],
] as const

const LETTER_GROUPS = [
  'PG-Color-Top',
  'PG-Color-Bottom',
  'PG1',
  'PG2',
  'PG3',
  'PG4',
  'PG5',
] as const

function setStyle(el: HTMLElement | SVGElement, ...pairs: string[]) {
  for (let i = 0; i < pairs.length; i += 2) {
    ;(el.style as unknown as Record<string, string>)[pairs[i]] = pairs[i + 1]
  }
}

function buildLogoClipPath(root: HTMLElement) {
  const clip = root.querySelector('#logo-clip-path')
  const container = root.querySelector('#svg-logo-container')
  const title = root.querySelector('#PG-Title')
  if (!(clip instanceof SVGClipPathElement) || !(container instanceof HTMLElement)) return

  while (clip.firstChild) clip.removeChild(clip.firstChild)

  // 正版：标题 path 下移 container.clientHeight（竖屏约 31px）
  // 用 SVG transform 属性：CSS transform 在部分环境下对 clipPath 子节点不生效，会导致副标题裁切丢失
  const titleOffset = `translate(0 ${container.clientHeight})`
  if (title) {
    ;[...title.children].forEach((child) => {
      if (!(child instanceof SVGPathElement)) return
      const d = child.getAttribute('d')
      if (!d) return
      const path = document.createElementNS(NS, 'path')
      path.setAttribute('d', d)
      path.setAttribute('clip-rule', 'evenodd')
      path.setAttribute('fill-rule', 'evenodd')
      path.setAttribute('transform', titleOffset)
      clip.appendChild(path)
    })
  }

  // 正版：各组 path（跳过末尾 <animate*>）拷进 clipPath
  LETTER_GROUPS.forEach((id) => {
    const group = root.querySelector(`#${id}`)
    if (!group) return
    ;[...group.children].forEach((child) => {
      if (!(child instanceof SVGPathElement)) return
      const d = child.getAttribute('d')
      if (!d) return
      const path = document.createElementNS(NS, 'path')
      path.setAttribute('d', d)
      path.setAttribute('clip-rule', 'evenodd')
      path.setAttribute('fill-rule', 'evenodd')
      clip.appendChild(path)
    })
  })

  // 动态填充后刷新 CSS clip-path 引用
  const logoGrad = root.querySelector('#logo-gradient')
  if (logoGrad instanceof SVGSVGElement) {
    logoGrad.style.clipPath = 'none'
    // 强制 reflow
    void logoGrad.getBoundingClientRect()
    logoGrad.style.clipPath = 'url(#logo-clip-path)'
  }
}

function getColorAnimates(root: HTMLElement) {
  return PG_COLOR_STOPS.map(([, color]) => {
    // id 形如 color-#d888f3，只能用属性选择器
    return root.querySelector(`[id="color-${color}"]`) as SVGAnimationElement | null
  }).filter((el): el is SVGAnimationElement => !!el)
}

export function mountPgLogoColorCycle(root: HTMLElement) {
  buildLogoClipPath(root)

  const grad = root.querySelector('#gradient-color')
  const container = root.querySelector('#svg-logo-container')
  const text = root.querySelector('#pg-svg-text')
  const colorAnims = getColorAnimates(root)

  if (
    !(grad instanceof SVGSVGElement) ||
    !(container instanceof HTMLElement) ||
    !(text instanceof SVGSVGElement)
  ) {
    return () => {}
  }

  const timers: number[] = []
  let intervalId: number | null = null

  const schedule = (fn: () => void, ms: number) => {
    const id = window.setTimeout(fn, ms)
    timers.push(id)
    return id
  }

  /** 正版 JY：彩色态 */
  const enterColor = () => {
    setStyle(grad, 'opacity', '1')
    setStyle(container, 'opacity', '0')
    setStyle(text, 'opacity', '0')
    colorAnims.forEach((anim) => {
      try {
        anim.beginElement()
      } catch {
        /* ignore */
      }
    })
  }

  /** 正版 Jx：白色态 */
  const enterWhite = () => {
    setStyle(grad, 'opacity', '0')
    setStyle(container, 'opacity', '1')
    setStyle(text, 'opacity', '1')
    schedule(() => {
      colorAnims.forEach((anim) => {
        try {
          anim.endElement()
        } catch {
          /* ignore */
        }
      })
    }, 2000)
  }

  // 初始：白字可见、渐变隐藏（与正版创建 后挂 DOM 时一致）
  setStyle(grad, 'opacity', '0')
  setStyle(container, 'opacity', '1')
  setStyle(text, 'opacity', '1')

  // 正版：3500ms 后加 transition，立刻 JY，再 5500ms Jx；之后每 12s 循环
  schedule(() => {
    setStyle(grad, 'transition', 'opacity 2s linear')
    setStyle(container, 'transition', 'opacity 2s linear')
    setStyle(text, 'transition', 'opacity 2s linear')
    enterColor()
    schedule(enterWhite, 5500)
    intervalId = window.setInterval(() => {
      enterColor()
      schedule(enterWhite, 8000)
    }, 12000)
  }, 3500)

  return () => {
    timers.forEach((id) => window.clearTimeout(id))
    if (intervalId !== null) window.clearInterval(intervalId)
    setStyle(grad, 'opacity', '0', 'transition', '')
    setStyle(container, 'opacity', '1', 'transition', '')
    setStyle(text, 'opacity', '1', 'transition', '')
  }
}
