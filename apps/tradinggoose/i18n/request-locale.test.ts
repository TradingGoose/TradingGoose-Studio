import { NextRequest } from 'next/server'
import { describe, expect, it } from 'vitest'
import { resolveRequestLocale } from './request-locale'

describe('resolveRequestLocale', () => {
  it('prefers a supported locale cookie', () => {
    const request = new NextRequest('http://localhost', {
      headers: { cookie: 'NEXT_LOCALE=zh', 'accept-language': 'es;q=1' },
    })
    expect(resolveRequestLocale(request)).toBe('zh')
  })

  it('uses the highest-weight supported base language', () => {
    const request = new NextRequest('http://localhost', {
      headers: { 'accept-language': 'fr;q=1,es-MX;q=0.8,en;q=0.4' },
    })
    expect(resolveRequestLocale(request)).toBe('es')
  })

  it('defaults to English for unsupported preferences', () => {
    const request = new NextRequest('http://localhost', {
      headers: { cookie: 'NEXT_LOCALE=fr', 'accept-language': 'de' },
    })
    expect(resolveRequestLocale(request)).toBe('en')
  })

  it('ignores wildcard and zero-quality supported values', () => {
    const request = new NextRequest('http://localhost', {
      headers: { 'accept-language': '*,zh;q=0,es;q=0.5' },
    })
    expect(resolveRequestLocale(request)).toBe('es')
  })
})
