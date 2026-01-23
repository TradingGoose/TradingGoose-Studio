import { createLogger } from '@/lib/logs/console/logger'
import type { MarketProviderRequest, MarketProviderResponse } from '@/providers/market/providers'
import type { MarketSeries } from '@/providers/market/types'
import { MarketProviderError } from '@/providers/market/errors'
import { applySeriesWindow, planMarketSeriesRequest } from '@/providers/market/series-planner'
import { alphaVantageProvider } from '@/providers/market/alpha-vantage'
import { alpacaProvider } from '@/providers/market/alpaca'
import { finnhubProvider } from '@/providers/market/finnhub'
import { YahooFinanceProvider } from '@/providers/market/yahoo-finance'

const logger = createLogger('MarketProviders')

const providers = {
  'alpha-vantage': alphaVantageProvider,
  alpaca: alpacaProvider,
  finnhub: finnhubProvider,
  'yahoo-finance': YahooFinanceProvider,
}

export function getProvider(providerId: string) {
  const id = providerId.split('/')[0] as keyof typeof providers
  return providers[id]
}

export async function executeProviderRequest(
  providerId: string,
  request: MarketProviderRequest
): Promise<MarketProviderResponse> {
  const provider = getProvider(providerId)
  if (!provider) {
    throw new MarketProviderError({
      code: 'UNSUPPORTED_PROVIDER',
      message: `Market provider not found: ${providerId}`,
      provider: providerId,
      status: 404,
    })
  }

  const availability = provider.config.availability
  const supportsKind = availability[request.kind] ?? false

  if (!supportsKind) {
    throw new MarketProviderError({
      code: 'INVALID_REQUEST',
      message: `Provider ${providerId} does not support ${request.kind}`,
      provider: providerId,
      status: 400,
    })
  }

  switch (request.kind) {
    case 'series': {
      if (!provider.fetchMarketSeries) {
        throw new MarketProviderError({
          code: 'INVALID_REQUEST',
          message: `Provider ${providerId} does not support market series`,
          provider: providerId,
          status: 400,
        })
      }
      const { request: plannedRequest, window } = planMarketSeriesRequest(providerId, request)
      const response = await provider.fetchMarketSeries(plannedRequest)
      const adjusted = applySeriesWindow(response, window)
      if (!Array.isArray((adjusted as MarketSeries).bars) || adjusted.bars.length === 0) {
        throw new MarketProviderError({
          code: 'EMPTY_SERIES',
          message: 'No data returned for the requested time range',
          provider: providerId,
          status: 422,
        })
      }
      return adjusted
    }
    case 'live': {
      if (!provider.fetchMarketLive) {
        throw new MarketProviderError({
          code: 'INVALID_REQUEST',
          message: `Provider ${providerId} does not support live market data`,
          provider: providerId,
          status: 400,
        })
      }
      return provider.fetchMarketLive(request)
    }
    default: {
      const kind = (request as { kind?: string }).kind ?? 'unknown'
      logger.warn('Unknown market request kind', { providerId, kind })
      throw new MarketProviderError({
        code: 'INVALID_REQUEST',
        message: `Unsupported market request kind: ${kind}`,
        provider: providerId,
        status: 400,
      })
    }
  }
}

export * from './providers'
