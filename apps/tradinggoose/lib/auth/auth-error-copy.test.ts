import { describe, expect, it } from 'vitest'
import {
  getAuthErrorContent,
  normalizeAuthErrorCode,
  normalizeStoredAuthErrorCallback,
} from '@/lib/auth/auth-error-copy'
import {
  REGISTRATION_DISABLED_REASON,
  REGISTRATION_WAITLIST_REASON,
} from '@/lib/registration/shared'
import { getPublicCopy } from '@/i18n/public-copy'

describe('normalizeAuthErrorCode', () => {
  it('normalizes lowercase query values into uppercase snake case', () => {
    expect(normalizeAuthErrorCode('unable_to_create_user')).toBe('UNABLE_TO_CREATE_USER')
  })

  it('collapses mixed separators into a single code format', () => {
    expect(normalizeAuthErrorCode('invalid callback-url')).toBe('INVALID_CALLBACK_URL')
  })
})

describe('getAuthErrorContent', () => {
  const copy = getPublicCopy('en')

  it('returns the signup recovery copy for account creation failures', () => {
    const { code, content } = getAuthErrorContent(copy, 'unable_to_create_user')

    expect(code).toBe('UNABLE_TO_CREATE_USER')
    expect(content.title).toBe("We couldn't create your account")
    expect(content.primaryAction.href).toBe('/signup')
    expect(content.secondaryAction.href).toBe('/login')
  })

  it('falls back to the default auth error copy for unknown codes', () => {
    const { code, content } = getAuthErrorContent(copy, 'totally_unknown_error')

    expect(code).toBe('TOTALLY_UNKNOWN_ERROR')
    expect(content.title).toBe(copy.auth.error.default.title)
    expect(content.primaryAction.href).toBe('/login')
  })

  it.each([
    'UNABLE_TO_CREATE_SESSION',
    'FAILED_TO_CREATE_SESSION',
    'FAILED_TO_GET_SESSION',
    'SESSION_EXPIRED',
  ])('routes %s through reauth cleanup', (errorCode) => {
    const { code, content } = getAuthErrorContent(copy, errorCode)

    expect(code).toBe(errorCode)
    expect(content.primaryAction.href).toBe('/login?reauth=1')
    expect(content.secondaryAction.href).toBe('/')
  })

  it('keeps the stored canonical destination on session recovery actions', () => {
    const callback = normalizeStoredAuthErrorCallback(
      encodeURIComponent('/invite/invitation-1?token=workspace-token')
    )
    const { content } = getAuthErrorContent(copy, 'UNABLE_TO_CREATE_SESSION', null, callback)

    expect(callback).toBe('/invite/invitation-1?token=workspace-token')
    expect(normalizeStoredAuthErrorCallback(encodeURIComponent('/en/workspace'))).toBeNull()
    expect(normalizeStoredAuthErrorCallback('https://evil.example/workspace')).toBeNull()
    expect(content.primaryAction.href).toBe(
      '/login?reauth=1&callbackUrl=%2Finvite%2Finvitation-1%3Ftoken%3Dworkspace-token'
    )
  })

  it('maps the waitlist registration reason to waitlist recovery copy', () => {
    const { code, content } = getAuthErrorContent(copy, REGISTRATION_WAITLIST_REASON)

    expect(code).toBe('REGISTRATION_WAITLIST')
    expect(content.title).toBe(copy.auth.error.groups.waitlistLimited.title)
    expect(content.description).toBe(copy.auth.error.groups.waitlistLimited.description)
    expect(content.primaryAction.href).toBe('/waitlist')
  })

  it('maps the disabled registration reason to the disabled recovery copy', () => {
    const { code, content } = getAuthErrorContent(copy, REGISTRATION_DISABLED_REASON)

    expect(code).toBe('REGISTRATION_DISABLED')
    expect(content.title).toBe(copy.auth.error.groups.registrationDisabled.title)
    expect(content.description).toBe(copy.auth.error.groups.registrationDisabled.description)
    expect(content.primaryAction.href).toBe('/login')
  })
})
