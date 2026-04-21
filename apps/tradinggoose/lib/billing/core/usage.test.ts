/**
 * @vitest-environment node
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockDb, mockEq } = vi.hoisted(() => ({
  mockDb: {
    select: vi.fn(),
    update: vi.fn(),
  },
  mockEq: vi.fn((field: unknown, value: unknown) => ({ field, value })),
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
  getResolvedBillingSettings: vi.fn(),
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

  it('consumes granted onboarding allowance from current free-period usage', async () => {
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
        customUsageLimit: '12.5',
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
        customUsageLimit: '0',
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

    expect(updateValues).toEqual([
      {
        billedOverageThisPeriod: '0',
        currentPeriodCopilotCost: '0',
        currentPeriodCost: '0',
        grantedOnboardingAllowanceUsd: '12.5',
        customUsageLimit: '12.5',
      },
    ])
  })

  it('resets custom usage limit from remaining granted onboarding allowance', async () => {
    statsRows = [
      {
        grantedOnboardingAllowanceUsd: '7.00',
      },
    ]

    const { resetUserCustomUsageLimitToGrantedOnboardingAllowance } = await import('./usage')

    await resetUserCustomUsageLimitToGrantedOnboardingAllowance('user-1')

    expect(updateValues).toEqual([
      {
        customUsageLimit: '7',
        customUsageLimitUpdatedAt: expect.any(Date),
      },
    ])
  })
})
