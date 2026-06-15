import { NextRequest } from 'next/server'
import { describe, expect, it, vi } from 'vitest'
import {
  getLocaleFromAcceptLanguage,
  getLocaleFromCookie,
  resolveAnonymousLocale,
  resolveRequestLocale,
} from './locale-resolution'

describe('locale resolution', () => {
  it('reads supported locale cookie values only', () => {
    expect(
      getLocaleFromCookie(
        new NextRequest('http://localhost:3000/', {
          headers: { cookie: 'NEXT_LOCALE=zh' },
        })
      )
    ).toBe('zh')

    expect(
      getLocaleFromCookie(
        new NextRequest('http://localhost:3000/', {
          headers: { cookie: 'NEXT_LOCALE=fr' },
        })
      )
    ).toBeNull()
  })

  it('selects the highest-priority supported Accept-Language locale', () => {
    expect(getLocaleFromAcceptLanguage('fr-CA,es-ES;q=0.8,en-US;q=0.7')).toBe('es')
    expect(getLocaleFromAcceptLanguage('en-US;q=0.4,zh-CN;q=0.9,es;q=0.8')).toBe('zh')
    expect(getLocaleFromAcceptLanguage('fr-CA,*;q=0.9')).toBeNull()
  })

  it('resolves anonymous requests from cookie, browser language, then default locale', () => {
    expect(
      resolveAnonymousLocale(
        new NextRequest('http://localhost:3000/', {
          headers: {
            cookie: 'NEXT_LOCALE=zh',
            'accept-language': 'es-ES,es;q=0.9',
          },
        })
      )
    ).toBe('zh')

    expect(
      resolveAnonymousLocale(
        new NextRequest('http://localhost:3000/', {
          headers: { 'accept-language': 'es-MX,es;q=0.8' },
        })
      )
    ).toBe('es')

    expect(resolveAnonymousLocale(new NextRequest('http://localhost:3000/'))).toBe('en')
  })

  it('uses authenticated settings before anonymous browser memory', async () => {
    const resolveAuthenticatedLocale = vi.fn(async () => 'zh' as const)

    const locale = await resolveRequestLocale(
      new NextRequest('http://localhost:3000/', {
        headers: {
          cookie: 'NEXT_LOCALE=es',
          'accept-language': 'en-US,en;q=0.9',
        },
      }),
      { hasActiveSession: true, resolveAuthenticatedLocale }
    )

    expect(locale).toBe('zh')
    expect(resolveAuthenticatedLocale).toHaveBeenCalledTimes(1)
  })

  it('continues to browser memory when an active session has no stored locale', async () => {
    const locale = await resolveRequestLocale(
      new NextRequest('http://localhost:3000/', {
        headers: { cookie: 'NEXT_LOCALE=es' },
      }),
      { hasActiveSession: true, resolveAuthenticatedLocale: vi.fn(async () => null) }
    )

    expect(locale).toBe('es')
  })

  it('does not fall back to anonymous locale when authenticated locale resolution fails', async () => {
    await expect(
      resolveRequestLocale(
        new NextRequest('http://localhost:3000/', {
          headers: { cookie: 'NEXT_LOCALE=es' },
        }),
        {
          hasActiveSession: true,
          resolveAuthenticatedLocale: vi.fn(async () => {
            throw new Error('settings unavailable')
          }),
        }
      )
    ).rejects.toThrow('settings unavailable')
  })
})
