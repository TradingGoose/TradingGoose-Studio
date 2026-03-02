import type { WatchlistRecord } from '@/lib/watchlists/types'
import type { WatchlistWidgetParams } from '@/widgets/widgets/watchlist/types'

export const resolveSelectedWatchlistId = (params: WatchlistWidgetParams | null | undefined) => {
  const raw = params?.watchlistId
  return typeof raw === 'string' && raw.trim().length > 0 ? raw : null
}

export const resolveSelectedWatchlist = (
  watchlists: WatchlistRecord[],
  selectedWatchlistId: string | null
) => watchlists.find((entry) => entry.id === selectedWatchlistId) ?? watchlists[0] ?? null
