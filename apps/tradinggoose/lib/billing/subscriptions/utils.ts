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
      tier?: {
        canEditUsageLimit?: boolean | null
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

  return canTierEditUsageLimit(subscription.tier)
}
