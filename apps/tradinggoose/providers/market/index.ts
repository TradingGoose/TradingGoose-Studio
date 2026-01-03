import { createLogger } from '@/lib/logs/console/logger'
import type { MarketProviderRequest, MarketProviderResponse } from '@/providers/market/providers'
import { alpacaProvider } from '@/providers/market/alpaca'
import { finnhubProvider } from '@/providers/market/finnhub'
import { yfinanceProvider } from '@/providers/market/yahoo-finance'

const logger = createLogger('MarketProviders')

const providers = {
  alpaca: alpacaProvider,
  finnhub: finnhubProvider,
  'yahoo-finance': yfinanceProvider,
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
    throw new Error(`Market provider not found: ${providerId}`)
  }

  const supportsKind = provider.config.availability.some((entry) => {
    if (request.kind === 'series') return entry.series
    if (request.kind === 'news') return entry.news
    return entry.sentiments
  })

  if (!supportsKind) {
    throw new Error(`Provider ${providerId} does not support ${request.kind}`)
  }

  if (request.kind === 'series') {
    if (!provider.fetchMarketSeries) {
      throw new Error(`Provider ${providerId} does not support market series`)
    }
    return provider.fetchMarketSeries(request)
  }

  if (request.kind === 'news') {
    if (!provider.fetchNews) {
      throw new Error(`Provider ${providerId} does not support news`)
    }
    return provider.fetchNews(request)
  }

  if (request.kind === 'sentiments') {
    if (!provider.fetchSentiments) {
      throw new Error(`Provider ${providerId} does not support sentiments`)
    }
    return provider.fetchSentiments(request)
  }

  logger.warn('Unknown market request kind', { providerId, kind: request.kind })
  throw new Error(`Unsupported market request kind: ${request.kind}`)
}

export * from './providers'
