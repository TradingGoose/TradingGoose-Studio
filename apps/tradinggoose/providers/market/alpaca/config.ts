import type { MarketProviderConfig, MarketProviderParamDefinition } from '@/providers/market/providers'
import { alpacaSymbolRules } from '@/providers/market/alpaca/rules'
import { AssetClass } from '@/providers/market/types'

const availableAssetClasses: AssetClass[] = ['stock', 'etf', 'crypto']

const supportsCrypto = availableAssetClasses.includes('crypto')
const availableListingQuoteCodes = ['USD']
const availableCryptoQuoteCodes = ['USD', 'USDC', 'USDT', 'BTC']
const availableCryptoBaseCodes = [
  'AAVE',
  'AVAX',
  'BAT',
  'BCH',
  'BTC',
  'CRV',
  'DOGE',
  'DOT',
  'ETH',
  'GRT',
  'LINK',
  'LTC',
  'SHIB',
  'SKY',
  'SUSHI',
  'UNI',
  'USDC',
  'USDT',
  'XRP',
  'XTZ',
  'YFI',
]
const availability: MarketProviderConfig['availability'] = {
  assetClass: availableAssetClasses,
  availableListingQuote: availableListingQuoteCodes,
  availableCurrencyBase: [],
  availableCurrencyQuote: [],
  availableCryptoBase: supportsCrypto ? availableCryptoBaseCodes : [],
  availableCryptoQuote: supportsCrypto ? availableCryptoQuoteCodes : [],
  series: true,
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
  utcOffset: 0,
  availability,
  params,
  capabilities: {
    series: {
      supportsInterval: true,
      intervals: [
        '1m',
        '2m',
        '3m',
        '5m',
        '10m',
        '15m',
        '30m',
        '45m',
        '1h',
        '2h',
        '3h',
        '1d',
        '1w',
        '1mo',
        '3mo',
        '6mo',
        '12mo',
      ],
      windowModes: ['range', 'bars', 'absolute'],
      normalizationModes: ['raw', 'adjusted', 'split_adjusted'],
      marketSessions: ['regular', 'extended'],
      retention: {
        default: { maxBars: 10000 },
      },
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
