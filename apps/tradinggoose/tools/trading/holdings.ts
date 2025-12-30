import { createLogger } from '@/lib/logs/console/logger'
import { getTradingProvider } from '@/trading_providers'
import type { ToolConfig } from '@/tools/types'
import type { TradingHoldingsParams, TradingHoldingsResponse } from '@/tools/trading/types'

const logger = createLogger('TradingHoldingsTool')

const buildHoldingsRequest = (params: TradingHoldingsParams) => {
  const provider = getTradingProvider(params.provider)
  const request = provider.buildHoldingsRequest(params)
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
  description: 'Fetch account positions/holdings from Alpaca, Tradier, or Robinhood.',
  version: '1.0.0',

  params: {
    provider: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Trading provider id (alpaca, tradier, or robinhood).',
    },
    environment: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Trading environment for Alpaca (paper or live).',
    },
    credential: {
      type: 'string',
      required: false,
      visibility: 'hidden',
      description: 'OAuth credential id for the selected broker (populated from selected account).',
    },
    tradierCredential: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Tradier OAuth credential id.',
    },
    robinhoodCredential: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Robinhood OAuth credential id.',
    },
    alpacaCredential: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Alpaca OAuth credential id.',
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
    accountUrl: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Account resource URL (Robinhood).',
    },
  },

  request: {
    url: (params) => resolveHoldingsRequest(params).url,
    method: (params) => resolveHoldingsRequest(params).method,
    headers: (params) => resolveHoldingsRequest(params).headers,
    body: (params) => resolveHoldingsRequest(params).body,
  },

  transformResponse: async (response, params) => {
    const provider = getTradingProvider(params.provider)
    const raw = await response.json().catch(() => ({}))
    const normalized = provider.normalizeHoldings ? provider.normalizeHoldings(raw) : raw

    return {
      success: true,
      output: {
        summary: `Fetched holdings from ${provider.name}`,
        provider: provider.id,
        holdings: normalized as any[],
      },
    }
  },

  outputs: {
    summary: { type: 'string', description: 'Status message for holdings retrieval.' },
    provider: { type: 'string', description: 'Broker/provider used for the request.' },
    holdings: { type: 'json', description: 'Normalized holdings list with raw data.' },
  },
}
