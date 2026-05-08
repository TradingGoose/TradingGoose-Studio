import { createLogger } from '@/lib/logs/console/logger'
import {
  executeTradingProviderRequest,
  getTradingProvider,
  getTradingProviderOAuthEnvironment,
  getTradingProviderParamDefinitions,
} from '@/providers/trading'
import type { TradingHoldingsParams, TradingHoldingsResponse } from '@/tools/trading/types'
import type { ToolConfig } from '@/tools/types'

const logger = createLogger('TradingHoldingsTool')

const resolveProviderEnvironment = (params: TradingHoldingsParams) => {
  const credentialEnvironment = getTradingProviderOAuthEnvironment(
    params.provider,
    params.credentialServiceId
  )
  if (credentialEnvironment) return credentialEnvironment

  return getTradingProviderParamDefinitions(params.provider, 'holdings').some(
    (definition) => definition.id === 'environment'
  )
    ? params.environment
    : undefined
}

const buildHoldingsRequest = (params: TradingHoldingsParams) => {
  const provider = getTradingProvider(params.provider)
  const { provider: providerId, ...rest } = params
  const request = executeTradingProviderRequest(providerId, {
    kind: 'holdings',
    ...rest,
    environment: resolveProviderEnvironment(params),
  })
  logger.info(`Building holdings request for ${provider.id}`)
  return request
}

const resolveHoldingsRequest = (params: TradingHoldingsParams) => {
  const cacheKey = '_tradingHoldingsRequest'
  const existing = (params as any)[cacheKey]
  if (existing) return existing
  const built = buildHoldingsRequest(params)
  ;(params as any)[cacheKey] = built
  return built
}

export const tradingHoldingsTool: ToolConfig<TradingHoldingsParams, TradingHoldingsResponse> = {
  id: 'trading_get_holdings',
  name: 'Trading: Get Holdings',
  description: 'Fetch a unified account snapshot from Alpaca or Tradier.',
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
    accountId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Account ID (Tradier).',
    },
  },

  request: {
    url: (params) => resolveHoldingsRequest(params).url,
    method: (params) => resolveHoldingsRequest(params).method,
    headers: (params) => resolveHoldingsRequest(params).headers,
    body: (params) => resolveHoldingsRequest(params).body,
  },

  transformResponse: async (response, params) => {
    if (!params) {
      throw new Error('Missing tool parameters for holdings request')
    }
    const provider = getTradingProvider(params.provider)
    const raw = await response.json().catch(() => ({}))
    const normalized = provider.normalizeHoldings
      ? provider.normalizeHoldings(raw, {
          environment: resolveProviderEnvironment(params),
          accessToken: params.accessToken,
          accountId: params.accountId,
          providerId: provider.id,
          providerName: provider.name,
        })
      : raw

    return {
      success: true,
      output: {
        summary: `Fetched holdings from ${provider.name}`,
        provider: provider.id,
        holdings: normalized,
      },
    }
  },

  outputs: {
    summary: { type: 'string', description: 'Status message for holdings retrieval.' },
    provider: { type: 'string', description: 'Broker/provider used for the request.' },
    holdings: { type: 'json', description: 'Unified account snapshot with positions.' },
  },
}
