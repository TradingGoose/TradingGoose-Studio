import { normalizeListingOptions } from '@/components/listing-selector/fetchers'
import { readServerJsonCache, writeServerJsonCache } from '@/lib/cache/server-json-cache'
import type { ListingOption } from '@/lib/listing/identity'
import { marketClient } from '@/lib/market/client/client'
import { MARKET_API_VERSION } from '@/lib/market/client/constants'
import {
  filterToPreferredMarkets,
  PREFERRED_MARKET_CODES,
  sortMonitorListings,
} from '@/app/(landing)/components/monitor-preview/listing-preference'

// Stale-while-revalidate window:
//  - Data stays cached for CACHE_TTL (24h) so we never serve absolutely cold.
//  - A request is considered "fresh" if fetched within FRESH_WINDOW (15 min).
//  - When stale-but-cached, we return immediately and kick off a background
//    revalidation without blocking the SSR render.
const MONITOR_LISTINGS_CACHE_TTL_SECONDS = 24 * 60 * 60
const MONITOR_LISTINGS_FRESH_WINDOW_MS = 15 * 60 * 1000
// v6: switched to one request per PREFERRED_MARKET_CODES with per-market limit.
const MONITOR_LISTINGS_CACHE_KEY = 'landing-monitor-listings:v6'
const MONITOR_PREVIEW_ROW_LIMIT = 20
const MONITOR_LISTINGS_TIMEOUT_MS = 4000

type CachedEnvelope = {
  data: ListingOption[]
  fetchedAt: number
}

// Deduplicate concurrent revalidations across simultaneous SSR requests.
let inflightRevalidation: Promise<ListingOption[]> | null = null

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

const FALLBACK_STOCKS: ListingOption[] = [
  ['AAPL', 'Apple Inc.', 'stock'],
  ['TSM', 'Taiwan Semiconductor', 'stock'],
  ['ASML', 'ASML Holding', 'stock'],
  ['SONY', 'Sony Group', 'stock'],
  ['SAP', 'SAP SE', 'stock'],
  ['NVO', 'Novo Nordisk', 'stock'],
  ['BABA', 'Alibaba Group', 'stock'],
  ['SHOP', 'Shopify', 'stock'],
  ['MELI', 'MercadoLibre', 'stock'],
  ['RELX', 'RELX', 'stock'],
].map(([base, name, assetClass]) => ({
  listing_id: `fallback-${base.toLowerCase()}`,
  base_id: '',
  quote_id: '',
  listing_type: 'default' as const,
  base,
  name,
  iconUrl: '',
  assetClass,
}))

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

  const combined = results.flatMap((result) =>
    result.status === 'fulfilled' ? result.value : []
  )

  // filterToPreferredMarkets is belt-and-suspenders in case the upstream
  // ignored the market filter and returned listings from other exchanges.
  return sortMonitorListings(filterToPreferredMarkets(combined)).slice(
    0,
    MONITOR_PREVIEW_ROW_LIMIT
  )
}

async function revalidateCache(): Promise<ListingOption[]> {
  if (inflightRevalidation) return inflightRevalidation

  inflightRevalidation = (async () => {
    try {
      const listings = await requestMonitorListings()
      if (listings.length > 0) {
        const envelope: CachedEnvelope = { data: listings, fetchedAt: Date.now() }
        await writeServerJsonCache(
          MONITOR_LISTINGS_CACHE_KEY,
          envelope,
          MONITOR_LISTINGS_CACHE_TTL_SECONDS
        )
        return listings
      }
      return []
    } catch {
      return []
    } finally {
      inflightRevalidation = null
    }
  })()

  return inflightRevalidation
}

export async function fetchMonitorStocks(): Promise<ListingOption[]> {
  const cached = await readServerJsonCache<CachedEnvelope>(MONITOR_LISTINGS_CACHE_KEY)

  if (cached && Array.isArray(cached.data) && cached.data.length > 0) {
    const isStale = Date.now() - cached.fetchedAt > MONITOR_LISTINGS_FRESH_WINDOW_MS
    if (isStale) {
      // Stale-while-revalidate: serve the cached data immediately, refresh
      // in the background without blocking this response.
      void revalidateCache()
    }
    return cached.data.slice(0, MONITOR_PREVIEW_ROW_LIMIT)
  }

  // No cache at all — first ever request or Redis miss. Don't let a slow
  // upstream stall the SSR: kick off the revalidation in the background and
  // serve FALLBACK_STOCKS immediately. The client-side refresh in
  // monitor-preview.tsx will populate real data once the fetch lands.
  void revalidateCache()
  return FALLBACK_STOCKS
}
