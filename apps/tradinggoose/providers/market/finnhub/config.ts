import type { MarketProviderConfig } from '@/providers/market/providers'
import exchangeCodeToMic from '@/providers/market/finnhub/exchangeCodeToMic.json'
import micToExchangeCode from '@/providers/market/finnhub/micToExchangeCode.json'
import exchangeCodes from '@/providers/market/finnhub/exchangeCodes.json'
import { finnhubSymbolRules } from '@/providers/market/finnhub/rules'
import { AssetClass } from '@/providers/market/types'

const availableAssetClasses: AssetClass[] = [
  'stock',
  'etf',
  'indice',
  'mutualfund',
  'crypto',
  'currency',
]

const availableEquityQuoteCodes = ['USD', 'EUR']
const availableCurrencyBaseCodes = availableEquityQuoteCodes
const availableCurrencyQuoteCodes = availableEquityQuoteCodes
const availableCryptoBaseCodes = availableEquityQuoteCodes
const availableCryptoQuoteCodes = availableEquityQuoteCodes
const supportsCurrency = availableAssetClasses.includes('currency')
const supportsCrypto = availableAssetClasses.includes('crypto')

const availability: MarketProviderConfig['availability'] = {
  assetClass: availableAssetClasses,
  availableEquityQuote: availableEquityQuoteCodes,
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

const exchangeCodeToMicMap: MarketProviderConfig['exchangeCodeToMic'] = exchangeCodeToMic
const micToExchangeCodeMap: MarketProviderConfig['micToExchangeCode'] = micToExchangeCode

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
      supportsStartEnd: true,
      normalizationModes: [],
    },
    live: {
      supportsStreaming: true,
      channels: ['bars'],
      supportsInterval: false,
    },
  },
  rulePrecedence: {
    default: ['mic', 'currency', 'assetClass', 'country', 'city', 'listing'],
    stock: ['mic', 'currency', 'country', 'city', 'listing'],
    etf: ['mic', 'currency', 'country', 'city', 'listing'],
    indice: ['mic', 'currency', 'country', 'city', 'listing'],
    mutualfund: ['mic', 'currency', 'country', 'city', 'listing'],
    future: ['mic', 'currency', 'country', 'city', 'listing'],
    crypto: ['currency', 'mic', 'country', 'city', 'listing'],
    currency: ['currency', 'mic', 'country', 'city', 'listing'],
  },
  exchangeCodeToMic: exchangeCodeToMicMap,
  micToExchangeCode: micToExchangeCodeMap,
  exchangeCodes: exchangeCodesList,
  rules: finnhubSymbolRules,
}
