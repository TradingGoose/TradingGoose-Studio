import type { AssetClass } from '@/providers/market/types'
import { alpacaTradingSymbolRules } from '@/providers/trading/alpaca/rules'
import type { TradingProviderConfig } from '@/providers/trading/providers'

const availableAssetClasses: AssetClass[] = ['stock']
const supportsCrypto = availableAssetClasses.includes('crypto')
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
  availableCryptoBase: supportsCrypto ? availableCryptoBaseCodes : [],
  availableCryptoQuote: supportsCrypto ? availableCryptoQuoteCodes : [],
}

const params: TradingProviderConfig['params'] = {
  shared: [
    {
      id: 'apiKey',
      type: 'string',
      title: 'API Key',
      description: 'Alpaca API key ID.',
      placeholder: 'APCA-API-KEY-ID',
      required: false,
      visibility: 'hidden',
      password: true,
    },
    {
      id: 'apiSecret',
      type: 'string',
      title: 'API Secret',
      description: 'Alpaca API secret key.',
      placeholder: 'APCA-API-SECRET-KEY',
      required: false,
      visibility: 'hidden',
      password: true,
    },
    {
      id: 'environment',
      type: 'string',
      title: 'Environment',
      description: 'Trading environment (paper or live).',
      required: false,
      visibility: 'user-only',
      inputType: 'dropdown',
      options: [
        { id: 'paper', label: 'Paper' },
        { id: 'live', label: 'Live' },
      ],
    },
  ],
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
    default: 'https://api.alpaca.markets',
    order: 'https://api.alpaca.markets/v2/orders',
    holdings: 'https://api.alpaca.markets/v2/positions',
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
