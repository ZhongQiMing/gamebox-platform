import { describe, expect, it, vi } from 'vitest'
import { createActivationGate } from './activationGate'

describe('createActivationGate', () => {
  it('重复激活和停用时只成对执行一次', () => {
    const start = vi.fn()
    const stop = vi.fn()
    const gate = createActivationGate(start, stop)

    expect(gate.activate()).toBe(true)
    expect(gate.activate()).toBe(false)
    expect(gate.active).toBe(true)
    expect(start).toHaveBeenCalledTimes(1)

    expect(gate.deactivate()).toBe(true)
    expect(gate.deactivate()).toBe(false)
    expect(gate.active).toBe(false)
    expect(stop).toHaveBeenCalledTimes(1)
  })

  it('重新进入后重新注册一组资源', () => {
    const start = vi.fn()
    const stop = vi.fn()
    const gate = createActivationGate(start, stop)

    gate.activate()
    gate.deactivate()
    gate.activate()

    expect(start).toHaveBeenCalledTimes(2)
    expect(stop).toHaveBeenCalledTimes(1)
  })
})
