import { describe, expect, it } from 'vitest'
import { planMarketSeriesRequest } from '@/providers/market/series-planner'

describe('planMarketSeriesRequest', () => {
  it('accepts absolute windows that start at unix epoch', () => {
    const end = Date.parse('1974-07-11T13:30:00.000Z')
    const result = planMarketSeriesRequest('alpaca', {
      kind: 'series',
      listing: {
        listing_id: 'TG_LSTG_822870',
        base_id: '',
        quote_id: '',
        listing_type: 'default',
      },
      interval: '1d',
      windows: [{ mode: 'absolute', start: 0, end }],
    })

    expect(result.mode).toBe('absolute')
    expect(result.window).toEqual({
      mode: 'absolute',
      startMs: 0,
      endMs: end,
    })
    expect(result.request.start).toBe('1970-01-01T00:00:00.000Z')
    expect(result.request.end).toBe('1974-07-11T13:30:00.000Z')
  })
})
