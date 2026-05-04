import type { AssetClass } from '@/providers/market/types'
import { alpacaTradingSymbolRules } from '@/providers/trading/alpaca/rules'
import type { TradingProviderConfig } from '@/providers/trading/providers'

export const ALPACA_LIVE_TRADING_BASE_URL = 'https://api.alpaca.markets'
export const ALPACA_PAPER_TRADING_BASE_URL = 'https://paper-api.alpaca.markets'
export const ALPACA_TRADING_BASE_URL = ALPACA_LIVE_TRADING_BASE_URL

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

const params: TradingProviderConfig['params'] = {
  order: [
    {
      id: 'orderSizingMode',
      type: 'string',
      title: 'Order Size',
      description: 'Choose whether to size the order by shares or by dollars.',
      required: true,
      visibility: 'user-or-llm',
      inputType: 'dropdown',
      defaultValue: 'quantity',
      dependsOn: ['provider'],
      displayOrder: 0,
      options: [
        { id: 'quantity', label: 'Quantity (Shares)' },
        { id: 'notional', label: 'Dollar Amount (USD)' },
      ],
    },
    {
      id: 'quantity',
      type: 'number',
      title: 'Quantity (Shares)',
      description: 'Number of shares to trade when sizing by quantity.',
      required: false,
      visibility: 'user-or-llm',
      condition: { field: 'orderSizingMode', value: 'notional', not: true },
      displayOrder: 20,
    },
    {
      id: 'notional',
      type: 'number',
      title: 'Dollar Amount (USD)',
      description: 'Dollar amount to trade when sizing by notional.',
      required: false,
      visibility: 'user-or-llm',
      condition: { field: 'orderSizingMode', value: 'notional' },
      dependsOn: ['provider'],
      displayOrder: 30,
    },
  ],
}

export const alpacaTradingProviderConfig: TradingProviderConfig = {
  id: 'alpaca',
  name: 'Alpaca',
  availability,
  params,
  api_endpoints: {
    default: ALPACA_TRADING_BASE_URL,
    order: `${ALPACA_TRADING_BASE_URL}/v2/orders`,
    holdings: `${ALPACA_TRADING_BASE_URL}/v2/positions`,
  },
  capabilities: {
    order: {
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
          requires: ['trailPrice', 'trailPercent'],
        },
      ],
      timeInForce: ['day', 'gtc', 'ioc', 'fok'],
      supportsLimit: true,
      supportsStop: true,
    },
    holdings: {
      supportsPositions: true,
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
