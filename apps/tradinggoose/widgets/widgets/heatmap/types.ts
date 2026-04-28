export type HeatmapSourceMode = 'watchlist' | 'portfolio'

export interface HeatmapWidgetParams {
  sourceMode?: HeatmapSourceMode
  marketProvider?: string
  marketProviderParams?: Record<string, unknown>
  marketAuth?: {
    apiKey?: string
    apiSecret?: string
    [key: string]: unknown
  }
  tradingProvider?: string
  credentialId?: string
  environment?: 'paper' | 'live'
  accountId?: string
  runtime?: {
    refreshAt?: number
  }
}
