import { describe, expect, it } from 'vitest'
import { resolveSeriesWindow } from './series-window'
import { resolveExpectedBars } from './utils/series-loader'

describe('chart range windows', () => {
  it.each([
    ['yahoo-finance', '3mo'],
    ['alpha-vantage', '1mo'],
  ])('requests all %s history at its native interval', (provider, interval) => {
    const result = resolveSeriesWindow({ view: { rangePresetId: 'all', interval: '1d' } }, provider)

    expect(result).toMatchObject({
      window: { mode: 'all' },
      windows: [{ mode: 'all' }],
      interval,
      requestInterval: interval,
      allowedIntervals: [interval],
    })
    expect(resolveExpectedBars(result.window!, interval)).toBeNull()
  })

  it('rejects unsupported All and restores interval choices for finite ranges', () => {
    const unsupported = resolveSeriesWindow({ view: { rangePresetId: 'all' } }, 'alpaca')
    const finite = resolveSeriesWindow({ view: { rangePresetId: '1d' } }, 'yahoo-finance')

    expect(unsupported.window?.mode).not.toBe('all')
    expect(finite.window).toEqual({ mode: 'range', range: { value: 1, unit: 'day' } })
    expect(finite.allowedIntervals).toContain('1m')
  })

  it('preserves millisecond bounds before 2001 when estimating chart bars', () => {
    const start = Date.UTC(2000, 0, 1)
    expect(resolveExpectedBars({ mode: 'absolute', start, end: start + 86_400_000 }, '1d')).toBe(1)
  })
})
