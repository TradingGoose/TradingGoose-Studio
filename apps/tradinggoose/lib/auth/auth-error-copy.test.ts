import { describe, expect, it } from 'vitest'
import {
  extractPersistableAuthErrorMessage,
  getAuthErrorContent,
  normalizeAuthErrorCode,
} from '@/lib/auth/auth-error-copy'
import { REGISTRATION_WAITLIST_MESSAGE } from '@/lib/registration/shared'

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

  it('prefers the explicit registration message and action when provided', () => {
    const { content } = getAuthErrorContent('unable_to_create_user', REGISTRATION_WAITLIST_MESSAGE)

    expect(content.title).toBe('Registration is limited')
    expect(content.description).toBe(REGISTRATION_WAITLIST_MESSAGE)
    expect(content.primaryAction.href).toBe('/waitlist')
  })
})

describe('extractPersistableAuthErrorMessage', () => {
  it('pulls the specific cause message from wrapped auth errors', () => {
    const error = new Error('Failed to create user', {
      cause: new Error(REGISTRATION_WAITLIST_MESSAGE),
    })

    expect(extractPersistableAuthErrorMessage(error)).toBe(REGISTRATION_WAITLIST_MESSAGE)
  })

  it('ignores generic wrapper messages when nothing more specific exists', () => {
    expect(extractPersistableAuthErrorMessage(new Error('Failed to create user'))).toBeNull()
  })
})
