import { db } from '@tradinggoose/db'
import {
  member,
  organization,
  organizationMemberBillingLedger,
  subscription,
  user,
  userStats,
} from '@tradinggoose/db/schema'
import { and, eq } from 'drizzle-orm'
import { getOrganizationBillingLedger } from '@/lib/billing/core/organization'
import { getEffectiveSubscription } from '@/lib/billing/core/subscription'
import { getUserUsageData } from '@/lib/billing/core/usage'
import { getResolvedBillingSettings } from '@/lib/billing/settings'
import {
  type BillingTierRecord,
  getSubscriptionUsageAllowanceUsd,
  getTierBasePrice,
  getTierIncludedUsageLimit,
  getTierUsageAllowanceUsd,
  hydrateSubscriptionsWithTiers,
  isFreeBillingTier,
  isOrganizationSubscription,
  requireDefaultBillingTier,
  toBillingTierSummary,
  usesIndividualBillingLedger,
} from '@/lib/billing/tiers'
import type { BillingTierSummary } from '@/lib/billing/types'
import { createLogger } from '@/lib/logs/console/logger'

const logger = createLogger('Billing')

function parseDecimal(value: string | number | null | undefined): number {
  if (value === null || value === undefined) {
    return 0
  }

  const parsed = Number.parseFloat(value.toString())
  return Number.isFinite(parsed) ? parsed : 0
}

export async function getOrganizationCurrentUsageForTier(
  organizationId: string,
  tier: BillingTierRecord
): Promise<number> {
  if (usesIndividualBillingLedger(tier)) {
    const memberRows = await db
      .select({ currentPeriodCost: organizationMemberBillingLedger.currentPeriodCost })
      .from(organizationMemberBillingLedger)
      .where(eq(organizationMemberBillingLedger.organizationId, organizationId))

    return memberRows.reduce(
      (total, row) => total + parseDecimal(row.currentPeriodCost),
      0
    )
  }

  const billingLedger = await getOrganizationBillingLedger(organizationId)
  return billingLedger?.currentPeriodCost ?? 0
}

export async function calculateOrganizationIndividualOverage(params: {
  organizationId: string
  tier: BillingTierRecord
}): Promise<number> {
  const perUserLimit = getTierUsageAllowanceUsd(params.tier)
  const memberRows = await db
    .select({ currentPeriodCost: organizationMemberBillingLedger.currentPeriodCost })
    .from(organizationMemberBillingLedger)
    .where(eq(organizationMemberBillingLedger.organizationId, params.organizationId))

  return memberRows.reduce((total, row) => {
    const currentUsage = parseDecimal(row.currentPeriodCost)
    return total + Math.max(0, currentUsage - perUserLimit)
  }, 0)
}

/**
 * Get organization subscription directly by organization ID
 */
export async function getOrganizationSubscription(organizationId: string) {
  try {
    const orgSubs = await db
      .select()
      .from(subscription)
      .where(
        and(
          eq(subscription.referenceType, 'organization'),
          eq(subscription.referenceId, organizationId),
          eq(subscription.status, 'active')
        )
      )
      .limit(1)

    const hydrated = await hydrateSubscriptionsWithTiers(orgSubs)
    return hydrated[0] ?? null
  } catch (error) {
    logger.error('Error getting organization subscription', { error, organizationId })
    return null
  }
}

/**
 * BILLING MODEL:
 * 1. User purchases a paid billing tier → Gets charged immediately via Stripe subscription
 * 2. User uses $15 during the month → No additional charge (covered by $20)
 * 3. User uses $35 during the month → Gets charged $15 overage at month end
 * 4. Usage resets, next month they pay $20 again + any overages
 */

/**
 * Get billing tier pricing information
 */
export function getBillingTierPricing(
  source: BillingTierRecord | { tier?: BillingTierRecord | null } | null | undefined
): {
  basePrice: number // What they pay upfront via Stripe subscription
  usageAllowance: number // What amount of usage is included before overage begins
} {
  const tier: BillingTierRecord | null | undefined =
    source && 'tier' in source ? source.tier : (source as BillingTierRecord | null | undefined)
  return {
    basePrice: getTierBasePrice(tier),
    usageAllowance: getSubscriptionUsageAllowanceUsd(source),
  }
}

/**
 * Calculate overage billing for a user
 * Returns only the amount that exceeds their subscription base price
 */
export async function calculateUserOverage(userId: string): Promise<{
  basePrice: number
  actualUsage: number
  overageAmount: number
  tier: BillingTierSummary
} | null> {
  try {
    // Get user's subscription and usage data
    const [subscription, usageData, userRecord, defaultTier] = await Promise.all([
      getEffectiveSubscription(userId),
      getUserUsageData(userId),
      db.select().from(user).where(eq(user.id, userId)).limit(1),
      requireDefaultBillingTier(),
    ])

    if (userRecord.length === 0) {
      logger.warn('User not found for overage calculation', { userId })
      return null
    }

    const tier = toBillingTierSummary(subscription?.tier ?? defaultTier)
    const { basePrice, usageAllowance } = getBillingTierPricing(subscription?.tier ?? null)
    const actualUsage = usageData.currentUsage

    const overageAmount = Math.max(0, actualUsage - usageAllowance)

    return {
      basePrice,
      actualUsage,
      overageAmount,
      tier,
    }
  } catch (error) {
    logger.error('Failed to calculate user overage', { userId, error })
    return null
  }
}

/**
 * Calculate overage amount for a subscription
 * Shared logic between invoice.finalized and customer.subscription.deleted handlers
 */
export async function calculateSubscriptionOverage(sub: {
  id: string
  referenceId: string
  seats?: number | null
  tier?: BillingTierRecord | null
}): Promise<number> {
  let totalOverage = 0

  if (isOrganizationSubscription(sub) && sub.tier) {
    if (usesIndividualBillingLedger(sub.tier)) {
      totalOverage = await calculateOrganizationIndividualOverage({
        organizationId: sub.referenceId,
        tier: sub.tier,
      })
    } else {
      const billingLedger = await getOrganizationBillingLedger(sub.referenceId)
      const currentUsage = billingLedger?.currentPeriodCost ?? 0
      const { usageAllowance } = getBillingTierPricing(sub)

      totalOverage = Math.max(0, currentUsage - usageAllowance)

      logger.info('Calculated organization overage', {
        subscriptionId: sub.id,
        organizationId: sub.referenceId,
        currentUsage,
        usageAllowance,
        totalOverage,
      })
    }

    if (usesIndividualBillingLedger(sub.tier)) {
      logger.info('Calculated organization member-scoped overage', {
        subscriptionId: sub.id,
        organizationId: sub.referenceId,
        totalOverage,
      })
    }
  } else if (sub.tier) {
    const usage = await getUserUsageData(sub.referenceId)
    const { usageAllowance } = getBillingTierPricing(sub.tier)
    totalOverage = Math.max(0, usage.currentUsage - usageAllowance)

    logger.info('Calculated individual-tier overage', {
      subscriptionId: sub.id,
      totalIndividualUsage: usage.currentUsage,
      usageAllowance,
      totalOverage,
    })
  } else {
    const usage = await getUserUsageData(sub.referenceId)
    const { usageAllowance } = getBillingTierPricing(sub.tier)
    totalOverage = Math.max(0, usage.currentUsage - usageAllowance)

    logger.info('Calculated overage for subscription without a hydrated tier', {
      subscriptionId: sub.id,
      billingTier: 'default',
      usage: usage.currentUsage,
      usageAllowance,
      totalOverage,
    })
  }

  return totalOverage
}

/**
 * Get comprehensive billing and subscription summary
 */
export async function getSimplifiedBillingSummary(
  userId: string,
  organizationId?: string
): Promise<{
  id: string | null
  type: 'individual' | 'organization'
  tier: BillingTierSummary
  basePrice: number
  currentUsage: number
  overageAmount: number
  totalProjected: number
  usageLimit: number
  percentUsed: number
  isWarning: boolean
  isExceeded: boolean
  daysRemaining: number
  // Subscription details
  isPaid: boolean
  status: string | null
  seats: number | null
  metadata: any
  stripeSubscriptionId: string | null
  periodEnd: Date | string | null
  cancelAtPeriodEnd?: boolean
  // Usage details
  usage: {
    current: number
    limit: number
    percentUsed: number
    isWarning: boolean
    isExceeded: boolean
    billingPeriodStart: Date | null
    billingPeriodEnd: Date | null
    lastPeriodCost: number
    lastPeriodCopilotCost: number
    daysRemaining: number
    copilotCost: number
  }
  organizationData?: {
    seatCount: number
    memberCount: number
    totalBasePrice: number
    totalCurrentUsage: number
    totalOverage: number
  }
}> {
  try {
    // Get subscription and usage data upfront
    const [{ usageWarningThresholdPercent }, subscription, defaultTier] = await Promise.all([
      getResolvedBillingSettings(),
      organizationId
        ? getOrganizationSubscription(organizationId)
        : getEffectiveSubscription(userId),
      requireDefaultBillingTier(),
    ])

    // Build a canonical tier-backed summary once and share it across the response.
    const isPaid = Boolean(subscription?.tier && !isFreeBillingTier(subscription.tier))
    const tier = toBillingTierSummary(subscription?.tier ?? defaultTier)

    if (organizationId) {
      // Organization billing summary
      if (!subscription) {
        return getDefaultBillingSummary('organization')
      }

      const [members, billingLedger, orgRows] = await Promise.all([
        db
          .select({ userId: member.userId })
          .from(member)
          .where(eq(member.organizationId, organizationId)),
        getOrganizationBillingLedger(organizationId),
        db
          .select({ orgUsageLimit: organization.orgUsageLimit })
          .from(organization)
          .where(eq(organization.id, organizationId))
          .limit(1),
      ])

      if (!billingLedger) {
        return getDefaultBillingSummary('organization')
      }

      const { basePrice: basePricePerSeat, usageAllowance } = getBillingTierPricing(subscription)
      // Organization billing is always seat-based. Fall back to the tier's configured seat count
      // until the subscription record has an explicit seat quantity.
      const licensedSeats = Math.max(subscription.seats || subscription.tier.seatCount || 1, 1)
      const totalBasePrice = basePricePerSeat * licensedSeats

      const totalCurrentUsage = await getOrganizationCurrentUsageForTier(
        organizationId,
        subscription.tier
      )
      const totalCopilotCost = billingLedger.currentPeriodCopilotCost
      const totalLastPeriodCopilotCost = billingLedger.lastPeriodCopilotCost
      const totalOverage = usesIndividualBillingLedger(subscription.tier)
        ? await calculateOrganizationIndividualOverage({
            organizationId,
            tier: subscription.tier,
          })
        : Math.max(0, totalCurrentUsage - usageAllowance)
      const billingPeriodStart = subscription.periodStart || null
      const billingPeriodEnd = subscription.periodEnd || null

      const configuredUsageLimit =
        orgRows.length > 0 && orgRows[0].orgUsageLimit
          ? Number.parseFloat(orgRows[0].orgUsageLimit)
          : null
      const totalUsageLimit = usesIndividualBillingLedger(subscription.tier)
        ? usageAllowance
        : configuredUsageLimit !== null
          ? Math.max(configuredUsageLimit, usageAllowance)
          : usageAllowance
      const percentUsed =
        totalUsageLimit > 0 ? Math.round((totalCurrentUsage / totalUsageLimit) * 100) : 0
      const isWarning = percentUsed >= usageWarningThresholdPercent && percentUsed < 100
      const isExceeded = totalCurrentUsage >= totalUsageLimit
      const daysRemaining = billingPeriodEnd
        ? Math.max(0, Math.ceil((billingPeriodEnd.getTime() - Date.now()) / (1000 * 60 * 60 * 24)))
        : 0

      return {
        type: 'organization',
        id: subscription.id,
        basePrice: totalBasePrice,
        currentUsage: totalCurrentUsage,
        overageAmount: totalOverage,
        totalProjected: totalBasePrice + totalOverage,
        usageLimit: totalUsageLimit,
        percentUsed,
        isWarning,
        isExceeded,
        daysRemaining,
        // Subscription details
        isPaid,
        status: subscription.status || null,
        seats: licensedSeats,
        metadata: subscription.metadata || null,
        stripeSubscriptionId: subscription.stripeSubscriptionId || null,
        periodEnd: subscription.periodEnd || null,
        cancelAtPeriodEnd: subscription.cancelAtPeriodEnd || undefined,
        tier,
        // Usage details
        usage: {
          current: totalCurrentUsage,
          limit: totalUsageLimit,
          percentUsed,
          isWarning,
          isExceeded,
          billingPeriodStart,
          billingPeriodEnd,
          lastPeriodCost: billingLedger.lastPeriodCost,
          lastPeriodCopilotCost: totalLastPeriodCopilotCost,
          daysRemaining,
          copilotCost: totalCopilotCost,
        },
        organizationData: {
          seatCount: licensedSeats,
          memberCount: members.length,
          totalBasePrice,
          totalCurrentUsage,
          totalOverage,
        },
      }
    }

    // Individual billing summary
    const usageData = await getUserUsageData(userId)
    const { basePrice, usageAllowance } = getBillingTierPricing(subscription ?? null)

    // Fetch user stats for copilot cost breakdown
    const userStatsRows = await db
      .select({
        currentPeriodCopilotCost: userStats.currentPeriodCopilotCost,
        lastPeriodCopilotCost: userStats.lastPeriodCopilotCost,
      })
      .from(userStats)
      .where(eq(userStats.userId, userId))
      .limit(1)

    const copilotCost =
      userStatsRows.length > 0
        ? Number.parseFloat(userStatsRows[0].currentPeriodCopilotCost?.toString() || '0')
        : 0

    const lastPeriodCopilotCost =
      userStatsRows.length > 0
        ? Number.parseFloat(userStatsRows[0].lastPeriodCopilotCost?.toString() || '0')
        : 0

    const currentUsage = usageData.currentUsage
    const totalCopilotCost = copilotCost
    const totalLastPeriodCopilotCost = lastPeriodCopilotCost

    const overageAmount = Math.max(0, currentUsage - usageAllowance)
    const percentUsed = usageData.limit > 0 ? (currentUsage / usageData.limit) * 100 : 0
    const isWarning = percentUsed >= usageWarningThresholdPercent && percentUsed < 100
    const isExceeded = currentUsage >= usageData.limit

    // Calculate days remaining in billing period
    const daysRemaining = usageData.billingPeriodEnd
      ? Math.max(
          0,
          Math.ceil((usageData.billingPeriodEnd.getTime() - Date.now()) / (1000 * 60 * 60 * 24))
        )
      : 0

    return {
      type: 'individual',
      id: subscription?.id ?? null,
      basePrice,
      currentUsage: currentUsage,
      overageAmount,
      totalProjected: basePrice + overageAmount,
      usageLimit: usageData.limit,
      percentUsed,
      isWarning,
      isExceeded,
      daysRemaining,
      // Subscription details
      isPaid,
      status: subscription?.status || null,
      seats: subscription?.seats || null,
      metadata: subscription?.metadata || null,
      stripeSubscriptionId: subscription?.stripeSubscriptionId || null,
      periodEnd: subscription?.periodEnd || null,
      cancelAtPeriodEnd: subscription?.cancelAtPeriodEnd || undefined,
      tier,
      // Usage details
      usage: {
        current: currentUsage,
        limit: usageData.limit,
        percentUsed,
        isWarning,
        isExceeded,
        billingPeriodStart: usageData.billingPeriodStart,
        billingPeriodEnd: usageData.billingPeriodEnd,
        lastPeriodCost: usageData.lastPeriodCost,
        lastPeriodCopilotCost: totalLastPeriodCopilotCost,
        daysRemaining,
        copilotCost: totalCopilotCost,
      },
    }
  } catch (error) {
    logger.error('Failed to get simplified billing summary', {
      userId,
      organizationId,
      error,
      message: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    })
    try {
      return await getDefaultBillingSummary(organizationId ? 'organization' : 'individual')
    } catch (fallbackError) {
      logger.error('Failed to build default billing summary', {
        userId,
        organizationId,
        error: fallbackError,
      })

      return {
        type: organizationId ? 'organization' : 'individual',
        id: null,
        basePrice: 0,
        currentUsage: 0,
        overageAmount: 0,
        totalProjected: 0,
        usageLimit: 0,
        percentUsed: 0,
        isWarning: false,
        isExceeded: false,
        daysRemaining: 0,
        isPaid: false,
        status: null,
        seats: null,
        metadata: null,
        stripeSubscriptionId: null,
        periodEnd: null,
        tier: toBillingTierSummary(null),
        usage: {
          current: 0,
          limit: 0,
          percentUsed: 0,
          isWarning: false,
          isExceeded: false,
          billingPeriodStart: null,
          billingPeriodEnd: null,
          lastPeriodCost: 0,
          lastPeriodCopilotCost: 0,
          daysRemaining: 0,
          copilotCost: 0,
        },
        ...(organizationId && {
          organizationData: {
            seatCount: 0,
            memberCount: 0,
            totalBasePrice: 0,
            totalCurrentUsage: 0,
            totalOverage: 0,
          },
        }),
      }
    }
  }
}

/**
 * Get default billing summary for error cases
 */
async function getDefaultBillingSummary(type: 'individual' | 'organization') {
  const defaultTier = await requireDefaultBillingTier()
  const usageLimit = getTierIncludedUsageLimit(defaultTier)
  const basePrice = getTierBasePrice(defaultTier)

  return {
    type,
    id: null,
    tier: toBillingTierSummary(defaultTier),
    basePrice,
    currentUsage: 0,
    overageAmount: 0,
    totalProjected: 0,
    usageLimit,
    percentUsed: 0,
    isWarning: false,
    isExceeded: false,
    daysRemaining: 0,
    // Subscription details
    isPaid: false,
    status: null,
    seats: null,
    metadata: null,
    stripeSubscriptionId: null,
    periodEnd: null,
    // Usage details
    usage: {
      current: 0,
      limit: usageLimit,
      percentUsed: 0,
      isWarning: false,
      isExceeded: false,
      billingPeriodStart: null,
      billingPeriodEnd: null,
      lastPeriodCost: 0,
      lastPeriodCopilotCost: 0,
      daysRemaining: 0,
      copilotCost: 0,
    },
    ...(type === 'organization' && {
      organizationData: {
        seatCount: 0,
        memberCount: 0,
        totalBasePrice: 0,
        totalCurrentUsage: 0,
        totalOverage: 0,
      },
    }),
  }
}
