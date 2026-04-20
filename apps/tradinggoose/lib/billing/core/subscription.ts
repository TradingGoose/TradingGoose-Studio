import { db } from '@tradinggoose/db'
import { member, subscription, user, userStats } from '@tradinggoose/db/schema'
import { and, eq, inArray } from 'drizzle-orm'
import type { BillingReference, SubscriptionWithTier } from '@/lib/billing/tiers'
import {
  getSubscriptionUsageAllowanceUsd,
  getTierDisplayName,
  hydrateSubscriptionsWithTiers,
  requireDefaultBillingTier,
  selectEffectiveSubscription,
  toBillingTierSummary,
} from '@/lib/billing/tiers'
import { BILLING_ENTITLED_SUBSCRIPTION_STATUSES } from '@/lib/billing/subscriptions/utils'
import { getResolvedBillingSettings } from '@/lib/billing/settings'
import type { BillingTierSummary } from '@/lib/billing/types'
import { createLogger } from '@/lib/logs/console/logger'
import { getBaseUrl } from '@/lib/urls/utils'

const logger = createLogger('SubscriptionCore')

type SubscriptionRecord = typeof subscription.$inferSelect
const DEFAULT_USER_SUBSCRIPTION_ID_PREFIX = 'sub_default_'

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

export function getSubscribedPersonalUsageMinimumLimit(params: {
  subscription: SubscriptionWithTier | null
  grantedOnboardingAllowanceUsd: string | number | null | undefined
}): number {
  if (!params.subscription) {
    return 0
  }

  const subscriptionLimit = getSubscriptionUsageAllowanceUsd(params.subscription)
  return params.subscription.tier.isDefault
    ? Math.max(
        subscriptionLimit,
        getGrantedOnboardingAllowance(params.grantedOnboardingAllowanceUsd)
      )
    : subscriptionLimit
}

export function getConfiguredPersonalUsageLimit(
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
        inArray(subscription.status, [...BILLING_ENTITLED_SUBSCRIPTION_STATUSES])
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
        inArray(subscription.status, [...BILLING_ENTITLED_SUBSCRIPTION_STATUSES])
      )
    )
}

export async function getPersonalEffectiveSubscription(
  userId: string
): Promise<SubscriptionWithTier | null> {
  const personalSubs = await getActivePersonalSubscriptions(userId)
  const hydratedSubscriptions = await hydrateSubscriptionsWithTiers(personalSubs)
  return selectEffectiveSubscription(hydratedSubscriptions)
}

function getDefaultUserSubscriptionId(userId: string) {
  return `${DEFAULT_USER_SUBSCRIPTION_ID_PREFIX}${userId}`
}

export async function ensureDefaultUserSubscription(userId: string): Promise<SubscriptionWithTier> {
  const existingSubscription = await getPersonalEffectiveSubscription(userId)
  if (existingSubscription) {
    return existingSubscription
  }

  const defaultTier = await requireDefaultBillingTier()
  const subscriptionId = getDefaultUserSubscriptionId(userId)

  await db
    .insert(subscription)
    .values({
      id: subscriptionId,
      plan: defaultTier.id,
      billingTierId: defaultTier.id,
      referenceType: 'user',
      referenceId: userId,
      stripeCustomerId: null,
      stripeSubscriptionId: null,
      status: 'active',
      periodStart: null,
      periodEnd: null,
      cancelAtPeriodEnd: false,
      seats: null,
      trialStart: null,
      trialEnd: null,
      metadata: {
        source: 'default-tier',
      },
    })
    .onConflictDoUpdate({
      target: subscription.id,
      set: {
        plan: defaultTier.id,
        billingTierId: defaultTier.id,
        referenceType: 'user',
        referenceId: userId,
        stripeSubscriptionId: null,
        status: 'active',
        periodStart: null,
        periodEnd: null,
        cancelAtPeriodEnd: false,
        seats: null,
        trialStart: null,
        trialEnd: null,
        metadata: {
          source: 'default-tier',
        },
      },
    })

  const defaultSubscription = await getPersonalEffectiveSubscription(userId)
  if (!defaultSubscription) {
    throw new Error(`Failed to provision default subscription for user ${userId}`)
  }

  return defaultSubscription
}

export async function backfillDefaultUserSubscriptions(): Promise<number> {
  const [userRows, entitledSubscriptions] = await Promise.all([
    db.select({ id: user.id }).from(user),
    db
      .select({ referenceId: subscription.referenceId })
      .from(subscription)
      .where(
        and(
          eq(subscription.referenceType, 'user'),
          inArray(subscription.status, [...BILLING_ENTITLED_SUBSCRIPTION_STATUSES])
        )
      ),
  ])

  const subscribedUserIds = new Set(entitledSubscriptions.map((row) => row.referenceId))
  let createdCount = 0

  for (const row of userRows) {
    if (subscribedUserIds.has(row.id)) {
      continue
    }

    await ensureDefaultUserSubscription(row.id)
    createdCount += 1
  }

  logger.info('Backfilled default user subscriptions', { createdCount })
  return createdCount
}

export async function getPersonalBillingSnapshot(userId: string): Promise<PersonalBillingSnapshot> {
  try {
    const [{ billingEnabled }, subscription, statsRecords] = await Promise.all([
      getResolvedBillingSettings(),
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

    const stats = statsRecords[0]
    const currentPeriodCost = Number.parseFloat(
      (stats?.currentPeriodCost ?? stats?.totalCost)?.toString() || '0'
    )

    if (!billingEnabled) {
      return {
        subscription: null,
        tier: toBillingTierSummary(null),
        currentPeriodCost,
        limit: Number.MAX_SAFE_INTEGER,
        isExceeded: false,
      }
    }

    if (!subscription) {
      throw new Error(`No active personal subscription found for billed user ${userId}`)
    }

    const minimumLimit = getSubscribedPersonalUsageMinimumLimit({
      subscription,
      grantedOnboardingAllowanceUsd: stats?.grantedOnboardingAllowanceUsd,
    })
    const limit = getConfiguredPersonalUsageLimit(stats?.customUsageLimit, minimumLimit)

    return {
      subscription,
      tier: toBillingTierSummary(subscription.tier),
      currentPeriodCost,
      limit,
      isExceeded: currentPeriodCost >= limit,
    }
  } catch (error) {
    logger.error('Error getting personal billing snapshot', { error, userId })
    throw error
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
