import { db } from '@tradinggoose/db'
import {
  member,
  organization,
  organizationMemberBillingLedger,
  user,
  userStats,
} from '@tradinggoose/db/schema'
import { eq } from 'drizzle-orm'
import { getOrganizationBillingLedger } from '@/lib/billing/core/organization'
import {
  findSubscriptionForReference,
  getBillingSubscriptionForReference,
} from '@/lib/billing/core/subscription'
import { getPersonalUsageSnapshot } from '@/lib/billing/core/usage'
import { getResolvedBillingSettings } from '@/lib/billing/settings'
import { getOrganizationMonthlyPrice } from '@/lib/billing/subscriptions/utils'
import {
  type BillingTierRecord,
  getSubscriptionUsageAllowanceUsd,
  getTierBasePrice,
  getTierUsageAllowanceUsd,
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

export async function getOrganizationCurrentUsageForTier(
  organizationId: string,
  tier: BillingTierRecord
): Promise<number> {
  if (usesIndividualBillingLedger(tier)) {
    const memberRows = await db
      .select({
        currentPeriodCost: organizationMemberBillingLedger.currentPeriodCost,
      })
      .from(organizationMemberBillingLedger)
      .where(eq(organizationMemberBillingLedger.organizationId, organizationId))

    return memberRows.reduce((total, row) => total + parseDecimal(row.currentPeriodCost), 0)
  }

  const billingLedger = await getOrganizationBillingLedger(organizationId)
  return billingLedger?.currentPeriodCost ?? 0
}

export async function calculateOrganizationIndividualOverage(
  params: {
    organizationId: string
    tier: BillingTierRecord
  },
  store: Pick<typeof db, 'select'> = db
): Promise<number> {
  const perUserLimit = getTierUsageAllowanceUsd(params.tier)
  const memberRows = await store
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
  return findSubscriptionForReference(
    { referenceType: 'organization', referenceId: organizationId },
    store
  )
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
    const [snapshot, userRecord] = await Promise.all([
      getPersonalUsageSnapshot(userId),
      db.select().from(user).where(eq(user.id, userId)).limit(1),
    ])

    if (userRecord.length === 0) {
      logger.warn('User not found for overage calculation', { userId })
      return null
    }

    const { tier, billingEnabled, subscription } = snapshot
    const { basePrice, usageAllowance } = getBillingTierPricing(subscription)
    const actualUsage = snapshot.usage.currentUsage

    const overageAmount =
      billingEnabled && subscription ? Math.max(0, actualUsage - usageAllowance) : 0

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
export async function calculateSubscriptionOverage(
  sub: {
    id: string
    referenceId: string
    seats?: number | null
    tier?: BillingTierRecord | null
  },
  store: Pick<typeof db, 'insert' | 'select'> = db,
  closingUsage?: number
): Promise<number> {
  let totalOverage = 0

  if (isOrganizationSubscription(sub) && sub.tier) {
    if (usesIndividualBillingLedger(sub.tier)) {
      totalOverage = await calculateOrganizationIndividualOverage(
        {
          organizationId: sub.referenceId,
          tier: sub.tier,
        },
        store
      )
    } else {
      const billingLedger = await getOrganizationBillingLedger(sub.referenceId, store)
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
    let currentUsage = closingUsage
    if (currentUsage === undefined) {
      const [stats] = await store
        .select({
          currentPeriodCost: userStats.currentPeriodCost,
          totalCost: userStats.totalCost,
        })
        .from(userStats)
        .where(eq(userStats.userId, sub.referenceId))
        .limit(1)
      currentUsage = parseDecimal(stats?.currentPeriodCost ?? stats?.totalCost)
    }
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
  organizationData?: {
    seatCount: number
    memberCount: number
    totalBasePrice: number
    totalCurrentUsage: number
    totalOverage: number
  }
}> {
  try {
    const billing = organizationId
      ? await Promise.all([
          getResolvedBillingSettings(),
          getOrganizationSubscription(organizationId),
        ]).then(([settings, subscription]) => ({ ...settings, subscription, organizationId }))
      : await getPersonalUsageSnapshot(userId, getBillingSubscriptionForReference)
    const { billingEnabled, usageWarningThresholdPercent, subscription } = billing
    const exposedSubscription = billingEnabled ? subscription : null

    // Build a canonical tier-backed summary once and share it across the response.
    const isPaid = Boolean(
      exposedSubscription?.tier && !isFreeBillingTier(exposedSubscription.tier)
    )
    const tier = toBillingTierSummary(exposedSubscription?.tier)

    if ('organizationId' in billing) {
      const { organizationId } = billing
      // Organization billing summary
      if (!subscription) {
        if (!billingEnabled) {
          return getDisabledBillingSummary('organization')
        }

        throw new Error(
          `No active organization subscription found for billed organization ${organizationId}`
        )
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
        if (!billingEnabled) {
          return getDisabledBillingSummary('organization')
        }

        throw new Error(`No billing ledger found for billed organization ${organizationId}`)
      }

      const { basePrice: basePricePerSeat, usageAllowance } = getBillingTierPricing(subscription)
      const { licensedSeats, monthlyBasePriceUsd } = getOrganizationMonthlyPrice(
        subscription,
        basePricePerSeat
      )
      const totalBasePrice = billingEnabled ? monthlyBasePriceUsd : 0

      const totalCurrentUsage = await getOrganizationCurrentUsageForTier(
        organizationId,
        subscription.tier
      )
      const totalCopilotCost = billingLedger.currentPeriodCopilotCost
      const totalLastPeriodCopilotCost = billingLedger.lastPeriodCopilotCost
      const totalOverage = billingEnabled
        ? usesIndividualBillingLedger(subscription.tier)
          ? await calculateOrganizationIndividualOverage({
              organizationId,
              tier: subscription.tier,
            })
          : Math.max(0, totalCurrentUsage - usageAllowance)
        : 0
      const billingPeriodStart = subscription.periodStart || null
      const billingPeriodEnd = subscription.periodEnd || null

      const configuredUsageLimit =
        orgRows.length > 0 && orgRows[0].orgUsageLimit
          ? Number.parseFloat(orgRows[0].orgUsageLimit)
          : null
      const totalUsageLimit = billingEnabled
        ? usesIndividualBillingLedger(subscription.tier)
          ? usageAllowance
          : configuredUsageLimit !== null
            ? Math.max(configuredUsageLimit, usageAllowance)
            : usageAllowance
        : Number.MAX_SAFE_INTEGER
      const percentUsed =
        billingEnabled && totalUsageLimit > 0
          ? Math.round((totalCurrentUsage / totalUsageLimit) * 100)
          : 0
      const isWarning =
        billingEnabled && percentUsed >= usageWarningThresholdPercent && percentUsed < 100
      const isExceeded = billingEnabled && totalCurrentUsage >= totalUsageLimit
      const daysRemaining = billingPeriodEnd
        ? Math.max(0, Math.ceil((billingPeriodEnd.getTime() - Date.now()) / (1000 * 60 * 60 * 24)))
        : 0

      return {
        type: 'organization',
        id: exposedSubscription?.id ?? null,
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
        status: exposedSubscription?.status || null,
        seats: exposedSubscription ? licensedSeats : null,
        metadata: exposedSubscription?.metadata || null,
        stripeSubscriptionId: exposedSubscription?.stripeSubscriptionId || null,
        periodEnd: exposedSubscription?.periodEnd || null,
        cancelAtPeriodEnd: exposedSubscription?.cancelAtPeriodEnd || undefined,
        cancelAt: exposedSubscription?.cancelAt ?? null,
        billingInterval: exposedSubscription?.billingInterval ?? null,
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
    const { usage: usageData, stats } = billing
    const { basePrice, usageAllowance } = getBillingTierPricing(subscription)
    const currentUsage = usageData.currentUsage
    const totalCopilotCost = parseDecimal(stats.currentPeriodCopilotCost)
    const totalLastPeriodCopilotCost = parseDecimal(stats.lastPeriodCopilotCost)

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
      currentUsage: currentUsage,
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
    throw error
  }
}

/**
 * Build the permissive summary used only when billing is globally disabled.
 */
function getDisabledBillingSummary(type: 'individual' | 'organization') {
  return {
    type,
    id: null,
    tier: toBillingTierSummary(null),
    basePrice: 0,
    currentUsage: 0,
    overageAmount: 0,
    totalProjected: 0,
    usageLimit: Number.MAX_SAFE_INTEGER,
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
    cancelAt: null,
    billingInterval: null,
    // Usage details
    usage: {
      current: 0,
      limit: Number.MAX_SAFE_INTEGER,
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
