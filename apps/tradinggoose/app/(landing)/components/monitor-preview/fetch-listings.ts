import type { ListingOption } from '@/lib/listing/identity'
import { marketClient } from '@/lib/market/client/client'
import { MARKET_API_VERSION } from '@/lib/market/client/constants'
import type { MonitorStock } from '@/app/(landing)/components/monitor-preview/monitor-preview'

const MONITOR_LISTINGS_TIMEOUT_MS = 4000
const MONITOR_LISTINGS_LIMIT = 200
const PREFERRED_MARKET_CODES = new Set(['NASDAQ', 'NYSE', 'NYSEARCA', 'ARCA', 'AMEX'])
const PREFERRED_ASSET_CLASSES = new Set(['stock', 'etf'])

const FALLBACK_STOCKS: MonitorStock[] = [
  { ticker: 'AAPL', name: 'Apple Inc.', iconUrl: '' },
  { ticker: 'TSLA', name: 'Tesla Inc.', iconUrl: '' },
  { ticker: 'NVDA', name: 'NVIDIA Corp.', iconUrl: '' },
  { ticker: 'MSFT', name: 'Microsoft Corp.', iconUrl: '' },
  { ticker: 'AMZN', name: 'Amazon.com Inc.', iconUrl: '' },
  { ticker: 'GOOG', name: 'Alphabet Inc.', iconUrl: '' },
  { ticker: 'META', name: 'Meta Platforms', iconUrl: '' },
  { ticker: 'AMD', name: 'Advanced Micro Devices', iconUrl: '' },
  { ticker: 'NFLX', name: 'Netflix Inc.', iconUrl: '' },
  { ticker: 'SPY', name: 'SPDR S&P 500 ETF', iconUrl: '' },
]

let cachedStocks: MonitorStock[] | null = null
let stocksPromise: Promise<MonitorStock[]> | null = null

const scoreListing = (listing: ListingOption) => {
  let score = 0

  if (typeof listing.name === 'string' && listing.name.trim()) score += 100
  if (typeof listing.iconUrl === 'string' && listing.iconUrl.trim()) score += 10
  if (listing.countryCode === 'US') score += 40
  if (listing.marketCode && PREFERRED_MARKET_CODES.has(listing.marketCode)) score += 20
  if (listing.assetClass && PREFERRED_ASSET_CLASSES.has(listing.assetClass)) score += 30
  if (/^[A-Z]{2,5}$/.test(listing.base || '')) score += 20

  return score + Number(listing.rank ?? 0)
}

const toMonitorStocks = (rows: ListingOption[]): MonitorStock[] => {
  const seenTickers = new Set<string>()

  return rows
    .filter(
      (row) =>
        typeof row.base === 'string' &&
        /^[A-Z]{2,5}$/.test(row.base) &&
        typeof row.name === 'string' &&
        row.name.trim() &&
        typeof row.assetClass === 'string' &&
        PREFERRED_ASSET_CLASSES.has(row.assetClass)
    )
    .sort((left, right) => scoreListing(right) - scoreListing(left))
    .filter((row) => {
      if (seenTickers.has(row.base)) return false
      seenTickers.add(row.base)
      return true
    })
    .map((row) => ({
      ticker: row.base,
      name: row.name ?? row.base,
      iconUrl: row.iconUrl ?? '',
    }))
    .slice(0, 20)
}

export async function fetchMonitorStocks(): Promise<MonitorStock[]> {
  if (cachedStocks) return cachedStocks
  if (stocksPromise) return stocksPromise

  stocksPromise = (async () => {
    try {
      const params = new URLSearchParams({
        search_query: 'a',
        limit: String(MONITOR_LISTINGS_LIMIT),
        version: MARKET_API_VERSION,
      })

      const response = await marketClient.makeRequest<{
        data?: ListingOption[] | ListingOption | null
      }>(`/api/search/listings?${params.toString()}`, {
        timeoutMs: MONITOR_LISTINGS_TIMEOUT_MS,
      })

      if (!response.success || !response.data) {
        return FALLBACK_STOCKS
      }

      const payload = response.data
      const rows = !payload?.data ? [] : Array.isArray(payload.data) ? payload.data : [payload.data]

      const stocks = toMonitorStocks(rows)

      if (stocks.length === 0) {
        return FALLBACK_STOCKS
      }

      cachedStocks = stocks
      return stocks
    } catch {
      return FALLBACK_STOCKS
    } finally {
      stocksPromise = null
    }
  })()

  return stocksPromise
}
