import { getTradingProvider, getTradingProviderOAuthEnvironment } from '@/providers/trading'
import { getPortfolioDetail, listPortfolioIdentities } from '@/providers/trading/portfolio'
import type { TradingHoldingsParams, TradingHoldingsResponse } from '@/tools/trading/types'
import type { ToolConfig } from '@/tools/types'

const resolveProviderEnvironment = (params: TradingHoldingsParams) => {
  return (
    getTradingProviderOAuthEnvironment(params.provider, params.credentialServiceId) ??
    params.environment
  )
}

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
  },

  request: {
    url: '',
    method: 'GET',
    headers: () => ({}),
  },

  directExecution: async (params) => {
    if (!params) {
      return {
        success: false,
        output: {
          summary: 'Missing tool parameters for holdings request',
          provider: '',
          holdings: null,
        },
        error: 'Missing tool parameters for holdings request',
      }
    }

    if (!params.accessToken) {
      return {
        success: false,
        output: {
          summary: 'Trading provider access token is required',
          provider: params.provider,
          holdings: null,
        },
        error: 'Trading provider access token is required',
      }
    }

    const provider = getTradingProvider(params.provider)
    const environment = resolveProviderEnvironment(params)
    const portfolioIdentities = await listPortfolioIdentities({
      providerId: provider.id,
      credentialServiceId: params.credentialServiceId,
      environment,
      accessToken: params.accessToken,
    })
    const portfolioIdentity = portfolioIdentities[0] ?? null

    if (!portfolioIdentity) {
      return {
        success: false,
        output: {
          summary: 'Portfolio account not found for provider connection',
          provider: provider.id,
          holdings: null,
        },
        error: 'Portfolio account not found for provider connection',
      }
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
