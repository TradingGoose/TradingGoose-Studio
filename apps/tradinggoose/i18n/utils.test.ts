import { describe, expect, it } from 'vitest'
import {
  buildLocalizedAlternates,
  getLocaleDisplayName,
  getLocaleFromSearchParams,
  getOpenGraphLocale,
  localizeHref,
  localizePathname,
  localizeSiteUrl,
  normalizeCallbackUrl,
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
    expect(localizePathname('zh', '/blog/trading-signals')).toBe(
      '/zh/blog/trading-signals'
    )
    expect(localizePathname('en', '/blog/trading-signals')).toBe('/blog/trading-signals')
  })

  it('preserves query strings on already localized URLs', () => {
    expect(localizePathname('zh', '/blog/trading-signals?from=nav')).toBe(
      '/zh/blog/trading-signals?from=nav'
    )
  })

  it('localizes internal hrefs without double-prefixing locale segments', () => {
    expect(localizeHref('zh', '/workspace/ws-1/dashboard?layoutId=layout-1')).toBe(
      '/zh/workspace/ws-1/dashboard?layoutId=layout-1'
    )
    expect(localizeHref('zh', '/zh/login?reauth=1')).toBe('/zh/login?reauth=1')
    expect(localizeHref('en', '/zh/workspace')).toBe('/workspace')
  })

  it('normalizes safe callback URLs to internal paths', () => {
    expect(normalizeCallbackUrl('/workspace/ws-1/dashboard?layoutId=layout-1')).toBe(
      '/workspace/ws-1/dashboard?layoutId=layout-1'
    )
    expect(
      normalizeCallbackUrl(
        'https://tradinggoose.ai/es/workspace/ws-1/dashboard?layoutId=layout-1',
        'https://tradinggoose.ai'
      )
    ).toBe('/es/workspace/ws-1/dashboard?layoutId=layout-1')
  })

  it('rejects unsafe callback URLs', () => {
    expect(normalizeCallbackUrl('//malicious.example/redirect')).toBeNull()
    expect(
      normalizeCallbackUrl('https://malicious.example/workspace', 'https://tradinggoose.ai')
    ).toBeNull()
    expect(normalizeCallbackUrl('workspace/ws-1/dashboard')).toBeNull()
  })

  it('resolves explicit API locale search params with an English fallback', () => {
    expect(getLocaleFromSearchParams(new URLSearchParams('locale=es'))).toBe('es')
    expect(getLocaleFromSearchParams(new URLSearchParams('locale=unknown'))).toBe('en')
    expect(getLocaleFromSearchParams(new URLSearchParams())).toBe('en')
  })

  it('builds localized site URLs and alternate hreflang mappings', () => {
    expect(localizeSiteUrl('zh', '/blog')).toBe('https://tradinggoose.ai/zh/blog')

    expect(buildLocalizedAlternates('es', '/blog')).toEqual({
      canonical: 'https://tradinggoose.ai/es/blog',
      languages: {
        en: 'https://tradinggoose.ai/blog',
        es: 'https://tradinggoose.ai/es/blog',
        'zh': 'https://tradinggoose.ai/zh/blog',
        'x-default': 'https://tradinggoose.ai/blog',
      },
    })
  })

  it('maps Open Graph locales using canonical regional codes', () => {
    expect(getOpenGraphLocale('es')).toBe('es_ES')
    expect(getOpenGraphLocale('zh')).toBe('zh_CN')
  })

  it('keeps locale display names native to each language', () => {
    expect(getLocaleDisplayName('en')).toBe('English')
    expect(getLocaleDisplayName('es')).toBe('Español')
    expect(getLocaleDisplayName('zh')).toBe('简体中文')
  })
})
