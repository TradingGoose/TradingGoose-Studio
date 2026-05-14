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
      sizingModes: [{ id: 'quantity', label: 'Quantity' }],
      preview: true,
      orderTypes: [
        {
          id: 'market',
          label: 'Market',
        },
        {
          id: 'limit',
          label: 'Limit',
          requires: ['limitPrice'],
        },
        {
          id: 'stop',
          label: 'Stop',
          requires: ['stopPrice'],
        },
        {
          id: 'stop_limit',
          label: 'Stop Limit',
          requires: ['limitPrice', 'stopPrice'],
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
