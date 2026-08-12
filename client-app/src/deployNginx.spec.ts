import { describe, expect, it } from 'vitest'
import config from '../deploy/nginx.conf?raw'

describe('游戏域字体 Nginx 配置', () => {
  it('仅开放已知字体路径并区分入口与哈希文件缓存', () => {
    expect(config).toContain('location = /fonts/gamebox-fonts.css')
    expect(config).toContain('location ^~ /fonts/files/')
    expect(config).toContain('max-age=31536000, immutable')
    expect(config).toContain('location ^~ /fonts/ { return 404; }')
    expect(config.match(/limit_except GET HEAD \{ deny all; \}/g)).toHaveLength(2)
  })

  it('字体响应保留游戏域安全头', () => {
    const fontBlock = config.slice(
      config.indexOf('location ^~ /fonts/files/'),
      config.indexOf('location ^~ /fonts/ { return 404; }'),
    )
    expect(fontBlock).toContain('Content-Security-Policy $game_csp')
    expect(fontBlock).toContain('X-Content-Type-Options nosniff')
    expect(fontBlock).toContain('Cross-Origin-Resource-Policy cross-origin')
  })
})
