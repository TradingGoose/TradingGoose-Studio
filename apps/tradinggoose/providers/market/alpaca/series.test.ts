/**
 * @vitest-environment node
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fetchAlpacaSeries, resolveCredentials } from '@/providers/market/alpaca/series'
import { resolveSeriesBoundsMs } from '@/providers/market/market-hours/sessions'
import { applySeriesWindow, planMarketSeriesRequest } from '@/providers/market/series-planner'

const { fetchMock, mockResolveListingContext, mockResolveProviderSymbol } = vi.hoisted(() => ({
  fetchMock: vi.fn(),
  mockResolveListingContext: vi.fn(),
  mockResolveProviderSymbol: vi.fn(),
}))

vi.mock('@/providers/market/utils', () => ({
  resolveListingContext: mockResolveListingContext,
  resolveProviderSymbol: mockResolveProviderSymbol,
}))

const originalAlpacaApiKeyId = process.env.ALPACA_API_KEY_ID
const originalAlpacaApiSecretKey = process.env.ALPACA_API_SECRET_KEY

afterEach(() => {
  process.env.ALPACA_API_KEY_ID = originalAlpacaApiKeyId
  process.env.ALPACA_API_SECRET_KEY = originalAlpacaApiSecretKey
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

const cryptoListing = {
  listing_id: '',
  base_id: 'BTC',
  quote_id: 'USD',
  listing_type: 'crypto' as const,
}
const stockListing = {
  listing_id: 'AAPL',
  base_id: '',
  quote_id: '',
  listing_type: 'default' as const,
}
const now = '2026-10-19T12:00:00.000Z'
const barsResponse = (symbol: string, time = now, next_page_token: string | null = null) =>
  new Response(JSON.stringify({ bars: { [symbol]: [{ t: time, c: 100 }] }, next_page_token }))

describe('fetchAlpacaSeries bounds', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    vi.stubGlobal('fetch', fetchMock)
    vi.spyOn(Date, 'now').mockReturnValue(Date.parse(now))
    mockResolveListingContext.mockResolvedValue({
      listing: cryptoListing,
      base: 'BTC',
      quote: 'USD',
      assetClass: 'crypto',
    })
    mockResolveProviderSymbol.mockReturnValue('BTC/USD')
    fetchMock.mockResolvedValue(barsResponse('BTC/USD'))
  })

  it('fetches the complete crypto month through short and empty continuation pages', async () => {
    const first = '2026-09-20T12:00:00.000Z'
    fetchMock
      .mockResolvedValueOnce(barsResponse('BTC/USD', first, 'page-1'))
      .mockResolvedValueOnce(new Response(JSON.stringify({ bars: {}, next_page_token: 'page-2' })))
      .mockResolvedValueOnce(barsResponse('BTC/USD'))
    const { request } = planMarketSeriesRequest('alpaca', {
      kind: 'series',
      listing: cryptoListing,
      interval: '30m',
      windows: [{ mode: 'range', range: { value: 1, unit: 'month' } }],
      providerParams: { range: '1d' },
    })

    const result = await fetchAlpacaSeries(request)

    expect(result.bars.map((bar) => bar.timeStamp)).toEqual([first, now])
    expect(result.end).toBe(now)
    expect(fetchMock).toHaveBeenCalledTimes(3)
    for (const [index, token] of [null, 'page-1', 'page-2'].entries()) {
      const url = new URL(fetchMock.mock.calls[index][0])
      expect(url.pathname).toBe('/v1beta3/crypto/us/bars')
      expect(url.searchParams.get('start')).toBe('2026-09-19T12:00:00.000Z')
      expect(url.searchParams.get('end')).toBe(now)
      expect(url.searchParams.get('limit')).toBe('1440')
      expect(url.searchParams.get('page_token')).toBe(token)
    }
  })

  it('keeps unbounded stock ranges anchored to the latest stock bar', async () => {
    const latest = '2026-10-16T19:59:00.000Z'
    mockResolveListingContext.mockResolvedValue({
      listing: stockListing,
      base: 'AAPL',
      assetClass: 'stock',
    })
    mockResolveProviderSymbol.mockReturnValue('AAPL')
    fetchMock
      .mockResolvedValueOnce(new Response(JSON.stringify({ bars: { AAPL: { t: latest } } })))
      .mockResolvedValueOnce(barsResponse('AAPL', '2026-10-12T19:59:00.000Z', 'stock-page-2'))
      .mockResolvedValueOnce(barsResponse('AAPL', latest))
    const { request } = planMarketSeriesRequest('alpaca', {
      kind: 'series',
      listing: stockListing,
      auth: { apiKey: 'request-key', apiSecret: 'request-secret' },
      interval: '5m',
      windows: [{ mode: 'range', range: { value: 5, unit: 'day' } }],
    })

    const result = await fetchAlpacaSeries(request)

    expect(result.end).toBe(latest)
    expect(fetchMock).toHaveBeenCalledTimes(3)
    const latestUrl = new URL(fetchMock.mock.calls[0][0])
    expect(latestUrl.pathname).toBe('/v2/stocks/bars/latest')
    expect(latestUrl.searchParams.get('feed')).toBe('iex')
    const url = new URL(fetchMock.mock.calls[1][0])
    expect(url.searchParams.get('start')).toBe('2026-10-11T19:59:00.000Z')
    expect(url.searchParams.get('end')).toBe(latest)
    expect(new URL(fetchMock.mock.calls[2][0]).searchParams.get('page_token')).toBe('stock-page-2')
  })

  it.each(['failure', 'repeated token'] as const)(
    'rejects pagination %s without partial success',
    async (failure) => {
      fetchMock
        .mockResolvedValueOnce(barsResponse('BTC/USD', now, 'next'))
        .mockResolvedValueOnce(
          failure === 'failure'
            ? new Response('Continuation failed', { status: 503 })
            : barsResponse('BTC/USD', now, 'next')
        )
      await expect(
        fetchAlpacaSeries({ kind: 'series', listing: cryptoListing, start: '2026-09-19', end: now })
      ).rejects.toThrow(failure === 'failure' ? 'Continuation failed' : 'repeated pagination token')
      expect(fetchMock).toHaveBeenCalledTimes(2)
    }
  )

  it.each(['complete', 'continuing', 'empty'] as const)(
    'enforces the page budget for a %s response at the boundary',
    async (completion) => {
      let page = 0
      fetchMock.mockImplementation(async () => {
        page++
        if (page > 100) throw new Error('Unexpected request beyond the page budget')
        const token = page < 100 || completion !== 'complete' ? `page-${page}` : null
        return completion === 'empty'
          ? new Response(JSON.stringify({ bars: {}, next_page_token: token }))
          : barsResponse('BTC/USD', now, token)
      })
      const result = fetchAlpacaSeries({
        kind: 'series',
        listing: cryptoListing,
        start: '2026-09-19',
        end: now,
      })

      if (completion === 'complete') {
        expect((await result).bars).toHaveLength(100)
      } else {
        await expect(result).rejects.toThrow(
          'Alpaca pagination reached the 100-page limit. Narrow the range or use a larger interval.'
        )
      }
      expect(fetchMock).toHaveBeenCalledTimes(100)
      expect(new URL(fetchMock.mock.calls[99][0]).searchParams.get('page_token')).toBe('page-99')
    }
  )

  it.each(['asc', 'desc'] as const)(
    'resolves large paginated %s bounds before sorting',
    async (sort) => {
      const startMs = Date.parse('2026-01-01T00:00:00.000Z')
      const rows = Array.from({ length: 200_000 }, (_, index) => ({
        t: new Date(startMs + index * 60_000).toISOString(),
        c: 100,
      }))
      const start = rows[0].t
      const end = rows[rows.length - 1].t
      const endMs = Date.parse(end)
      if (sort === 'desc') rows.reverse()
      let page = 0
      fetchMock.mockImplementation(async () => {
        const bars = rows.slice(page * 10_000, (page + 1) * 10_000)
        page++
        return new Response(
          JSON.stringify({
            bars: { 'BTC/USD': bars },
            next_page_token: page < 20 ? `page-${page}` : null,
          })
        )
      })

      const series = await fetchAlpacaSeries({
        kind: 'series',
        listing: cryptoListing,
        interval: '1m',
        start,
        end,
        providerParams: { sort, limit: 10_000 },
      })

      expect(fetchMock).toHaveBeenCalledTimes(20)
      expect(resolveSeriesBoundsMs(series)).toEqual({ startMs, endMs })
      const normalized = applySeriesWindow(series, { mode: 'absolute', startMs, endMs })
      expect(normalized.bars).toHaveLength(200_000)
      expect(normalized.start).toBe(start)
      expect(normalized.end).toBe(end)
    }
  )

  it('preserves explicit bounds on a range window', async () => {
    const start = '2026-10-14T13:30:00.000Z'
    const end = '2026-10-16T20:00:00.000Z'
    const { request } = planMarketSeriesRequest('alpaca', {
      kind: 'series',
      listing: cryptoListing,
      interval: '5m',
      windows: [{ mode: 'range', range: { value: 5, unit: 'day' } }],
    })
    Object.assign(request, { start, end })

    await fetchAlpacaSeries(request)

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const url = new URL(fetchMock.mock.calls[0][0])
    expect(url.searchParams.get('start')).toBe(start)
    expect(url.searchParams.get('end')).toBe(end)
  })
})

describe('resolveCredentials', () => {
  it('does not fall back to deployment env when request auth is missing', () => {
    process.env.ALPACA_API_KEY_ID = 'deployment-key'
    process.env.ALPACA_API_SECRET_KEY = 'deployment-secret'

    expect(resolveCredentials()).toEqual({
      keyId: undefined,
      secretKey: undefined,
    })
  })

  it('uses explicit request auth when provided', () => {
    expect(
      resolveCredentials({
        apiKey: 'request-key',
        apiSecret: 'request-secret',
      })
    ).toEqual({
      keyId: 'request-key',
      secretKey: 'request-secret',
    })
  })
})
