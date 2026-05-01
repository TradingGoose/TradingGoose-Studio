import { describe, expect, it } from 'vitest'
import {
  resolveHeatmapMarketProviderId,
  resolveHeatmapSourceMode,
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

  it('defaults source mode to watchlist unless portfolio is explicitly persisted', () => {
    expect(resolveHeatmapSourceMode(null)).toBe('watchlist')
    expect(resolveHeatmapSourceMode({ sourceMode: 'watchlist' })).toBe('watchlist')
    expect(resolveHeatmapSourceMode({ sourceMode: 'portfolio' })).toBe('portfolio')
  })

  it('defaults watchlist tile sizing to volume USD', () => {
    expect(resolveHeatmapWatchlistSizeMetric(null)).toBe('volumeUsd')
    expect(resolveHeatmapWatchlistSizeMetric({ watchlistSizeMetric: 'volume' })).toBe('volume')
  })
})
