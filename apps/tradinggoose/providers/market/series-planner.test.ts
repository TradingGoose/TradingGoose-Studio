import { describe, expect, it } from 'vitest'
import { planMarketSeriesRequest } from '@/providers/market/series-planner'

const listing = {
  listing_id: 'TG_LSTG_822870',
  base_id: '',
  quote_id: '',
  listing_type: 'default' as const,
}

describe('planMarketSeriesRequest', () => {
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
