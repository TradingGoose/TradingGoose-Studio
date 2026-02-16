import { createLogger } from '@/lib/logs/console/logger'
import { resolveListingKey, toListingValueObject } from '@/lib/listing/identity'
import { getBaseUrl } from '@/lib/urls/utils'
import { executeTradingProviderRequest, getTradingProvider } from '@/providers/trading'
import type { ToolConfig } from '@/tools/types'
import type {
  OrderSubmit,
  OrderSubmitRequest,
  OrderSubmitResponse,
  TradingActionParams,
  TradingActionResponse,
} from '@/tools/trading/types'

const logger = createLogger('TradingActionTool')

const ORDER_HISTORY_OMIT_KEYS = new Set([
  'provider',
  'environment',
  'side',
  'listing',
  'quantity',
  'notional',
  'orderType',
  'limitPrice',
  'stopPrice',
  'trailPrice',
  'trailPercent',
  'timeInForce',
  'orderSizingMode',
  'orderClass',
  'credential',
  'accessToken',
  'apiKey',
  'apiSecret',
  'tradierCredential',
  'robinhoodCredential',
  'alpacaCredential',
  '_context',
  '_workflowId',
  '_credentialId',
])

const extractProviderParams = (params: TradingActionParams): Record<string, unknown> => {
  const extras: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(params as Record<string, unknown>)) {
    if (ORDER_HISTORY_OMIT_KEYS.has(key) || key.startsWith('_')) continue
    if (value !== undefined) {
      extras[key] = value
    }
  }
  return extras
}

const buildOrderSubmitRequest = (params: TradingActionParams): OrderSubmitRequest => {
  const providerParams = extractProviderParams(params)
  const normalized = normalizeOrderSizing(params)
  return {
    side: params.side,
    orderType: params.orderType,
    timeInForce: params.timeInForce,
    quantity: normalized.quantity,
    notional: normalized.notional,
    limitPrice: normalizeSizingValue(params.limitPrice),
    stopPrice: normalizeSizingValue(params.stopPrice),
    trailPrice: normalizeSizingValue(params.trailPrice),
    trailPercent: normalizeSizingValue(params.trailPercent),
    orderSizingMode: params.orderSizingMode,
    orderClass: params.orderClass,
    providerParams: Object.keys(providerParams).length ? providerParams : undefined,
  }
}

const buildOrderSubmitResponse = (
  normalizedOrder: Record<string, any> | undefined,
  rawOrder: Record<string, any> | undefined,
  success = true,
  errorMessage?: string | null
): OrderSubmitResponse => {
  const orderId =
    normalizedOrder?.id ?? rawOrder?.id ?? rawOrder?.order_id ?? rawOrder?.order?.id ?? null
  const clientOrderId =
    rawOrder?.client_order_id ??
    rawOrder?.clientOrderId ??
    rawOrder?.order?.client_order_id ??
    null
  const createdAt =
    rawOrder?.created_at ??
    rawOrder?.create_date ??
    rawOrder?.createdAt ??
    rawOrder?.order?.created_at ??
    rawOrder?.order?.create_date ??
    null
  const submittedAt =
    normalizedOrder?.submittedAt ??
    rawOrder?.submitted_at ??
    rawOrder?.submittedAt ??
    rawOrder?.order?.submitted_at ??
    null
  const symbol = normalizedOrder?.symbol ?? rawOrder?.symbol ?? rawOrder?.order?.symbol ?? null
  const status =
    normalizedOrder?.status ??
    rawOrder?.status ??
    rawOrder?.state ??
    rawOrder?.order?.status ??
    null

  return {
    success,
    orderId,
    clientOrderId,
    createdAt,
    submittedAt,
    symbol,
    status,
    errorMessage: errorMessage ?? null,
    raw: rawOrder ?? normalizedOrder,
  }
}

const normalizeSizingValue = (value: unknown): number | undefined => {
  if (value === null || value === undefined) return undefined
  if (typeof value === 'string' && value.trim() === '') return undefined
  const parsed = typeof value === 'string' ? Number(value) : value
  return typeof parsed === 'number' && Number.isFinite(parsed) ? parsed : undefined
}

const resolveOrderSizingMode = (
  mode: unknown
): TradingActionParams['orderSizingMode'] | undefined => {
  if (mode === 'quantity' || mode === 'notional') return mode
  if (typeof mode !== 'string') return undefined

  const normalized = mode.trim().toLowerCase()
  if (normalized === 'quantity' || normalized === 'notional') return normalized
  return undefined
}

const normalizeOrderSizing = (params: TradingActionParams): TradingActionParams => {
  const quantity = normalizeSizingValue(params.quantity)
  const notional = normalizeSizingValue(params.notional)
  const orderSizingMode = resolveOrderSizingMode(params.orderSizingMode)

  if (orderSizingMode === 'notional') {
    return {
      ...params,
      orderSizingMode,
      quantity: undefined,
      notional,
    }
  }

  if (orderSizingMode === 'quantity') {
    return {
      ...params,
      orderSizingMode,
      quantity,
      notional: undefined,
    }
  }

  return {
    ...params,
    quantity,
    notional: quantity !== undefined ? undefined : notional,
  }
}

const validateOrderSizing = (params: TradingActionParams) => {
  const hasQuantity = params.quantity !== undefined && params.quantity !== null
  const hasNotional = params.notional !== undefined && params.notional !== null
  const orderSizingMode = resolveOrderSizingMode(params.orderSizingMode)

  if (params.provider === 'alpaca') {
    if (orderSizingMode === 'quantity' && !hasQuantity) {
      throw new Error('Alpaca orders require qty when orderSizingMode=quantity.')
    }
    if (orderSizingMode === 'notional' && !hasNotional) {
      throw new Error('Alpaca orders require notional when orderSizingMode=notional.')
    }
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
    orderClass: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Order class for providers that support it (e.g., equity, option, multileg).',
    },
    orderType: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Order type (provider-specific, e.g., market, limit, stop, stop_limit, trailing_stop, debit, credit, even).',
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
    trailPrice: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Trailing stop price offset (Alpaca trailing_stop).',
    },
    trailPercent: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Trailing stop percent offset (Alpaca trailing_stop).',
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

  postProcess: async (result, params) => {
    try {
      const normalizedOrder =
        result.output && typeof result.output === 'object'
          ? (result.output as any).order
          : undefined
      const rawOrder =
        normalizedOrder && typeof normalizedOrder === 'object' && 'raw' in normalizedOrder
          ? (normalizedOrder as any).raw
          : normalizedOrder

      const listingIdentity = toListingValueObject(params.listing)
      const listingKey = resolveListingKey(params.listing)
      const listingId =
        params.listing &&
        typeof params.listing === 'object' &&
        'id' in params.listing &&
        (params.listing as any).id
          ? String((params.listing as any).id)
          : undefined

      const errorPayload = result.success
        ? undefined
        : {
            error: result.error,
            output: result.output,
          }
      const responsePayload = buildOrderSubmitResponse(
        normalizedOrder as Record<string, any> | undefined,
        (rawOrder as Record<string, any> | undefined) ?? (errorPayload as any),
        result.success,
        result.success ? undefined : result.error
      )

      const context = (params as any)._context as
        | { workflowId?: string; executionId?: string }
        | undefined

      const orderSubmit: OrderSubmit = {
        provider: params.provider,
        environment: params.environment,
        recordedAt: new Date().toISOString(),
        workflowId: context?.workflowId ?? (params as any)._workflowId,
        workflowExecutionId: context?.executionId,
        listingId,
        listingKey,
        listingType: listingIdentity?.listing_type,
        listingIdentity,
        request: buildOrderSubmitRequest(params),
        response: responsePayload,
        normalizedOrder: normalizedOrder as Record<string, any> | undefined,
      }

      const baseUrl = getBaseUrl()
      const recordUrl = new URL('/api/tools/trading/order-history', baseUrl).toString()

      await fetch(recordUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(orderSubmit),
      })
    } catch (error: any) {
      logger.warn('Failed to record order history entry', {
        error: error instanceof Error ? error.message : String(error),
      })
    }

    return result
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
