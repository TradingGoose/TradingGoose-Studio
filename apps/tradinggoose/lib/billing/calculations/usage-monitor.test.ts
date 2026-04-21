/**
 * @vitest-environment node
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockGetResolvedBillingSettings = vi.fn()
const mockGetUserUsageData = vi.fn()
const mockDbSelect = vi.fn()
const mockDbLimit = vi.fn()

vi.mock('@tradinggoose/db', () => ({
  db: {
    select: (...args: unknown[]) => mockDbSelect(...args),
  },
}))

vi.mock('@tradinggoose/db/schema', () => ({
  organization: {
    id: 'organization.id',
    orgUsageLimit: 'organization.orgUsageLimit',
  },
  userStats: {
    billingBlocked: 'userStats.billingBlocked',
    userId: 'userStats.userId',
  },
}))

vi.mock('drizzle-orm', () => ({
  eq: vi.fn(() => 'eq'),
}))

vi.mock('@/lib/billing/core/organization', () => ({
  getOrganizationBillingLedger: vi.fn(),
  getOrganizationMemberBillingLedger: vi.fn(),
}))

vi.mock('@/lib/billing/core/usage', () => ({
  getUserUsageData: (...args: unknown[]) => mockGetUserUsageData(...args),
}))

vi.mock('@/lib/billing/settings', () => ({
  getResolvedBillingSettings: (...args: unknown[]) => mockGetResolvedBillingSettings(...args),
}))

vi.mock('@/lib/billing/tiers', () => ({
  getSubscriptionUsageAllowanceUsd: vi.fn(),
  getTierUsageAllowanceUsd: vi.fn(),
}))

vi.mock('@/lib/billing/workspace-billing', () => ({
  resolveWorkflowBillingContext: vi.fn().mockResolvedValue(null),
  resolveWorkspaceBillingContext: vi.fn().mockResolvedValue(null),
}))

vi.mock('@/lib/logs/console/logger', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  }),
}))

describe('checkServerSideUsageLimits', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    mockGetResolvedBillingSettings.mockResolvedValue({
      billingEnabled: true,
      usageWarningThresholdPercent: 80,
    })

    mockGetUserUsageData.mockResolvedValue({
      currentUsage: 12.5,
      limit: 100,
      percentUsed: 12.5,
      isWarning: false,
      isExceeded: false,
      billingPeriodStart: null,
      billingPeriodEnd: null,
      lastPeriodCost: 0,
    })

    mockDbLimit.mockResolvedValue([{ billingBlocked: false }])
    mockDbSelect.mockImplementation(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => ({
          limit: mockDbLimit,
        })),
      })),
    }))
  })

  it('blocks personal execution when billing is blocked', async () => {
    mockDbLimit.mockResolvedValueOnce([{ billingBlocked: true }])

    const { checkServerSideUsageLimits } = await import('./usage-monitor')

    await expect(checkServerSideUsageLimits({ userId: 'user-1' })).resolves.toEqual({
      isExceeded: true,
      currentUsage: 12.5,
      limit: 0,
      message: 'Billing issue detected. Please update your payment method to continue.',
    })
  })

  it('keeps the normal personal usage-limit response when billing is not blocked', async () => {
    const { checkServerSideUsageLimits } = await import('./usage-monitor')

    await expect(checkServerSideUsageLimits({ userId: 'user-1' })).resolves.toEqual({
      isExceeded: false,
      currentUsage: 12.5,
      limit: 100,
      message: undefined,
    })
  })
})
