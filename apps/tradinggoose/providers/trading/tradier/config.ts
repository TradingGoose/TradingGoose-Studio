import type { AssetClass } from '@/providers/market/types'
import type { TradingProviderConfig } from '@/providers/trading/providers'
import { tradierTradingSymbolRules } from '@/providers/trading/tradier/rules'

const availableAssetClasses: AssetClass[] = ['stock', 'etf']

const availability: TradingProviderConfig['availability'] = {
  assetClass: availableAssetClasses,
  order: true,
  holdings: true,
}

const params: TradingProviderConfig['params'] = {
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

const exchangeCodeToMarketMap: TradingProviderConfig['exchangeCodeToMarket'] = {}
const marketToExchangeCodeMap: TradingProviderConfig['marketToExchangeCode'] = {}

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
      performanceWindows: ['1W', '1M', 'YTD', '1Y', 'MAX'],
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
  rules: tradierTradingSymbolRules,
}
