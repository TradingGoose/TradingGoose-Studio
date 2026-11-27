/**
 * @vitest-environment node
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockDb, mockEq, mockGetResolvedBillingSettings } = vi.hoisted(() => ({
  mockDb: {
    select: vi.fn(),
    update: vi.fn(),
  },
  mockEq: vi.fn((field: unknown, value: unknown) => ({ field, value })),
  mockGetResolvedBillingSettings: vi.fn(),
}))

let statsRows: Array<Record<string, unknown>> = []
let updateValues: Array<Record<string, unknown>> = []

vi.mock('@tradinggoose/db', () => ({
  db: mockDb,
}))

vi.mock('@tradinggoose/db/schema', () => ({
  member: {},
  settings: {},
  user: {},
  userStats: {
    userId: 'userStats.userId',
    currentPeriodCost: 'userStats.currentPeriodCost',
    currentPeriodCopilotCost: 'userStats.currentPeriodCopilotCost',
    grantedOnboardingAllowanceUsd: 'userStats.grantedOnboardingAllowanceUsd',
    customUsageLimit: 'userStats.customUsageLimit',
  },
}))

vi.mock('drizzle-orm', () => ({
  eq: mockEq,
}))

vi.mock('@/components/emails/render-email', () => ({
  getEmailSubject: vi.fn(),
  renderFreeTierUpgradeEmail: vi.fn(),
  renderUsageThresholdEmail: vi.fn(),
}))

vi.mock('@/lib/billing/core/subscription', () => ({
  getConfiguredPersonalUsageLimit: vi.fn(),
  getEffectiveSubscription: vi.fn(),
  getSubscribedPersonalUsageMinimumLimit: vi.fn(),
}))

vi.mock('@/lib/billing/settings', () => ({
  getResolvedBillingSettings: mockGetResolvedBillingSettings,
}))

vi.mock('@/lib/billing/subscriptions/utils', () => ({
  canEditUsageLimit: vi.fn(),
}))

vi.mock('@/lib/billing/tiers', () => ({
  getPrimaryPublicUserUpgradeTier: vi.fn(),
  getTierBasePrice: vi.fn(),
  getTierUsageAllowanceUsd: vi.fn(),
  toBillingTierSummary: vi.fn(),
}))

vi.mock('@/lib/email/mailer', () => ({
  sendEmail: vi.fn(),
}))

vi.mock('@/lib/email/unsubscribe', () => ({
  getEmailPreferences: vi.fn(),
}))

vi.mock('@/lib/logs/console/logger', () => ({
  createLogger: () => ({
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  }),
}))

vi.mock('@/lib/urls/utils', () => ({
  getBaseUrl: vi.fn(),
}))

function createSelectQueryMock(result: unknown) {
  const query = {
    from: vi.fn(() => query),
    where: vi.fn(() => query),
    limit: vi.fn(() => Promise.resolve(result)),
  }

  return query
}

describe('usage onboarding allowance helpers', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()

    statsRows = []
    updateValues = []

    mockGetResolvedBillingSettings.mockResolvedValue({
      onboardingAllowanceUsd: 25,
    })
    mockDb.select.mockImplementation(() => createSelectQueryMock(statsRows))
    mockDb.update.mockImplementation(() => ({
      set: vi.fn((values) => ({
        where: vi.fn(async () => {
          updateValues.push(values)
          Object.assign(statsRows[0], values)
          return []
        }),
      })),
    }))
  })

  it('consumes granted onboarding allowance without reducing the seeded custom usage limit', async () => {
    statsRows = [
      {
        currentPeriodCost: '12.50',
        currentPeriodCopilotCost: '1.25',
        grantedOnboardingAllowanceUsd: '25.00',
        customUsageLimit: '25.00',
      },
    ]

    const { decrementGrantedOnboardingAllowanceByCurrentPeriodUsage } = await import('./usage')

    await decrementGrantedOnboardingAllowanceByCurrentPeriodUsage('user-1')

    expect(updateValues).toEqual([
      {
        billedOverageThisPeriod: '0',
        currentPeriodCopilotCost: '0',
        currentPeriodCost: '0',
        grantedOnboardingAllowanceUsd: '12.5',
        lastPeriodCopilotCost: '1.25',
        lastPeriodCost: '12.5',
      },
    ])
  })

  it('clamps consumed onboarding allowance at zero', async () => {
    statsRows = [
      {
        currentPeriodCost: '30.00',
        currentPeriodCopilotCost: '0.50',
        grantedOnboardingAllowanceUsd: '25.00',
        customUsageLimit: '25.00',
      },
    ]

    const { decrementGrantedOnboardingAllowanceByCurrentPeriodUsage } = await import('./usage')

    await decrementGrantedOnboardingAllowanceByCurrentPeriodUsage('user-1')

    expect(updateValues).toEqual([
      {
        billedOverageThisPeriod: '0',
        currentPeriodCopilotCost: '0',
        currentPeriodCost: '0',
        grantedOnboardingAllowanceUsd: '0',
        lastPeriodCopilotCost: '0.50',
        lastPeriodCost: '30',
      },
    ])
  })

  it('preserves higher custom usage limits while consuming onboarding allowance', async () => {
    statsRows = [
      {
        currentPeriodCost: '7.00',
        currentPeriodCopilotCost: '0.75',
        grantedOnboardingAllowanceUsd: '25.00',
        customUsageLimit: '100.00',
      },
    ]

    const { decrementGrantedOnboardingAllowanceByCurrentPeriodUsage } = await import('./usage')

    await decrementGrantedOnboardingAllowanceByCurrentPeriodUsage('user-1')

    expect(updateValues).toEqual([
      {
        billedOverageThisPeriod: '0',
        currentPeriodCopilotCost: '0',
        currentPeriodCost: '0',
        grantedOnboardingAllowanceUsd: '18',
        lastPeriodCopilotCost: '0.75',
        lastPeriodCost: '7',
      },
    ])
  })

  it('keeps migrated last-period usage intact on a zero-usage retry', async () => {
    statsRows = [
      {
        currentPeriodCost: '0',
        currentPeriodCopilotCost: '0',
        grantedOnboardingAllowanceUsd: '12.50',
        customUsageLimit: '12.50',
      },
    ]

    const { decrementGrantedOnboardingAllowanceByCurrentPeriodUsage } = await import('./usage')

    await decrementGrantedOnboardingAllowanceByCurrentPeriodUsage('user-1')

    expect(updateValues).toEqual([])
  })

  it('resets default usage state to the onboarding allowance balance', async () => {
    statsRows = [
      {
        grantedOnboardingAllowanceUsd: '7.00',
      },
    ]

    const { resetUserDefaultUsageToOnboardingAllowanceBalance } = await import('./usage')

    await resetUserDefaultUsageToOnboardingAllowanceBalance('user-1')

    expect(updateValues).toEqual([
      {
        billedOverageThisPeriod: '0',
        currentPeriodCopilotCost: '0',
        currentPeriodCost: '18',
        customUsageLimit: '25',
        customUsageLimitUpdatedAt: expect.any(Date),
      },
    ])
  })

  it.each([
    { additionalUsage: 0, remainingAllowance: 18 },
    { additionalUsage: 2, remainingAllowance: 16 },
    { additionalUsage: 18, remainingAllowance: 0 },
    { additionalUsage: 30, remainingAllowance: 0 },
  ])(
    'keeps $remainingAllowance after cancellation and reactivation with $additionalUsage new free usage',
    async ({ additionalUsage, remainingAllowance }) => {
      const stats = {
        currentPeriodCost: '7',
        currentPeriodCopilotCost: '0.75',
        grantedOnboardingAllowanceUsd: '25',
        customUsageLimit: '100',
      }
      statsRows = [stats]

      const {
        decrementGrantedOnboardingAllowanceByCurrentPeriodUsage,
        resetUserDefaultUsageToOnboardingAllowanceBalance,
      } = await import('./usage')

      await decrementGrantedOnboardingAllowanceByCurrentPeriodUsage('user-1')
      expect(stats.grantedOnboardingAllowanceUsd).toBe('18')

      await resetUserDefaultUsageToOnboardingAllowanceBalance('user-1')
      expect(stats.customUsageLimit).toBe('25')
      expect(stats.currentPeriodCost).toBe('7')
      expect(Number(stats.customUsageLimit) - Number(stats.currentPeriodCost)).toBe(18)

      stats.currentPeriodCost = (7 + additionalUsage).toString()
      await decrementGrantedOnboardingAllowanceByCurrentPeriodUsage('user-1')
      expect(stats).toMatchObject({
        grantedOnboardingAllowanceUsd: remainingAllowance.toString(),
        currentPeriodCost: '0',
        currentPeriodCopilotCost: '0',
        customUsageLimit: '25',
      })

      const writesAfterActivation = updateValues.length
      await decrementGrantedOnboardingAllowanceByCurrentPeriodUsage('user-1')
      expect(updateValues).toHaveLength(writesAfterActivation)

      await resetUserDefaultUsageToOnboardingAllowanceBalance('user-1')
      expect(Number(stats.customUsageLimit) - Number(stats.currentPeriodCost)).toBe(
        remainingAllowance
      )
      await decrementGrantedOnboardingAllowanceByCurrentPeriodUsage('user-1')
      expect(stats.grantedOnboardingAllowanceUsd).toBe(remainingAllowance.toString())
      expect(stats.currentPeriodCost).toBe('0')
    }
  )
})
