import { db } from '@tradinggoose/db'
import { subscription, systemBillingTier } from '@tradinggoose/db/schema'
import { eq, inArray, or } from 'drizzle-orm'
import type Stripe from 'stripe'
import { createLogger } from '@/lib/logs/console/logger'

const logger = createLogger('BillingTierPersistence')

type BillingTierCandidate = {
  id: string
  displayName: string
  ownerType: 'user' | 'organization'
  stripeMonthlyPriceId: string | null
  stripeYearlyPriceId: string | null
  stripeProductId: string | null
}

type BillingTierMatchField =
  | 'id'
  | 'stripeMonthlyPriceId'
  | 'stripeYearlyPriceId'
  | 'stripeProductId'

interface BillingTierResolutionInput {
  billingTierId?: string | null
  stripePriceIds?: Array<string | null | undefined>
  stripeProductIds?: Array<string | null | undefined>
}

interface BillingTierSyncInput extends BillingTierResolutionInput {
  subscriptionId: string
}

function compactUnique(values: Array<string | null | undefined>): string[] {
  return Array.from(new Set(values.filter((value): value is string => Boolean(value?.trim()))))
}

function getStripeIdentifiers(stripeSubscription: Stripe.Subscription | null | undefined) {
  const items = stripeSubscription?.items?.data ?? []

  return {
    stripePriceIds: compactUnique(items.map((item) => item.price?.id)),
    stripeProductIds: compactUnique(
      items.map((item) =>
        typeof item.price?.product === 'string' ? item.price.product : item.price?.product?.id
      )
    ),
  }
}

function getMatchField(
  candidate: BillingTierCandidate,
  {
    billingTierId,
    stripePriceIds,
    stripeProductIds,
  }: {
    billingTierId?: string | null
    stripePriceIds: string[]
    stripeProductIds: string[]
  }
): BillingTierMatchField | null {
  if (billingTierId && candidate.id === billingTierId) {
    return 'id'
  }

  if (candidate.stripeMonthlyPriceId && stripePriceIds.includes(candidate.stripeMonthlyPriceId)) {
    return 'stripeMonthlyPriceId'
  }

  if (candidate.stripeYearlyPriceId && stripePriceIds.includes(candidate.stripeYearlyPriceId)) {
    return 'stripeYearlyPriceId'
  }

  if (candidate.stripeProductId && stripeProductIds.includes(candidate.stripeProductId)) {
    return 'stripeProductId'
  }

  return null
}

export async function resolveBillingTierForPersistence(input: BillingTierResolutionInput): Promise<{
  id: string
  displayName: string
  ownerType: 'user' | 'organization'
  matchedBy: BillingTierMatchField
}> {
  const billingTierId = input.billingTierId?.trim() || null
  const stripePriceIds = compactUnique(input.stripePriceIds ?? [])
  const stripeProductIds = compactUnique(input.stripeProductIds ?? [])
  const conditions = []

  if (billingTierId) {
    conditions.push(eq(systemBillingTier.id, billingTierId))
  }

  if (stripePriceIds.length > 0) {
    conditions.push(inArray(systemBillingTier.stripeMonthlyPriceId, stripePriceIds))
    conditions.push(inArray(systemBillingTier.stripeYearlyPriceId, stripePriceIds))
  }

  if (stripeProductIds.length > 0) {
    conditions.push(inArray(systemBillingTier.stripeProductId, stripeProductIds))
  }

  if (conditions.length === 0) {
    throw new Error('Billing tier resolution requires a tier id or Stripe identifiers')
  }

  const candidates = await db
    .select({
      id: systemBillingTier.id,
      displayName: systemBillingTier.displayName,
      ownerType: systemBillingTier.ownerType,
      stripeMonthlyPriceId: systemBillingTier.stripeMonthlyPriceId,
      stripeYearlyPriceId: systemBillingTier.stripeYearlyPriceId,
      stripeProductId: systemBillingTier.stripeProductId,
    })
    .from(systemBillingTier)
    .where(or(...conditions))

  if (candidates.length === 0) {
    logger.error('Failed to resolve billing tier', {
      billingTierId,
      stripePriceIds,
      stripeProductIds,
    })
    throw new Error('No billing tier matched the provided tier or Stripe identifiers')
  }

  const priorities: BillingTierMatchField[] = [
    'id',
    'stripeMonthlyPriceId',
    'stripeYearlyPriceId',
    'stripeProductId',
  ]

  for (const matchedBy of priorities) {
    const matches = candidates.filter(
      (candidate) =>
        getMatchField(candidate, {
          billingTierId,
          stripePriceIds,
          stripeProductIds,
        }) === matchedBy
    )

    if (matches.length === 0) {
      continue
    }

    if (matches.length > 1) {
      logger.error('Billing tier resolution was ambiguous', {
        matchedBy,
        billingTierId,
        stripePriceIds,
        stripeProductIds,
        tierIds: matches.map((match) => match.id),
        billingTiers: matches.map((match) => match.displayName),
      })
      throw new Error(`Billing tier resolution was ambiguous for ${matchedBy}`)
    }

    return {
      id: matches[0].id,
      displayName: matches[0].displayName,
      ownerType: matches[0].ownerType,
      matchedBy,
    }
  }

  logger.error('Billing tier candidates were returned without a usable match', {
    billingTierId,
    stripePriceIds,
    stripeProductIds,
    tierIds: candidates.map((candidate) => candidate.id),
  })
  throw new Error('Billing tier candidates were returned without a usable match')
}

export async function syncSubscriptionBillingTier({
  subscriptionId,
  billingTierId,
  stripePriceIds,
  stripeProductIds,
}: BillingTierSyncInput): Promise<{
  id: string
  displayName: string
  matchedBy: BillingTierMatchField
}> {
  const tier = await resolveBillingTierForPersistence({
    billingTierId,
    stripePriceIds,
    stripeProductIds,
  })

  await db
    .update(subscription)
    .set({
      billingTierId: tier.id,
      referenceType: tier.ownerType,
    })
    .where(eq(subscription.id, subscriptionId))

  logger.info('Synchronized subscription billing tier', {
    subscriptionId,
    billingTierId: tier.id,
    billingTier: tier.displayName,
    matchedBy: tier.matchedBy,
  })

  return tier
}

export async function syncSubscriptionBillingTierFromStripeSubscription(
  subscriptionId: string,
  stripeSubscription: Stripe.Subscription | null | undefined
): Promise<{ id: string; displayName: string; matchedBy: BillingTierMatchField }> {
  const { stripePriceIds, stripeProductIds } = getStripeIdentifiers(stripeSubscription)

  return syncSubscriptionBillingTier({
    subscriptionId,
    stripePriceIds,
    stripeProductIds,
  })
}
