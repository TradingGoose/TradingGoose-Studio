/**
 * @vitest-environment node
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

const { insertValues, requireBillingTierById } = vi.hoisted(() => ({
  insertValues: vi.fn(),
  requireBillingTierById: vi.fn(),
}))

const insertQuery = {
  values: insertValues,
  onConflictDoUpdate: vi.fn().mockReturnThis(),
  returning: vi.fn().mockResolvedValue([{ id: 'sub_enterprise' }]),
}
const selectQuery = {
  from: vi.fn().mockReturnThis(),
  where: vi.fn().mockReturnThis(),
  limit: vi.fn().mockResolvedValue([]),
}

vi.mock('@tradinggoose/db', () => ({
  db: {
    insert: vi.fn(() => insertQuery),
    select: vi.fn(() => selectQuery),
  },
}))

vi.mock('@tradinggoose/db/schema', () => ({
  organization: { id: 'organization.id', name: 'organization.name' },
  subscription: { stripeSubscriptionId: 'subscription.stripeSubscriptionId' },
  user: {
    id: 'user.id',
    name: 'user.name',
    email: 'user.email',
    stripeCustomerId: 'user.stripeCustomerId',
  },
}))

vi.mock('drizzle-orm', () => ({ eq: vi.fn() }))

vi.mock('@/lib/billing/tiers', () => ({
  getTierUsageAllowanceUsd: vi.fn(() => 100),
  isOrganizationBillingTier: vi.fn(() => true),
  requireBillingTierById,
}))

vi.mock('@/components/emails/render-email', () => ({
  getEmailSubject: vi.fn(),
  renderEnterpriseSubscriptionEmail: vi.fn(),
}))

vi.mock('@/lib/email/locale', () => ({ resolveEmailLocale: vi.fn() }))
vi.mock('@/lib/email/mailer', () => ({ sendEmail: vi.fn() }))
vi.mock('@/lib/logs/console/logger', () => ({
  createLogger: () => ({ error: vi.fn(), info: vi.fn(), warn: vi.fn() }),
}))

describe('handleManualEnterpriseSubscription', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    insertValues.mockReturnValue(insertQuery)
    requireBillingTierById.mockResolvedValue({
      id: 'tier_enterprise',
      displayName: 'Enterprise',
      ownerType: 'organization',
      usageScope: 'individual',
      stripeYearlyPriceId: 'price_yearly',
    })
  })

  it('normalizes explicit enterprise identifiers once at the metadata boundary', async () => {
    const { handleManualEnterpriseSubscription } = await import('./enterprise')

    await handleManualEnterpriseSubscription({
      data: {
        object: {
          id: 'sub_stripe_enterprise',
          customer: 'cus_enterprise',
          metadata: {
            referenceType: 'organization',
            referenceId: ' org_123 ',
            billingTierId: ' tier_enterprise ',
            monthlyPrice: '100',
            seats: '5',
          },
          items: {
            data: [
              { price: { id: 'addon', recurring: { interval: 'month' } } },
              { price: { id: 'price_yearly', recurring: { interval: 'year' } } },
            ],
          },
          cancel_at: 1_900_000_000,
          canceled_at: 1_800_000_000,
          ended_at: null,
          schedule: { id: 'sub_sched' },
          status: 'active',
        },
      },
    } as any)

    expect(requireBillingTierById).toHaveBeenCalledWith('tier_enterprise')
    const fields = expect.objectContaining({
      referenceId: 'org_123',
      billingTierId: 'tier_enterprise',
      billingInterval: 'year',
      stripeScheduleId: 'sub_sched',
      cancelAt: new Date(1_900_000_000_000),
      canceledAt: new Date(1_800_000_000_000),
      endedAt: null,
      metadata: expect.objectContaining({
        referenceId: 'org_123',
        billingTierId: 'tier_enterprise',
      }),
    })
    expect(insertValues).toHaveBeenCalledWith(fields)
    expect(insertQuery.onConflictDoUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ set: fields })
    )
  })
})
