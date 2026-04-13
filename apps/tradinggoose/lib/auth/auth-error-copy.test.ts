import { describe, expect, it } from 'vitest'
import { getAuthErrorContent, normalizeAuthErrorCode } from '@/lib/auth/auth-error-copy'
import {
  REGISTRATION_DISABLED_MESSAGE,
  REGISTRATION_WAITLIST_MESSAGE,
} from '@/lib/registration/shared'

describe('normalizeAuthErrorCode', () => {
  it('normalizes lowercase query values into uppercase snake case', () => {
    expect(normalizeAuthErrorCode('unable_to_create_user')).toBe('UNABLE_TO_CREATE_USER')
  })

  it('collapses mixed separators into a single code format', () => {
    expect(normalizeAuthErrorCode('invalid callback-url')).toBe('INVALID_CALLBACK_URL')
  })
})

describe('getAuthErrorContent', () => {
  it('returns the signup recovery copy for account creation failures', () => {
    const { code, content } = getAuthErrorContent('unable_to_create_user')

    expect(code).toBe('UNABLE_TO_CREATE_USER')
    expect(content.title).toBe("We couldn't create your account")
    expect(content.primaryAction.href).toBe('/signup')
    expect(content.secondaryAction.href).toBe('/login?reauth=1')
  })

  it('falls back to the default auth error copy for unknown codes', () => {
    const { code, content } = getAuthErrorContent('totally_unknown_error')

    expect(code).toBe('TOTALLY_UNKNOWN_ERROR')
    expect(content.title).toBe('Something went wrong')
    expect(content.primaryAction.href).toBe('/login?reauth=1')
  })

  it('maps the normalized waitlist registration code to waitlist recovery copy', () => {
    const { code, content } = getAuthErrorContent(
      'registration_is_limited_to_approved_waitlist_emails'
    )

    expect(code).toBe('REGISTRATION_IS_LIMITED_TO_APPROVED_WAITLIST_EMAILS')
    expect(content.title).toBe('Registration is limited')
    expect(content.description).toBe(REGISTRATION_WAITLIST_MESSAGE)
    expect(content.primaryAction.href).toBe('/waitlist')
  })

  it('maps the normalized disabled registration code to the disabled recovery copy', () => {
    const { code, content } = getAuthErrorContent('registration_is_currently_disabled')

    expect(code).toBe('REGISTRATION_IS_CURRENTLY_DISABLED')
    expect(content.title).toBe('Registration is currently disabled')
    expect(content.description).toBe(REGISTRATION_DISABLED_MESSAGE)
    expect(content.primaryAction.href).toBe('/login?reauth=1')
  })
})
