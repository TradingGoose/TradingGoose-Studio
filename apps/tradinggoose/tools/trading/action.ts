import { createLogger } from '@/lib/logs/console/logger'
import { executeTradingProviderRequest, getTradingProvider } from '@/providers/trading'
import type { ToolConfig } from '@/tools/types'
import type { TradingActionParams, TradingActionResponse } from '@/tools/trading/types'

const logger = createLogger('TradingActionTool')

const normalizeSizingValue = (value: unknown): number | undefined => {
  if (value === null || value === undefined) return undefined
  if (typeof value === 'string' && value.trim() === '') return undefined
  const parsed = typeof value === 'string' ? Number(value) : value
  return typeof parsed === 'number' && Number.isFinite(parsed) ? parsed : undefined
}

const normalizeOrderSizing = (params: TradingActionParams): TradingActionParams => {
  const quantity = normalizeSizingValue(params.quantity)
  const notional = normalizeSizingValue(params.notional)

  return {
    ...params,
    quantity,
    notional: quantity !== undefined ? undefined : notional,
  }
}

const validateOrderSizing = (params: TradingActionParams) => {
  const hasQuantity = params.quantity !== undefined && params.quantity !== null
  const hasNotional = params.notional !== undefined && params.notional !== null

  if (params.provider === 'alpaca') {
    if (!hasQuantity && !hasNotional) {
      throw new Error('Quantity or notional is required for Alpaca orders.')
    }
    return
  }

  if (hasNotional) {
    throw new Error('Notional orders are only supported for Alpaca.')
  }
  if (!hasQuantity) {
    throw new Error('Quantity is required for this provider.')
  }
}

const buildOrderRequest = (params: TradingActionParams) => {
  const normalized = normalizeOrderSizing(params)
  validateOrderSizing(normalized)
  const provider = getTradingProvider(normalized.provider)
  const { provider: providerId, ...rest } = normalized
  const request = executeTradingProviderRequest(providerId, { kind: 'order', ...rest })
  logger.info(`Building order request for ${provider.id}`, {
    orderType: normalized.orderType || provider.defaults?.orderType || 'market',
    timeInForce: normalized.timeInForce || provider.defaults?.timeInForce,
    sizing: normalized.notional !== undefined ? 'notional' : 'quantity',
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
    listing: {
      type: 'json',
      required: true,
      visibility: 'user-or-llm',
      description: 'Structured listing payload for the asset to trade.',
    },
    side: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Order side: buy or sell.',
    },
    quantity: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Quantity of shares to trade. Required unless Alpaca notional is provided.',
    },
    notional: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Dollar amount to trade (Alpaca only).',
    },
    orderSizingMode: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Order sizing mode (quantity or notional) for Alpaca.',
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
    credential: {
      type: 'string',
      required: false,
      visibility: 'hidden',
      description: 'OAuth credential id for the selected broker (populated from selected account).',
    },
    tradierCredential: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Tradier OAuth credential id.',
    },
    robinhoodCredential: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Robinhood OAuth credential id.',
    },
    alpacaCredential: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Alpaca OAuth credential id.',
    },
    accessToken: {
      type: 'string',
      required: false,
      visibility: 'hidden',
      description: 'OAuth access token (injected from credential).',
    },
    apiKey: {
      type: 'string',
      required: false,
      visibility: 'hidden',
      description: 'Alpaca API key ID (optional if using OAuth).',
    },
    apiSecret: {
      type: 'string',
      required: false,
      visibility: 'hidden',
      description: 'Alpaca API secret key (optional if using OAuth).',
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
