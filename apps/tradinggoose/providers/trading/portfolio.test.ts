/**
 * @vitest-environment node
 */

import { describe, expect, it } from 'vitest'
import {
  getTradingPortfolioSupportedWindows,
  isTradingPortfolioWindowSupported,
} from '@/providers/trading/portfolio'
import { getTradingPortfolioDetailCapabilities } from '@/providers/trading/providers'

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
})
