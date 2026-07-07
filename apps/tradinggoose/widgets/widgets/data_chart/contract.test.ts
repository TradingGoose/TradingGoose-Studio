import { describe, expect, it } from 'vitest'
import { sanitizeWidgetParams } from '@/widgets/widget-contracts'
import { sanitizeDataChartParams } from '@/widgets/widgets/data_chart/contract'

describe('sanitizeDataChartParams', () => {
  it('preserves raw and env-var nested market auth for data chart provider params', () => {
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
  })

  it('drops legacy string listing values so only listing identities persist', () => {
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

  it('rejects the removed top-level indicators alias in strict edits', () => {
    expect(() =>
      sanitizeDataChartParams(
        {
          indicators: [{ id: 'RSI' }],
        },
        { strictUnknown: true }
      )
    ).toThrow('Widget "data_chart" does not support this field')
  })
})
