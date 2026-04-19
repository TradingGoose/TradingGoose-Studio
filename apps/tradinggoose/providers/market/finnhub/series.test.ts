/**
 * @vitest-environment node
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { fetchMock, mockResolveListingContext, mockResolveProviderSymbol } = vi.hoisted(() => ({
  fetchMock: vi.fn(),
  mockResolveListingContext: vi.fn(),
  mockResolveProviderSymbol: vi.fn(),
}))

vi.mock('@/lib/logs/console/logger', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}))

vi.mock('@/providers/market/utils', () => ({
  resolveListingContext: (...args: unknown[]) => mockResolveListingContext(...args),
  resolveProviderSymbol: (...args: unknown[]) => mockResolveProviderSymbol(...args),
}))

const originalFinnhubApiKey = process.env.FINNHUB_API_KEY

describe('fetchFinnhubSeries', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubGlobal('fetch', fetchMock)
    mockResolveListingContext.mockResolvedValue({
      listing: {
        listing_id: 'AAPL',
        base_id: '',
        quote_id: '',
        listing_type: 'default',
      },
      base: 'AAPL',
      assetClass: 'stock',
      timeZoneName: 'America/New_York',
    })
    mockResolveProviderSymbol.mockReturnValue('AAPL')
  })

  afterEach(() => {
    process.env.FINNHUB_API_KEY = originalFinnhubApiKey
    vi.unstubAllGlobals()
  })

  it('does not fall back to deployment env when request auth is missing', async () => {
    process.env.FINNHUB_API_KEY = 'deployment-key'

    const { fetchFinnhubSeries } = await import('./series')

    await expect(
      fetchFinnhubSeries({
        listing: {
          listing_id: 'AAPL',
          base_id: '',
          quote_id: '',
          listing_type: 'default',
        },
        interval: '1d',
        start: '2026-01-01T00:00:00.000Z',
        end: '2026-01-02T00:00:00.000Z',
      })
    ).rejects.toThrow('Finnhub API key is required')

    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('uses explicit request auth for provider calls', async () => {
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          s: 'ok',
          c: [101],
          h: [102],
          l: [100],
          o: [100],
          t: [1735689600],
          v: [1000],
        }),
        {
          status: 200,
          headers: {
            'content-type': 'application/json',
          },
        }
      )
    )

    const { fetchFinnhubSeries } = await import('./series')

    await fetchFinnhubSeries({
      listing: {
        listing_id: 'AAPL',
        base_id: '',
        quote_id: '',
        listing_type: 'default',
      },
      auth: {
        apiKey: 'request-key',
      },
      interval: '1d',
      start: '2026-01-01T00:00:00.000Z',
      end: '2026-01-02T00:00:00.000Z',
    })

    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('symbol=AAPL'),
      expect.objectContaining({
        headers: expect.objectContaining({
          'X-Finnhub-Token': 'request-key',
        }),
      })
    )
  })
})
