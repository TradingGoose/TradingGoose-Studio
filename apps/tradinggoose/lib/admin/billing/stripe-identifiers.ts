import type { db } from '@tradinggoose/db'
import { systemBillingTier } from '@tradinggoose/db/schema'
import { and, eq, inArray, ne, or, sql } from 'drizzle-orm'
import type { AdminBillingTierMutationInput } from '@/lib/admin/billing/tier-mutations'
import { requireStripeClient } from '@/lib/billing/stripe-client'
import { buildPlanChangePortalCatalog } from '@/lib/billing/stripe-portal'
import type { BillingTierRecord } from '@/lib/billing/tiers'
import { getActiveStripeBillingTiers, getBillingTierById } from '@/lib/billing/tiers'

const BILLING_TIER_STRIPE_IDENTIFIER_LOCK = 4_126_093

export class BillingTierStripeIdentifierError extends Error {}

function getStripeCatalogRevision(tiers: BillingTierRecord[]) {
  return tiers
    .map((tier) =>
      JSON.stringify([
        tier.id,
        tier.stripeMonthlyPriceId,
        tier.stripeYearlyPriceId,
        tier.stripeProductId,
      ])
    )
    .sort()
    .join()
}

export async function validateBillingTierStripeCatalog(
  input: AdminBillingTierMutationInput & { id: string }
) {
  if (input.status !== 'active' || (await getBillingTierById(input.id))?.status === 'active') {
    return null
  }
  const activeTiers = (await getActiveStripeBillingTiers()).filter((tier) => tier.id !== input.id)
  await buildPlanChangePortalCatalog(requireStripeClient(), [...activeTiers, input])
  return getStripeCatalogRevision(activeTiers)
}

export async function validateBillingTierStripeMutation(
  tx: Pick<typeof db, 'execute' | 'select'>,
  input: AdminBillingTierMutationInput & { id: string },
  catalogRevision: string | null = null
) {
  await tx.execute(sql`select pg_advisory_xact_lock(${BILLING_TIER_STRIPE_IDENTIFIER_LOCK})`)
  if (catalogRevision !== null) {
    const activeTiers = (await getActiveStripeBillingTiers(tx)).filter(
      (tier) => tier.id !== input.id
    )
    if (getStripeCatalogRevision(activeTiers) !== catalogRevision) {
      throw new BillingTierStripeIdentifierError('Billing tier catalog changed; retry the request')
    }
  }
  const [existingTier] = await tx
    .select()
    .from(systemBillingTier)
    .where(eq(systemBillingTier.id, input.id))
    .limit(1)

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
      .where(and(ne(systemBillingTier.id, input.id), or(...identifierConditions)))
      .limit(1)

    if (conflicts.length > 0) {
      throw new BillingTierStripeIdentifierError(
        'Stripe product and price IDs must be unique across all billing tiers'
      )
    }
  }

  return existingTier
}

export function isBillingTierStripeIdentifierError(
  error: unknown
): error is BillingTierStripeIdentifierError {
  return error instanceof BillingTierStripeIdentifierError
}
