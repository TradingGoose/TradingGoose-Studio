/**
 * @vitest-environment node
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockAnd,
  mockCalculateSubscriptionOverage,
  mockDb,
  mockDecrementGrantedOnboardingAllowanceByCurrentPeriodUsage,
  mockEnsureDefaultUserSubscription,
  mockEq,
  mockGetBilledOverageForSubscription,
  mockGetResolvedBillingSettings,
  mockHydrateSubscriptionsWithTiers,
  mockIsPaidBillingTier,
  mockNe,
  mockRequireStripeClient,
  mockResetUsageForSubscription,
  mockResetUserDefaultUsageToOnboardingAllowanceBalance,
  mockSyncSubscriptionBillingTierFromStripeSubscription,
} = vi.hoisted(() => ({
  mockAnd: vi.fn(),
  mockCalculateSubscriptionOverage: vi.fn(),
  mockDb: {
    select: vi.fn(),
    transaction: vi.fn(),
    update: vi.fn(),
  },
  mockDecrementGrantedOnboardingAllowanceByCurrentPeriodUsage: vi.fn(),
  mockEnsureDefaultUserSubscription: vi.fn(),
  mockEq: vi.fn((field: unknown, value: unknown) => ({ field, value })),
  mockGetBilledOverageForSubscription: vi.fn(),
  mockGetResolvedBillingSettings: vi.fn(),
  mockHydrateSubscriptionsWithTiers: vi.fn(async (rows) => rows),
  mockIsPaidBillingTier: vi.fn(),
  mockNe: vi.fn((field: unknown, value: unknown) => ({ field, value })),
  mockRequireStripeClient: vi.fn(),
  mockResetUsageForSubscription: vi.fn(),
  mockResetUserDefaultUsageToOnboardingAllowanceBalance: vi.fn(),
  mockSyncSubscriptionBillingTierFromStripeSubscription: vi.fn(),
}))

let otherActiveSubscriptions: Array<Record<string, unknown>> = []
let updateCalls: Array<Record<string, unknown>> = []

vi.mock('@tradinggoose/db', () => ({
  db: mockDb,
}))

vi.mock('@tradinggoose/db/schema', () => ({
  subscription: {
    referenceType: 'subscription.referenceType',
    referenceId: 'subscription.referenceId',
    stripeSubscriptionId: 'subscription.stripeSubscriptionId',
    status: 'subscription.status',
    id: 'subscription.id',
  },
}))

vi.mock('drizzle-orm', () => ({
  and: mockAnd,
  eq: mockEq,
  ne: mockNe,
}))

vi.mock('@/lib/billing/core/usage', () => ({
  decrementGrantedOnboardingAllowanceByCurrentPeriodUsage:
    mockDecrementGrantedOnboardingAllowanceByCurrentPeriodUsage,
  resetUserDefaultUsageToOnboardingAllowanceBalance:
    mockResetUserDefaultUsageToOnboardingAllowanceBalance,
}))

vi.mock('@/lib/billing/core/subscription', () => ({
  ensureDefaultUserSubscription: mockEnsureDefaultUserSubscription,
}))

vi.mock('@/lib/billing/settings', () => ({
  getResolvedBillingSettings: mockGetResolvedBillingSettings,
}))

vi.mock('@/lib/billing/tiers', () => ({
  hydrateSubscriptionsWithTiers: mockHydrateSubscriptionsWithTiers,
  isPaidBillingTier: mockIsPaidBillingTier,
}))

vi.mock('@/lib/billing/tiers/persistence', () => ({
  syncSubscriptionBillingTierFromStripeSubscription:
    mockSyncSubscriptionBillingTierFromStripeSubscription,
}))

vi.mock('@/lib/billing/webhooks/invoices', () => ({
  getBilledOverageForSubscription: mockGetBilledOverageForSubscription,
  resetUsageForSubscription: mockResetUsageForSubscription,
}))

vi.mock('@/lib/billing/core/billing', () => ({
  calculateSubscriptionOverage: mockCalculateSubscriptionOverage,
}))

vi.mock('@/lib/billing/stripe-client', () => ({
  requireStripeClient: mockRequireStripeClient,
}))

vi.mock('@/lib/logs/console/logger', () => ({
  createLogger: () => ({
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  }),
}))

function createSelectQueryMock(result: unknown, terminal: 'where' | 'limit' = 'where') {
  const query = {
    from: vi.fn(() => query),
    where: vi.fn(() => (terminal === 'where' ? Promise.resolve(result) : query)),
    limit: vi.fn(() => Promise.resolve(result)),
  }

  return query
}

function createUpdateQueryMock() {
  const query = {
    set: vi.fn((values: Record<string, unknown>) => {
      updateCalls.push(values)
      return query
    }),
    where: vi.fn(() => Promise.resolve()),
  }

  return query
}

function createDeletedStripeSubscription() {
  return {
    id: 'sub_stripe_123',
    cancel_at_period_end: true,
    metadata: {
      referenceId: 'user-1',
      subscriptionId: 'metadata_is_not_identity',
      userId: 'user-1',
    },
    items: {
      data: [
        {
          current_period_start: 1778910924,
          current_period_end: 1781589324,
        },
      ],
    },
  }
}

function createDeletedSubscriptionEvent() {
  return {
    id: 'evt_deleted',
    data: {
      object: createDeletedStripeSubscription(),
    },
  }
}

function createDefaultSubscription(
  overrides: Partial<{
    id: string
    metadata: Record<string, unknown>
    status: string
    stripeSubscriptionId: string | null
    tier: Record<string, unknown>
  }> = {}
) {
  return {
    id: overrides.id ?? 'sub_default_user-1',
    referenceType: 'user',
    referenceId: 'user-1',
    status: overrides.status ?? 'active',
    stripeSubscriptionId: overrides.stripeSubscriptionId ?? null,
    metadata: overrides.metadata ?? { source: 'default-tier' },
    tier: overrides.tier ?? {
      id: 'tier_default',
      isDefault: true,
      displayName: 'Pay As You Go',
    },
  }
}

describe('handleSubscriptionCreated', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()

    updateCalls = []
    otherActiveSubscriptions = []
    mockDb.select.mockImplementation(() => createSelectQueryMock(otherActiveSubscriptions))
    mockDb.transaction.mockImplementation(async (callback) => callback(mockDb))
    mockDb.update.mockImplementation(() => createUpdateQueryMock())
    mockCalculateSubscriptionOverage.mockResolvedValue(0)
    mockGetBilledOverageForSubscription.mockResolvedValue(0)
    mockGetResolvedBillingSettings.mockResolvedValue({ billingEnabled: true })
    mockRequireStripeClient.mockReturnValue({})
    mockIsPaidBillingTier.mockReturnValue(false)
  })

  it('consumes onboarding allowance inline for a personal free/default -> subscribed transition', async () => {
    const { handleSubscriptionCreated } = await import('./subscription')

    await handleSubscriptionCreated({
      id: 'sub_1',
      referenceType: 'user',
      referenceId: 'user-1',
      status: 'active',
      tier: {
        displayName: 'Pay As You Go',
      } as any,
    })

    expect(mockDecrementGrantedOnboardingAllowanceByCurrentPeriodUsage).toHaveBeenCalled()
    expect(mockResetUsageForSubscription).not.toHaveBeenCalled()
  })

  it('does not consume onboarding allowance for organization subscriptions', async () => {
    mockIsPaidBillingTier.mockReturnValue(true)

    const { handleSubscriptionCreated } = await import('./subscription')

    await handleSubscriptionCreated({
      id: 'sub_1',
      referenceType: 'organization',
      referenceId: 'org-1',
      status: 'active',
      tier: {
        displayName: 'Team',
      } as any,
    })

    expect(mockDecrementGrantedOnboardingAllowanceByCurrentPeriodUsage).not.toHaveBeenCalled()
    expect(mockResetUsageForSubscription).toHaveBeenCalledWith(
      {
        referenceId: 'org-1',
        tier: expect.objectContaining({ displayName: 'Team' }),
      },
      mockDb
    )
  })

  it('does nothing when the user was not previously on the free/default path', async () => {
    otherActiveSubscriptions = [{ id: 'sub_existing' }]

    const { handleSubscriptionCreated } = await import('./subscription')

    await handleSubscriptionCreated({
      id: 'sub_1',
      referenceType: 'user',
      referenceId: 'user-1',
      status: 'active',
      tier: {
        displayName: 'Pay As You Go',
      } as any,
    })

    expect(mockDecrementGrantedOnboardingAllowanceByCurrentPeriodUsage).not.toHaveBeenCalled()
    expect(mockResetUsageForSubscription).not.toHaveBeenCalled()
  })
})

describe('handleStripeSubscriptionDeleted', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()

    updateCalls = []
    mockDb.select.mockImplementation(() => createSelectQueryMock([]))
    mockDb.transaction.mockImplementation(async (callback) => callback(mockDb))
    mockDb.update.mockImplementation(() => createUpdateQueryMock())
    mockCalculateSubscriptionOverage.mockResolvedValue(0)
    mockGetBilledOverageForSubscription.mockResolvedValue(0)
    mockGetResolvedBillingSettings.mockResolvedValue({ billingEnabled: true })
    mockHydrateSubscriptionsWithTiers.mockImplementation(async (rows) => rows)
    mockRequireStripeClient.mockReturnValue({})
    mockSyncSubscriptionBillingTierFromStripeSubscription.mockResolvedValue(undefined)
    mockResetUserDefaultUsageToOnboardingAllowanceBalance.mockResolvedValue(undefined)
    mockResetUsageForSubscription.mockResolvedValue(undefined)
  })

  it('settles a deleted Stripe PAYG subscription by Stripe subscription id before restoring default PAYG', async () => {
    const stripeBackedSubscription = createDefaultSubscription({
      status: 'canceled',
      stripeSubscriptionId: 'sub_stripe_123',
    })
    const defaultSubscription = createDefaultSubscription()
    mockDb.select
      .mockImplementationOnce(() => createSelectQueryMock([stripeBackedSubscription], 'limit'))
      .mockImplementationOnce(() => createSelectQueryMock([stripeBackedSubscription], 'limit'))
    mockEnsureDefaultUserSubscription.mockResolvedValue(defaultSubscription)

    const { handleStripeSubscriptionDeleted } = await import('./subscription')
    await handleStripeSubscriptionDeleted(createDeletedSubscriptionEvent() as any)

    expect(mockEq).toHaveBeenCalledWith('subscription.stripeSubscriptionId', 'sub_stripe_123')
    expect(mockEq).not.toHaveBeenCalledWith('subscription.id', 'metadata_is_not_identity')
    expect(mockSyncSubscriptionBillingTierFromStripeSubscription).toHaveBeenCalledWith(
      'sub_default_user-1',
      expect.objectContaining({ id: 'sub_stripe_123' })
    )
    expect(mockCalculateSubscriptionOverage).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'sub_default_user-1',
        referenceId: 'user-1',
        status: 'canceled',
        stripeSubscriptionId: 'sub_stripe_123',
      })
    )
    expect(mockEnsureDefaultUserSubscription).toHaveBeenCalledWith('user-1', mockDb)
    expect(mockResetUserDefaultUsageToOnboardingAllowanceBalance).toHaveBeenCalledWith(
      'user-1',
      mockDb
    )
    expect(mockCalculateSubscriptionOverage.mock.invocationCallOrder[0]).toBeLessThan(
      mockEnsureDefaultUserSubscription.mock.invocationCallOrder[0]
    )
    expect(updateCalls).toContainEqual(
      expect.objectContaining({
        status: 'canceled',
        stripeSubscriptionId: 'sub_stripe_123',
      })
    )
  })

  it('does not reset onboarding usage when another personal subscription remains entitled', async () => {
    const canceledSubscription = createDefaultSubscription({
      status: 'canceled',
      stripeSubscriptionId: 'sub_stripe_123',
    })
    const replacementSubscription = createDefaultSubscription({
      id: 'sub_replacement',
      stripeSubscriptionId: 'sub_stripe_replacement',
      tier: {
        id: 'tier_pro',
        isDefault: false,
        displayName: 'Pro',
      },
    })
    mockDb.select
      .mockImplementationOnce(() => createSelectQueryMock([canceledSubscription], 'limit'))
      .mockImplementationOnce(() => createSelectQueryMock([canceledSubscription], 'limit'))
    mockEnsureDefaultUserSubscription.mockResolvedValue(replacementSubscription)

    const { handleStripeSubscriptionDeleted } = await import('./subscription')
    await handleStripeSubscriptionDeleted(createDeletedSubscriptionEvent() as any)

    expect(mockEnsureDefaultUserSubscription).toHaveBeenCalledWith('user-1', mockDb)
    expect(mockResetUserDefaultUsageToOnboardingAllowanceBalance).not.toHaveBeenCalled()
    expect(mockCalculateSubscriptionOverage.mock.invocationCallOrder[0]).toBeLessThan(
      mockEnsureDefaultUserSubscription.mock.invocationCallOrder[0]
    )
  })
})
