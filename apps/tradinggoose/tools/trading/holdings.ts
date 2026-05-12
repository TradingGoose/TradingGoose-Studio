import type { TradingHoldingsParams, TradingHoldingsResponse } from '@/tools/trading/types'
import type { ToolConfig } from '@/tools/types'

export const tradingHoldingsTool: ToolConfig<TradingHoldingsParams, TradingHoldingsResponse> = {
  id: 'trading_get_holdings',
  name: 'Trading: Get Holdings',
  description: 'Fetch canonical portfolio detail from Alpaca or Tradier.',
  version: '1.0.0',
  execution: {
    workspace: { required: true, access: 'read' },
  },

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
      provider: params.provider,
      portfolioIdentity: params.portfolioIdentity,
    }),
  },

  transformResponse: async (response): Promise<TradingHoldingsResponse> => {
    const result = await response.json()
    const data = result.data || result
    return {
      success: true,
      output: {
        summary: data.summary || 'Fetched portfolio detail',
        provider: data.provider || '',
        holdings: data.holdings ?? null,
      },
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
