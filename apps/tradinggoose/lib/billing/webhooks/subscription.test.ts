/**
 * @vitest-environment node
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockAnd,
  mockDb,
  mockDecrementGrantedOnboardingAllowanceByCurrentPeriodUsage,
  mockEq,
  mockIsPaidBillingTier,
  mockNe,
  mockResetUsageForSubscription,
} = vi.hoisted(() => ({
  mockAnd: vi.fn(),
  mockDb: {
    select: vi.fn(),
  },
  mockDecrementGrantedOnboardingAllowanceByCurrentPeriodUsage: vi.fn(),
  mockEq: vi.fn((field: unknown, value: unknown) => ({ field, value })),
  mockIsPaidBillingTier: vi.fn(),
  mockNe: vi.fn((field: unknown, value: unknown) => ({ field, value })),
  mockResetUsageForSubscription: vi.fn(),
}))

let otherActiveSubscriptions: Array<Record<string, unknown>> = []

vi.mock('@tradinggoose/db', () => ({
  db: mockDb,
}))

vi.mock('@tradinggoose/db/schema', () => ({
  subscription: {
    referenceType: 'subscription.referenceType',
    referenceId: 'subscription.referenceId',
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
}))

vi.mock('@/lib/billing/tiers', () => ({
  isPaidBillingTier: mockIsPaidBillingTier,
}))

vi.mock('@/lib/billing/webhooks/invoices', () => ({
  getBilledOverageForSubscription: vi.fn(),
  resetUsageForSubscription: mockResetUsageForSubscription,
}))

vi.mock('@/lib/billing/core/billing', () => ({
  calculateSubscriptionOverage: vi.fn(),
}))

vi.mock('@/lib/billing/stripe-client', () => ({
  requireStripeClient: vi.fn(),
}))

vi.mock('@/lib/logs/console/logger', () => ({
  createLogger: () => ({
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  }),
}))

function createSelectQueryMock(result: unknown) {
  const query = {
    from: vi.fn(() => query),
    where: vi.fn(() => Promise.resolve(result)),
  }

  return query
}

describe('handleSubscriptionCreated', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()

    otherActiveSubscriptions = []
    mockDb.select.mockImplementation(() => createSelectQueryMock(otherActiveSubscriptions))
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
    expect(mockResetUsageForSubscription).toHaveBeenCalledWith({
      referenceId: 'org-1',
      tier: expect.objectContaining({ displayName: 'Team' }),
    })
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
