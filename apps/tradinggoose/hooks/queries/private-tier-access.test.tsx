import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  getPrivateTierAccessValidationErrorMessage,
  PrivateTierAccessRequestError,
  requestPrivateTierAccess,
} from './private-tier-access'

describe('private tier access request errors', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('preserves the localized server message, status, and retry interval', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ error: 'Demasiados intentos.' }), {
          status: 429,
          headers: { 'Content-Type': 'application/json', 'Retry-After': '42' },
        })
      )
    )

    const error = await requestPrivateTierAccess().catch((caught) => caught)

    expect(error).toBeInstanceOf(PrivateTierAccessRequestError)
    expect(error).toMatchObject({
      message: 'Demasiados intentos.',
      status: 429,
      retryAfterSeconds: 42,
    })
  })

  it('uses server copy for throttling and client-localized dependency failures', () => {
    expect(
      getPrivateTierAccessValidationErrorMessage(
        new PrivateTierAccessRequestError('请稍后再试。', 429, 60),
        'Invalid access code.',
        'Dependency unavailable.'
      )
    ).toBe('请稍后再试。')
    expect(
      getPrivateTierAccessValidationErrorMessage(
        new PrivateTierAccessRequestError(
          'Access-code validation is temporarily unavailable',
          503,
          600
        ),
        'Invalid access code.',
        'Dependency unavailable.'
      )
    ).toBe('Dependency unavailable.')
    expect(
      getPrivateTierAccessValidationErrorMessage(
        new PrivateTierAccessRequestError('required', 400, null),
        'Invalid access code.',
        'Dependency unavailable.'
      )
    ).toBe('Invalid access code.')
    expect(
      getPrivateTierAccessValidationErrorMessage(
        new PrivateTierAccessRequestError('server prose', 404, null),
        'Invalid access code.',
        'Dependency unavailable.'
      )
    ).toBe('Invalid access code.')
    expect(
      getPrivateTierAccessValidationErrorMessage(
        new Error('unclassified server failure'),
        'Invalid access code.',
        'Dependency unavailable.'
      )
    ).toBe('Invalid access code.')
  })
})
