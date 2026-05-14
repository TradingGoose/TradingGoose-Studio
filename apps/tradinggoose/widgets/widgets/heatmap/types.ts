import type { PortfolioIdentity } from '@/providers/trading/portfolio-identity'

export type HeatmapSourceMode = 'watchlist' | 'portfolio'
export type HeatmapWatchlistSizeMetric = 'volume' | 'volumeUsd'

export interface HeatmapWidgetParams {
  sourceMode?: HeatmapSourceMode
  watchlistSizeMetric?: HeatmapWatchlistSizeMetric
  marketProvider?: string
  marketProviderParams?: Record<string, unknown>
  marketAuth?: {
    apiKey?: string
    apiSecret?: string
    [key: string]: unknown
  }
  tradingProvider?: string
  serviceId?: string
  portfolioIdentity?: PortfolioIdentity
  runtime?: {
    refreshAt?: number
  }
}
