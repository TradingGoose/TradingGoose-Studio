import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ListingIdentity } from '@/lib/listing/identity'
import { applySeriesWindow, planMarketSeriesRequest } from '@/providers/market/series-planner'
import { fetchYahooFinanceSeries } from '@/providers/market/yahoo-finance/series'

vi.mock('@/providers/market/utils', () => ({
  resolveListingContext: vi.fn(async (listing: ListingIdentity) => ({
    listing,
    base: 'IBM',
    assetClass: 'stock',
  })),
  resolveProviderSymbol: vi.fn(() => 'IBM'),
}))

afterEach(() => vi.unstubAllGlobals())

describe('Yahoo all history', () => {
  it('requests native maximum history and preserves bars older than 50 years', async () => {
    const dates = ['1962-01-01T00:00:00.000Z', '2026-10-01T00:00:00.000Z']
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          chart: {
            result: [
              {
                timestamp: dates.map((date) => Date.parse(date) / 1000),
                indicators: { quote: [{ close: [100, 200] }] },
              },
            ],
          },
        })
      )
    )
    vi.stubGlobal('fetch', fetchMock)
    const { request, window } = planMarketSeriesRequest('yahoo-finance', {
      kind: 'series',
      listing: { listing_id: 'IBM', base_id: '', quote_id: '', listing_type: 'default' },
      interval: '1mo',
      windows: [{ mode: 'all' }],
      providerParams: { range: '1d' },
    })

    const series = await fetchYahooFinanceSeries(request)

    const url = new URL(fetchMock.mock.calls[0][0])
    expect(url.searchParams.get('range')).toBe('max')
    expect(url.searchParams.get('interval')).toBe('3mo')
    expect(url.searchParams.has('period1')).toBe(false)
    expect(url.searchParams.has('period2')).toBe(false)
    expect(applySeriesWindow(series, window).bars.map((bar) => bar.timeStamp)).toEqual(dates)
  })
})
