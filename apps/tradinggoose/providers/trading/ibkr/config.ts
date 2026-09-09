import type { AssetClass } from '@/providers/market/types'
import { ibkrTradingSymbolRules } from '@/providers/trading/ibkr/rules'
import type { TradingProviderConfig } from '@/providers/trading/providers'

export const IBKR_DEFAULT_API_BASE_URL = 'http://127.0.0.1:5000/v1/api'
export const IBKR_HOSTED_API_BASE_URL = 'https://api.ibkr.com/v1/api'
export const IBKR_DEFAULT_TOKEN_ENDPOINT = 'https://api.ibkr.com/v1/api/oauth2/token'
export const IBKR_DEFAULT_API_IP = '127.0.0.1'

export const resolveIbkrApiBaseUrl = (): string =>
  process.env.IBKR_API_BASE_URL?.trim() || IBKR_DEFAULT_API_BASE_URL

export const resolveIbkrTokenEndpoint = (): string =>
  process.env.IBKR_TOKEN_ENDPOINT?.trim() || IBKR_DEFAULT_TOKEN_ENDPOINT

export const resolveIbkrApiIp = (): string => process.env.IBKR_API_IP?.trim() || IBKR_DEFAULT_API_IP

const availableAssetClasses: AssetClass[] = [
  'stock',
  'etf',
  'future',
  'currency',
  'indice',
  'mutualfund',
]

const availability: TradingProviderConfig['availability'] = {
  assetClass: availableAssetClasses,
  order: true,
  portfolioDetail: true,
  availableCurrencyBase: [],
  availableCurrencyQuote: [],
  availableCryptoBase: [],
  availableCryptoQuote: [],
}

export const ibkrTradingProviderConfig: TradingProviderConfig = {
  id: 'ibkr',
  name: 'IBKR',
  availability,
  capabilities: {
    order: {
      sizingModes: [{ id: 'quantity', label: 'Quantity (Shares / Contracts)' }],
      orderTypes: [
        {
          id: 'market',
          label: 'Market',
          assetClasses: ['stock', 'etf', 'future', 'currency', 'indice', 'mutualfund'],
        },
        {
          id: 'limit',
          label: 'Limit',
          assetClasses: ['stock', 'etf', 'future', 'currency', 'indice', 'mutualfund'],
          requires: ['limitPrice'],
        },
        {
          id: 'stop',
          label: 'Stop',
          assetClasses: ['stock', 'etf', 'future', 'currency', 'indice', 'mutualfund'],
          requires: ['stopPrice'],
        },
        {
          id: 'stop_limit',
          label: 'Stop Limit',
          assetClasses: ['stock', 'etf', 'future', 'currency', 'indice', 'mutualfund'],
          requires: ['limitPrice', 'stopPrice'],
        },
        {
          id: 'trailing_stop',
          label: 'Trailing Stop',
          assetClasses: ['stock', 'etf', 'future', 'currency', 'indice', 'mutualfund'],
          requiresOneOf: ['trailPrice', 'trailPercent'],
          excludes: ['limitPrice', 'stopPrice'],
        },
      ],
      timeInForce: ['day', 'gtc', 'ioc', 'fok', 'gtd'],
    },
    portfolioDetail: {
      performanceWindows: ['1W', '1M', '3M', 'YTD', '1Y', 'MAX'],
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
  exchangeCodeToMarket: {},
  marketToExchangeCode: {},
  exchangeCodes: [],
  rules: ibkrTradingSymbolRules,
}
