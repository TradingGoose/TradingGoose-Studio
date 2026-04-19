import {
  getPublicBillingTiers,
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
 * Get the Better Auth Stripe plan configuration from active public billing tiers.
 */
export async function getPlans(): Promise<BillingPlan[]> {
  const tiers = await getPublicBillingTiers()

  return tiers
    .filter((tier) => Boolean(tier.stripeMonthlyPriceId))
    .map((tier) => ({
      name: tier.id,
      priceId: tier.stripeMonthlyPriceId || '',
      annualDiscountPriceId: tier.stripeYearlyPriceId || undefined,
      limits: {
        cost: getTierIncludedUsageLimit(tier) || parseBillingAmount(tier.monthlyPriceUsd) || 0,
      },
    }))
}
