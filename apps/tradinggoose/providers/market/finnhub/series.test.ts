/**
 * @vitest-environment node
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { planMarketSeriesRequest } from '@/providers/market/series-planner'
import type { MarketLiveRequest, MarketSeriesRequest } from '@/providers/market/types'

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
  resolveListingContext: mockResolveListingContext,
  resolveProviderSymbol: mockResolveProviderSymbol,
}))

vi.mock('@/providers/market', () => ({
  executeProviderRequest: async (_provider: string, request: MarketSeriesRequest) =>
    (await import('./series')).fetchFinnhubSeries(request),
}))

vi.mock('@/providers/market/request', () => ({
  fetchMarketProviderJson: async (
    _config: unknown,
    _apiKey: unknown,
    input: string,
    init?: RequestInit
  ) => (await globalThis.fetch(input, init)).json(),
}))

const listing = { listing_id: 'AAPL', base_id: '', quote_id: '', listing_type: 'default' } as const
const currencyContext = {
  listing: { listing_id: '', base_id: 'EUR', quote_id: 'USD', listing_type: 'currency' },
  base: 'EUR',
  quote: 'USD',
  assetClass: 'currency',
} as const
const request: MarketSeriesRequest = {
  kind: 'series',
  listing,
  auth: { apiKey: 'request-key' },
  start: '2026-01-01T00:00:00.000Z',
  end: '2027-01-01T00:00:00.000Z',
}
const originalFinnhubApiKey = process.env.FINNHUB_API_KEY

describe('fetchFinnhubSeries', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubGlobal('fetch', fetchMock)
    mockResolveListingContext.mockResolvedValue({
      listing,
      base: 'AAPL',
      assetClass: 'stock',
      timeZoneName: 'America/New_York',
    })
    mockResolveProviderSymbol.mockReturnValue('AAPL')
  })

  afterEach(() => {
    process.env.FINNHUB_API_KEY = originalFinnhubApiKey
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('does not fall back to deployment env when request auth is missing', async () => {
    process.env.FINNHUB_API_KEY = 'deployment-key'

    const { fetchFinnhubSeries } = await import('./series')

    await expect(
      fetchFinnhubSeries({
        ...request,
        auth: undefined,
        interval: '1d',
      })
    ).rejects.toThrow('Finnhub API key is required')

    expect(fetchMock).not.toHaveBeenCalled()
  })

  it.each(['1', 'D', 'unsupported'])(
    'rejects unsupported or native interval alias %s before fetching',
    async (interval) => {
      const { fetchFinnhubSeries } = await import('./series')
      await expect(fetchFinnhubSeries({ ...request, interval })).rejects.toThrow(
        'Unsupported Finnhub interval'
      )
      expect(fetchMock).not.toHaveBeenCalled()
    }
  )

  it.each([1, 1000])(
    'uses canonical date parsing for numeric bounds scaled by %s',
    async (scale) => {
      const start = Date.parse(request.start as string)
      const end = Date.parse(request.end as string)
      fetchMock.mockResolvedValue(Response.json({ s: 'ok', t: [], c: [] }))
      const { fetchFinnhubSeries } = await import('./series')
      const result = await fetchFinnhubSeries({
        ...request,
        start: start / scale,
        end: end / scale,
      })
      const params = new URL(fetchMock.mock.calls[0][0]).searchParams
      expect(params.get('from')).toBe(String(start / 1000))
      expect(params.get('to')).toBe(String(end / 1000))
      expect(result).toMatchObject({ start: request.start, end: request.end })
    }
  )

  it.each([
    ['currency', undefined, 'forex'],
    ['crypto', undefined, 'crypto'],
    ['currency', 'stock', 'stock'],
  ] as const)(
    'resolves %s candles with endpoint override %s',
    async (assetClass, endpoint, expected) => {
      const pair = { listing_id: '', base_id: 'BASE', quote_id: 'USD', listing_type: assetClass }
      mockResolveListingContext.mockResolvedValue({
        listing: pair,
        assetClass,
        base: 'BASE',
        quote: 'USD',
      })
      fetchMock.mockResolvedValue(Response.json({ s: 'ok', t: [], c: [] }))
      const { fetchFinnhubSeries } = await import('./series')
      await fetchFinnhubSeries({
        ...request,
        listing: pair,
        interval: '1m',
        providerParams: { endpoint },
      })
      expect(new URL(fetchMock.mock.calls[0][0]).pathname).toBe(`/api/v1/${expected}/candle`)
    }
  )

  it.each([
    ['parameter interval', undefined, '1m', '1m', '1', 5],
    ['top-level precedence', '5m', '1m', '5m', '5', 10],
    ['daily default', undefined, undefined, '1d', 'D', 1440],
    ['monthly interval', undefined, '1mo', '1mo', 'M', 86_400],
    ['explicit bounds', undefined, '1m', '1m', '1', 30],
    ['currency interval', undefined, '1m', '1m', '1', 5],
  ] as const)(
    'keeps live lookback and delegated resolution consistent for %s',
    async (label, interval, parameterInterval, expectedInterval, resolution, minutes) => {
      const now = Date.parse('2026-10-26T16:00:00Z')
      vi.spyOn(Date, 'now').mockReturnValue(now)
      const end = label === 'explicit bounds' ? now - 30 * 60_000 : now
      const start = end - minutes * 60_000
      const liveRequest: MarketLiveRequest = {
        kind: 'live',
        listing,
        interval,
        auth: request.auth,
        providerParams: { interval: parameterInterval },
        ...(label === 'explicit bounds'
          ? { start: new Date(start).toISOString(), end: new Date(end).toISOString() }
          : {}),
      }
      if (label === 'currency interval') {
        liveRequest.listing = currencyContext.listing
        mockResolveListingContext.mockResolvedValue(currencyContext)
      }
      const original = structuredClone(liveRequest)
      fetchMock.mockResolvedValue(Response.json({ s: 'ok', c: [101], t: [end / 1000 - 60] }))
      const { executeProviderRequest } =
        await vi.importActual<typeof import('@/providers/market')>('@/providers/market')
      expect(await executeProviderRequest('finnhub', liveRequest)).toMatchObject({
        interval: expectedInterval,
        bar: { close: 101 },
      })
      expect(fetchMock).toHaveBeenCalledTimes(1)
      const url = new URL(fetchMock.mock.calls[0][0])
      expect(url.searchParams.get('resolution')).toBe(resolution)
      expect(url.searchParams.get('from')).toBe(String(start / 1000))
      expect(url.searchParams.get('to')).toBe(String(end / 1000))
      expect(url.pathname).toBe(
        label === 'currency interval' ? '/api/v1/forex/candle' : '/api/v1/stock/candle'
      )
      expect(fetchMock.mock.calls[0][1].headers['X-Finnhub-Token']).toBe('request-key')
      expect(liveRequest).toEqual(original)
    }
  )

  it.each([
    ['absolute', 0, '2026-01-01T00:00:00.000Z', '2026-01-02T00:00:00.000Z'],
    ['range', 1, '2026-01-01T00:00:00.000Z', '2026-01-02T00:00:00.000Z'],
    ['retention', 730, '2025-01-02T00:00:00.000Z', '2026-01-02T00:00:00.000Z'],
    ['session', 1, '2025-12-31T14:30:00.000Z', '2025-12-31T21:00:00.000Z'],
  ] as const)('uses explicit auth and planned %s bounds', async (mode, days, start, end) => {
    vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-01-02T00:00:00.000Z'))
    fetchMock.mockResolvedValue(
      Response.json({
        s: 'ok',
        c: [101],
        h: [102],
        l: [100],
        o: [100],
        t: [1735689600],
        v: [1000],
      })
    )

    const { fetchFinnhubSeries } = await import('./series')

    const { request: planned } = planMarketSeriesRequest('finnhub', {
      ...request,
      interval: '1m',
      windows: [
        days
          ? { mode: 'range', range: { value: days, unit: 'day' } }
          : { mode: 'absolute', start, end },
      ],
    })
    if (mode === 'session') Object.assign(planned, { start, end })
    await fetchFinnhubSeries(planned)

    const { searchParams } = new URL(fetchMock.mock.calls[0][0])
    expect(searchParams.get('from')).toBe(String(Date.parse(start) / 1000))
    expect(searchParams.get('to')).toBe(String(Date.parse(end) / 1000))

    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('symbol=AAPL'),
      expect.objectContaining({
        headers: expect.objectContaining({
          'X-Finnhub-Token': 'request-key',
        }),
      })
    )
  })

  it.each([
    ['1d', 'America/New_York', '2026-01-02T00:00:00Z', '2026-01-02T05:00:00.000Z'],
    ['1d', 'America/New_York', '2026-07-02T00:00:00Z', '2026-07-02T04:00:00.000Z'],
    ['1d', 'America/New_York', '2026-01-02T05:00:00Z', '2026-01-02T05:00:00.000Z'],
    ['1m', 'America/New_York', '2026-01-02T00:00:00Z', '2026-01-02T00:00:00.000Z'],
    ['1w', 'America/New_York', '2026-07-06T00:00:00Z', '2026-07-06T04:00:00.000Z'],
    ['1mo', 'America/New_York', '2026-07-01T00:00:00Z', '2026-07-01T04:00:00.000Z'],
    ['1d', 'Pacific/Auckland', '2026-01-02T00:00:00Z', '2026-01-01T11:00:00.000Z'],
    ['1d', 'Pacific/Auckland', '2026-01-01T21:00:00Z', '2026-01-01T21:00:00.000Z'],
  ])('preserves %s trading dates in %s for %s', async (interval, timeZoneName, input, expected) => {
    mockResolveListingContext.mockResolvedValue({ listing, assetClass: 'stock', timeZoneName })
    fetchMock.mockResolvedValue(Response.json({ s: 'ok', c: [101], t: [Date.parse(input) / 1000] }))
    const { fetchFinnhubSeries } = await import('./series')
    const result = await fetchFinnhubSeries({ ...request, interval })
    expect(result.bars[0].timeStamp).toBe(expected)
  })

  it('uses the prior Finnhub trading date for quote change and the current date for volume', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-10-26T17:00:00Z'))
    fetchMock.mockImplementation(async (url: string) =>
      Response.json(
        new URL(url).searchParams.get('resolution') === 'D'
          ? {
              s: 'ok',
              c: [150, 151.73],
              t: ['2026-10-23T00:00:00Z', '2026-10-26T00:00:00Z'].map(
                (time) => Date.parse(time) / 1000
              ),
              v: [10, 20],
            }
          : { s: 'ok', c: [151.73], t: [Date.parse('2026-10-26T15:59:00Z') / 1000] }
      )
    )
    const { buildMarketQuoteSnapshot } = await import('@/lib/market/quote-snapshots')
    const quote = await buildMarketQuoteSnapshot({
      provider: 'finnhub',
      listing,
      auth: request.auth,
    })
    expect(quote).toMatchObject({ lastPrice: 151.73, previousClose: 150, volume: 20 })
    expect(quote.change).toBeCloseTo(1.73)
  })

  it.each([
    ['2026-10-24T23:00:00Z', '2026-10-23T20:59:00Z'],
    ['2026-10-25T20:00:00Z', '2026-10-23T20:59:00Z'],
    ['2026-12-27T20:00:00Z', '2026-12-23T21:59:00Z'],
  ])('retains the last FX quote across closures at %s', async (clock, lastTrade) => {
    const now = Date.parse(clock)
    const day = Date.parse(lastTrade.slice(0, 10)) / 1000
    vi.spyOn(Date, 'now').mockReturnValue(now)
    mockResolveListingContext.mockResolvedValue(currencyContext)
    mockResolveProviderSymbol.mockReturnValue('OANDA:EUR_USD')
    fetchMock.mockImplementation(async (input: string) => {
      const params = new URL(input).searchParams
      const bars = (
        params.get('resolution') === 'D'
          ? [
              { time: day - 86_400, close: 1 },
              { time: day, close: 1.05 },
            ]
          : [{ time: Date.parse(lastTrade) / 1000, close: 1.1 }]
      ).filter(({ time }) => time >= Number(params.get('from')) && time <= Number(params.get('to')))
      return Response.json({
        s: bars.length ? 'ok' : 'no_data',
        t: bars.map(({ time }) => time),
        c: bars.map(({ close }) => close),
      })
    })
    const { buildMarketQuoteSnapshot } = await import('@/lib/market/quote-snapshots')
    const quote = await buildMarketQuoteSnapshot({
      provider: 'finnhub',
      listing: currencyContext.listing,
      auth: request.auth,
    })
    expect(quote).toMatchObject({
      lastPrice: 1.1,
      previousClose: 1,
      timezone: 'UTC',
      lastPriceTime: new Date(lastTrade).toISOString(),
    })
    expect(quote.changePercent).toBeCloseTo(10)
    expect(fetchMock).toHaveBeenCalledTimes(2)
    const minute = fetchMock.mock.calls
      .map(([input]) => new URL(input).searchParams)
      .find((params) => params.get('resolution') === '1')!
    expect(Number(minute.get('from'))).toBe(now / 1000 - 7 * 86_400)
    expect(Number(minute.get('to'))).toBe(now / 1000)
  })

  it('requires the exchange timezone for stock calendar labels', async () => {
    mockResolveListingContext.mockResolvedValue({ listing, assetClass: 'stock' })
    const { fetchFinnhubSeries } = await import('./series')
    await expect(fetchFinnhubSeries({ ...request, interval: '1d' })).rejects.toThrow(
      'Finnhub stock timezone is required'
    )
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
