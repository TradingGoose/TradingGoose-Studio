import {
  getResolvableStripeBillingTiers,
  getTierIncludedUsageLimit,
  parseBillingAmount,
} from '@/lib/billing/tiers'

interface BillingPlan {
  name: string
  priceId: string
  annualDiscountPriceId?: string
  limits: {
    cost: number
  }
}

const NEXT_BUILD_PHASE = 'phase-production-build'

export function getBetterAuthPlansConfig(): BillingPlan[] | typeof getPlans {
  return process.env.NEXT_PHASE === NEXT_BUILD_PHASE ? [] : getPlans
}

/**
 * Keep archived Stripe-backed tiers resolvable for in-flight Checkout sessions and webhooks.
 * New checkout starts are rejected by the auth route before Better Auth handles them.
 */
export async function getPlans(): Promise<BillingPlan[]> {
  const tiers = await getResolvableStripeBillingTiers()

  return tiers.map((tier) => ({
    name: tier.id,
    priceId: tier.stripeMonthlyPriceId || '',
    annualDiscountPriceId: tier.stripeYearlyPriceId || undefined,
    limits: {
      cost: getTierIncludedUsageLimit(tier) || parseBillingAmount(tier.monthlyPriceUsd) || 0,
    },
  }))
}
