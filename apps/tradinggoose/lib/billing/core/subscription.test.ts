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
  mockSql,
  mockSelectEffectiveSubscription,
  mockToBillingTierSummary,
} = vi.hoisted(() => ({
  mockAnd: vi.fn(),
  mockDb: {
    select: vi.fn(),
    insert: vi.fn(),
    update: vi.fn(),
    transaction: vi.fn(),
  },
  mockEq: vi.fn(),
  mockRequireDefaultBillingTier: vi.fn(),
  mockGetResolvedBillingSettings: vi.fn(),
  mockGetSubscriptionUsageAllowanceUsd: vi.fn(),
  mockHydrateSubscriptionsWithTiers: vi.fn(),
  mockInArray: vi.fn(),
  mockSql: vi.fn((strings: TemplateStringsArray, ...values: unknown[]) => ({
    strings,
    values,
    type: 'sql',
  })),
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
  desc: vi.fn(),
  isNotNull: vi.fn(),
  eq: mockEq,
  inArray: mockInArray,
  sql: mockSql,
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

vi.mock('@/lib/billing/core/usage', () => ({
  resetUserDefaultUsageToOnboardingAllowanceBalance: vi.fn(),
}))

vi.mock('@/lib/urls/utils', () => ({
  getBaseUrl: vi.fn(() => 'http://localhost:3000'),
}))

function createSelectQueryMock(
  result: unknown,
  terminal: 'from' | 'limit' | 'where' | 'for' = 'limit'
) {
  const query = {
    from: vi.fn(() => (terminal === 'from' ? Promise.resolve(result) : query)),
    where: vi.fn(() => (terminal === 'where' ? Promise.resolve(result) : query)),
    orderBy: vi.fn(() => query),
    for: vi.fn(async (mode: string) => {
      expect(mode).toBe('update')
      return result
    }),
    limit: vi.fn(() => (terminal === 'for' ? query : Promise.resolve(result))),
  }

  return query
}

describe('subscription billing helpers', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    mockDb.transaction.mockImplementation(async (run) => run(mockDb))
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

  it('captures canceled usage under lock before restoring a separate default subscription', async () => {
    const { resetUserDefaultUsageToOnboardingAllowanceBalance } = await import('./usage')
    const paid = {
      id: 'sub_default_user_123',
      status: 'canceled',
      metadata: { source: 'default-tier' },
    }
    const ledger = { currentPeriodCost: '28', billedOverageThisPeriod: '3' }
    const canceledQuery = createSelectQueryMock([paid], 'for')
    const ledgerQuery = createSelectQueryMock([ledger], 'for')
    const tx = { select: vi.fn(), insert: vi.fn(), update: vi.fn() }
    const save = vi.fn(() => ({ where: vi.fn() }))
    mockGetResolvedBillingSettings.mockResolvedValue({ billingEnabled: true })
    mockDb.select.mockImplementationOnce(() => createSelectQueryMock([], 'where'))
    mockDb.transaction.mockImplementationOnce(async (run) => run(tx))
    tx.select
      .mockImplementationOnce(() => createSelectQueryMock([{ id: 'user_123' }], 'for'))
      .mockImplementationOnce(() => createSelectQueryMock([], 'where'))
      .mockReturnValueOnce(canceledQuery)
      .mockReturnValueOnce(ledgerQuery)
    tx.update.mockImplementation(() => ({ set: save }))
    const insert = vi.fn((values) => ({
      onConflictDoNothing: () => ({ returning: async () => [] }), // original ID belongs to paid
      returning: async () => [values],
    }))
    tx.insert.mockImplementation(() => ({ values: insert }))
    const { getEffectiveSubscription, ensureDefaultUserSubscription } = await import(
      './subscription'
    )
    const active = await getEffectiveSubscription('user_123')
    expect(save).toHaveBeenCalledExactlyOnceWith({
      metadata: { ...paid.metadata, finalUsage: ledger },
    })
    expect(resetUserDefaultUsageToOnboardingAllowanceBalance).toHaveBeenCalledExactlyOnceWith(
      'user_123',
      tx
    )
    expect(canceledQuery.for).toHaveBeenCalledExactlyOnceWith('update')
    expect(ledgerQuery.for).toHaveBeenCalledExactlyOnceWith('update')
    expect(mockDb.update).not.toHaveBeenCalled()
    expect(active?.id).not.toBe(paid.id)
    expect(active).toMatchObject({ status: 'active', tier: { isDefault: true } })
    expect(insert.mock.calls[1][0].stripeSubscriptionId).toBeUndefined()
    expect(mockDb.transaction).toHaveBeenCalledOnce()

    const replacement = { ...active, stripeSubscriptionId: 'sub_replacement' }
    tx.select
      .mockReturnValueOnce(createSelectQueryMock([{ id: 'user_123' }], 'for'))
      .mockReturnValueOnce(createSelectQueryMock([replacement], 'where'))
      .mockReturnValueOnce(
        createSelectQueryMock([{ ...paid, metadata: { finalUsage: ledger } }], 'for')
      )
    mockDb.transaction.mockImplementationOnce(async (run) => run(tx))
    await expect(ensureDefaultUserSubscription('user_123', mockDb as any, paid.id)).resolves.toBe(
      replacement
    )
    expect(tx.update).toHaveBeenCalledTimes(1)
    expect(resetUserDefaultUsageToOnboardingAllowanceBalance).toHaveBeenCalledTimes(1)
  })

  it('keeps an unpaid subscription visible for payment without admitting usage or replacing its ledger', async () => {
    const { getBillingSubscriptionForReference, getEffectiveSubscription } = await import(
      './subscription'
    )
    const { resetUserDefaultUsageToOnboardingAllowanceBalance } = await import('./usage')
    const unpaid = { id: 'paid', status: 'unpaid', stripeSubscriptionId: 'sub_old' }
    mockGetResolvedBillingSettings.mockResolvedValue({ billingEnabled: true })
    const readUnpaid = () =>
      mockDb.select
        .mockReturnValueOnce(createSelectQueryMock([], 'where'))
        .mockReturnValueOnce(createSelectQueryMock([{ id: 'user_123' }], 'for'))
        .mockReturnValueOnce(createSelectQueryMock([], 'where'))
        .mockReturnValueOnce(createSelectQueryMock([unpaid], 'for'))
    readUnpaid()
    await expect(
      getBillingSubscriptionForReference({ referenceType: 'user', referenceId: 'user_123' })
    ).resolves.toBe(unpaid)
    expect(mockInArray).toHaveBeenCalledWith(
      'subscription.status',
      expect.arrayContaining(['unpaid', 'canceled'])
    )
    readUnpaid()
    await expect(getEffectiveSubscription('user_123')).resolves.toBeNull()

    const reactivated = { ...unpaid, status: 'active' }
    mockDb.select.mockReturnValueOnce(createSelectQueryMock([reactivated], 'where'))
    await expect(getEffectiveSubscription('user_123')).resolves.toBe(reactivated)
    expect(mockDb.insert).not.toHaveBeenCalled()
    expect(mockDb.update).not.toHaveBeenCalled()
    expect(resetUserDefaultUsageToOnboardingAllowanceBalance).not.toHaveBeenCalled()
  })

  it('retains the replacement ledger when the canceled personal usage was never captured', async () => {
    const { ensureDefaultUserSubscription } = await import('./subscription')
    const active = { stripeSubscriptionId: 'sub_replacement' }
    mockDb.select
      .mockImplementationOnce(() => createSelectQueryMock([{ id: 'user_123' }], 'for'))
      .mockImplementationOnce(() => createSelectQueryMock([active], 'where'))
      .mockImplementationOnce(() =>
        createSelectQueryMock(
          [{ id: 'paid', status: 'canceled', stripeSubscriptionId: 'sub_old' }],
          'for'
        )
      )
    await expect(ensureDefaultUserSubscription('user_123', mockDb as any, 'paid')).rejects.toThrow(
      'sub_old'
    )
    expect(mockDb.update).not.toHaveBeenCalled()
    expect(mockDb.insert).not.toHaveBeenCalled()
  })

  it('does not restore a subscription when billing is disabled', async () => {
    mockGetResolvedBillingSettings.mockResolvedValue({ billingEnabled: false })
    mockDb.select.mockImplementation(() => createSelectQueryMock([], 'where'))
    mockDb.insert.mockImplementation(() => ({
      values: vi.fn(() => ({ onConflictDoUpdate: vi.fn(() => Promise.resolve()) })),
    }))

    const { getEffectiveSubscription } = await import('./subscription')

    await expect(getEffectiveSubscription('user_123')).resolves.toBeNull()
    expect(mockDb.insert).not.toHaveBeenCalled()
  })

  it('throws when billing is enabled and entitlement cannot be restored', async () => {
    mockGetResolvedBillingSettings.mockResolvedValue({
      billingEnabled: true,
    })
    // Recovery runs, fails to provision a default subscription, and the original billing
    // error surfaces rather than a new one.
    mockDb.insert.mockImplementation(() => ({
      values: vi.fn(() => ({ onConflictDoUpdate: vi.fn(() => Promise.resolve()) })),
    }))
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
    expect(mockHydrateSubscriptionsWithTiers).not.toHaveBeenCalled()
  })

  it('seeds onboarding allowance into user stats on billing-enable backfill', async () => {
    const insertCalls: Array<{
      values: Record<string, unknown>
      conflict: 'update' | 'nothing'
      target: unknown
      set?: Record<string, unknown>
    }> = []
    const selectResults: Array<{
      result: unknown
      terminal: 'from' | 'limit' | 'where' | 'for'
    }> = [
      { result: [{ id: 'user_123' }], terminal: 'from' },
      { result: [], terminal: 'where' },
      { result: [{ id: 'user_123' }], terminal: 'for' },
      { result: [], terminal: 'where' },
      { result: [], terminal: 'for' },
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
          return { returning: async () => [values] }
        }),
      })),
    }))

    const { backfillDefaultUserSubscriptions } = await import('./subscription')
    const createdCount = await backfillDefaultUserSubscriptions()

    expect(createdCount).toBe(1)
    expect(insertCalls).toEqual([
      expect.objectContaining({
        conflict: 'nothing',
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
        conflict: 'update',
        values: expect.objectContaining({
          userId: 'user_123',
          grantedOnboardingAllowanceUsd: '25',
          customUsageLimit: '25',
        }),
        set: expect.objectContaining({
          grantedOnboardingAllowanceUsd: '25',
          customUsageLimit: expect.objectContaining({
            type: 'sql',
            values: [
              'userStats.customUsageLimit',
              'userStats.grantedOnboardingAllowanceUsd',
              '25',
              'userStats.customUsageLimit',
            ],
          }),
        }),
      }),
    ])
  })
})
