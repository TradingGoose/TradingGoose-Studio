/**
 * @vitest-environment node
 */

import { describe, expect, it } from 'vitest'
import {
  getTradingPortfolioSupportedWindows,
  isTradingPortfolioWindowSupported,
} from '@/providers/trading/portfolio'
import {
  getTradingPortfolioDetailCapabilities,
  getTradingPortfolioMonitorMetrics,
} from '@/providers/trading/providers'
import { TRADING_PORTFOLIO_MONITOR_METRICS } from '@/providers/trading/types'

describe('Trading portfolio window contract', () => {
  it('reuses the provider definition supported window lists', () => {
    expect(getTradingPortfolioSupportedWindows('alpaca')).toEqual(
      getTradingPortfolioDetailCapabilities('alpaca')?.performanceWindows
    )
    expect(getTradingPortfolioSupportedWindows('tradier')).toEqual(
      getTradingPortfolioDetailCapabilities('tradier')?.performanceWindows
    )
  })

  it('rejects unsupported windows without requiring a typed window input', () => {
    expect(isTradingPortfolioWindowSupported('alpaca', '1D')).toBe(true)
    expect(isTradingPortfolioWindowSupported('alpaca', 'MAX')).toBe(false)
    expect(isTradingPortfolioWindowSupported('tradier', 'MAX')).toBe(true)
    expect(isTradingPortfolioWindowSupported('tradier', '3M')).toBe(false)
  })

  it('declares monitor metrics from each provider snapshot contract', () => {
    expect(getTradingPortfolioMonitorMetrics('alpaca')).toEqual(TRADING_PORTFOLIO_MONITOR_METRICS)
    expect(getTradingPortfolioMonitorMetrics('tradier')).not.toContain('position.unrealizedPnl')
    expect(getTradingPortfolioMonitorMetrics('robinhood')).toEqual([
      'summary.totalPortfolioValue',
      'summary.totalCashValue',
      'summary.totalHoldingsValue',
      'summary.buyingPower',
      'summary.equity',
      'positions.count',
      'position.quantity',
      'position.exists',
    ])
  })
})
