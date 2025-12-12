import { createLogger } from '@/lib/logs/console/logger'
import { getTradingProvider } from '@/trading_providers'
import type { ToolConfig } from '@/tools/types'
import type { TradingActionParams, TradingActionResponse } from '@/tools/trading/types'

const logger = createLogger('TradingActionTool')

const buildOrderRequest = (params: TradingActionParams) => {
  const provider = getTradingProvider(params.provider)
  const request = provider.buildOrderRequest(params)
  logger.info(`Building order request for ${provider.id}`, {
    orderType: params.orderType || provider.defaults?.orderType || 'market',
    timeInForce: params.timeInForce || provider.defaults?.timeInForce,
  })
  return request
}

const resolveOrderRequest = (params: TradingActionParams) => {
  const cacheKey = '_tradingOrderRequest'
  const existing = (params as any)[cacheKey]
  if (existing) return existing
  const built = buildOrderRequest(params)
  ;(params as any)[cacheKey] = built
  return built
}

export const tradingActionTool: ToolConfig<TradingActionParams, TradingActionResponse> = {
  id: 'trading_place_order',
  name: 'Trading: Place Order',
  description: 'Place buy or sell orders via Alpaca, Tradier, or Robinhood.',
  version: '1.0.0',

  params: {
    provider: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Trading provider id (alpaca, tradier, or robinhood).',
    },
    symbol: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Ticker symbol to trade (e.g., AAPL).',
    },
    side: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Order side: buy or sell.',
    },
    quantity: {
      type: 'number',
      required: true,
      visibility: 'user-or-llm',
      description: 'Quantity of shares to trade.',
    },
    orderType: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Order type (market, limit, stop, stop_limit).',
    },
    timeInForce: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Time in force (day, gtc, gfd, etc.).',
    },
    limitPrice: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Limit price (required for limit orders).',
    },
    stopPrice: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Stop price (required for stop/stop_limit orders).',
    },
    environment: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Trading environment for Alpaca (paper or live).',
    },
    accessToken: {
      type: 'string',
      required: false,
      visibility: 'hidden',
      description: 'OAuth access token (Tradier/Robinhood).',
    },
    apiKey: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'API key (Alpaca).',
    },
    apiSecret: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'API secret (Alpaca).',
    },
    accountId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Account ID (Tradier).',
    },
    accountUrl: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Account resource URL (Robinhood).',
    },
    instrumentUrl: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Instrument resource URL for Robinhood orders.',
    },
  },

  request: {
    url: (params) => resolveOrderRequest(params).url,
    method: (params) => resolveOrderRequest(params).method,
    headers: (params) => resolveOrderRequest(params).headers,
    body: (params) => resolveOrderRequest(params).body,
  },

  transformResponse: async (response, params) => {
    const provider = getTradingProvider(params.provider)
    const raw = await response.json().catch(() => ({}))
    const normalized = provider.normalizeOrder ? provider.normalizeOrder(raw) : { raw }

    return {
      success: true,
      output: {
        summary: `Order submitted to ${provider.name}`,
        provider: provider.id,
        order: normalized,
      },
    }
  },

  outputs: {
    summary: { type: 'string', description: 'Status message for the order submission.' },
    provider: { type: 'string', description: 'Broker/provider used for the order.' },
    order: { type: 'json', description: 'Normalized order details and raw response.' },
  },
}
