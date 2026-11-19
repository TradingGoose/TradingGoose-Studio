import { db } from '@tradinggoose/db'
import { member, settings, user, userStats } from '@tradinggoose/db/schema'
import { eq } from 'drizzle-orm'
import {
  getEmailSubject,
  renderFreeTierUpgradeEmail,
  renderUsageThresholdEmail,
} from '@/components/emails/render-email'
import {
  getConfiguredPersonalUsageLimit,
  getEffectiveSubscription,
  getSubscribedPersonalUsageMinimumLimit,
} from '@/lib/billing/core/subscription'
import { getResolvedBillingSettings } from '@/lib/billing/settings'
import { canEditUsageLimit } from '@/lib/billing/subscriptions/utils'
import {
  getPrimaryPublicUserUpgradeTier,
  getTierBasePrice,
  getTierUsageAllowanceUsd,
  toBillingTierSummary,
} from '@/lib/billing/tiers'
import type { UsageData, UsageLimitInfo } from '@/lib/billing/types'
import { resolveEmailLocale } from '@/lib/email/locale'
import { sendEmail } from '@/lib/email/mailer'
import { createLogger } from '@/lib/logs/console/logger'
import { getBaseUrl } from '@/lib/urls/utils'

const logger = createLogger('UsageManagement')

function parseNonNegativeBillingAmount(value: string | number | null | undefined): number | null {
  if (value === null || value === undefined) {
    return null
  }

  const parsed = Number.parseFloat(value.toString())
  return Number.isFinite(parsed) ? Math.max(parsed, 0) : null
}

/**
 * Handle new user setup when they join the platform.
 * Creates the billing usage row for a newly provisioned user.
 */
export async function handleNewUser(userId: string): Promise<void> {
  try {
    const { onboardingAllowanceUsd } = await getResolvedBillingSettings()

    await db
      .insert(userStats)
      .values({
        id: crypto.randomUUID(),
        userId,
        grantedOnboardingAllowanceUsd: onboardingAllowanceUsd.toString(),
        customUsageLimit: onboardingAllowanceUsd.toString(),
      })
      .onConflictDoNothing({
        target: userStats.userId,
      })

    logger.info('User stats record created for new user', {
      userId,
      onboardingAllowanceUsd,
    })
  } catch (error) {
    logger.error('Failed to create user stats record for new user', {
      userId,
      error,
    })
    throw error
  }
}

export async function decrementGrantedOnboardingAllowanceByCurrentPeriodUsage(
  userId: string,
  dbClient: Pick<typeof db, 'select' | 'update'> = db
): Promise<void> {
  const statsRecords = await dbClient
    .select({
      currentPeriodCost: userStats.currentPeriodCost,
      currentPeriodCopilotCost: userStats.currentPeriodCopilotCost,
      grantedOnboardingAllowanceUsd: userStats.grantedOnboardingAllowanceUsd,
    })
    .from(userStats)
    .where(eq(userStats.userId, userId))
    .limit(1)

  if (statsRecords.length === 0) {
    return
  }

  const grantedAllowance =
    parseNonNegativeBillingAmount(statsRecords[0].grantedOnboardingAllowanceUsd) ?? 0
  const currentPeriodCost = parseNonNegativeBillingAmount(statsRecords[0].currentPeriodCost) ?? 0
  const currentPeriodCopilotCost = statsRecords[0].currentPeriodCopilotCost?.toString() ?? '0'
  const currentPeriodCopilotCostValue = parseNonNegativeBillingAmount(currentPeriodCopilotCost) ?? 0
  const hasCurrentPeriodUsage = currentPeriodCost > 0 || currentPeriodCopilotCostValue > 0

  if (!hasCurrentPeriodUsage) {
    return
  }

  const remainingAllowance = Math.max(grantedAllowance - currentPeriodCost, 0)
  const nextValues: {
    billedOverageThisPeriod: string
    grantedOnboardingAllowanceUsd: string
    lastPeriodCopilotCost?: string
    lastPeriodCost?: string
    currentPeriodCopilotCost: string
    currentPeriodCost: string
  } = {
    billedOverageThisPeriod: '0',
    grantedOnboardingAllowanceUsd: remainingAllowance.toString(),
    currentPeriodCopilotCost: '0',
    currentPeriodCost: '0',
  }

  nextValues.lastPeriodCopilotCost = currentPeriodCopilotCost
  nextValues.lastPeriodCost = currentPeriodCost.toString()

  await dbClient.update(userStats).set(nextValues).where(eq(userStats.userId, userId))
}

export async function resetUserDefaultUsageToOnboardingAllowanceBalance(
  userId: string,
  dbClient: Pick<typeof db, 'select' | 'update'> = db
): Promise<void> {
  const [{ onboardingAllowanceUsd }, statsRecords] = await Promise.all([
    getResolvedBillingSettings(),
    dbClient
      .select({ grantedOnboardingAllowanceUsd: userStats.grantedOnboardingAllowanceUsd })
      .from(userStats)
      .where(eq(userStats.userId, userId))
      .limit(1),
  ])

  if (statsRecords.length === 0) {
    return
  }

  const onboardingAllowance = parseNonNegativeBillingAmount(onboardingAllowanceUsd) ?? 0
  const grantedAllowance =
    parseNonNegativeBillingAmount(statsRecords[0].grantedOnboardingAllowanceUsd) ?? 0
  const usedOnboardingAllowance = Math.max(onboardingAllowance - grantedAllowance, 0)

  await dbClient
    .update(userStats)
    .set({
      customUsageLimit: onboardingAllowance.toString(),
      customUsageLimitUpdatedAt: new Date(),
      currentPeriodCost: usedOnboardingAllowance.toString(),
      currentPeriodCopilotCost: '0',
      billedOverageThisPeriod: '0',
    })
    .where(eq(userStats.userId, userId))
}

/**
 * Get comprehensive usage data for a user
 */
export async function getUserUsageData(userId: string): Promise<UsageData> {
  try {
    const [{ billingEnabled, usageWarningThresholdPercent }, userStatsData, subscription] =
      await Promise.all([
        getResolvedBillingSettings(),
        db.select().from(userStats).where(eq(userStats.userId, userId)).limit(1),
        getEffectiveSubscription(userId),
      ])

    if (userStatsData.length === 0) {
      logger.warn('User stats not found, initializing defaults', { userId })
      await handleNewUser(userId)
      const seeded = await db.select().from(userStats).where(eq(userStats.userId, userId)).limit(1)
      if (seeded.length === 0) {
        throw new Error(`Failed to initialize user stats for userId: ${userId}`)
      }
      userStatsData.push(seeded[0])
    }

    const stats = userStatsData[0]
    const unbilledUsage = Number.parseFloat(stats.totalCost?.toString() ?? '0')
    if (!billingEnabled) {
      return {
        currentUsage: unbilledUsage,
        limit: Number.MAX_SAFE_INTEGER,
        percentUsed: 0,
        isWarning: false,
        isExceeded: false,
        billingPeriodStart: null,
        billingPeriodEnd: null,
        lastPeriodCost: Number.parseFloat(stats.lastPeriodCost?.toString() ?? '0'),
      }
    }

    if (!subscription) {
      throw new Error(`No active personal subscription found for billed user ${userId}`)
    }

    const currentUsage = Number.parseFloat(
      stats.currentPeriodCost?.toString() ?? stats.totalCost?.toString() ?? '0'
    )
    const lastPeriodCost = Number.parseFloat(stats.lastPeriodCost?.toString() ?? '0')
    const minimumLimit = getSubscribedPersonalUsageMinimumLimit({
      subscription,
      grantedOnboardingAllowanceUsd: stats.grantedOnboardingAllowanceUsd,
    })
    const limit = getConfiguredPersonalUsageLimit(stats.customUsageLimit, minimumLimit)

    const percentUsed = limit > 0 ? Math.min((currentUsage / limit) * 100, 100) : 0
    const isWarning = percentUsed >= usageWarningThresholdPercent
    const isExceeded = currentUsage >= limit

    // Derive billing period dates from subscription (source of truth).
    // For free users or missing dates, expose nulls.
    const billingPeriodStart = subscription?.periodStart ?? null
    const billingPeriodEnd = subscription?.periodEnd ?? null

    return {
      currentUsage,
      limit,
      percentUsed,
      isWarning,
      isExceeded,
      billingPeriodStart,
      billingPeriodEnd,
      lastPeriodCost,
    }
  } catch (error) {
    logger.error('Failed to get user usage data', { userId, error })
    throw error
  }
}

/**
 * Get usage limit information for a user
 */
export async function getUserUsageLimitInfo(userId: string): Promise<UsageLimitInfo> {
  try {
    const [{ billingEnabled }, subscription, userStatsRecord] = await Promise.all([
      getResolvedBillingSettings(),
      getEffectiveSubscription(userId),
      db.select().from(userStats).where(eq(userStats.userId, userId)).limit(1),
    ])

    if (userStatsRecord.length === 0) {
      throw new Error(`User stats not found for userId: ${userId}`)
    }

    const stats = userStatsRecord[0]
    if (!billingEnabled) {
      return {
        currentLimit: Number.MAX_SAFE_INTEGER,
        canEdit: false,
        minimumLimit: 0,
        tier: toBillingTierSummary(null),
        updatedAt: stats.customUsageLimitUpdatedAt,
      }
    }

    if (!subscription) {
      throw new Error(`No active personal subscription found for billed user ${userId}`)
    }

    const minimumLimitForTier = getSubscribedPersonalUsageMinimumLimit({
      subscription,
      grantedOnboardingAllowanceUsd: stats.grantedOnboardingAllowanceUsd,
    })
    const currentLimit = getConfiguredPersonalUsageLimit(
      stats.customUsageLimit,
      minimumLimitForTier
    )
    const minimumLimit = minimumLimitForTier
    const canEdit = canEditUsageLimit(subscription)

    return {
      currentLimit,
      canEdit,
      minimumLimit,
      tier: toBillingTierSummary(subscription.tier),
      updatedAt: stats.customUsageLimitUpdatedAt,
    }
  } catch (error) {
    logger.error('Failed to get usage limit info', { userId, error })
    throw error
  }
}

export async function updateUserUsageLimit(
  userId: string,
  newLimit: number,
  setBy?: string // For team admin tracking
): Promise<{ success: boolean; error?: string }> {
  try {
    const subscription = await getEffectiveSubscription(userId)

    if (!canEditUsageLimit(subscription)) {
      return {
        success: false,
        error: 'This billing tier cannot edit usage limits',
      }
    }

    const userStatsRecord = await db
      .select()
      .from(userStats)
      .where(eq(userStats.userId, userId))
      .limit(1)

    const minimumLimit = getSubscribedPersonalUsageMinimumLimit({
      subscription,
      grantedOnboardingAllowanceUsd: userStatsRecord[0]?.grantedOnboardingAllowanceUsd,
    })

    logger.info('Applying tier minimum validation', {
      userId,
      newLimit,
      minimumLimit,
      billingTier: subscription?.tier?.displayName,
    })

    // Validate new limit is not below minimum
    if (newLimit < minimumLimit) {
      return {
        success: false,
        error: `Usage limit cannot be below the billing tier minimum of $${minimumLimit}`,
      }
    }

    // Get current usage to validate against

    if (userStatsRecord.length > 0) {
      const currentUsage = Number.parseFloat(
        userStatsRecord[0].currentPeriodCost?.toString() || userStatsRecord[0].totalCost.toString()
      )

      // Validate new limit is not below current usage
      if (newLimit < currentUsage) {
        return {
          success: false,
          error: `Usage limit cannot be below current usage of $${currentUsage.toFixed(2)}`,
        }
      }
    }

    // Update the usage limit
    await db
      .update(userStats)
      .set({
        customUsageLimit: newLimit.toString(),
        customUsageLimitUpdatedAt: new Date(),
      })
      .where(eq(userStats.userId, userId))

    logger.info('Updated user usage limit', {
      userId,
      newLimit,
      setBy: setBy || userId,
      tierMinimum: minimumLimit,
      billingTier: subscription?.tier?.displayName,
    })

    return { success: true }
  } catch (error) {
    logger.error('Failed to update usage limit', { userId, newLimit, error })
    return { success: false, error: 'Failed to update usage limit' }
  }
}

/**
 * Get the personal usage limit for server-side checks.
 */
export async function getUserUsageLimit(userId: string): Promise<number> {
  const [{ billingEnabled }, subscription, userStatsQuery] = await Promise.all([
    getResolvedBillingSettings(),
    getEffectiveSubscription(userId),
    db
      .select({
        customUsageLimit: userStats.customUsageLimit,
        grantedOnboardingAllowanceUsd: userStats.grantedOnboardingAllowanceUsd,
      })
      .from(userStats)
      .where(eq(userStats.userId, userId))
      .limit(1),
  ])

  if (!billingEnabled) {
    return Number.MAX_SAFE_INTEGER
  }

  if (userStatsQuery.length === 0) {
    throw new Error(
      `No user stats record found for userId: ${userId}. User must be properly initialized before execution.`
    )
  }

  if (!subscription) {
    throw new Error(`No active personal subscription found for billed user ${userId}`)
  }

  const minimumLimit = getSubscribedPersonalUsageMinimumLimit({
    subscription,
    grantedOnboardingAllowanceUsd: userStatsQuery[0].grantedOnboardingAllowanceUsd,
  })

  return getConfiguredPersonalUsageLimit(userStatsQuery[0].customUsageLimit, minimumLimit)
}

/**
 * Sync usage limits based on subscription changes
 */
export async function syncUsageLimitsFromSubscription(userId: string): Promise<void> {
  const currentUserStats = await db
    .select()
    .from(userStats)
    .where(eq(userStats.userId, userId))
    .limit(1)

  if (currentUserStats.length === 0) {
    throw new Error(`User stats not found for userId: ${userId}`)
  }

  logger.info('Verified user stats for tier-backed usage limits', { userId })
}

/**
 * Send usage threshold notification when crossing the configured warning thresholds.
 * - Skips when billing is disabled.
 * - Respects user-level notifications toggle and unsubscribe preferences.
 * - For organization plans, emails owners/admins who have notifications enabled.
 */
export async function maybeSendUsageThresholdEmail(params: {
  scope: 'user' | 'organization'
  planName: string
  isFreeTier: boolean
  percentBefore: number
  percentAfter: number
  userId?: string
  userEmail?: string
  userName?: string
  organizationId?: string
  currentUsageAfter: number
  limit: number
}): Promise<void> {
  try {
    const { billingEnabled, usageWarningThresholdPercent, freeTierUpgradeThresholdPercent } =
      await getResolvedBillingSettings()
    if (!billingEnabled || params.limit <= 0 || params.currentUsageAfter <= 0) return
    const baseUrl = getBaseUrl()

    const crossesWarningThreshold =
      params.percentBefore < usageWarningThresholdPercent &&
      params.percentAfter >= usageWarningThresholdPercent
    const crossesFreeTierUpgradeThreshold =
      params.scope === 'user' &&
      params.isFreeTier &&
      params.percentBefore < freeTierUpgradeThresholdPercent &&
      params.percentAfter >= freeTierUpgradeThresholdPercent
    if (!crossesWarningThreshold && !crossesFreeTierUpgradeThreshold) return

    let recipients: { id: string; email: string; name?: string | null }[]
    if (params.scope === 'user') {
      if (!params.userId || !params.userEmail) return
      const [preferences] = await db
        .select({ enabled: settings.billingUsageNotificationsEnabled })
        .from(settings)
        .where(eq(settings.userId, params.userId))
        .limit(1)
      if (preferences?.enabled === false) return
      recipients = [{ id: params.userId, email: params.userEmail, name: params.userName }]
    } else {
      if (!params.organizationId) return
      const members = await db
        .select({
          id: user.id,
          email: user.email,
          name: user.name,
          enabled: settings.billingUsageNotificationsEnabled,
          role: member.role,
        })
        .from(member)
        .innerJoin(user, eq(member.userId, user.id))
        .leftJoin(settings, eq(settings.userId, member.userId))
        .where(eq(member.organizationId, params.organizationId))
      recipients = members.filter(
        ({ role, email, enabled }) =>
          (role === 'owner' || role === 'admin') && email && enabled !== false
      )
    }

    for (const { id, email, name } of recipients) {
      const locale = await resolveEmailLocale({ userId: id, email })
      const message = { to: email, locale, emailType: 'notifications' as const }
      const usage = {
        userName: name || undefined,
        percentUsed: Math.min(100, Math.round(params.percentAfter)),
        currentUsage: params.currentUsageAfter,
        limit: params.limit,
        locale,
      }
      if (crossesWarningThreshold) {
        await sendEmail({
          ...message,
          subject: getEmailSubject('usage-threshold', locale),
          html: (unsubscribeUrl) =>
            renderUsageThresholdEmail({
              ...usage,
              unsubscribeUrl,
              planName: params.planName,
              ctaLink: `${baseUrl}/workspace?billing=usage`,
            }),
        })
      }
      if (crossesFreeTierUpgradeThreshold) {
        const tier = await getPrimaryPublicUserUpgradeTier()
        await sendEmail({
          ...message,
          subject: getEmailSubject('free-tier-upgrade', locale),
          html: (unsubscribeUrl) =>
            renderFreeTierUpgradeEmail({
              ...usage,
              unsubscribeUrl,
              currentTierName: params.planName,
              upgradeLink: `${baseUrl}/workspace?billing=upgrade`,
              recommendedTierName: tier?.displayName,
              recommendedTierPriceUsd: tier ? getTierBasePrice(tier) : null,
              recommendedTierIncludedUsageLimitUsd: tier ? getTierUsageAllowanceUsd(tier) : null,
              recommendedTierFeatures: tier?.pricingFeatures,
            }),
        })
      }
    }
  } catch (error) {
    logger.error('Failed to send usage threshold email', {
      scope: params.scope,
      userId: params.userId,
      organizationId: params.organizationId,
      error,
    })
  }
}
