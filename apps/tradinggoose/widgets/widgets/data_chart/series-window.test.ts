import { describe, expect, it } from 'vitest'
import { dataChartWidgetContract } from './contract'
import { resolveSeriesWindow } from './series-window'
import { resolveExpectedBars } from './utils/series-loader'

describe('chart range windows', () => {
  it.each([
    ['yahoo-finance', '1w', '30m', { value: 1, unit: 'week' }],
    ['alpha-vantage', '1w', '30m', { value: 1, unit: 'week' }],
    ['finnhub', '1w', '30m', { value: 1, unit: 'week' }],
    ['yahoo-finance', '3m', '1d', { value: 3, unit: 'month' }],
    ['alpha-vantage', '3m', '1d', { value: 3, unit: 'month' }],
  ])(
    'preserves Copilot %s %s presets without an interval',
    (provider, rangePresetId, interval, range) => {
      const params = dataChartWidgetContract.mergeCopilotParams(null, {
        data: { provider },
        view: { rangePresetId },
      })
      const result = resolveSeriesWindow(params!, provider)

      expect(params?.view).not.toHaveProperty('interval')
      expect(result.window).toEqual({ mode: 'range', range })
      expect(result.requestInterval).toBe(interval)
    }
  )

  it.each([undefined, 'yahoo-finance'])(
    'keeps default windows for absent or unknown presets with provider %s',
    (provider) => {
      const result = resolveSeriesWindow({}, provider)

      expect(resolveSeriesWindow({ view: { rangePresetId: 'unknown' } }, provider)).toEqual(result)
      expect(result).toMatchObject(
        provider
          ? { window: { mode: 'bars', barCount: 500 }, interval: '1d' }
          : { window: { mode: 'range', range: { value: 1, unit: 'day' } }, interval: '3m' }
      )
      if (!provider) {
        expect(resolveSeriesWindow({ view: { rangePresetId: '1w' } })).toEqual(result)
      }
    }
  )

  it.each([
    ['yahoo-finance', '1d'],
    ['alpha-vantage', '1d'],
    ['yahoo-finance', '1h'],
    ['alpha-vantage', '1h'],
  ])('validates Copilot %s presets against configured %s candles', (provider, interval) => {
    const params = dataChartWidgetContract.mergeCopilotParams(null, {
      data: { provider },
      view: { rangePresetId: '3m', interval },
    })
    const result = resolveSeriesWindow(params!, provider)

    expect(result.window).toEqual(
      interval === '1d'
        ? { mode: 'range', range: { value: 3, unit: 'month' } }
        : { mode: 'bars', barCount: 500 }
    )
    expect(result.requestInterval).toBe(interval)
  })

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
