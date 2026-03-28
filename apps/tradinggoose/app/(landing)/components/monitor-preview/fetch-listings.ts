import { marketClient } from '@/lib/market/client/client'
import { MARKET_API_VERSION } from '@/lib/market/client/constants'
import type { ListingOption } from '@/lib/listing/identity'

export type MonitorStock = {
  ticker: string
  name: string
  iconUrl: string
}

let cachedStocks: MonitorStock[] | null = null

export async function fetchMonitorStocks(): Promise<MonitorStock[]> {
  if (cachedStocks) return cachedStocks

  try {
    const params = new URLSearchParams({
      search_query: 'a',
      limit: '50',
      version: MARKET_API_VERSION,
    })

    const response = await marketClient.makeRequest<{ data?: ListingOption[] | ListingOption | null }>(
      `/api/search/listings?${params.toString()}`
    )

    if (!response.success || !response.data) {
      return getFallbackStocks()
    }

    const payload = response.data
    const rows = !payload?.data
      ? []
      : Array.isArray(payload.data)
        ? payload.data
        : [payload.data]

    const stocks: MonitorStock[] = rows
      .filter((r) => r.base && r.name)
      .map((r) => ({
        ticker: r.base,
        name: r.name ?? r.base,
        iconUrl: r.iconUrl ?? '',
      }))
      .slice(0, 20)

    if (stocks.length > 0) {
      cachedStocks = stocks
      return stocks
    }
  } catch {
    // fall through to fallback
  }

  return getFallbackStocks()
}

function getFallbackStocks(): MonitorStock[] {
  return [
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
}
