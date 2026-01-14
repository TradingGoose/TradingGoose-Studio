import { createLogger } from '@/lib/logs/console/logger'
import type { TradingProvider } from '@/providers/trading/providers'
import type {
  TradingProviderId,
  TradingProviderRequest,
  TradingRequestConfig,
} from '@/providers/trading/types'
import { alpacaProvider } from '@/providers/trading/alpaca'
import { robinhoodProvider } from '@/providers/trading/robinhood'
import { tradierProvider } from '@/providers/trading/tradier'

const logger = createLogger('TradingProviders')

const providers: Record<string, TradingProvider> = {
  alpaca: alpacaProvider,
  tradier: tradierProvider,
  robinhood: robinhoodProvider,
}

export function getProvider(providerId: string): TradingProvider | undefined {
  const id = providerId.split('/')[0]
  return providers[id]
}

export function getTradingProvider(providerId: TradingProviderId): TradingProvider {
  const provider = providers[providerId]
  if (!provider) {
    logger.error(`Trading provider not found: ${providerId}`)
    throw new Error(`Trading provider not found: ${providerId}`)
  }
  return provider
}

export function executeTradingProviderRequest(
  providerId: TradingProviderId,
  request: TradingProviderRequest
): TradingRequestConfig {
  const provider = getTradingProvider(providerId)
  const availability = provider.config.availability
  const supportsKind = availability[request.kind] ?? false

  if (!supportsKind) {
    throw new Error(`Provider ${providerId} does not support ${request.kind}`)
  }

  switch (request.kind) {
    case 'order': {
      if (!provider.buildOrderRequest) {
        throw new Error(`Provider ${providerId} does not support order requests`)
      }
      return provider.buildOrderRequest(request)
    }
    case 'holdings': {
      if (!provider.buildHoldingsRequest) {
        throw new Error(`Provider ${providerId} does not support holdings requests`)
      }
      return provider.buildHoldingsRequest(request)
    }
    default: {
      const kind = (request as { kind?: string }).kind ?? 'unknown'
      logger.warn('Unknown trading request kind', { providerId, kind })
      throw new Error(`Unsupported trading request kind: ${kind}`)
    }
  }
}

export * from './providers'
