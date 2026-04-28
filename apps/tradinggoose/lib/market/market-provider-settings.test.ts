import { describe, expect, it } from 'vitest'
import {
  sanitizeMarketProviderAuthRefs,
  sanitizeMarketProviderParamsForWidget,
  validateMarketProviderCredentialRefs,
} from '@/lib/market/market-provider-settings'

describe('market provider settings helpers', () => {
  it('keeps only full env-var references for market auth credentials', () => {
    expect(
      sanitizeMarketProviderAuthRefs({
        apiKey: 'raw-key',
        apiSecret: '{{ ALPACA_API_SECRET }}',
      })
    ).toEqual({
      apiSecret: '{{ ALPACA_API_SECRET }}',
    })
  })

  it('rejects raw market auth credentials before provider execution', () => {
    expect(validateMarketProviderCredentialRefs('alpaca', { apiKey: 'raw-key' })).toEqual({
      valid: false,
      fields: ['auth.apiKey'],
    })
  })

  it('accepts env-ref and blank auth credentials during route validation', () => {
    expect(
      validateMarketProviderCredentialRefs('alpaca', {
        apiKey: '{{ ALPACA_API_KEY }}',
        apiSecret: '   ',
      })
    ).toEqual({ valid: true })
  })

  it('rejects misplaced provider auth params even when they are env refs', () => {
    expect(
      validateMarketProviderCredentialRefs('alpaca', undefined, {
        apiKey: '{{ ALPACA_API_KEY }}',
        apiSecret: 'raw-secret',
        feed: 'iex',
      })
    ).toEqual({
      valid: false,
      fields: ['providerParams.apiKey', 'providerParams.apiSecret'],
    })
  })

  it('validates auth refs without provider metadata when provider id is missing', () => {
    expect(validateMarketProviderCredentialRefs(undefined, { apiSecret: 'raw' })).toEqual({
      valid: false,
      fields: ['auth.apiSecret'],
    })
    expect(
      validateMarketProviderCredentialRefs(undefined, undefined, {
        apiKey: '{{ KEY }}',
        feed: 'iex',
      })
    ).toEqual({
      valid: false,
      fields: ['providerParams.apiKey'],
    })
  })

  it('strips misplaced auth params while preserving non-secret provider params', () => {
    expect(
      sanitizeMarketProviderParamsForWidget('alpaca', {
        apiKey: '{{ ALPACA_API_KEY }}',
        apiSecret: 'raw',
        feed: 'iex',
      })
    ).toEqual({
      feed: 'iex',
    })
  })

  it('preserves unknown non-secret params without recursively classifying nested keys', () => {
    expect(
      sanitizeMarketProviderParamsForWidget(undefined, {
        apiKey: 'raw',
        tokenPayload: {
          apiSecret: 'nested raw value',
        },
        blank: ' ',
      })
    ).toEqual({
      tokenPayload: {
        apiSecret: 'nested raw value',
      },
    })
  })
})
