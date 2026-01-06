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

const availableCurrencyCodes = ['USD', 'EUR']

const availability: MarketProviderConfig['availability'] = {
  assetClass: availableAssetClasses,
  currency: availableCurrencyCodes,
  series: true,
  news: true,
  sentiments: false,
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
  availability,
  params,
  capabilities: {
    series: {
      supportsInterval: true,
      intervals: ['1', '5', '15', '30', '60', 'D', 'W', 'M'],
      supportsStartEnd: true,
    },
    news: {
      supportsStartEnd: true,
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
