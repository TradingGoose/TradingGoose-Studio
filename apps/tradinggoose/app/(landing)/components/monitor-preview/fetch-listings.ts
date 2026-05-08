import { normalizeListingOptions } from '@/components/listing-selector/fetchers'
import type { ListingOption } from '@/lib/listing/identity'
import { marketClient } from '@/lib/market/client/client'
import { MARKET_API_VERSION } from '@/lib/market/client/constants'
import {
  filterToPreferredMarkets,
  PREFERRED_MARKET_CODES,
  sortMonitorListings,
} from '@/app/(landing)/components/monitor-preview/listing-preference'

const MONITOR_PREVIEW_ROW_LIMIT = 20
const MONITOR_LISTINGS_TIMEOUT_MS = 4000

// Per-market result budget. Total pool = PER_MARKET_LIMIT * markets (5) = 50.
const MONITOR_PER_MARKET_LIMIT = 10

function buildMarketQuery(marketCode: string): string {
  return new URLSearchParams({
    search_query: 'a',
    filters: JSON.stringify({
      limit: MONITOR_PER_MARKET_LIMIT,
      asset_class: ['stock'],
      market: [marketCode],
    }),
    version: MARKET_API_VERSION,
  }).toString()
}

async function requestMarketListings(marketCode: string): Promise<ListingOption[]> {
  const response = await marketClient.makeRequest<{
    data?: ListingOption[] | ListingOption | null
  }>(`/api/search?${buildMarketQuery(marketCode)}`, {
    timeoutMs: MONITOR_LISTINGS_TIMEOUT_MS,
  })

  if (!response.success || !response.data) return []
  return normalizeListingOptions(response.data)
}

async function requestMonitorListings(): Promise<ListingOption[]> {
  // Fire one request per preferred market in parallel. allSettled so a
  // single slow/failing market doesn't starve the rest of the table.
  const results = await Promise.allSettled(
    PREFERRED_MARKET_CODES.map((code) => requestMarketListings(code))
  )

  const combined = results.flatMap((result) => (result.status === 'fulfilled' ? result.value : []))

  // filterToPreferredMarkets is belt-and-suspenders in case the upstream
  // ignored the market filter and returned listings from other exchanges.
  return sortMonitorListings(filterToPreferredMarkets(combined)).slice(0, MONITOR_PREVIEW_ROW_LIMIT)
}

export async function fetchMonitorStocks(): Promise<ListingOption[]> {
  return requestMonitorListings().catch(() => [])
}
