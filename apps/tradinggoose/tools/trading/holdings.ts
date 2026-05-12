import type { TradingHoldingsRequest } from '@/lib/trading/holdings'
import type { TradingHoldingsResponse } from '@/providers/trading/types'
import type { ToolConfig } from '@/tools/types'

export const tradingHoldingsTool: ToolConfig<TradingHoldingsRequest, TradingHoldingsResponse> = {
  id: 'trading_get_holdings',
  name: 'Trading: Get Holdings',
  description: 'Fetch canonical portfolio detail from Alpaca or Tradier.',
  version: '1.0.0',
  execution: {
    workspace: { required: true, access: 'read' },
  },

  params: {
    portfolioIdentity: {
      type: 'json',
      required: true,
      visibility: 'user-only',
      description: 'Canonical portfolioIdentity selected by the broker account field.',
    },
  },

  request: {
    url: '/api/tools/trading/holdings',
    method: 'POST',
    headers: () => ({
      'Content-Type': 'application/json',
    }),
    body: (params) => ({
      portfolioIdentity: params.portfolioIdentity,
    }),
  },

  transformResponse: async (response): Promise<TradingHoldingsResponse> => {
    const result = await response.json()
    return {
      success: true,
      output: result.data,
    }
  },

  outputs: {
    summary: { type: 'string', description: 'Status message for holdings retrieval.' },
    provider: { type: 'string', description: 'Broker/provider used for the request.' },
    holdings: {
      type: 'json',
      description: 'Canonical portfolio detail with cash, positions, and summary.',
    },
  },
}
