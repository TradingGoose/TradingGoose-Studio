/**
 * @vitest-environment node
 */

import { describe, expect, it } from 'vitest'
import {
  buildTradingPortfolioPerformance,
  buildTradingPortfolioPerformanceSummary,
} from '@/providers/trading/portfolio-utils'

describe('trading portfolio performance helpers', () => {
  it('treats a single-point series as flat performance with a null percent return', () => {
    const summary = buildTradingPortfolioPerformanceSummary(
      [{ timestamp: '2026-04-22T00:00:00.000Z', equity: 2500 }],
      'USD'
    )

    expect(summary).toEqual({
      currency: 'USD',
      startEquity: 2500,
      endEquity: 2500,
      highEquity: 2500,
      lowEquity: 2500,
      absoluteReturn: 0,
      percentReturn: null,
      asOf: '2026-04-22T00:00:00.000Z',
    })
  })

  it('returns a null percent when the starting equity is zero', () => {
    const performance = buildTradingPortfolioPerformance({
      window: '1D',
      supportedWindows: ['1D', '1W'],
      currency: 'USD',
      series: [
        { timestamp: '2026-04-21T00:00:00.000Z', equity: 0 },
        { timestamp: '2026-04-22T00:00:00.000Z', equity: 100 },
      ],
    })

    expect(performance.summary).toMatchObject({
      currency: 'USD',
      startEquity: 0,
      endEquity: 100,
      absoluteReturn: 100,
      percentReturn: null,
    })
  })
})
