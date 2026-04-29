import { afterEach, describe, expect, it, vi } from 'vitest'
import { MARKET_QUOTE_SNAPSHOT_REQUEST_CAP } from '@/lib/market/quote-snapshot-contract'
import { fetchMarketQuoteSnapshots } from '@/hooks/queries/market-quote-snapshots'

const listing = {
  listing_id: 'AAPL',
  base_id: '',
  quote_id: '',
  listing_type: 'default' as const,
}

describe('fetchMarketQuoteSnapshots', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('forwards cancellation signals to chunked quote requests', async () => {
    const controller = new AbortController()
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({
        quotes: {
          item: {
            lastPrice: 100,
            previousClose: 90,
            change: 10,
            changePercent: 11.11,
          },
        },
      }),
    } as Response)

    await fetchMarketQuoteSnapshots({
      workspaceId: 'workspace-1',
      provider: 'alpaca',
      items: [{ key: 'item', listing }],
      signal: controller.signal,
    })

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/providers/market/quotes',
      expect.objectContaining({
        signal: controller.signal,
      })
    )
  })

  it('chunks direct fetch requests by the market quote request ceiling', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (_url, init) => {
      const body = JSON.parse(String(init?.body)) as {
        items: Array<{ key: string }>
      }
      expect(body.items.length).toBeLessThanOrEqual(MARKET_QUOTE_SNAPSHOT_REQUEST_CAP)
      return {
        ok: true,
        json: async () => ({
          quotes: Object.fromEntries(
            body.items.map((item, index) => [
              item.key,
              {
                lastPrice: index,
                previousClose: 1,
                change: 0,
                changePercent: 0,
              },
            ])
          ),
        }),
      } as Response
    })

    const items = Array.from({ length: MARKET_QUOTE_SNAPSHOT_REQUEST_CAP + 1 }, (_, index) => ({
      key: `item-${index}`,
      listing,
    }))

    const quotes = await fetchMarketQuoteSnapshots({
      workspaceId: 'workspace-1',
      provider: 'alpaca',
      items,
    })

    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(Object.keys(quotes)).toHaveLength(MARKET_QUOTE_SNAPSHOT_REQUEST_CAP + 1)
    expect(quotes[`item-${MARKET_QUOTE_SNAPSHOT_REQUEST_CAP}`]).toEqual({
      lastPrice: 0,
      previousClose: 1,
      change: 0,
      changePercent: 0,
    })
  })
})
