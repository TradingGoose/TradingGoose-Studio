import { db } from '@tradinggoose/db'
import { subscription } from '@tradinggoose/db/schema'
import { and, eq, ne } from 'drizzle-orm'
import type Stripe from 'stripe'
import { calculateSubscriptionOverage } from '@/lib/billing/core/billing'
import {
  ensureDefaultUserSubscription,
  getSubscriptionByStripeSubscriptionId,
} from '@/lib/billing/core/subscription'
import {
  decrementGrantedOnboardingAllowanceByCurrentPeriodUsage,
  resetUserDefaultUsageToOnboardingAllowanceBalance,
} from '@/lib/billing/core/usage'
import { syncSubscriptionUsageLimits } from '@/lib/billing/organization'
import { requireStripeClient } from '@/lib/billing/stripe-client'
import { getStripeSubscriptionFields } from '@/lib/billing/subscriptions/utils'
import {
  type BillingTierRecord,
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

/**
 * Handle subscription deletion/cancellation - bill for final period overages
 * This fires when a subscription reaches its cancel_at_period_end date or is cancelled immediately
 */
async function handleSubscriptionDeleted(
  subscription: SubscriptionWithTier,
  event: Stripe.CustomerSubscriptionDeletedEvent
) {
  try {
    const { id: stripeSubscriptionId, customer } = event.data.object

    logger.info('Processing subscription deletion', {
      stripeSubscriptionId,
      subscriptionId: subscription.id,
    })

    // Calculate overage for the final billing period
    const totalOverage = await calculateSubscriptionOverage(subscription)

    // Get already-billed overage from threshold billing
    const billedOverage = await getBilledOverageForSubscription(subscription)

    // Only bill the remaining unbilled overage
    const remainingOverage = Math.max(0, totalOverage - billedOverage)

    logger.info('Subscription deleted overage calculation', {
      subscriptionId: subscription.id,
      totalOverage,
      billedOverage,
      remainingOverage,
    })

    // Create final overage invoice if needed
    if (remainingOverage > 0) {
      const customerId = typeof customer === 'string' ? customer : customer.id
      const stripe = requireStripeClient()
      const cents = Math.round(remainingOverage * 100)
      const endedAt = subscription.endedAt ?? new Date(event.created * 1000)
      const billingPeriod = endedAt.toISOString().slice(0, 7)

      const itemIdemKey = `final-overage-item:${customerId}:${stripeSubscriptionId}:${billingPeriod}`
      const invoiceIdemKey = `final-overage-invoice:${customerId}:${stripeSubscriptionId}:${billingPeriod}`

      try {
        // Create a one-time invoice for the final overage
        const overageInvoice = await stripe.invoices.create(
          {
            customer: customerId,
            collection_method: 'charge_automatically',
            auto_advance: true, // Auto-finalize and attempt payment
            description: `Final overage charges for ${subscription.tier?.displayName || 'subscription'} (${billingPeriod})`,
            metadata: {
              type: 'final_overage_billing',
              billingPeriod,
              subscriptionId: stripeSubscriptionId,
              cancelledAt: subscription.canceledAt
                ? String(subscription.canceledAt.getTime() / 1000)
                : '',
            },
          },
          { idempotencyKey: invoiceIdemKey }
        )

        // Add the overage line item
        await stripe.invoiceItems.create(
          {
            customer: customerId,
            invoice: overageInvoice.id,
            amount: cents,
            currency: 'usd',
            description: `Usage overage for ${subscription.tier?.displayName || 'subscription'} (Final billing period)`,
            metadata: {
              type: 'final_usage_overage',
              usage: remainingOverage.toFixed(2),
              totalOverage: totalOverage.toFixed(2),
              billedOverage: billedOverage.toFixed(2),
              billingPeriod,
            },
          },
          { idempotencyKey: itemIdemKey }
        )

        // Finalize only draft invoices; duplicate webhook deliveries can return the prior invoice.
        if (overageInvoice.id && overageInvoice.status === 'draft') {
          await stripe.invoices.finalizeInvoice(overageInvoice.id)
        }

        logger.info('Created final overage invoice for cancelled subscription', {
          subscriptionId: subscription.id,
          stripeSubscriptionId,
          invoiceId: overageInvoice.id,
          totalOverage,
          billedOverage,
          remainingOverage,
          cents,
          billingPeriod,
        })
      } catch (invoiceError) {
        logger.error('Failed to create final overage invoice', {
          subscriptionId: subscription.id,
          stripeSubscriptionId,
          totalOverage,
          billedOverage,
          remainingOverage,
          error: invoiceError,
        })
        throw invoiceError
      }
    } else {
      logger.info('No overage to bill for cancelled subscription', {
        subscriptionId: subscription.id,
        billingTier: subscription.tier?.displayName,
      })
    }

    await resetUsageForSubscription(subscription)

    logger.info('Successfully processed subscription cancellation', {
      subscriptionId: subscription.id,
      stripeSubscriptionId,
      totalOverage,
    })
  } catch (error) {
    logger.error('Failed to handle subscription deletion', {
      subscriptionId: subscription.id,
      stripeSubscriptionId: subscription.stripeSubscriptionId || '',
      error,
    })
    throw error
  }
}

export async function handleStripeSubscriptionDeleted(
  event: Stripe.CustomerSubscriptionDeletedEvent
) {
  const stripeSubscription = event.data.object
  const stripeSubscriptionId = stripeSubscription.id

  const resolvedSubscription = await getSubscriptionByStripeSubscriptionId(stripeSubscriptionId)

  if (!resolvedSubscription) {
    logger.info('Deleted Stripe subscription has no local subscription row; skipping settlement', {
      eventId: event.id,
      stripeSubscriptionId,
    })
    return
  }

  // Better Auth persists the cancellation before onEvent. Let Stripe retry if that write failed.
  if (resolvedSubscription.status !== 'canceled') {
    throw new Error(
      `Cancellation for Stripe subscription ${stripeSubscriptionId} has not been saved`
    )
  }
  // Settlement talks to Stripe and can fail. Entitlement restore below must not depend on it:
  // personal Stripe subscriptions reuse the user's default subscription row, so bailing out
  // here is exactly what leaves a user with no entitled subscription at all and breaks every
  // billing read. Failures are rethrown once entitlement is safe. Settlement itself still
  // depends on this sync, because it prices the final invoice off the tier the sync writes.
  let settlementError: unknown = null

  try {
    await syncSubscriptionBillingTierFromStripeSubscription({
      subscriptionId: resolvedSubscription.id,
      stripeSubscription,
    })
  } catch (error) {
    settlementError = error
    logger.error('Failed to sync billing tier for a cancelled subscription', {
      subscriptionId: resolvedSubscription.id,
      stripeSubscriptionId,
      error,
    })
  }

  const subscriptionToSettle = await getSubscriptionByStripeSubscriptionId(stripeSubscriptionId)
  if (!subscriptionToSettle) {
    throw new Error(
      `Local subscription disappeared while settling deleted Stripe subscription ${stripeSubscriptionId}`
    )
  }

  let subscriptionForUsageLimits: TieredSubscriptionLifecycleRecord = subscriptionToSettle

  if (settlementError) {
    // The re-read above exists to pick up the tier sync's write, so a failed sync means the tier
    // driving overage pricing is unverified. Final invoices are created under a fixed idempotency
    // key, so billing against a stale allowance here would be locked in - the retry this rethrow
    // triggers would return the prior invoice rather than a corrected one.
    logger.error('Skipping final settlement because the billing tier could not be verified', {
      subscriptionId: subscriptionToSettle.id,
      referenceType: subscriptionToSettle.referenceType,
      referenceId: subscriptionToSettle.referenceId,
    })
  } else {
    try {
      const { periodStart, periodEnd } = getStripeSubscriptionFields(
        stripeSubscription,
        subscriptionToSettle.tier
      )
      if (periodStart && periodEnd) {
        await db
          .update(subscription)
          .set({ periodStart, periodEnd })
          .where(eq(subscription.stripeSubscriptionId, stripeSubscriptionId))
      }
      await handleSubscriptionDeleted(subscriptionToSettle, event)
    } catch (error) {
      settlementError = error
      logger.error('Failed to settle a cancelled subscription; restoring entitlement anyway', {
        subscriptionId: subscriptionToSettle.id,
        referenceType: subscriptionToSettle.referenceType,
        referenceId: subscriptionToSettle.referenceId,
        error,
      })
    }
  }

  // No billing-enabled gate here: a signature-verified Stripe webhook resolving to a local row
  // that carries a stripeSubscriptionId is only reachable while billing is configured and
  // running. Re-deriving that from settings only added a fallible read that could skip the
  // restore and leave the user unentitled.
  if (subscriptionToSettle.referenceType === 'user') {
    subscriptionForUsageLimits = await db.transaction(async (tx) => {
      const nextSubscription = await ensureDefaultUserSubscription(
        subscriptionToSettle.referenceId,
        tx
      )

      if (settlementError) {
        // A retry needs both the Stripe subscription ID and the unsettled paid usage.
        await tx
          .update(subscription)
          .set({ stripeSubscriptionId })
          .where(eq(subscription.id, nextSubscription.id))
      } else if (nextSubscription.tier?.isDefault && !nextSubscription.stripeSubscriptionId) {
        await resetUserDefaultUsageToOnboardingAllowanceBalance(
          subscriptionToSettle.referenceId,
          tx
        )
      }

      return nextSubscription
    })
  }

  await syncSubscriptionUsageLimits(subscriptionForUsageLimits)

  logger.info('Settled deleted Stripe subscription', {
    eventId: event.id,
    subscriptionId: subscriptionToSettle.id,
    referenceType: subscriptionToSettle.referenceType,
    referenceId: subscriptionToSettle.referenceId,
    stripeSubscriptionId,
    settlementFailed: Boolean(settlementError),
  })

  if (settlementError) {
    throw settlementError
  }
}
