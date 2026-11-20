import type Stripe from 'stripe'
import { canTierEditUsageLimit } from '@/lib/billing/tier-summary'
import type { BillingTierRecord } from '@/lib/billing/tiers'

/**
 * Subscription statuses that count as active for billing purposes
 */
export const BILLING_ACTIVE_SUBSCRIPTION_STATUSES = ['active', 'trialing'] as const
export const BILLING_ENTITLED_SUBSCRIPTION_STATUSES = [
  ...BILLING_ACTIVE_SUBSCRIPTION_STATUSES,
  'past_due',
] as const

function stripeDate(timestamp: number | null | undefined) {
  return timestamp == null ? null : new Date(timestamp * 1000)
}

export function getStripeSubscriptionPlanItem(
  subscription: Stripe.Subscription,
  tier: Pick<BillingTierRecord, 'stripeMonthlyPriceId' | 'stripeYearlyPriceId'>
) {
  const items = subscription.items.data
  return items.length === 1
    ? items[0]
    : items.find(
        ({ price }) =>
          price.id === tier.stripeMonthlyPriceId || price.id === tier.stripeYearlyPriceId
      )
}

export function getStripeSubscriptionFields(
  subscription: Stripe.Subscription,
  item: Stripe.SubscriptionItem | undefined
) {
  return {
    periodStart: stripeDate(item?.current_period_start),
    periodEnd: stripeDate(item?.current_period_end),
    trialStart: stripeDate(subscription.trial_start),
    trialEnd: stripeDate(subscription.trial_end),
    cancelAtPeriodEnd: subscription.cancel_at_period_end,
    cancelAt: stripeDate(subscription.cancel_at),
    canceledAt: stripeDate(subscription.canceled_at),
    endedAt: stripeDate(subscription.ended_at),
    billingInterval: item?.price.recurring?.interval ?? null,
    stripeScheduleId:
      typeof subscription.schedule === 'string'
        ? subscription.schedule
        : (subscription.schedule?.id ?? null),
  }
}

type ActiveSubscriptionLike =
  | {
      status: string | null
      referenceType?: string | null
      stripeSubscriptionId?: string | null
      tier?: {
        canEditUsageLimit?: boolean | null
        ownerType?: string | null
      } | null
    }
  | null
  | undefined

/**
 * Check if a user can edit their usage limits based on their subscription
 * @param subscription The subscription object
 * @returns Whether the user can edit their usage limits
 */
export function canEditUsageLimit(subscription: ActiveSubscriptionLike): boolean {
  if (!subscription || subscription.status !== 'active') {
    return false
  }

  if (!canTierEditUsageLimit(subscription.tier)) {
    return false
  }

  const isPersonalSubscription =
    subscription.referenceType === 'user' || subscription.tier?.ownerType === 'user'

  if (isPersonalSubscription && !subscription.stripeSubscriptionId) {
    return false
  }

  return true
}
