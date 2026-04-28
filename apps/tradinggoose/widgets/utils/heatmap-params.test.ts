import { describe, expect, it } from 'vitest'
import { sanitizeHeatmapParams } from '@/widgets/utils/heatmap-params'

describe('sanitizeHeatmapParams', () => {
  it('persists source/provider selections while stripping raw market credentials', () => {
    expect(
      sanitizeHeatmapParams({
        sourceMode: 'portfolio',
        marketProvider: 'alpaca',
        marketAuth: {
          apiKey: 'raw-key',
          apiSecret: '{{ ALPACA_API_SECRET }}',
        },
        tradingProvider: 'alpaca',
        credentialId: 'credential-1',
        environment: 'paper',
        accountId: 'account-1',
        runtime: { refreshAt: 123 },
      })
    ).toEqual({
      sourceMode: 'portfolio',
      marketProvider: 'alpaca',
      marketAuth: {
        apiSecret: '{{ ALPACA_API_SECRET }}',
      },
      tradingProvider: 'alpaca',
      credentialId: 'credential-1',
      environment: 'paper',
      accountId: 'account-1',
      runtime: { refreshAt: 123 },
    })
  })
})
