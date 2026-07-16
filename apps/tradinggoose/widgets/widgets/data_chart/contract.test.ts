import { describe, expect, it } from 'vitest'
import { sanitizeWidgetParams } from '@/widgets/widget-contracts'
import { sanitizeDataChartParams } from '@/widgets/widgets/data_chart/contract'

describe('sanitizeDataChartParams', () => {
  it('preserves raw and env-var nested market auth for data chart provider params', () => {
    const pineIndicators = [{ id: 'indicator-1', inputs: { length: 14 }, visible: true }]
    expect(
      sanitizeDataChartParams({
        data: {
          provider: 'alpaca',
          auth: {
            apiKey: 'raw-key',
            apiSecret: '{{ ALPACA_API_SECRET }}',
          },
        },
      })
    ).toEqual({
      data: {
        provider: 'alpaca',
        auth: {
          apiKey: 'raw-key',
          apiSecret: '{{ ALPACA_API_SECRET }}',
        },
      },
    })
    expect(sanitizeDataChartParams({ view: { pineIndicators } })).toEqual({
      view: { pineIndicators },
    })
  })

  it('drops non-identity listing values so only listing identities persist', () => {
    expect(sanitizeWidgetParams('data_chart', { listing: 'AAPL' })).toBeNull()
    expect(
      sanitizeWidgetParams('data_chart', {
        listing: 'AAPL',
        data: { provider: 'alpaca' },
      })
    ).toEqual({
      data: { provider: 'alpaca' },
    })
    expect(sanitizeDataChartParams({ listing: 'AAPL' })).toBeNull()
  })

  it.each([
    [{ indicators: [{ id: 'RSI' }] }, 'params.indicators'],
    [{ view: { pineIndicators: 123 } }, 'params.view.pineIndicators'],
    [{ view: { pineIndicators: [{ id: '', invented: true }] } }, 'params.view.pineIndicators.0'],
  ])('rejects unsupported or invalid strict edits', (params, path) => {
    expect(() => sanitizeDataChartParams(params, { strictUnknown: true })).toThrow(path)
  })
})
