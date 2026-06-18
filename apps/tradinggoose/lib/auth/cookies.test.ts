import { afterEach, describe, expect, it, vi } from 'vitest'

async function loadCookies(appUrl: string) {
  vi.resetModules()
  vi.stubEnv('NEXT_PUBLIC_APP_URL', appUrl)
  return import('./cookies')
}

describe('auth cookie cleanup contract', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('declares secure Better Auth cookies for HTTPS app origins', async () => {
    const { AUTH_COOKIE_NAMES, AUTH_SESSION_COOKIE_NAME, getAuthCookieDeletionOptions } =
      await loadCookies('https://www.tradinggoose.ai')

    expect(AUTH_SESSION_COOKIE_NAME).toBe('__Secure-better-auth.session_token')
    expect(AUTH_COOKIE_NAMES).toEqual([
      '__Secure-better-auth.session_token',
      '__Secure-better-auth.session_data',
      '__Secure-better-auth.dont_remember',
    ])
    expect(getAuthCookieDeletionOptions()).toMatchObject({
      httpOnly: true,
      maxAge: 0,
      path: '/',
      sameSite: 'lax',
      secure: true,
    })
  })

  it('declares plain Better Auth cookies for HTTP app origins', async () => {
    const { AUTH_COOKIE_NAMES, AUTH_SESSION_COOKIE_NAME, getAuthCookieDeletionOptions } =
      await loadCookies('http://localhost:3000')

    expect(AUTH_SESSION_COOKIE_NAME).toBe('better-auth.session_token')
    expect(AUTH_COOKIE_NAMES).toEqual([
      'better-auth.session_token',
      'better-auth.session_data',
      'better-auth.dont_remember',
    ])
    expect(getAuthCookieDeletionOptions()).toEqual({
      httpOnly: true,
      maxAge: 0,
      path: '/',
      sameSite: 'lax',
    })
  })
})
