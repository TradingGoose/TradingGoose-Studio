import type { TradingOrderDetailParams, TradingOrderDetailResponse } from '@/tools/trading/types'
import type { ToolConfig } from '@/tools/types'

export const tradingOrderDetailTool: ToolConfig<
  TradingOrderDetailParams,
  TradingOrderDetailResponse
> = {
  id: 'trading_order_detail',
  name: 'Trading: Order Detail',
  description:
    'Retrieve all provider-available details for a previously recorded trading order by Trading Goose order ID.',
  version: '1.0.0',
  execution: {
    workspace: { required: true, access: 'read' },
  },

  params: {
    orderId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description:
        'Trading Goose order ID (orderHistoryTable.id) created when the order was submitted.',
    },
  },

  request: {
    url: (params) => `/api/orders/${encodeURIComponent(params.orderId)}/provider-detail`,
    method: 'POST',
    headers: () => ({}),
  },

  transformResponse: async (response): Promise<TradingOrderDetailResponse> => {
    const result = await response.json()
    const data = result.data

    return {
      success: true,
      output: {
        summary: `Fetched order detail from ${data.provider}`,
        provider: data.provider,
        appOrderId: data.appOrderId,
        providerOrderId: data.providerOrderId,
        workspaceId: data.workspaceId,
        logId: data.logId,
        orderDetail: data.orderDetail,
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
