import { describe, expect, it } from 'vitest'
import { isMistlSite, mistlSiteId } from './mistlSite'

const id = 'abcdefghijklmnopqrstuvwxyz234567'

describe('mistlSiteId', () => {
  it('accepts site URLs with or without port and path', () => {
    expect(mistlSiteId(`http://${id}.localhost:6490/`)).toBe(id)
    expect(mistlSiteId(`http://${id}.localhost:6490`)).toBe(id)
    expect(mistlSiteId(`http://${id}.localhost/`)).toBe(id)
    expect(mistlSiteId(`http://${id}.localhost:6490/play/?level=2#x`)).toBe(id)
  })
  it('rejects other URLs', () => {
    for (const url of [
      undefined, '', 'https://example.com/', `https://${id}.localhost:6490/`,
      `http://${id.toUpperCase()}.localhost:6490/`, `http://${id.slice(1)}.localhost:6490/`,
      `http://${id}.localhost.evil.com/`, `http://${id}.localhost:0/`, `http://${id}.localhost:70000/`,
      `http://x.${id}.localhost:6490/`, 'http://localhost:6490/',
    ]) expect(isMistlSite(url), String(url)).toBe(false)
  })
})
