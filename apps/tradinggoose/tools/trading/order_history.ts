import type { ToolConfig } from '@/tools/types'

type OrderHistory = Array<Record<string, unknown>>

export interface OrderHistoryParams {
  startDate: string
  endDate: string
}

export interface OrderHistoryResponse {
  success: boolean
  output: {
    history: OrderHistory
    count: number
    workspaceId?: string | null
    startDate: string
    endDate: string
  }
  error?: string
}

export const orderHistoryTool: ToolConfig<OrderHistoryParams, OrderHistoryResponse> = {
  id: 'trading_order_history',
  name: 'Trading: Order History',
  description: 'Retrieve workspace order submissions recorded within a datetime range.',
  version: '1.0.0',
  execution: {
    workspace: { required: true, access: 'read' },
  },

  params: {
    startDate: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Start datetime (ISO 8601).',
    },
    endDate: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'End datetime (ISO 8601).',
    },
  },

  request: {
    url: (
      params: OrderHistoryParams & {
        _context?: {
          workspaceId?: string
        }
      }
    ) => {
      const context = params._context ?? {}
      const startDate = params.startDate
      const endDate = params.endDate
      const workspaceId = context.workspaceId

      if (!startDate || !endDate) {
        throw new Error('startDate and endDate are required')
      }
      if (!workspaceId) {
        throw new Error('trading_order_history requires workspace execution context')
      }

      const searchParams = new URLSearchParams()
      searchParams.set('workspaceId', workspaceId)
      searchParams.set('startDate', startDate)
      searchParams.set('endDate', endDate)

      return `/api/tools/trading/order-history?${searchParams.toString()}`
    },
    method: 'GET',
    headers: () => ({
      'Content-Type': 'application/json',
    }),
  },

  transformResponse: async (response): Promise<OrderHistoryResponse> => {
    const result = await response.json()
    const data = result.data

    return {
      success: true,
      output: {
        history: data.history as OrderHistory,
        count: data.count,
        workspaceId: data.workspaceId,
        startDate: data.startDate,
        endDate: data.endDate,
      },
    }
  },

  outputs: {
    history: {
      type: 'array',
      description: 'Ordered list of recorded order submissions.',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Order history record ID' },
          workspaceId: { type: 'string', description: 'Owning workspace ID' },
          provider: { type: 'string', description: 'Trading provider' },
          recordedAt: { type: 'string', description: 'Recorded timestamp' },
          submissionSource: { type: 'string', description: 'Order submission source' },
          logId: { type: 'string', description: 'Linked log ID' },
          listingIdentity: { type: 'object', description: 'Listing identity metadata' },
          providerOrderId: { type: 'string', description: 'Provider order ID' },
          status: { type: 'string', description: 'Provider-normalized order status' },
        },
      },
    },
    count: { type: 'number', description: 'Number of records returned.' },
    workspaceId: { type: 'string', description: 'Workspace ID used for filtering.' },
    startDate: { type: 'string', description: 'Start datetime used for filtering.' },
    endDate: { type: 'string', description: 'End datetime used for filtering.' },
  },
}
