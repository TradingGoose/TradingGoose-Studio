import type { TradingActionParams, TradingActionResponse } from '@/tools/trading/types'
import type { ToolConfig } from '@/tools/types'

const buildOrderRoutePayload = (params: TradingActionParams) => {
  const payload = {
    workspaceId: params._context?.workspaceId,
    portfolioIdentity: params.portfolioIdentity,
    listing: params.listing,
    side: params.side,
    quantity: params.quantity,
    notional: params.notional,
    orderSizingMode: params.orderSizingMode,
    orderType: params.orderType,
    timeInForce: params.timeInForce,
    limitPrice: params.limitPrice,
    stopPrice: params.stopPrice,
    trailPrice: params.trailPrice,
    trailPercent: params.trailPercent,
    orderClass: params.orderClass,
    accessToken: params.accessToken,
    submissionSource: params._context?.submissionSource,
    logId: params._context?.workflowLogId,
  }
  return Object.fromEntries(Object.entries(payload).filter(([, value]) => value !== undefined))
}

export const tradingActionTool: ToolConfig<TradingActionParams, TradingActionResponse> = {
  id: 'trading_place_order',
  name: 'Trading: Place Order',
  description: 'Place buy or sell orders via Alpaca or Tradier.',
  version: '1.0.0',

  params: {
    provider: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Trading provider id (alpaca or tradier).',
    },
    portfolioIdentity: {
      type: 'json',
      required: true,
      visibility: 'user-only',
      description: 'Canonical broker account identity selected for this order.',
    },
    serviceId: {
      type: 'string',
      required: false,
      visibility: 'hidden',
      description: 'OAuth credential service id from the selected broker account.',
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
    accessToken: {
      type: 'string',
      required: false,
      visibility: 'hidden',
      description: 'OAuth access token injected from the selected broker account.',
    },
  },

  request: {
    url: '/api/providers/trading/order',
    method: 'POST',
    headers: () => ({ 'Content-Type': 'application/json' }),
    body: buildOrderRoutePayload,
  },

  transformResponse: async (response) => {
    const data = await response.json()
    return {
      success: true,
      output: {
        summary: `Order submitted to ${data.provider}`,
        provider: data.provider,
        appOrderId: data.appOrderId,
        order: data.order,
      },
    }
  },

  outputs: {
    summary: { type: 'string', description: 'Status message for the order submission.' },
    provider: { type: 'string', description: 'Broker/provider used for the order.' },
    appOrderId: { type: 'string', description: 'Trading Goose order ID.' },
    order: { type: 'json', description: 'Normalized order details and raw response.' },
  },
}
