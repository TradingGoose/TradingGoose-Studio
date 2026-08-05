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
  mockGetSubscriptionByStripeSubscriptionId,
  mockIsPaidBillingTier,
  mockNe,
  mockRequireStripeClient,
  mockResetUsageForSubscription,
  mockResetUserDefaultUsageToOnboardingAllowanceBalance,
  mockSyncSubscriptionBillingTierFromStripeSubscription,
  mockSyncSubscriptionUsageLimits,
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
  mockGetSubscriptionByStripeSubscriptionId: vi.fn(),
  mockIsPaidBillingTier: vi.fn(),
  mockNe: vi.fn((field: unknown, value: unknown) => ({ field, value })),
  mockRequireStripeClient: vi.fn(),
  mockResetUsageForSubscription: vi.fn(),
  mockResetUserDefaultUsageToOnboardingAllowanceBalance: vi.fn(),
  mockSyncSubscriptionBillingTierFromStripeSubscription: vi.fn(),
  mockSyncSubscriptionUsageLimits: vi.fn(),
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
  getSubscriptionByStripeSubscriptionId: mockGetSubscriptionByStripeSubscriptionId,
}))

vi.mock('@/lib/billing/tiers', () => ({
  isPaidBillingTier: mockIsPaidBillingTier,
}))

vi.mock('@/lib/billing/tiers/persistence', () => ({
  syncSubscriptionBillingTierFromStripeSubscription:
    mockSyncSubscriptionBillingTierFromStripeSubscription,
}))

vi.mock('@/lib/billing/organization', () => ({
  syncSubscriptionUsageLimits: mockSyncSubscriptionUsageLimits,
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

function createDeletedStripeSubscription(
  overrides: Partial<{
    id: string
    metadata: Record<string, string>
  }> = {}
) {
  return {
    id: overrides.id ?? 'sub_stripe_123',
    cancel_at_period_end: true,
    metadata: overrides.metadata ?? {
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

function createDeletedSubscriptionEvent(stripeSubscription = createDeletedStripeSubscription()) {
  return {
    id: 'evt_deleted',
    data: {
      object: stripeSubscription,
    },
  }
}

function createDefaultSubscription(
  overrides: Partial<{
    id: string
    metadata: Record<string, unknown>
    referenceId: string
    referenceType: 'user' | 'organization'
    status: string
    stripeSubscriptionId: string | null
    tier: Record<string, unknown>
  }> = {}
) {
  return {
    id: overrides.id ?? 'sub_default_user-1',
    referenceType: overrides.referenceType ?? 'user',
    referenceId: overrides.referenceId ?? 'user-1',
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
        referenceType: 'organization',
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
    mockDb.select.mockImplementation(() => createSelectQueryMock([], 'limit'))
    mockDb.transaction.mockImplementation(async (callback) => callback(mockDb))
    mockDb.update.mockImplementation(() => createUpdateQueryMock())
    mockCalculateSubscriptionOverage.mockResolvedValue(0)
    mockGetBilledOverageForSubscription.mockResolvedValue(0)
    mockGetSubscriptionByStripeSubscriptionId.mockReset().mockResolvedValue(null)
    mockRequireStripeClient.mockReturnValue({})
    mockSyncSubscriptionUsageLimits.mockResolvedValue(undefined)
    mockResetUserDefaultUsageToOnboardingAllowanceBalance.mockResolvedValue(undefined)
    mockResetUsageForSubscription.mockResolvedValue(undefined)
    mockSyncSubscriptionBillingTierFromStripeSubscription.mockResolvedValue(undefined)
  })

  it('settles a deleted Stripe PAYG subscription by Stripe subscription id before restoring default PAYG', async () => {
    const stripeBackedSubscription = createDefaultSubscription({
      status: 'canceled',
      stripeSubscriptionId: 'sub_stripe_123',
    })
    const defaultSubscription = createDefaultSubscription()
    mockGetSubscriptionByStripeSubscriptionId.mockResolvedValue(stripeBackedSubscription)
    mockEnsureDefaultUserSubscription.mockResolvedValue(defaultSubscription)

    const { handleStripeSubscriptionDeleted } = await import('./subscription')
    await handleStripeSubscriptionDeleted(createDeletedSubscriptionEvent() as any)

    expect(mockGetSubscriptionByStripeSubscriptionId).toHaveBeenCalledWith('sub_stripe_123')
    expect(mockEq).not.toHaveBeenCalledWith('subscription.id', 'metadata_is_not_identity')
    expect(mockGetSubscriptionByStripeSubscriptionId).toHaveBeenCalledTimes(2)
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
    expect(mockSyncSubscriptionUsageLimits).toHaveBeenCalledWith(defaultSubscription)
    expect(mockDb.update.mock.invocationCallOrder[0]).toBeLessThan(
      mockCalculateSubscriptionOverage.mock.invocationCallOrder[0]
    )
    expect(mockCalculateSubscriptionOverage.mock.invocationCallOrder[0]).toBeLessThan(
      mockEnsureDefaultUserSubscription.mock.invocationCallOrder[0]
    )
    expect(mockEnsureDefaultUserSubscription.mock.invocationCallOrder[0]).toBeLessThan(
      mockSyncSubscriptionUsageLimits.mock.invocationCallOrder[0]
    )
    expect(updateCalls).toContainEqual(
      expect.objectContaining({
        status: 'canceled',
        stripeSubscriptionId: 'sub_stripe_123',
      })
    )
  })

  it('skips deleted Stripe subscription events without a local subscription row', async () => {
    const { handleStripeSubscriptionDeleted } = await import('./subscription')
    await handleStripeSubscriptionDeleted(createDeletedSubscriptionEvent() as any)

    expect(mockCalculateSubscriptionOverage).not.toHaveBeenCalled()
    expect(mockResetUsageForSubscription).not.toHaveBeenCalled()
    expect(mockEnsureDefaultUserSubscription).not.toHaveBeenCalled()
    expect(mockResetUserDefaultUsageToOnboardingAllowanceBalance).not.toHaveBeenCalled()
    expect(mockSyncSubscriptionUsageLimits).not.toHaveBeenCalled()
    expect(updateCalls).toEqual([])
  })

  it('re-resolves the provider tier before settling a nullable-tier subscription', async () => {
    const stripeBackedSubscription = createDefaultSubscription({
      status: 'canceled',
      stripeSubscriptionId: 'sub_stripe_123',
      tier: undefined,
    })
    stripeBackedSubscription.tier = null as any
    mockGetSubscriptionByStripeSubscriptionId.mockResolvedValue(stripeBackedSubscription)

    const { handleStripeSubscriptionDeleted } = await import('./subscription')
    await handleStripeSubscriptionDeleted(createDeletedSubscriptionEvent() as any)

    expect(mockSyncSubscriptionBillingTierFromStripeSubscription).toHaveBeenCalledWith(
      stripeBackedSubscription.id,
      expect.objectContaining({ id: 'sub_stripe_123' })
    )
    expect(mockGetSubscriptionByStripeSubscriptionId).toHaveBeenCalledTimes(2)
    expect(updateCalls).toContainEqual(
      expect.objectContaining({
        status: 'canceled',
        stripeSubscriptionId: 'sub_stripe_123',
      })
    )
    expect(mockCalculateSubscriptionOverage).not.toHaveBeenCalled()
    expect(mockResetUsageForSubscription).toHaveBeenCalledWith(
      expect.objectContaining({ tier: null, referenceType: 'user' })
    )
    expect(mockEnsureDefaultUserSubscription).toHaveBeenCalled()
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
    mockGetSubscriptionByStripeSubscriptionId.mockResolvedValue(canceledSubscription)
    mockEnsureDefaultUserSubscription.mockResolvedValue(replacementSubscription)

    const { handleStripeSubscriptionDeleted } = await import('./subscription')
    await handleStripeSubscriptionDeleted(createDeletedSubscriptionEvent() as any)

    expect(mockEnsureDefaultUserSubscription).toHaveBeenCalledWith('user-1', mockDb)
    expect(mockResetUserDefaultUsageToOnboardingAllowanceBalance).not.toHaveBeenCalled()
    expect(mockSyncSubscriptionUsageLimits).toHaveBeenCalledWith(replacementSubscription)
    expect(mockCalculateSubscriptionOverage.mock.invocationCallOrder[0]).toBeLessThan(
      mockEnsureDefaultUserSubscription.mock.invocationCallOrder[0]
    )
  })

  it('syncs usage limits for organization members after deleting an organization subscription', async () => {
    const organizationSubscription = createDefaultSubscription({
      id: 'sub_org',
      referenceType: 'organization',
      referenceId: 'org-1',
      status: 'canceled',
      stripeSubscriptionId: 'sub_stripe_123',
      tier: {
        id: 'tier_team',
        isDefault: false,
        ownerType: 'organization',
        displayName: 'Team',
      },
    })
    mockGetSubscriptionByStripeSubscriptionId.mockResolvedValue(organizationSubscription)

    const { handleStripeSubscriptionDeleted } = await import('./subscription')
    await handleStripeSubscriptionDeleted(
      createDeletedSubscriptionEvent(
        createDeletedStripeSubscription({
          metadata: {
            referenceType: 'organization',
            referenceId: 'org-1',
          },
        })
      ) as any
    )

    expect(mockEnsureDefaultUserSubscription).not.toHaveBeenCalled()
    expect(mockGetSubscriptionByStripeSubscriptionId).toHaveBeenCalledWith('sub_stripe_123')
    expect(mockResetUserDefaultUsageToOnboardingAllowanceBalance).not.toHaveBeenCalled()
    expect(mockSyncSubscriptionUsageLimits).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'sub_org',
        referenceType: 'organization',
        referenceId: 'org-1',
        status: 'canceled',
      })
    )
  })
})
