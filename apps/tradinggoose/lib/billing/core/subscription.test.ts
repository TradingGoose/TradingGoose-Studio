/**
 * @vitest-environment node
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockAnd,
  mockDb,
  mockEq,
  mockRequireDefaultBillingTier,
  mockGetResolvedBillingSettings,
  mockGetSubscriptionUsageAllowanceUsd,
  mockHydrateSubscriptionsWithTiers,
  mockInArray,
  mockSelectEffectiveSubscription,
  mockToBillingTierSummary,
} = vi.hoisted(() => ({
  mockAnd: vi.fn(),
  mockDb: {
    select: vi.fn(),
    insert: vi.fn(),
  },
  mockEq: vi.fn(),
  mockRequireDefaultBillingTier: vi.fn(),
  mockGetResolvedBillingSettings: vi.fn(),
  mockGetSubscriptionUsageAllowanceUsd: vi.fn(),
  mockHydrateSubscriptionsWithTiers: vi.fn(),
  mockInArray: vi.fn(),
  mockSelectEffectiveSubscription: vi.fn(),
  mockToBillingTierSummary: vi.fn((tier) => tier ?? { id: null, displayName: 'No plan' }),
}))

vi.mock('@tradinggoose/db', () => ({
  db: mockDb,
}))

vi.mock('@tradinggoose/db/schema', () => ({
  member: {},
  subscription: {
    id: 'subscription.id',
    referenceType: 'subscription.referenceType',
    referenceId: 'subscription.referenceId',
    status: 'subscription.status',
  },
  user: {
    id: 'user.id',
  },
  userStats: {
    currentPeriodCost: 'userStats.currentPeriodCost',
    totalCost: 'userStats.totalCost',
    customUsageLimit: 'userStats.customUsageLimit',
    grantedOnboardingAllowanceUsd: 'userStats.grantedOnboardingAllowanceUsd',
    userId: 'userStats.userId',
  },
}))

vi.mock('drizzle-orm', () => ({
  and: mockAnd,
  eq: mockEq,
  inArray: mockInArray,
}))

vi.mock('@/lib/billing/settings', () => ({
  getResolvedBillingSettings: mockGetResolvedBillingSettings,
}))

vi.mock('@/lib/billing/subscriptions/utils', () => ({
  BILLING_ENTITLED_SUBSCRIPTION_STATUSES: ['active', 'trialing'],
}))

vi.mock('@/lib/billing/tiers', () => ({
  getSubscriptionUsageAllowanceUsd: mockGetSubscriptionUsageAllowanceUsd,
  getTierDisplayName: vi.fn(),
  hydrateSubscriptionsWithTiers: mockHydrateSubscriptionsWithTiers,
  requireDefaultBillingTier: mockRequireDefaultBillingTier,
  selectEffectiveSubscription: mockSelectEffectiveSubscription,
  toBillingTierSummary: mockToBillingTierSummary,
}))

vi.mock('@/lib/logs/console/logger', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  }),
}))

vi.mock('@/lib/urls/utils', () => ({
  getBaseUrl: vi.fn(() => 'http://localhost:3000'),
}))

function createSelectQueryMock(
  result: unknown,
  terminal: 'from' | 'limit' | 'where' = 'limit'
) {
  const query = {
    from: vi.fn(() => (terminal === 'from' ? Promise.resolve(result) : query)),
    where: vi.fn(() => (terminal === 'where' ? Promise.resolve(result) : query)),
    limit: vi.fn(() => Promise.resolve(result)),
  }

  return query
}

describe('subscription billing helpers', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    mockGetSubscriptionUsageAllowanceUsd.mockReturnValue(10)
    mockHydrateSubscriptionsWithTiers.mockImplementation(async (rows) => rows)
    mockSelectEffectiveSubscription.mockImplementation((subscriptions) => subscriptions[0] ?? null)
    mockRequireDefaultBillingTier.mockResolvedValue({
      id: 'tier_default',
      isDefault: true,
    })
  })

  it('keeps the default-tier minimum usage limit at least as high as the granted onboarding allowance', async () => {
    const { getSubscribedPersonalUsageMinimumLimit } = await import('./subscription')

    const minimum = getSubscribedPersonalUsageMinimumLimit({
      subscription: {
        tier: {
          isDefault: true,
        },
      } as any,
      grantedOnboardingAllowanceUsd: '25',
    })

    expect(minimum).toBe(25)
    expect(mockGetSubscriptionUsageAllowanceUsd).toHaveBeenCalled()
  })

  it('returns unlimited personal snapshot limits when billing is disabled', async () => {
    mockGetResolvedBillingSettings.mockResolvedValue({
      billingEnabled: false,
    })
    mockDb.select
      .mockImplementationOnce(() => createSelectQueryMock([], 'where'))
      .mockImplementationOnce(() =>
        createSelectQueryMock([
          {
            currentPeriodCost: '12.50',
            totalCost: '20.00',
            customUsageLimit: null,
            grantedOnboardingAllowanceUsd: '5.00',
          },
        ])
      )

    const { getPersonalBillingSnapshot } = await import('./subscription')
    const snapshot = await getPersonalBillingSnapshot('user_123')

    expect(snapshot.subscription).toBeNull()
    expect(snapshot.limit).toBe(Number.MAX_SAFE_INTEGER)
    expect(snapshot.isExceeded).toBe(false)
    expect(snapshot.currentPeriodCost).toBe(12.5)
  })

  it('throws when billing is enabled but no active subscription exists', async () => {
    mockGetResolvedBillingSettings.mockResolvedValue({
      billingEnabled: true,
    })
    mockDb.select
      .mockImplementationOnce(() => createSelectQueryMock([], 'where'))
      .mockImplementationOnce(() =>
        createSelectQueryMock([
          {
            currentPeriodCost: '12.50',
            totalCost: '20.00',
            customUsageLimit: null,
            grantedOnboardingAllowanceUsd: '5.00',
          },
        ])
      )

    const { getPersonalBillingSnapshot } = await import('./subscription')
    await expect(getPersonalBillingSnapshot('user_123')).rejects.toThrow(
      'No active personal subscription found for billed user user_123'
    )
  })

  it('seeds missing user stats on backfill without resetting existing records', async () => {
    const insertCalls: Array<{
      values: Record<string, unknown>
      conflict: 'update' | 'nothing'
      target: unknown
      set?: Record<string, unknown>
    }> = []
    const selectResults: Array<{
      result: unknown
      terminal: 'from' | 'limit' | 'where'
    }> = [
      { result: [{ id: 'user_123' }], terminal: 'from' },
      { result: [], terminal: 'where' },
      { result: [], terminal: 'where' },
      {
        result: [
          {
            id: 'sub_default_user_123',
            referenceType: 'user',
            referenceId: 'user_123',
            status: 'active',
            tier: {
              id: 'tier_default',
              isDefault: true,
            },
          },
        ],
        terminal: 'where',
      },
    ]

    mockGetResolvedBillingSettings.mockResolvedValue({
      onboardingAllowanceUsd: 25,
    })
    mockDb.select.mockImplementation(() => {
      const nextResult = selectResults.shift() ?? { result: [], terminal: 'where' as const }
      return createSelectQueryMock(nextResult.result, nextResult.terminal)
    })
    mockDb.insert.mockImplementation(() => ({
      values: vi.fn((values) => ({
        onConflictDoUpdate: vi.fn(({ target, set }) => {
          insertCalls.push({ values, conflict: 'update', target, set })
          return Promise.resolve()
        }),
        onConflictDoNothing: vi.fn(({ target }) => {
          insertCalls.push({ values, conflict: 'nothing', target })
          return Promise.resolve()
        }),
      })),
    }))

    const { backfillDefaultUserSubscriptions } = await import('./subscription')
    const createdCount = await backfillDefaultUserSubscriptions()

    expect(createdCount).toBe(1)
    expect(insertCalls).toEqual([
      expect.objectContaining({
        conflict: 'update',
        values: expect.objectContaining({
          id: 'sub_default_user_123',
          plan: 'tier_default',
          billingTierId: 'tier_default',
          referenceType: 'user',
          referenceId: 'user_123',
          status: 'active',
        }),
      }),
      expect.objectContaining({
        conflict: 'nothing',
        values: expect.objectContaining({
          userId: 'user_123',
          grantedOnboardingAllowanceUsd: '25',
          customUsageLimit: '25',
        }),
      }),
    ])
    expect(insertCalls[1]).not.toHaveProperty('set')
  })
})
