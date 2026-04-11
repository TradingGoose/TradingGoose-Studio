import { db } from '@tradinggoose/db'
import { member, subscription, user, userStats } from '@tradinggoose/db/schema'
import { and, eq } from 'drizzle-orm'
import type { BillingReference, SubscriptionWithTier } from '@/lib/billing/tiers'
import {
  getSubscriptionUsageAllowanceUsd,
  getTierDisplayName,
  getTierUsageAllowanceUsd,
  hydrateSubscriptionsWithTiers,
  requireDefaultBillingTier,
  selectEffectiveSubscription,
  toBillingTierSummary,
} from '@/lib/billing/tiers'
import type { BillingTierSummary, UserSubscriptionState } from '@/lib/billing/types'
import { isProd } from '@/lib/environment'
import { createLogger } from '@/lib/logs/console/logger'
import { getBaseUrl } from '@/lib/urls/utils'

const logger = createLogger('SubscriptionCore')

type SubscriptionRecord = typeof subscription.$inferSelect

export interface PersonalBillingSnapshot {
  subscription: SubscriptionWithTier | null
  tier: BillingTierSummary
  currentPeriodCost: number
  limit: number
  isExceeded: boolean
}

function parseOptionalNumber(value: string | number | null | undefined): number | null {
  if (value === null || value === undefined) {
    return null
  }

  const parsed = Number.parseFloat(value.toString())
  return Number.isFinite(parsed) ? parsed : null
}

function getGrantedOnboardingAllowance(value: string | number | null | undefined): number {
  const parsed = parseOptionalNumber(value)
  return parsed === null ? 0 : Math.max(parsed, 0)
}

function getFreeUserUsageLimit(
  defaultTierLimit: number,
  grantedOnboardingAllowanceUsd: string | number | null | undefined
): number {
  return Math.max(defaultTierLimit, getGrantedOnboardingAllowance(grantedOnboardingAllowanceUsd))
}

function getEffectivePersonalUsageLimit(
  customUsageLimit: string | number | null | undefined,
  minimumLimit: number
): number {
  const parsedCustomUsageLimit = parseOptionalNumber(customUsageLimit)
  if (parsedCustomUsageLimit === null) {
    return minimumLimit
  }

  return Math.max(parsedCustomUsageLimit, minimumLimit)
}

/**
 * Core subscription management - single source of truth
 * Consolidates logic from both lib/subscription.ts and lib/subscription/subscription.ts
 */

/**
 * Get the active subscription that currently governs a billing reference.
 */
export async function getActiveSubscriptionForReference(
  reference: BillingReference
): Promise<SubscriptionWithTier | null> {
  const rows = await db
    .select()
    .from(subscription)
    .where(
      and(
        eq(subscription.referenceType, reference.referenceType),
        eq(subscription.referenceId, reference.referenceId),
        eq(subscription.status, 'active')
      )
    )

  const hydratedSubscriptions = await hydrateSubscriptionsWithTiers(rows)
  return selectEffectiveSubscription(hydratedSubscriptions)
}

export async function getEffectiveSubscription(
  userId: string
): Promise<SubscriptionWithTier | null> {
  return getPersonalEffectiveSubscription(userId)
}

async function getActivePersonalSubscriptions(userId: string): Promise<SubscriptionRecord[]> {
  return db
    .select()
    .from(subscription)
    .where(
      and(
        eq(subscription.referenceType, 'user'),
        eq(subscription.referenceId, userId),
        eq(subscription.status, 'active')
      )
    )
}

export async function getPersonalEffectiveSubscription(
  userId: string
): Promise<SubscriptionWithTier | null> {
  try {
    const personalSubs = await getActivePersonalSubscriptions(userId)
    const hydratedSubscriptions = await hydrateSubscriptionsWithTiers(personalSubs)
    return selectEffectiveSubscription(hydratedSubscriptions)
  } catch (error) {
    logger.error('Error getting personal effective subscription', { error, userId })
    return null
  }
}

export async function getPersonalBillingSnapshot(userId: string): Promise<PersonalBillingSnapshot> {
  try {
    const [subscription, statsRecords] = await Promise.all([
      getPersonalEffectiveSubscription(userId),
      db
        .select({
          currentPeriodCost: userStats.currentPeriodCost,
          totalCost: userStats.totalCost,
          customUsageLimit: userStats.customUsageLimit,
          grantedOnboardingAllowanceUsd: userStats.grantedOnboardingAllowanceUsd,
        })
        .from(userStats)
        .where(eq(userStats.userId, userId))
        .limit(1),
    ])

    const effectiveTier = subscription?.tier ?? (await requireDefaultBillingTier())
    const stats = statsRecords[0]

    let currentPeriodCost = 0
    if (stats) {
      currentPeriodCost = Number.parseFloat(
        (subscription ? stats.currentPeriodCost : stats.totalCost)?.toString() || '0'
      )
    }

    const minimumLimit = subscription
      ? getSubscriptionUsageAllowanceUsd(subscription)
      : getFreeUserUsageLimit(
          getTierUsageAllowanceUsd(effectiveTier),
          stats?.grantedOnboardingAllowanceUsd
        )
    const limit = subscription
      ? getEffectivePersonalUsageLimit(stats?.customUsageLimit, minimumLimit)
      : minimumLimit

    return {
      subscription,
      tier: toBillingTierSummary(effectiveTier),
      currentPeriodCost,
      limit,
      isExceeded: currentPeriodCost >= limit,
    }
  } catch (error) {
    logger.error('Error getting personal billing snapshot', { error, userId })
    try {
      const defaultTier = await requireDefaultBillingTier()
      return {
        subscription: null,
        tier: toBillingTierSummary(defaultTier),
        currentPeriodCost: 0,
        limit: getTierUsageAllowanceUsd(defaultTier),
        isExceeded: true,
      }
    } catch {
      return {
        subscription: null,
        tier: toBillingTierSummary(null),
        currentPeriodCost: 0,
        limit: 0,
        isExceeded: true,
      }
    }
  }
}

/**
 * Check if user has exceeded their cost limit based on current period usage
 */
export async function hasExceededCostLimit(userId: string): Promise<boolean> {
  try {
    if (!isProd) {
      return false
    }

    const subscription = await getEffectiveSubscription(userId)
    let limit: number

    if (subscription) {
      const billingTier = subscription.tier.displayName
      limit = getSubscriptionUsageAllowanceUsd(subscription)
      logger.info('Using individual tier limit', {
        userId,
        billingTier,
        limit,
      })
    } else {
      const defaultTier = await requireDefaultBillingTier()
      const statsRecords = await db.select().from(userStats).where(eq(userStats.userId, userId))
      const stats = statsRecords[0]
      limit = getFreeUserUsageLimit(
        getTierUsageAllowanceUsd(defaultTier),
        stats?.grantedOnboardingAllowanceUsd
      )
      logger.info('Using default billing tier limit', { userId, limit })
      if (statsRecords.length === 0) {
        return false
      }

      const currentCost = Number.parseFloat(
        stats.totalCost?.toString() || stats.currentPeriodCost?.toString() || '0'
      )

      logger.info('Checking cost limit', { userId, currentCost, limit })

      return currentCost >= limit
    }

    const statsRecords = await db.select().from(userStats).where(eq(userStats.userId, userId))

    if (statsRecords.length === 0) {
      return false
    }

    // Use current period cost instead of total cost for accurate billing period tracking
    const currentCost = Number.parseFloat(
      statsRecords[0].currentPeriodCost?.toString() || statsRecords[0].totalCost.toString()
    )

    logger.info('Checking cost limit', { userId, currentCost, limit })

    return currentCost >= limit
  } catch (error) {
    logger.error('Error checking cost limit', { error, userId })
    return false // Be conservative in case of error
  }
}

/**
 * Check if sharing features are enabled for user
 */
// Removed unused feature flag helpers: isSharingEnabled, isMultiplayerEnabled, isWorkspaceCollaborationEnabled

/**
 * Get comprehensive subscription state for a user
 * Single function to get all subscription information
 */
export async function getUserSubscriptionState(userId: string): Promise<UserSubscriptionState> {
  try {
    // Get subscription and user stats in parallel to minimize DB calls
    const [subscription, statsRecords] = await Promise.all([
      getEffectiveSubscription(userId),
      db.select().from(userStats).where(eq(userStats.userId, userId)).limit(1),
    ])

    const tier = subscription?.tier
      ? toBillingTierSummary(subscription.tier)
      : toBillingTierSummary(await requireDefaultBillingTier())

    // Check cost limit using already-fetched user stats
    let hasExceededLimit = false
    if (isProd && statsRecords.length > 0) {
      let limit: number
      let currentCost: number
      if (subscription) {
        limit = getSubscriptionUsageAllowanceUsd(subscription)
        currentCost = Number.parseFloat(
          statsRecords[0].currentPeriodCost?.toString() || statsRecords[0].totalCost.toString()
        )
      } else {
        limit = getFreeUserUsageLimit(
          getTierUsageAllowanceUsd(await requireDefaultBillingTier()),
          statsRecords[0].grantedOnboardingAllowanceUsd
        )
        currentCost = Number.parseFloat(
          statsRecords[0].totalCost?.toString() ||
            statsRecords[0].currentPeriodCost?.toString() ||
            '0'
        )
      }
      hasExceededLimit = currentCost >= limit
    }

    return {
      tier,
      effectiveSubscription: subscription,
      hasExceededLimit,
    }
  } catch (error) {
    logger.error('Error getting user subscription state', { error, userId })

    // Return safe defaults in case of error
    return {
      tier: toBillingTierSummary(null),
      effectiveSubscription: null,
      hasExceededLimit: false,
    }
  }
}

/**
 * Send welcome email for active billing tiers
 */
export async function sendBillingTierWelcomeEmail(subscriptionRecord: {
  id: string
  referenceType: 'user' | 'organization'
  referenceId: string
  tier?: SubscriptionWithTier['tier'] | null
}): Promise<void> {
  try {
    const hydratedSubscription = subscriptionRecord?.tier
      ? subscriptionRecord
      : (
          await hydrateSubscriptionsWithTiers(
            await db
              .select()
              .from(subscription)
              .where(eq(subscription.id, subscriptionRecord.id))
              .limit(1)
          )
        )[0]
    const tier = hydratedSubscription?.tier
    if (!tier) {
      return
    }

    const { getPlanWelcomeSubject, renderPlanWelcomeEmail } = await import(
      '@/components/emails/render-email'
    )
    const { sendEmail } = await import('@/lib/email/mailer')
    const baseUrl = getBaseUrl()

    if (hydratedSubscription.referenceType === 'user') {
      const users = await db
        .select({ email: user.email, name: user.name })
        .from(user)
        .where(eq(user.id, hydratedSubscription.referenceId))
        .limit(1)

      if (users.length === 0 || !users[0].email) {
        return
      }

      const html = await renderPlanWelcomeEmail({
        planName: getTierDisplayName(tier),
        userName: users[0].name || undefined,
        loginLink: `${baseUrl}/login`,
      })

      await sendEmail({
        to: users[0].email,
        subject: getPlanWelcomeSubject(getTierDisplayName(tier)),
        html,
        emailType: 'updates',
      })

      logger.info('Billing tier welcome email sent successfully', {
        userId: hydratedSubscription.referenceId,
        email: users[0].email,
        billingTier: tier.displayName,
      })
      return
    }

    const recipients = await db
      .select({ email: user.email, name: user.name })
      .from(member)
      .innerJoin(user, eq(member.userId, user.id))
      .where(eq(member.organizationId, hydratedSubscription.referenceId))

    for (const recipient of recipients) {
      if (!recipient.email) {
        continue
      }

      const html = await renderPlanWelcomeEmail({
        planName: getTierDisplayName(tier),
        userName: recipient.name || undefined,
        loginLink: `${baseUrl}/login`,
      })

      await sendEmail({
        to: recipient.email,
        subject: getPlanWelcomeSubject(getTierDisplayName(tier)),
        html,
        emailType: 'updates',
      })
    }
  } catch (error) {
    logger.error('Failed to send billing tier welcome email', {
      error,
      subscriptionId: subscriptionRecord.id,
      billingTier: subscriptionRecord.tier?.displayName,
    })
    throw error
  }
}
