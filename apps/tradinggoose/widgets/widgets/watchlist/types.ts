export type WatchlistWidgetParams = {
  watchlistId?: string | null
  provider?: string
  providerParams?: Record<string, unknown>
  auth?: {
    apiKey?: string
    apiSecret?: string
  }
  runtime?: {
    refreshAt?: number
  }
}
