import { db } from '@tradinggoose/db'
import { subscription } from '@tradinggoose/db/schema'
import { and, eq, ne, sql } from 'drizzle-orm'
import type Stripe from 'stripe'
import { calculateSubscriptionOverage } from '@/lib/billing/core/billing'
import {
  ensureDefaultUserSubscription,
  getSubscriptionByStripeSubscriptionId,
} from '@/lib/billing/core/subscription'
import { decrementGrantedOnboardingAllowanceByCurrentPeriodUsage } from '@/lib/billing/core/usage'
import { syncSubscriptionUsageLimits } from '@/lib/billing/organization'
import { requireStripeClient } from '@/lib/billing/stripe-client'
import { getStripeSubscriptionFields } from '@/lib/billing/subscriptions/utils'
import {
  type BillingTierRecord,
  hydrateSubscriptionsWithTiers,
  isPaidBillingTier,
  type SubscriptionWithTier,
} from '@/lib/billing/tiers'
import { syncSubscriptionBillingTierFromStripeSubscription } from '@/lib/billing/tiers/persistence'
import {
  getBilledOverageForSubscription,
  resetUsageForSubscription,
} from '@/lib/billing/webhooks/invoices'
import { createLogger } from '@/lib/logs/console/logger'

const logger = createLogger('StripeSubscriptionWebhooks')

type TieredSubscriptionLifecycleRecord = {
  id: string
  referenceType: 'user' | 'organization'
  referenceId: string
  status: string | null
  stripeSubscriptionId?: string | null
  seats?: number | null
  tier?: BillingTierRecord | null
}

/**
 * Handle new subscription creation - reset usage if transitioning from free/default to subscribed
 */
export async function handleSubscriptionCreated(
  subscriptionData: TieredSubscriptionLifecycleRecord,
  dbClient: Pick<typeof db, 'select' | 'update'> = db
) {
  try {
    const otherActiveSubscriptions = await dbClient
      .select()
      .from(subscription)
      .where(
        and(
          eq(subscription.referenceType, subscriptionData.referenceType),
          eq(subscription.referenceId, subscriptionData.referenceId),
          eq(subscription.status, 'active'),
          ne(subscription.id, subscriptionData.id)
        )
      )

    const wasFreePreviously = otherActiveSubscriptions.length === 0
    const isPaidPlan = isPaidBillingTier(subscriptionData.tier)
    const isPersonalDefaultPathExit = wasFreePreviously && subscriptionData.referenceType === 'user'
    const shouldResetUsage = isPersonalDefaultPathExit || (wasFreePreviously && isPaidPlan)

    if (shouldResetUsage) {
      logger.info('Detected free/default -> subscribed transition, resetting usage', {
        subscriptionId: subscriptionData.id,
        referenceType: subscriptionData.referenceType,
        referenceId: subscriptionData.referenceId,
        billingTier: subscriptionData.tier?.displayName,
      })

      if (isPersonalDefaultPathExit) {
        // Leaving the default personal path settles already-consumed onboarding credit before
        // resetting the period ledger. This applies to paid upgrades too because cancellation
        // falls back to the default tier.
        await decrementGrantedOnboardingAllowanceByCurrentPeriodUsage(
          subscriptionData.referenceId,
          dbClient
        )
      } else {
        await resetUsageForSubscription(
          {
            referenceId: subscriptionData.referenceId,
            tier: subscriptionData.tier,
          },
          dbClient
        )
      }

      logger.info('Successfully reset usage for free/default -> subscribed transition', {
        subscriptionId: subscriptionData.id,
        referenceType: subscriptionData.referenceType,
        referenceId: subscriptionData.referenceId,
        billingTier: subscriptionData.tier?.displayName,
      })
    } else {
      logger.info('No usage reset needed', {
        subscriptionId: subscriptionData.id,
        referenceType: subscriptionData.referenceType,
        referenceId: subscriptionData.referenceId,
        billingTier: subscriptionData.tier?.displayName,
        wasFreePreviously,
        isPaidPlan,
        otherActiveSubscriptionsCount: otherActiveSubscriptions.length,
      })
    }
  } catch (error) {
    logger.error('Failed to handle subscription creation usage reset', {
      subscriptionId: subscriptionData.id,
      referenceType: subscriptionData.referenceType,
      referenceId: subscriptionData.referenceId,
      error,
    })
    throw error
  }
}

type FinalInvoice = {
  totalOverage: number
  billedOverage: number
  billingPeriod: string
  tierName: string
  cancelledAt: string
}

export type ClosingMetadata = {
  finalUsage?: { currentPeriodCost: string; billedOverageThisPeriod: string }
  finalInvoice?: FinalInvoice
  finalInvoiceId?: string
  finalInvoiceSettled?: boolean
}

async function billFinalOverage(
  sub: SubscriptionWithTier,
  event: Stripe.CustomerSubscriptionDeletedEvent
) {
  const { id: stripeSubscriptionId, customer } = event.data.object
  const customerId = typeof customer === 'string' ? customer : customer.id
  const metadata = sub.metadata as ClosingMetadata
  const quote = metadata.finalInvoice!
  const amount = Math.max(0, quote.totalOverage - quote.billedOverage)
  const cents = Math.round(amount * 100)
  const key = `${customerId}:${stripeSubscriptionId}:${quote.billingPeriod}`
  const record = (fields: Pick<ClosingMetadata, 'finalInvoiceId' | 'finalInvoiceSettled'>) =>
    db
      .update(subscription)
      .set({
        metadata: sql`${subscription.metadata}::jsonb || ${JSON.stringify(fields)}::jsonb`,
      })
      .where(eq(subscription.id, sub.id))

  if (cents > 0) {
    const stripe = requireStripeClient()
    const invoice = metadata.finalInvoiceId
      ? await stripe.invoices.retrieve(metadata.finalInvoiceId)
      : await stripe.invoices.create(
          {
            customer: customerId,
            collection_method: 'charge_automatically',
            auto_advance: false,
            description: `Final overage charges for ${quote.tierName} (${quote.billingPeriod})`,
            metadata: {
              type: 'final_overage_billing',
              billingPeriod: quote.billingPeriod,
              subscriptionId: stripeSubscriptionId,
              cancelledAt: quote.cancelledAt,
            },
          },
          { idempotencyKey: `final-overage-invoice:${key}` }
        )
    if (!metadata.finalInvoiceId) await record({ finalInvoiceId: invoice.id })

    if (invoice.status === 'draft') {
      if (!invoice.lines.data.some((line) => line.metadata?.type === 'final_usage_overage')) {
        await stripe.invoiceItems.create(
          {
            customer: customerId,
            invoice: invoice.id,
            amount: cents,
            currency: 'usd',
            description: `Usage overage for ${quote.tierName} (Final billing period)`,
            metadata: {
              type: 'final_usage_overage',
              usage: amount.toFixed(2),
              totalOverage: quote.totalOverage.toFixed(2),
              billedOverage: quote.billedOverage.toFixed(2),
              billingPeriod: quote.billingPeriod,
            },
          },
          { idempotencyKey: `final-overage-item:${key}` }
        )
      }
      await stripe.invoices.finalizeInvoice(
        invoice.id,
        { auto_advance: true },
        {
          idempotencyKey: `final-overage-finalize:${key}`,
        }
      )
    }
  }
  await record({ finalInvoiceSettled: true })
}

export async function handleStripeSubscriptionDeleted(
  event: Stripe.CustomerSubscriptionDeletedEvent
) {
  const stripeSubscription = event.data.object
  const sub = await getSubscriptionByStripeSubscriptionId(stripeSubscription.id)
  if (!sub) return
  if (sub.status !== 'canceled') {
    throw new Error(
      `Cancellation for Stripe subscription ${stripeSubscription.id} has not been saved`
    )
  }
  const previous = sub.metadata as ClosingMetadata | null
  if (previous?.finalInvoiceSettled) return

  if (sub.referenceType === 'user') {
    const active = await ensureDefaultUserSubscription(sub.referenceId, db, sub.id)
    await syncSubscriptionUsageLimits(active)
  }
  let closing = sub
  if (!previous?.finalInvoice) {
    await syncSubscriptionBillingTierFromStripeSubscription({
      subscriptionId: sub.id,
      stripeSubscription,
    })
    closing = await db.transaction(async (tx) => {
      const [row] = await tx
        .select()
        .from(subscription)
        .where(eq(subscription.id, sub.id))
        .for('update')
      if (!row) throw new Error(`Subscription ${sub.id} disappeared during cancellation`)
      const [paid] = await hydrateSubscriptionsWithTiers([row], tx)
      if (!paid) throw new Error(`Missing billing tier for canceled subscription ${row.id}`)
      const metadata = paid.metadata as ClosingMetadata | null
      if (metadata?.finalInvoice) return paid

      const usage = metadata?.finalUsage
      if (paid.referenceType === 'user' && !usage)
        throw new Error(`Missing closing usage for ${paid.id}`)
      const quote: FinalInvoice = {
        totalOverage: await calculateSubscriptionOverage(
          paid,
          tx,
          usage && Number(usage.currentPeriodCost)
        ),
        billedOverage: usage
          ? Number(usage.billedOverageThisPeriod)
          : await getBilledOverageForSubscription(paid, tx),
        tierName: paid.tier.displayName,
        billingPeriod: (paid.endedAt ?? new Date(event.created * 1000)).toISOString().slice(0, 7),
        cancelledAt: paid.canceledAt ? String(paid.canceledAt.getTime() / 1000) : '',
      }
      const { periodStart, periodEnd } = getStripeSubscriptionFields(stripeSubscription, paid.tier)
      const updated = { ...metadata, finalInvoice: quote }
      await tx
        .update(subscription)
        .set({
          ...(periodStart && periodEnd ? { periodStart, periodEnd } : {}),
          metadata: updated,
        })
        .where(eq(subscription.id, paid.id))
      if (paid.referenceType === 'organization') await resetUsageForSubscription(paid, tx)
      return { ...paid, metadata: updated }
    })
  }
  if (closing.referenceType === 'organization') await syncSubscriptionUsageLimits(closing)
  if (!(closing.metadata as ClosingMetadata).finalInvoiceSettled)
    await billFinalOverage(closing, event)
}
