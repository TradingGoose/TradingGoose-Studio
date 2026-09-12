import type { MarketProviderConfig, MarketSymbolRule } from '@/providers/market/providers'
import type { AssetClass } from '@/providers/market/types'

const availableAssetClasses: AssetClass[] = [
  'stock',
  'etf',
  'future',
  'currency',
  'indice',
  'mutualfund',
]

const availability: MarketProviderConfig['availability'] = {
  assetClass: availableAssetClasses,
  availableListingQuote: [],
  availableCurrencyBase: [],
  availableCurrencyQuote: [],
  availableCryptoBase: [],
  availableCryptoQuote: [],
  series: true,
  live: true,
}

const exchangeCodesList: MarketProviderConfig['exchangeCodes'] = []

const exchangeCodeToMarketMap: MarketProviderConfig['exchangeCodeToMarket'] = {}
const marketToExchangeCodeMap: MarketProviderConfig['marketToExchangeCode'] = {}

const ibkrMarketSymbolRules: MarketSymbolRule[] = [
  {
    currency: 'USD',
    template: '{base}',
    active: true,
  },
  {
    currency: 'EUR',
    template: '{base}',
    active: true,
  },
  {
    currency: 'GBP',
    template: '{base}',
    active: true,
  },
  {
    currency: 'JPY',
    template: '{base}',
    active: true,
  },
  {
    assetClass: 'currency',
    template: '{base}{quote}',
    active: true,
  },
  {
    template: '{base}',
    active: true,
  },
]

export const ibkrMarketProviderConfig: MarketProviderConfig = {
  id: 'ibkr',
  name: 'IBKR',
  utcOffset: 0,
  availability,
  params: {
    shared: [],
    series: [],
  },
  api_endpoints: {
    default: '/iserver/marketdata',
  },
  capabilities: {
    series: {
      supportsInterval: true,
      intervals: ['1m', '5m', '15m', '30m', '1h', '1d', '1w', '1mo'],
      windowModes: ['range', 'bars', 'absolute'],
      normalizationModes: ['raw'],
      marketSessions: ['regular'],
      retention: {
        byInterval: {
          '1m': { maxRangeDays: 30 },
          '5m': { maxRangeDays: 30 },
          '15m': { maxRangeDays: 30 },
          '30m': { maxRangeDays: 30 },
          '1h': { maxRangeDays: 30 },
        },
      },
    },
    live: {
      channels: ['quote-snapshots'],
      supportsInterval: false,
      // IBKR enforces hard pacing limits; 5s per widget invites a block.
      pollingIntervalMs: 15_000,
    },
  },
  rulePrecedence: {
    default: ['market', 'currency', 'assetClass', 'country', 'city', 'listing'],
    stock: ['market', 'currency', 'country', 'city', 'listing'],
    etf: ['market', 'currency', 'country', 'city', 'listing'],
    indice: ['market', 'currency', 'country', 'city', 'listing'],
    mutualfund: ['market', 'currency', 'country', 'city', 'listing'],
    future: ['market', 'currency', 'country', 'city', 'listing'],
    crypto: ['currency', 'market', 'country', 'city', 'listing'],
    currency: ['currency', 'market', 'country', 'city', 'listing'],
  },
  exchangeCodeToMarket: exchangeCodeToMarketMap,
  marketToExchangeCode: marketToExchangeCodeMap,
  exchangeCodes: exchangeCodesList,
  rules: ibkrMarketSymbolRules,
}
