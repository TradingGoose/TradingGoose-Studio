import { db } from '@tradinggoose/db'
import { organization, subscription, user } from '@tradinggoose/db/schema'
import { eq, sql } from 'drizzle-orm'
import type Stripe from 'stripe'
import {
  getEmailSubject,
  renderEnterpriseSubscriptionEmail,
} from '@/components/emails/render-email'
import { requireStripeClient } from '@/lib/billing/stripe-client'
import { getStoredStripeUserCustomerId } from '@/lib/billing/stripe-customers'
import { getStripeSubscriptionFields } from '@/lib/billing/subscriptions/utils'
import {
  getTierIncludedUsageLimit,
  isOrganizationBillingTier,
  requireBillingTierById,
} from '@/lib/billing/tiers'
import { resolveEmailLocale } from '@/lib/email/locale'
import { sendEmail } from '@/lib/email/mailer'
import { createLogger } from '@/lib/logs/console/logger'
import type { EnterpriseSubscriptionMetadata } from '../types'

const logger = createLogger('BillingEnterprise')

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

function isManualContractMetadata(value: unknown): value is EnterpriseSubscriptionMetadata {
  return (
    !!value &&
    typeof value === 'object' &&
    'referenceType' in value &&
    'referenceId' in value &&
    'billingTierId' in value &&
    'monthlyPrice' in value &&
    'seats' in value &&
    value.referenceType === 'organization' &&
    isNonEmptyString(value.referenceId) &&
    isNonEmptyString(value.billingTierId) &&
    isNonEmptyString(value.monthlyPrice) &&
    isNonEmptyString(value.seats)
  )
}

export function getStoredManualContract(value: unknown) {
  if (
    !isManualContractMetadata(value) ||
    !('stripeSubscriptionItemId' in value) ||
    !isNonEmptyString(value.stripeSubscriptionItemId)
  )
    return
  return {
    itemId: value.stripeSubscriptionItemId,
    terms: {
      plan: value.billingTierId,
      billingTierId: value.billingTierId,
      seats: Number.parseInt(value.seats, 10),
    },
  }
}

export async function getStripeSubscriptionItems(stripeSubscription: Stripe.Subscription) {
  if (!stripeSubscription.items.has_more) return stripeSubscription.items.data
  // A Stripe subscription contains at most 20 items.
  const items = await requireStripeClient().subscriptionItems.list(
    { subscription: stripeSubscription.id, limit: 100 },
    { timeout: 5_000, maxNetworkRetries: 0 }
  )
  return items.data
}

export async function handleManualEnterpriseSubscription(
  event: Stripe.CustomerSubscriptionCreatedEvent
) {
  const stripeSubscription = event.data.object
  // Better Auth copies Checkout request metadata onto the subscription. Operators
  // put negotiated terms on its recurring item when creating a manual contract.
  const items = await getStripeSubscriptionItems(stripeSubscription)
  const [contractItem, otherContractItem] = items.filter((item) =>
    isManualContractMetadata(item.metadata)
  )
  if (!contractItem) return
  if (otherContractItem)
    throw new Error(`Ambiguous enterprise contract items for ${stripeSubscription.id}`)

  const metadata = contractItem.metadata
  const enterpriseMetadata = {
    referenceType: 'organization' as const,
    referenceId: metadata.referenceId.trim(),
    billingTierId: metadata.billingTierId.trim(),
    monthlyPrice: metadata.monthlyPrice,
    seats: metadata.seats,
    stripeSubscriptionItemId: contractItem.id,
  }
  const stripeCustomerId =
    typeof stripeSubscription.customer === 'string'
      ? stripeSubscription.customer
      : stripeSubscription.customer.id

  if (!stripeCustomerId) {
    logger.error('[subscription.created] Missing Stripe customer ID', {
      subscriptionId: stripeSubscription.id,
    })
    throw new Error('Missing Stripe customer ID on subscription')
  }

  const referenceId = enterpriseMetadata.referenceId

  // Extract and parse seats and monthly price from metadata (they come as strings from Stripe)
  const seats = Number.parseInt(enterpriseMetadata.seats, 10)
  const monthlyPrice = Number.parseFloat(enterpriseMetadata.monthlyPrice)

  if (!seats || seats <= 0 || Number.isNaN(seats)) {
    logger.error('[subscription.created] Invalid or missing seats in enterprise metadata', {
      subscriptionId: stripeSubscription.id,
      seatsRaw: enterpriseMetadata.seats,
      seatsParsed: seats,
    })
    throw new Error('Enterprise subscription must include valid seats in metadata')
  }

  if (!monthlyPrice || monthlyPrice <= 0 || Number.isNaN(monthlyPrice)) {
    logger.error('[subscription.created] Invalid or missing monthlyPrice in enterprise metadata', {
      subscriptionId: stripeSubscription.id,
      monthlyPriceRaw: enterpriseMetadata.monthlyPrice,
      monthlyPriceParsed: monthlyPrice,
    })
    throw new Error('Enterprise subscription must include valid monthlyPrice in metadata')
  }

  const billingTierRecord = await requireBillingTierById(enterpriseMetadata.billingTierId)

  if (!isOrganizationBillingTier(billingTierRecord)) {
    logger.warn('[subscription.created] Skipping non-organization tier in enterprise handler', {
      subscriptionId: stripeSubscription.id,
      billingTierId: billingTierRecord.id,
      billingTier: billingTierRecord.displayName,
    })
    return
  }

  const contract = {
    plan: billingTierRecord.id,
    billingTierId: billingTierRecord.id,
    referenceType: 'organization' as const,
    referenceId,
    stripeCustomerId,
    stripeSubscriptionId: stripeSubscription.id,
    status: stripeSubscription.status || null,
    ...getStripeSubscriptionFields(stripeSubscription, contractItem),
    seats,
  }

  const subscriptionRow = { id: crypto.randomUUID(), ...contract, metadata: enterpriseMetadata }
  const [persistedSubscription] = await db
    .insert(subscription)
    .values(subscriptionRow)
    .onConflictDoUpdate({
      target: subscription.stripeSubscriptionId,
      set: {
        ...contract,
        metadata: sql`coalesce(${subscription.metadata}::jsonb, '{}'::jsonb) || excluded.metadata::jsonb`,
      },
    })
    .returning({ id: subscription.id })
  const subscriptionId = persistedSubscription?.id || subscriptionRow.id

  if (billingTierRecord.usageScope === 'pooled') {
    const organizationUsageLimit = getTierIncludedUsageLimit(billingTierRecord) || monthlyPrice

    try {
      await db
        .update(organization)
        .set({
          orgUsageLimit: organizationUsageLimit.toFixed(2),
          updatedAt: new Date(),
        })
        .where(eq(organization.id, referenceId))

      logger.info('[subscription.created] Updated organization usage limit', {
        organizationId: referenceId,
        usageLimit: organizationUsageLimit,
      })
    } catch (error) {
      logger.error('[subscription.created] Failed to update organization usage limit', {
        organizationId: referenceId,
        usageLimit: organizationUsageLimit,
        error,
      })
      // Don't throw - the subscription was created successfully, just log the error
    }
  }

  logger.info('[subscription.created] Upserted enterprise subscription', {
    subscriptionId,
    referenceType: subscriptionRow.referenceType,
    referenceId: subscriptionRow.referenceId,
    subscriptionKey: subscriptionRow.plan,
    billingTierId: subscriptionRow.billingTierId,
    billingTier: billingTierRecord.displayName,
    status: subscriptionRow.status,
    monthlyPrice,
    seats,
    note: 'Seats from metadata, Stripe quantity set to 1',
  })

  try {
    const userDetails = await db
      .select({
        id: user.id,
        name: user.name,
        email: user.email,
      })
      .from(user)
      .where(eq(user.stripeCustomerId, stripeCustomerId))
      .limit(1)

    const orgDetails = await db
      .select({
        id: organization.id,
        name: organization.name,
      })
      .from(organization)
      .where(eq(organization.id, referenceId))
      .limit(1)

    if (userDetails.length > 0 && orgDetails.length > 0) {
      const user = userDetails[0]
      const org = orgDetails[0]
      const locale = await resolveEmailLocale({ userId: user.id, email: user.email })

      const sendNotice = async (email: string) =>
        sendEmail({
          to: email,
          userId: user.id,
          subject: getEmailSubject('enterprise-subscription', locale),
          html: await renderEnterpriseSubscriptionEmail(user.name || email, email, locale),
          emailType: 'transactional',
        })
      let email = user.email
      let emailResult = await sendNotice(email)
      if (
        !emailResult.success &&
        emailResult.currentEmail &&
        (await getStoredStripeUserCustomerId(user.id)) === stripeCustomerId
      ) {
        email = emailResult.currentEmail
        emailResult = await sendNotice(email)
      }

      if (emailResult.success) {
        logger.info('[subscription.created] Enterprise subscription email sent successfully', {
          userId: user.id,
          email,
          organizationId: org.id,
          subscriptionId: subscriptionRow.id,
        })
      } else {
        logger.warn('[subscription.created] Failed to send enterprise subscription email', {
          userId: user.id,
          email,
          error: emailResult.message,
        })
      }
    } else {
      logger.warn(
        '[subscription.created] Could not find user or organization for email notification',
        {
          userFound: userDetails.length > 0,
          orgFound: orgDetails.length > 0,
          stripeCustomerId,
          referenceId,
        }
      )
    }
  } catch (emailError) {
    logger.error('[subscription.created] Error sending enterprise subscription email', {
      error: emailError,
      stripeCustomerId,
      referenceId,
      subscriptionId: subscriptionRow.id,
    })
  }
}
