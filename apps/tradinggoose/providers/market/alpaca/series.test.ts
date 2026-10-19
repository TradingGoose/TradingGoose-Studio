/**
 * @vitest-environment node
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fetchAlpacaSeries, resolveCredentials } from '@/providers/market/alpaca/series'
import { planMarketSeriesRequest } from '@/providers/market/series-planner'

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
