import exchangeCodes from '@/providers/market/finnhub/exchangeCodes.json'
import exchangeCodeToMarket from '@/providers/market/finnhub/exchangeCodeToMarket.json'
import marketToExchangeCode from '@/providers/market/finnhub/marketToExchangeCode.json'
import { finnhubSymbolRules } from '@/providers/market/finnhub/rules'
import type { MarketProviderConfig } from '@/providers/market/providers'
import type { AssetClass } from '@/providers/market/types'

const availableAssetClasses: AssetClass[] = [
  'stock',
  'etf',
  'indice',
  'mutualfund',
  'crypto',
  'currency',
]

const availableListingQuoteCodes = ['USD', 'EUR']
const availableCurrencyBaseCodes = availableListingQuoteCodes
const availableCurrencyQuoteCodes = availableListingQuoteCodes
const availableCryptoBaseCodes = availableListingQuoteCodes
const availableCryptoQuoteCodes = availableListingQuoteCodes
const supportsCurrency = availableAssetClasses.includes('currency')
const supportsCrypto = availableAssetClasses.includes('crypto')

const availability: MarketProviderConfig['availability'] = {
  assetClass: availableAssetClasses,
  availableListingQuote: availableListingQuoteCodes,
  availableCurrencyBase: supportsCurrency ? availableCurrencyBaseCodes : [],
  availableCurrencyQuote: supportsCurrency ? availableCurrencyQuoteCodes : [],
  availableCryptoBase: supportsCrypto ? availableCryptoBaseCodes : [],
  availableCryptoQuote: supportsCrypto ? availableCryptoQuoteCodes : [],
  series: true,
  live: true,
}

const params: MarketProviderConfig['params'] = {
  shared: [
    {
      id: 'apiKey',
      type: 'string',
      title: 'API Key',
      description: 'Finnhub API key.',
      placeholder: 'FINNHUB_API_KEY',
      required: true,
      visibility: 'user-only',
      password: true,
    },
  ],
}

const exchangeCodesList: MarketProviderConfig['exchangeCodes'] = exchangeCodes

const exchangeCodeToMarketMap: MarketProviderConfig['exchangeCodeToMarket'] = exchangeCodeToMarket
const marketToExchangeCodeMap: MarketProviderConfig['marketToExchangeCode'] = marketToExchangeCode

export const finnhubProviderConfig: MarketProviderConfig = {
  id: 'finnhub',
  name: 'Finnhub',
  utcOffset: 0,
  availability,
  params,
  api_endpoints: {
    default: 'https://finnhub.io/api/v1/stock/candle',
    currency: 'https://finnhub.io/api/v1/forex/candle',
    crypto: 'https://finnhub.io/api/v1/crypto/candle',
  },
  capabilities: {
    series: {
      supportsInterval: true,
      intervals: ['1m', '5m', '15m', '30m', '1h', '1d', '1w', '1mo'],
      windowModes: ['range', 'bars', 'absolute'],
      normalizationModes: [],
      marketSessions: ['regular'],
      retention: {
        byInterval: {
          '1m': { maxRangeDays: 365 },
          '5m': { maxRangeDays: 365 },
          '15m': { maxRangeDays: 365 },
          '30m': { maxRangeDays: 365 },
          '1h': { maxRangeDays: 365 },
        },
      },
    },
    live: {
      supportsStreaming: true,
      channels: ['trades', 'bars'],
      supportsInterval: false,
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
  rules: finnhubSymbolRules,
}
