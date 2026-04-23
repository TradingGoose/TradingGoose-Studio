import {
  getTradingPortfolioDefaultEnvironment,
  getTradingPortfolioSupportedWindows,
} from '@/providers/trading/portfolio'
import {
  getAvailableTradingProviderOptions,
  getTradingProviderDefinition,
  getTradingProviderOAuthServiceId,
  getTradingProviderOptionsByKind,
  getTradingProviderParamDefinitions,
  getTradingProvidersByKind,
} from '@/providers/trading/providers'
import type { TradingPortfolioPerformanceWindow } from '@/providers/trading/types'
import type { PortfolioSnapshotWidgetParams } from '@/widgets/widgets/portfolio_snapshot/types'

const DEFAULT_PORTFOLIO_SNAPSHOT_PROVIDER_OPTIONS = getTradingProviderOptionsByKind('holdings')

export const getPortfolioSnapshotProviderAvailabilityIds = () =>
  getTradingProvidersByKind('holdings')
    .map((provider) => getTradingProviderOAuthServiceId(provider.id))
    .filter((providerId): providerId is string => Boolean(providerId))

export const getPortfolioSnapshotProviderOptions = (
  providerAvailability?: Record<string, boolean>
) =>
  providerAvailability
    ? getAvailableTradingProviderOptions(providerAvailability, 'holdings')
    : DEFAULT_PORTFOLIO_SNAPSHOT_PROVIDER_OPTIONS

export const resolvePortfolioSnapshotProviderId = (
  params: PortfolioSnapshotWidgetParams | null | undefined,
  providerOptions: Array<{ id: string; name: string }> = DEFAULT_PORTFOLIO_SNAPSHOT_PROVIDER_OPTIONS
) => {
  const provider = typeof params?.provider === 'string' ? params.provider.trim() : ''
  const validOptions = new Set(providerOptions.map((option) => option.id))

  if (provider && validOptions.has(provider)) {
    return provider
  }

  return ''
}

export const getPortfolioSnapshotEnvironmentOptions = (providerId: string) => {
  return (
    getTradingProviderParamDefinitions(providerId, 'holdings')
      .find((definition) => definition.id === 'environment')
      ?.options?.filter((option) => option.id === 'paper' || option.id === 'live') ?? []
  )
}

export const getPortfolioSnapshotDefaultEnvironment = (providerId: string) =>
  getTradingPortfolioDefaultEnvironment(providerId)

export const getPortfolioSnapshotSupportedWindows = (providerId: string) =>
  getTradingPortfolioSupportedWindows(providerId)

export const getPortfolioSnapshotDefaultWindow = (
  providerId: string
): TradingPortfolioPerformanceWindow | undefined => {
  return getPortfolioSnapshotSupportedWindows(providerId)[0]
}

export const resolvePortfolioSnapshotCredentialProvider = (providerId: string) => {
  const providerDefinition = getTradingProviderDefinition(providerId)
  return providerDefinition?.oauth?.serviceId ?? providerDefinition?.oauth?.provider
}
