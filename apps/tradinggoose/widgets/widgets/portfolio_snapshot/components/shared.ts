import {
  getTradingPortfolioDefaultEnvironment,
  getTradingPortfolioSupportedWindows,
} from '@/providers/trading/portfolio'
import type { TradingPortfolioPerformanceWindow } from '@/providers/trading/types'
import {
  getSeriesMarketProviderOptions,
  resolveSeriesMarketProviderId,
} from '@/widgets/widgets/data_chart/options'
import {
  getTradingWidgetEnvironmentOptions,
  getTradingWidgetProviderAvailabilityIds,
  getTradingWidgetProviderOptions,
  resolveTradingWidgetCredentialProvider,
  resolveTradingWidgetProviderId,
} from '@/widgets/utils/trading-widget-providers'
import type { PortfolioSnapshotWidgetParams } from '@/widgets/widgets/portfolio_snapshot/types'

const DEFAULT_PORTFOLIO_SNAPSHOT_PROVIDER_OPTIONS = getTradingWidgetProviderOptions('holdings')

export const getPortfolioSnapshotProviderAvailabilityIds = () =>
  getTradingWidgetProviderAvailabilityIds('holdings')

export const getPortfolioSnapshotProviderOptions = (
  providerAvailability?: Record<string, boolean>
) => getTradingWidgetProviderOptions('holdings', providerAvailability)

export const resolvePortfolioSnapshotProviderId = (
  params: PortfolioSnapshotWidgetParams | null | undefined,
  providerOptions: Array<{ id: string; name: string }> = DEFAULT_PORTFOLIO_SNAPSHOT_PROVIDER_OPTIONS
) => {
  return resolveTradingWidgetProviderId(params?.provider, providerOptions)
}

export const getPortfolioSnapshotEnvironmentOptions = (providerId: string) => {
  return getTradingWidgetEnvironmentOptions(providerId, 'holdings')
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
  return resolveTradingWidgetCredentialProvider(providerId)
}

export const getPortfolioSnapshotMarketProviderOptions = () => getSeriesMarketProviderOptions()

export const resolvePortfolioSnapshotMarketProviderId = (
  params: PortfolioSnapshotWidgetParams | null | undefined,
  options = getPortfolioSnapshotMarketProviderOptions()
) => resolveSeriesMarketProviderId(params?.marketProvider, options)

export const shouldPersistPortfolioSnapshotMarketProviderDefault = (
  params: PortfolioSnapshotWidgetParams | null | undefined,
  providerId: string
) => {
  if (!providerId.trim()) return false
  const persisted = typeof params?.marketProvider === 'string' ? params.marketProvider.trim() : ''
  return persisted !== providerId
}
