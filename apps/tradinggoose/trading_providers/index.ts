import { createLogger } from '@/lib/logs/console/logger'
import { alpacaProvider } from '@/trading_providers/alpaca'
import { robinhoodProvider } from '@/trading_providers/robinhood'
import { tradierProvider } from '@/trading_providers/tradier'
import type {
  TradingFieldDefinition,
  TradingProviderDefinition,
  TradingProviderId,
} from '@/trading_providers/types'

const logger = createLogger('TradingProviders')

export const tradingProviders: Record<TradingProviderId, TradingProviderDefinition> = {
  alpaca: alpacaProvider,
  tradier: tradierProvider,
  robinhood: robinhoodProvider,
}

export const getTradingProviders = (): TradingProviderDefinition[] =>
  Object.values(tradingProviders)

export const getTradingProvider = (id: TradingProviderId): TradingProviderDefinition => {
  const provider = tradingProviders[id]
  if (!provider) {
    logger.error(`Trading provider not found: ${id}`)
    throw new Error(`Trading provider not found: ${id}`)
  }
  return provider
}

export const getProviderFields = (
  providerId: TradingProviderId,
  forOperation: 'order' | 'holdings'
): TradingFieldDefinition[] => {
  const provider = getTradingProvider(providerId)
  return (provider.fields || []).filter(
    (field) => field.for === forOperation || field.for === 'both'
  )
}
