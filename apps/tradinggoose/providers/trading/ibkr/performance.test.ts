import { describe, expect, it } from 'vitest'
import { normalizeIbkrPerformanceResponse } from '@/providers/trading/ibkr/performance'

describe('normalizeIbkrPerformanceResponse', () => {
  const baseResponse = (nav: unknown) => ({ nav })

  it('normalizes daily performance data', () => {
    const response = baseResponse({
      base: {
        freq: 'D',
        data: [
          { $: 1000, t: '2026-08-01T00:00:00Z' },
          { $: 1010, t: '2026-08-02T00:00:00Z' },
          { $: 1020, t: '2026-08-03T00:00:00Z' },
        ],
      },
    })

    const result = normalizeIbkrPerformanceResponse({
      response,
      currency: 'USD',
      window: '1W',
    })

    expect(result.window).toBe('1W')
    expect(result.series).toHaveLength(3)
    expect(result.series[0]).toMatchObject({ equity: 1000 })
    expect(result.series[2]).toMatchObject({ equity: 1020 })
    expect(result.summary).toMatchObject({
      currency: 'USD',
      startEquity: 1000,
      endEquity: 1020,
      absoluteReturn: 20,
    })
  })

  it('handles empty data as unavailable', () => {
    const response = baseResponse({
      base: {
        freq: 'M',
        data: [],
      },
    })

    const result = normalizeIbkrPerformanceResponse({
      response,
      currency: 'USD',
      window: '1Y',
    })

    expect(result.summary).toBeNull()
    expect(result.unavailableReason).toBeTruthy()
  })

  it('handles missing nav as unavailable', () => {
    const result = normalizeIbkrPerformanceResponse({
      response: {},
      currency: 'USD',
      window: '1M',
    })

    expect(result.summary).toBeNull()
    expect(result.series).toEqual([])
  })

  it('deduplicates entries by day keeping the latest value', () => {
    const response = baseResponse({
      base: {
        freq: 'D',
        data: [
          { $: 100, t: 1785600000 },
          { $: 110, t: 1785600001 },
        ],
      },
    })

    const result = normalizeIbkrPerformanceResponse({
      response,
      currency: 'USD',
      window: '1M',
    })

    expect(result.series).toHaveLength(1)
    expect(result.series[0]?.equity).toBe(110)
  })
})
