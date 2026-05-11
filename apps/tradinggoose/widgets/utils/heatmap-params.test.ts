import { describe, expect, it } from 'vitest'
import { sanitizeHeatmapParams } from '@/widgets/utils/heatmap-params'

const portfolioIdentity = {
  providerId: 'alpaca',
  credentialId: 'credential-1',
  credentialServiceId: 'alpaca-live',
  accountId: 'account-1',
}

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
        credentialServiceId: 'alpaca-live',
        portfolioIdentity,
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
      credentialServiceId: 'alpaca-live',
      portfolioIdentity,
      runtime: { refreshAt: 123 },
    })
  })
})
