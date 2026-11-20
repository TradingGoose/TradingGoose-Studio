/** @vitest-environment node */
import {
  member,
  organizationBillingLedger,
  organizationMemberBillingLedger,
  subscription,
  user,
  userStats,
} from '@tradinggoose/db/schema'
import { SQL } from 'drizzle-orm'
import { PgDialect } from 'drizzle-orm/pg-core'
import Stripe from 'stripe'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { BillingTierRecord } from '@/lib/billing/tiers'
import {
  handleInvoiceFinalized,
  handleInvoicePaymentFailed,
  handleInvoiceResolved,
  lockBilledOverage,
} from './invoices'
import { type BillingMetadata, settleUsageInvoice, type UsageInvoice } from './overage'
import { handleStripeSubscriptionDeleted } from './subscription'

const { db, tx, findSubscription, ensureDefault, calculate, sendEmail, stripe } = vi.hoisted(
  () => ({
    db: { select: vi.fn(), transaction: vi.fn(), update: vi.fn() },
    tx: { select: vi.fn(), update: vi.fn(), insert: vi.fn() },
    findSubscription: vi.fn(),
    ensureDefault: vi.fn(),
    calculate: vi.fn(),
    sendEmail: vi.fn(),
    stripe: {
      customers: { retrieve: vi.fn() },
      subscriptions: { retrieve: vi.fn() },
      invoices: {
        create: vi.fn(),
        list: vi.fn(),
        listLineItems: vi.fn(),
        finalizeInvoice: vi.fn(),
        pay: vi.fn(),
        retrieve: vi.fn(),
      },
      invoiceItems: { create: vi.fn() },
    },
  })
)
vi.mock('@tradinggoose/db', () => ({ db }))
vi.mock('@/lib/billing/core/subscription', () => ({
  getSubscriptionByStripeSubscriptionId: findSubscription,
  getSubscriptionRowByStripeId: findSubscription,
  ensureDefaultUserSubscription: ensureDefault,
}))
vi.mock('@/lib/billing/core/billing', () => ({ calculateSubscriptionOverage: calculate }))
vi.mock('@/lib/billing/tiers', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/billing/tiers')>()),
  hydrateSubscriptionsWithTiers: (rows: unknown[]) => rows,
}))
vi.mock('@/lib/billing/organization', () => ({ syncSubscriptionUsageLimits: vi.fn() }))
vi.mock('@/lib/billing/tiers/persistence', () => ({
  syncSubscriptionBillingTierFromStripeSubscription: () => ({ ownerType: 'user' }),
}))
vi.mock('@/lib/billing/stripe-client', () => ({ requireStripeClient: () => stripe }))
vi.mock('@/lib/email/mailer', () => ({ sendEmail }))
vi.mock('@/lib/email/locale', () => ({ resolveEmailLocale: () => 'en' }))
vi.mock('@/components/emails/render-email', () => ({
  getEmailSubject: () => 'Payment failed',
  renderPaymentFailedEmail: () => '<p>Payment failed</p>',
}))

function subscriptionRow(
  referenceType: 'user' | 'organization',
  status = 'active',
  metadata: BillingMetadata = {}
) {
  return {
    id: 'sub_local',
    stripeSubscriptionId: 'sub_stripe',
    tier: {
      id: 'tier_pro',
      displayName: 'Pro',
      ownerType: referenceType,
      stripeMonthlyPriceId: 'price_m',
      stripeYearlyPriceId: null,
    },
    billingTierId: 'tier_pro',
    referenceType,
    referenceId: referenceType === 'user' ? 'user-1' : 'org-1',
    status,
    metadata,
  }
}

function invoiceEvent(overrides: Partial<Stripe.Invoice> = {}): Stripe.Event {
  return {
    data: {
      object: {
        id: 'in_final',
        customer: 'cus_1',
        amount_due: 1200,
        attempt_count: 1,
        hosted_invoice_url: 'https://invoice.stripe.com/i/example',
        lines: { data: [], has_more: false },
        metadata: { type: 'final_overage_billing', subscriptionId: 'sub_stripe' },
        ...overrides,
      },
    },
  } as Stripe.Event
}

function queryRows(rows: unknown[]) {
  const query = Object.assign(Promise.resolve(rows), {
    where: () => query,
    orderBy: () => query,
    innerJoin: () => query,
    limit: () => query,
    for: vi.fn((mode: string) => {
      expect(mode).toBe('update')
      return Promise.resolve(rows)
    }),
  })
  return query
}

function mockSubscriptions(...rows: ReturnType<typeof subscriptionRow>[]) {
  findSubscription.mockResolvedValue(rows[0])
  tx.select.mockImplementation(() => ({
    from: (table: unknown) => queryRows(table === subscription ? rows : []),
  }))
}

beforeEach(() => {
  vi.resetAllMocks()
  db.transaction.mockImplementation((operation) => operation(tx))
  stripe.invoices.retrieve.mockResolvedValue({ status: 'open' })
  stripe.invoices.list.mockReturnValue([])
  stripe.customers.retrieve.mockResolvedValue({ invoice_settings: {} })
  sendEmail.mockResolvedValue({ success: true })
})

describe('final overage payment notices', () => {
  const recipient = { id: 'user-1', name: 'Owner', email: 'owner@example.com' }
  const currentEmail = 'new@example.com'

  beforeEach(() => {
    tx.update.mockReturnValue({ set: () => ({ where: vi.fn() }) })
    tx.insert.mockReturnValue({ values: () => ({ onConflictDoUpdate: vi.fn() }) })
  })

  it.each([
    ['user', 'owner', true],
    ['organization', 'owner', true],
    ['organization', 'admin', false],
  ] as const)(
    'rechecks the %s recipient before retrying after a mailbox change (role %s)',
    async (scope, currentRole, retry) => {
      mockSubscriptions(subscriptionRow(scope, 'canceled'))
      db.select.mockImplementation((fields) => ({
        from: (table: unknown) => {
          if (fields) {
            expect(table).toBe(scope === 'user' ? user : member)
            return queryRows([recipient])
          }
          expect(table).toBe(member)
          return queryRows([{ role: currentRole }])
        },
      }))
      sendEmail.mockResolvedValueOnce({ success: false, currentEmail, message: 'Mailbox changed' })
      await handleInvoicePaymentFailed(invoiceEvent())
      expect(sendEmail.mock.calls.map(([mail]) => [mail.userId, mail.to])).toEqual([
        [recipient.id, recipient.email],
        ...(retry ? [[recipient.id, currentEmail]] : []),
      ])
      expect(tx.update).toHaveBeenCalledWith(subscription)
    }
  )

  it('skips notices for later final-invoice attempts and ordinary failures on closed subscriptions', async () => {
    mockSubscriptions(subscriptionRow('user', 'canceled'))
    await handleInvoicePaymentFailed(invoiceEvent({ attempt_count: 2 }))
    await handleInvoicePaymentFailed(
      invoiceEvent({ metadata: { type: 'overage_billing', subscriptionId: 'sub_stripe' } })
    )
    expect(db.select).not.toHaveBeenCalled()
    expect(sendEmail).not.toHaveBeenCalled()
    expect(tx.update).toHaveBeenCalledWith(subscription)
  })
})

describe('invoice-specific billing blocks', () => {
  it('ignores a delayed first failure after the invoice was paid without a local block', async () => {
    mockSubscriptions(subscriptionRow('user'))
    const event = invoiceEvent()
    await handleInvoiceResolved(event)
    stripe.invoices.retrieve.mockResolvedValue({ status: 'paid' })
    await handleInvoicePaymentFailed(event)
    expect(stripe.invoices.retrieve).toHaveBeenCalledExactlyOnceWith(
      'in_final',
      {},
      {
        apiVersion: '2026-09-30.endive',
      }
    )
    expect(tx.update).not.toHaveBeenCalled()
    expect(db.select).not.toHaveBeenCalled()
    expect(sendEmail).not.toHaveBeenCalled()
  })

  it.each(['user', 'organization'] as const)(
    'resolving an overage preserves %s usage and clears only its own debt',
    async (ownerType) => {
      const original = subscriptionRow(ownerType)
      const replacement = {
        ...subscriptionRow(ownerType, 'active'),
        id: 'replacement',
        stripeSubscriptionId: 'sub_new',
      }
      mockSubscriptions(original, replacement)
      const balance = {
        billingBlocked: false,
        currentPeriodCost: '21',
        billedOverageThisPeriod: '4',
      }
      tx.update.mockImplementation((table) => ({
        set: (values: { metadata?: BillingMetadata; billingBlocked?: boolean }) => ({
          where: (predicate: SQL) => {
            if (table === subscription) {
              expect(new PgDialect().sqlToQuery(predicate)).toMatchObject({
                sql: '"subscription"."id" = $1',
                params: [original.id],
              })
              original.metadata = values.metadata!
            } else {
              expect(table).toBe(userStats)
              Object.assign(balance, values)
            }
          },
        }),
      }))
      tx.insert.mockImplementation((table) => ({
        values: (values: { organizationId: string; billingBlocked: boolean }) => ({
          onConflictDoUpdate: ({ target, set }: { target: unknown; set: object }) => {
            expect(table).toBe(organizationBillingLedger)
            expect(values.organizationId).toBe(original.referenceId)
            expect(target).toBe(organizationBillingLedger.organizationId)
            expect(set).toMatchObject({ billingBlocked: values.billingBlocked })
            Object.assign(balance, set)
          },
        }),
      }))
      await handleInvoicePaymentFailed(invoiceEvent({ attempt_count: 2 }))
      expect(original.metadata.blockedInvoices).toEqual(['in_final'])
      expect(balance.billingBlocked).toBe(true)
      replacement.metadata.blockedInvoices = ['in_new']
      stripe.invoices.retrieve.mockResolvedValue({ status: 'paid' })
      await handleInvoiceResolved(invoiceEvent())
      expect(original.metadata.blockedInvoices).toEqual([])
      expect(balance.billingBlocked).toBe(true)
      original.metadata.blockedInvoices = ['in_old']
      replacement.metadata.blockedInvoices = []
      for (const reason of ['max_payment_attempts', 'unknown', undefined]) {
        stripe.invoices.retrieve.mockResolvedValue({
          status: 'uncollectible',
          status_details: reason ? { uncollectible: { reason } } : null,
        })
        await handleInvoiceResolved(invoiceEvent({ id: 'in_old' }))
        expect(original.metadata.blockedInvoices).toEqual(['in_old'])
        expect(balance.billingBlocked).toBe(true)
      }
      stripe.invoices.retrieve.mockResolvedValue({
        status: 'uncollectible',
        status_details: { uncollectible: { reason: 'user_forgiven' } },
      })
      await handleInvoiceResolved(invoiceEvent({ id: 'in_old' }))
      await handleInvoicePaymentFailed(invoiceEvent({ id: 'in_old' }))
      expect(original.metadata.blockedInvoices).toEqual([])
      expect(balance).toMatchObject({
        billingBlocked: false,
        currentPeriodCost: '21',
        billedOverageThisPeriod: '4',
      })

      original.status = 'canceled'
      const final = invoiceEvent({ id: 'in_final_after_cancellation' })
      const earlier = invoiceEvent({
        id: 'in_earlier',
        metadata: { type: 'overage_threshold_billing', subscriptionId: 'sub_stripe' },
      })
      stripe.invoices.retrieve.mockResolvedValue({ status: 'open' })
      db.select.mockReturnValue({ from: () => queryRows([]) })
      await handleInvoicePaymentFailed(final)
      expect(balance.billingBlocked).toBe(true)
      await handleInvoicePaymentFailed(earlier)
      expect(original.metadata.blockedInvoices).toEqual([
        'in_final_after_cancellation',
        'in_earlier',
      ])
      stripe.invoices.retrieve.mockResolvedValue({ status: 'void' })
      await handleInvoiceResolved(final)
      await handleInvoicePaymentFailed(final)
      expect(original.metadata.blockedInvoices).toEqual(['in_earlier'])
      expect(balance.billingBlocked).toBe(true)
      await handleInvoiceResolved(earlier)
      expect(original.metadata.blockedInvoices).toEqual([])
      expect(balance).toMatchObject({
        billingBlocked: false,
        currentPeriodCost: '21',
        billedOverageThisPeriod: '4',
      })
      expect(sendEmail).not.toHaveBeenCalled()
    }
  )
})

describe('renewal and cancellation settlement', () => {
  it('resumes the same draft after Stripe rejects a detached method and the next create response is lost', async () => {
    const quote: UsageInvoice = {
      tierName: 'Pro',
      billingPeriod: '2026-05',
      ledgerStart: 'initial',
      totalOverage: 12,
      billedOverage: 4,
      collectionMethod: 'charge_automatically',
      paymentMethod: 'pm_detached',
    }
    const key = 'cus_1:sub_stripe:initial'
    db.update.mockReturnValue({ set: () => ({ where: vi.fn() }) })
    stripe.invoices.create
      .mockRejectedValueOnce(
        new Stripe.errors.StripeInvalidRequestError({
          type: 'invalid_request_error',
          param: 'default_payment_method',
          code: 'resource_missing',
        })
      )
      .mockImplementationOnce(async ({ metadata }) => {
        stripe.invoices.list.mockReturnValue([
          { id: 'in_recovered', metadata, status: 'draft', lines: { data: [] } },
        ])
        throw new Error('Connection lost')
      })
    stripe.invoices.finalizeInvoice.mockResolvedValue({ id: 'in_recovered', status: 'open' })
    await expect(
      settleUsageInvoice('local', 'sub_stripe', 'cus_1', quote, false, 'renewal')
    ).rejects.toThrow('Connection lost')
    expect(stripe.invoices.list).toHaveBeenCalledExactlyOnceWith({ customer: 'cus_1', limit: 100 })
    await settleUsageInvoice('local', 'sub_stripe', 'cus_1', quote, true, 'renewal')
    const [original, replacement] = stripe.invoices.create.mock.calls
    expect(stripe.invoices.create).toHaveBeenCalledTimes(2)
    expect(original[0]).toMatchObject({
      default_payment_method: 'pm_detached',
      metadata: { settlementId: key },
    })
    expect(replacement[0]).not.toHaveProperty('default_payment_method')
    expect(replacement[0].metadata).toEqual(original[0].metadata)
    expect(replacement[1].idempotencyKey).not.toBe(original[1].idempotencyKey)
    expect(stripe.invoiceItems.create).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ invoice: 'in_recovered', amount: 800 }),
      { idempotencyKey: `overage-item:${key}` }
    )
    expect(stripe.invoices.pay).toHaveBeenCalledExactlyOnceWith(
      'in_recovered',
      {},
      { idempotencyKey: `overage-pay:${key}` }
    )
  })

  it('locks the organization ledger before its individual member ledgers', async () => {
    const tables: unknown[] = []
    tx.select.mockImplementation(() => ({
      from: (table: unknown) => {
        const query = queryRows([{ billedOverage: '12' }])
        query.for.mockImplementationOnce(async (mode) => {
          expect(mode).toBe('update')
          tables.push(table)
          return [{ billedOverage: '12' }]
        })
        return query
      },
    }))
    const tier = { ownerType: 'organization', usageScope: 'individual' } as BillingTierRecord
    expect(await lockBilledOverage({ referenceId: 'org-1', tier }, tx)).toBe(12)
    expect(tables).toEqual([organizationBillingLedger, organizationMemberBillingLedger])
  })

  const boundary = Date.parse('2026-05-01T00:00Z') / 1000
  const renewal = invoiceEvent({
    id: 'in_renewal',
    metadata: {},
    billing_reason: 'subscription_cycle',
    parent: { subscription_details: { subscription: 'sub_stripe' } } as Stripe.Invoice.Parent,
    collection_method: 'send_invoice',
    period_end: boundary,
    created: boundary,
    due_date: boundary + 86400 * 15,
  })
  const deletion = {
    created: boundary + 3600,
    data: {
      object: {
        id: 'sub_stripe',
        customer: 'cus_1',
        collection_method: 'charge_automatically',
        items: { data: [] },
      },
    },
  } as unknown as Stripe.CustomerSubscriptionDeletedEvent

  it('finishes the original renewal claim after cancellation and prices each usage period once', async () => {
    const row = subscriptionRow('user')
    let cost = 60
    findSubscription.mockResolvedValue(row)
    tx.select.mockImplementation(() => ({
      from: (table: unknown) =>
        queryRows(table === subscription ? [row] : [{ current: String(cost), billedOverage: '0' }]),
    }))
    const update = (table: unknown) => ({
      set: ({ metadata }: { metadata?: BillingMetadata | SQL }) => ({
        where: () => {
          if (table !== subscription) {
            cost = 0
            return
          }
          if (!(metadata instanceof SQL)) {
            row.metadata = metadata!
            return
          }
          const { sql, params } = new PgDialect().sqlToQuery(metadata)
          if (sql.includes('#-')) delete row.metadata.pendingRenewals![(params[0] as string[])[1]]
          else if (sql.includes("'true'")) row.metadata.finalInvoice!.settled = true
          else {
            const [field, key] = params[0] as string[]
            const quote =
              field === 'finalInvoice'
                ? row.metadata.finalInvoice!
                : row.metadata.pendingRenewals![key]
            quote.invoiceId = params[1] as string
          }
        },
      }),
    })
    tx.update.mockImplementation(update)
    db.update.mockImplementation(update)
    calculate.mockImplementation((_sub, store, capturedCost) => {
      expect(store).toBe(tx)
      return Math.max(0, Number(capturedCost ?? cost) - 10)
    })
    ensureDefault.mockImplementation(() => {
      if (!row.metadata.finalUsage) {
        row.metadata.finalUsage = { currentPeriodCost: String(cost), billedOverageThisPeriod: '0' }
        cost = 0
      }
      return {}
    })
    stripe.subscriptions.retrieve.mockResolvedValue({ default_payment_method: 'pm_default' })
    stripe.invoices.create
      .mockRejectedValueOnce(new Error('Stripe busy'))
      .mockImplementation(async ({ metadata }) => ({
        id: metadata.type,
        status: 'draft',
        lines: { data: [] },
      }))
    stripe.invoices.finalizeInvoice.mockResolvedValue({ status: 'open' })

    await expect(handleInvoiceFinalized(renewal)).rejects.toThrow('Stripe busy')
    expect(cost).toBe(0)
    cost = 17
    row.status = 'canceled'
    await handleStripeSubscriptionDeleted(deletion)
    cost = 4
    await handleInvoiceFinalized(renewal)
    await handleInvoiceFinalized(renewal)
    expect(cost).toBe(4)
    expect(calculate).toHaveBeenCalledTimes(2)
    const [attempt, cancellation, retry] = stripe.invoices.create.mock.calls
    expect(retry).toEqual(attempt)
    expect(retry[0]).toMatchObject({
      collection_method: 'send_invoice',
      default_payment_method: 'pm_default',
      days_until_due: 15,
    })
    expect(retry[1].idempotencyKey).toBe('overage-invoice:cus_1:sub_stripe:initial')
    expect(cancellation[0].collection_method).toBe('charge_automatically')
    expect(cancellation[0]).not.toHaveProperty('days_until_due')
    expect(cancellation[1].idempotencyKey).toBe(`overage-invoice:cus_1:sub_stripe:${boundary}`)
    expect(stripe.invoiceItems.create.mock.calls.map(([line]) => line.amount)).toEqual([700, 5000])
    expect(stripe.invoices.pay).not.toHaveBeenCalled()
  })

  it('closes a mixed-interval contract only for its own recurring item', async () => {
    const row = subscriptionRow('organization')
    Object.assign(row.metadata, {
      referenceType: 'organization',
      referenceId: row.referenceId,
      billingTierId: row.billingTierId,
      monthlyPrice: '200',
      seats: '25',
      stripeSubscriptionItemId: 'si_annual',
    })
    findSubscription.mockResolvedValue(row)
    tx.select.mockImplementation(() => ({
      from: (table: unknown) =>
        queryRows(table === subscription ? [row] : [{ billedOverage: '0' }]),
    }))
    tx.update.mockImplementation((table) => ({
      set: (values: { metadata?: BillingMetadata }) => ({
        where: () => {
          if (table === subscription) row.metadata = values.metadata!
        },
      }),
    }))
    db.update.mockReturnValue({ set: () => ({ where: vi.fn() }) })
    calculate.mockResolvedValue(0)
    const line = (item: string, proration = false) => ({
      id: `il_${item}`,
      period: { start: boundary, end: boundary + 31536000 },
      parent: { subscription_item_details: { subscription_item: item, proration } },
    })
    const event = invoiceEvent({
      ...(renewal.data.object as Stripe.Invoice),
      period_end: boundary + 60,
      lines: {
        data: [line('si_monthly'), line('si_annual', true)],
        has_more: false,
      } as Stripe.Invoice['lines'],
    })
    await handleInvoiceFinalized(event)
    expect(tx.update).not.toHaveBeenCalled()
    expect(stripe.subscriptions.retrieve).not.toHaveBeenCalled()

    const invoice = event.data.object as Stripe.Invoice
    invoice.lines.has_more = true
    stripe.invoices.listLineItems.mockReturnValue([line('si_annual')])
    await handleInvoiceFinalized(event)
    expect(stripe.invoices.listLineItems).toHaveBeenCalledWith(invoice.id, {
      starting_after: 'il_si_annual',
      limit: 100,
    })
    expect(row.metadata.renewedThrough).toBe(boundary)
    stripe.invoices.listLineItems.mockClear()
    await handleInvoiceFinalized(event)
    invoice.lines.data = [line('si_annual') as Stripe.InvoiceLineItem]
    await handleInvoiceFinalized(invoiceEvent({ ...invoice, id: 'in_same_period' }))
    expect(stripe.invoices.listLineItems).not.toHaveBeenCalled()
    expect(calculate).toHaveBeenCalledTimes(1)
    expect(
      tx.update.mock.calls.filter(([table]) => table === organizationBillingLedger)
    ).toHaveLength(1)
  })

  it.each([
    subscriptionRow('user', 'canceled'),
    subscriptionRow('user', 'active', {
      finalUsage: { currentPeriodCost: '12', billedOverageThisPeriod: '0' },
    }),
    subscriptionRow('user', 'active', {
      finalInvoice: { totalOverage: 12 } as NonNullable<BillingMetadata['finalInvoice']>,
    }),
  ])('skips a renewal when cancellation already owns its ledger', async (row) => {
    mockSubscriptions(row)
    await handleInvoiceFinalized(renewal)
    expect(calculate).not.toHaveBeenCalled()
    expect(stripe.invoices.create).not.toHaveBeenCalled()
    expect(tx.update).not.toHaveBeenCalled()
  })
})
