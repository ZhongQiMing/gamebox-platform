import { afterEach, describe, expect, it } from 'vitest'
import { defineComponent, h, KeepAlive, ref, nextTick } from 'vue'
import { mount } from '@vue/test-utils'
import { useBodyClass } from './useBodyClass'

function pageWith(cls: string) {
  return defineComponent({
    setup() {
      useBodyClass(cls)
      return () => h('div')
    },
  })
}

describe('useBodyClass', () => {
  afterEach(() => {
    document.body.className = ''
  })

  it('keep-alive 页面来回切换后仍带着 body class', async () => {
    const A = pageWith('deco-bg')
    const B = defineComponent({ setup: () => () => h('div', 'other') })
    const showA = ref(true)
    const host = mount(
      defineComponent({
        setup: () => () => h(KeepAlive, null, { default: () => h(showA.value ? A : B) }),
      }),
    )

    expect(document.body.classList.contains('deco-bg')).toBe(true)

    showA.value = false
    await nextTick()
    expect(document.body.classList.contains('deco-bg')).toBe(false)

    /* 这一步是回归点：以前只挂 mounted，缓存命中不会重新加上 class */
    showA.value = true
    await nextTick()
    expect(document.body.classList.contains('deco-bg')).toBe(true)

    host.unmount()
    expect(document.body.classList.contains('deco-bg')).toBe(false)
  })

  it('两个页面共用同一个 class 时，先来后到都不会互相摘掉', async () => {
    const first = mount(pageWith('deco-bg'))
    const second = mount(pageWith('deco-bg'))
    expect(document.body.classList.contains('deco-bg')).toBe(true)

    /* 旧页后卸载：计数还有一份，class 必须留着给新页用 */
    first.unmount()
    expect(document.body.classList.contains('deco-bg')).toBe(true)

    second.unmount()
    expect(document.body.classList.contains('deco-bg')).toBe(false)
  })
})
