import { getTradingProviderOAuthEnvironment } from '@/providers/trading'
import type { TradingOrderDetailParams, TradingOrderDetailResponse } from '@/tools/trading/types'
import type { ToolConfig } from '@/tools/types'

const resolveProviderEnvironment = (params: TradingOrderDetailParams) => {
  if (!params.provider) return params.environment
  return (
    getTradingProviderOAuthEnvironment(params.provider, params.credentialServiceId) ??
    params.environment
  )
}

export const tradingOrderDetailTool: ToolConfig<
  TradingOrderDetailParams,
  TradingOrderDetailResponse
> = {
  id: 'trading_order_detail',
  name: 'Trading: Order Detail',
  description:
    'Retrieve all provider-available details for a previously recorded trading order by Trading Goose order ID.',
  version: '1.0.0',

  params: {
    orderId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description:
        'Trading Goose order ID (orderHistoryTable.id) created when the order was submitted.',
    },
    provider: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description:
        'Expected provider for this order. Used for credential selection and mismatch validation.',
    },
    environment: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Trading environment for providers that expose one.',
    },
    credential: {
      type: 'string',
      required: false,
      visibility: 'hidden',
      description: 'OAuth credential id for the selected broker (populated from selected account).',
    },
    accessToken: {
      type: 'string',
      required: false,
      visibility: 'hidden',
      description: 'OAuth access token (injected from credential).',
    },
    accountId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Tradier account ID override if not present in stored order metadata.',
    },
  },

  request: {
    url: '/api/tools/trading/order-detail',
    method: 'POST',
    headers: () => ({
      'Content-Type': 'application/json',
    }),
    body: (params) => ({
      orderId: params.orderId,
      provider: params.provider,
      environment: resolveProviderEnvironment(params),
      accessToken: params.accessToken,
      accountId: params.accountId,
    }),
  },

  transformResponse: async (response): Promise<TradingOrderDetailResponse> => {
    const result = await response.json()
    const data = result.data || result

    const provider = data.provider || ''
    const appOrderId = data.appOrderId || ''
    const providerOrderId = data.providerOrderId || ''
    const workspaceId = data.workspaceId || null
    const logId = data.logId || null
    const orderDetail = data.orderDetail || {}

    return {
      success: true,
      output: {
        summary: `Fetched order detail from ${provider}`,
        provider,
        appOrderId,
        providerOrderId,
        workspaceId,
        logId,
        orderDetail,
      },
    }
  },

  outputs: {
    summary: { type: 'string', description: 'Status message for order detail retrieval.' },
    provider: { type: 'string', description: 'Broker/provider of the order.' },
    appOrderId: { type: 'string', description: 'Trading Goose order ID (orderHistoryTable.id).' },
    providerOrderId: {
      type: 'string',
      description: 'Provider-native order ID used for the API lookup.',
    },
    workspaceId: {
      type: 'string',
      description: 'Workspace that owns the recorded order.',
    },
    logId: {
      type: 'string',
      description: 'Linked log ID, when one exists.',
    },
    orderDetail: {
      type: 'json',
      description: 'Normalized order detail payload with raw provider response.',
    },
  },
}
