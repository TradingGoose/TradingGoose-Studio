import { canTierEditUsageLimit } from '@/lib/billing/tier-summary'

/**
 * Subscription statuses that count as active for billing purposes
 */
export const BILLING_ACTIVE_SUBSCRIPTION_STATUSES = ['active', 'trialing'] as const
export const BILLING_ENTITLED_SUBSCRIPTION_STATUSES = [
  ...BILLING_ACTIVE_SUBSCRIPTION_STATUSES,
  'past_due',
] as const

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
