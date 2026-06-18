import { describe, expect, it } from 'vitest'
import { AUTH_COOKIE_NAMES, getAuthCookieDeletionOptions } from './cookies'

describe('auth cookie cleanup contract', () => {
  it('declares the Better Auth cookies used by this app', () => {
    expect(AUTH_COOKIE_NAMES).toEqual([
      'better-auth.session_token',
      '__Secure-better-auth.session_token',
      'better-auth.session_data',
      '__Secure-better-auth.session_data',
      'better-auth.dont_remember',
      '__Secure-better-auth.dont_remember',
    ])
  })

  it('expires secure-prefixed cookies with the Secure attribute', () => {
    expect(getAuthCookieDeletionOptions('__Secure-better-auth.session_token')).toMatchObject({
      httpOnly: true,
      maxAge: 0,
      path: '/',
      sameSite: 'lax',
      secure: true,
    })
  })

  it('does not mark plain localhost cookies as Secure', () => {
    expect(getAuthCookieDeletionOptions('better-auth.session_token')).toEqual({
      httpOnly: true,
      maxAge: 0,
      path: '/',
      sameSite: 'lax',
    })
  })
})
