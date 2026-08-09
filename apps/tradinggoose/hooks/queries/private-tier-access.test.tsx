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

  it('uses server copy only for 429 and keeps client invalid copy for allowed failures', () => {
    expect(
      getPrivateTierAccessValidationErrorMessage(
        new PrivateTierAccessRequestError('请稍后再试。', 429, 60),
        'Invalid access code.'
      )
    ).toBe('请稍后再试。')
    expect(
      getPrivateTierAccessValidationErrorMessage(
        new PrivateTierAccessRequestError('server prose', 404, null),
        'Invalid access code.'
      )
    ).toBe('Invalid access code.')
  })
})
