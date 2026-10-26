import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createMarketQuoteSnapshot } from '@/lib/market/quote-snapshot-contract'
import { buildMarketQuoteSnapshot } from '@/lib/market/quote-snapshots'
import type { MarketSeries } from '@/providers/market/types'

const execute = vi.fn()
vi.mock('@/providers/market', () => ({
  executeProviderRequest: (...args: unknown[]) => execute(...args),
}))
const listing = { listing_id: 'AAPL', base_id: '', quote_id: '', listing_type: 'default' as const }
const session = {
  date: '2026-10-26',
  type: 'market' as const,
  start: '2026-10-26T13:30:00Z',
  end: '2026-10-26T20:00:00Z',
}
let daily: MarketSeries
let regular: MarketSeries
const snapshot = (provider = 'alpaca') => buildMarketQuoteSnapshot({ provider, listing })

describe('market quote normalization', () => {
  beforeEach(() => {
    execute
      .mockReset()
      .mockImplementation(async (_provider, request) =>
        request.interval === '1d' ? daily : regular
      )
    daily = {
      timezone: 'America/New_York',
      bars: [
        { timeStamp: '2026-10-22T04:00:00Z', close: 90 },
        { timeStamp: '2026-10-23T04:00:00Z', close: 100 },
        { timeStamp: '2026-10-26T04:00:00Z', close: 105, volume: 20 },
      ],
    }
    regular = {
      timezone: 'America/New_York',
      bars: [{ timeStamp: '2026-10-26T15:59:00Z', close: 110 }],
      marketSessions: [session],
    }
  })

  it.each(['alpaca', 'finnhub', 'alpha-vantage', 'robinhood', 'yahoo-finance'])(
    'uses the same day-change calculation for %s',
    async (provider) => {
      expect(await snapshot(provider)).toEqual({
        lastPrice: 110,
        previousClose: 100,
        change: 10,
        changePercent: 10,
        volume: 20,
        volumeUsd: 2200,
        lastPriceTime: '2026-10-26T15:59:00Z',
        timezone: 'America/New_York',
        regularSession: { start: session.start, end: session.end },
      })
      regular.bars[0].close = 112
      expect(await snapshot(provider)).toMatchObject({
        previousClose: 100,
        change: 12,
        changePercent: 12,
      })
      expect(
        execute.mock.calls.slice(0, 2).map(([, request]) => ({
          interval: request.interval,
          windows: request.windows,
          mode: request.normalizationMode,
          session: request.providerParams.marketSession,
        }))
      ).toEqual([
        {
          interval: '1d',
          windows: [{ mode: 'range', range: { value: 14, unit: 'day' } }],
          mode: 'split_adjusted',
          session: 'regular',
        },
        {
          interval: '1m',
          windows: [{ mode: 'range', range: { value: 1, unit: 'day' } }],
          mode: 'raw',
          session: 'regular',
        },
      ])
    }
  )

  it.each([
    ['2026-10-23', 90],
    ['2026-10-26', 100],
    ['2026-10-27', 100],
  ])('uses the prior completed session across closures for %s', async (date, close) => {
    daily.bars.pop()
    regular = { timezone: regular.timezone, bars: [{ timeStamp: `${date}T15:59:00Z`, close: 110 }] }
    expect(await snapshot()).toMatchObject({ previousClose: close, change: 110 - close })
  })

  it('keeps an available price but does not invent a baseline from the current daily candle', async () => {
    daily.bars = daily.bars.slice(-1)
    expect(await snapshot()).toMatchObject({
      lastPrice: 110,
      previousClose: null,
      change: null,
      changePercent: null,
      error: 'Previous regular-session close is unavailable',
    })
  })

  it.each(['1d', '1m'])(
    'propagates %s request failures without substituting another data source',
    async (interval) => {
      execute.mockImplementation(async (_provider, request) => {
        if (request.interval === interval) throw new Error('Provider unavailable')
        return request.interval === '1d' ? daily : regular
      })
      await expect(snapshot()).rejects.toThrow('Provider unavailable')
    }
  )

  it('requires minute data instead of substituting the current daily candle', async () => {
    regular.bars = []
    await expect(snapshot()).rejects.toThrow('No regular-session price available')
  })

  it('excludes candles at the regular close boundary and after hours', async () => {
    regular.bars = [
      { timeStamp: '2026-10-26T19:59:00Z', close: 110 },
      { timeStamp: '2026-10-26T20:00:00Z', close: 115 },
      { timeStamp: '2026-10-26T21:00:00Z', close: 120 },
    ]
    expect(await snapshot()).toMatchObject({
      lastPrice: 110,
      change: 10,
      lastPriceTime: '2026-10-26T19:59:00Z',
    })
  })

  it('matches exchange trading dates across UTC midnight', async () => {
    daily = {
      timezone: 'Asia/Tokyo',
      bars: [
        { timeStamp: '2026-10-22T15:00:00Z', close: 100 },
        { timeStamp: '2026-10-25T15:00:00Z', close: 105 },
      ],
    }
    regular = { timezone: 'Asia/Tokyo', bars: [{ timeStamp: '2026-10-26T00:30:00Z', close: 110 }] }
    expect(await snapshot()).toMatchObject({ previousClose: 100, change: 10 })
  })

  it.each(['crypto', 'currency'] as const)(
    'uses the UTC day for %s daily change',
    async (listingType) => {
      daily.bars = [{ timeStamp: '2026-10-25T00:00:00Z', close: 100 }]
      regular.bars = [{ timeStamp: '2026-10-26T00:30:00Z', close: 110 }]
      regular.marketSessions = undefined
      const quote = await buildMarketQuoteSnapshot({
        provider: 'alpaca',
        listing: { listing_id: '', base_id: 'BTC', quote_id: 'USD', listing_type: listingType },
      })
      expect(quote).toMatchObject({
        previousClose: 100,
        change: 10,
        timezone: 'UTC',
      })
      expect(quote.regularSession).toBeUndefined()
      expect(execute.mock.calls.map(([, request]) => request.normalizationMode)).toEqual([
        'raw',
        'raw',
      ])
    }
  )

  it('constructs unavailable values and preserves zero without dividing by zero', () => {
    expect(createMarketQuoteSnapshot({ error: 'Unavailable' })).toEqual({
      lastPrice: null,
      previousClose: null,
      change: null,
      changePercent: null,
      error: 'Unavailable',
    })
    expect(createMarketQuoteSnapshot({ lastPrice: 0, previousClose: 0, volume: 0 })).toEqual({
      lastPrice: 0,
      previousClose: 0,
      change: 0,
      changePercent: null,
      volume: 0,
      volumeUsd: 0,
    })
  })
})
