import { describe, expect, it } from 'vitest'
import { getRouteBoundaryHref, getRouteBoundaryUrl } from './route-boundary'

describe('route boundary URLs', () => {
  it('localizes canonical internal hrefs without double-prefixing locale segments', () => {
    expect(getRouteBoundaryHref('zh', '/workspace/ws-1/dashboard?layoutId=layout-1')).toBe(
      '/zh/workspace/ws-1/dashboard?layoutId=layout-1'
    )
    expect(getRouteBoundaryHref('zh', '/zh/login?reauth=1')).toBe('/zh/login?reauth=1')
    expect(getRouteBoundaryHref('en', '/zh/workspace')).toBe('/workspace')
  })

  it('leaves external hrefs untouched', () => {
    expect(getRouteBoundaryHref('es', 'https://example.com/path')).toBe('https://example.com/path')
    expect(getRouteBoundaryHref('es', '//example.com/path')).toBe('//example.com/path')
  })

  it('builds absolute route-boundary URLs', () => {
    expect(getRouteBoundaryUrl('https://tradinggoose.ai', 'es', '/reset-password')).toBe(
      'https://tradinggoose.ai/es/reset-password'
    )
  })
})
