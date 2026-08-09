import { afterEach, describe, expect, it, vi } from 'vitest'

const makeRequest = vi.hoisted(() => vi.fn())

vi.mock('@/lib/market/client/client', () => ({
  marketClient: { makeRequest },
}))

import { fetchMonitorStocks } from './fetch-listings'

describe('fetchMonitorStocks', () => {
  afterEach(() => {
    vi.clearAllMocks()
    vi.useRealTimers()
  })

  it('does not block the landing when market requests never settle', async () => {
    vi.useFakeTimers()
    makeRequest.mockReturnValue(new Promise(() => undefined))

    const stocks = fetchMonitorStocks()
    await vi.advanceTimersByTimeAsync(4_250)

    await expect(stocks).resolves.toEqual([])
  })

  it('returns successful market listings before the total timeout', async () => {
    makeRequest.mockResolvedValue({
      success: true,
      data: {
        data: [
          {
            listing_id: 'listing-1',
            base_id: '',
            quote_id: '',
            listing_type: 'default',
            base: 'AAPL',
            name: 'Apple',
            marketCode: 'NASDAQ',
            assetClass: 'stock',
          },
        ],
      },
    })

    const stocks = await fetchMonitorStocks()
    expect(stocks).toEqual(expect.arrayContaining([expect.objectContaining({ base: 'AAPL' })]))
  })
})
