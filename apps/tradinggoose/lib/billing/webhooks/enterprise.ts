import { db } from '@tradinggoose/db'
import { organization, subscription, user } from '@tradinggoose/db/schema'
import { eq } from 'drizzle-orm'
import type Stripe from 'stripe'
import {
  getEmailSubject,
  renderEnterpriseSubscriptionEmail,
} from '@/components/emails/render-email'
import { getStripeSubscriptionFields } from '@/lib/billing/subscriptions/utils'
import {
  getTierUsageAllowanceUsd,
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

export async function handleManualEnterpriseSubscription(event: Stripe.Event) {
  const stripeSubscription = event.data.object as Stripe.Subscription
  const metadata = stripeSubscription.metadata || {}

  if (!isManualContractMetadata(metadata)) {
    logger.info('[subscription.created] Skipping non-enterprise metadata subscription', {
      subscriptionId: stripeSubscription.id,
    })
    return
  }

  const enterpriseMetadata = {
    ...metadata,
    referenceId: metadata.referenceId.trim(),
    billingTierId: metadata.billingTierId.trim(),
  }
  const stripeCustomerId = stripeSubscription.customer as string

  if (!stripeCustomerId) {
    logger.error('[subscription.created] Missing Stripe customer ID', {
      subscriptionId: stripeSubscription.id,
    })
    throw new Error('Missing Stripe customer ID on subscription')
  }

  const referenceId = enterpriseMetadata.referenceId

  if (!referenceId) {
    logger.error('[subscription.created] Unable to resolve referenceId', {
      subscriptionId: stripeSubscription.id,
      stripeCustomerId,
    })
    throw new Error('Unable to resolve referenceId for subscription')
  }

  const metadataJson: Record<string, unknown> = { ...enterpriseMetadata }

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

  const subscriptionRow = {
    plan: billingTierRecord.id,
    billingTierId: billingTierRecord.id,
    referenceType: 'organization' as const,
    referenceId,
    stripeCustomerId,
    status: stripeSubscription.status,
    ...getStripeSubscriptionFields(stripeSubscription, billingTierRecord),
    seats,
    metadata: metadataJson,
  }

  const [{ id: subscriptionId }] = await db
    .insert(subscription)
    .values({
      id: crypto.randomUUID(),
      stripeSubscriptionId: stripeSubscription.id,
      ...subscriptionRow,
    })
    .onConflictDoUpdate({
      target: subscription.stripeSubscriptionId,
      set: subscriptionRow,
    })
    .returning({ id: subscription.id })

  if (billingTierRecord.usageScope === 'pooled') {
    const organizationUsageLimit = getTierUsageAllowanceUsd(billingTierRecord) || monthlyPrice

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

      const html = await renderEnterpriseSubscriptionEmail(
        user.name || user.email,
        user.email,
        locale
      )

      const emailResult = await sendEmail({
        to: user.email,
        userId: user.id,
        subject: getEmailSubject('enterprise-subscription', locale),
        html,
        emailType: 'transactional',
      })

      if (emailResult.success) {
        logger.info('[subscription.created] Enterprise subscription email sent successfully', {
          userId: user.id,
          email: user.email,
          organizationId: org.id,
          subscriptionId,
        })
      } else {
        logger.warn('[subscription.created] Failed to send enterprise subscription email', {
          userId: user.id,
          email: user.email,
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
      subscriptionId,
    })
  }
}
