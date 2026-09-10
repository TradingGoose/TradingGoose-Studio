import { ibkrTradingSymbolRules } from '@/providers/trading/ibkr/rules'
import type { MarketProviderConfig } from '@/providers/market/providers'
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
      pollingIntervalMs: 5_000,
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
  rules: ibkrTradingSymbolRules,
}
