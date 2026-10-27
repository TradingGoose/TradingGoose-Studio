import { describe, expect, it } from 'vitest'
import {
  getMarketSeriesRangePresets,
  planMarketSeriesRequest,
} from '@/providers/market/series-planner'
import type { MarketSeriesRequest } from '@/providers/market/types'

const listing = {
  listing_id: 'TG_LSTG_822870',
  base_id: '',
  quote_id: '',
  listing_type: 'default' as const,
}

describe('getMarketSeriesRangePresets', () => {
  it.each([
    ['yahoo-finance', ['1d', '5d', '1m', '1y', '5y', 'all']],
    ['alpaca', ['1d', '5d', '1w', '1m', '3m', '1y', '5y']],
  ])('preserves chart presets without an interval override: %s', (provider, ids) => {
    expect(getMarketSeriesRangePresets(provider).map((preset) => preset.id)).toEqual(ids)
  })

  it.each([
    ['yahoo-finance', '1m', ['1d', '5d', '1w']],
    ['alpha-vantage', '1m', ['1d', '5d', '1w', '1m']],
    ['finnhub', '1m', ['1d', '5d', '1w', '1m', '3m', '6m', '1y']],
    ['yahoo-finance', '1mo', ['3m', '6m', '1y', '5y']],
    ['yahoo-finance', '3mo', ['6m', '1y', '5y', 'all']],
    ['alpaca', '1m', ['1d', '5d', '1w', '1m', '3m', '6m', '1y']],
    ['alpaca', '2m', ['1d', '5d', '1w', '1m', '3m', '6m', '1y']],
    ['alpaca', '3m', ['1d', '5d', '1w', '1m', '3m', '6m', '1y', '5y']],
    ['alpaca', '6mo', ['1y', '5y']],
    ['alpaca', '12mo', ['5y']],
    ['robinhood', '1m', ['1d', '5d', '1w']],
    ['robinhood', '5m', ['1d', '5d', '1w', '1m', '3m']],
    ['robinhood', '10m', ['1d', '5d', '1w', '1m', '3m', '6m']],
    ['robinhood', '30m', ['1d', '5d', '1w', '1m', '3m', '6m', '1y']],
    ['robinhood', '1h', ['1d', '5d', '1w', '1m', '3m', '6m', '1y']],
    ['robinhood', '4h', ['1d', '5d', '1w', '1m', '3m', '6m', '1y', '5y']],
  ])('filters %s ranges for selected %s candles', (provider, interval, ids) => {
    const presets = getMarketSeriesRangePresets(provider, interval)
    expect(presets.map((preset) => preset.id)).toEqual(ids)
    expect(presets.every((preset) => preset.interval === interval)).toBe(true)
  })

  it.each([
    ['yahoo-finance', '1mo', false],
    ['yahoo-finance', '3mo', true],
    ['alpha-vantage', '1d', false],
    ['alpha-vantage', '1mo', true],
  ])('offers All only at the native %s interval: %s', (provider, interval, available) => {
    expect(
      getMarketSeriesRangePresets(provider, interval).some((preset) => preset.window.mode === 'all')
    ).toBe(available)
  })

  it.each([null, '', 'unsupported'])('rejects invalid interval %s', (interval) => {
    expect(getMarketSeriesRangePresets('yahoo-finance', interval)).toEqual([])
  })
})

describe('planMarketSeriesRequest', () => {
  it.each([
    ['params only', undefined, '1m', undefined, '1m'],
    ['top-level precedence', '5m', '1m', { mode: 'bars', barCount: 2 }, '5m'],
    ['params with a window', undefined, '1m', { mode: 'bars', barCount: 2 }, '1m'],
    ['daily default', undefined, undefined, undefined, '1d'],
    ['All override', '5m', '1m', { mode: 'all' }, '3mo'],
    ['invalid window', undefined, '1m', { mode: 'bars', barCount: 0 }, '1m'],
  ] as const)(
    'publishes one effective interval for %s',
    (_case, interval, paramInterval, window, expected) => {
      const request: MarketSeriesRequest = {
        kind: 'series',
        listing,
        interval,
        providerParams: { interval: paramInterval, marketSession: 'regular' },
        windows: window ? [window] : undefined,
        normalizationMode: 'adjusted',
      }
      const original = structuredClone(request)
      const result = planMarketSeriesRequest('yahoo-finance', request)
      expect(result.request.interval).toBe(expected)
      expect(result.request.providerParams).not.toHaveProperty('interval')
      expect(result.request.providerParams?.marketSession).toBe('regular')
      expect(request).toEqual(original)
      if (!window || (window.mode === 'bars' && window.barCount === 0)) {
        expect(result.mode).toBeNull()
        expect(result.request.normalizationMode).toBe('adjusted')
      }
    }
  )

  it.each([
    ['1d', { mode: 'bars', barCount: 2 }, 'split_adjusted'],
    ['1w', { mode: 'bars', barCount: 2 }, undefined],
    ['1d', { mode: 'all' }, undefined],
  ] as const)('validates normalization after resolving %s/%j', (interval, window, expected) => {
    const result = planMarketSeriesRequest('alpha-vantage', {
      kind: 'series',
      listing,
      interval,
      windows: [window],
      normalizationMode: 'split_adjusted',
    })
    expect(result.request.normalizationMode).toBe(expected)
    if (window.mode === 'all') expect(result.request.interval).toBe('1mo')
  })

  it.each([
    [
      { mode: 'bars', barCount: 2_000_000 },
      { mode: 'bars', barCount: 1_000_000 },
    ],
    [
      { mode: 'range', range: { value: 5, unit: 'year' } },
      { mode: 'range', rangeMs: 60_000_000_000 },
    ],
    [
      { mode: 'absolute', start: '2020-01-01', end: '2026-01-01' },
      {
        mode: 'absolute',
        startMs: Date.parse('2020-01-01'),
        endMs: Date.parse('2026-01-01'),
      },
    ],
  ] as const)('caps Alpaca counts/ranges while preserving custom dates: %j', (window, expected) => {
    const result = planMarketSeriesRequest('alpaca', {
      kind: 'series',
      listing,
      interval: '1m',
      windows: [window],
    })
    expect(result.window).toEqual(expected)
  })

  it.each([0, '0', -1, '-1'] as const)('accepts Unix bounds around the epoch: %s', (start) => {
    const startMs = Number(start) * 1000
    const end = Date.parse('1974-07-11T13:30:00.000Z')
    const result = planMarketSeriesRequest('alpaca', {
      kind: 'series',
      listing,
      interval: '1d',
      windows: [{ mode: 'absolute', start, end }],
    })

    expect(result.mode).toBe('absolute')
    expect(result.window).toEqual({
      mode: 'absolute',
      startMs,
      endMs: end,
    })
    expect(result.request.start).toBe(new Date(startMs).toISOString())
    expect(result.request.end).toBe('1974-07-11T13:30:00.000Z')
    expect(result.request.windows).toEqual([
      { mode: 'absolute', start: result.request.start, end: result.request.end },
    ])
  })

  it.each([
    [
      { mode: 'bars', barCount: 20_000 },
      { mode: 'bars', barCount: 10_080 },
    ],
    [
      { mode: 'range', range: { value: 2, unit: 'week' } },
      { mode: 'range', range: { value: 7, unit: 'day' } },
    ],
    [
      { mode: 'absolute', start: '2026-01-01', end: '2026-01-15' },
      { mode: 'absolute', start: '2026-01-08T00:00:00.000Z', end: '2026-01-15T00:00:00.000Z' },
    ],
  ] as const)('passes the retention-limited window to the adapter: %j', (window, expected) => {
    const result = planMarketSeriesRequest('yahoo-finance', {
      kind: 'series',
      listing,
      providerParams: { interval: '1m' },
      windows: [window],
    })
    expect(result.request.interval).toBe('1m')
    expect(result.request.windows).toEqual([expected])
  })
})
