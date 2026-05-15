import type { AssetClass } from '@/providers/market/types'
import { alpacaTradingSymbolRules } from '@/providers/trading/alpaca/rules'
import type { TradingProviderConfig } from '@/providers/trading/providers'

export const ALPACA_LIVE_TRADING_BASE_URL = 'https://api.alpaca.markets'
export const ALPACA_PAPER_TRADING_BASE_URL = 'https://paper-api.alpaca.markets'

export const resolveAlpacaTradingBaseUrl = (environment?: string | null) =>
  environment === 'paper' ? ALPACA_PAPER_TRADING_BASE_URL : ALPACA_LIVE_TRADING_BASE_URL

const availableAssetClasses: AssetClass[] = ['stock', 'crypto']
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

const exchangeCodesList: TradingProviderConfig['exchangeCodes'] = [
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

const exchangeCodeToMarketMap: TradingProviderConfig['exchangeCodeToMarket'] = {
  A: 'NYSE',
  B: 'NASDAQ',
  C: 'NYSE',
  J: 'CBOE',
  K: 'CBOE',
  M: 'NYSE',
  N: 'NYSE',
  P: 'NYSE',
  Q: 'NASDAQ',
  W: 'CBOE',
  X: 'NASDAQ',
  Y: 'CBOE',
  Z: 'CBOE',
}

const marketToExchangeCodeMap: TradingProviderConfig['marketToExchangeCode'] = {
  NASDAQ: 'Q',
  NYSE: 'N',
  CBOE: 'J',
}

const availability: TradingProviderConfig['availability'] = {
  assetClass: availableAssetClasses,
  order: true,
  holdings: true,
  availableCurrencyBase: [],
  availableCurrencyQuote: [],
  availableCryptoBase: availableCryptoBaseCodes,
  availableCryptoQuote: availableCryptoQuoteCodes,
}

export const alpacaTradingProviderConfig: TradingProviderConfig = {
  id: 'alpaca',
  name: 'Alpaca',
  availability,
  capabilities: {
    order: {
      sizingModes: [
        { id: 'quantity', label: 'Quantity (Shares)' },
        {
          id: 'notional',
          label: 'Dollar Amount (USD)',
          orderTypes: ['market', 'limit', 'stop', 'stop_limit'],
          timeInForce: ['day'],
        },
      ],
      orderTypes: [
        {
          id: 'market',
          label: 'Market',
          assetClasses: ['stock', 'crypto'],
        },
        {
          id: 'limit',
          label: 'Limit',
          assetClasses: ['stock', 'crypto'],
          requires: ['limitPrice'],
        },
        {
          id: 'stop',
          label: 'Stop',
          assetClasses: ['stock'],
          requires: ['stopPrice'],
        },
        {
          id: 'stop_limit',
          label: 'Stop Limit',
          assetClasses: ['stock', 'crypto'],
          requires: ['limitPrice', 'stopPrice'],
        },
        {
          id: 'trailing_stop',
          label: 'Trailing Stop',
          assetClasses: ['stock'],
          requiresOneOf: ['trailPrice', 'trailPercent'],
          excludes: ['limitPrice', 'stopPrice'],
        },
      ],
      timeInForce: ['day', 'gtc', 'ioc', 'fok'],
    },
    holdings: {
      performanceWindows: ['1D', '1W', '1M', '3M', 'YTD', '1Y'],
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
  rules: alpacaTradingSymbolRules,
}
