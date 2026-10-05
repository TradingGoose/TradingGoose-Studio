import { expect, it } from 'vitest'
import { evaluatePortfolioFireCondition } from './portfolio-conditions'
import { normalizePortfolioMonitorConfig } from './portfolio-config'

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

it('rejects monitor metrics outside the trading provider contract', () => {
  expect(() =>
    normalizePortfolioMonitorConfig({
      triggerBlockId: 'block-1',
      providerId: 'robinhood',
      serviceId: 'robinhood',
      credentialId: 'credential-1',
      connectionOwnerUserId: 'user-1',
      accountId: 'account-1',
      condition: {
        root: {
          combinator: 'and',
          rules: [
            {
              combinator: 'or',
              rules: [{ metric: 'summary.totalUnrealizedPnl', operator: 'gt', value: 0 }],
            },
          ],
        },
      },
    })
  ).toThrow('Invalid portfolio monitor condition for robinhood')
})
