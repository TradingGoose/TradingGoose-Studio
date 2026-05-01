import type { TradingOperationKind } from '@/providers/trading/types'
import {
  getAvailableTradingProviderOptions,
  getTradingProviderOAuthServiceId,
  getTradingProviderOptionsByKind,
  getTradingProvidersByKind,
} from '@/providers/trading/providers'

export const getTradingWidgetProviderAvailabilityIds = (kind: TradingOperationKind): string[] =>
  getTradingProvidersByKind(kind)
    .map((provider) => getTradingProviderOAuthServiceId(provider.id))
    .filter((providerId): providerId is string => Boolean(providerId))

export const getTradingWidgetProviderOptions = (
  kind: TradingOperationKind,
  providerAvailability?: Record<string, boolean>
): Array<{ id: string; name: string }> =>
  providerAvailability
    ? getAvailableTradingProviderOptions(providerAvailability, kind)
    : getTradingProviderOptionsByKind(kind)

export const resolveTradingWidgetProviderId = (
  provider: unknown,
  providerOptions: Array<{ id: string; name: string }>
): string => {
  const providerId = typeof provider === 'string' ? provider.trim() : ''
  if (!providerId) return ''
  return providerOptions.some((option) => option.id === providerId) ? providerId : ''
}
