import type { OrderHistory } from '@/tools/trading/types'
import type { ToolConfig } from '@/tools/types'

export interface OrderHistoryParams {
  startDate: string
  endDate: string
  workflowId?: string
}

export interface OrderHistoryResponse {
  success: boolean
  output: {
    history: OrderHistory
    count: number
    workflowId?: string | null
    startDate: string
    endDate: string
  }
  error?: string
}

export const orderHistoryTool: ToolConfig<OrderHistoryParams, OrderHistoryResponse> = {
  id: 'trading_order_history',
  name: 'Trading: Order History',
  description: 'Retrieve order submissions recorded for a workflow within a datetime range.',
  version: '1.0.0',

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
    workflowId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Optional workflow ID to filter by. Defaults to the current workflow execution context.',
    },
  },

  request: {
    url: (params: OrderHistoryParams & { _context?: { workflowId?: string } }) => {
      const startDate = params.startDate
      const endDate = params.endDate
      const workflowId = params.workflowId || params._context?.workflowId

      if (!startDate || !endDate) {
        throw new Error('startDate and endDate are required')
      }

      const searchParams = new URLSearchParams()
      searchParams.set('startDate', startDate)
      searchParams.set('endDate', endDate)
      if (workflowId) {
        searchParams.set('workflowId', workflowId)
      }

      return `/api/tools/trading/order-history?${searchParams.toString()}`
    },
    method: 'GET',
    headers: () => ({
      'Content-Type': 'application/json',
    }),
  },

  transformResponse: async (response): Promise<OrderHistoryResponse> => {
    const result = await response.json()
    const data = result.data || result

    const history = (data.history || []) as OrderHistory

    return {
      success: true,
      output: {
        history,
        count: typeof data.count === 'number' ? data.count : history.length,
        workflowId: data.workflowId,
        startDate: data.startDate || '',
        endDate: data.endDate || '',
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
          provider: { type: 'string', description: 'Trading provider' },
          recordedAt: { type: 'string', description: 'Recorded timestamp' },
          workflowId: { type: 'string', description: 'Workflow ID' },
          workflowExecutionId: { type: 'string', description: 'Workflow execution ID' },
          listingIdentity: { type: 'object', description: 'Listing identity metadata' },
          request: { type: 'object', description: 'Normalized order request payload' },
          response: { type: 'object', description: 'Normalized order response payload' },
          normalizedOrder: { type: 'object', description: 'Provider-normalized order details' },
        },
      },
    },
    count: { type: 'number', description: 'Number of records returned.' },
    workflowId: { type: 'string', description: 'Workflow ID used for filtering.' },
    startDate: { type: 'string', description: 'Start datetime used for filtering.' },
    endDate: { type: 'string', description: 'End datetime used for filtering.' },
  },
}
