import { db } from '@tradinggoose/db'
import { subscription } from '@tradinggoose/db/schema'
import { eq, sql } from 'drizzle-orm'
import Stripe from 'stripe'
import { requireStripeClient } from '@/lib/billing/stripe-client'
import { createLogger } from '@/lib/logs/console/logger'

const logger = createLogger('StripeInvoiceWebhooks')

export type UsageInvoice = {
  totalOverage: number
  billedOverage: number
  billingPeriod: string
  tierName: string
  ledgerStart: number | 'initial'
  collectionMethod: Stripe.Invoice.CollectionMethod
  paymentMethod?: string
  daysUntilDue?: number
  invoiceId?: string
  settled?: boolean
}

export type BillingMetadata = {
  finalUsage?: { currentPeriodCost: string; billedOverageThisPeriod: string }
  finalInvoice?: UsageInvoice
  renewedThrough?: number
  pendingRenewals?: Record<string, UsageInvoice>
  blockedInvoices?: string[]
}

export function hasClosedLedger(sub: { status: string | null; metadata: unknown }) {
  const metadata = sub.metadata as BillingMetadata | null
  return sub.status === 'canceled' || Boolean(metadata?.finalUsage || metadata?.finalInvoice)
}

async function createUsageInvoice(
  stripe: Stripe,
  params: Stripe.InvoiceCreateParams & { customer: string; metadata: { settlementId: string } },
  resuming: boolean
) {
  const key = `overage-invoice:${params.metadata.settlementId}`
  const findInvoice = async () => {
    for await (const invoice of stripe.invoices.list({ customer: params.customer, limit: 100 })) {
      if (invoice.metadata?.settlementId === params.metadata.settlementId) return invoice
    }
  }
  if (resuming) {
    const existing = await findInvoice()
    if (existing) return existing
  }
  try {
    return await stripe.invoices.create(params, { idempotencyKey: key })
  } catch (error) {
    if (
      !params.default_payment_method ||
      !(error instanceof Stripe.errors.StripeInvalidRequestError) ||
      error.param !== 'default_payment_method'
    )
      throw error
    const existing = await findInvoice()
    if (existing) return existing
    const { default_payment_method, ...customerDefaults } = params
    return stripe.invoices.create(customerDefaults, { idempotencyKey: `${key}:customer-default` })
  }
}

export async function settleUsageInvoice(
  subscriptionId: string,
  stripeSubscriptionId: string,
  customerId: string,
  quote: UsageInvoice,
  resuming: boolean,
  renewalId?: string
) {
  if (quote.settled) return
  const path = renewalId ? ['pendingRenewals', renewalId] : ['finalInvoice']
  const key = `${customerId}:${stripeSubscriptionId}:${quote.ledgerStart}`
  const cents = Math.round(Math.max(0, quote.totalOverage - quote.billedOverage) * 100)
  if (cents > 0) {
    const stripe = requireStripeClient()
    const type = renewalId ? 'overage_billing' : 'final_overage_billing'
    const metadata = {
      type,
      billingPeriod: quote.billingPeriod,
      subscriptionId: stripeSubscriptionId,
      settlementId: key,
    }
    const draft = quote.invoiceId
      ? await stripe.invoices.retrieve(quote.invoiceId)
      : await createUsageInvoice(
          stripe,
          {
            customer: customerId,
            collection_method: quote.collectionMethod,
            ...(quote.paymentMethod && { default_payment_method: quote.paymentMethod }),
            ...(quote.daysUntilDue !== undefined && { days_until_due: quote.daysUntilDue }),
            auto_advance: false,
            description: `Usage overage for ${quote.tierName} (${quote.billingPeriod})`,
            metadata,
          },
          resuming
        )
    if (!quote.invoiceId) {
      await db
        .update(subscription)
        .set({
          metadata: sql`jsonb_set(${subscription.metadata}::jsonb, ${sql.param([...path, 'invoiceId'])}::text[], to_jsonb(${draft.id}::text))`,
        })
        .where(eq(subscription.id, subscriptionId))
    }
    let collectible = draft
    if (draft.status === 'draft') {
      if (!draft.lines.data.some((line) => line.metadata?.type === type)) {
        await stripe.invoiceItems.create(
          {
            customer: customerId,
            invoice: draft.id,
            amount: cents,
            currency: 'usd',
            description: `Usage overage for ${quote.tierName} (${quote.billingPeriod})`,
            metadata,
          },
          { idempotencyKey: `overage-item:${key}` }
        )
      }
      collectible = await stripe.invoices.finalizeInvoice(
        draft.id,
        { auto_advance: true },
        {
          idempotencyKey: `overage-finalize:${key}`,
        }
      )
    }
    if (
      renewalId &&
      quote.collectionMethod === 'charge_automatically' &&
      collectible.status === 'open'
    ) {
      try {
        await stripe.invoices.pay(
          collectible.id,
          {},
          {
            idempotencyKey: `overage-pay:${key}`,
          }
        )
      } catch (error) {
        logger.error('Failed to auto-pay overage invoice', { error, invoiceId: collectible.id })
      }
    }
  }
  await db
    .update(subscription)
    .set({
      metadata: renewalId
        ? sql`${subscription.metadata}::jsonb #- ${sql.param(path)}::text[]`
        : sql`jsonb_set(${subscription.metadata}::jsonb, '{finalInvoice,settled}', 'true')`,
    })
    .where(eq(subscription.id, subscriptionId))
}
