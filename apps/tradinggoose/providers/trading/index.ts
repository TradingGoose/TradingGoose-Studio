import { createLogger } from '@/lib/logs/console/logger'
import { alpacaProvider } from '@/providers/trading/alpaca'
import type { TradingProvider } from '@/providers/trading/providers'
import { tradierProvider } from '@/providers/trading/tradier'
import type {
  TradingOrderDetailInput,
  TradingOrderDetailResult,
  TradingOrderHistoryRecord,
  TradingProviderId,
  TradingOrderRequest,
  TradingRequestConfig,
} from '@/providers/trading/types'

const logger = createLogger('TradingProviders')

const providers: Record<string, TradingProvider> = {
  alpaca: alpacaProvider,
  tradier: tradierProvider,
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
  request: TradingOrderRequest
): TradingRequestConfig {
  const provider = getTradingProvider(providerId)
  const availability = provider.config.availability
  const supportsKind = availability.order

  if (!supportsKind) {
    throw new Error(`Provider ${providerId} does not support ${request.kind}`)
  }

  if (!provider.buildOrderRequest) {
    throw new Error(`Provider ${providerId} does not support order requests`)
  }

  return provider.buildOrderRequest(request)
}

export async function executeTradingProviderOrderDetailRequest(
  providerId: TradingProviderId,
  historyRecord: TradingOrderHistoryRecord,
  params: TradingOrderDetailInput
): Promise<TradingOrderDetailResult> {
  const provider = getTradingProvider(providerId)

  if (!provider.orderDetailRequest) {
    throw new Error(`Provider ${providerId} does not support order detail requests`)
  }

  return provider.orderDetailRequest(historyRecord, params)
}

export * from './portfolio'
export * from './providers'
