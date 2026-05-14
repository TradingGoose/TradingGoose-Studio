import type { AssetClass } from '@/providers/market/types'
import type { TradingProviderConfig } from '@/providers/trading/providers'
import { tradierTradingSymbolRules } from '@/providers/trading/tradier/rules'

const availableAssetClasses: AssetClass[] = ['stock', 'etf']

const availability: TradingProviderConfig['availability'] = {
  assetClass: availableAssetClasses,
  order: true,
  holdings: true,
}

const exchangeCodeToMarketMap: TradingProviderConfig['exchangeCodeToMarket'] = {}
const marketToExchangeCodeMap: TradingProviderConfig['marketToExchangeCode'] = {}

export const tradierTradingProviderConfig: TradingProviderConfig = {
  id: 'tradier',
  name: 'Tradier',
  availability,
  capabilities: {
    order: {
      orderMethods: [
        { id: 'equity', label: 'Equity' },
        { id: 'option', label: 'Option', requires: ['optionSymbol'] },
        { id: 'multileg', label: 'Multileg', requires: ['legs'] },
        { id: 'combo', label: 'Combo', requires: ['legs'] },
      ],
      sizingModes: [{ id: 'quantity', label: 'Quantity' }],
      preview: true,
      orderTypes: [
        {
          id: 'market',
          label: 'Market',
          orderMethods: ['equity', 'option', 'multileg', 'combo'],
        },
        {
          id: 'limit',
          label: 'Limit',
          orderMethods: ['equity', 'option'],
          requires: ['limitPrice'],
        },
        {
          id: 'stop',
          label: 'Stop',
          orderMethods: ['equity', 'option'],
          requires: ['stopPrice'],
        },
        {
          id: 'stop_limit',
          label: 'Stop Limit',
          orderMethods: ['equity', 'option'],
          requires: ['limitPrice', 'stopPrice'],
        },
        {
          id: 'debit',
          label: 'Debit',
          orderMethods: ['multileg', 'combo'],
          requires: ['limitPrice'],
        },
        {
          id: 'credit',
          label: 'Credit',
          orderMethods: ['multileg', 'combo'],
          requires: ['limitPrice'],
        },
        {
          id: 'even',
          label: 'Even',
          orderMethods: ['multileg', 'combo'],
          requires: ['limitPrice'],
        },
      ],
      timeInForce: ['day', 'gtc', 'pre', 'post'],
    },
    holdings: {
      performanceWindows: ['1W', '1M', 'YTD', '1Y', 'MAX'],
    },
  },
  rulePrecedence: {
    default: ['market', 'currency', 'assetClass', 'country', 'city', 'listing'],
    stock: ['market', 'currency', 'country', 'city', 'listing'],
    etf: ['market', 'currency', 'country', 'city', 'listing'],
  },
  exchangeCodeToMarket: exchangeCodeToMarketMap,
  marketToExchangeCode: marketToExchangeCodeMap,
  exchangeCodes: [],
  rules: tradierTradingSymbolRules,
}
