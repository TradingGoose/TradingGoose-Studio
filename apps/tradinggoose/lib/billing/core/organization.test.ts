/**
 * @vitest-environment node
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockAnd,
  mockCanTierEditUsageLimit,
  mockDb,
  mockEq,
  mockGetBillingTierPricing,
  mockGetOrganizationSubscription,
  mockGetResolvedBillingSettings,
  mockGetSubscriptionUsageAllowanceUsd,
  mockGetTierUsageAllowanceUsd,
  mockToBillingTierSummary,
  mockLockFinancialRoots,
  mockReadFinancialMemberTarget,
  mockAssertFinancialMemberTargets,
} = vi.hoisted(() => ({
  mockAnd: vi.fn(),
  mockCanTierEditUsageLimit: vi.fn(),
  mockDb: {
    insert: vi.fn(),
    select: vi.fn(),
    update: vi.fn(),
    transaction: vi.fn(),
  },
  mockEq: vi.fn(),
  mockGetBillingTierPricing: vi.fn(),
  mockGetOrganizationSubscription: vi.fn(),
  mockGetResolvedBillingSettings: vi.fn(),
  mockGetSubscriptionUsageAllowanceUsd: vi.fn(),
  mockGetTierUsageAllowanceUsd: vi.fn(),
  mockToBillingTierSummary: vi.fn(),
  mockLockFinancialRoots: vi.fn(),
  mockReadFinancialMemberTarget: vi.fn(),
  mockAssertFinancialMemberTargets: vi.fn(),
}))

vi.mock('@tradinggoose/db', () => ({
  db: mockDb,
}))
vi.mock('@tradinggoose/billing', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@tradinggoose/billing')>()),
  lockFinancialRoots: mockLockFinancialRoots,
  readFinancialMemberTarget: mockReadFinancialMemberTarget,
  assertFinancialMemberTargets: mockAssertFinancialMemberTargets,
}))

vi.mock('@tradinggoose/db/schema', () => ({
  idempotencyKey: { key: 'idempotencyKey.key', namespace: 'idempotencyKey.namespace' },
  member: {
    createdAt: 'member.createdAt',
    organizationId: 'member.organizationId',
    role: 'member.role',
    userId: 'member.userId',
  },
  organization: {
    id: 'organization.id',
    orgUsageLimit: 'organization.orgUsageLimit',
  },
  organizationBillingLedger: {
    organizationId: 'organizationBillingLedger.organizationId',
  },
  organizationMemberBillingLedger: {
    organizationId: 'organizationMemberBillingLedger.organizationId',
    userId: 'organizationMemberBillingLedger.userId',
  },
  user: {
    email: 'user.email',
    id: 'user.id',
    name: 'user.name',
  },
  userStats: {
    lastActive: 'userStats.lastActive',
    userId: 'userStats.userId',
  },
}))

vi.mock('drizzle-orm', async (importOriginal) => ({
  ...(await importOriginal<typeof import('drizzle-orm')>()),
  and: mockAnd,
  eq: mockEq,
}))

beforeEach(() => {
  mockDb.select.mockReset()
  mockReadFinancialMemberTarget.mockReset().mockResolvedValue(undefined)
  mockAssertFinancialMemberTargets.mockReset().mockResolvedValue(undefined)
  mockDb.transaction.mockImplementation(async (callback) => callback(mockDb))
  mockLockFinancialRoots.mockResolvedValue(undefined)
  mockDb.insert.mockImplementation(() => {
    throw new Error('Billing projection must not recreate a historical ledger')
  })
})

vi.mock('@/lib/billing/core/billing', () => ({
  getBillingTierPricing: mockGetBillingTierPricing,
  getOrganizationSubscription: mockGetOrganizationSubscription,
}))

vi.mock('@/lib/billing/settings', () => ({
  getResolvedBillingSettings: mockGetResolvedBillingSettings,
}))

vi.mock('@/lib/billing/tiers', () => ({
  canTierEditUsageLimit: mockCanTierEditUsageLimit,
  getSubscriptionUsageAllowanceUsd: mockGetSubscriptionUsageAllowanceUsd,
  getTierUsageAllowanceUsd: mockGetTierUsageAllowanceUsd,
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

function createSelectQueryMock(result: unknown, terminal: 'limit' | 'where' = 'limit') {
  const query = {
    from: vi.fn(() => query),
    innerJoin: vi.fn(() => query),
    leftJoin: vi.fn(() => query),
    limit: vi.fn(() => Promise.resolve(result)),
    where: vi.fn(() => (terminal === 'where' ? Promise.resolve(result) : query)),
  }

  return query
}

function createOrganizationLedgerRow(overrides: Record<string, unknown> = {}) {
  const now = new Date('2026-04-11T00:00:00.000Z')

  return {
    organizationId: 'org_123',
    totalManualExecutions: 0,
    totalApiCalls: 0,
    totalWebhookTriggers: 0,
    totalScheduledExecutions: 0,
    totalChatExecutions: 0,
    totalTokensUsed: 0,
    totalCost: '0',
    currentPeriodCost: '0',
    lastPeriodCost: '0',
    billedOverageThisPeriod: '0',
    totalCopilotCost: '0',
    currentPeriodCopilotCost: '0',
    lastPeriodCopilotCost: '0',
    totalCopilotTokens: 0,
    totalCopilotCalls: 0,
    billingBlocked: false,
    lastActive: now,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  }
}

function createOrganizationMemberLedgerRow(
  userId: string,
  currentPeriodCost: string,
  overrides: Record<string, unknown> = {}
) {
  const now = new Date('2026-04-11T00:00:00.000Z')

  return {
    organizationId: 'org_123',
    userId,
    totalManualExecutions: 0,
    totalApiCalls: 0,
    totalWebhookTriggers: 0,
    totalScheduledExecutions: 0,
    totalChatExecutions: 0,
    totalTokensUsed: 0,
    totalCost: currentPeriodCost,
    currentPeriodCost,
    lastPeriodCost: '0',
    totalCopilotCost: '0',
    currentPeriodCopilotCost: '0',
    lastPeriodCopilotCost: '0',
    totalCopilotTokens: 0,
    totalCopilotCalls: 0,
    lastActive: now,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  }
}

describe('organization ledger reads under the financial boundary', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
  })
  it('maps an existing ledger after locking its original root in the same transaction', async () => {
    mockDb.select
      .mockImplementationOnce(() => createSelectQueryMock([{ id: 'org_123' }]))
      .mockImplementationOnce(() =>
        createSelectQueryMock([
          createOrganizationLedgerRow({ totalCost: '18.50', currentPeriodCost: '4.25' }),
        ])
      )
    const { getOrganizationBillingLedger } = await import('./organization')
    await expect(getOrganizationBillingLedger('org_123')).resolves.toMatchObject({
      organizationId: 'org_123',
      totalCost: '18.5',
      currentPeriodCost: '4.25',
    })
    expect(mockDb.transaction).toHaveBeenCalledOnce()
    expect(mockLockFinancialRoots).toHaveBeenCalledExactlyOnceWith(mockDb, [
      { type: 'organization', id: 'org_123' },
    ])
    expect(mockLockFinancialRoots.mock.invocationCallOrder[0]).toBeLessThan(
      mockDb.select.mock.invocationCallOrder[0]
    )
    expect(mockDb.insert).not.toHaveBeenCalled()
  })
  it('does not create a ledger after the original organization is gone', async () => {
    mockDb.select.mockImplementationOnce(() => createSelectQueryMock([]))
    const { getOrganizationBillingLedger } = await import('./organization')
    await expect(getOrganizationBillingLedger('org_123')).resolves.toBeNull()
    expect(mockDb.select).toHaveBeenCalledOnce()
    expect(mockDb.insert).not.toHaveBeenCalled()
  })
  it('refuses a missing historical organization ledger without replacing it with zero', async () => {
    mockDb.select
      .mockImplementationOnce(() => createSelectQueryMock([{ id: 'org_123' }]))
      .mockImplementationOnce(() => createSelectQueryMock([]))
    const { FinancialPolicyError } = await import('@tradinggoose/billing')
    const { getOrganizationBillingLedger } = await import('./organization')
    await expect(getOrganizationBillingLedger('org_123')).rejects.toBeInstanceOf(
      FinancialPolicyError
    )
    expect(mockDb.select).toHaveBeenCalledTimes(2)
    expect(mockDb.insert).not.toHaveBeenCalled()
  })
  it('refuses missing registered member proof before reading or initializing its ledger', async () => {
    const { FinancialPolicyError } = await import('@tradinggoose/billing')
    mockReadFinancialMemberTarget.mockRejectedValueOnce(
      new FinancialPolicyError('Original target missing')
    )
    const { getOrganizationMemberBillingLedger } = await import('./organization')
    await expect(
      getOrganizationMemberBillingLedger('org_123', 'departed_member')
    ).rejects.toBeInstanceOf(FinancialPolicyError)
    expect(mockReadFinancialMemberTarget).toHaveBeenCalledWith(mockDb, 'org_123', 'departed_member')
    expect(mockDb.select).not.toHaveBeenCalled()
    expect(mockDb.insert).not.toHaveBeenCalled()
  })
  it('refuses reader-side initialization even when the organization has no monetary history', async () => {
    mockDb.select
      .mockImplementationOnce(() => createSelectQueryMock([{ id: 'org_123' }]))
      .mockImplementationOnce(() => createSelectQueryMock([]))
    const { getOrganizationBillingLedger } = await import('./organization')
    await expect(getOrganizationBillingLedger('org_123')).rejects.toThrow('preservation required')
    expect(mockDb.insert).not.toHaveBeenCalled()
    expect(mockDb.select).toHaveBeenCalledTimes(2)
  })
})

describe('getOrganizationMinimumUsageLimitUsd', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
  })

  it('uses the subscription usage allowance instead of recurring seat price semantics', async () => {
    mockGetSubscriptionUsageAllowanceUsd.mockReturnValue('87.456')

    const { getOrganizationMinimumUsageLimitUsd } = await import('./organization')

    expect(getOrganizationMinimumUsageLimitUsd({} as never)).toBe('87.456')
    expect(mockGetSubscriptionUsageAllowanceUsd).toHaveBeenCalledWith({})
  })

  it('returns zero when no subscription is available', async () => {
    mockGetSubscriptionUsageAllowanceUsd.mockReturnValue('0')

    const { getOrganizationMinimumUsageLimitUsd } = await import('./organization')

    expect(getOrganizationMinimumUsageLimitUsd(null)).toBe('0')
  })
})

describe('getOrganizationBillingData', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()

    mockGetResolvedBillingSettings.mockResolvedValue({
      billingEnabled: true,
      usageWarningThresholdPercent: 80,
    })
    mockGetBillingTierPricing.mockReturnValue({
      basePrice: 99,
    })
    mockCanTierEditUsageLimit.mockReturnValue(false)
    mockGetSubscriptionUsageAllowanceUsd.mockReturnValue('80')
    mockGetTierUsageAllowanceUsd.mockReturnValue('80')
    mockToBillingTierSummary.mockImplementation((tier) => ({
      ...tier,
      status: tier.status ?? 'active',
      hasStripeMonthlyPriceId: Boolean(tier.stripeMonthlyPriceId),
    }))
  })

  it('sums member allowances for individual-scope organization totals', async () => {
    mockGetOrganizationSubscription.mockResolvedValue({
      id: 'sub_123',
      status: 'active',
      seats: null,
      periodStart: new Date('2026-04-01T00:00:00.000Z'),
      periodEnd: new Date('2026-05-01T00:00:00.000Z'),
      tier: {
        id: 'tier_org_individual',
        displayName: 'Team Individual',
        monthlyPriceUsd: null,
        status: 'archived',
        ownerType: 'organization',
        usageScope: 'individual',
        seatMode: 'adjustable',
        seatCount: null,
        seatMaximum: null,
        stripeMonthlyPriceId: 'price_team',
      },
    })

    mockDb.select
      .mockImplementationOnce(() =>
        createSelectQueryMock([
          {
            id: 'org_123',
            name: 'Trading Goose',
            orgUsageLimit: '80.00',
          },
        ])
      )
      .mockImplementationOnce(() => createSelectQueryMock([{ id: 'org_123' }]))
      .mockImplementationOnce(() =>
        createSelectQueryMock([createOrganizationLedgerRow({ currentPeriodCost: '999' })])
      )
      .mockImplementationOnce(() =>
        createSelectQueryMock(
          [
            {
              userId: 'user_1',
              userName: 'Alpha',
              userEmail: 'alpha@example.com',
              role: 'owner',
              joinedAt: new Date('2026-03-01T00:00:00.000Z'),
              lastActive: new Date('2026-04-10T00:00:00.000Z'),
            },
            {
              userId: 'user_2',
              userName: 'Beta',
              userEmail: 'beta@example.com',
              role: 'member',
              joinedAt: new Date('2026-03-02T00:00:00.000Z'),
              lastActive: new Date('2026-04-09T00:00:00.000Z'),
            },
          ],
          'where'
        )
      )
      .mockImplementationOnce(() =>
        createSelectQueryMock(
          [
            createOrganizationMemberLedgerRow('user_1', '80'),
            createOrganizationMemberLedgerRow('user_2', '40'),
          ],
          'where'
        )
      )

    const { getOrganizationBillingData } = await import('./organization')
    const result = await getOrganizationBillingData('org_123')

    expect(result).not.toBeNull()
    expect(result?.members).toHaveLength(2)
    expect(result?.members.map((member) => member.usageLimit)).toEqual(['80', '80'])
    expect(result?.totalCurrentUsage).toBe('120')
    expect(result?.totalUsageLimit).toBe('160')
    expect(result?.minimumUsageLimit).toBe('80')
    expect(result?.subscriptionTier?.status).toBe('archived')
    expect(result?.subscriptionTier?.hasStripeMonthlyPriceId).toBe(true)
    expect(mockToBillingTierSummary).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'tier_org_individual' })
    )

    const percentUsed = result?.percentUsed

    expect(percentUsed).toBe(75)
    expect(percentUsed).toBeLessThan(result?.warningThresholdPercent ?? 0)
    expect(result?.isExceeded).toBe(false)
    expect(result?.isWarning).toBe(false)
  })

  it('returns unlimited organization usage data with no subscription tier when billing is disabled', async () => {
    mockGetResolvedBillingSettings.mockResolvedValueOnce({
      billingEnabled: false,
      usageWarningThresholdPercent: 80,
    })
    mockGetOrganizationSubscription.mockResolvedValueOnce({
      id: 'sub_123',
      status: 'active',
      seats: 3,
      periodStart: new Date('2026-04-01T00:00:00.000Z'),
      periodEnd: new Date('2026-05-01T00:00:00.000Z'),
      tier: {
        id: 'tier_org_individual',
        displayName: 'Team Individual',
        monthlyPriceUsd: null,
        ownerType: 'organization',
        usageScope: 'individual',
        seatMode: 'adjustable',
        seatCount: null,
        seatMaximum: null,
      },
    })

    mockDb.select
      .mockImplementationOnce(() =>
        createSelectQueryMock([
          {
            id: 'org_123',
            name: 'Trading Goose',
            orgUsageLimit: '80.00',
          },
        ])
      )
      .mockImplementationOnce(() => createSelectQueryMock([{ id: 'org_123' }]))
      .mockImplementationOnce(() =>
        createSelectQueryMock([createOrganizationLedgerRow({ currentPeriodCost: '120' })])
      )
      .mockImplementationOnce(() =>
        createSelectQueryMock(
          [
            {
              userId: 'user_1',
              userName: 'Alpha',
              userEmail: 'alpha@example.com',
              role: 'owner',
              joinedAt: new Date('2026-03-01T00:00:00.000Z'),
              lastActive: new Date('2026-04-10T00:00:00.000Z'),
            },
            {
              userId: 'user_2',
              userName: 'Beta',
              userEmail: 'beta@example.com',
              role: 'member',
              joinedAt: new Date('2026-03-02T00:00:00.000Z'),
              lastActive: new Date('2026-04-09T00:00:00.000Z'),
            },
          ],
          'where'
        )
      )
      .mockImplementationOnce(() =>
        createSelectQueryMock(
          [
            createOrganizationMemberLedgerRow('user_1', '80'),
            createOrganizationMemberLedgerRow('user_2', '40'),
          ],
          'where'
        )
      )

    const { getOrganizationBillingData } = await import('./organization')
    const result = await getOrganizationBillingData('org_123')

    expect(result).not.toBeNull()
    expect(result?.subscriptionTier).toBeNull()
    expect(result?.subscriptionStatus).toBeNull()
    expect(result?.seatMode).toBeNull()
    expect(result?.members.map((member) => member.usageLimit)).toEqual([null, null])
    expect(result?.totalUsageLimit).toBeNull()
    expect(result?.billingBlocked).toBe(false)
  })

  it('returns an unsubscribed organization projection when billing is enabled', async () => {
    mockGetOrganizationSubscription.mockResolvedValueOnce(null)
    mockDb.select
      .mockImplementationOnce(() =>
        createSelectQueryMock([{ id: 'org_123', name: 'Trading Goose' }])
      )
      .mockImplementationOnce(() => createSelectQueryMock([{ id: 'org_123' }]))
      .mockImplementationOnce(() => createSelectQueryMock([createOrganizationLedgerRow()]))
      .mockImplementationOnce(() => createSelectQueryMock([{ userId: 'user_1' }], 'where'))
      .mockImplementationOnce(() =>
        createSelectQueryMock([createOrganizationMemberLedgerRow('user_1', '1')], 'where')
      )

    const { getOrganizationBillingData } = await import('./organization')
    const result = await getOrganizationBillingData('org_123')

    expect(result).toMatchObject({
      subscriptionTier: null,
      subscriptionStatus: null,
      totalUsageLimit: '0',
    })
    expect(result?.members).toEqual([
      expect.objectContaining({ usageLimit: '0', isOverLimit: true }),
    ])
  })
})
