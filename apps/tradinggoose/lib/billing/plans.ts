import {
  getActiveStripeBackedBillingTiers,
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
 * Get Better Auth Stripe plans from active Stripe price-backed billing tiers.
 */
export async function getPlans(): Promise<BillingPlan[]> {
  const tiers = await getActiveStripeBackedBillingTiers()

  return tiers.map((tier) => ({
    name: tier.id,
    priceId: tier.stripeMonthlyPriceId ?? tier.stripeYearlyPriceId!,
    annualDiscountPriceId:
      tier.stripeMonthlyPriceId && tier.stripeYearlyPriceId ? tier.stripeYearlyPriceId : undefined,
    limits: {
      cost: getTierIncludedUsageLimit(tier) || parseBillingAmount(tier.monthlyPriceUsd) || 0,
    },
  }))
}
