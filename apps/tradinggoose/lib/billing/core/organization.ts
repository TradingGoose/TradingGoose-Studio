import { db } from '@sim/db'
import { member, organization, subscription, user, userStats } from '@sim/db/schema'
import { and, eq } from 'drizzle-orm'
import { getPlanPricing } from '@/lib/billing/core/billing'
import { getFreeTierLimit } from '@/lib/billing/subscriptions/utils'
import { createLogger } from '@/lib/logs/console/logger'

const logger = createLogger('OrganizationBilling')

/**
 * Get organization subscription directly by organization ID
 * This is for our new pattern where referenceId = organizationId
 */
async function getOrganizationSubscription(organizationId: string) {
  try {
    // Prefer an active subscription; fall back to any subscription for the org if none are active
    const activeSubs = await db
      .select()
      .from(subscription)
      .where(and(eq(subscription.referenceId, organizationId), eq(subscription.status, 'active')))
      .limit(1)

    if (activeSubs.length > 0) return activeSubs[0]

    const anySubs = await db
      .select()
      .from(subscription)
      .where(eq(subscription.referenceId, organizationId))
      .limit(1)

    return anySubs.length > 0 ? anySubs[0] : null
  } catch (error) {
    logger.error('Error getting organization subscription', { error, organizationId })
    return null
  }
}

function roundCurrency(value: number): number {
  return Math.round(value * 100) / 100
}

interface OrganizationUsageData {
  organizationId: string
  organizationName: string
  subscriptionPlan: string
  subscriptionStatus: string
  totalSeats: number
  usedSeats: number
  seatsCount: number
  totalCurrentUsage: number
  totalUsageLimit: number
  minimumBillingAmount: number
  averageUsagePerMember: number
  billingPeriodStart: Date | null
  billingPeriodEnd: Date | null
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

function buildDefaultOrgBillingSummary(org: any): OrganizationUsageData {
  const usageLimit = org?.orgUsageLimit ? Number.parseFloat(org.orgUsageLimit) : 0
  return {
    organizationId: org?.id ?? '',
    organizationName: org?.name ?? '',
    subscriptionPlan: 'free',
    subscriptionStatus: 'inactive',
    totalSeats: 1,
    usedSeats: 0,
    seatsCount: 1,
    totalCurrentUsage: 0,
    totalUsageLimit: roundCurrency(usageLimit),
    minimumBillingAmount: roundCurrency(usageLimit),
    averageUsagePerMember: 0,
    billingPeriodStart: null,
    billingPeriodEnd: null,
    members: [],
  }
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
    const subscription = await getOrganizationSubscription(organizationId)

    if (!subscription) {
      logger.warn('No subscription found for organization', { organizationId })
      return buildDefaultOrgBillingSummary(organizationData)
    }

    // Get all organization members with their usage data
    const membersWithUsage = await db
      .select({
        userId: member.userId,
        userName: user.name,
        userEmail: user.email,
        role: member.role,
        joinedAt: member.createdAt,
        // User stats fields
        currentPeriodCost: userStats.currentPeriodCost,
        currentUsageLimit: userStats.currentUsageLimit,
        lastActive: userStats.lastActive,
      })
      .from(member)
      .innerJoin(user, eq(member.userId, user.id))
      .leftJoin(userStats, eq(member.userId, userStats.userId))
      .where(eq(member.organizationId, organizationId))

    // Process member data
    const members: MemberUsageData[] = membersWithUsage.map((memberRecord) => {
      const currentUsage = Number(memberRecord.currentPeriodCost || 0)
      const usageLimit = Number(memberRecord.currentUsageLimit || getFreeTierLimit())
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

    // Calculate aggregated statistics
    const totalCurrentUsage = members.reduce((sum, member) => sum + member.currentUsage, 0)

    const seats = Math.max(subscription.seats || 1, 1)
    const licensedSeats = seats
    const metadata = (subscription as any)?.metadata ?? {}
    const perSeatAllowance = Number.isFinite(Number(metadata?.perSeatAllowance))
      ? Number(metadata.perSeatAllowance)
      : null
    const totalAllowance = Number.isFinite(Number(metadata?.totalAllowance))
      ? Number(metadata.totalAllowance)
      : null

    // Get per-seat pricing for the plan (defaults)
    const { basePrice: defaultPerSeat } = getPlanPricing(subscription.plan)
    // Derive base allowance from metadata or defaults
    const allowanceFromMetadata =
      totalAllowance !== null
        ? totalAllowance
        : perSeatAllowance !== null
          ? perSeatAllowance * seats
          : null
    const minimumFromPlan = seats * defaultPerSeat
    const minimumBillingAmount = Math.max(allowanceFromMetadata ?? 0, minimumFromPlan)

    const configuredLimit = organizationData.orgUsageLimit
      ? Number.parseFloat(organizationData.orgUsageLimit)
      : null
    const totalUsageLimit =
      configuredLimit !== null
        ? Math.max(configuredLimit, minimumBillingAmount)
        : minimumBillingAmount

    const averageUsagePerMember = members.length > 0 ? totalCurrentUsage / members.length : 0

    // Billing period comes from the organization's subscription
    const billingPeriodStart = subscription.periodStart || null
    const billingPeriodEnd = subscription.periodEnd || null

    return {
      organizationId,
      organizationName: organizationData.name || '',
      subscriptionPlan: subscription.plan,
      subscriptionStatus: subscription.status || 'inactive',
      totalSeats: Math.max(subscription.seats || 1, 1),
      usedSeats: members.length,
      seatsCount: licensedSeats,
      totalCurrentUsage: roundCurrency(totalCurrentUsage),
      totalUsageLimit: roundCurrency(totalUsageLimit),
      minimumBillingAmount: roundCurrency(minimumBillingAmount),
      averageUsagePerMember: roundCurrency(averageUsagePerMember),
      billingPeriodStart,
      billingPeriodEnd,
      members: members.sort((a, b) => b.currentUsage - a.currentUsage), // Sort by usage desc
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

    // Enterprise plans have fixed usage limits that cannot be changed
    if (subscription.plan === 'enterprise') {
      return {
        success: false,
        error: 'Enterprise plans have fixed usage limits that cannot be changed',
      }
    }

    // Only team plans can update their usage limits
    if (subscription.plan !== 'team') {
      return {
        success: false,
        error: 'Only team organizations can update usage limits',
      }
    }

    // Team plans have minimum based on seats
    const { basePrice } = getPlanPricing(subscription.plan)
    const minimumLimit = Math.max(subscription.seats || 1, 1) * basePrice

    // Validate new limit is not below minimum
    if (newLimit < minimumLimit) {
      return {
        success: false,
        error: `Usage limit cannot be less than minimum billing amount of $${roundCurrency(minimumLimit).toFixed(2)}`,
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
      minimumLimit,
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
 * Get organization billing summary for admin dashboard
 */
export async function getOrganizationBillingSummary(organizationId: string) {
  try {
    const billingData = await getOrganizationBillingData(organizationId)

    if (!billingData) {
      return null
    }

    // Calculate additional metrics
    const membersOverLimit = billingData.members.filter((m) => m.isOverLimit).length
    const membersNearLimit = billingData.members.filter(
      (m) => !m.isOverLimit && m.percentUsed >= 80
    ).length

    const topUsers = billingData.members.slice(0, 5).map((m) => ({
      name: m.userName,
      usage: m.currentUsage,
      limit: m.usageLimit,
      percentUsed: m.percentUsed,
    }))

    return {
      organization: {
        id: billingData.organizationId,
        name: billingData.organizationName,
        plan: billingData.subscriptionPlan,
        status: billingData.subscriptionStatus,
      },
      usage: {
        total: billingData.totalCurrentUsage,
        limit: billingData.totalUsageLimit,
        average: billingData.averageUsagePerMember,
        percentUsed:
          billingData.totalUsageLimit > 0
            ? (billingData.totalCurrentUsage / billingData.totalUsageLimit) * 100
            : 0,
      },
      seats: {
        total: billingData.totalSeats,
        used: billingData.usedSeats,
        available: billingData.totalSeats - billingData.usedSeats,
      },
      alerts: {
        membersOverLimit,
        membersNearLimit,
      },
      billingPeriod: {
        start: billingData.billingPeriodStart,
        end: billingData.billingPeriodEnd,
      },
      topUsers,
    }
  } catch (error) {
    logger.error('Failed to get organization billing summary', { organizationId, error })
    throw error
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
