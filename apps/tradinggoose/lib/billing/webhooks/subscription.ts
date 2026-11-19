import { db } from '@tradinggoose/db'
import { subscription } from '@tradinggoose/db/schema'
import { and, eq, ne } from 'drizzle-orm'
import type Stripe from 'stripe'
import { calculateSubscriptionOverage } from '@/lib/billing/core/billing'
import {
  ensureDefaultUserSubscription,
  getSubscriptionRowByStripeId,
} from '@/lib/billing/core/subscription'
import { decrementGrantedOnboardingAllowanceByCurrentPeriodUsage } from '@/lib/billing/core/usage'
import { syncSubscriptionUsageLimits } from '@/lib/billing/organization'
import { getStripeSubscriptionFields } from '@/lib/billing/subscriptions/utils'
import {
  type BillingTierRecord,
  hydrateSubscriptionsWithTiers,
  isPaidBillingTier,
} from '@/lib/billing/tiers'
import { syncSubscriptionBillingTierFromStripeSubscription } from '@/lib/billing/tiers/persistence'
import { lockBilledOverage, resetUsageForSubscription } from '@/lib/billing/webhooks/invoices'
import { createLogger } from '@/lib/logs/console/logger'
import { type BillingMetadata, settleUsageInvoice, type UsageInvoice } from './overage'

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

export async function handleStripeSubscriptionDeleted(
  event: Stripe.CustomerSubscriptionDeletedEvent
) {
  const stripeSubscription = event.data.object
  const sub = await getSubscriptionRowByStripeId(stripeSubscription.id)
  if (!sub) return
  if (sub.status !== 'canceled') {
    throw new Error(
      `Cancellation for Stripe subscription ${stripeSubscription.id} has not been saved`
    )
  }
  const previous = sub.metadata as BillingMetadata | null
  if (previous?.finalInvoice?.settled) return

  // A native Stripe row may not yet have a Studio tier or its resolved owner type.
  let ownerType = sub.billingTierId ? sub.referenceType : undefined
  try {
    if (!previous?.finalInvoice) {
      const tier = await syncSubscriptionBillingTierFromStripeSubscription({
        subscriptionId: sub.id,
        stripeSubscription,
      })
      ownerType = tier.ownerType
    }
  } finally {
    if (ownerType === 'user') {
      const active = await ensureDefaultUserSubscription(sub.referenceId, db, sub.id)
      await syncSubscriptionUsageLimits(active)
    }
  }
  const { closing, resuming } = await db.transaction(async (tx) => {
    const [row] = await tx
      .select()
      .from(subscription)
      .where(eq(subscription.id, sub.id))
      .for('update')
    if (!row) throw new Error(`Subscription ${sub.id} disappeared during cancellation`)
    const [paid] = await hydrateSubscriptionsWithTiers([row], tx)
    if (!paid) throw new Error(`Missing billing tier for canceled subscription ${row.id}`)
    const metadata = paid.metadata as BillingMetadata | null
    if (metadata?.finalInvoice) return { closing: paid, resuming: true }

    const usage = metadata?.finalUsage
    if (paid.referenceType === 'user' && !usage)
      throw new Error(`Missing closing usage for ${paid.id}`)
    const billedOverage = usage
      ? Number(usage.billedOverageThisPeriod)
      : await lockBilledOverage(paid, tx)
    const quote: UsageInvoice = {
      totalOverage:
        billedOverage === undefined
          ? 0
          : await calculateSubscriptionOverage(paid, tx, usage && Number(usage.currentPeriodCost)),
      billedOverage: billedOverage ?? 0,
      tierName: paid.tier.displayName,
      billingPeriod: (paid.endedAt ?? new Date(event.created * 1000)).toISOString().slice(0, 7),
      ledgerStart: metadata?.renewedThrough ?? 'initial',
      collectionMethod: 'charge_automatically',
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
    if (paid.referenceType === 'organization' && billedOverage !== undefined)
      await resetUsageForSubscription(paid, tx)
    return { closing: { ...paid, metadata: updated }, resuming: false }
  })
  if (closing.referenceType === 'organization') await syncSubscriptionUsageLimits(closing)
  const customer = stripeSubscription.customer
  await settleUsageInvoice(
    closing.id,
    stripeSubscription.id,
    typeof customer === 'string' ? customer : customer.id,
    (closing.metadata as BillingMetadata).finalInvoice!,
    resuming
  )
}
