import { FinancialPolicyError, lockFinancialRoots } from '@tradinggoose/billing'
import { db } from '@tradinggoose/db'
import type Stripe from 'stripe'
import {
  ensureDefaultUserSubscription,
  getSubscriptionByStripeSubscriptionId,
} from '@/lib/billing/core/subscription'
import { getEffectiveCurrentPeriodCost } from '@/lib/billing/core/usage'
import { syncSubscriptionBillingTierFromStripeSubscription } from '@/lib/billing/tiers/persistence'

/** The configured adapter freezes the original basis before its SDK status write. */
export async function handleStripeSubscriptionDeleted(event: Stripe.Event) {
  const stripeSubscription = event.data.object as Stripe.Subscription
  const original = await getSubscriptionByStripeSubscriptionId(stripeSubscription.id)
  if (!original)
    throw new FinancialPolicyError('Deleted Stripe subscription has no retained original binding')
  const item = stripeSubscription.items.data[0]
  if (!item)
    throw new FinancialPolicyError('Deleted Stripe subscription has no verified original period')
  const restored = await db.transaction(async (tx) => {
    await lockFinancialRoots(tx, [{ type: original.referenceType, id: original.referenceId }])
    await syncSubscriptionBillingTierFromStripeSubscription({
      subscriptionId: original.id,
      stripeSubscription,
      transaction: tx,
      patch: {
        status: 'canceled',
        periodStart: new Date(item.current_period_start * 1000),
        periodEnd: new Date(item.current_period_end * 1000),
        cancelAtPeriodEnd: stripeSubscription.cancel_at_period_end,
      },
    })
    // A distinct default row preserves the canceled subscription and all late financial bindings.
    // Provisioning neither grants credit nor changes configured custom limits.
    return original.referenceType === 'user'
      ? ensureDefaultUserSubscription(original.referenceId, tx)
      : null
  })
  if (restored) await getEffectiveCurrentPeriodCost(restored.referenceId)
}
