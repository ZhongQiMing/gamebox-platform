import { describe, expect, it } from 'vitest'
import { frameActivityMessage } from './frameActivity'

describe('游戏 iframe 壳层活跃状态', () => {
  it('离页期间即使 iframe 晚加载也应补发 pause', () => {
    const shell = { active: true }
    shell.active = false
    expect(frameActivityMessage(shell.active)).toEqual({ type: 'assets-game-pause' })
  })

  it('当前活跃时 load/ready 应补发 resume', () => {
    expect(frameActivityMessage(true)).toEqual({ type: 'assets-game-resume' })
  })
})
