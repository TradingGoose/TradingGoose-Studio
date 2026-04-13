import { db } from '@tradinggoose/db'
import {
  member,
  organization,
  organizationBillingLedger,
  organizationMemberBillingLedger,
  user,
  userStats,
} from '@tradinggoose/db/schema'
import { and, eq } from 'drizzle-orm'
import { getBillingTierPricing, getOrganizationSubscription } from '@/lib/billing/core/billing'
import { getResolvedBillingSettings } from '@/lib/billing/settings'
import {
  canTierConfigureSso,
  canTierEditUsageLimit,
  getSubscriptionUsageAllowanceUsd,
  getTierUsageAllowanceUsd,
} from '@/lib/billing/tiers'
import { createLogger } from '@/lib/logs/console/logger'

const logger = createLogger('OrganizationBilling')

function roundCurrency(value: number): number {
  return Math.round(value * 100) / 100
}

function parseLedgerNumber(value: string | number | null | undefined): number {
  if (value === null || value === undefined) {
    return 0
  }

  const parsed = Number.parseFloat(value.toString())
  return Number.isFinite(parsed) ? parsed : 0
}

export interface OrganizationBillingLedgerSnapshot {
  organizationId: string
  totalManualExecutions: number
  totalApiCalls: number
  totalWebhookTriggers: number
  totalScheduledExecutions: number
  totalChatExecutions: number
  totalTokensUsed: number
  totalCost: number
  currentPeriodCost: number
  lastPeriodCost: number
  billedOverageThisPeriod: number
  totalCopilotCost: number
  currentPeriodCopilotCost: number
  lastPeriodCopilotCost: number
  totalCopilotTokens: number
  totalCopilotCalls: number
  billingBlocked: boolean
  lastActive: Date
  createdAt: Date
  updatedAt: Date
}

export interface OrganizationMemberBillingLedgerSnapshot {
  organizationId: string
  userId: string
  totalManualExecutions: number
  totalApiCalls: number
  totalWebhookTriggers: number
  totalScheduledExecutions: number
  totalChatExecutions: number
  totalTokensUsed: number
  totalCost: number
  currentPeriodCost: number
  lastPeriodCost: number
  totalCopilotCost: number
  currentPeriodCopilotCost: number
  lastPeriodCopilotCost: number
  totalCopilotTokens: number
  totalCopilotCalls: number
  lastActive: Date
  createdAt: Date
  updatedAt: Date
}

export async function getOrganizationBillingLedger(
  organizationId: string
): Promise<OrganizationBillingLedgerSnapshot | null> {
  const organizationRows = await db
    .select({ id: organization.id })
    .from(organization)
    .where(eq(organization.id, organizationId))
    .limit(1)

  if (organizationRows.length === 0) {
    return null
  }

  const ledgerRows = await db
    .select()
    .from(organizationBillingLedger)
    .where(eq(organizationBillingLedger.organizationId, organizationId))
    .limit(1)

  if (ledgerRows.length === 0) {
    await db
      .insert(organizationBillingLedger)
      .values({
        organizationId,
      })
      .onConflictDoNothing({
        target: [organizationBillingLedger.organizationId],
      })

    const seededRows = await db
      .select()
      .from(organizationBillingLedger)
      .where(eq(organizationBillingLedger.organizationId, organizationId))
      .limit(1)

    if (seededRows.length === 0) {
      return null
    }

    return mapOrganizationBillingLedgerRow(seededRows[0])
  }

  return mapOrganizationBillingLedgerRow(ledgerRows[0])
}

function mapOrganizationBillingLedgerRow(
  row: typeof organizationBillingLedger.$inferSelect
): OrganizationBillingLedgerSnapshot {
  return {
    organizationId: row.organizationId,
    totalManualExecutions: row.totalManualExecutions,
    totalApiCalls: row.totalApiCalls,
    totalWebhookTriggers: row.totalWebhookTriggers,
    totalScheduledExecutions: row.totalScheduledExecutions,
    totalChatExecutions: row.totalChatExecutions,
    totalTokensUsed: row.totalTokensUsed,
    totalCost: parseLedgerNumber(row.totalCost),
    currentPeriodCost: parseLedgerNumber(row.currentPeriodCost),
    lastPeriodCost: parseLedgerNumber(row.lastPeriodCost),
    billedOverageThisPeriod: parseLedgerNumber(row.billedOverageThisPeriod),
    totalCopilotCost: parseLedgerNumber(row.totalCopilotCost),
    currentPeriodCopilotCost: parseLedgerNumber(row.currentPeriodCopilotCost),
    lastPeriodCopilotCost: parseLedgerNumber(row.lastPeriodCopilotCost),
    totalCopilotTokens: row.totalCopilotTokens,
    totalCopilotCalls: row.totalCopilotCalls,
    billingBlocked: row.billingBlocked,
    lastActive: row.lastActive,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}

export async function getOrganizationMemberBillingLedger(
  organizationId: string,
  userId: string
): Promise<OrganizationMemberBillingLedgerSnapshot | null> {
  const ledgerRows = await db
    .select()
    .from(organizationMemberBillingLedger)
    .where(
      and(
        eq(organizationMemberBillingLedger.organizationId, organizationId),
        eq(organizationMemberBillingLedger.userId, userId)
      )
    )
    .limit(1)

  if (ledgerRows.length === 0) {
    await db
      .insert(organizationMemberBillingLedger)
      .values({
        organizationId,
        userId,
      })
      .onConflictDoNothing({
        target: [
          organizationMemberBillingLedger.organizationId,
          organizationMemberBillingLedger.userId,
        ],
      })

    const seededRows = await db
      .select()
      .from(organizationMemberBillingLedger)
      .where(
        and(
          eq(organizationMemberBillingLedger.organizationId, organizationId),
          eq(organizationMemberBillingLedger.userId, userId)
        )
      )
      .limit(1)

    if (seededRows.length === 0) {
      return null
    }

    return mapOrganizationMemberBillingLedgerRow(seededRows[0])
  }

  return mapOrganizationMemberBillingLedgerRow(ledgerRows[0])
}

export async function getOrganizationMemberBillingLedgers(
  organizationId: string
): Promise<OrganizationMemberBillingLedgerSnapshot[]> {
  const rows = await db
    .select()
    .from(organizationMemberBillingLedger)
    .where(eq(organizationMemberBillingLedger.organizationId, organizationId))

  return rows.map(mapOrganizationMemberBillingLedgerRow)
}

function mapOrganizationMemberBillingLedgerRow(
  row: typeof organizationMemberBillingLedger.$inferSelect
): OrganizationMemberBillingLedgerSnapshot {
  return {
    organizationId: row.organizationId,
    userId: row.userId,
    totalManualExecutions: row.totalManualExecutions,
    totalApiCalls: row.totalApiCalls,
    totalWebhookTriggers: row.totalWebhookTriggers,
    totalScheduledExecutions: row.totalScheduledExecutions,
    totalChatExecutions: row.totalChatExecutions,
    totalTokensUsed: row.totalTokensUsed,
    totalCost: parseLedgerNumber(row.totalCost),
    currentPeriodCost: parseLedgerNumber(row.currentPeriodCost),
    lastPeriodCost: parseLedgerNumber(row.lastPeriodCost),
    totalCopilotCost: parseLedgerNumber(row.totalCopilotCost),
    currentPeriodCopilotCost: parseLedgerNumber(row.currentPeriodCopilotCost),
    lastPeriodCopilotCost: parseLedgerNumber(row.lastPeriodCopilotCost),
    totalCopilotTokens: row.totalCopilotTokens,
    totalCopilotCalls: row.totalCopilotCalls,
    lastActive: row.lastActive,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}

interface OrganizationUsageData {
  organizationId: string
  organizationName: string
  subscriptionTier: {
    id: string
    displayName: string
    ownerType: 'organization'
    usageScope: 'individual' | 'pooled'
    seatMode: 'fixed' | 'adjustable'
    monthlyPriceUsd: number
    seatCount: number | null
    seatMaximum: number | null
    canEditUsageLimit: boolean
    canConfigureSso: boolean
  }
  subscriptionStatus: string
  seatPriceUsd: number
  seatCount: number | null
  seatMaximum: number | null
  seatMode: 'fixed' | 'adjustable'
  totalSeats: number
  usedSeats: number
  seatsCount: number
  totalCurrentUsage: number
  totalUsageLimit: number
  warningThresholdPercent: number
  minimumUsageLimit: number
  averageUsagePerMember: number
  billingPeriodStart: Date | null
  billingPeriodEnd: Date | null
  currentPeriodCost: number
  lastPeriodCost: number
  billedOverageThisPeriod: number
  currentPeriodCopilotCost: number
  lastPeriodCopilotCost: number
  totalCost: number
  totalCopilotCost: number
  billingBlocked: boolean
  members: MemberUsageData[]
}

interface MemberUsageData {
  userId: string
  userName: string
  userEmail: string
  currentUsage: number
  usageLimit: number
  percentUsed: number
  isOverLimit: boolean
  role: string
  joinedAt: Date
  lastActive: Date | null
}

export function getOrganizationMinimumUsageLimitUsd(
  subscription: Awaited<ReturnType<typeof getOrganizationSubscription>> | null
): number {
  return roundCurrency(getSubscriptionUsageAllowanceUsd(subscription))
}

/**
 * Get comprehensive organization billing and usage data
 */
export async function getOrganizationBillingData(
  organizationId: string
): Promise<OrganizationUsageData | null> {
  try {
    // Get organization info
    const orgRecord = await db
      .select()
      .from(organization)
      .where(eq(organization.id, organizationId))
      .limit(1)

    if (orgRecord.length === 0) {
      logger.warn('Organization not found', { organizationId })
      return null
    }

    const organizationData = orgRecord[0]

    // Get organization subscription directly (referenceId = organizationId)
    const [{ usageWarningThresholdPercent }, subscription, billingLedger] = await Promise.all([
      getResolvedBillingSettings(),
      getOrganizationSubscription(organizationId),
      getOrganizationBillingLedger(organizationId),
    ])

    if (!subscription) {
      logger.warn('No subscription found for organization', { organizationId })
      return null
    }

    if (!billingLedger) {
      logger.warn('Organization billing ledger not found', { organizationId })
      return null
    }

    const memberRows = await db
      .select({
        userId: member.userId,
        userName: user.name,
        userEmail: user.email,
        role: member.role,
        joinedAt: member.createdAt,
        lastActive: userStats.lastActive,
      })
      .from(member)
      .innerJoin(user, eq(member.userId, user.id))
      .leftJoin(userStats, eq(member.userId, userStats.userId))
      .where(eq(member.organizationId, organizationId))

    const memberLedgers =
      subscription.tier.usageScope === 'individual'
        ? await getOrganizationMemberBillingLedgers(organizationId)
        : []
    const memberLedgerByUserId = new Map(memberLedgers.map((ledger) => [ledger.userId, ledger]))

    // Process member data
    const members: MemberUsageData[] = memberRows.map((memberRecord) => {
      const memberLedger = memberLedgerByUserId.get(memberRecord.userId)
      const currentUsage =
        subscription.tier.usageScope === 'individual' ? (memberLedger?.currentPeriodCost ?? 0) : 0
      const usageLimit =
        subscription.tier.usageScope === 'individual'
          ? getTierUsageAllowanceUsd(subscription.tier)
          : 0
      const percentUsed = usageLimit > 0 ? (currentUsage / usageLimit) * 100 : 0

      return {
        userId: memberRecord.userId,
        userName: memberRecord.userName,
        userEmail: memberRecord.userEmail,
        currentUsage,
        usageLimit,
        percentUsed: Math.round(percentUsed * 100) / 100,
        isOverLimit: currentUsage > usageLimit,
        role: memberRecord.role,
        joinedAt: memberRecord.joinedAt,
        lastActive: memberRecord.lastActive,
      }
    })
    const totalMemberUsageLimit = members.reduce((total, memberRecord) => {
      return total + memberRecord.usageLimit
    }, 0)

    // Calculate aggregated statistics
    const totalCurrentUsage =
      subscription.tier.usageScope === 'individual'
        ? memberLedgers.reduce((total, ledger) => total + ledger.currentPeriodCost, 0)
        : billingLedger.currentPeriodCost
    const totalCopilotCost = billingLedger.currentPeriodCopilotCost
    const totalLastPeriodCopilotCost = billingLedger.lastPeriodCopilotCost

    const { basePrice: recurringPrice } = getBillingTierPricing(subscription.tier)
    // Use Stripe subscription seats as source of truth
    // Ensure we always have at least 1 seat (protect against 0 or falsy values)
    const licensedSeats = Math.max(subscription.seats || subscription.tier.seatCount || 1, 1)

    const minimumUsageLimit = getOrganizationMinimumUsageLimitUsd(subscription)
    let totalUsageLimit: number

    if (subscription.tier.usageScope === 'pooled') {
      const configuredLimit = organizationData.orgUsageLimit
        ? Number.parseFloat(organizationData.orgUsageLimit)
        : null

      totalUsageLimit =
        configuredLimit !== null ? Math.max(configuredLimit, minimumUsageLimit) : minimumUsageLimit
    } else {
      totalUsageLimit = totalMemberUsageLimit
    }

    const averageUsagePerMember = members.length > 0 ? totalCurrentUsage / members.length : 0

    // Billing period comes from the organization's subscription
    const billingPeriodStart = subscription.periodStart || null
    const billingPeriodEnd = subscription.periodEnd || null

    return {
      organizationId,
      organizationName: organizationData.name || '',
      subscriptionTier: {
        id: subscription.tier.id,
        displayName: subscription.tier.displayName,
        ownerType: 'organization',
        usageScope: subscription.tier.usageScope,
        seatMode: subscription.tier.seatMode,
        monthlyPriceUsd: roundCurrency(recurringPrice),
        seatCount: subscription.tier.seatCount ?? null,
        seatMaximum: subscription.tier.seatMaximum ?? null,
        canEditUsageLimit: canTierEditUsageLimit(subscription.tier),
        canConfigureSso: canTierConfigureSso(subscription.tier),
      },
      subscriptionStatus: subscription.status || 'inactive',
      seatPriceUsd: roundCurrency(recurringPrice),
      seatCount: subscription.tier.seatCount ?? null,
      seatMaximum: subscription.tier.seatMaximum ?? null,
      seatMode: subscription.tier.seatMode,
      totalSeats: licensedSeats,
      usedSeats: members.length,
      seatsCount: licensedSeats,
      totalCurrentUsage: roundCurrency(totalCurrentUsage),
      totalUsageLimit: roundCurrency(totalUsageLimit),
      warningThresholdPercent: usageWarningThresholdPercent,
      minimumUsageLimit,
      averageUsagePerMember: roundCurrency(averageUsagePerMember),
      billingPeriodStart,
      billingPeriodEnd,
      members: members.sort((a, b) => b.currentUsage - a.currentUsage), // Sort by usage desc
      currentPeriodCost: roundCurrency(billingLedger.currentPeriodCost),
      lastPeriodCost: roundCurrency(billingLedger.lastPeriodCost),
      billedOverageThisPeriod: roundCurrency(billingLedger.billedOverageThisPeriod),
      currentPeriodCopilotCost: roundCurrency(totalCopilotCost),
      lastPeriodCopilotCost: roundCurrency(totalLastPeriodCopilotCost),
      totalCost: roundCurrency(billingLedger.totalCost),
      totalCopilotCost: roundCurrency(billingLedger.totalCopilotCost),
      billingBlocked: billingLedger.billingBlocked,
    }
  } catch (error) {
    logger.error('Failed to get organization billing data', { organizationId, error })
    throw error
  }
}

/**
 * Update organization usage limit (cap)
 */
export async function updateOrganizationUsageLimit(
  organizationId: string,
  newLimit: number
): Promise<{ success: boolean; error?: string }> {
  try {
    // Validate the organization exists
    const orgRecord = await db
      .select()
      .from(organization)
      .where(eq(organization.id, organizationId))
      .limit(1)

    if (orgRecord.length === 0) {
      return { success: false, error: 'Organization not found' }
    }

    // Get subscription to validate minimum
    const subscription = await getOrganizationSubscription(organizationId)
    if (!subscription) {
      return { success: false, error: 'No active subscription found' }
    }

    if (!canTierEditUsageLimit(subscription.tier)) {
      return {
        success: false,
        error: 'This tier does not allow usage limit changes',
      }
    }

    if (subscription.tier.usageScope === 'individual') {
      return {
        success: false,
        error: 'Organization-level usage caps are only available for pooled billing tiers',
      }
    }

    const minimumUsageLimit = getOrganizationMinimumUsageLimitUsd(subscription)

    // Validate new limit is not below minimum
    if (newLimit < minimumUsageLimit) {
      return {
        success: false,
        error: `Usage limit cannot be less than the minimum included allowance of $${minimumUsageLimit.toFixed(2)}`,
      }
    }

    // Update the organization usage limit
    // Convert number to string for decimal column
    await db
      .update(organization)
      .set({
        orgUsageLimit: roundCurrency(newLimit).toFixed(2),
        updatedAt: new Date(),
      })
      .where(eq(organization.id, organizationId))

    logger.info('Organization usage limit updated', {
      organizationId,
      newLimit,
      minimumUsageLimit,
    })

    return { success: true }
  } catch (error) {
    logger.error('Failed to update organization usage limit', {
      organizationId,
      newLimit,
      error,
    })
    return {
      success: false,
      error: 'Failed to update usage limit',
    }
  }
}

/**
 * Check if a user is an owner or admin of a specific organization
 *
 * @param userId - The ID of the user to check
 * @param organizationId - The ID of the organization
 * @returns Promise<boolean> - True if the user is an owner or admin of the organization
 */
export async function isOrganizationOwnerOrAdmin(
  userId: string,
  organizationId: string
): Promise<boolean> {
  try {
    const memberRecord = await db
      .select({ role: member.role })
      .from(member)
      .where(and(eq(member.userId, userId), eq(member.organizationId, organizationId)))
      .limit(1)

    if (memberRecord.length === 0) {
      return false
    }

    const userRole = memberRecord[0].role
    return ['owner', 'admin'].includes(userRole)
  } catch (error) {
    logger.error('Error checking organization ownership/admin status:', error)
    return false
  }
}
