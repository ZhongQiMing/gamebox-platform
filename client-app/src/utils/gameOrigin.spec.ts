import { describe, expect, it, vi } from 'vitest'
import {
  gameAssetUrl,
  gameOrigin,
  isTrustedGameMessage,
  resolveGameOrigin,
} from './gameOrigin'

describe('H5 游戏独立 Origin 桥接', () => {
  it('把游戏资源固定到配置的游戏 Origin', () => {
    const url = new URL(gameAssetUrl('/games-assets/bjsc/index.html?v=1'))
    expect(url.origin).toBe(gameOrigin)
    expect(url.pathname).toBe('/games-assets/bjsc/index.html')
  })

  it('postMessage 必须同时命中 origin 与 iframe source', () => {
    const frame = window.frames as unknown as Window
    expect(
      isTrustedGameMessage({ origin: gameOrigin, source: frame }, frame),
    ).toBe(true)
    expect(
      isTrustedGameMessage(
        { origin: 'https://evil.example', source: frame },
        frame,
      ),
    ).toBe(false)
    expect(
      isTrustedGameMessage(
        { origin: gameOrigin, source: window },
        frame,
      ),
    ).toBe(false)
  })
})

describe('resolveGameOrigin', () => {
  it('开发模式缺失或非法配置时明确回退同源', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    expect(resolveGameOrigin({
      mode: 'development',
      pageOrigin: 'http://localhost:5173',
    })).toBe('http://localhost:5173')
    expect(resolveGameOrigin({
      mode: 'development',
      pageOrigin: 'http://localhost:5173',
      gameOrigin: 'not-an-origin',
    })).toBe('http://localhost:5173')
    expect(warn).toHaveBeenCalledOnce()
    warn.mockRestore()
  })

  it('生产 Web 缺少独立游戏域时立即失败', () => {
    expect(() => resolveGameOrigin({
      mode: 'production-web',
      pageOrigin: 'https://player.example.com',
    })).toThrow(/生产 Web 缺少 VITE_GAME_ORIGIN/)
  })

  it('生产 Web 拒绝非法 Origin 和 HTTPS 降级', () => {
    expect(() => resolveGameOrigin({
      mode: 'production-web',
      pageOrigin: 'https://player.example.com',
      gameOrigin: 'https://games.example.com/path',
    })).toThrow(/不能含路径/)
    expect(() => resolveGameOrigin({
      mode: 'production-web',
      pageOrigin: 'https://player.example.com',
      gameOrigin: 'http://games.example.com',
    })).toThrow(/HTTPS/)
  })

  it('Native 优先显式游戏域，否则沿用素材域', () => {
    expect(resolveGameOrigin({
      mode: 'native',
      pageOrigin: 'capacitor://localhost',
      gameOrigin: 'https://games.example.com',
      nativeAssetOrigin: 'https://assets.example.com',
    })).toBe('https://games.example.com')
    expect(resolveGameOrigin({
      mode: 'native',
      pageOrigin: 'capacitor://localhost',
      nativeAssetOrigin: 'https://assets.example.com',
    })).toBe('https://assets.example.com')
  })
})
