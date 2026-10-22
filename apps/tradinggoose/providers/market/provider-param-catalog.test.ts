import { describe, expect, it } from 'vitest'
import {
  getMarketProviderParamCatalog,
  getMarketProviderParamDefinitions,
} from '@/providers/market/providers'

describe('market provider parameter catalogs', () => {
  it.each([
    ['series', ['alpha-vantage', 'alpaca', 'finnhub']],
    ['live', ['alpaca', 'finnhub']],
  ] as const)('shares neutral API key metadata across %s providers', (kind, providers) => {
    const entry = getMarketProviderParamCatalog(kind).registry.apiKey
    expect(entry.providers).toEqual(providers)
    expect(entry.definition).toMatchObject({
      type: 'string',
      title: 'API Key',
      required: true,
      visibility: 'user-only',
      password: true,
    })
    expect(entry.definition.description).toBe('API key for the selected market provider.')
    expect(entry.definition.placeholder).toBe('Enter API key')
  })

  it.each([
    ['alpaca', 'APCA-API-KEY-ID', 'Alpaca API key ID.'],
    ['alpha-vantage', 'ALPHAVANTAGE_API_KEY', 'Alpha Vantage API key.'],
  ])('preserves selected %s credential hints', (provider, placeholder, description) => {
    expect(
      getMarketProviderParamDefinitions(provider, 'series').find((param) => param.id === 'apiKey')
    ).toMatchObject({ placeholder, description })
  })

  it.each(['series', 'live'] as const)('preserves provider-specific %s fields', (kind) => {
    const { registry } = getMarketProviderParamCatalog(kind)
    for (const id of ['apiSecret', 'feed']) {
      expect(registry[id].providers).toEqual(['alpaca'])
      expect(registry[id].definition).toEqual(
        getMarketProviderParamDefinitions('alpaca', kind).find((param) => param.id === id)
      )
    }
  })
})
