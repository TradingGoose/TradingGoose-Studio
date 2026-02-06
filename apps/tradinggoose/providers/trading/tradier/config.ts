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
    {
      id: 'environment',
      type: 'string',
      title: 'Environment',
      description: 'Trading environment (paper or live).',
      required: false,
      visibility: 'user-only',
      inputType: 'dropdown',
      options: [
        { id: 'paper', label: 'Paper (Sandbox)' },
        { id: 'live', label: 'Live' },
      ],
    },
  ],
  order: [
    {
      id: 'orderClass',
      type: 'string',
      title: 'Order Class',
      description: 'Tradier order class (equity, option, multileg, or combo).',
      required: false,
      visibility: 'user-or-llm',
      inputType: 'dropdown',
      options: [
        { id: 'equity', label: 'Equity' },
        { id: 'option', label: 'Option' },
        { id: 'multileg', label: 'Multileg' },
        { id: 'combo', label: 'Combo' },
      ],
      defaultValue: 'equity',
      displayOrder: 5,
    },
    {
      id: 'quantity',
      type: 'number',
      title: 'Quantity (Shares)',
      description: 'Number of shares to trade.',
      required: false,
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
      orderTypes: [
        {
          id: 'market',
          label: 'Market',
          orderClasses: ['equity', 'option', 'multileg', 'combo'],
        },
        {
          id: 'limit',
          label: 'Limit',
          orderClasses: ['equity', 'option'],
          requires: ['limitPrice'],
        },
        {
          id: 'stop',
          label: 'Stop',
          orderClasses: ['equity', 'option'],
          requires: ['stopPrice'],
        },
        {
          id: 'stop_limit',
          label: 'Stop Limit',
          orderClasses: ['equity', 'option'],
          requires: ['limitPrice', 'stopPrice'],
        },
        {
          id: 'debit',
          label: 'Debit',
          orderClasses: ['multileg', 'combo'],
          requires: ['limitPrice'],
        },
        {
          id: 'credit',
          label: 'Credit',
          orderClasses: ['multileg', 'combo'],
          requires: ['limitPrice'],
        },
        {
          id: 'even',
          label: 'Even',
          orderClasses: ['multileg', 'combo'],
          requires: ['limitPrice'],
        },
      ],
      timeInForce: ['day', 'gtc', 'pre', 'post'],
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
