import { stableStringifyJsonValue } from '@/lib/json/stable'
import type { TradingActionResponse } from '@/providers/trading/types'
import type { TradingActionParams } from '@/tools/trading/types'
import type { ToolConfig } from '@/tools/types'

type TradingOrderRoutePayloadParams = Partial<TradingActionParams>

const toOptionalNumber = (value: unknown): number | undefined => {
  if (value === null || value === undefined) return undefined
  if (typeof value === 'string' && value.trim() === '') return undefined
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : undefined
}

export const buildOrderRoutePayload = (params: TradingOrderRoutePayloadParams) => {
  const orderSizingMode =
    params.orderSizingMode === 'quantity' || params.orderSizingMode === 'notional'
      ? params.orderSizingMode
      : undefined
  const useNotional = orderSizingMode === 'notional'
  const workspaceId = params._context?.workspaceId
  const submissionSource = params._context?.submissionSource
  const toolExecutionId = params._context?.toolExecutionId
  if (submissionSource && !toolExecutionId) {
    throw new Error('Trading order submission requires tool execution identity')
  }
  const payload = {
    workspaceId,
    portfolioIdentity: params.portfolioIdentity,
    listing: params.listing,
    side: params.side,
    quantity: useNotional ? undefined : toOptionalNumber(params.quantity),
    notional: useNotional ? toOptionalNumber(params.notional) : undefined,
    orderSizingMode,
    orderType: params.orderType,
    timeInForce: params.timeInForce,
    limitPrice: toOptionalNumber(params.limitPrice),
    stopPrice: toOptionalNumber(params.stopPrice),
    trailPrice: toOptionalNumber(params.trailPrice),
    trailPercent: toOptionalNumber(params.trailPercent),
    preview: params.preview,
    submissionSource,
    logId: params._context?.workflowLogId,
  }
  const body = Object.fromEntries(
    Object.entries(payload).filter(([, value]) => value !== undefined)
  )

  if (submissionSource && toolExecutionId) {
    body.idempotencyKey = [
      'trading-order',
      submissionSource,
      toolExecutionId,
      stableStringifyJsonValue(body),
    ].join(':')
  }

  return body
}

export const tradingActionTool: ToolConfig<TradingActionParams, TradingActionResponse> = {
  id: 'trading_place_order',
  name: 'Trading: Place Order',
  description: 'Place buy or sell orders via Alpaca or Tradier.',
  version: '1.0.0',
  execution: {
    workspace: { required: true, access: 'write' },
    submissionSource: 'required',
  },

  params: {
    portfolioIdentity: {
      type: 'json',
      required: true,
      visibility: 'user-only',
      description: 'Canonical broker account identity selected for this order.',
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
      description: 'Quantity to trade when the selected provider sizing mode is quantity.',
    },
    notional: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Dollar amount to trade when supported by the selected provider.',
    },
    orderSizingMode: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Order sizing mode selected from trading provider capabilities.',
    },
    orderType: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Order type selected from trading provider capabilities.',
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
      description: 'Stop price when required by the selected order type.',
    },
    trailPrice: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Trailing price offset when supported by the selected order type.',
    },
    trailPercent: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Trailing percent offset when supported by the selected order type.',
    },
    preview: {
      type: 'boolean',
      required: false,
      visibility: 'user-only',
      description: 'Preview the provider order without submitting when supported.',
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
        clientOrderId: data.clientOrderId,
        order: data.order,
      },
    }
  },

  outputs: {
    summary: { type: 'string', description: 'Status message for the order submission.' },
    provider: { type: 'string', description: 'Broker/provider used for the order.' },
    appOrderId: { type: 'string', description: 'Trading Goose order ID.' },
    clientOrderId: { type: 'string', description: 'Broker client order identity for retries.' },
    order: { type: 'json', description: 'Normalized order details and raw response.' },
  },
}
