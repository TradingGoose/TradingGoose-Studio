/**
 * @vitest-environment node
 */

import { afterEach, describe, expect, it } from 'vitest'
import { resolveCredentials } from '@/providers/market/alpaca/series'

const originalAlpacaApiKeyId = process.env.ALPACA_API_KEY_ID
const originalAlpacaApiSecretKey = process.env.ALPACA_API_SECRET_KEY

afterEach(() => {
  process.env.ALPACA_API_KEY_ID = originalAlpacaApiKeyId
  process.env.ALPACA_API_SECRET_KEY = originalAlpacaApiSecretKey
})

describe('resolveCredentials', () => {
  it('does not fall back to deployment env when request auth is missing', () => {
    process.env.ALPACA_API_KEY_ID = 'deployment-key'
    process.env.ALPACA_API_SECRET_KEY = 'deployment-secret'

    expect(resolveCredentials()).toEqual({
      keyId: undefined,
      secretKey: undefined,
    })
  })

  it('uses explicit request auth when provided', () => {
    expect(
      resolveCredentials({
        apiKey: 'request-key',
        apiSecret: 'request-secret',
      })
    ).toEqual({
      keyId: 'request-key',
      secretKey: 'request-secret',
    })
  })
})
