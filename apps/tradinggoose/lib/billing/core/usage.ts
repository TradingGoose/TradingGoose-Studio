import { db } from '@tradinggoose/db'
import { member, settings, user, userStats } from '@tradinggoose/db/schema'
import { eq } from 'drizzle-orm'
import {
  getEmailSubject,
  renderFreeTierUpgradeEmail,
  renderUsageThresholdEmail,
} from '@/components/emails/render-email'
import { getEffectiveSubscription } from '@/lib/billing/core/subscription'
import { getResolvedBillingSettings } from '@/lib/billing/settings'
import { canEditUsageLimit } from '@/lib/billing/subscriptions/utils'
import {
  getPrimaryPublicUserUpgradeTier,
  getSubscriptionUsageAllowanceUsd,
  getTierBasePrice,
  getTierUsageAllowanceUsd,
  requireDefaultBillingTier,
  toBillingTierSummary,
} from '@/lib/billing/tiers'
import type { BillingData, UsageData, UsageLimitInfo } from '@/lib/billing/types'
import { sendEmail } from '@/lib/email/mailer'
import { getEmailPreferences } from '@/lib/email/unsubscribe'
import { createLogger } from '@/lib/logs/console/logger'
import { getBaseUrl } from '@/lib/urls/utils'

const logger = createLogger('UsageManagement')

async function getDefaultUserTierLimit(): Promise<number> {
  const defaultTier = await requireDefaultBillingTier()
  return getTierUsageAllowanceUsd(defaultTier)
}

function parseOptionalAmount(value: string | number | null | undefined): number | null {
  if (value === null || value === undefined) {
    return null
  }

  const parsed = Number.parseFloat(value.toString())
  return Number.isFinite(parsed) ? Math.max(parsed, 0) : null
}

function getGrantedOnboardingAllowance(value: string | number | null | undefined): number {
  return parseOptionalAmount(value) ?? 0
}

function getFreeUserUsageLimit(params: {
  tierLimit: number
  grantedOnboardingAllowanceUsd: string | number | null | undefined
}): number {
  return Math.max(
    params.tierLimit,
    getGrantedOnboardingAllowance(params.grantedOnboardingAllowanceUsd)
  )
}

function getEffectiveIndividualUsageLimit(params: {
  customUsageLimit: string | number | null | undefined
  minimumLimit: number
}): number {
  const customUsageLimit = params.customUsageLimit
    ? Number.parseFloat(params.customUsageLimit.toString())
    : null

  if (customUsageLimit === null || Number.isNaN(customUsageLimit)) {
    return params.minimumLimit
  }

  return Math.max(customUsageLimit, params.minimumLimit)
}

/**
 * Handle new user setup when they join the platform.
 * Creates the billing usage row for a newly provisioned user.
 */
export async function handleNewUser(userId: string): Promise<void> {
  try {
    const { onboardingAllowanceUsd } = await getResolvedBillingSettings()

    await db.insert(userStats).values({
      id: crypto.randomUUID(),
      userId: userId,
      grantedOnboardingAllowanceUsd: onboardingAllowanceUsd.toString(),
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

/**
 * Get comprehensive usage data for a user
 */
export async function getUserUsageData(userId: string): Promise<UsageData> {
  try {
    const [{ usageWarningThresholdPercent }, userStatsData, subscription] = await Promise.all([
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
    const currentUsage = Number.parseFloat(
      (subscription ? stats.currentPeriodCost : stats.totalCost)?.toString() ?? '0'
    )
    const lastPeriodCost = Number.parseFloat(stats.lastPeriodCost?.toString() ?? '0')
    const minimumLimit = subscription
      ? getSubscriptionUsageAllowanceUsd(subscription)
      : getFreeUserUsageLimit({
          tierLimit: await getDefaultUserTierLimit(),
          grantedOnboardingAllowanceUsd: stats.grantedOnboardingAllowanceUsd,
        })
    const limit = subscription
      ? getEffectiveIndividualUsageLimit({
          customUsageLimit: stats.customUsageLimit,
          minimumLimit,
        })
      : minimumLimit

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
    // Gracefully return a default usage snapshot so UI can render instead of throwing
    const fallbackLimit = await getDefaultUserTierLimit()
    return {
      currentUsage: 0,
      limit: fallbackLimit,
      percentUsed: 0,
      isWarning: false,
      isExceeded: false,
      billingPeriodStart: null,
      billingPeriodEnd: null,
      lastPeriodCost: 0,
    }
  }
}

/**
 * Get usage limit information for a user
 */
export async function getUserUsageLimitInfo(userId: string): Promise<UsageLimitInfo> {
  try {
    const [subscription, userStatsRecord] = await Promise.all([
      getEffectiveSubscription(userId),
      db.select().from(userStats).where(eq(userStats.userId, userId)).limit(1),
    ])

    if (userStatsRecord.length === 0) {
      throw new Error(`User stats not found for userId: ${userId}`)
    }

    const stats = userStatsRecord[0]

    const minimumLimitForTier = subscription
      ? getSubscriptionUsageAllowanceUsd(subscription)
      : getFreeUserUsageLimit({
          tierLimit: await getDefaultUserTierLimit(),
          grantedOnboardingAllowanceUsd: stats.grantedOnboardingAllowanceUsd,
        })
    const currentLimit = subscription
      ? getEffectiveIndividualUsageLimit({
          customUsageLimit: stats.customUsageLimit,
          minimumLimit: minimumLimitForTier,
        })
      : minimumLimitForTier
    const minimumLimit = subscription
      ? getSubscriptionUsageAllowanceUsd(subscription)
      : minimumLimitForTier
    const canEdit = canEditUsageLimit(subscription)

    return {
      currentLimit,
      canEdit,
      minimumLimit,
      tier: subscription?.tier
        ? toBillingTierSummary(subscription.tier)
        : toBillingTierSummary(await requireDefaultBillingTier()),
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
      return { success: false, error: 'This billing tier cannot edit usage limits' }
    }

    const minimumLimit = getSubscriptionUsageAllowanceUsd(subscription)

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
    const userStatsRecord = await db
      .select()
      .from(userStats)
      .where(eq(userStats.userId, userId))
      .limit(1)

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
 * Get usage limit for a user (used by checkUsageStatus for server-side checks).
 */
export async function getUserUsageLimit(userId: string): Promise<number> {
  const subscription = await getEffectiveSubscription(userId)
  const userStatsQuery = await db
    .select({
      customUsageLimit: userStats.customUsageLimit,
      grantedOnboardingAllowanceUsd: userStats.grantedOnboardingAllowanceUsd,
    })
    .from(userStats)
    .where(eq(userStats.userId, userId))
    .limit(1)

  if (userStatsQuery.length === 0) {
    throw new Error(
      `No user stats record found for userId: ${userId}. User must be properly initialized before execution.`
    )
  }

  const minimumLimit = subscription
    ? getSubscriptionUsageAllowanceUsd(subscription)
    : getFreeUserUsageLimit({
        tierLimit: await getDefaultUserTierLimit(),
        grantedOnboardingAllowanceUsd: userStatsQuery[0].grantedOnboardingAllowanceUsd,
      })

  return subscription
    ? getEffectiveIndividualUsageLimit({
        customUsageLimit: userStatsQuery[0].customUsageLimit,
        minimumLimit,
      })
    : getFreeUserUsageLimit({
        tierLimit: minimumLimit,
        grantedOnboardingAllowanceUsd: userStatsQuery[0].grantedOnboardingAllowanceUsd,
      })
}

/**
 * Check usage status with warning thresholds
 */
export async function checkUsageStatus(userId: string): Promise<{
  status: 'ok' | 'warning' | 'exceeded'
  usageData: UsageData
}> {
  try {
    const usageData = await getUserUsageData(userId)

    let status: 'ok' | 'warning' | 'exceeded' = 'ok'
    if (usageData.isExceeded) {
      status = 'exceeded'
    } else if (usageData.isWarning) {
      status = 'warning'
    }

    return {
      status,
      usageData,
    }
  } catch (error) {
    logger.error('Failed to check usage status', { userId, error })
    throw error
  }
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
 * Get usage limit information for team members (for admin dashboard)
 */
export async function getTeamUsageLimits(organizationId: string): Promise<
  Array<{
    userId: string
    userName: string
    userEmail: string
    currentLimit: number
    currentUsage: number
    totalCost: number
    lastActive: Date | null
  }>
> {
  try {
    const teamMembers = await db
      .select({
        userId: member.userId,
        userName: user.name,
        userEmail: user.email,
        currentLimit: userStats.customUsageLimit,
        currentPeriodCost: userStats.currentPeriodCost,
        totalCost: userStats.totalCost,
        lastActive: userStats.lastActive,
      })
      .from(member)
      .innerJoin(user, eq(member.userId, user.id))
      .leftJoin(userStats, eq(member.userId, userStats.userId))
      .where(eq(member.organizationId, organizationId))

    return teamMembers.map((memberData) => ({
      userId: memberData.userId,
      userName: memberData.userName,
      userEmail: memberData.userEmail,
      currentLimit: Number.parseFloat(memberData.currentLimit || '0'),
      currentUsage: Number.parseFloat(memberData.currentPeriodCost || '0'),
      totalCost: Number.parseFloat(memberData.totalCost || '0'),
      lastActive: memberData.lastActive,
    }))
  } catch (error) {
    logger.error('Failed to get team usage limits', { organizationId, error })
    return []
  }
}

/**
 * Returns the current billing-period usage cost for a user.
 */
export async function getEffectiveCurrentPeriodCost(userId: string): Promise<number> {
  const rows = await db
    .select({ current: userStats.currentPeriodCost })
    .from(userStats)
    .where(eq(userStats.userId, userId))
    .limit(1)

  if (rows.length === 0) return 0
  return rows[0].current ? Number.parseFloat(rows[0].current.toString()) : 0
}

/**
 * Calculate billing projection based on current usage
 */
export async function calculateBillingProjection(userId: string): Promise<BillingData> {
  try {
    const usageData = await getUserUsageData(userId)

    if (!usageData.billingPeriodStart || !usageData.billingPeriodEnd) {
      return {
        currentPeriodCost: usageData.currentUsage,
        projectedCost: usageData.currentUsage,
        limit: usageData.limit,
        billingPeriodStart: null,
        billingPeriodEnd: null,
        daysRemaining: 0,
      }
    }

    const now = new Date()
    const periodStart = new Date(usageData.billingPeriodStart)
    const periodEnd = new Date(usageData.billingPeriodEnd)

    const totalDays = Math.ceil(
      (periodEnd.getTime() - periodStart.getTime()) / (1000 * 60 * 60 * 24)
    )
    const daysElapsed = Math.ceil((now.getTime() - periodStart.getTime()) / (1000 * 60 * 60 * 24))
    const daysRemaining = Math.max(0, totalDays - daysElapsed)

    // Project cost based on daily usage rate
    const dailyRate = daysElapsed > 0 ? usageData.currentUsage / daysElapsed : 0
    const projectedCost = dailyRate * totalDays

    return {
      currentPeriodCost: usageData.currentUsage,
      projectedCost: Math.min(projectedCost, usageData.limit), // Cap at limit
      limit: usageData.limit,
      billingPeriodStart: usageData.billingPeriodStart,
      billingPeriodEnd: usageData.billingPeriodEnd,
      daysRemaining,
    }
  } catch (error) {
    logger.error('Failed to calculate billing projection', { userId, error })
    throw error
  }
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
      params.isFreeTier &&
      params.percentBefore < freeTierUpgradeThresholdPercent &&
      params.percentAfter >= freeTierUpgradeThresholdPercent

    // Skip if no thresholds crossed
    if (!crossesWarningThreshold && !crossesFreeTierUpgradeThreshold) return

    if (crossesWarningThreshold) {
      const ctaLink = `${baseUrl}/workspace?billing=usage`
      const sendTo = async (email: string, name?: string) => {
        const prefs = await getEmailPreferences(email)
        if (prefs?.unsubscribeAll || prefs?.unsubscribeNotifications) return

        const html = await renderUsageThresholdEmail({
          userName: name,
          planName: params.planName,
          percentUsed: Math.min(100, Math.round(params.percentAfter)),
          currentUsage: params.currentUsageAfter,
          limit: params.limit,
          ctaLink,
        })

        await sendEmail({
          to: email,
          subject: getEmailSubject('usage-threshold'),
          html,
          emailType: 'notifications',
        })
      }

      if (params.scope === 'user' && params.userId && params.userEmail) {
        const rows = await db
          .select({ enabled: settings.billingUsageNotificationsEnabled })
          .from(settings)
          .where(eq(settings.userId, params.userId))
          .limit(1)
        if (rows.length > 0 && rows[0].enabled === false) return
        await sendTo(params.userEmail, params.userName)
      } else if (params.scope === 'organization' && params.organizationId) {
        const admins = await db
          .select({
            email: user.email,
            name: user.name,
            enabled: settings.billingUsageNotificationsEnabled,
            role: member.role,
          })
          .from(member)
          .innerJoin(user, eq(member.userId, user.id))
          .leftJoin(settings, eq(settings.userId, member.userId))
          .where(eq(member.organizationId, params.organizationId))

        for (const a of admins) {
          const isAdmin = a.role === 'owner' || a.role === 'admin'
          if (!isAdmin) continue
          if (a.enabled === false) continue
          if (!a.email) continue
          await sendTo(a.email, a.name || undefined)
        }
      }
    }

    if (crossesFreeTierUpgradeThreshold && params.isFreeTier) {
      const upgradeLink = `${baseUrl}/workspace?billing=upgrade`
      const recommendedTier = await getPrimaryPublicUserUpgradeTier()
      const sendFreeTierEmail = async (email: string, name?: string) => {
        const prefs = await getEmailPreferences(email)
        if (prefs?.unsubscribeAll || prefs?.unsubscribeNotifications) return

        const html = await renderFreeTierUpgradeEmail({
          userName: name,
          currentTierName: params.planName,
          percentUsed: Math.min(100, Math.round(params.percentAfter)),
          currentUsage: params.currentUsageAfter,
          limit: params.limit,
          upgradeLink,
          recommendedTierName: recommendedTier?.displayName ?? null,
          recommendedTierPriceUsd: recommendedTier ? getTierBasePrice(recommendedTier) : null,
          recommendedTierIncludedUsageLimitUsd: recommendedTier
            ? getTierUsageAllowanceUsd(recommendedTier)
            : null,
          recommendedTierFeatures: recommendedTier?.pricingFeatures ?? [],
        })

        await sendEmail({
          to: email,
          subject: getEmailSubject('free-tier-upgrade'),
          html,
          emailType: 'notifications',
        })

        logger.info('Free tier upgrade email sent', {
          email,
          percentUsed: Math.round(params.percentAfter),
          currentUsage: params.currentUsageAfter,
          limit: params.limit,
        })
      }

      // Free users are always individual scope (not organization)
      if (params.scope === 'user' && params.userId && params.userEmail) {
        const rows = await db
          .select({ enabled: settings.billingUsageNotificationsEnabled })
          .from(settings)
          .where(eq(settings.userId, params.userId))
          .limit(1)
        if (rows.length > 0 && rows[0].enabled === false) return
        await sendFreeTierEmail(params.userEmail, params.userName)
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
