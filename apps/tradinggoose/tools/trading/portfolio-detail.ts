import type { TradingPortfolioDetailRequest } from '@/lib/trading/portfolio-detail'
import type { TradingPortfolioDetailResponse } from '@/providers/trading/types'
import type { ToolConfig } from '@/tools/types'

export const tradingPortfolioDetailTool: ToolConfig<
  TradingPortfolioDetailRequest,
  TradingPortfolioDetailResponse
> = {
  id: 'trading_get_portfolio_detail',
  name: 'Trading: Get Portfolio Detail',
  description: 'Fetch account summary, cash, positions, and orders from Alpaca or Tradier.',
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
      description: 'Canonical portfolio detail with cash, positions, and summary.',
    },
  },
}
