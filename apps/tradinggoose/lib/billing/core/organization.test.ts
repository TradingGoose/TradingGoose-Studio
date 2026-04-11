/**
 * @vitest-environment node
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockAnd,
  mockCanTierConfigureSso,
  mockCanTierEditUsageLimit,
  mockDb,
  mockEq,
  mockGetBillingTierPricing,
  mockGetOrganizationSubscription,
  mockGetResolvedBillingSettings,
  mockGetSubscriptionUsageAllowanceUsd,
  mockGetTierUsageAllowanceUsd,
} = vi.hoisted(() => ({
  mockAnd: vi.fn(),
  mockCanTierConfigureSso: vi.fn(),
  mockCanTierEditUsageLimit: vi.fn(),
  mockDb: {
    insert: vi.fn(),
    select: vi.fn(),
    update: vi.fn(),
  },
  mockEq: vi.fn(),
  mockGetBillingTierPricing: vi.fn(),
  mockGetOrganizationSubscription: vi.fn(),
  mockGetResolvedBillingSettings: vi.fn(),
  mockGetSubscriptionUsageAllowanceUsd: vi.fn(),
  mockGetTierUsageAllowanceUsd: vi.fn(),
}))

vi.mock('@tradinggoose/db', () => ({
  db: mockDb,
}))

vi.mock('@tradinggoose/db/schema', () => ({
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

vi.mock('drizzle-orm', () => ({
  and: mockAnd,
  eq: mockEq,
}))

vi.mock('@/lib/billing/core/billing', () => ({
  getBillingTierPricing: mockGetBillingTierPricing,
  getOrganizationSubscription: mockGetOrganizationSubscription,
}))

vi.mock('@/lib/billing/settings', () => ({
  getResolvedBillingSettings: mockGetResolvedBillingSettings,
}))

vi.mock('@/lib/billing/tiers', () => ({
  canTierConfigureSso: mockCanTierConfigureSso,
  canTierEditUsageLimit: mockCanTierEditUsageLimit,
  getSubscriptionUsageAllowanceUsd: mockGetSubscriptionUsageAllowanceUsd,
  getTierUsageAllowanceUsd: mockGetTierUsageAllowanceUsd,
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
    totalCost: 0,
    currentPeriodCost: 0,
    lastPeriodCost: 0,
    billedOverageThisPeriod: 0,
    totalCopilotCost: 0,
    currentPeriodCopilotCost: 0,
    lastPeriodCopilotCost: 0,
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
  currentPeriodCost: number,
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
    lastPeriodCost: 0,
    totalCopilotCost: 0,
    currentPeriodCopilotCost: 0,
    lastPeriodCopilotCost: 0,
    totalCopilotTokens: 0,
    totalCopilotCalls: 0,
    lastActive: now,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  }
}

describe('getOrganizationMinimumUsageLimitUsd', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
  })

  it('uses the subscription usage allowance instead of recurring seat price semantics', async () => {
    mockGetSubscriptionUsageAllowanceUsd.mockReturnValue(87.456)

    const { getOrganizationMinimumUsageLimitUsd } = await import('./organization')

    expect(getOrganizationMinimumUsageLimitUsd({} as never)).toBe(87.46)
    expect(mockGetSubscriptionUsageAllowanceUsd).toHaveBeenCalledWith({})
  })

  it('returns zero when no subscription is available', async () => {
    mockGetSubscriptionUsageAllowanceUsd.mockReturnValue(0)

    const { getOrganizationMinimumUsageLimitUsd } = await import('./organization')

    expect(getOrganizationMinimumUsageLimitUsd(null)).toBe(0)
  })
})

describe('getOrganizationBillingData', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()

    mockGetResolvedBillingSettings.mockResolvedValue({
      usageWarningThresholdPercent: 80,
    })
    mockGetBillingTierPricing.mockReturnValue({
      basePrice: 99,
    })
    mockCanTierEditUsageLimit.mockReturnValue(false)
    mockCanTierConfigureSso.mockReturnValue(true)
    mockGetSubscriptionUsageAllowanceUsd.mockReturnValue(80)
    mockGetTierUsageAllowanceUsd.mockReturnValue(80)
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
        createSelectQueryMock([createOrganizationLedgerRow({ currentPeriodCost: 999 })])
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
            createOrganizationMemberLedgerRow('user_1', 80),
            createOrganizationMemberLedgerRow('user_2', 40),
          ],
          'where'
        )
      )

    const { getOrganizationBillingData } = await import('./organization')
    const result = await getOrganizationBillingData('org_123')

    expect(result).not.toBeNull()
    expect(result?.members).toHaveLength(2)
    expect(result?.members.map((member) => member.usageLimit)).toEqual([80, 80])
    expect(result?.totalCurrentUsage).toBe(120)
    expect(result?.totalUsageLimit).toBe(160)
    expect(result?.minimumUsageLimit).toBe(80)

    const percentUsed = ((result?.totalCurrentUsage ?? 0) / (result?.totalUsageLimit ?? 1)) * 100

    expect(percentUsed).toBe(75)
    expect(percentUsed).toBeLessThan(result?.warningThresholdPercent ?? 0)
    expect((result?.totalCurrentUsage ?? 0) >= (result?.totalUsageLimit ?? 0)).toBe(false)
  })
})
