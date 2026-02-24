import type { WatchlistColumnKey, WatchlistSortDirection } from '@/lib/watchlists/types'

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
  sort?: {
    column: WatchlistColumnKey
    direction: WatchlistSortDirection
  } | null
}
