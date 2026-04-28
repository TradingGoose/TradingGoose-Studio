import { beforeEach, describe, expect, it, vi } from 'vitest'
import { buildMarketQuoteSnapshot } from '@/lib/market/quote-snapshots'

const mockExecuteProviderRequest = vi.fn()

vi.mock('@/providers/market', () => ({
  executeProviderRequest: (...args: unknown[]) => mockExecuteProviderRequest(...args),
}))

describe('buildMarketQuoteSnapshot', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('uses regular intraday last price with prior daily close for quote math', async () => {
    mockExecuteProviderRequest.mockImplementation(async (_providerId, request: any) => {
      if (request.interval === '1d') {
        return {
          bars: [
            { timeStamp: '2026-01-01T00:00:00.000Z', close: 100 },
            { timeStamp: '2026-01-02T00:00:00.000Z', close: 105 },
          ],
        }
      }

      return {
        bars: [{ timeStamp: '2026-01-03T15:59:00.000Z', close: 110 }],
      }
    })

    await expect(
      buildMarketQuoteSnapshot({
        provider: 'alpaca',
        listing: {
          listing_id: 'AAPL',
          base_id: '',
          quote_id: '',
          listing_type: 'default',
        },
      })
    ).resolves.toEqual({
      lastPrice: 110,
      previousClose: 100,
      change: 10,
      changePercent: 10,
    })
  })
})
