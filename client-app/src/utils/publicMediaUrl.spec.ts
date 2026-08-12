import { describe, expect, it } from 'vitest'
import { publicMediaUrl } from './publicMediaUrl'

describe('publicMediaUrl', () => {
  it('网页版保持公开上传地址为相对路径', () => {
    expect(publicMediaUrl('/uploads/avatars/a.webp', {
      native: false,
      apiOrigin: 'https://api.example.com',
    })).toBe('/uploads/avatars/a.webp')
  })

  it('Native 用 API Origin 补全公开上传地址', () => {
    expect(publicMediaUrl('/uploads/rooms/icon.png', {
      native: true,
      apiOrigin: 'https://api.example.com/',
    })).toBe('https://api.example.com/uploads/rooms/icon.png')
  })

  it.each([
    'data:image/png;base64,AAAA',
    'blob:https://app.example.com/id',
    'https://cdn.example.com/a.png',
    'http://cdn.example.com/a.png',
    '/images/avatars/001.jpg',
    '/api/cs/media/private-token',
  ])('不改写非公开上传地址 %s', (url) => {
    expect(publicMediaUrl(url, {
      native: true,
      apiOrigin: 'https://api.example.com',
    })).toBe(url)
  })

  it('Native 未配置 API Origin 时安全保留原地址', () => {
    expect(publicMediaUrl('/uploads/a.png', { native: true, apiOrigin: '' }))
      .toBe('/uploads/a.png')
  })
})
