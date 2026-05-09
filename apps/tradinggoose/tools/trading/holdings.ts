import { getTradingProvider, getTradingProviderOAuthEnvironment } from '@/providers/trading'
import { getPortfolioDetail } from '@/providers/trading/portfolio'
import { toPortfolioValueObject } from '@/providers/trading/portfolio-identity'
import type { TradingHoldingsParams, TradingHoldingsResponse } from '@/tools/trading/types'
import type { ToolConfig, ToolResponse } from '@/tools/types'

const failure = (summary: string, provider: string, error = summary): ToolResponse => ({
  success: false,
  output: {
    summary,
    provider,
    holdings: null,
  },
  error,
})

export const tradingHoldingsTool: ToolConfig<TradingHoldingsParams, TradingHoldingsResponse> = {
  id: 'trading_get_holdings',
  name: 'Trading: Get Holdings',
  description: 'Fetch canonical portfolio detail from Alpaca or Tradier.',
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
      description: 'Canonical portfolioIdentity selected by the broker account field.',
    },
    accessToken: {
      type: 'string',
      required: false,
      visibility: 'hidden',
      description: 'OAuth access token resolved from the selected portfolioIdentity connection.',
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

export const executeTradingHoldings = async ({
  accessToken,
  ...params
}: Omit<TradingHoldingsParams, 'accessToken'> & {
  accessToken?: string | null
}): Promise<ToolResponse> => {
  if (!params) {
    return failure('Missing tool parameters for holdings request', '')
  }

  const provider = getTradingProvider(params.provider)
  const portfolioIdentity = toPortfolioValueObject(params.portfolioIdentity)

  if (!portfolioIdentity) {
    return failure('Portfolio identity is required', provider.id)
  }

  if (portfolioIdentity.providerId !== provider.id) {
    return failure('Portfolio identity does not match provider', provider.id)
  }

  if (!accessToken) {
    return failure('Trading provider access token is required', provider.id)
  }

  const environment = getTradingProviderOAuthEnvironment(
    provider.id,
    portfolioIdentity.credentialServiceId
  )
  if (!environment) {
    return failure('Trading provider connection is not configured', provider.id)
  }

  const holdings = await getPortfolioDetail({
    providerId: provider.id,
    credentialServiceId: portfolioIdentity.credentialServiceId,
    environment,
    accessToken,
    accountId: portfolioIdentity.accountId,
  })

  return {
    success: true,
    output: {
      summary: `Fetched portfolio detail from ${provider.name}`,
      provider: provider.id,
      holdings,
    },
  }
}
