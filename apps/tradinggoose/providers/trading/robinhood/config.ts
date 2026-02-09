import type { AssetClass } from '@/providers/market/types'
import type { TradingProviderConfig } from '@/providers/trading/providers'
import { robinhoodTradingSymbolRules } from '@/providers/trading/robinhood/rules'

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

const exchangeCodeToMarketMap: TradingProviderConfig['exchangeCodeToMarket'] = {}
const marketToExchangeCodeMap: TradingProviderConfig['marketToExchangeCode'] = {}

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
      orderTypes: [
        { id: 'market', label: 'Market' },
        { id: 'limit', label: 'Limit', requires: ['limitPrice'] },
        { id: 'stop', label: 'Stop', requires: ['stopPrice'] },
        { id: 'stop_limit', label: 'Stop Limit', requires: ['limitPrice', 'stopPrice'] },
      ],
      timeInForce: ['gfd', 'gtc', 'ioc', 'fok'],
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
  exchangeCodes: [],
  rules: robinhoodTradingSymbolRules,
}
