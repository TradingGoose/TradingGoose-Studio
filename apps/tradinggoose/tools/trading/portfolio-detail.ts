import type { TradingPortfolioDetailRequest } from '@/lib/trading/portfolio-detail'
import type { TradingPortfolioDetailResponse } from '@/providers/trading/types'
import type { ToolConfig } from '@/tools/types'

export const tradingPortfolioDetailTool = {
  id: 'trading_get_portfolio_detail',
  name: 'Trading: Get Portfolio Detail',
  description:
    'Fetch account summary, cash, and supported position fields from a connected trading provider.',
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
    url: '/api/tools/trading/portfolio-detail',
    method: 'POST',
    headers: () => ({
      'Content-Type': 'application/json',
    }),
    body: (params) => ({
      portfolioIdentity: params.portfolioIdentity,
    }),
  },

  transformResponse: async (response): Promise<TradingPortfolioDetailResponse> => {
    const result = await response.json()
    return {
      success: true,
      output: result.data,
    }
  },

  outputs: {
    summary: { type: 'string', description: 'Status message for portfolio detail retrieval.' },
    provider: { type: 'string', description: 'Broker/provider used for the request.' },
    portfolioDetail: {
      type: 'json',
      description: 'Portfolio fields supported by the selected broker.',
    },
  },
} satisfies ToolConfig<TradingPortfolioDetailRequest, TradingPortfolioDetailResponse>
