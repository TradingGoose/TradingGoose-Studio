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
    priceId: string
  }> = {}
) {
  return {
    id: overrides.id ?? 'sub_stripe_123',
    customer: 'cus_team',
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
          price: {
            id: overrides.priceId ?? 'price_payg',
            recurring: {},
          },
        },
      ],
    },
  }
}

function createDeletedSubscriptionEvent(stripeSubscription = createDeletedStripeSubscription()) {
  return {
    id: 'evt_deleted',
    created: Date.parse('2026-06-01T00:00:00Z') / 1000,
    data: {
      object: stripeSubscription,
    },
  }
}

function createDefaultSubscription(
  overrides: Partial<{
    id: string
    billingTierId: string | null
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
    billingTierId: overrides.billingTierId ?? 'tier_default',
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
    mockGetSubscriptionByStripeSubscriptionId.mockResolvedValue(null)
    mockRequireStripeClient.mockReturnValue({})
    mockSyncSubscriptionBillingTierFromStripeSubscription.mockResolvedValue(undefined)
    mockSyncSubscriptionUsageLimits.mockResolvedValue(undefined)
    mockResetUserDefaultUsageToOnboardingAllowanceBalance.mockResolvedValue(undefined)
    mockResetUsageForSubscription.mockResolvedValue(undefined)
  })

  it('retries a missing native cancellation before settling and restoring default PAYG', async () => {
    const stripeBackedSubscription = createDefaultSubscription({
      status: 'canceled',
      stripeSubscriptionId: 'sub_stripe_123',
    })
    const defaultSubscription = createDefaultSubscription()
    mockGetSubscriptionByStripeSubscriptionId
      .mockResolvedValueOnce({ ...stripeBackedSubscription, status: 'active' })
      .mockResolvedValueOnce(stripeBackedSubscription)
      .mockResolvedValueOnce(stripeBackedSubscription)
    mockEnsureDefaultUserSubscription.mockResolvedValue(defaultSubscription)

    const { handleStripeSubscriptionDeleted } = await import('./subscription')
    await expect(
      handleStripeSubscriptionDeleted(createDeletedSubscriptionEvent() as any)
    ).rejects.toThrow('has not been saved')
    expect(mockCalculateSubscriptionOverage).not.toHaveBeenCalled()
    expect(mockEnsureDefaultUserSubscription).not.toHaveBeenCalled()
    expect(updateCalls).toEqual([])

    await handleStripeSubscriptionDeleted(createDeletedSubscriptionEvent() as any)

    expect(mockGetSubscriptionByStripeSubscriptionId).toHaveBeenCalledWith('sub_stripe_123')
    expect(mockEq).not.toHaveBeenCalledWith('subscription.id', 'metadata_is_not_identity')
    expect(mockSyncSubscriptionBillingTierFromStripeSubscription).toHaveBeenCalledWith({
      subscriptionId: 'sub_default_user-1',
      stripeSubscription: expect.objectContaining({ id: 'sub_stripe_123' }),
    })
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
    expect(updateCalls).toEqual([
      {
        periodStart: new Date(1778910924 * 1000),
        periodEnd: new Date(1781589324 * 1000),
      },
    ])
  })

  it('skips deleted Stripe subscription events without a local subscription row', async () => {
    const { handleStripeSubscriptionDeleted } = await import('./subscription')
    await handleStripeSubscriptionDeleted(createDeletedSubscriptionEvent() as any)

    expect(mockSyncSubscriptionBillingTierFromStripeSubscription).not.toHaveBeenCalled()
    expect(mockCalculateSubscriptionOverage).not.toHaveBeenCalled()
    expect(mockResetUsageForSubscription).not.toHaveBeenCalled()
    expect(mockEnsureDefaultUserSubscription).not.toHaveBeenCalled()
    expect(mockResetUserDefaultUsageToOnboardingAllowanceBalance).not.toHaveBeenCalled()
    expect(mockSyncSubscriptionUsageLimits).not.toHaveBeenCalled()
    expect(updateCalls).toEqual([])
  })

  it('settles against the signed event tier when the persisted tier is stale', async () => {
    const staleSubscription = createDefaultSubscription({
      id: 'sub_org',
      billingTierId: 'tier_old',
      referenceType: 'organization',
      referenceId: 'org-1',
      status: 'canceled',
      stripeSubscriptionId: 'sub_stripe_123',
      tier: {
        id: 'tier_old',
        isDefault: false,
        ownerType: 'organization',
        displayName: 'Old Team',
      },
    })
    const eventTierSubscription = createDefaultSubscription({
      ...staleSubscription,
      billingTierId: 'tier_new',
      tier: {
        id: 'tier_new',
        isDefault: false,
        ownerType: 'organization',
        displayName: 'New Team',
      },
    })
    mockGetSubscriptionByStripeSubscriptionId
      .mockResolvedValueOnce(staleSubscription)
      .mockResolvedValueOnce(eventTierSubscription)

    const stripeSubscription = createDeletedStripeSubscription({
      metadata: {
        referenceType: 'organization',
        referenceId: 'org-1',
      },
      priceId: 'price_new',
    })
    const { handleStripeSubscriptionDeleted } = await import('./subscription')
    await handleStripeSubscriptionDeleted(createDeletedSubscriptionEvent(stripeSubscription) as any)

    expect(mockSyncSubscriptionBillingTierFromStripeSubscription).toHaveBeenCalledWith({
      subscriptionId: 'sub_org',
      stripeSubscription,
    })
    expect(mockCalculateSubscriptionOverage).toHaveBeenCalledWith(
      expect.objectContaining({
        billingTierId: 'tier_new',
        tier: expect.objectContaining({ id: 'tier_new' }),
      })
    )
    expect(mockResetUsageForSubscription).toHaveBeenCalledWith(
      expect.objectContaining({
        billingTierId: 'tier_new',
        tier: expect.objectContaining({ id: 'tier_new' }),
      })
    )
  })

  it.each([
    { endedAt: new Date('2026-05-01T00:00:00Z'), billingPeriod: '2026-05' },
    { endedAt: null, billingPeriod: '2026-06' },
  ])(
    'retains the $billingPeriod final overage keys on redelivery',
    async ({ endedAt, billingPeriod }) => {
      const sub = {
        ...createDefaultSubscription({
          status: 'canceled',
          referenceType: 'organization',
          stripeSubscriptionId: 'sub_stripe_123',
        }),
        endedAt,
        canceledAt: new Date('2026-04-15T00:00:00Z'),
      }
      mockGetSubscriptionByStripeSubscriptionId.mockResolvedValue(sub)
      mockCalculateSubscriptionOverage.mockResolvedValue(5)
      const invoice = vi.fn().mockResolvedValue({ id: 'in_final', status: 'draft' })
      const invoiceItem = vi.fn()
      mockRequireStripeClient.mockReturnValue({
        invoices: {
          create: invoice,
          finalizeInvoice: vi.fn().mockRejectedValueOnce(new Error('unavailable')),
        },
        invoiceItems: { create: invoiceItem },
      })
      const { handleStripeSubscriptionDeleted } = await import('./subscription')
      const event = createDeletedSubscriptionEvent() as any
      await expect(handleStripeSubscriptionDeleted(event)).rejects.toThrow('unavailable')
      await handleStripeSubscriptionDeleted(event)

      expect(invoice.mock.calls[1]).toEqual(invoice.mock.calls[0])
      expect(invoiceItem.mock.calls[1]).toEqual(invoiceItem.mock.calls[0])
      expect(invoice).toHaveBeenCalledWith(
        expect.objectContaining({
          customer: 'cus_team',
          metadata: expect.objectContaining({
            billingPeriod,
            cancelledAt: String(sub.canceledAt.getTime() / 1000),
          }),
        }),
        { idempotencyKey: `final-overage-invoice:cus_team:sub_stripe_123:${billingPeriod}` }
      )
      expect(invoiceItem).toHaveBeenCalledWith(expect.objectContaining({ amount: 500 }), {
        idempotencyKey: `final-overage-item:cus_team:sub_stripe_123:${billingPeriod}`,
      })
    }
  )

  it('rejects when a matched subscription disappears during deletion settlement', async () => {
    const stripeBackedSubscription = createDefaultSubscription({
      status: 'canceled',
      stripeSubscriptionId: 'sub_stripe_123',
    })
    mockGetSubscriptionByStripeSubscriptionId
      .mockResolvedValueOnce(stripeBackedSubscription)
      .mockResolvedValueOnce(null)

    const { handleStripeSubscriptionDeleted } = await import('./subscription')
    await expect(
      handleStripeSubscriptionDeleted(createDeletedSubscriptionEvent() as any)
    ).rejects.toThrow(
      'Local subscription disappeared while settling deleted Stripe subscription sub_stripe_123'
    )

    expect(mockSyncSubscriptionBillingTierFromStripeSubscription).toHaveBeenCalled()
    expect(mockCalculateSubscriptionOverage).not.toHaveBeenCalled()
    expect(mockEnsureDefaultUserSubscription).not.toHaveBeenCalled()
    expect(mockSyncSubscriptionUsageLimits).not.toHaveBeenCalled()
  })

  it('restores default entitlement even when settlement fails, then rethrows', async () => {
    const stripeBackedSubscription = createDefaultSubscription({
      status: 'canceled',
      stripeSubscriptionId: 'sub_stripe_123',
    })
    const defaultSubscription = createDefaultSubscription()
    mockGetSubscriptionByStripeSubscriptionId
      .mockResolvedValueOnce(stripeBackedSubscription)
      .mockResolvedValueOnce(stripeBackedSubscription)
    mockEnsureDefaultUserSubscription.mockResolvedValue(defaultSubscription)
    mockCalculateSubscriptionOverage.mockRejectedValue(new Error('Stripe invoice failed'))

    const { handleStripeSubscriptionDeleted } = await import('./subscription')
    await expect(
      handleStripeSubscriptionDeleted(createDeletedSubscriptionEvent() as any)
    ).rejects.toThrow('Stripe invoice failed')

    // Leaving the user with no entitled subscription is what breaks every billing read -
    // a failed final invoice must not cost them their default tier.
    expect(mockEnsureDefaultUserSubscription).toHaveBeenCalledWith('user-1', mockDb)
    expect(mockSyncSubscriptionUsageLimits).toHaveBeenCalledWith(defaultSubscription)
  })

  it('skips final settlement when the billing tier sync fails, but still restores entitlement', async () => {
    const stripeBackedSubscription = createDefaultSubscription({
      status: 'canceled',
      stripeSubscriptionId: 'sub_stripe_123',
    })
    const defaultSubscription = createDefaultSubscription()
    mockGetSubscriptionByStripeSubscriptionId
      .mockResolvedValueOnce(stripeBackedSubscription)
      .mockResolvedValueOnce(stripeBackedSubscription)
    mockEnsureDefaultUserSubscription.mockResolvedValue(defaultSubscription)
    mockSyncSubscriptionBillingTierFromStripeSubscription.mockRejectedValue(
      new Error('Stripe subscription sub_stripe_123 matched 0 billing tiers')
    )

    const { handleStripeSubscriptionDeleted } = await import('./subscription')
    await expect(
      handleStripeSubscriptionDeleted(createDeletedSubscriptionEvent() as any)
    ).rejects.toThrow('matched 0 billing tiers')

    // Overage is priced off the tier the sync writes, and the final invoice is created under a
    // fixed idempotency key - billing against an unverified tier would be locked in for good.
    expect(mockCalculateSubscriptionOverage).not.toHaveBeenCalled()
    expect(mockResetUsageForSubscription).not.toHaveBeenCalled()
    // Entitlement still has to come back; that never depended on settlement.
    expect(mockEnsureDefaultUserSubscription).toHaveBeenCalledWith('user-1', mockDb)
    expect(mockSyncSubscriptionUsageLimits).toHaveBeenCalledWith(defaultSubscription)
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
    mockGetSubscriptionByStripeSubscriptionId
      .mockResolvedValueOnce(canceledSubscription)
      .mockResolvedValueOnce(canceledSubscription)
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

  it('preserves personal overage for redelivery when the final period write fails', async () => {
    const stripeBackedSubscription = createDefaultSubscription({
      status: 'canceled',
      stripeSubscriptionId: 'sub_stripe_123',
    })
    mockGetSubscriptionByStripeSubscriptionId.mockResolvedValue(stripeBackedSubscription)
    mockEnsureDefaultUserSubscription.mockResolvedValue(createDefaultSubscription())
    const periodWrite = createUpdateQueryMock()
    periodWrite.where.mockRejectedValueOnce(new Error('Period update failed'))
    mockDb.update.mockReturnValueOnce(periodWrite)
    mockCalculateSubscriptionOverage.mockResolvedValue(8)
    mockGetBilledOverageForSubscription.mockResolvedValue(3)
    const invoiceItem = vi.fn()
    mockRequireStripeClient.mockReturnValue({
      invoices: { create: vi.fn().mockResolvedValue({ id: 'in_final', status: 'open' }) },
      invoiceItems: { create: invoiceItem },
    })

    const { handleStripeSubscriptionDeleted } = await import('./subscription')
    const event = createDeletedSubscriptionEvent() as any
    await expect(handleStripeSubscriptionDeleted(event)).rejects.toThrow('Period update failed')

    expect(mockEnsureDefaultUserSubscription).toHaveBeenCalledWith('user-1', mockDb)
    expect(updateCalls).toContainEqual({ stripeSubscriptionId: 'sub_stripe_123' })
    expect(mockResetUserDefaultUsageToOnboardingAllowanceBalance).not.toHaveBeenCalled()
    expect(mockResetUsageForSubscription).not.toHaveBeenCalled()
    expect(invoiceItem).not.toHaveBeenCalled()

    await handleStripeSubscriptionDeleted(event)
    expect(invoiceItem).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ amount: 500 }), {
      idempotencyKey: 'final-overage-item:cus_team:sub_stripe_123:2026-06',
    })
    expect(mockResetUserDefaultUsageToOnboardingAllowanceBalance).toHaveBeenCalledOnce()
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
    mockGetSubscriptionByStripeSubscriptionId
      .mockResolvedValueOnce(organizationSubscription)
      .mockResolvedValueOnce(organizationSubscription)

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
