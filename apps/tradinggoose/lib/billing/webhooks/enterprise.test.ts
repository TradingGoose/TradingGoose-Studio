/**
 * @vitest-environment node
 */

import type Stripe from 'stripe'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { createFinancialSubscription, lockFinancialRoots, rawInsert, requireBillingTierById } =
  vi.hoisted(() => ({
    createFinancialSubscription: vi.fn(),
    lockFinancialRoots: vi.fn(),
    rawInsert: vi.fn(() => {
      throw new Error('Enterprise subscriptions must use the financial mutation boundary')
    }),
    requireBillingTierById: vi.fn(),
  }))

const transaction = { name: 'enterprise-transaction' }
const selectQuery = {
  from: vi.fn().mockReturnThis(),
  where: vi.fn().mockReturnThis(),
  limit: vi.fn().mockResolvedValue([]),
}

vi.mock('@tradinggoose/billing', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@tradinggoose/billing')>()),
  lockFinancialRoots,
}))

vi.mock('@tradinggoose/db', () => ({
  db: {
    insert: rawInsert,
    select: vi.fn(() => selectQuery),
    transaction: vi.fn(async (callback: (tx: typeof transaction) => Promise<unknown>) =>
      callback(transaction)
    ),
  },
}))

vi.mock('@tradinggoose/db/schema', () => ({
  organization: { id: 'organization.id', name: 'organization.name' },
  user: {
    id: 'user.id',
    name: 'user.name',
    email: 'user.email',
    stripeCustomerId: 'user.stripeCustomerId',
  },
}))

vi.mock('drizzle-orm', async (importOriginal) => ({
  ...(await importOriginal<typeof import('drizzle-orm')>()),
  eq: vi.fn(),
}))

vi.mock('@/lib/billing/financial-subscriptions', () => ({ createFinancialSubscription }))

vi.mock('@/lib/billing/tiers', () => ({
  getTierIncludedUsageLimit: vi.fn(() => '100'),
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

function enterpriseEvent(metadata: Record<string, unknown> = {}) {
  return {
    data: {
      object: {
        id: 'sub_stripe_enterprise',
        customer: 'cus_enterprise',
        metadata: {
          referenceType: 'organization',
          referenceId: ' org_123 ',
          billingTierId: ' tier_enterprise ',
          monthlyPrice: '100.00000000000000001',
          seats: '5',
          ...metadata,
        },
        items: { data: [] },
        status: 'active',
      },
    },
  } as unknown as Stripe.Event
}

describe('handleManualEnterpriseSubscription', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    createFinancialSubscription.mockResolvedValue({ id: 'sub_enterprise' })
    requireBillingTierById.mockResolvedValue({
      id: 'tier_enterprise',
      displayName: 'Enterprise',
      ownerType: 'organization',
      usageScope: 'individual',
    })
  })

  it('normalizes explicit identifiers and creates under the original financial root lock', async () => {
    const { handleManualEnterpriseSubscription } = await import('./enterprise')

    await handleManualEnterpriseSubscription(enterpriseEvent())

    expect(requireBillingTierById).toHaveBeenCalledExactlyOnceWith('tier_enterprise')
    expect(lockFinancialRoots).toHaveBeenCalledExactlyOnceWith(transaction, [
      { type: 'organization', id: 'org_123' },
    ])
    expect(createFinancialSubscription).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        referenceId: 'org_123',
        billingTierId: 'tier_enterprise',
        stripeCustomerId: 'cus_enterprise',
        stripeSubscriptionId: 'sub_stripe_enterprise',
        seats: 5,
        metadata: expect.objectContaining({
          referenceId: 'org_123',
          billingTierId: 'tier_enterprise',
          monthlyPrice: '100.00000000000000001',
        }),
      }),
      transaction
    )
    expect(lockFinancialRoots.mock.invocationCallOrder[0]).toBeLessThan(
      createFinancialSubscription.mock.invocationCallOrder[0]
    )
    expect(rawInsert).not.toHaveBeenCalled()
  })

  it('preserves financial mutation failure without falling back to a raw insert', async () => {
    createFinancialSubscription.mockRejectedValueOnce(new Error('Original financial basis missing'))
    const { handleManualEnterpriseSubscription } = await import('./enterprise')

    await expect(handleManualEnterpriseSubscription(enterpriseEvent())).rejects.toThrow(
      'Original financial basis missing'
    )

    expect(lockFinancialRoots).toHaveBeenCalledOnce()
    expect(rawInsert).not.toHaveBeenCalled()
  })

  it.each(['-1', 'invalid', '0'])(
    'refuses invalid enterprise monthly price %s',
    async (monthlyPrice) => {
      const { handleManualEnterpriseSubscription } = await import('./enterprise')

      await expect(
        handleManualEnterpriseSubscription(enterpriseEvent({ monthlyPrice }))
      ).rejects.toThrow()

      expect(lockFinancialRoots).not.toHaveBeenCalled()
      expect(createFinancialSubscription).not.toHaveBeenCalled()
      expect(rawInsert).not.toHaveBeenCalled()
    }
  )

  it('refuses unsafe seat counts before any financial mutation', async () => {
    const { handleManualEnterpriseSubscription } = await import('./enterprise')

    await expect(
      handleManualEnterpriseSubscription(enterpriseEvent({ seats: '9007199254740992' }))
    ).rejects.toThrow('Enterprise subscription must include valid seats in metadata')

    expect(lockFinancialRoots).not.toHaveBeenCalled()
    expect(createFinancialSubscription).not.toHaveBeenCalled()
    expect(rawInsert).not.toHaveBeenCalled()
  })
})
