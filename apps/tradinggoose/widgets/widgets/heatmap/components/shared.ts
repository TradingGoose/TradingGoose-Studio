import { getTradingPortfolioDefaultEnvironment } from '@/providers/trading/portfolio'
import {
  getTradingWidgetEnvironmentOptions,
  getTradingWidgetProviderAvailabilityIds,
  getTradingWidgetProviderOptions,
  resolveTradingWidgetCredentialProvider,
} from '@/widgets/utils/trading-widget-providers'
import {
  resolveConfiguredSeriesMarketProviderId,
  getSeriesMarketProviderOptions,
} from '@/widgets/widgets/data_chart/options'
import type {
  HeatmapSourceMode,
  HeatmapWatchlistSizeMetric,
  HeatmapWidgetParams,
} from '@/widgets/widgets/heatmap/types'

export const HEATMAP_SOURCE_MODES: Array<{ id: HeatmapSourceMode; label: string }> = [
  { id: 'watchlist', label: 'Watchlist' },
  { id: 'portfolio', label: 'Portfolio' },
]

export const HEATMAP_WATCHLIST_SIZE_METRICS: Array<{
  id: HeatmapWatchlistSizeMetric
  label: string
}> = [
  { id: 'volumeUsd', label: 'Volume USD' },
  { id: 'volume', label: 'Volume' },
]

const DEFAULT_HEATMAP_TRADING_PROVIDER_OPTIONS = getTradingWidgetProviderOptions('holdings')

export const getHeatmapMarketProviderOptions = () => getSeriesMarketProviderOptions()

export const resolveHeatmapMarketProviderId = (
  params: HeatmapWidgetParams | null | undefined,
  options = getHeatmapMarketProviderOptions()
) => resolveConfiguredSeriesMarketProviderId(params?.marketProvider, options)

export const resolveHeatmapSourceMode = (
  params: HeatmapWidgetParams | null | undefined
): HeatmapSourceMode => (params?.sourceMode === 'portfolio' ? 'portfolio' : 'watchlist')

export const resolveHeatmapWatchlistSizeMetric = (
  params: HeatmapWidgetParams | null | undefined
): HeatmapWatchlistSizeMetric => (params?.watchlistSizeMetric === 'volume' ? 'volume' : 'volumeUsd')

export const getHeatmapTradingProviderAvailabilityIds = () =>
  getTradingWidgetProviderAvailabilityIds('holdings')

export const getHeatmapTradingProviderOptions = (providerAvailability?: Record<string, boolean>) =>
  getTradingWidgetProviderOptions('holdings', providerAvailability)

export const resolveHeatmapTradingProviderId = (
  params: HeatmapWidgetParams | null | undefined,
  providerOptions: Array<{ id: string; name: string }> = DEFAULT_HEATMAP_TRADING_PROVIDER_OPTIONS
) => {
  const providerId =
    typeof params?.tradingProvider === 'string' ? params.tradingProvider.trim() : ''
  if (!providerId) return ''
  return providerOptions.some((option) => option.id === providerId) ? providerId : ''
}

export const getHeatmapTradingEnvironmentOptions = (providerId: string) =>
  getTradingWidgetEnvironmentOptions(providerId, 'holdings')

export const getHeatmapTradingDefaultEnvironment = (providerId: string) =>
  getTradingPortfolioDefaultEnvironment(providerId)

export const resolveHeatmapEnvironment = (
  providerId: string,
  environment: string | null | undefined
) => {
  const trimmedProviderId = providerId.trim()
  if (!trimmedProviderId) return undefined
  const persistedEnvironment = typeof environment === 'string' ? environment.trim() : ''
  if (
    persistedEnvironment &&
    getHeatmapTradingEnvironmentOptions(trimmedProviderId).some(
      (option) => option.id === persistedEnvironment
    )
  ) {
    return persistedEnvironment
  }
  return getHeatmapTradingDefaultEnvironment(trimmedProviderId)
}

export const resolveHeatmapCredentialProvider = (providerId: string) =>
  resolveTradingWidgetCredentialProvider(providerId)
