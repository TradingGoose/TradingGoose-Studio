import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ListingIdentity } from '@/lib/listing/identity'
import { marketClient } from '@/lib/market/client'
import { fetchAlphaVantageSeries } from '@/providers/market/alpha-vantage/series'
import { getMarketSeriesCapabilities } from '@/providers/market/providers'
import { applySeriesWindow, planMarketSeriesRequest } from '@/providers/market/series-planner'
import type { MarketSeriesRequest } from '@/providers/market/types'
import { fetchYahooFinanceSeries } from '@/providers/market/yahoo-finance/series'

vi.mock('@/providers/market/utils', () => ({
  resolveListingContext: vi.fn(async (listing: ListingIdentity) => ({
    listing,
    base: 'IBM',
  })),
  resolveProviderSymbol: vi.fn(() => 'IBM'),
}))

vi.mock('@/lib/market/client', () => ({ marketClient: { makeRequest: vi.fn() } }))

vi.mock('@/providers/market', () => ({
  executeProviderRequest: async (_provider: string, request: MarketSeriesRequest) =>
    (await import('./series')).fetchYahooFinanceSeries(request),
}))

const fetchMock = vi.fn()
beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock.mockReset())
  vi.mocked(marketClient.makeRequest)
    .mockReset()
    .mockResolvedValue({
      success: true,
      data: { name: 'Europe/London', utcOffset: '+00:00', dstOn: false, observesDst: true },
    })
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

const currency = {
  listing_id: '',
  base_id: 'EUR',
  quote_id: 'USD',
  listing_type: 'currency',
} as const

const chartResponse = (
  times: string[],
  close: number[],
  sourceTimezone: string | null = 'Europe/London',
  adjustedClose?: number
) =>
  Response.json({
    chart: {
      result: [
        {
          meta: { exchangeTimezoneName: sourceTimezone, gmtoffset: 0 },
          timestamp: times.map((time) => Date.parse(time) / 1000),
          indicators: { quote: [{ close }], adjclose: [{ adjclose: [adjustedClose] }] },
        },
      ],
    },
  })

it.each([
  ['Yahoo Finance', 'fetch', fetchYahooFinanceSeries],
  ['Yahoo Finance', 'body', fetchYahooFinanceSeries],
  ['Alpha Vantage', 'fetch', fetchAlphaVantageSeries],
  ['Alpha Vantage', 'body', fetchAlphaVantageSeries],
] as const)('bounds a stalled %s %s at 30 seconds', async (_provider, stage, fetchSeries) => {
  vi.useFakeTimers()
  vi.spyOn(AbortSignal, 'timeout').mockImplementation((ms) => {
    const deadline = new AbortController()
    setTimeout(() => deadline.abort(new DOMException('Request timed out', 'TimeoutError')), ms)
    return deadline.signal
  })
  fetchMock.mockImplementation((_input, init) => {
    const pending = new Promise((_, reject) =>
      init?.signal?.addEventListener('abort', () => reject(init.signal.reason), { once: true })
    )
    return stage === 'fetch' ? pending : Promise.resolve({ ok: true, json: () => pending })
  })
  let error: unknown
  const result = fetchSeries({
    kind: 'series',
    listing: { listing_id: 'IBM', base_id: '', quote_id: '', listing_type: 'default' },
    interval: '1m',
    auth: { apiKey: 'request-key' },
  }).catch((failure) => {
    error = failure
  })
  await vi.advanceTimersByTimeAsync(29_999)
  expect(error).toBeUndefined()
  await vi.advanceTimersByTimeAsync(1)
  expect(error).toMatchObject({ name: 'TimeoutError' })
  await result
})

describe('Yahoo all history', () => {
  it.each([undefined, { mode: 'bars', barCount: 2 }] as const)(
    'uses the planner interval for parameter-only minute requests (%j)',
    async (window) => {
      fetchMock.mockResolvedValue(chartResponse(['2026-10-23T11:59:00Z'], [1.1]))
      const { request } = planMarketSeriesRequest('yahoo-finance', {
        kind: 'series',
        listing: currency,
        providerParams: { interval: '1m' },
        windows: window ? [window] : undefined,
      })
      expect(request.interval).toBe('1m')
      expect(request.providerParams).not.toHaveProperty('interval')
      if (window)
        expect(Date.parse(String(request.end)) - Date.parse(String(request.start))).toBe(120_000)
      await fetchYahooFinanceSeries(request)
      expect(new URL(fetchMock.mock.calls[0][0]).searchParams.get('interval')).toBe('1m')
      expect(marketClient.makeRequest).not.toHaveBeenCalled()
    }
  )

  it('requests native maximum history and preserves bars older than 50 years', async () => {
    const dates = ['1962-01-01T00:00:00.000Z', '2026-10-01T00:00:00.000Z']
    fetchMock.mockResolvedValue(chartResponse(dates, [100, 200]))
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

describe('Yahoo currency daily dates', () => {
  it('restricts adjusted pricing to its declared calendar intervals', async () => {
    expect(getMarketSeriesCapabilities('yahoo-finance', '1m')?.normalizationModes).not.toContain(
      'adjusted'
    )
    await expect(
      fetchYahooFinanceSeries({
        kind: 'series',
        listing: currency,
        interval: '1m',
        normalizationMode: 'adjusted',
      })
    ).rejects.toThrow('Unsupported Yahoo Finance price normalization for this interval')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it.each([
    [90, [90]],
    [undefined, []],
  ] as const)('uses only actual adjusted closes: %s', async (adjusted, expected) => {
    fetchMock.mockResolvedValue(
      chartResponse(['2026-10-23T00:00:00Z'], [100], 'Europe/London', adjusted)
    )
    const series = await fetchYahooFinanceSeries({
      kind: 'series',
      listing: currency,
      interval: '1d',
      normalizationMode: 'adjusted',
    })
    expect(series.bars.map(({ close }) => close)).toEqual(expected)
  })

  it.each(['60m', '1wk', 'unsupported'])('rejects noncanonical interval %s', async (interval) => {
    await expect(
      fetchYahooFinanceSeries({ kind: 'series', listing: currency, interval })
    ).rejects.toThrow('Unsupported Yahoo Finance interval')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it.each([
    ['currency', '1d', '2026-01-02T00:00:00Z', '2026-01-02T00:00:00.000Z'],
    ['currency', '1d', '2026-03-29T23:00:00Z', '2026-03-30T00:00:00.000Z'],
    ['currency', '1d', '2026-10-22T23:00:00Z', '2026-10-23T00:00:00.000Z'],
    ['currency', '1d', '2026-10-26T00:00:00Z', '2026-10-26T00:00:00.000Z'],
    ['currency', '1m', '2026-10-22T23:00:00Z', '2026-10-22T23:00:00.000Z'],
    ['default', '1d', '2026-10-22T23:00:00Z', '2026-10-22T23:00:00.000Z'],
    ['crypto', '1d', '2026-10-22T23:00:00Z', '2026-10-22T23:00:00.000Z'],
  ] as const)('preserves the %s %s date for %s', async (listingType, interval, input, expected) => {
    fetchMock.mockResolvedValue(chartResponse([input], [1.1]))
    const series = await fetchYahooFinanceSeries({
      kind: 'series',
      listing:
        listingType === 'default'
          ? { listing_id: 'IBM', base_id: '', quote_id: '', listing_type: listingType }
          : { ...currency, listing_type: listingType },
      interval,
    })
    expect(series.bars[0].timeStamp).toBe(expected)
    expect(series.start).toBe(expected)
    expect(series.end).toBe(expected)
    const dailyCurrency = listingType === 'currency' && interval === '1d'
    expect(marketClient.makeRequest).toHaveBeenCalledTimes(dailyCurrency ? 1 : 0)
    if (dailyCurrency) {
      expect(series.timezone).toBe('UTC')
      expect(marketClient.makeRequest).toHaveBeenCalledWith(
        '/api/get/timezone?timezone_name=Europe%2FLondon&version=v1'
      )
    }
  })

  it('uses the preceding Yahoo forex candle for daily change', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-10-23T12:00:00Z'))
    fetchMock.mockImplementation(async (url: string) =>
      new URL(url).searchParams.get('interval') === '1d'
        ? chartResponse(
            ['2026-10-21T23:00:00Z', '2026-10-22T23:00:00Z'],
            [1.1234692335128784, 1.1221455335617065]
          )
        : chartResponse(['2026-10-23T11:59:00Z'], [1.1191942691802979])
    )
    const { request, window } = planMarketSeriesRequest('yahoo-finance', {
      kind: 'series',
      listing: currency,
      interval: '1d',
      windows: [{ mode: 'absolute', start: '2026-10-23T00:00:00Z', end: '2026-10-23T12:00:00Z' }],
    })
    expect(applySeriesWindow(await fetchYahooFinanceSeries(request), window).bars).toMatchObject([
      { timeStamp: '2026-10-23T00:00:00.000Z', close: 1.1221455335617065 },
    ])
    const { buildMarketQuoteSnapshot } = await import('@/lib/market/quote-snapshots')
    const quote = await buildMarketQuoteSnapshot({ provider: 'yahoo-finance', listing: currency })
    expect(quote).toMatchObject({
      lastPrice: 1.1191942691802979,
      previousClose: 1.1234692335128784,
      lastPriceTime: '2026-10-23T11:59:00.000Z',
      timezone: 'UTC',
    })
    expect(quote.changePercent).toBeCloseTo(-0.3805145886562066, 6)
    expect(quote.error).toBeUndefined()
  })

  it.each([
    [null, undefined, 'Yahoo Finance currency timezone is required'],
    [' ', undefined, 'Time zone name is required'],
    ['Europe/London', undefined, 'Time zone not found'],
    ['Europe/London', [], 'Invalid market timezone response'],
    ['Europe/London', {}, 'Invalid market timezone response'],
  ] as const)(
    'rejects source timezone %s with Market data %j',
    async (sourceTimezone, data, error) => {
      vi.mocked(marketClient.makeRequest).mockResolvedValue(
        data === undefined
          ? { success: false, error: 'Time zone not found' }
          : { success: true, data }
      )
      fetchMock.mockResolvedValue(chartResponse(['2026-10-22T23:00:00Z'], [1.12], sourceTimezone))
      await expect(
        fetchYahooFinanceSeries({ kind: 'series', listing: currency, interval: '1d' })
      ).rejects.toThrow(error)
    }
  )
})
