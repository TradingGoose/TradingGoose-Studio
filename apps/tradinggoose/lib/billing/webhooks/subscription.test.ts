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
  sql: (_: unknown, _column: unknown, data: string) => ({ merge: JSON.parse(data) }),
  eq: mockEq,
  ne: mockNe,
}))

vi.mock('@/lib/billing/core/usage', () => ({
  decrementGrantedOnboardingAllowanceByCurrentPeriodUsage:
    mockDecrementGrantedOnboardingAllowanceByCurrentPeriodUsage,
}))

vi.mock('@/lib/billing/core/subscription', () => ({
  ensureDefaultUserSubscription: mockEnsureDefaultUserSubscription,
  getSubscriptionByStripeSubscriptionId: mockGetSubscriptionByStripeSubscriptionId,
}))

vi.mock('@/lib/billing/tiers', () => ({
  isPaidBillingTier: mockIsPaidBillingTier,
  hydrateSubscriptionsWithTiers: async (rows: unknown[]) => rows,
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
    mockDb.select.mockImplementation(() => ({
      from: () => ({ where: async () => otherActiveSubscriptions }),
    }))
    mockDb.transaction.mockImplementation(async (callback) => callback(mockDb))
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
  const event = createDeletedSubscriptionEvent() as any
  let sub = createDefaultSubscription()
  const draft = { id: 'in_final', status: 'draft', lines: { data: [] } }
  const invoice = vi.fn()
  const invoiceItem = vi.fn()
  const retrieve = vi.fn()
  const finalize = vi.fn()

  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    sub = createDefaultSubscription({ status: 'canceled', stripeSubscriptionId: 'sub_stripe_123' })
    mockGetSubscriptionByStripeSubscriptionId.mockImplementation(async () => ({ ...sub }))
    mockDb.transaction.mockImplementation(async (run) => run(mockDb))
    mockDb.select.mockImplementation(() => ({
      from: () => ({ where: () => ({ for: async () => [{ ...sub }] }) }),
    }))
    mockDb.update.mockImplementation(() => ({
      set: (values: { metadata: Record<string, any> }) => ({
        where: async () => {
          updateCalls.push(values)
          sub.metadata = values.metadata.merge
            ? { ...sub.metadata, ...values.metadata.merge }
            : values.metadata
        },
      }),
    }))
    updateCalls = []
    mockEnsureDefaultUserSubscription.mockImplementation(async () => {
      sub.metadata.finalUsage ??= { currentPeriodCost: '28', billedOverageThisPeriod: '3' }
      return createDefaultSubscription()
    })
    mockCalculateSubscriptionOverage.mockImplementation(async (_sub, _tx, usage) => usage - 20)
    mockGetBilledOverageForSubscription.mockResolvedValue(0)
    mockSyncSubscriptionBillingTierFromStripeSubscription.mockResolvedValue(undefined)
    mockRequireStripeClient.mockReturnValue({
      invoices: { create: invoice, retrieve, finalizeInvoice: finalize },
      invoiceItems: { create: invoiceItem },
    })
    invoice.mockResolvedValue(draft)
    retrieve.mockResolvedValue(draft)
    finalize.mockResolvedValue({})
  })

  it('requires the native canceled status, ignores unknown subscriptions, and only uses the signed subscription identity', async () => {
    const { handleStripeSubscriptionDeleted } = await import('./subscription')
    mockGetSubscriptionByStripeSubscriptionId.mockResolvedValueOnce(null)
    await handleStripeSubscriptionDeleted(event)
    sub.status = 'active'
    await expect(handleStripeSubscriptionDeleted(event)).rejects.toThrow('has not been saved')
    expect(mockEnsureDefaultUserSubscription).not.toHaveBeenCalled()
    expect(mockGetSubscriptionByStripeSubscriptionId).toHaveBeenCalledWith('sub_stripe_123')
    expect(mockCalculateSubscriptionOverage).not.toHaveBeenCalled()
  })

  it.each([
    [new Date('2026-05-01T00:00:00Z'), '2026-05'],
    [null, '2026-06'],
  ])(
    'retains the paid allowance, item and period across a failed invoice and later default usage (%s)',
    async (endedAt, period) => {
      Object.assign(sub, { endedAt, canceledAt: new Date('2026-04-15T00:00:00Z') })
      const { handleStripeSubscriptionDeleted } = await import('./subscription')
      invoiceItem.mockRejectedValueOnce(new Error('Stripe unavailable'))
      await expect(handleStripeSubscriptionDeleted(event)).rejects.toThrow('Stripe unavailable')
      expect(mockEnsureDefaultUserSubscription).toHaveBeenCalledWith('user-1', mockDb, sub.id)
      expect(mockSyncSubscriptionUsageLimits).toHaveBeenCalledWith(
        expect.objectContaining({ stripeSubscriptionId: null })
      )
      expect(mockCalculateSubscriptionOverage).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'canceled' }),
        mockDb,
        28
      )
      expect(mockGetBilledOverageForSubscription).not.toHaveBeenCalled()
      expect(updateCalls[0]).toMatchObject({
        periodStart: new Date(1778910924 * 1000),
        periodEnd: new Date(1781589324 * 1000),
        metadata: { finalInvoice: { totalOverage: 8, billedOverage: 3 } },
      })
      mockCalculateSubscriptionOverage.mockResolvedValue(100)
      await handleStripeSubscriptionDeleted(event)
      await handleStripeSubscriptionDeleted(event)
      expect(invoice).toHaveBeenCalledExactlyOnceWith(
        expect.objectContaining({
          auto_advance: false,
          metadata: expect.objectContaining({ billingPeriod: period }),
        }),
        { idempotencyKey: `final-overage-invoice:cus_team:sub_stripe_123:${period}` }
      )
      expect(invoiceItem.mock.calls[0]).toEqual(invoiceItem.mock.calls[1])
      expect(invoiceItem).toHaveBeenCalledWith(
        expect.objectContaining({ amount: 500, invoice: 'in_final' }),
        {
          idempotencyKey: `final-overage-item:cus_team:sub_stripe_123:${period}`,
        }
      )
      expect(retrieve).toHaveBeenCalledExactlyOnceWith('in_final')
      expect(finalize).toHaveBeenCalledOnce()
      expect(mockCalculateSubscriptionOverage).toHaveBeenCalledOnce()
    }
  )

  it('retries the final period write using captured paid usage after the default period opens', async () => {
    mockDb.update.mockReturnValueOnce({
      set: () => ({
        where: async () => {
          throw new Error('Period update failed')
        },
      }),
    })
    const { handleStripeSubscriptionDeleted } = await import('./subscription')
    await expect(handleStripeSubscriptionDeleted(event)).rejects.toThrow('Period update failed')
    expect(mockEnsureDefaultUserSubscription).toHaveBeenCalled()
    expect(sub.metadata).toMatchObject({
      finalUsage: { currentPeriodCost: '28', billedOverageThisPeriod: '3' },
    })
    expect(invoice).not.toHaveBeenCalled()
    await handleStripeSubscriptionDeleted(event)
    expect(invoiceItem).toHaveBeenCalledWith(
      expect.objectContaining({ amount: 500 }),
      expect.anything()
    )
  })

  it('does not add another line when the saved Stripe draft already contains the final overage', async () => {
    const { handleStripeSubscriptionDeleted } = await import('./subscription')
    finalize.mockRejectedValueOnce(new Error('timeout'))
    await expect(handleStripeSubscriptionDeleted(event)).rejects.toThrow('timeout')
    retrieve.mockResolvedValueOnce({
      ...draft,
      lines: { data: [{ metadata: { type: 'final_usage_overage' } }] },
    })
    await handleStripeSubscriptionDeleted(event)
    expect(invoiceItem).toHaveBeenCalledOnce()
    expect(finalize).toHaveBeenCalledTimes(2)
  })

  it('restores personal access before failed tier sync, and prices only against the subsequently verified tier', async () => {
    mockSyncSubscriptionBillingTierFromStripeSubscription
      .mockRejectedValueOnce(new Error('unknown Stripe price'))
      .mockImplementationOnce(async () => {
        sub.tier = { id: 'tier_pro', displayName: 'Pro' }
      })
    const { handleStripeSubscriptionDeleted } = await import('./subscription')
    await expect(handleStripeSubscriptionDeleted(event)).rejects.toThrow('unknown Stripe price')
    expect(mockEnsureDefaultUserSubscription).toHaveBeenCalledOnce()
    expect(mockCalculateSubscriptionOverage).not.toHaveBeenCalled()
    await handleStripeSubscriptionDeleted(event)
    expect(mockCalculateSubscriptionOverage).toHaveBeenCalledWith(
      expect.objectContaining({ tier: { id: 'tier_pro', displayName: 'Pro' } }),
      mockDb,
      28
    )
  })

  it('keeps organization pricing and scope when settling and synchronizing usage limits', async () => {
    sub = createDefaultSubscription({
      id: 'sub_org',
      referenceType: 'organization',
      status: 'canceled',
      stripeSubscriptionId: 'sub_stripe_123',
    })
    mockCalculateSubscriptionOverage.mockResolvedValue(0)
    const { handleStripeSubscriptionDeleted } = await import('./subscription')
    mockSyncSubscriptionUsageLimits.mockRejectedValueOnce(new Error('Usage limit sync failed'))
    await expect(handleStripeSubscriptionDeleted(event)).rejects.toThrow('Usage limit sync failed')
    await handleStripeSubscriptionDeleted(event)
    expect(mockSyncSubscriptionUsageLimits).toHaveBeenCalledTimes(2)
    expect(mockEnsureDefaultUserSubscription).not.toHaveBeenCalled()
    expect(mockResetUsageForSubscription).toHaveBeenCalledOnce()
    expect(mockSyncSubscriptionUsageLimits).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'sub_org' })
    )
    expect(invoice).not.toHaveBeenCalled()
  })
})

describe('invoice events delivered after cancellation', () => {
  it.each([
    { status: 'canceled', metadata: null },
    { status: 'active', metadata: { finalUsage: { currentPeriodCost: '12' } } },
    { status: 'active', metadata: { finalInvoice: { totalOverage: 12 } } },
  ])('keeps the replacement ledger intact for %j', async (closed) => {
    vi.clearAllMocks()
    mockGetSubscriptionByStripeSubscriptionId.mockResolvedValue(closed)
    const handlers = await vi.importActual<typeof import('./invoices')>('./invoices')
    const event = {
      data: {
        object: {
          parent: { subscription_details: { subscription: 'sub_closed' } },
          customer: 'cus_owner',
          billing_reason: 'subscription_cycle',
          attempt_count: 1,
        },
      },
    } as any
    await handlers.handleInvoiceFinalized(event)
    await handlers.handleInvoicePaymentSucceeded(event)
    await handlers.handleInvoicePaymentFailed(event)
    expect(mockGetSubscriptionByStripeSubscriptionId.mock.calls).toEqual([
      ['sub_closed'],
      ['sub_closed'],
      ['sub_closed'],
    ])
    expect(mockDb.select).not.toHaveBeenCalled()
    expect(mockDb.update).not.toHaveBeenCalled()
    expect(mockRequireStripeClient).not.toHaveBeenCalled()
  })
})
