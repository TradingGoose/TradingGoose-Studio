import { createLogger } from '@/lib/logs/console/logger'
import { alpacaProvider } from '@/providers/trading/alpaca'
import {
  getTradingProviderDefinition,
  type TradingProviderAdapter,
} from '@/providers/trading/providers'
import { tradierProvider } from '@/providers/trading/tradier'
import type {
  TradingOrderDetailInput,
  TradingOrderDetailResult,
  TradingOrderHistoryRecord,
  TradingOrderRequest,
  TradingProviderId,
  TradingRequestConfig,
} from '@/providers/trading/types'

const logger = createLogger('TradingProviders')

const providerAdapters: Record<string, TradingProviderAdapter> = {
  alpaca: alpacaProvider,
  tradier: tradierProvider,
}

export function getTradingProviderAdapter(providerId: TradingProviderId): TradingProviderAdapter {
  const provider = providerAdapters[providerId]
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
  const provider = getTradingProviderAdapter(providerId)
  const supportsKind = getTradingProviderDefinition(providerId)?.config.availability.order

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
  const provider = getTradingProviderAdapter(providerId)

  if (!provider.orderDetailRequest) {
    throw new Error(`Provider ${providerId} does not support order detail requests`)
  }

  return provider.orderDetailRequest(historyRecord, params)
}

export * from './portfolio'
export * from './providers'
