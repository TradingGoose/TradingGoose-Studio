import { describe, expect, it } from 'vitest'
import {
  getMissingMarketProviderSettings,
  sanitizeMarketProviderAuth,
  sanitizeMarketProviderParamsForWidget,
} from '@/lib/market/market-provider-settings'

describe('market provider settings helpers', () => {
  it('requires each selected provider to have its own credentials and settings', () => {
    expect(getMissingMarketProviderSettings('alpaca', undefined, undefined)).toEqual([
      'API Key',
      'API Secret',
    ])
    expect(
      getMissingMarketProviderSettings(
        'alpaca',
        { apiKey: '{{ ALPACA_API_KEY }}', apiSecret: 'secret' },
        undefined
      )
    ).toEqual([])
    expect(getMissingMarketProviderSettings('alpaca', { apiKey: 'key' }, { feed: 'sip' })).toEqual([
      'API Secret',
    ])
    expect(getMissingMarketProviderSettings('finnhub', { apiKey: ' ' }, {})).toEqual(['API Key'])
    expect(getMissingMarketProviderSettings('robinhood', undefined, {})).toEqual([
      'Robinhood connection',
    ])
    expect(
      getMissingMarketProviderSettings('robinhood', undefined, { credentialId: 'connection' })
    ).toEqual([])
    expect(getMissingMarketProviderSettings('yahoo-finance', undefined, undefined)).toEqual([])
  })

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
        feed: 'sip',
      })
    ).toEqual({
      feed: 'sip',
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
