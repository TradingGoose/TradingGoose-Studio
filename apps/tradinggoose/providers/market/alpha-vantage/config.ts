import type { MarketProviderConfig } from '@/providers/market/providers'
import { alphaVantageSymbolRules } from '@/providers/market/alpha-vantage/rules'
import { AssetClass } from '@/providers/market/types'

const availableAssetClasses: AssetClass[] = ['stock', 'etf', 'currency', 'crypto']

const supportsCurrency = availableAssetClasses.includes('currency')
const supportsCrypto = availableAssetClasses.includes('crypto')

const availability: MarketProviderConfig['availability'] = {
  assetClass: availableAssetClasses,
  availableListingQuote: [],
  availableCurrencyBase: supportsCurrency ? [] : [],
  availableCurrencyQuote: supportsCurrency ? [] : [],
  availableCryptoBase: supportsCrypto ? [] : [],
  availableCryptoQuote: supportsCrypto ? [] : [],
  series: true,
  live: false,
}

const params: MarketProviderConfig['params'] = {
  shared: [
    {
      id: 'apiKey',
      type: 'string',
      title: 'API Key',
      description: 'Alpha Vantage API key.',
      placeholder: 'ALPHAVANTAGE_API_KEY',
      required: true,
      visibility: 'user-only',
      password: true,
    },
  ],
  series: [
    // Alpha Vantage output size is selected automatically based on the requested range.
  ],
}

const exchangeCodesList: MarketProviderConfig['exchangeCodes'] = []

const exchangeCodeToMarketMap: MarketProviderConfig['exchangeCodeToMarket'] = {}
const marketToExchangeCodeMap: MarketProviderConfig['marketToExchangeCode'] = {}

export const alphaVantageProviderConfig: MarketProviderConfig = {
  id: 'alpha-vantage',
  name: 'Alpha Vantage',
  utcOffset: 0,
  availability,
  params,
  api_endpoints: {
    default: 'https://www.alphavantage.co/query',
  },
  capabilities: {
    series: {
      supportsInterval: true,
      intervals: ['1m', '5m', '15m', '30m', '1h', '1d', '1w', '1mo'],
      windowModes: ['range', 'bars', 'absolute'],
      normalizationModes: ['raw', 'adjusted', 'split_adjusted', 'total_return'],
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
  rules: alphaVantageSymbolRules,
}
