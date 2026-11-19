import { db } from '@tradinggoose/db'
import { organizationMemberBillingLedger, subscription, userStats } from '@tradinggoose/db/schema'
import { and, eq, inArray } from 'drizzle-orm'
import { getOrganizationBillingLedger } from '@/lib/billing/core/organization'
import { getEffectiveSubscription } from '@/lib/billing/core/subscription'
import { getUserUsageData } from '@/lib/billing/core/usage'
import { getResolvedBillingSettings } from '@/lib/billing/settings'
import { BILLING_ENTITLED_SUBSCRIPTION_STATUSES } from '@/lib/billing/subscriptions/utils'
import {
  type BillingTierRecord,
  getSubscriptionUsageAllowanceUsd,
  getTierBasePrice,
  getTierUsageAllowanceUsd,
  hydrateSubscriptionsWithTiers,
  isFreeBillingTier,
  isOrganizationSubscription,
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

export async function calculateOrganizationIndividualOverage(params: {
  organizationId: string
  tier: BillingTierRecord
}): Promise<number> {
  const perUserLimit = getTierUsageAllowanceUsd(params.tier)
  const memberRows = await db
    .select({
      currentPeriodCost: organizationMemberBillingLedger.currentPeriodCost,
    })
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
export async function getOrganizationSubscription(
  organizationId: string,
  store: Pick<typeof db, 'select'> = db
) {
  const orgSubs = await store
    .select()
    .from(subscription)
    .where(
      and(
        eq(subscription.referenceType, 'organization'),
        eq(subscription.referenceId, organizationId),
        inArray(subscription.status, [...BILLING_ENTITLED_SUBSCRIPTION_STATUSES])
      )
    )
    .limit(1)

  const hydrated = await hydrateSubscriptionsWithTiers(orgSubs, store)
  return hydrated[0] ?? null
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
    const [stats] = await db
      .select({
        currentPeriodCost: userStats.currentPeriodCost,
        totalCost: userStats.totalCost,
      })
      .from(userStats)
      .where(eq(userStats.userId, sub.referenceId))
      .limit(1)
    const currentUsage = parseDecimal(stats?.currentPeriodCost ?? stats?.totalCost)
    const { usageAllowance } = getBillingTierPricing(sub.tier)
    totalOverage = Math.max(0, currentUsage - usageAllowance)

    logger.info('Calculated individual-tier overage', {
      subscriptionId: sub.id,
      totalIndividualUsage: currentUsage,
      usageAllowance,
      totalOverage,
    })
  } else {
    throw new Error(`Cannot calculate overage for subscription ${sub.id} without a hydrated tier`)
  }

  return totalOverage
}

/**
 * Get the personal billing and subscription summary
 */
export async function getSimplifiedBillingSummary(userId: string): Promise<{
  id: string | null
  type: 'individual'
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
  cancelAt: Date | null
  billingInterval: string | null
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
}> {
  try {
    // Get subscription and usage data upfront
    const [{ billingEnabled, usageWarningThresholdPercent }, subscription] = await Promise.all([
      getResolvedBillingSettings(),
      getEffectiveSubscription(userId),
    ])
    const exposedSubscription = billingEnabled ? subscription : null

    // Build a canonical tier-backed summary once and share it across the response.
    const isPaid = Boolean(
      exposedSubscription?.tier && !isFreeBillingTier(exposedSubscription.tier)
    )
    const tier = toBillingTierSummary(exposedSubscription?.tier)

    if (billingEnabled && !subscription) {
      throw new Error(`No active personal subscription found for billed user ${userId}`)
    }

    const usageData = await getUserUsageData(userId)
    const { basePrice, usageAllowance } = getBillingTierPricing(subscription)

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

    const overageAmount =
      billingEnabled && subscription ? Math.max(0, currentUsage - usageAllowance) : 0
    const percentUsed = usageData.limit > 0 ? (currentUsage / usageData.limit) * 100 : 0
    const isWarning = percentUsed >= usageWarningThresholdPercent && percentUsed < 100
    const isExceeded = currentUsage >= usageData.limit
    const effectiveBasePrice = billingEnabled ? basePrice : 0

    // Calculate days remaining in billing period
    const daysRemaining = usageData.billingPeriodEnd
      ? Math.max(
          0,
          Math.ceil((usageData.billingPeriodEnd.getTime() - Date.now()) / (1000 * 60 * 60 * 24))
        )
      : 0

    return {
      type: 'individual',
      id: exposedSubscription?.id ?? null,
      basePrice: effectiveBasePrice,
      currentUsage,
      overageAmount,
      totalProjected: effectiveBasePrice + overageAmount,
      usageLimit: usageData.limit,
      percentUsed,
      isWarning,
      isExceeded,
      daysRemaining,
      // Subscription details
      isPaid,
      status: exposedSubscription?.status || null,
      seats: exposedSubscription?.seats || null,
      metadata: exposedSubscription?.metadata || null,
      stripeSubscriptionId: exposedSubscription?.stripeSubscriptionId || null,
      periodEnd: exposedSubscription?.periodEnd || null,
      cancelAtPeriodEnd: exposedSubscription?.cancelAtPeriodEnd || undefined,
      cancelAt: exposedSubscription?.cancelAt ?? null,
      billingInterval: exposedSubscription?.billingInterval ?? null,
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
        lastPeriodCopilotCost,
        daysRemaining,
        copilotCost,
      },
    }
  } catch (error) {
    logger.error('Failed to get simplified billing summary', {
      userId,
      error,
      message: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    })
    throw error
  }
}
