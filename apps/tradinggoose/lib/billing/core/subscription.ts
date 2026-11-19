import { db } from '@tradinggoose/db'
import { member, subscription, user, userStats } from '@tradinggoose/db/schema'
import { and, desc, eq, inArray, isNotNull, sql } from 'drizzle-orm'
import { resetUserDefaultUsageToOnboardingAllowanceBalance } from '@/lib/billing/core/usage'
import { getResolvedBillingSettings } from '@/lib/billing/settings'
import { BILLING_ENTITLED_SUBSCRIPTION_STATUSES } from '@/lib/billing/subscriptions/utils'
import type { BillingReference, SubscriptionWithTier } from '@/lib/billing/tiers'
import {
  getSubscriptionUsageAllowanceUsd,
  getTierDisplayName,
  hydrateSubscriptionsWithTiers,
  requireDefaultBillingTier,
  selectEffectiveSubscription,
  toBillingTierSummary,
} from '@/lib/billing/tiers'
import type { BillingTierSummary } from '@/lib/billing/types'
import { createLogger } from '@/lib/logs/console/logger'

const logger = createLogger('SubscriptionCore')

export class MissingBillingSubscriptionError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'MissingBillingSubscriptionError'
  }
}

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
 * Give a billed user back the default tier when they hold no entitled subscription.
 *
 * Personal Stripe subscriptions reuse the user's default subscription row, so a cancellation
 * that Stripe reported but we failed to finish (a dropped `customer.subscription.deleted`,
 * or a settlement error part-way through one) leaves that single row non-entitled and every
 * billing read throwing. The local status is enough to act on: the row is not entitling
 * anyone, and the default tier is the floor rather than a revocation.
 *
 * Never throws - callers use it behind a normal read, so a repair failure must surface as
 * the original billing error rather than a new one.
 */
async function restorePersonalEntitlement(
  userId: string,
  dbClient: Pick<typeof db, 'select' | 'transaction'> = db
): Promise<SubscriptionWithTier | null> {
  try {
    // With billing disabled there is no default tier to grant, and callers already treat a
    // missing subscription as unlimited.
    const { billingEnabled } = await getResolvedBillingSettings(dbClient)
    if (!billingEnabled) {
      return null
    }

    const restoredSubscription = await ensureDefaultUserSubscription(userId, dbClient)

    logger.warn('Restored default personal subscription for a user left without one', {
      userId,
      subscriptionId: restoredSubscription.id,
    })

    return restoredSubscription
  } catch (error) {
    logger.error('Failed to restore default personal subscription', { userId, error })
    return null
  }
}

/**
 * Get the active subscription that currently governs a billing reference.
 */
export async function getActiveSubscriptionForReference(
  reference: BillingReference,
  dbClient: Pick<typeof db, 'select' | 'transaction'> = db
): Promise<SubscriptionWithTier | null> {
  const rows = await dbClient
    .select()
    .from(subscription)
    .where(
      and(
        eq(subscription.referenceType, reference.referenceType),
        eq(subscription.referenceId, reference.referenceId),
        inArray(subscription.status, [...BILLING_ENTITLED_SUBSCRIPTION_STATUSES])
      )
    )

  const hydratedSubscriptions = await hydrateSubscriptionsWithTiers(rows, dbClient)
  const effectiveSubscription = selectEffectiveSubscription(hydratedSubscriptions)

  if (effectiveSubscription || reference.referenceType !== 'user') {
    return effectiveSubscription
  }

  return restorePersonalEntitlement(reference.referenceId, dbClient)
}

export async function requireActiveSubscriptionForReference(
  reference: BillingReference
): Promise<SubscriptionWithTier> {
  const activeSubscription = await getActiveSubscriptionForReference(reference)

  if (!activeSubscription?.tier) {
    throw new MissingBillingSubscriptionError(
      `No active subscription found for ${reference.referenceType} ${reference.referenceId}`
    )
  }

  return activeSubscription
}

export async function getSubscriptionByStripeSubscriptionId(
  stripeSubscriptionId: string
): Promise<SubscriptionWithTier | null> {
  const row = await getSubscriptionRowByStripeId(stripeSubscriptionId)
  if (!row) return null
  const [hydrated] = await hydrateSubscriptionsWithTiers([row])
  return hydrated ?? null
}

export async function getSubscriptionRowByStripeId(stripeSubscriptionId: string) {
  const [row] = await db
    .select()
    .from(subscription)
    .where(eq(subscription.stripeSubscriptionId, stripeSubscriptionId))
    .limit(1)
  return row
}

export async function getEffectiveSubscription(
  userId: string
): Promise<SubscriptionWithTier | null> {
  const personalSubscription = await getPersonalEffectiveSubscription(userId)
  return personalSubscription ?? restorePersonalEntitlement(userId)
}

export async function getPersonalEffectiveSubscription(
  userId: string,
  dbClient: Pick<typeof db, 'select'> = db
): Promise<SubscriptionWithTier | null> {
  const personalSubs = await dbClient
    .select()
    .from(subscription)
    .where(
      and(
        eq(subscription.referenceType, 'user'),
        eq(subscription.referenceId, userId),
        inArray(subscription.status, [...BILLING_ENTITLED_SUBSCRIPTION_STATUSES])
      )
    )
  const hydratedSubscriptions = await hydrateSubscriptionsWithTiers(personalSubs, dbClient)
  return selectEffectiveSubscription(hydratedSubscriptions)
}

export async function ensureDefaultUserSubscription(
  userId: string,
  dbClient: Pick<typeof db, 'transaction'> = db,
  canceledSubscriptionId?: string
): Promise<SubscriptionWithTier> {
  return dbClient.transaction(async (tx) => {
    await tx.select({ id: user.id }).from(user).where(eq(user.id, userId)).for('update')
    const active = await getPersonalEffectiveSubscription(userId, tx)
    if (active && !canceledSubscriptionId) return active

    // A billing read can restore entitlement before the deletion webhook arrives.
    // Preserve the original Stripe row and capture its usage before opening the next period.
    const [canceled] = await tx
      .select()
      .from(subscription)
      .where(
        and(
          eq(subscription.referenceType, 'user'),
          eq(subscription.referenceId, userId),
          eq(subscription.status, 'canceled'),
          isNotNull(subscription.stripeSubscriptionId),
          canceledSubscriptionId ? eq(subscription.id, canceledSubscriptionId) : undefined
        )
      )
      .orderBy(desc(subscription.endedAt))
      .limit(1)
      .for('update')
    const metadata = canceled?.metadata as Record<string, unknown> | null
    if (canceled && !metadata?.finalUsage) {
      if (active) {
        throw new Error(
          `Final usage for ${canceled.stripeSubscriptionId} was not captured before the replacement subscription started`
        )
      }
      const [ledger] = await tx
        .select({
          currentPeriodCost: userStats.currentPeriodCost,
          billedOverageThisPeriod: userStats.billedOverageThisPeriod,
        })
        .from(userStats)
        .where(eq(userStats.userId, userId))
        .for('update')
      const finalUsage = ledger ?? { currentPeriodCost: '0', billedOverageThisPeriod: '0' }
      await tx
        .update(subscription)
        .set({
          metadata: { ...metadata, finalUsage },
        })
        .where(eq(subscription.id, canceled.id))
      await resetUserDefaultUsageToOnboardingAllowanceBalance(userId, tx)
    }
    if (active) return active

    const tier = await requireDefaultBillingTier(tx)
    const values = {
      plan: tier.id,
      billingTierId: tier.id,
      referenceType: 'user' as const,
      referenceId: userId,
      status: 'active',
      cancelAtPeriodEnd: false,
      metadata: { source: 'default-tier' },
    }
    const [first] = await tx
      .insert(subscription)
      .values({ ...values, id: `sub_default_${userId}` })
      .onConflictDoNothing({ target: subscription.id })
      .returning()
    const created =
      first ??
      (
        await tx
          .insert(subscription)
          .values({ ...values, id: crypto.randomUUID() })
          .returning()
      )[0]
    return { ...created, tier }
  })
}

export async function backfillDefaultUserSubscriptions(): Promise<number> {
  const [{ onboardingAllowanceUsd }, userRows, entitledSubscriptions] = await Promise.all([
    getResolvedBillingSettings(),
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
  const usageLimit = onboardingAllowanceUsd.toString()
  const usageLimitSeed = {
    grantedOnboardingAllowanceUsd: usageLimit,
    customUsageLimit: usageLimit,
  }
  let createdCount = 0

  for (const row of userRows) {
    if (subscribedUserIds.has(row.id)) {
      continue
    }

    await ensureDefaultUserSubscription(row.id)
    await db
      .insert(userStats)
      .values({
        id: crypto.randomUUID(),
        userId: row.id,
        ...usageLimitSeed,
      })
      .onConflictDoUpdate({
        target: userStats.userId,
        set: {
          grantedOnboardingAllowanceUsd: usageLimit,
          customUsageLimit: sql`CASE
            WHEN ${userStats.customUsageLimit} = ${userStats.grantedOnboardingAllowanceUsd}
              THEN ${usageLimit}
            ELSE ${userStats.customUsageLimit}
          END`,
        },
      })
    createdCount += 1
  }

  logger.info('Backfilled default user subscriptions', { createdCount })
  return createdCount
}

export async function getPersonalBillingSnapshot(userId: string): Promise<PersonalBillingSnapshot> {
  try {
    const [{ billingEnabled }, subscription, statsRecords] = await Promise.all([
      getResolvedBillingSettings(),
      // Not the raw personal read: this one repairs a user left without an entitled row.
      getEffectiveSubscription(userId),
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

    const { getEmailSubject, renderPlanWelcomeEmail } = await import(
      '@/components/emails/render-email'
    )
    const { sendEmail } = await import('@/lib/email/mailer')
    const { resolveEmailLocale } = await import('@/lib/email/locale')
    const planName = getTierDisplayName(tier)
    const { referenceId, referenceType } = hydratedSubscription
    const fields = { id: user.id, email: user.email, name: user.name }
    const recipients =
      referenceType === 'user'
        ? await db.select(fields).from(user).where(eq(user.id, referenceId)).limit(1)
        : await db
            .select(fields)
            .from(member)
            .innerJoin(user, eq(member.userId, user.id))
            .where(eq(member.organizationId, referenceId))

    for (const recipient of recipients) {
      if (!recipient.email) {
        continue
      }

      const locale = await resolveEmailLocale({ userId: recipient.id, email: recipient.email })
      const result = await sendEmail({
        to: recipient.email,
        userId: recipient.id,
        subject: getEmailSubject('plan-welcome', locale, { planName }),
        locale,
        html: (unsubscribeUrl) =>
          renderPlanWelcomeEmail({
            unsubscribeUrl,
            planName,
            userName: recipient.name || undefined,
            locale,
          }),
        emailType: 'updates',
      })
      if (!result.success) {
        logger.warn('Billing tier welcome email delivery failed', {
          userId: recipient.id,
          message: result.message,
        })
      }
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
