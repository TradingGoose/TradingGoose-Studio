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

const originalAlphaVantageApiKey = process.env.ALPHAVANTAGE_API_KEY

describe('fetchAlphaVantageSeries', () => {
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
    process.env.ALPHAVANTAGE_API_KEY = originalAlphaVantageApiKey
    vi.unstubAllGlobals()
  })

  it('does not fall back to deployment env when request auth is missing', async () => {
    process.env.ALPHAVANTAGE_API_KEY = 'deployment-key'

    const { fetchAlphaVantageSeries } = await import('./series')

    await expect(
      fetchAlphaVantageSeries({
        listing: {
          listing_id: 'AAPL',
          base_id: '',
          quote_id: '',
          listing_type: 'default',
        },
        interval: '1d',
      })
    ).rejects.toThrow('Alpha Vantage API key is required')

    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('uses explicit request auth for provider calls', async () => {
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          'Time Series (Daily)': {
            '2026-01-02': {
              '1. open': '100',
              '2. high': '102',
              '3. low': '99',
              '4. close': '101',
              '5. volume': '1000',
            },
          },
        }),
        {
          status: 200,
          headers: {
            'content-type': 'application/json',
          },
        }
      )
    )

    const { fetchAlphaVantageSeries } = await import('./series')

    await fetchAlphaVantageSeries({
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
    })

    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('apikey=request-key'),
      expect.objectContaining({
        headers: expect.objectContaining({
          Accept: 'application/json',
        }),
      })
    )
  })
})
