import { normalizeListingOptions } from '@/components/listing-selector/fetchers'
import { buildMarketSearchRequest } from '@/components/listing-selector/selector/search-request'
import { readServerJsonCache, writeServerJsonCache } from '@/lib/cache/server-json-cache'
import type { ListingOption } from '@/lib/listing/identity'
import { marketClient } from '@/lib/market/client/client'
import { MARKET_API_VERSION } from '@/lib/market/client/constants'
import { sortMonitorListings } from '@/app/(landing)/components/monitor-preview/listing-preference'

const MONITOR_LISTINGS_CACHE_TTL_SECONDS = 5 * 60
const MONITOR_LISTINGS_CACHE_KEY = 'landing-monitor-listings:v3'
const MONITOR_PREVIEW_ROW_LIMIT = 20
const MONITOR_LISTINGS_TIMEOUT_MS = 4000

const LANDING_MONITOR_QUERY = new URLSearchParams({
  ...buildMarketSearchRequest({
    rawQuery: 'a',
    providerConfig: {
      assetClasses: ['stock'],
      marketCodes: [],
      listingQuoteCodes: [],
      cryptoQuoteCodes: [],
      currencyQuoteCodes: [],
    },
  }).queryParams,
  version: MARKET_API_VERSION,
}).toString()

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

async function requestMonitorListings(): Promise<ListingOption[]> {
  const response = await marketClient.makeRequest<{
    data?: ListingOption[] | ListingOption | null
  }>(`/api/search?${LANDING_MONITOR_QUERY}`, {
    timeoutMs: MONITOR_LISTINGS_TIMEOUT_MS,
  })

  if (!response.success || !response.data) return []

  return sortMonitorListings(normalizeListingOptions(response.data)).slice(
    0,
    MONITOR_PREVIEW_ROW_LIMIT
  )
}

export async function fetchMonitorStocks(): Promise<ListingOption[]> {
  try {
    const cached = await readServerJsonCache<ListingOption[]>(MONITOR_LISTINGS_CACHE_KEY)
    if (cached && cached.length > 0) return cached.slice(0, MONITOR_PREVIEW_ROW_LIMIT)

    const listings = await requestMonitorListings()
    if (listings.length > 0) {
      await writeServerJsonCache(
        MONITOR_LISTINGS_CACHE_KEY,
        listings,
        MONITOR_LISTINGS_CACHE_TTL_SECONDS
      )
      return listings
    }
  } catch {}

  return FALLBACK_STOCKS
}
