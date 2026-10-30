/** @vitest-environment node */

import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { buildMarketQuoteSnapshot } from '@/lib/market/quote-snapshots'
import { alpacaProviderConfig } from '@/providers/market/alpaca/config'
import { fetchAlpacaLiveSnapshot } from '@/providers/market/alpaca/live'
import { fetchAlpacaSeries } from '@/providers/market/alpaca/series'
import { finnhubProviderConfig } from '@/providers/market/finnhub/config'
import { fetchMarketProviderJson } from '@/providers/market/request'
import type { MarketSeriesRequest } from '@/providers/market/types'

const { fetchMock, resolveContext } = vi.hoisted(() => ({
  fetchMock: vi.fn(),
  resolveContext: vi.fn(),
}))
vi.mock('@/providers/market/utils', () => ({
  resolveListingContext: resolveContext,
  resolveProviderSymbol: () => 'AAPL',
}))
vi.mock('@/providers/market/market-hours/market-hours-api', () => ({
  resolveMarketHours: vi.fn(),
  resolveMarketHoursRange: vi.fn(async () => null),
}))
vi.mock('@/providers/market', async () => {
  const { fetchFinnhubSeries } = await import('./finnhub/series')
  return {
    executeProviderRequest: (_provider: string, request: MarketSeriesRequest) =>
      fetchFinnhubSeries(request),
  }
})

const listing = { listing_id: 'AAPL', base_id: '', quote_id: '', listing_type: 'default' } as const
const now = Date.parse('2026-10-26T16:00:00Z')
const request = (key: string, config = finnhubProviderConfig) =>
  fetchMarketProviderJson(config, key, 'https://example.test')
let starts: number[]

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(now)
  vi.spyOn(AbortSignal, 'timeout').mockImplementation((ms) => {
    const deadline = new AbortController()
    setTimeout(() => deadline.abort(new DOMException('Request timed out', 'TimeoutError')), ms)
    return deadline.signal
  })
  starts = []
  fetchMock.mockReset().mockImplementation(async () => Response.json({}))
  vi.stubGlobal('fetch', (...args: Parameters<typeof fetch>) => {
    starts.push(Date.now())
    return fetchMock(...args)
  })
  resolveContext.mockResolvedValue({
    listing,
    base: 'AAPL',
    assetClass: 'stock',
    timeZoneName: 'America/New_York',
  })
})
afterEach(async () => {
  await vi.runAllTimersAsync()
  vi.useRealTimers()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

it('paces the actual 62 Finnhub candle calls for 31 simultaneous quote snapshots', async () => {
  fetchMock.mockImplementation(async (input: string) => {
    const daily = new URL(input).searchParams.get('resolution') === 'D'
    return Response.json({
      s: 'ok',
      c: daily ? [100, 110] : [110],
      t: daily
        ? [Date.parse('2026-10-23') / 1000, Date.parse('2026-10-26') / 1000]
        : [now / 1000 - 60],
    })
  })
  const quotes = Promise.all(
    Array.from({ length: 31 }, (_, index) =>
      buildMarketQuoteSnapshot({
        provider: 'finnhub',
        listing: { ...listing, listing_id: `listing-${index}` },
        auth: { apiKey: 'quote-key' },
      })
    )
  )
  await vi.advanceTimersByTimeAsync(0)
  expect(fetchMock).toHaveBeenCalledTimes(1)
  await vi.runAllTimersAsync()
  const result = await quotes
  expect(result.every((quote) => quote.lastPrice === 110 && quote.previousClose === 100)).toBe(true)
  expect(starts).toHaveLength(62)
  for (let index = 60; index < starts.length; index++) {
    expect(starts[index] - starts[index - 60]).toBeGreaterThanOrEqual(60_000)
  }
})

it('shares Alpaca launch slots across latest bars, pagination, and live trades', async () => {
  fetchMock.mockImplementation(async (input: string) => {
    const url = new URL(input)
    const bar = { t: '2026-10-26T15:59:00Z', c: 110 }
    const trade = { t: '2026-10-26T15:59:30Z', p: 110 }
    if (url.pathname.endsWith('/bars/latest')) return Response.json({ bars: { AAPL: bar } })
    if (url.pathname.endsWith('/bars')) {
      return Response.json({
        bars: { AAPL: [bar] },
        next_page_token: url.searchParams.has('page_token') ? null : 'next',
      })
    }
    return Response.json({ trades: { AAPL: url.pathname.endsWith('/latest') ? trade : [trade] } })
  })
  const auth = { apiKey: 'shared-alpaca-key', apiSecret: 'secret' }
  const responses = Promise.all([
    fetchAlpacaSeries({
      kind: 'series',
      listing,
      auth,
      interval: '1m',
      windows: [{ mode: 'range', range: { value: 1, unit: 'day' } }],
    }),
    fetchAlpacaLiveSnapshot({ kind: 'live', listing, auth, interval: '1m' }),
  ])
  await vi.runAllTimersAsync()
  await responses
  expect(starts).toHaveLength(5)
  for (let index = 1; index < starts.length; index++) {
    expect(starts[index] - starts[index - 1]).toBeGreaterThanOrEqual(300)
  }
  expect(fetchMock.mock.calls.map(([input]) => new URL(input).pathname)).toEqual(
    expect.arrayContaining([
      '/v2/stocks/bars/latest',
      '/v2/stocks/bars',
      '/v2/stocks/trades/latest',
      '/v2/stocks/trades',
    ])
  )
})

it('keeps different API keys and providers independent', async () => {
  const responses = Promise.all([
    request('key-a'),
    request('key-a'),
    request('key-b'),
    request('key-a', alpacaProviderConfig),
  ])
  await vi.advanceTimersByTimeAsync(0)
  expect(starts).toEqual([now, now, now])
  await vi.runAllTimersAsync()
  await responses
  expect(starts.at(-1)).toBe(now + 1000)
})

it('releases launch slots before responses complete', async () => {
  let finish!: (response: Response) => void
  fetchMock.mockImplementationOnce(() => {
    return new Promise<Response>((resolve) => {
      finish = resolve
    })
  })
  const first = request('slow-key')
  const second = request('slow-key')
  await vi.advanceTimersByTimeAsync(1000)
  expect(starts).toEqual([now, now + 1000])
  await second
  finish(Response.json({}))
  await first
})

it.each(['fetch', 'body'])(
  'aborts a stalled %s after 30 seconds without blocking later launches',
  async (stage) => {
    fetchMock.mockImplementationOnce((_input, { signal }) => {
      const pending = new Promise((_, reject) =>
        signal.addEventListener('abort', () => reject(signal.reason), { once: true })
      )
      return stage === 'fetch' ? pending : Promise.resolve({ ok: true, json: () => pending })
    })
    let settled = false
    const failed = request('timeout-key').catch((error) => {
      settled = true
      return error
    })
    const next = request('timeout-key')
    await vi.advanceTimersByTimeAsync(29_999)
    expect(settled).toBe(false)
    await expect(next).resolves.toEqual({})
    await vi.advanceTimersByTimeAsync(1)
    expect(await failed).toMatchObject({ name: 'TimeoutError' })
    expect(starts).toEqual([now, now + 1000])
  }
)

it('starts deadlines at paced launch while preserving options and caller cancellation', async () => {
  const caller = new AbortController()
  const config = { ...finnhubProviderConfig, requestsPerMinute: 1 }
  const first = request('queued-key', config)
  await vi.advanceTimersByTimeAsync(0)
  fetchMock.mockImplementationOnce(
    (_input, { signal }) =>
      new Promise((_, reject) =>
        signal.addEventListener('abort', () => reject(signal.reason), { once: true })
      )
  )
  const failed = fetchMarketProviderJson(config, 'queued-key', 'https://example.test', {
    signal: caller.signal,
    method: 'POST',
    body: 'payload',
    headers: { Accept: 'application/json' },
  }).catch((error) => error)
  await vi.advanceTimersByTimeAsync(59_999)
  expect(AbortSignal.timeout).toHaveBeenCalledTimes(1)
  await vi.advanceTimersByTimeAsync(1)
  expect(AbortSignal.timeout).toHaveBeenLastCalledWith(30_000)
  expect(fetchMock.mock.calls[1][1].signal.aborted).toBe(false)
  expect(fetchMock.mock.calls[1][1]).toMatchObject({
    method: 'POST',
    body: 'payload',
    headers: { Accept: 'application/json' },
  })
  const reason = new Error('Caller cancelled')
  caller.abort(reason)
  expect(await failed).toBe(reason)
  await first
})

it.each([true, false])(
  'skips canceled callers without consuming a launch slot (pre-aborted=%s)',
  async (preAborted) => {
    await request('cancelled-key')
    const caller = new AbortController()
    const reason = new Error('Caller cancelled')
    if (preAborted) caller.abort(reason)
    const cancelled = fetchMarketProviderJson(
      finnhubProviderConfig,
      'cancelled-key',
      'https://example.test',
      {
        signal: caller.signal,
      }
    ).catch((error) => error)
    const next = request('cancelled-key')
    if (!preAborted) {
      await vi.advanceTimersByTimeAsync(500)
      caller.abort(reason)
    }
    await vi.runAllTimersAsync()
    expect(starts).toEqual([now, now + 1000])
    expect(AbortSignal.timeout).toHaveBeenCalledTimes(2)
    expect(await cancelled).toBe(reason)
    await next
  }
)

it.each([
  ['launch', 'network failed'],
  ['response', 'network failed'],
  ['http-body', 'Provider unavailable'],
  ['http-empty', 'Finnhub request failed with status 429'],
])('does not poison the queue after a failed %s', async (failure, message) => {
  const error = new Error(message)
  fetchMock.mockImplementationOnce(() => {
    if (failure === 'launch') throw error
    return failure === 'response'
      ? Promise.reject(error)
      : Promise.resolve(new Response(failure === 'http-body' ? message : '', { status: 429 }))
  })
  const failed = request('failure-key').catch((error) => error)
  const next = request('failure-key')
  await vi.runAllTimersAsync()
  expect(await failed).toEqual(error)
  await next
  expect(starts).toEqual([now, now + 1000])
})

it('measures spacing at fetch launch even when microtasks delay queue continuations', async () => {
  const responses = Promise.all([request('microtask-key'), request('microtask-key')])
  await Promise.resolve().then(() => vi.setSystemTime(now + 10_000))
  await vi.runAllTimersAsync()
  await responses
  expect(starts[1] - starts[0]).toBeGreaterThanOrEqual(1000)
})

it('paces overdue timers using the actual launch time', async () => {
  const readClock = Date.now
  let skew = 0
  vi.spyOn(Date, 'now').mockImplementation(() => readClock() + skew)
  const responses = Promise.all([request('timer-key'), request('timer-key'), request('timer-key')])
  await vi.advanceTimersByTimeAsync(0)
  skew = 10_000
  await vi.runAllTimersAsync()
  await responses
  expect(starts).toEqual([now, now + 11_000, now + 12_000])
})

it('keeps credential spacing when an older idle-cleanup timer fires during queued work', async () => {
  await request('cleanup-key')
  await vi.advanceTimersByTimeAsync(500)
  const second = request('cleanup-key')
  await vi.advanceTimersByTimeAsync(1000)
  const third = request('cleanup-key')
  await vi.runAllTimersAsync()
  await Promise.all([second, third])
  expect(starts).toEqual([now, now + 1000, now + 2000])
})
