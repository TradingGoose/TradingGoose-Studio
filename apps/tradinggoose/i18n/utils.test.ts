import { describe, expect, it } from 'vitest'
import {
  buildLocaleRequestHeaders,
  getOpenGraphLocale,
  localizeHref,
  localizePathname,
  stripLocaleFromPathname,
} from './utils'

describe('i18n utils', () => {
  it('strips locale prefixes from localized paths', () => {
    expect(stripLocaleFromPathname('/es/blog/trading-signals')).toEqual({
      locale: 'es',
      pathname: '/blog/trading-signals',
    })
  })

  it('defaults to English for unprefixed paths', () => {
    expect(stripLocaleFromPathname('/blog/trading-signals')).toEqual({
      locale: 'en',
      pathname: '/blog/trading-signals',
    })
  })

  it('localizes pathnames without dropping the current slug', () => {
    expect(localizePathname('zh-CN', '/blog/trading-signals')).toBe(
      '/zh/blog/trading-signals'
    )
    expect(localizePathname('zh-CN', '/blog/trading-signals')).not.toContain('/zh-CN')
    expect(localizePathname('en', '/blog/trading-signals')).toBe('/blog/trading-signals')
  })

  it('preserves query strings on already localized URLs', () => {
    expect(localizePathname('zh-CN', '/blog/trading-signals?from=nav')).toBe(
      '/zh/blog/trading-signals?from=nav'
    )
  })

  it('localizes internal hrefs without double-prefixing locale segments', () => {
    expect(localizeHref('zh-CN', '/workspace/ws-1/dashboard?layoutId=layout-1')).toBe(
      '/zh/workspace/ws-1/dashboard?layoutId=layout-1'
    )
    expect(localizeHref('zh-CN', '/zh/login?reauth=1')).toBe('/zh/login?reauth=1')
    expect(localizeHref('en', '/zh/workspace')).toBe('/workspace')
  })

  it('builds locale-aware request headers', () => {
    const headers = buildLocaleRequestHeaders('zh-CN', {
      'Content-Type': 'application/json',
    })

    expect(headers.get('content-type')).toBe('application/json')
    expect(headers.get('x-next-intl-locale')).toBe('zh-CN')
  })

  it('maps Open Graph locales using canonical regional codes', () => {
    expect(getOpenGraphLocale('es')).toBe('es_ES')
    expect(getOpenGraphLocale('zh-CN')).toBe('zh_CN')
  })
})
