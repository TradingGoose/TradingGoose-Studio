import { describe, expect, it } from 'vitest'
import {
  buildLocalizedAlternates,
  getLocaleDisplayName,
  getOpenGraphLocale,
  localizeSiteUrl,
  localizeUrl,
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

  it('normalizes safe callback URLs to internal paths', () => {
    expect(normalizeCallbackUrl('/workspace/ws-1/dashboard?layoutId=layout-1')).toBe(
      '/workspace/ws-1/dashboard?layoutId=layout-1'
    )
    expect(
      normalizeCallbackUrl(
        'https://tradinggoose.ai/workspace/ws-1/dashboard?layoutId=layout-1',
        'https://tradinggoose.ai'
      )
    ).toBe('/workspace/ws-1/dashboard?layoutId=layout-1')
  })

  it('rejects unsafe callback URLs', () => {
    expect(normalizeCallbackUrl('//malicious.example/redirect')).toBeNull()
    expect(
      normalizeCallbackUrl('https://malicious.example/workspace', 'https://tradinggoose.ai')
    ).toBeNull()
    expect(normalizeCallbackUrl('workspace/ws-1/dashboard')).toBeNull()
  })

  it('builds localized site URLs and alternate hreflang mappings', () => {
    const previousAppUrl = process.env.NEXT_PUBLIC_APP_URL
    process.env.NEXT_PUBLIC_APP_URL = 'https://preview.example.com'

    try {
      expect(localizeSiteUrl('zh', '/blog')).toBe('https://preview.example.com/zh/blog')

      expect(buildLocalizedAlternates('es', '/blog')).toEqual({
        canonical: 'https://preview.example.com/es/blog',
        languages: {
          en: 'https://preview.example.com/blog',
          es: 'https://preview.example.com/es/blog',
          zh: 'https://preview.example.com/zh/blog',
          'x-default': 'https://preview.example.com/blog',
        },
      })
    } finally {
      if (previousAppUrl === undefined) {
        process.env.NEXT_PUBLIC_APP_URL = undefined
      } else {
        process.env.NEXT_PUBLIC_APP_URL = previousAppUrl
      }
    }
  })

  it('builds absolute localized app URLs from canonical internal paths', () => {
    expect(localizeUrl('https://tradinggoose.ai/', 'es', '/reset-password?token=abc')).toBe(
      'https://tradinggoose.ai/es/reset-password?token=abc'
    )
    expect(localizeUrl('https://tradinggoose.ai', 'en', '/workspace')).toBe(
      'https://tradinggoose.ai/workspace'
    )
    expect(localizeUrl('https://tradinggoose.ai', 'invalid', '/login')).toBe(
      'https://tradinggoose.ai/login'
    )
  })

  it('rejects non-canonical app URL inputs', () => {
    expect(() => localizeUrl('https://tradinggoose.ai', 'es', '/zh/login')).toThrow(
      'Expected an unlocalized internal pathname'
    )
    expect(() => localizeUrl('https://tradinggoose.ai', 'es', 'https://example.com')).toThrow(
      'Expected a canonical internal pathname'
    )
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
