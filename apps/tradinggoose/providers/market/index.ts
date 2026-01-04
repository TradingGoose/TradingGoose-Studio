import { createLogger } from '@/lib/logs/console/logger'
import type { MarketProviderRequest, MarketProviderResponse } from '@/providers/market/providers'
import { alpacaProvider } from '@/providers/market/alpaca'
import { finnhubProvider } from '@/providers/market/finnhub'
import { YahooFinanceProvider } from '@/providers/market/yahoo-finance'

const logger = createLogger('MarketProviders')

const providers = {
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
    throw new Error(`Market provider not found: ${providerId}`)
  }

  const availability = provider.config.availability
  const supportsKind = availability[request.kind] ?? false

  if (!supportsKind) {
    throw new Error(`Provider ${providerId} does not support ${request.kind}`)
  }

  switch (request.kind) {
    case 'series': {
      if (!provider.fetchMarketSeries) {
        throw new Error(`Provider ${providerId} does not support market series`)
      }
      return provider.fetchMarketSeries(request)
    }
    case 'news': {
      if (!provider.fetchNews) {
        throw new Error(`Provider ${providerId} does not support news`)
      }
      return provider.fetchNews(request)
    }
    case 'sentiments': {
      if (!provider.fetchSentiments) {
        throw new Error(`Provider ${providerId} does not support sentiments`)
      }
      return provider.fetchSentiments(request)
    }
    default: {
      const kind = (request as { kind?: string }).kind ?? 'unknown'
      logger.warn('Unknown market request kind', { providerId, kind })
      throw new Error(`Unsupported market request kind: ${kind}`)
    }
  }
}

export * from './providers'
