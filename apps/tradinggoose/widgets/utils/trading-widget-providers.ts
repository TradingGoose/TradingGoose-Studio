import type { TradingOperationKind } from '@/providers/trading/types'
import {
  getAvailableTradingProviderOptions,
  getTradingProviderDefinition,
  getTradingProviderOAuthServiceId,
  getTradingProviderOptionsByKind,
  getTradingProviderParamDefinitions,
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

export const getTradingWidgetEnvironmentOptions = (
  providerId: string | undefined,
  kind: TradingOperationKind
): Array<{ id: 'paper' | 'live'; label: string }> => {
  if (!providerId) return []
  return (
    getTradingProviderParamDefinitions(providerId, kind)
      .find((definition) => definition.id === 'environment')
      ?.options?.filter(
        (option): option is { id: 'paper' | 'live'; label: string } =>
          option.id === 'paper' || option.id === 'live'
      ) ?? []
  )
}

export const resolveTradingWidgetCredentialProvider = (
  providerId: string | undefined
): string | undefined => {
  if (!providerId) return undefined
  const providerDefinition = getTradingProviderDefinition(providerId)
  return providerDefinition?.oauth?.serviceId ?? providerDefinition?.oauth?.provider
}
