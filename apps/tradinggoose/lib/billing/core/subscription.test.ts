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
  mockFinancialWrite,
  mockSelectEffectiveSubscription,
  mockToBillingTierSummary,
} = vi.hoisted(() => ({
  mockAnd: vi.fn(),
  mockDb: {
    select: vi.fn(),
    insert: vi.fn(),
    transaction: vi.fn(),
  },
  mockEq: vi.fn(),
  mockRequireDefaultBillingTier: vi.fn(),
  mockGetResolvedBillingSettings: vi.fn(),
  mockGetSubscriptionUsageAllowanceUsd: vi.fn(),
  mockHydrateSubscriptionsWithTiers: vi.fn(),
  mockInArray: vi.fn(),
  mockFinancialWrite: vi.fn(() => {
    throw new Error('Subscription readers must not perform financial mutations')
  }),
  mockSelectEffectiveSubscription: vi.fn(),
  mockToBillingTierSummary: vi.fn((tier) => tier ?? { id: null, displayName: 'No plan' }),
}))

vi.mock('@tradinggoose/db', () => ({
  db: mockDb,
}))

vi.mock('@tradinggoose/billing', () => ({
  FinancialPolicyError: Error,
  financialNamespace: mockFinancialWrite,
  lockFinancialRoots: mockFinancialWrite,
  periodKey: mockFinancialWrite,
  readFinancialReceipt: mockFinancialWrite,
}))

vi.mock('@/lib/billing/financial-subscriptions', () => ({
  rotateSubscriptionAfterMutation: mockFinancialWrite,
}))

vi.mock('@tradinggoose/db/schema', () => ({
  member: {},
  subscription: {
    id: 'subscription.id',
    referenceType: 'subscription.referenceType',
    referenceId: 'subscription.referenceId',
    stripeSubscriptionId: 'subscription.stripeSubscriptionId',
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

function createSelectQueryMock(result: unknown, terminal: 'from' | 'limit' | 'where' = 'limit') {
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
    mockGetSubscriptionUsageAllowanceUsd.mockReturnValue('10')
    mockHydrateSubscriptionsWithTiers.mockImplementation(async (rows) => rows)
    mockSelectEffectiveSubscription.mockImplementation((subscriptions) => subscriptions[0] ?? null)
    mockRequireDefaultBillingTier.mockResolvedValue({
      id: 'tier_default',
      isDefault: true,
    })
    mockDb.insert.mockImplementation(() => {
      throw new Error('Subscription readers must not insert subscriptions')
    })
    mockDb.transaction.mockImplementation(() => {
      throw new Error('Subscription readers must not start financial transactions')
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

    expect(minimum).toBe('25')
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
    expect(snapshot.limit).toBeNull()
    expect(snapshot.isExceeded).toBe(false)
    expect(snapshot.currentPeriodCost).toBe('12.5')
  })

  it.each([true, false])(
    'keeps repeated missing-entitlement reads pure when billingEnabled is %s',
    async (billingEnabled) => {
      mockGetResolvedBillingSettings.mockResolvedValue({ billingEnabled })
      mockDb.select.mockImplementation(() => createSelectQueryMock([], 'where'))

      const { getActiveSubscriptionForReference, getEffectiveSubscription } = await import(
        './subscription'
      )

      for (let index = 0; index < 2; index += 1) {
        await expect(getEffectiveSubscription('user_123')).resolves.toBeNull()
        await expect(
          getActiveSubscriptionForReference({ referenceType: 'user', referenceId: 'user_123' })
        ).resolves.toBeNull()
      }
      expect(mockDb.insert).not.toHaveBeenCalled()
      expect(mockDb.transaction).not.toHaveBeenCalled()
      expect(mockRequireDefaultBillingTier).not.toHaveBeenCalled()
      expect(mockFinancialWrite).not.toHaveBeenCalled()
      expect(mockGetResolvedBillingSettings).not.toHaveBeenCalled()
    }
  )

  it('returns the current personal entitlement without replacing its identity', async () => {
    const current = {
      id: 'original_subscription',
      referenceType: 'user',
      referenceId: 'user_123',
      stripeCustomerId: 'original_customer',
      stripeSubscriptionId: 'original_stripe_subscription',
      status: 'active',
      tier: { id: 'tier_default', isDefault: true },
    }
    mockDb.select.mockImplementation(() => createSelectQueryMock([current], 'where'))
    const { getEffectiveSubscription } = await import('./subscription')

    await expect(getEffectiveSubscription('user_123')).resolves.toBe(current)
    expect(current.stripeCustomerId).toBe('original_customer')
    expect(current.stripeSubscriptionId).toBe('original_stripe_subscription')
    expect(mockDb.insert).not.toHaveBeenCalled()
    expect(mockDb.transaction).not.toHaveBeenCalled()
    expect(mockFinancialWrite).not.toHaveBeenCalled()
  })

  it('fails a billed snapshot without repairing missing entitlement', async () => {
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
    expect(mockDb.insert).not.toHaveBeenCalled()
    expect(mockDb.transaction).not.toHaveBeenCalled()
    expect(mockFinancialWrite).not.toHaveBeenCalled()
  })

  it('throws a typed error when a required active subscription is missing', async () => {
    mockDb.select.mockImplementationOnce(() => createSelectQueryMock([], 'where'))

    const { MissingBillingSubscriptionError, requireActiveSubscriptionForReference } = await import(
      './subscription'
    )

    await expect(
      requireActiveSubscriptionForReference({
        referenceType: 'user',
        referenceId: 'user_123',
      })
    ).rejects.toBeInstanceOf(MissingBillingSubscriptionError)
  })

  it('returns the exact local subscription for a Stripe subscription id', async () => {
    const row = {
      id: 'sub_123',
      stripeSubscriptionId: 'stripe_sub_123',
      tier: { id: 'tier_default' },
    }
    mockDb.select.mockImplementationOnce(() => createSelectQueryMock([row], 'limit'))

    const { getSubscriptionByStripeSubscriptionId } = await import('./subscription')

    await expect(getSubscriptionByStripeSubscriptionId('stripe_sub_123')).resolves.toBe(row)
    expect(mockEq).toHaveBeenCalledWith('subscription.stripeSubscriptionId', 'stripe_sub_123')
    expect(mockHydrateSubscriptionsWithTiers).toHaveBeenCalledWith([row])
  })

  it('returns null for an untracked Stripe subscription id', async () => {
    mockDb.select.mockImplementationOnce(() => createSelectQueryMock([], 'limit'))

    const { getSubscriptionByStripeSubscriptionId } = await import('./subscription')

    await expect(getSubscriptionByStripeSubscriptionId('stripe_sub_missing')).resolves.toBe(null)
    expect(mockHydrateSubscriptionsWithTiers).toHaveBeenCalledWith([])
  })
})
