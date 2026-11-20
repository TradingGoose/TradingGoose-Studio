/**
 * @vitest-environment node
 */

import { PgDialect } from 'drizzle-orm/pg-core'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderEnterpriseSubscriptionEmail } from '@/components/emails/render-email'
import { sendEmail } from '@/lib/email/mailer'

const { insertValues, listItems, requireBillingTierById } = vi.hoisted(() => ({
  insertValues: vi.fn(),
  listItems: vi.fn(),
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
vi.mock('@/lib/billing/stripe-client', () => ({
  requireStripeClient: () => ({ subscriptionItems: { list: listItems } }),
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
  const contractItem = {
    id: 'si_contract',
    metadata: {
      referenceType: 'organization',
      referenceId: ' org_123 ',
      billingTierId: ' tier_enterprise ',
      monthlyPrice: '100',
      seats: '5',
      blockedInvoices: 'from Stripe',
    },
    quantity: 1,
    current_period_start: 1_767_225_600,
    current_period_end: 1_798_761_600,
    price: { recurring: { interval: 'year' } },
  }
  const addOn = { id: 'si_add_on', metadata: {}, price: { recurring: { interval: 'month' } } }
  const event = {
    data: {
      object: {
        id: 'sub_stripe_enterprise',
        customer: 'cus_enterprise',
        metadata: {},
        items: { data: [addOn, contractItem], has_more: false },
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
        seats: 5,
        periodStart: new Date(contractItem.current_period_start * 1000),
        periodEnd: new Date(contractItem.current_period_end * 1000),
        billingInterval: 'year',
        metadata: {
          referenceType: 'organization',
          referenceId: 'org_123',
          billingTierId: 'tier_enterprise',
          monthlyPrice: '100',
          seats: '5',
          stripeSubscriptionItemId: contractItem.id,
        },
      })
    )
    expect(listItems).not.toHaveBeenCalled()
    const [{ set }] = insertQuery.onConflictDoUpdate.mock.calls[0]
    expect(new PgDialect().sqlToQuery(set.metadata).sql).toBe(
      `coalesce("subscription"."metadata"::jsonb, '{}'::jsonb) || excluded.metadata::jsonb`
    )
  })

  it('ignores subscription-level metadata when Checkout items have no contract terms', async () => {
    const { handleManualEnterpriseSubscription } = await import('./enterprise')
    await handleManualEnterpriseSubscription({
      ...event,
      data: {
        object: { ...event.data.object, metadata: contractItem.metadata, items: { data: [addOn] } },
      },
    })
    expect(requireBillingTierById).not.toHaveBeenCalled()
    expect(insertValues).not.toHaveBeenCalled()
  })

  it('checks the complete Stripe item list before granting terms from a single item', async () => {
    const { handleManualEnterpriseSubscription } = await import('./enterprise')
    const truncated = {
      ...event,
      data: { object: { ...event.data.object, items: { data: [contractItem], has_more: true } } },
    }
    listItems.mockResolvedValueOnce({ data: [contractItem, { ...contractItem, id: 'si_other' }] })
    await expect(handleManualEnterpriseSubscription(truncated)).rejects.toThrow(
      'Ambiguous enterprise contract items'
    )
    expect(listItems).toHaveBeenCalledOnce()
    expect(insertValues).not.toHaveBeenCalled()
  })
})
