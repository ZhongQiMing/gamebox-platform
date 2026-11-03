import { describe, expect, it } from 'vitest'
import { apkDownloadUrl, decideUpdate } from './appUpdate'

describe('decideUpdate', () => {
  it('服务端版本号更高时判定为有新包', () => {
    const d = decideUpdate(1, { version: '1.1.0', versionCode: 2 })
    expect(d.kind).toBe('newer')
    if (d.kind === 'newer') expect(d.version).toBe('1.1.0')
  })

  it('版本号相同或更低时判定为已是最新', () => {
    expect(decideUpdate(2, { version: '1.0.0', versionCode: 1 }).kind).toBe('current')
    expect(decideUpdate(2, { version: '1.1.0', versionCode: 2 }).kind).toBe('current')
  })
})

describe('apkDownloadUrl', () => {
  it('下载走当前还能用的接口域名', () => {
    expect(apkDownloadUrl('https://a.example')).toBe('https://a.example/api/download/apk')
    expect(apkDownloadUrl('https://a.example/')).toBe('https://a.example/api/download/apk')
    expect(apkDownloadUrl('')).toBe('/api/download/apk')
  })
})
