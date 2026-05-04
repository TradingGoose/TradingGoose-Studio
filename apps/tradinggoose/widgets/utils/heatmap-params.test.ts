import { describe, expect, it } from 'vitest'
import { sanitizeHeatmapParams } from '@/widgets/utils/heatmap-params'

describe('sanitizeHeatmapParams', () => {
  it('persists source/provider selections with raw and env-var market credentials', () => {
    expect(
      sanitizeHeatmapParams({
        sourceMode: 'portfolio',
        watchlistSizeMetric: 'volumeUsd',
        marketProvider: 'alpaca',
        marketAuth: {
          apiKey: 'raw-key',
          apiSecret: '{{ ALPACA_API_SECRET }}',
        },
        tradingProvider: 'alpaca',
        accountId: 'account-1',
        runtime: { refreshAt: 123 },
      })
    ).toEqual({
      sourceMode: 'portfolio',
      watchlistSizeMetric: 'volumeUsd',
      marketProvider: 'alpaca',
      marketAuth: {
        apiKey: 'raw-key',
        apiSecret: '{{ ALPACA_API_SECRET }}',
      },
      tradingProvider: 'alpaca',
      accountId: 'account-1',
      runtime: { refreshAt: 123 },
    })
  })
})
