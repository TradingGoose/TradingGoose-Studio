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
  mockLedgerOwnerQuery,
  mockSql,
  mockSelectEffectiveSubscription,
  mockToBillingTierSummary,
} = vi.hoisted(() => ({
  mockAnd: vi.fn(),
  mockDb: createBillingDbMock(),
  mockLedgerOwnerQuery: vi.fn(),
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
    billingTierId: 'subscription.billingTierId',
    id: 'subscription.id',
    endedAt: 'subscription.endedAt',
    canceledAt: 'subscription.canceledAt',
    periodEnd: 'subscription.periodEnd',
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
  not: vi.fn((condition) => ({ not: condition })),
  or: vi.fn((...conditions) => ({ or: conditions })),
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

function createBillingDbMock() {
  const queries = vi.fn()
  return {
    select: (fields?: { id?: string }) =>
      fields?.id === 'subscription.id' ? mockLedgerOwnerQuery() : queries(fields),
    queries,
    insert: vi.fn(),
    update: vi.fn(),
    transaction: vi.fn(),
  }
}

function createSelectQueryMock(
  result: unknown,
  terminal: 'from' | 'limit' | 'where' | 'for' = 'limit'
) {
  const query = {
    from: vi.fn(() => (terminal === 'from' ? Promise.resolve(result) : query)),
    where: vi.fn(() => (terminal === 'where' ? Promise.resolve(result) : query)),
    orderBy: vi.fn((..._columns: unknown[]) => query),
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
    mockLedgerOwnerQuery.mockImplementation(() => createSelectQueryMock([], 'for'))
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
    mockDb.queries
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

  it('completes entitlement repair before reading usage from the new billing period', async () => {
    const { getPersonalBillingSnapshot } = await import('./subscription')
    const { resetUserDefaultUsageToOnboardingAllowanceBalance } = await import('./usage')
    const ledger = { currentPeriodCost: '28', grantedOnboardingAllowanceUsd: '10' }
    const active = { id: 'default', tier: { isDefault: true } }
    const tx = createBillingDbMock()
    mockGetResolvedBillingSettings.mockResolvedValue({ billingEnabled: true })
    mockDb.transaction.mockImplementation((run) => run(tx))
    tx.queries
      .mockReturnValueOnce(createSelectQueryMock([], 'where')) // first snapshot
      .mockReturnValueOnce(createSelectQueryMock([{ id: 'user_123' }], 'for'))
      .mockReturnValueOnce(createSelectQueryMock([], 'where'))
      .mockReturnValueOnce(createSelectQueryMock([{ id: 'old', status: 'canceled' }], 'for'))
      .mockReturnValueOnce(createSelectQueryMock([ledger], 'for'))
      .mockReturnValueOnce(createSelectQueryMock([active], 'where')) // post-repair snapshot
      .mockImplementationOnce(() => createSelectQueryMock([{ ...ledger }]))
    mockDb.queries.mockReturnValueOnce(createSelectQueryMock([], 'where'))
    tx.update.mockReturnValue({ set: () => ({ where: vi.fn() }) })
    tx.insert.mockReturnValue({
      values: () => ({ onConflictDoNothing: () => ({ returning: async () => [active] }) }),
    })
    vi.mocked(resetUserDefaultUsageToOnboardingAllowanceBalance).mockImplementationOnce(
      async () => {
        ledger.currentPeriodCost = '0'
      }
    )
    const snapshot = await getPersonalBillingSnapshot('user_123')
    expect(snapshot).toMatchObject({
      currentPeriodCost: 0,
      limit: 10,
      isExceeded: false,
      subscription: active,
    })
    const readOnly = { isolationLevel: 'repeatable read', accessMode: 'read only' }
    expect(mockDb.transaction.mock.calls.map((args) => args[1])).toEqual([
      readOnly,
      undefined,
      readOnly,
    ])
  })

  it('preserves default-period usage on later reads and repairs with older canceled rows', async () => {
    const { resetUserDefaultUsageToOnboardingAllowanceBalance: reset } = await import('./usage')
    const { ensureDefaultUserSubscription, getEffectiveSubscription } = await import(
      './subscription'
    )
    const paid = {
      id: 'sub_default_user_123',
      status: 'canceled',
      endedAt: new Date('2026-11-10'),
      canceledAt: new Date('2026-11-09'),
      periodEnd: new Date('2026-11-15'),
      metadata: { source: 'default-tier' } as Record<string, unknown>,
    }
    const older = {
      ...paid,
      id: 'older',
      endedAt: null,
      canceledAt: null,
      periodEnd: new Date('2027-10-10'),
      metadata: {},
    }
    const history = [older, paid]
    const ledger = { currentPeriodCost: '28', billedOverageThisPeriod: '3' }
    const owner = {
      from: () => owner,
      where: vi.fn((_predicate: unknown) => owner),
      orderBy: vi.fn((..._columns: unknown[]) => owner),
      limit: vi.fn((_limit: number) => history[0].id),
    }
    owner.orderBy.mockImplementation((_, order, tiebreaker) => {
      expect(order).toMatchObject({
        strings: ['coalesce(', ', ', ') desc nulls last'],
        values: ['subscription.endedAt', 'subscription.canceledAt'],
      })
      expect(tiebreaker).toMatchObject({
        strings: ['', ' desc nulls last'],
        values: ['subscription.periodEnd'],
      })
      history.sort((a, b) => +(b.endedAt ?? b.canceledAt ?? 0) - +(a.endedAt ?? a.canceledAt ?? 0))
      return owner
    })
    mockLedgerOwnerQuery.mockReturnValue(owner)
    mockAnd.mockImplementation((...conditions) => conditions)
    mockEq.mockImplementation((column, value) => [column, value])
    const outstandingOwner = () =>
      history.slice(0, 1).filter((row) => !('finalUsage' in row.metadata))
    const tx = createBillingDbMock()
    const ownerLock = createSelectQueryMock([{ id: 'user_123' }], 'for')
    const ledgerLock = createSelectQueryMock([{ ...ledger }], 'for')
    const firstCapture = createSelectQueryMock([paid], 'for')
    const save = vi.fn(({ metadata }) => ({
      where: ([, id]: string[]) => {
        Object.assign(history.find((row) => row.id === id)!, { metadata })
      },
    }))
    mockGetResolvedBillingSettings.mockResolvedValue({ billingEnabled: true })
    mockDb.transaction.mockImplementation((run) => run(tx))
    mockDb.queries.mockReturnValueOnce(createSelectQueryMock([], 'where'))
    tx.queries
      .mockReturnValueOnce(ownerLock)
      .mockReturnValueOnce(createSelectQueryMock([], 'where'))
      .mockReturnValueOnce(firstCapture)
      .mockReturnValueOnce(ledgerLock)
    tx.update.mockReturnValue({ set: save })
    vi.mocked(reset).mockImplementationOnce(async () => {
      ledger.currentPeriodCost = '0'
      ledger.billedOverageThisPeriod = '0'
    })
    const insert = vi.fn((values) => ({
      onConflictDoNothing: () => ({ returning: async () => [] }), // original ID belongs to paid
      returning: async () => [values],
    }))
    tx.insert.mockReturnValue({ values: insert })

    const active = await getEffectiveSubscription('user_123')
    expect(paid.metadata.finalUsage).toEqual({
      currentPeriodCost: '28',
      billedOverageThisPeriod: '3',
    })
    expect(active?.id).not.toBe(paid.id)
    expect(active).toMatchObject({ status: 'active', tier: { isDefault: true } })
    expect(insert.mock.calls[1][0].stripeSubscriptionId).toBeUndefined()
    expect(ledgerLock.for).toHaveBeenCalledExactlyOnceWith('update')
    expect(firstCapture.for).toHaveBeenCalledExactlyOnceWith('update')

    ledger.currentPeriodCost = '7'
    const nextRead = createSelectQueryMock([active, ...outstandingOwner()], 'where')
    mockDb.queries.mockReturnValueOnce(nextRead)
    await expect(getEffectiveSubscription('user_123')).resolves.toBe(active)
    expect(mockDb.transaction).toHaveBeenCalledOnce()

    const nextRepair = createSelectQueryMock(outstandingOwner(), 'for')
    tx.queries
      .mockReturnValueOnce(ownerLock)
      .mockReturnValueOnce(createSelectQueryMock([active], 'where'))
      .mockReturnValueOnce(nextRepair)
    await expect(ensureDefaultUserSubscription('user_123', mockDb as any)).resolves.toBe(active)
    const captured = {
      not: expect.objectContaining({
        strings: ['(', "->'finalUsage' IS NOT NULL OR ", "->'finalInvoice' IS NOT NULL)"],
      }),
    }
    const ownerId = ['subscription.id', paid.id]
    expect(nextRead.where).toHaveBeenCalledWith(
      expect.arrayContaining([captured, { or: expect.arrayContaining([ownerId]) }])
    )
    for (const query of [firstCapture, nextRepair]) {
      expect(query.where).toHaveBeenCalledWith(expect.arrayContaining([captured, ownerId]))
    }
    for (const [predicate] of owner.where.mock.calls) {
      expect(predicate).not.toContainEqual(captured)
    }
    expect(owner.limit).toHaveBeenCalledWith(1)
    expect(reset).toHaveBeenCalledExactlyOnceWith('user_123', tx)
    expect(ledger.currentPeriodCost).toBe('7')
    expect(older.metadata).toEqual({})
  })

  it('keeps an unpaid subscription visible for payment without admitting usage or replacing its ledger', async () => {
    const {
      getActiveSubscriptionForReference,
      getBillingSubscriptionForReference,
      getEffectiveSubscription,
    } = await import('./subscription')
    const { resetUserDefaultUsageToOnboardingAllowanceBalance } = await import('./usage')
    const unpaid = { id: 'paid', status: 'unpaid', stripeSubscriptionId: 'sub_old' }
    mockGetResolvedBillingSettings.mockResolvedValue({ billingEnabled: true })
    for (const referenceType of ['user', 'organization'] as const) {
      const ref = { referenceType, referenceId: 'owner' }
      mockDb.queries.mockReturnValueOnce(createSelectQueryMock([unpaid], 'where'))
      await expect(getBillingSubscriptionForReference(ref)).resolves.toBe(unpaid)
      expect(mockAnd.mock.lastCall).toContainEqual({
        not: expect.objectContaining({
          strings: ['(', "->'finalUsage' IS NOT NULL OR ", "->'finalInvoice' IS NOT NULL)"],
        }),
      })
      expect(mockInArray).toHaveBeenCalledWith(
        'subscription.status',
        expect.arrayContaining(['unpaid'])
      )
      mockDb.queries.mockReturnValueOnce(createSelectQueryMock([unpaid], 'where'))
      await expect(getActiveSubscriptionForReference(ref)).resolves.toBeNull()
      const active = { ...unpaid, status: 'active' }
      mockDb.queries.mockReturnValueOnce(createSelectQueryMock([unpaid, active], 'where'))
      await expect(getActiveSubscriptionForReference(ref)).resolves.toBe(active)
    }

    const localDefault = { id: 'default', status: 'active', tier: { isDefault: true } }
    const personal = { referenceType: 'user', referenceId: 'user_123' } as const
    mockDb.queries.mockReturnValueOnce(createSelectQueryMock([localDefault, unpaid], 'where'))
    await expect(getBillingSubscriptionForReference(personal)).resolves.toBe(unpaid)
    mockDb.queries.mockReturnValueOnce(createSelectQueryMock([localDefault, unpaid], 'where'))
    await expect(getActiveSubscriptionForReference(personal)).resolves.toBeNull()
    const reactivated = { ...unpaid, status: 'active' }
    mockDb.queries.mockReturnValueOnce(createSelectQueryMock([reactivated], 'where'))
    await expect(getEffectiveSubscription('user_123')).resolves.toBe(reactivated)
    expect(mockDb.insert).not.toHaveBeenCalled()
    expect(mockDb.update).not.toHaveBeenCalled()
    expect(resetUserDefaultUsageToOnboardingAllowanceBalance).not.toHaveBeenCalled()
  })

  it('retains the replacement ledger when the canceled personal usage was never captured', async () => {
    const { ensureDefaultUserSubscription } = await import('./subscription')
    const active = { stripeSubscriptionId: 'sub_replacement' }
    mockDb.queries
      .mockReturnValueOnce(createSelectQueryMock([{ id: 'user_123' }], 'for'))
      .mockReturnValueOnce(createSelectQueryMock([active], 'where'))
    await expect(ensureDefaultUserSubscription('user_123', mockDb as any)).resolves.toBe(active)
    expect(mockDb.update).not.toHaveBeenCalled()
    expect(mockDb.insert).not.toHaveBeenCalled()
  })

  it('captures a Dashboard subscription’s usage before returning the pre-existing local default', async () => {
    const { getBillingSubscriptionForReference } = await import('./subscription')
    const { resetUserDefaultUsageToOnboardingAllowanceBalance } = await import('./usage')
    const localDefault = { id: 'default', status: 'active', tier: { isDefault: true } }
    const paid = {
      id: 'paid',
      billingTierId: 'tier_pro',
      status: 'canceled',
      stripeSubscriptionId: 'sub_dashboard',
    }
    const ledger = { currentPeriodCost: '27', billedOverageThisPeriod: '4' }
    const save = vi.fn(() => ({ where: vi.fn() }))
    mockGetResolvedBillingSettings.mockResolvedValue({ billingEnabled: true })
    mockDb.queries
      .mockReturnValueOnce(createSelectQueryMock([paid, localDefault], 'where'))
      .mockReturnValueOnce(createSelectQueryMock([{ id: 'user_123' }], 'for'))
      .mockReturnValueOnce(createSelectQueryMock([localDefault], 'where'))
      .mockReturnValueOnce(createSelectQueryMock([paid], 'for'))
      .mockReturnValueOnce(createSelectQueryMock([ledger], 'for'))
    mockDb.update.mockReturnValue({ set: save })
    await expect(
      getBillingSubscriptionForReference({ referenceType: 'user', referenceId: 'user_123' })
    ).resolves.toBe(localDefault)
    expect(save).toHaveBeenCalledExactlyOnceWith({ metadata: { finalUsage: ledger } })
    expect(resetUserDefaultUsageToOnboardingAllowanceBalance).toHaveBeenCalledExactlyOnceWith(
      'user_123',
      mockDb
    )
    expect(mockDb.insert).not.toHaveBeenCalled()
  })

  it('does not restore a subscription when billing is disabled', async () => {
    mockGetResolvedBillingSettings.mockResolvedValue({ billingEnabled: false })
    mockDb.queries.mockImplementation(() => createSelectQueryMock([], 'where'))
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
    mockDb.queries.mockImplementation(() => createSelectQueryMock([], 'where'))
    mockDb.transaction
      .mockImplementationOnce((read) => read(mockDb))
      .mockRejectedValueOnce(new Error('Unable to provision the default tier'))

    const { getPersonalBillingSnapshot } = await import('./subscription')
    await expect(getPersonalBillingSnapshot('user_123')).rejects.toThrow(
      'No active personal subscription found for billed user user_123'
    )
  })

  it('throws a typed error when a required active subscription is missing', async () => {
    mockDb.queries.mockImplementationOnce(() => createSelectQueryMock([], 'where'))

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
    mockDb.queries.mockImplementationOnce(() => createSelectQueryMock([row], 'limit'))

    const { getSubscriptionByStripeSubscriptionId } = await import('./subscription')

    await expect(getSubscriptionByStripeSubscriptionId('stripe_sub_123')).resolves.toBe(row)
    expect(mockEq).toHaveBeenCalledWith('subscription.stripeSubscriptionId', 'stripe_sub_123')
    expect(mockHydrateSubscriptionsWithTiers).toHaveBeenCalledWith([row])
  })

  it('returns null for an untracked Stripe subscription id', async () => {
    mockDb.queries.mockImplementationOnce(() => createSelectQueryMock([], 'limit'))

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
    mockDb.queries.mockImplementation(() => {
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
