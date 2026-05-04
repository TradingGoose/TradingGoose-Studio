/**
 * @vitest-environment node
 */

import { describe, expect, it } from 'vitest'
import {
  getTradingPortfolioSupportedWindows,
  isTradingPortfolioWindowSupported,
} from '@/providers/trading/portfolio'
import { getTradingHoldingsCapabilities } from '@/providers/trading/providers'

describe('Trading portfolio window contract', () => {
  it('reuses the provider definition supported window lists', () => {
    expect(getTradingPortfolioSupportedWindows('alpaca')).toEqual(
      getTradingHoldingsCapabilities('alpaca')?.performanceWindows
    )
    expect(getTradingPortfolioSupportedWindows('tradier')).toEqual(
      getTradingHoldingsCapabilities('tradier')?.performanceWindows
    )
  })

  it('rejects unsupported windows without requiring a typed window input', () => {
    expect(isTradingPortfolioWindowSupported('alpaca', '1D')).toBe(true)
    expect(isTradingPortfolioWindowSupported('alpaca', 'MAX')).toBe(false)
    expect(isTradingPortfolioWindowSupported('tradier', 'MAX')).toBe(true)
    expect(isTradingPortfolioWindowSupported('tradier', '3M')).toBe(false)
  })
})
