import type { TradingProviderConfig } from '@/providers/trading/providers'
import { robinhoodTradingSymbolRules } from '@/providers/trading/robinhood/rules'
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
      id: 'accountUrl',
      type: 'string',
      title: 'Account URL',
      description: 'Account resource URL (optional if default account is used).',
      required: false,
      visibility: 'user-or-llm',
    },
  ],
  order: [
    {
      id: 'quantity',
      type: 'number',
      title: 'Quantity (Shares)',
      description: 'Number of shares to trade.',
      required: false,
      visibility: 'user-or-llm',
    },
    {
      id: 'instrumentUrl',
      type: 'string',
      title: 'Instrument URL',
      description:
        'Instrument resource URL for the symbol (can be retrieved via /instruments?symbol=SYMBOL).',
      required: true,
      visibility: 'user-or-llm',
    },
  ],
}

const exchangeCodeToMicMap: TradingProviderConfig['exchangeCodeToMic'] = {}
const micToExchangeCodeMap: TradingProviderConfig['micToExchangeCode'] = {}

export const robinhoodTradingProviderConfig: TradingProviderConfig = {
  id: 'robinhood',
  name: 'Robinhood',
  availability,
  params,
  api_endpoints: {
    order: 'https://api.robinhood.com/orders/',
    holdings: 'https://api.robinhood.com/positions/',
  },
  capabilities: {
    order: {
      orderTypes: ['market', 'limit', 'stop', 'stop_limit'],
      timeInForce: ['gfd', 'gtc', 'ioc', 'fok'],
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
  rules: robinhoodTradingSymbolRules,
}
