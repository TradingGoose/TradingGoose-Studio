import type { MarketProviderConfig, MarketProviderParamDefinition } from '@/providers/market/providers'
import { alpacaSymbolRules } from '@/providers/market/alpaca/rules'
import { AssetClass } from '@/providers/market/types'

const availableAssetClasses: AssetClass[] = ['stock', 'etf', 'crypto']

const availableCurrencyCodes = ['USD', 'USDC', 'USDT', 'BTC']
const availability: MarketProviderConfig['availability'] = {
  assetClass: availableAssetClasses,
  currency: availableCurrencyCodes,
  series: true,
  news: false,
  sentiments: false,
  live: true,
}

const authParams: MarketProviderConfig['params'] = {
  shared: [
    {
      id: 'apiKey',
      type: 'string',
      title: 'API Key',
      description: 'Alpaca API key ID.',
      placeholder: 'APCA-API-KEY-ID',
      required: true,
      visibility: 'user-only',
      password: true,
    },
    {
      id: 'apiSecret',
      type: 'string',
      title: 'API Secret',
      description: 'Alpaca API secret key.',
      placeholder: 'APCA-API-SECRET-KEY',
      required: true,
      visibility: 'user-only',
      password: true,
    },
  ],
}

const feedParam: MarketProviderParamDefinition = {
  id: 'feed',
  type: 'string',
  title: 'Feed',
  description: 'Alpaca data feed (required for stock bars).',
  placeholder: 'Select feed',
  required: true,
  visibility: 'user-only',
  inputType: 'dropdown',
  options: [
    { id: 'sip', label: 'SIP' },
    { id: 'iex', label: 'IEX' },
  ],
}

const params: MarketProviderConfig['params'] = {
  ...authParams,
  series: [feedParam],
  live: [
    feedParam,
    {
      id: 'cryptoRegion',
      type: 'string',
      title: 'Crypto Region',
      description: 'Alpaca crypto region (us, us-1, eu-1).',
      placeholder: 'Select region',
      required: false,
      visibility: 'user-only',
      inputType: 'dropdown',
      options: [
        { id: 'us', label: 'US (Alpaca)' },
        { id: 'us-1', label: 'US (Kraken)' },
        { id: 'eu-1', label: 'EU (Kraken)' },
      ],
    },
  ],
}

const exchangeCodesList: MarketProviderConfig['exchangeCodes'] = [
  'A',
  'B',
  'C',
  'D',
  'G',
  'H',
  'I',
  'J',
  'K',
  'L',
  'M',
  'N',
  'P',
  'Q',
  'U',
  'V',
  'W',
  'X',
  'Y',
  'Z',
]

const exchangeCodeToMicMap: MarketProviderConfig['exchangeCodeToMic'] = {
  A: ['XASE'],
  B: ['XBOS'],
  C: ['XCIS'],
  D: ['FINR'],
  G: ['24EQ'],
  H: ['MRPL'],
  I: ['XISE'],
  J: ['EDGA'],
  K: ['EDGX'],
  L: ['LTSE'],
  M: ['XCHI'],
  N: ['XNYS'],
  P: ['ARCX'],
  Q: ['XNAS'],
  U: ['MEMX'],
  V: ['IEXG'],
  W: ['CBSX'],
  X: ['XPSX'],
  Y: ['BATY'],
  Z: ['BATS'],
}

const micToExchangeCodeMap: MarketProviderConfig['micToExchangeCode'] = {
  XASE: 'A',
  XBOS: 'B',
  XCIS: 'C',
  FINR: 'D',
  '24EQ': 'G',
  MRPL: 'H',
  XISE: 'I',
  EDGA: 'J',
  EDGX: 'K',
  LTSE: 'L',
  XCHI: 'M',
  XNYS: 'N',
  ARCX: 'P',
  XNAS: 'Q',
  MEMX: 'U',
  IEXG: 'V',
  CBSX: 'W',
  XPSX: 'X',
  BATY: 'Y',
  BATS: 'Z',
}

export const alpacaProviderConfig: MarketProviderConfig = {
  id: 'alpaca',
  name: 'Alpaca',
  availability,
  params,
  capabilities: {
    series: {
      supportsInterval: true,
      intervals: [
        ...Array.from({ length: 59 }, (_, index) => `${index + 1}Min`),
        ...Array.from({ length: 23 }, (_, index) => `${index + 1}Hour`),
        '1Day',
        '1Week',
        '1Month',
        '2Month',
        '3Month',
        '4Month',
        '6Month',
        '12Month',
      ],
      supportsStartEnd: true,
      normalizationModes: ['raw', 'split', 'dividend', 'spin-off', 'all'],
    },
    live: {
      supportsStreaming: true,
      channels: ['bars', 'trades', 'quotes'],
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
  rules: alpacaSymbolRules,
}
