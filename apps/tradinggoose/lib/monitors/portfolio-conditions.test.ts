import { expect, it } from 'vitest'
import { evaluatePortfolioFireCondition } from './portfolio-conditions'
import {
  normalizePortfolioMonitorConfig,
  PortfolioMonitorProviderConfigSchema,
  SupportedPortfolioMonitorProviderConfigSchema,
} from './portfolio-config'
import { PORTFOLIO_MONITOR_TRIGGER_ID } from './sources'

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

it('keeps unsupported saved metrics readable but rejects them for execution', () => {
  const config = PortfolioMonitorProviderConfigSchema.parse({
    triggerId: PORTFOLIO_MONITOR_TRIGGER_ID,
    version: 1,
    monitor: {
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
      fireMode: 'edge',
      cooldownSeconds: 300,
      pollIntervalSeconds: 60,
    },
  })

  expect(() => SupportedPortfolioMonitorProviderConfigSchema.parse(config)).toThrow(
    'Invalid portfolio monitor condition for robinhood'
  )
})

it('keeps monitor conditions stable through JSON persistence', () => {
  const config = normalizePortfolioMonitorConfig({
    triggerBlockId: 'block-1',
    providerId: 'robinhood',
    serviceId: 'robinhood',
    credentialId: 'credential-1',
    connectionOwnerUserId: 'user-1',
    accountId: 'account-1',
    condition: {
      root: {
        combinator: 'and',
        rules: [{ metric: 'summary.totalPortfolioValue', operator: 'gt', value: 0 }],
      },
    },
  })

  expect(JSON.parse(JSON.stringify(config))).toStrictEqual(config)
})
