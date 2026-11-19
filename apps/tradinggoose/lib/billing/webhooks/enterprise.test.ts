/**
 * @vitest-environment node
 */

import { PgDialect } from 'drizzle-orm/pg-core'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderEnterpriseSubscriptionEmail } from '@/components/emails/render-email'
import { sendEmail } from '@/lib/email/mailer'

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

vi.mock('@/lib/billing/tiers', () => ({
  getTierIncludedUsageLimit: vi.fn(() => 100),
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
  const event = {
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
          blockedInvoices: 'from Stripe',
        },
        items: { data: [] },
        status: 'active',
      },
    },
  } as any

  beforeEach(() => {
    vi.clearAllMocks()
    insertValues.mockReturnValue(insertQuery)
    requireBillingTierById.mockResolvedValue({
      id: 'tier_enterprise',
      displayName: 'Enterprise',
      ownerType: 'organization',
      usageScope: 'individual',
    })
  })

  it.each(['cus_enterprise', 'cus_other'])(
    'retries for the same Stripe customer (current=%s)',
    async (customer) => {
      const { handleManualEnterpriseSubscription } = await import('./enterprise')
      const recipient = { id: 'owner', email: 'prior@example.com', name: 'Owner' }
      const email = 'current@example.com'
      selectQuery.limit
        .mockResolvedValueOnce([recipient])
        .mockResolvedValueOnce([{ id: 'org_123' }])
        .mockResolvedValueOnce([{ stripeCustomerId: customer }])
      vi.mocked(sendEmail)
        .mockResolvedValueOnce({ success: false, message: 'Mailbox changed', currentEmail: email })
        .mockResolvedValue({ success: true, message: 'Sent' })
      await handleManualEnterpriseSubscription(event)
      const addresses = customer === 'cus_enterprise' ? [recipient.email, email] : [recipient.email]
      expect(vi.mocked(sendEmail).mock.calls.map(([mail]) => [mail.userId, mail.to])).toEqual(
        addresses.map((address) => [recipient.id, address])
      )
      expect(
        vi.mocked(renderEnterpriseSubscriptionEmail).mock.calls.map(([, address]) => address)
      ).toEqual(addresses)
    }
  )

  it('upserts only contract metadata and preserves local settlement and payment records', async () => {
    const { handleManualEnterpriseSubscription } = await import('./enterprise')

    await handleManualEnterpriseSubscription(event)

    expect(requireBillingTierById).toHaveBeenCalledWith('tier_enterprise')
    expect(insertValues).toHaveBeenCalledWith(
      expect.objectContaining({
        referenceId: 'org_123',
        billingTierId: 'tier_enterprise',
        metadata: {
          referenceType: 'organization',
          referenceId: 'org_123',
          billingTierId: 'tier_enterprise',
          monthlyPrice: '100',
          seats: '5',
        },
      })
    )
    const [{ set }] = insertQuery.onConflictDoUpdate.mock.calls[0]
    expect(new PgDialect().sqlToQuery(set.metadata).sql).toBe(
      `coalesce("subscription"."metadata"::jsonb, '{}'::jsonb) || excluded.metadata::jsonb`
    )
  })
})
