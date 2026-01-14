import type { TradingProviderConfig } from '@/providers/trading/providers'
import { tradierTradingSymbolRules } from '@/providers/trading/tradier/rules'
import type { AssetClass } from '@/providers/market/types'

const availableAssetClasses: AssetClass[] = ['stock', 'etf']

const availability: TradingProviderConfig['availability'] = {
  assetClass: availableAssetClasses,
  order: true,
  holdings: true,
}

const params: TradingProviderConfig['params'] = {
  shared: [
    {
      id: 'accessToken',
      type: 'string',
      title: 'Access Token',
      description: 'OAuth access token (injected from credential).',
      required: false,
      visibility: 'hidden',
      password: true,
    },
    {
      id: 'accountId',
      type: 'string',
      title: 'Account ID',
      description: 'Account number used in Tradier endpoints.',
      required: true,
      visibility: 'user-or-llm',
    },
  ],
}

const exchangeCodeToMicMap: TradingProviderConfig['exchangeCodeToMic'] = {}
const micToExchangeCodeMap: TradingProviderConfig['micToExchangeCode'] = {}

export const tradierTradingProviderConfig: TradingProviderConfig = {
  id: 'tradier',
  name: 'Tradier',
  availability,
  params,
  api_endpoints: {
    default: 'https://api.tradier.com/v1',
    order: 'https://api.tradier.com/v1/accounts/{accountId}/orders',
    holdings: 'https://api.tradier.com/v1/accounts/{accountId}/positions',
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
  rules: tradierTradingSymbolRules,
}
