import { describe, expect, it } from 'vitest'
import {
  resolveHeatmapMarketProviderId,
  resolveHeatmapEnvironment,
  resolveHeatmapTradingProviderId,
  resolveHeatmapWatchlistSizeMetric,
} from '@/widgets/widgets/heatmap/components/shared'

describe('heatmap shared helpers', () => {
  const providerOptions = [
    { id: 'alpaca', name: 'Alpaca' },
    { id: 'tradier', name: 'Tradier' },
  ]

  it('does not infer a trading provider fallback for portfolio mode', () => {
    expect(resolveHeatmapTradingProviderId(null, providerOptions)).toBe('')
    expect(resolveHeatmapTradingProviderId({}, providerOptions)).toBe('')
    expect(resolveHeatmapTradingProviderId({ tradingProvider: 'missing' }, providerOptions)).toBe(
      ''
    )
    expect(resolveHeatmapTradingProviderId({ tradingProvider: 'tradier' }, providerOptions)).toBe(
      'tradier'
    )
  })

  it('does not infer a market provider fallback', () => {
    expect(resolveHeatmapMarketProviderId(null, providerOptions)).toBe('')
    expect(resolveHeatmapMarketProviderId({}, providerOptions)).toBe('')
    expect(resolveHeatmapMarketProviderId({ marketProvider: 'missing' }, providerOptions)).toBe('')
    expect(resolveHeatmapMarketProviderId({ marketProvider: 'alpaca' }, providerOptions)).toBe(
      'alpaca'
    )
  })

  it('resolves a valid persisted environment or the provider default', () => {
    expect(resolveHeatmapEnvironment('', 'paper')).toBeUndefined()
    expect(resolveHeatmapEnvironment('alpaca', 'paper')).toBe('paper')
    expect(resolveHeatmapEnvironment('alpaca', 'missing')).toBe('paper')
    expect(resolveHeatmapEnvironment('tradier', undefined)).toBe('live')
  })

  it('defaults watchlist tile sizing to volume USD', () => {
    expect(resolveHeatmapWatchlistSizeMetric(null)).toBe('volumeUsd')
    expect(resolveHeatmapWatchlistSizeMetric({ watchlistSizeMetric: 'volume' })).toBe('volume')
  })
})
