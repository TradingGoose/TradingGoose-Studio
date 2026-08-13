import type { db } from '@tradinggoose/db'
import { systemBillingTier } from '@tradinggoose/db/schema'
import { and, eq, inArray, ne, or, sql } from 'drizzle-orm'
import type { AdminBillingTierMutationInput } from '@/lib/admin/billing/tier-mutations'

const BILLING_TIER_STRIPE_IDENTIFIER_LOCK = 4_126_093
const STRIPE_PORTAL_PRODUCT_LIMIT = 10

export class BillingTierStripeIdentifierError extends Error {}

export async function assertBillingTierStripeIdentifiers(
  tx: Pick<typeof db, 'execute' | 'select'>,
  input: Pick<
    AdminBillingTierMutationInput,
    'status' | 'stripeMonthlyPriceId' | 'stripeYearlyPriceId' | 'stripeProductId'
  > & { excludeTierId?: string }
) {
  await tx.execute(sql`select pg_advisory_xact_lock(${BILLING_TIER_STRIPE_IDENTIFIER_LOCK})`)

  const priceIds = [input.stripeMonthlyPriceId, input.stripeYearlyPriceId].filter(
    (priceId): priceId is string => Boolean(priceId)
  )
  const identifierConditions = [
    ...(priceIds.length > 0
      ? [
          inArray(systemBillingTier.stripeMonthlyPriceId, priceIds),
          inArray(systemBillingTier.stripeYearlyPriceId, priceIds),
        ]
      : []),
    ...(input.stripeProductId
      ? [eq(systemBillingTier.stripeProductId, input.stripeProductId)]
      : []),
  ]

  if (identifierConditions.length > 0) {
    const conflicts = await tx
      .select({ id: systemBillingTier.id })
      .from(systemBillingTier)
      .where(
        and(
          input.excludeTierId ? ne(systemBillingTier.id, input.excludeTierId) : undefined,
          or(...identifierConditions)
        )
      )
      .limit(1)

    if (conflicts.length > 0) {
      throw new BillingTierStripeIdentifierError(
        'Stripe product and price IDs must be unique across all billing tiers'
      )
    }
  }

  if (input.status !== 'active' || !input.stripeMonthlyPriceId) {
    return
  }
  if (!input.stripeProductId) {
    throw new BillingTierStripeIdentifierError(
      'Active Stripe-backed tiers must configure a Stripe product ID'
    )
  }

  const activeTiers = await tx
    .select({
      id: systemBillingTier.id,
      stripeMonthlyPriceId: systemBillingTier.stripeMonthlyPriceId,
      stripeProductId: systemBillingTier.stripeProductId,
    })
    .from(systemBillingTier)
    .where(eq(systemBillingTier.status, 'active'))

  const activeProductIds = new Set(
    activeTiers
      .filter((tier) => tier.id !== input.excludeTierId && Boolean(tier.stripeMonthlyPriceId))
      .map((tier) => {
        if (!tier.stripeProductId) {
          throw new BillingTierStripeIdentifierError(
            `Active Stripe tier ${tier.id} has no Stripe product ID`
          )
        }
        return tier.stripeProductId
      })
  )
  activeProductIds.add(input.stripeProductId)

  if (activeProductIds.size > STRIPE_PORTAL_PRODUCT_LIMIT) {
    throw new BillingTierStripeIdentifierError(
      `Stripe Billing Portal supports at most ${STRIPE_PORTAL_PRODUCT_LIMIT} active plan products`
    )
  }
}

export function isBillingTierStripeIdentifierError(
  error: unknown
): error is BillingTierStripeIdentifierError {
  return error instanceof BillingTierStripeIdentifierError
}
