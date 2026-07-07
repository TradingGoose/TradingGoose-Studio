import { getTradingPortfolioSupportedWindows } from '@/providers/trading/portfolio'
import type { TradingPortfolioPerformanceWindow } from '@/providers/trading/types'
import type { PortfolioSnapshotWidgetParams } from '@/widgets/widgets/portfolio_snapshot/contract'
import {
  getTradingWidgetProviderAvailabilityIds,
  getTradingWidgetProviderOptions,
  resolveTradingWidgetProviderId,
} from '@/widgets/utils/trading-widget-providers'
import {
  getSeriesMarketProviderOptions,
  resolveConfiguredSeriesMarketProviderId,
} from '@/widgets/widgets/data_chart/options'

const DEFAULT_PORTFOLIO_SNAPSHOT_PROVIDER_OPTIONS =
  getTradingWidgetProviderOptions('portfolioDetail')

export const getPortfolioSnapshotProviderAvailabilityIds = () =>
  getTradingWidgetProviderAvailabilityIds('portfolioDetail')

export const getPortfolioSnapshotProviderOptions = (
  providerAvailability?: Record<string, boolean>
) => getTradingWidgetProviderOptions('portfolioDetail', providerAvailability)

export const resolvePortfolioSnapshotProviderId = (
  params: PortfolioSnapshotWidgetParams | null | undefined,
  providerOptions: Array<{ id: string; name: string }> = DEFAULT_PORTFOLIO_SNAPSHOT_PROVIDER_OPTIONS
) => {
  return resolveTradingWidgetProviderId(params?.provider, providerOptions)
}

export const getPortfolioSnapshotSupportedWindows = (providerId: string) =>
  getTradingPortfolioSupportedWindows(providerId)

export const getPortfolioSnapshotDefaultWindow = (
  providerId: string
): TradingPortfolioPerformanceWindow | undefined => {
  return getPortfolioSnapshotSupportedWindows(providerId)[0]
}

export const getPortfolioSnapshotMarketProviderOptions = () => getSeriesMarketProviderOptions()

export const resolvePortfolioSnapshotMarketProviderId = (
  params: PortfolioSnapshotWidgetParams | null | undefined,
  options = getPortfolioSnapshotMarketProviderOptions()
) => resolveConfiguredSeriesMarketProviderId(params?.marketProvider, options)
