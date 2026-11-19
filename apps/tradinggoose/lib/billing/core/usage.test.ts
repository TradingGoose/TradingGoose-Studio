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
  getEmailSubject: vi.fn((key: string) => key),
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
})

describe('usage threshold mail', () => {
  const usage = {
    scope: 'user' as const,
    userId: 'owner',
    userEmail: 'owner@example.com',
    planName: 'Free',
    isFreeTier: true,
    percentBefore: 50,
    percentAfter: 95,
    currentUsageAfter: 95,
    limit: 100,
  }

  it.each([true, false])(
    'uses the billing notification preference for both thresholds (enabled=%s)',
    async (enabled) => {
      vi.clearAllMocks()
      mockGetResolvedBillingSettings.mockResolvedValue({
        billingEnabled: true,
        usageWarningThresholdPercent: 75,
        freeTierUpgradeThresholdPercent: 90,
      })
      mockDb.select.mockImplementation(() =>
        createSelectQueryMock([{ enabled, preferredLocale: 'es' }])
      )
      const { sendEmail } = await import('@/lib/email/mailer')
      const { maybeSendUsageThresholdEmail } = await import('./usage')
      await maybeSendUsageThresholdEmail(usage)
      expect(
        vi.mocked(sendEmail).mock.calls.map(([mail]) => [mail.to, mail.locale, mail.subject])
      ).toEqual(
        enabled
          ? [
              [usage.userEmail, 'es', 'usage-threshold'],
              [usage.userEmail, 'es', 'free-tier-upgrade'],
            ]
          : []
      )
    }
  )
})
