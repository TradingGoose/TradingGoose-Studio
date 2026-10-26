/**
 * @vitest-environment node
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const {
  fetchMock,
  mockResolveListingContext,
  mockResolveProviderSymbol,
  mockResolveMarketHours,
  mockResolveMarketHoursRange,
} = vi.hoisted(() => ({
  fetchMock: vi.fn(),
  mockResolveListingContext: vi.fn(),
  mockResolveProviderSymbol: vi.fn(),
  mockResolveMarketHours: vi.fn(),
  mockResolveMarketHoursRange: vi.fn(),
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
  resolveMarketHours: mockResolveMarketHours,
  resolveMarketHoursRange: mockResolveMarketHoursRange,
}))

const originalAlphaVantageApiKey = process.env.ALPHAVANTAGE_API_KEY

describe('fetchAlphaVantageSeries', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubGlobal('fetch', fetchMock)
    mockResolveMarketHoursRange.mockResolvedValue(
      new Map([
        [
          '2026-01-02',
          {
            timeZone: { utcOffset: '-05:00' },
            marketHours: { market: { start: '09:30', end: '16:00' } },
          },
        ],
      ])
    )
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

  it('does not retry each day of full history when bulk market hours are unavailable', async () => {
    const { resolveMarketSessionsForRange } = await import('../market-hours/sessions')
    mockResolveMarketHoursRange.mockResolvedValueOnce(null)

    const sessions = await resolveMarketSessionsForRange(
      'AAPL',
      'default',
      Date.parse('1962-01-01'),
      Date.parse('2026-10-01')
    )

    expect(mockResolveMarketHoursRange).toHaveBeenCalledTimes(1)
    expect({ sessions, dailyRequests: mockResolveMarketHours.mock.calls.length }).toEqual({
      sessions: null,
      dailyRequests: 0,
    })
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
          'Meta Data': { '5. Time Zone': 'US/Eastern' },
          [seriesKey]:
            interval === '1m'
              ? { '2026-01-02 08:30:00': candle, '2026-01-02 09:30:00': candle }
              : { '2026-01-02': candle, '2026-01-05': candle },
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
      normalizationMode: 'raw',
      windows: [
        {
          mode: 'absolute',
          start: '2026-01-02T00:00:00.000Z',
          end: interval === '1m' ? '2026-01-02T16:00:00.000Z' : '2026-01-05T16:00:00.000Z',
        },
      ],
    })

    expect(response).toMatchObject({
      bars: (interval === '1m'
        ? ['2026-01-02T14:30:00.000Z']
        : ['2026-01-02T05:00:00.000Z', '2026-01-05T05:00:00.000Z']
      ).map((timeStamp) => ({ timeStamp, close: 101 })),
    })
    if (interval !== '1m') {
      expect(mockResolveMarketHoursRange).not.toHaveBeenCalled()
      expect(mockResolveMarketHours).not.toHaveBeenCalled()
    }
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('apikey=request-key'),
      expect.objectContaining({
        headers: expect.objectContaining({
          Accept: 'application/json',
        }),
      })
    )
    if (interval === '1m') {
      expect(new URL(fetchMock.mock.calls[0][0]).searchParams.get('adjusted')).toBe('false')
    }
  })

  it.each([
    ['2026-01-02', '05:00', '14:30'],
    ['2026-07-02', '04:00', '13:30'],
  ])(
    'normalizes source midnight and market open through the response timezone on %s',
    async (date, midnight, open) => {
      const { fetchAlphaVantageSeries } = await import('./series')
      for (const [interval, raw, expected] of [
        ['1d', date, midnight],
        ['1m', `${date} 09:30:00`, open],
      ]) {
        fetchMock.mockResolvedValueOnce(
          new Response(
            JSON.stringify({
              'Meta Data': { '5. Time Zone': 'US/Eastern' },
              'Time Series': { [raw]: { '4. close': '101' } },
            })
          )
        )
        expect(
          await fetchAlphaVantageSeries({
            kind: 'series',
            listing: { listing_id: 'AAPL', base_id: '', quote_id: '', listing_type: 'default' },
            interval,
            auth: { apiKey: 'key' },
          })
        ).toMatchObject({
          timezone: 'US/Eastern',
          bars: [{ timeStamp: `${date}T${expected}:00.000Z`, close: 101 }],
        })
      }
    }
  )

  it.each([
    ['forward split', 2, 200, 100],
    ['reverse split', 0.2, 20, 100],
    ['cash dividend', 1, 100, 99],
  ])(
    'uses split-only prices across a %s, including events outside the requested range',
    async (_event, coefficient, priorClose, currentClose) => {
      const candle = (close: number, split: number) => ({
        '1. open': String(close),
        '2. high': String(close),
        '3. low': String(close),
        '4. close': String(close),
        '5. adjusted close': '42',
        '6. volume': '10',
        '7. dividend amount': '1',
        '8. split coefficient': String(split),
      })
      fetchMock.mockResolvedValue(
        Response.json({
          'Meta Data': { '5. Time Zone': 'US/Eastern' },
          'Time Series (Daily)': {
            '2026-10-23': candle(priorClose, 1),
            '2026-10-26': candle(currentClose, coefficient),
          },
        })
      )
      const { fetchAlphaVantageSeries } = await import('./series')
      const result = await fetchAlphaVantageSeries({
        kind: 'series',
        listing: { listing_id: 'AAPL', base_id: '', quote_id: '', listing_type: 'default' },
        auth: { apiKey: 'key' },
        interval: '1d',
        normalizationMode: 'split_adjusted',
        start: '2026-10-23T00:00:00Z',
        end: '2026-10-24T00:00:00Z',
      })
      expect(result.bars).toEqual([
        {
          timeStamp: '2026-10-23T04:00:00.000Z',
          open: 100,
          high: 100,
          low: 100,
          close: 100,
          volume: 10 * coefficient,
        },
      ])
      expect(new URL(fetchMock.mock.calls[0][0]).searchParams.get('function')).toBe(
        'TIME_SERIES_DAILY_ADJUSTED'
      )
    }
  )

  it.each(['1m', '1w', '1mo'])(
    'rejects unsupported split-only %s equity data',
    async (interval) => {
      const { fetchAlphaVantageSeries } = await import('./series')
      await expect(
        fetchAlphaVantageSeries({
          kind: 'series',
          listing: { listing_id: 'AAPL', base_id: '', quote_id: '', listing_type: 'default' },
          auth: { apiKey: 'key' },
          interval,
          normalizationMode: 'split_adjusted',
        })
      ).rejects.toThrow(`does not support split_adjusted at ${interval}`)
      expect(fetchMock).not.toHaveBeenCalled()
    }
  )

  it('rejects responses without the source timezone instead of guessing UTC', async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ 'Time Series': { '2026-01-02': { '4. close': '101' } } }))
    )
    const { fetchAlphaVantageSeries } = await import('./series')
    await expect(
      fetchAlphaVantageSeries({
        kind: 'series',
        listing: { listing_id: 'AAPL', base_id: '', quote_id: '', listing_type: 'default' },
        auth: { apiKey: 'key' },
      })
    ).rejects.toThrow('missing its time zone')
  })
})
