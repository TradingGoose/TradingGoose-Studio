import { StreamableHTTPError } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { ErrorCode, McpError } from '@modelcontextprotocol/sdk/types.js'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { buildMarketQuoteSnapshot } from '@/lib/market/quote-snapshots'
import { ROBINHOOD_MCP_URL } from '@/providers/market/robinhood/config'
import { planMarketSeriesRequest } from '@/providers/market/series-planner'
import type { MarketSeriesRequest } from '@/providers/market/types'
import { callRobinhoodTool } from './client'
import { robinhoodProvider } from './index'
import { fetchRobinhoodSeries } from './series'

const sdk = vi.hoisted(() => ({
  connect: vi.fn(),
  callTool: vi.fn(),
  close: vi.fn(),
  transport: vi.fn(),
  listing: vi.fn(),
  session: vi.fn(),
  token: vi.fn(),
}))
vi.mock('@modelcontextprotocol/sdk/client/index.js', () => ({
  Client: class {
    connect = sdk.connect
    callTool = sdk.callTool
    close = sdk.close
  },
}))
vi.mock('@modelcontextprotocol/sdk/client/streamableHttp.js', async (original) => ({
  ...(await original<typeof import('@modelcontextprotocol/sdk/client/streamableHttp.js')>()),
  StreamableHTTPClientTransport: sdk.transport,
}))
vi.mock('@/providers/market/utils', () => ({
  resolveListingContext: sdk.listing,
  resolveProviderSymbol: (_config: unknown, context: { base: string }) => context.base,
}))
vi.mock('@/lib/oauth/tokens', () => ({ refreshAccessTokenIfNeeded: sdk.token }))
vi.mock('@/providers/market/market-hours', async () => ({
  resolveLatestSessionEndMs: sdk.session,
  resolveListingId: () => 'us-aapl',
  toDate: (await import('@/providers/market/market-hours/date-utils')).toDate,
}))

const rawBar = (begins_at = '2026-09-09T14:30:00Z', close_price: unknown = '103.50') => ({
  begins_at,
  open_price: '100',
  high_price: '105',
  low_price: '99',
  close_price,
  volume: 200,
})
const history = (bars: unknown[] | null, symbol = 'AAPL') => ({
  data: { results: [{ symbol, bars }] },
})
const mcpResult = (payload: unknown, text = false) =>
  text
    ? { content: [{ type: 'text', text: JSON.stringify(payload) }] }
    : { content: [], structuredContent: payload }
const rawQuote = {
  symbol: 'AAPL',
  last_trade_price: '110',
  adjusted_previous_close: '100',
  previous_close: '102',
  last_non_reg_trade_price: '115',
  has_traded: true,
  state: 'active',
}
const request: MarketSeriesRequest = {
  kind: 'series',
  listing: { listing_id: 'us-aapl', base_id: '', quote_id: '', listing_type: 'default' },
  interval: '1m',
  start: '2026-09-09T14:00:00Z',
  end: '2026-09-09T15:00:00Z',
  auth: { accessToken: 'token' },
}

beforeEach(() => {
  vi.resetAllMocks()
  sdk.connect.mockResolvedValue(undefined)
  sdk.close.mockResolvedValue(undefined)
  sdk.callTool.mockResolvedValue(mcpResult(history([rawBar()])))
  sdk.listing.mockResolvedValue({
    base: 'AAPL',
    quote: 'USD',
    assetClass: 'stock',
    countryCode: 'US',
    marketCode: 'NASDAQ',
    timeZoneName: 'America/New_York',
  })
  sdk.session.mockResolvedValue(Date.parse(request.end as string))
  sdk.token.mockResolvedValue('refreshed-token')
})

describe('Robinhood market provider and MCP boundary', () => {
  it('uses native regular-hours quotes and adjusted close through canonical OAuth', async () => {
    sdk.callTool.mockResolvedValue(
      mcpResult({
        data: { results: [{ quote: rawQuote, close: { symbol: 'AAPL', price: '101' } }] },
      })
    )
    await expect(
      buildMarketQuoteSnapshot({
        provider: 'robinhood',
        listing: request.listing,
        providerParams: { credentialId: 'connection' },
        context: { userId: 'owner', requestId: 'request' },
      })
    ).resolves.toEqual({ lastPrice: 110, previousClose: 100, change: 10, changePercent: 10 })
    expect(sdk.token).toHaveBeenCalledExactlyOnceWith('connection', 'owner', 'request', 'robinhood')
    expect(sdk.callTool).toHaveBeenCalledOnce()
    expect(sdk.callTool.mock.calls[0][0]).toEqual({
      name: 'get_equity_quotes',
      arguments: { symbols: ['AAPL'] },
    })
    expect(sdk.transport.mock.calls[0][1].requestInit.headers.Authorization).toBe(
      'Bearer refreshed-token'
    )
  })

  it.each([false, true])('normalizes authenticated MCP data (text=%s)', async (text) => {
    sdk.callTool.mockResolvedValue(mcpResult(history([rawBar()]), text))
    const result = await fetchRobinhoodSeries({
      ...request,
      normalizationMode: 'raw',
      providerParams: { marketSession: 'extended' },
    })
    expect(sdk.transport).toHaveBeenCalledWith(
      new URL(ROBINHOOD_MCP_URL),
      expect.objectContaining({
        requestInit: { headers: { Authorization: 'Bearer token' } },
      })
    )
    expect(sdk.callTool.mock.calls[0][0]).toEqual({
      name: 'get_equity_historicals',
      arguments: {
        symbols: ['AAPL'],
        interval: 'minute',
        bounds: 'extended',
        adjustment_type: 'none',
        start_time: '2026-09-09T14:00:00.000Z',
        end_time: '2026-09-09T15:00:00.000Z',
      },
    })
    expect(result).toMatchObject({
      listing: request.listing,
      marketCode: 'NASDAQ',
      listingQuote: 'USD',
      normalizationMode: 'raw',
      bars: [
        {
          timeStamp: '2026-09-09T14:30:00.000Z',
          open: 100,
          high: 105,
          low: 99,
          close: 103.5,
          volume: 200,
        },
      ],
    })
    expect(sdk.close).toHaveBeenCalledOnce()
  })

  it.each([history([rawBar(undefined, '')]), history([], 'MSFT'), { bars: [] }])(
    'rejects malformed or mismatched market data',
    async (payload) => {
      sdk.callTool.mockResolvedValue(mcpResult(payload))
      await expect(fetchRobinhoodSeries(request)).rejects.toThrow('historical data')
      expect(sdk.close).toHaveBeenCalledOnce()
    }
  )

  it.each([
    { error: new StreamableHTTPError(401, 'private upstream body'), status: 401 },
    { error: new StreamableHTTPError(429, 'private upstream body'), status: 429 },
    { error: new McpError(ErrorCode.RequestTimeout, 'private upstream body'), status: 504 },
  ])('sanitizes upstream failures and closes the client', async ({ error, status }) => {
    sdk.callTool.mockRejectedValue(error)
    await expect(fetchRobinhoodSeries(request)).rejects.toMatchObject({
      status,
      message: expect.not.stringContaining('private upstream body'),
    })
    expect(sdk.close).toHaveBeenCalledOnce()
  })

  it('rejects missing credentials and oversized requests before connecting', async () => {
    await expect(callRobinhoodTool(' ', 'get_equity_historicals', {})).rejects.toMatchObject({
      status: 401,
    })
    await expect(fetchRobinhoodSeries({ ...request, auth: {} })).rejects.toThrow('connection')
    await expect(
      fetchRobinhoodSeries({ ...request, start: '2020-01-01T00:00:00Z' })
    ).rejects.toThrow('range is too large')
    expect(sdk.connect).not.toHaveBeenCalled()
  })

  it('chunks history and sorts and deduplicates boundary candles', async () => {
    const boundary = '2026-09-09T14:40:00Z'
    const paged = { ...request, start: '2026-09-08T06:00:00Z', end: '2026-09-11T00:00:00Z' }
    sdk.callTool
      .mockResolvedValueOnce(mcpResult(history([rawBar('2026-09-09T14:45:00Z'), rawBar(boundary)])))
      .mockResolvedValueOnce(mcpResult(history([rawBar(boundary), rawBar('2026-09-09T14:35:00Z')])))
    expect((await fetchRobinhoodSeries(paged)).bars.map((bar) => bar.timeStamp)).toEqual([
      '2026-09-09T14:35:00.000Z',
      '2026-09-09T14:40:00.000Z',
      '2026-09-09T14:45:00.000Z',
    ])
    expect(sdk.callTool).toHaveBeenCalledTimes(2)
  })

  it.each(['before', 'between', 'during', 'during-rejection'])(
    'rejects the entire history request when its deadline expires %s pages',
    async (stage) => {
      const deadline = new AbortController()
      const timeout = AbortSignal.timeout.bind(AbortSignal)
      const deadlines = vi
        .spyOn(AbortSignal, 'timeout')
        .mockImplementation((ms) => (ms === 60_000 ? deadline.signal : timeout(ms)))
      sdk.callTool.mockResolvedValue(mcpResult(history([rawBar('2026-09-09T14:45:00Z')])))
      if (stage === 'before') deadline.abort()
      if (stage === 'between') sdk.close.mockImplementationOnce(async () => deadline.abort())
      if (stage.startsWith('during')) {
        sdk.callTool
          .mockResolvedValueOnce(mcpResult(history([rawBar('2026-09-09T14:45:00Z')])))
          .mockImplementationOnce(async (_args, _schema, { signal }) => {
            deadline.abort()
            expect(signal.aborted).toBe(true)
            if (stage === 'during-rejection') throw new StreamableHTTPError(401, 'upstream error')
            return mcpResult(history([]))
          })
      }
      try {
        await expect(
          fetchRobinhoodSeries({
            ...request,
            start: '2026-09-08T06:00:00Z',
            end: '2026-09-11T00:00:00Z',
          })
        ).rejects.toMatchObject({ status: 504 })
        expect(deadlines.mock.calls.filter(([ms]) => ms === 60_000)).toHaveLength(1)
        expect(sdk.connect).toHaveBeenCalledTimes(
          stage === 'before' ? 0 : stage === 'between' ? 1 : 2
        )
        expect(sdk.close).toHaveBeenCalledTimes(stage === 'before' ? 1 : 2)
      } finally {
        deadlines.mockRestore()
      }
    }
  )

  it.each([[], null])('continues past an empty history page (%j)', async (emptyBars) => {
    sdk.callTool
      .mockResolvedValueOnce(mcpResult(history(emptyBars)))
      .mockResolvedValueOnce(mcpResult(history([rawBar('2026-09-09T14:57:00Z')])))
    const result = await fetchRobinhoodSeries({
      ...request,
      windows: [{ mode: 'bars', barCount: 1 }],
    })
    expect(result.bars.map((bar) => bar.timeStamp)).toEqual(['2026-09-09T14:57:00.000Z'])
    expect(sdk.callTool).toHaveBeenCalledTimes(2)
  })

  it('anchors default and live bar windows to the last session and preserves range windows', async () => {
    const bars = Array.from({ length: 200 }, (_, i) =>
      rawBar(new Date(Date.parse(request.end as string) - (i + 1) * 60_000).toISOString())
    )
    sdk.callTool.mockResolvedValue(mcpResult(history(bars)))
    expect(
      (await fetchRobinhoodSeries({ ...request, start: undefined, end: undefined })).bars
    ).toHaveLength(200)
    expect(sdk.callTool).toHaveBeenCalledOnce()
    expect(sdk.session).toHaveBeenCalledWith('us-aapl', 'default', 'regular')
    expect(
      (await robinhoodProvider.fetchMarketLive!({ ...request, kind: 'live' })).bar.timeStamp
    ).toBe('2026-09-09T14:59:00.000Z')
    await fetchRobinhoodSeries({
      ...request,
      start: undefined,
      interval: '1d',
      windows: [{ mode: 'range', range: { value: 1, unit: 'week' } }],
    })
    expect(sdk.callTool.mock.lastCall?.[0].arguments.start_time).toBe('2026-09-02T15:00:00.000Z')
  })

  it.each([
    [2_000, '1m', 1],
    [10_000, '1m', 1],
    [10_000, '5m', 5],
    [10_000, '10m', 10],
    [10_000, '30m', 30],
    [10_000, '1h', 60],
    [10_000, '4h', 240],
    [2_000, '1m', 1, 1],
    [10, '1m', 1, undefined, false],
    [10, '1m', 1, undefined, true],
  ] as const)(
    'retrieves up to %i %s bars at Monday open across market closures',
    async (barCount, interval, minutes, historyLimit?: number, withPrimary = false) => {
      const end = Date.parse('2026-09-21T13:31:00Z')
      const intervalMs = minutes * 60_000
      const available = []
      const dayMs = 86_400_000
      const firstDay =
        Math.floor((end - Math.max(7 * dayMs, barCount * intervalMs * 8)) / dayMs) * dayMs
      for (let day = firstDay; day <= end; day += dayMs) {
        const date = new Date(day).toISOString().slice(0, 10)
        if ([0, 6].includes(new Date(day).getUTCDay()) || date === '2026-09-07') continue
        const close = Date.parse(`${date}T${date === '2026-09-18' ? '17' : '20'}:00:00Z`)
        for (
          let time = Date.parse(`${date}T13:30:00Z`);
          time < Math.min(end, close);
          time += intervalMs
        ) {
          available.push(rawBar(new Date(time).toISOString()))
        }
      }
      const bars = available.slice(-(historyLimit ?? available.length))
      sdk.session.mockResolvedValue(end)
      sdk.callTool.mockImplementation(async ({ arguments: args }) =>
        mcpResult(
          history(
            bars.filter(
              (bar) =>
                Date.parse(bar.begins_at) >= Date.parse(args.start_time) &&
                Date.parse(bar.begins_at) <= Date.parse(args.end_time)
            )
          )
        )
      )
      const clock = vi.spyOn(Date, 'now').mockReturnValue(end)
      const plan = planMarketSeriesRequest('robinhood', {
        ...request,
        interval,
        windows: [
          ...(withPrimary ? [{ mode: 'absolute' as const, start: end, end: end - 60_000 }] : []),
          { mode: 'bars', barCount },
        ],
      })
      clock.mockRestore()
      expect(plan.window).toEqual({ mode: 'bars', barCount })
      expect(plan.fallback).toBe(withPrimary)
      const result = await fetchRobinhoodSeries(plan.request)
      expect(result.bars.map((bar) => bar.timeStamp)).toEqual(
        bars.slice(-barCount).map((bar) => bar.begins_at)
      )
      expect(result.bars).toHaveLength(historyLimit ?? barCount)
      expect(sdk.callTool.mock.calls.length).toBeLessThanOrEqual(barCount === 2_000 ? 20 : 100)
      for (const [{ arguments: args }] of sdk.callTool.mock.calls) {
        expect(Date.parse(args.end_time) - Date.parse(args.start_time)).toBeLessThanOrEqual(
          2_000 * intervalMs
        )
      }
    }
  )
})
