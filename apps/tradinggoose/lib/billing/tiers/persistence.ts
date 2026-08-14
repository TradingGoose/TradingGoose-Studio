import { db } from '@tradinggoose/db'
import { organization, subscription, systemBillingTier, user } from '@tradinggoose/db/schema'
import { and, eq, inArray, or } from 'drizzle-orm'
import type Stripe from 'stripe'
import { createLogger } from '@/lib/logs/console/logger'

const logger = createLogger('BillingTierPersistence')

function getStripeRecurringPriceIds(stripeSubscription: Stripe.Subscription) {
  return Array.from(
    new Set(
      stripeSubscription.items.data
        .filter((item) => Boolean(item.price?.recurring))
        .map((item) => item.price.id)
        .filter(Boolean)
    )
  )
}

export async function syncSubscriptionBillingTierFromStripeSubscription(input: {
  subscriptionId: string
  stripeSubscription: Stripe.Subscription
}) {
  const stripePriceIds = getStripeRecurringPriceIds(input.stripeSubscription)
  if (stripePriceIds.length === 0) {
    throw new Error(`Stripe subscription ${input.stripeSubscription.id} has no recurring price`)
  }

  const tiers = await db
    .select({
      id: systemBillingTier.id,
      displayName: systemBillingTier.displayName,
      ownerType: systemBillingTier.ownerType,
    })
    .from(systemBillingTier)
    .where(
      and(
        inArray(systemBillingTier.status, ['active', 'archived']),
        or(
          inArray(systemBillingTier.stripeMonthlyPriceId, stripePriceIds),
          inArray(systemBillingTier.stripeYearlyPriceId, stripePriceIds)
        )
      )
    )
    .limit(2)

  if (tiers.length !== 1) {
    logger.error('Stripe subscription did not resolve to exactly one billing tier', {
      stripeSubscriptionId: input.stripeSubscription.id,
      stripePriceIds,
      billingTierIds: tiers.map((tier) => tier.id),
    })
    throw new Error(
      `Stripe subscription ${input.stripeSubscription.id} matched ${tiers.length} billing tiers`
    )
  }
  const [tier] = tiers

  const [subscriptionRecord] = await db
    .select({ referenceId: subscription.referenceId })
    .from(subscription)
    .where(eq(subscription.id, input.subscriptionId))
    .limit(1)
  if (!subscriptionRecord) {
    throw new Error(`Subscription ${input.subscriptionId} does not exist`)
  }

  const referenceTable = tier.ownerType === 'organization' ? organization : user
  const [referenceRecord] = await db
    .select({ id: referenceTable.id })
    .from(referenceTable)
    .where(eq(referenceTable.id, subscriptionRecord.referenceId))
    .limit(1)
  if (!referenceRecord) {
    const referenceLabel = tier.ownerType === 'organization' ? 'an organization' : 'a user'
    throw new Error(`Subscription ${input.subscriptionId} does not reference ${referenceLabel}`)
  }

  await db
    .update(subscription)
    .set({
      billingTierId: tier.id,
      referenceType: tier.ownerType,
    })
    .where(eq(subscription.id, input.subscriptionId))

  logger.info('Synchronized subscription billing tier', {
    subscriptionId: input.subscriptionId,
    billingTierId: tier.id,
    billingTier: tier.displayName,
  })

  return tier
}
