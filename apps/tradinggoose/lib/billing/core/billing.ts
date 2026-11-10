import {
  addMoney,
  compareMoney,
  type DecimalAmount,
  decimalFromSafeInteger,
  displayPercentage,
  maxMoney,
  monetary,
  multiplyMoney,
  subtractMoneyClamped,
} from '@tradinggoose/billing/money'
import { db } from '@tradinggoose/db'
import {
  member,
  organization,
  organizationMemberBillingLedger,
  subscription,
  userStats,
} from '@tradinggoose/db/schema'
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
  toBillingTierSummary,
  usesIndividualBillingLedger,
} from '@/lib/billing/tiers'
import type { BillingTierSummary } from '@/lib/billing/types'
import { createLogger } from '@/lib/logs/console/logger'

const logger = createLogger('Billing')

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
 * Get billing tier pricing information
 */
export function getBillingTierPricing(source: BillingTierRecord | { tier: BillingTierRecord }): {
  basePrice: DecimalAmount | null // Actual configured upfront Stripe subscription price, when known
  usageAllowance: DecimalAmount // What amount of usage is included before overage begins
} {
  const tier = 'tier' in source ? source.tier : source
  return {
    basePrice: getTierBasePrice(tier),
    usageAllowance: getSubscriptionUsageAllowanceUsd(source),
  }
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
  basePrice: DecimalAmount | null
  currentUsage: DecimalAmount
  overageAmount: DecimalAmount
  totalProjected: DecimalAmount | null
  usageLimit: DecimalAmount | null
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
    current: DecimalAmount
    limit: DecimalAmount | null
    percentUsed: number
    isWarning: boolean
    isExceeded: boolean
    billingPeriodStart: Date | null
    billingPeriodEnd: Date | null
    lastPeriodCost: DecimalAmount
    lastPeriodCopilotCost: DecimalAmount
    daysRemaining: number
    copilotCost: DecimalAmount
  }
  organizationData?: {
    seatCount: number
    memberCount: number
    totalBasePrice: DecimalAmount | null
    totalCurrentUsage: DecimalAmount
    totalOverage: DecimalAmount
  }
}> {
  try {
    // Get subscription and usage data upfront
    const [{ billingEnabled, usageWarningThresholdPercent }, subscription] = await Promise.all([
      getResolvedBillingSettings(),
      organizationId
        ? getOrganizationSubscription(organizationId)
        : getEffectiveSubscription(userId),
    ])
    const exposedSubscription = billingEnabled ? subscription : null

    // Build a canonical tier-backed summary once and share it across the response.
    const isPaid = Boolean(
      exposedSubscription?.tier && !isFreeBillingTier(exposedSubscription.tier)
    )
    const tier = toBillingTierSummary(exposedSubscription?.tier)

    if (organizationId) {
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

      const { basePrice: basePricePerSeat, usageAllowance } = billingEnabled
        ? getBillingTierPricing(subscription)
        : { basePrice: '0', usageAllowance: '0' }
      // Organization billing is always seat-based. Fall back to the tier's configured seat count
      // until the subscription record has an explicit seat quantity.
      const licensedSeats = Math.max(subscription.seats || subscription.tier.seatCount || 1, 1)
      const totalBasePrice =
        basePricePerSeat === null
          ? null
          : multiplyMoney(basePricePerSeat, decimalFromSafeInteger(licensedSeats))

      const memberUsage = usesIndividualBillingLedger(subscription.tier)
        ? (
            await db
              .select({ currentPeriodCost: organizationMemberBillingLedger.currentPeriodCost })
              .from(organizationMemberBillingLedger)
              .where(eq(organizationMemberBillingLedger.organizationId, organizationId))
          ).map((row) => monetary(row.currentPeriodCost))
        : null
      const totalCurrentUsage =
        memberUsage === null ? monetary(billingLedger.currentPeriodCost) : addMoney(...memberUsage)
      const totalCopilotCost = monetary(billingLedger.currentPeriodCopilotCost)
      const totalLastPeriodCopilotCost = monetary(billingLedger.lastPeriodCopilotCost)
      const totalOverage = billingEnabled
        ? memberUsage === null
          ? subtractMoneyClamped(totalCurrentUsage, usageAllowance)
          : addMoney(
              ...memberUsage.map((current) =>
                subtractMoneyClamped(current, getTierUsageAllowanceUsd(subscription.tier))
              )
            )
        : '0'
      const billingPeriodStart = subscription.periodStart || null
      const billingPeriodEnd = subscription.periodEnd || null

      const configuredUsageLimit =
        orgRows[0]?.orgUsageLimit == null ? null : monetary(orgRows[0].orgUsageLimit)
      const totalUsageLimit = billingEnabled
        ? usesIndividualBillingLedger(subscription.tier)
          ? usageAllowance
          : configuredUsageLimit !== null
            ? maxMoney(configuredUsageLimit, usageAllowance)
            : usageAllowance
        : null
      const percentUsed =
        totalUsageLimit === null ? 0 : displayPercentage(totalCurrentUsage, totalUsageLimit)
      const isExceeded =
        totalUsageLimit !== null && compareMoney(totalCurrentUsage, totalUsageLimit) >= 0
      const isWarning =
        totalUsageLimit !== null &&
        !isExceeded &&
        compareMoney(
          multiplyMoney(totalCurrentUsage, '100'),
          multiplyMoney(totalUsageLimit, decimalFromSafeInteger(usageWarningThresholdPercent))
        ) >= 0
      const daysRemaining = billingPeriodEnd
        ? Math.max(0, Math.ceil((billingPeriodEnd.getTime() - Date.now()) / (1000 * 60 * 60 * 24)))
        : 0

      return {
        type: 'organization',
        id: exposedSubscription?.id ?? null,
        basePrice: totalBasePrice,
        currentUsage: totalCurrentUsage,
        overageAmount: totalOverage,
        totalProjected: totalBasePrice === null ? null : addMoney(totalBasePrice, totalOverage),
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
          lastPeriodCost: monetary(billingLedger.lastPeriodCost),
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
    if (billingEnabled && !subscription) {
      throw new Error(`No active personal subscription found for billed user ${userId}`)
    }

    const usageData = await getUserUsageData(userId)
    const { basePrice, usageAllowance } =
      billingEnabled && subscription
        ? getBillingTierPricing(subscription)
        : { basePrice: '0', usageAllowance: '0' }

    // Fetch user stats for copilot cost breakdown
    const userStatsRows = await db
      .select({
        currentPeriodCopilotCost: userStats.currentPeriodCopilotCost,
        lastPeriodCopilotCost: userStats.lastPeriodCopilotCost,
      })
      .from(userStats)
      .where(eq(userStats.userId, userId))
      .limit(1)

    const stats = userStatsRows[0]
    if (!stats && billingEnabled)
      throw new Error(`Original personal ledger is missing for ${userId}`)
    const copilotCost = stats ? monetary(stats.currentPeriodCopilotCost) : '0'
    const lastPeriodCopilotCost = stats ? monetary(stats.lastPeriodCopilotCost) : '0'

    const currentUsage = monetary(usageData.currentUsage)
    const totalCopilotCost = copilotCost
    const totalLastPeriodCopilotCost = lastPeriodCopilotCost

    const overageAmount =
      billingEnabled && subscription ? subtractMoneyClamped(currentUsage, usageAllowance) : '0'
    const usageLimit =
      !billingEnabled || usageData.limit === null ? null : monetary(usageData.limit)
    const percentUsed = usageLimit === null ? 0 : displayPercentage(currentUsage, usageLimit)
    const isExceeded = usageLimit !== null && compareMoney(currentUsage, usageLimit) >= 0
    const isWarning =
      usageLimit !== null &&
      !isExceeded &&
      compareMoney(
        multiplyMoney(currentUsage, '100'),
        multiplyMoney(usageLimit, decimalFromSafeInteger(usageWarningThresholdPercent))
      ) >= 0
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
      basePrice,
      currentUsage: currentUsage,
      overageAmount,
      totalProjected: basePrice === null ? null : addMoney(basePrice, overageAmount),
      usageLimit,
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
      tier,
      // Usage details
      usage: {
        current: currentUsage,
        limit: usageLimit,
        percentUsed,
        isWarning,
        isExceeded,
        billingPeriodStart: usageData.billingPeriodStart,
        billingPeriodEnd: usageData.billingPeriodEnd,
        lastPeriodCost: monetary(usageData.lastPeriodCost),
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
    basePrice: '0',
    currentUsage: '0',
    overageAmount: '0',
    totalProjected: '0',
    usageLimit: null,
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
      current: '0',
      limit: null,
      percentUsed: 0,
      isWarning: false,
      isExceeded: false,
      billingPeriodStart: null,
      billingPeriodEnd: null,
      lastPeriodCost: '0',
      lastPeriodCopilotCost: '0',
      daysRemaining: 0,
      copilotCost: '0',
    },
    ...(type === 'organization' && {
      organizationData: {
        seatCount: 0,
        memberCount: 0,
        totalBasePrice: '0',
        totalCurrentUsage: '0',
        totalOverage: '0',
      },
    }),
  }
}
