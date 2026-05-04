import { describe, expect, it } from 'vitest'
import {
  sanitizeMarketProviderAuth,
  sanitizeMarketProviderParamsForWidget,
} from '@/lib/market/market-provider-settings'

describe('market provider settings helpers', () => {
  it('keeps raw and env-var market auth credentials', () => {
    expect(
      sanitizeMarketProviderAuth({
        apiKey: 'raw-key',
        apiSecret: '{{ ALPACA_API_SECRET }}',
      })
    ).toEqual({
      apiKey: 'raw-key',
      apiSecret: '{{ ALPACA_API_SECRET }}',
    })
  })

  it('drops blank market auth credentials', () => {
    expect(
      sanitizeMarketProviderAuth({
        apiKey: '{{ ALPACA_API_KEY }}',
        apiSecret: '   ',
      })
    ).toEqual({
      apiKey: '{{ ALPACA_API_KEY }}',
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
