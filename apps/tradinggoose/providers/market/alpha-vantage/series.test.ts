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

vi.mock('@/providers/market/market-hours/market-hours-api', () => ({
  resolveMarketHours: vi.fn(),
  resolveMarketHoursRange: vi.fn(
    async () =>
      new Map([
        [
          '2026-01-02',
          {
            timeZone: { utcOffset: '-05:00' },
            marketHours: { market: { start: '09:30', end: '16:00' } },
          },
        ],
      ])
  ),
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
        kind: 'series',
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

  it.each([
    ['1d', 'Time Series (Daily)'],
    ['1w', 'Weekly Time Series'],
    ['1mo', 'Monthly Time Series'],
    ['1m', 'Time Series (1min)'],
  ])('keeps %s candles and uses request auth', async (interval, seriesKey) => {
    const candle = {
      '1. open': '100',
      '2. high': '102',
      '3. low': '99',
      '4. close': '101',
      '5. volume': '1000',
    }
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          [seriesKey]:
            interval === '1m'
              ? { '2026-01-02 13:30:00': candle, '2026-01-02 14:30:00': candle }
              : { '2026-01-02': candle },
        }),
        {
          status: 200,
          headers: {
            'content-type': 'application/json',
          },
        }
      )
    )

    const { executeProviderRequest } = await import('@/providers/market')

    const response = await executeProviderRequest('alpha-vantage', {
      kind: 'series',
      listing: {
        listing_id: 'AAPL',
        base_id: '',
        quote_id: '',
        listing_type: 'default',
      },
      auth: {
        apiKey: 'request-key',
      },
      interval,
      windows: [
        {
          mode: 'absolute',
          start: '2026-01-02T00:00:00.000Z',
          end: '2026-01-02T16:00:00.000Z',
        },
      ],
    })

    expect(response).toMatchObject({
      bars: [
        {
          timeStamp: interval === '1m' ? '2026-01-02T14:30:00.000Z' : '2026-01-02T00:00:00.000Z',
          close: 101,
        },
      ],
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
