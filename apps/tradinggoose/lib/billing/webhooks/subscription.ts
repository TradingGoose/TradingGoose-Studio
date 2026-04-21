import { db } from '@tradinggoose/db'
import { subscription } from '@tradinggoose/db/schema'
import { and, eq, ne } from 'drizzle-orm'
import { calculateSubscriptionOverage } from '@/lib/billing/core/billing'
import { decrementGrantedOnboardingAllowanceByCurrentPeriodUsage } from '@/lib/billing/core/usage'
import { requireStripeClient } from '@/lib/billing/stripe-client'
import { type BillingTierRecord, isPaidBillingTier } from '@/lib/billing/tiers'
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
  subscriptionData: TieredSubscriptionLifecycleRecord
) {
  try {
    const otherActiveSubscriptions = await db
      .select()
      .from(subscription)
      .where(
        and(
          eq(subscription.referenceType, subscriptionData.referenceType),
          eq(subscription.referenceId, subscriptionData.referenceId),
          eq(subscription.status, 'active'),
          ne(subscription.id, subscriptionData.id) // Exclude current subscription
        )
      )

    const wasFreePreviously = otherActiveSubscriptions.length === 0
    const isPaidPlan = isPaidBillingTier(subscriptionData.tier)
    const isPersonalSubscribedTransition =
      wasFreePreviously && subscriptionData.referenceType === 'user'
    const shouldResetUsage = isPersonalSubscribedTransition || (wasFreePreviously && isPaidPlan)

    if (shouldResetUsage) {
      logger.info('Detected free/default -> subscribed transition, resetting usage', {
        subscriptionId: subscriptionData.id,
        referenceType: subscriptionData.referenceType,
        referenceId: subscriptionData.referenceId,
        billingTier: subscriptionData.tier?.displayName,
      })

      if (isPersonalSubscribedTransition) {
        await decrementGrantedOnboardingAllowanceByCurrentPeriodUsage(subscriptionData.referenceId)
      } else {
        await resetUsageForSubscription({
          referenceId: subscriptionData.referenceId,
          tier: subscriptionData.tier,
        })
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
export async function handleSubscriptionDeleted(subscription: TieredSubscriptionLifecycleRecord) {
  try {
    const stripeSubscriptionId = subscription.stripeSubscriptionId || ''

    logger.info('Processing subscription deletion', {
      stripeSubscriptionId,
      subscriptionId: subscription.id,
    })

    // Calculate overage for the final billing period
    const totalOverage = await calculateSubscriptionOverage(subscription)
    const stripe = requireStripeClient()

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
    if (remainingOverage > 0 && stripeSubscriptionId) {
      const stripeSubscription = await stripe.subscriptions.retrieve(stripeSubscriptionId)
      const customerId = stripeSubscription.customer as string
      const cents = Math.round(remainingOverage * 100)

      // Use the subscription end date for the billing period
      const endedAt = stripeSubscription.ended_at || Math.floor(Date.now() / 1000)
      const billingPeriod = new Date(endedAt * 1000).toISOString().slice(0, 7)

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
              cancelledAt: stripeSubscription.canceled_at?.toString() || '',
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

        // Finalize the invoice (this will trigger payment collection)
        if (overageInvoice.id) {
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
        // Don't throw - we don't want to fail the webhook
      }
    } else {
      logger.info('No overage to bill for cancelled subscription', {
        subscriptionId: subscription.id,
        billingTier: subscription.tier?.displayName,
      })
    }

    // Reset usage after billing
    await resetUsageForSubscription(subscription)

    // Note: better-auth's Stripe plugin already updates status to 'canceled' before calling this handler
    // We only need to handle overage billing and usage reset

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
    throw error // Re-throw to signal webhook failure for retry
  }
}
