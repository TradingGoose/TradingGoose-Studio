import { db } from '@tradinggoose/db'
import { organization, subscription, systemBillingTier, user } from '@tradinggoose/db/schema'
import { eq } from 'drizzle-orm'
import type Stripe from 'stripe'
import { createLogger } from '@/lib/logs/console/logger'

const logger = createLogger('BillingTierPersistence')

function getStripePriceIds(stripeSubscription: Stripe.Subscription) {
  return new Set(
    stripeSubscription.items.data
      .map((item) => item.price?.id)
      .filter((priceId): priceId is string => Boolean(priceId))
  )
}

export async function syncSubscriptionBillingTierFromStripeSubscription(input: {
  subscriptionId: string
  billingTierId: string
  stripeSubscription: Stripe.Subscription
}) {
  const billingTierId = input.billingTierId.trim()
  if (!billingTierId) {
    throw new Error('Billing tier ID is required for subscription synchronization')
  }

  const [tier] = await db
    .select({
      id: systemBillingTier.id,
      displayName: systemBillingTier.displayName,
      ownerType: systemBillingTier.ownerType,
      stripeMonthlyPriceId: systemBillingTier.stripeMonthlyPriceId,
      stripeYearlyPriceId: systemBillingTier.stripeYearlyPriceId,
    })
    .from(systemBillingTier)
    .where(eq(systemBillingTier.id, billingTierId))
    .limit(1)

  if (!tier) {
    throw new Error(`Billing tier ${billingTierId} does not exist`)
  }

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

  const configuredPriceIds = [tier.stripeMonthlyPriceId, tier.stripeYearlyPriceId].filter(
    (priceId): priceId is string => Boolean(priceId)
  )
  const stripePriceIds = getStripePriceIds(input.stripeSubscription)
  if (!configuredPriceIds.some((priceId) => stripePriceIds.has(priceId))) {
    logger.error('Stripe subscription price does not match its known billing tier', {
      subscriptionId: input.subscriptionId,
      billingTierId,
      configuredPriceIds,
      stripePriceIds: [...stripePriceIds],
    })
    throw new Error(`Stripe subscription price does not match billing tier ${billingTierId}`)
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
