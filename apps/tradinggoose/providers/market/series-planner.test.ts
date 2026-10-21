import { describe, expect, it } from 'vitest'
import {
  getMarketSeriesRangePresets,
  planMarketSeriesRequest,
} from '@/providers/market/series-planner'

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
    ['yahoo-finance', '1mo', ['1m', '3m', '6m', '1y', '5y']],
    ['yahoo-finance', '3mo', ['3m', '6m', '1y', '5y', 'all']],
    ['alpaca', '1m', ['1d', '5d', '1w', '1m', '3m', '6m', '1y']],
    ['alpaca', '2m', ['1d', '5d', '1w', '1m', '3m', '6m', '1y']],
    ['alpaca', '3m', ['1d', '5d', '1w', '1m', '3m', '6m', '1y', '5y']],
    ['alpaca', '12mo', ['1y', '5y']],
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
        startMs: Date.parse('2026-01-01') - 60_000_000_000,
        endMs: Date.parse('2026-01-01'),
      },
    ],
  ] as const)('applies the Alpaca bar budget to %j', (window, expected) => {
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
  ] as const)('passes the retention-limited window to the adapter: %j', (window, expected) => {
    const result = planMarketSeriesRequest('yahoo-finance', {
      kind: 'series',
      listing,
      interval: '1m',
      windows: [window],
    })
    expect(result.request.windows).toEqual([expected])
  })
})
