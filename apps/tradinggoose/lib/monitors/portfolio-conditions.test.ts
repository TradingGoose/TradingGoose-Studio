import { expect, it } from 'vitest'
import { evaluatePortfolioFireCondition } from './portfolio-conditions'

it.each(['positions.totalMarketValue', 'positions.totalUnrealizedPnl'] as const)(
  '%s remains unavailable when a position value is unavailable',
  (metric) => {
    expect(
      evaluatePortfolioFireCondition({
        condition: {
          root: {
            combinator: 'and',
            rules: [{ metric, operator: 'lt', value: 1 }],
          },
        },
        current: {
          summary: { totalPortfolioValue: 1_000, totalCashValue: 0 },
          positions: [{ listingIdentity: null, quantity: 1 }],
        },
      })
    ).toBe(false)
  }
)
