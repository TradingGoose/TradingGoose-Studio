import { getTradingProvider, getTradingProviderOAuthEnvironment } from '@/providers/trading'
import { toPortfolioValueObject } from '@/providers/trading/portfolio-identity'
import { getPortfolioDetail } from '@/providers/trading/portfolio'
import type { TradingHoldingsParams, TradingHoldingsResponse } from '@/tools/trading/types'
import type { ToolConfig, ToolResponse } from '@/tools/types'

const readPortfolioIdentityParam = (value: unknown) => {
  if (typeof value !== 'string') return toPortfolioValueObject(value)
  const trimmed = value.trim()
  if (!trimmed) return null
  try {
    return toPortfolioValueObject(JSON.parse(trimmed))
  } catch {
    return null
  }
}

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
      description: 'Canonical portfolioIdentity for the brokerage account to fetch.',
    },
    credential: {
      type: 'string',
      required: false,
      visibility: 'hidden',
      description: 'OAuth credential id for the selected broker (populated from selected account).',
    },
    credentialServiceId: {
      type: 'string',
      required: false,
      visibility: 'hidden',
      description: 'OAuth service id for the selected broker connection.',
    },
    accessToken: {
      type: 'string',
      required: false,
      visibility: 'hidden',
      description: 'OAuth access token (injected from credential).',
    },
  },

  request: {
    url: '',
    method: 'GET',
    headers: () => ({}),
  },

  directExecution: async (params) => {
    if (!params) {
      return failure('Missing tool parameters for holdings request', '')
    }

    if (!params.accessToken) {
      return failure('Trading provider access token is required', params.provider)
    }

    const provider = getTradingProvider(params.provider)
    const portfolioIdentity = readPortfolioIdentityParam(params.portfolioIdentity)

    if (!portfolioIdentity) {
      return failure('Portfolio identity is required', provider.id)
    }

    if (portfolioIdentity.providerId !== provider.id) {
      return failure('Portfolio identity does not match provider', provider.id)
    }

    if (!params.credentialServiceId) {
      return failure('Trading provider connection is required', provider.id)
    }

    if (params.credentialServiceId !== portfolioIdentity.credentialServiceId) {
      return failure('Portfolio identity does not match provider connection', provider.id)
    }

    const environment = getTradingProviderOAuthEnvironment(provider.id, params.credentialServiceId)
    if (!environment) {
      return failure('Trading provider connection is not configured', provider.id)
    }

    const holdings = await getPortfolioDetail({
      providerId: provider.id,
      credentialServiceId: portfolioIdentity.credentialServiceId,
      environment,
      accessToken: params.accessToken,
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
  },

  outputs: {
    summary: { type: 'string', description: 'Status message for holdings retrieval.' },
    provider: { type: 'string', description: 'Broker/provider used for the request.' },
    holdings: { type: 'json', description: 'Canonical portfolio detail with cash, positions, and summary.' },
  },
}
