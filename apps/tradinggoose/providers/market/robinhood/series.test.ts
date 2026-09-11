import { StreamableHTTPError } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { ErrorCode, McpError } from '@modelcontextprotocol/sdk/types.js'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { callRobinhoodTool, getRobinhoodUserInfo } from '@/lib/robinhood/client'
import { ROBINHOOD_MCP_URL } from '@/lib/robinhood/constants'
import type { MarketSeriesRequest } from '@/providers/market/types'
import { robinhoodProvider } from './index'
import { fetchRobinhoodSeries } from './series'

const sdk = vi.hoisted(() => ({
  connect: vi.fn(),
  callTool: vi.fn(),
  close: vi.fn(),
  transport: vi.fn(),
  listing: vi.fn(),
  session: vi.fn(),
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
const history = (bars: unknown[], symbol = 'AAPL') => ({ data: { results: [{ symbol, bars }] } })
const mcpResult = (payload: unknown, text = false) =>
  text
    ? { content: [{ type: 'text', text: JSON.stringify(payload) }] }
    : { content: [], structuredContent: payload }
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
})

describe('Robinhood market provider and MCP boundary', () => {
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

  it('rejects disallowed tools, missing credentials, and oversized requests before connecting', async () => {
    await expect(
      callRobinhoodTool('token', 'place_equity_order' as 'get_accounts', {})
    ).rejects.toThrow('Unsupported')
    await expect(callRobinhoodTool(' ', 'get_accounts', {})).rejects.toMatchObject({ status: 401 })
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

  it('identifies the default account and rejects ambiguous identity', async () => {
    const primary = { account_number: 'primary', is_default: true }
    sdk.callTool.mockResolvedValueOnce(
      mcpResult({ data: { accounts: [{ account_number: 'other' }, primary] } })
    )
    await expect(getRobinhoodUserInfo('token')).resolves.toMatchObject({
      id: 'primary',
      emailVerified: false,
    })
    sdk.callTool.mockResolvedValueOnce(mcpResult({ data: { accounts: [primary, primary] } }))
    await expect(getRobinhoodUserInfo('token')).rejects.toThrow('unique default account')
  })
})
