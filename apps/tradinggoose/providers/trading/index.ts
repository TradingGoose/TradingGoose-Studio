import { createLogger } from '@/lib/logs/console/logger'
import { alpacaProvider } from '@/providers/trading/alpaca'
import { fetchBrokerJson } from '@/providers/trading/portfolio-utils'
import {
  getTradingProviderDefinition,
  type TradingProviderAdapter,
} from '@/providers/trading/providers'
import { robinhoodProvider } from '@/providers/trading/robinhood'
import { tradierProvider } from '@/providers/trading/tradier'
import type {
  TradingOrderDetailInput,
  TradingOrderDetailResult,
  TradingOrderHistoryRecord,
  TradingOrderRequest,
  TradingProviderId,
} from '@/providers/trading/types'

const logger = createLogger('TradingProviders')

const providerAdapters: Record<string, TradingProviderAdapter> = {
  robinhood: robinhoodProvider,
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

export async function executeTradingProviderRequest(
  providerId: TradingProviderId,
  request: TradingOrderRequest
): Promise<unknown> {
  const provider = getTradingProviderAdapter(providerId)
  const supportsKind = getTradingProviderDefinition(providerId)?.config.availability.order

  if (!supportsKind) {
    throw new Error(`Provider ${providerId} does not support ${request.kind}`)
  }

  if (provider.submitOrder) return provider.submitOrder(request)
  if (!provider.buildOrderRequest) {
    throw new Error(`Provider ${providerId} does not support order requests`)
  }

  const config = provider.buildOrderRequest(request)
  return fetchBrokerJson({
    providerId,
    url: config.url,
    init: {
      method: config.method,
      headers: config.headers,
      body:
        typeof config.body === 'string' || config.body === undefined
          ? config.body
          : JSON.stringify(config.body),
    },
  })
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
