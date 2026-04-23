/**
 * @vitest-environment node
 */

import { describe, expect, it } from 'vitest'
import { ALPACA_SUPPORTED_TRADING_PORTFOLIO_WINDOWS } from '@/providers/trading/alpaca/performance'
import {
  getTradingPortfolioSupportedWindows,
  isTradingPortfolioWindowSupported,
} from '@/providers/trading/portfolio'
import { TRADIER_SUPPORTED_TRADING_PORTFOLIO_WINDOWS } from '@/providers/trading/tradier/performance'

describe('Trading portfolio window contract', () => {
  it('reuses the provider-specific supported window lists', () => {
    expect(getTradingPortfolioSupportedWindows('alpaca')).toEqual(
      ALPACA_SUPPORTED_TRADING_PORTFOLIO_WINDOWS
    )
    expect(getTradingPortfolioSupportedWindows('tradier')).toEqual(
      TRADIER_SUPPORTED_TRADING_PORTFOLIO_WINDOWS
    )
  })

  it('rejects unsupported windows without requiring a typed window input', () => {
    expect(isTradingPortfolioWindowSupported('alpaca', '1D')).toBe(true)
    expect(isTradingPortfolioWindowSupported('alpaca', 'MAX')).toBe(false)
    expect(isTradingPortfolioWindowSupported('tradier', 'MAX')).toBe(true)
    expect(isTradingPortfolioWindowSupported('tradier', '3M')).toBe(false)
  })
})
