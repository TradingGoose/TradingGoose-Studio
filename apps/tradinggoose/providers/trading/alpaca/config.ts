import type { TradingProviderConfig } from '@/providers/trading/providers'
import { alpacaTradingSymbolRules } from '@/providers/trading/alpaca/rules'
import type { AssetClass } from '@/providers/market/types'

const availableAssetClasses: AssetClass[] = ['stock', 'etf', 'crypto']

const availability: TradingProviderConfig['availability'] = {
  assetClass: availableAssetClasses,
  order: true,
  holdings: true,
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
      visibility: 'user-only',
      password: true,
    },
    {
      id: 'apiSecret',
      type: 'string',
      title: 'API Secret',
      description: 'Alpaca API secret key.',
      placeholder: 'APCA-API-SECRET-KEY',
      required: false,
      visibility: 'user-only',
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
    },
    {
      id: 'notional',
      type: 'number',
      title: 'Dollar Amount (USD)',
      description: 'Dollar amount to trade when sizing by notional.',
      required: false,
      visibility: 'user-or-llm',
    },
  ],
}

const exchangeCodeToMicMap: TradingProviderConfig['exchangeCodeToMic'] = {}
const micToExchangeCodeMap: TradingProviderConfig['micToExchangeCode'] = {}

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
      orderTypes: ['market', 'limit', 'stop', 'stop_limit'],
      timeInForce: ['day', 'gtc', 'ioc', 'fok'],
      supportsLimit: true,
      supportsStop: true,
    },
    holdings: {
      supportsPositions: true,
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
  exchangeCodes: [],
  rules: alpacaTradingSymbolRules,
}
