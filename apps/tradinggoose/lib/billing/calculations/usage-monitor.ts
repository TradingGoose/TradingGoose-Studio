import { db } from '@tradinggoose/db'
import { organization, userStats } from '@tradinggoose/db/schema'
import { eq } from 'drizzle-orm'
import {
  getOrganizationBillingLedger,
  getOrganizationMemberBillingLedger,
} from '@/lib/billing/core/organization'
import { getUserUsageData } from '@/lib/billing/core/usage'
import { getResolvedBillingSettings, isBillingEnabledForRuntime } from '@/lib/billing/settings'
import { getSubscriptionUsageAllowanceUsd, getTierUsageAllowanceUsd } from '@/lib/billing/tiers'
import {
  resolveWorkflowBillingContext,
  resolveWorkspaceBillingContext,
} from '@/lib/billing/workspace-billing'
import { createLogger } from '@/lib/logs/console/logger'

const logger = createLogger('UsageMonitor')

interface UsageData {
  percentUsed: number
  isWarning: boolean
  isExceeded: boolean
  currentUsage: number
  limit: number
}

async function getUsageMonitorStatus(userId: string): Promise<UsageData> {
  try {
    const { billingEnabled, usageWarningThresholdPercent } = await getResolvedBillingSettings()

    // If billing is disabled, always return permissive limits
    if (!billingEnabled) {
      // Get actual usage from the database for display purposes
      const statsRecords = await db.select().from(userStats).where(eq(userStats.userId, userId))
      const currentUsage =
        statsRecords.length > 0
          ? Number.parseFloat(statsRecords[0].currentPeriodCost?.toString() || '0')
          : 0

      return {
        percentUsed: Math.min((currentUsage / 1000) * 100, 100),
        isWarning: false,
        isExceeded: false,
        currentUsage,
        limit: 1000,
      }
    }

    const usageData = await getUserUsageData(userId)
    const limit = usageData.limit
    const currentUsage = usageData.currentUsage
    const percentUsed = usageData.percentUsed
    const isWarning = percentUsed >= usageWarningThresholdPercent && percentUsed < 100
    const isExceeded = currentUsage >= limit

    logger.info('Final usage statistics', {
      userId,
      currentUsage,
      limit,
      percentUsed,
      isWarning,
      isExceeded,
    })

    return {
      percentUsed,
      isWarning,
      isExceeded,
      currentUsage,
      limit,
    }
  } catch (error) {
    logger.error('Error checking usage status', {
      error: error instanceof Error ? { message: error.message, stack: error.stack } : error,
      userId,
    })

    // Block execution if we can't determine usage status
    logger.error('Cannot determine usage status - blocking execution', {
      userId,
      error: error instanceof Error ? error.message : String(error),
    })

    return {
      percentUsed: 100,
      isWarning: false,
      isExceeded: true, // Block execution when we can't determine status
      currentUsage: 0,
      limit: 0, // Zero limit forces blocking
    }
  }
}

/**
 * Server-side function to check if a user has exceeded their usage limits
 * For use in API routes, webhooks, and scheduled executions
 *
 * @param userId The ID of the user to check
 * @returns An object containing the exceeded status and usage details
 */
export async function checkServerSideUsageLimits(params: {
  userId: string
  workspaceId?: string | null
  workflowId?: string | null
}): Promise<{
  isExceeded: boolean
  currentUsage: number
  limit: number
  message?: string
}> {
  const { userId, workspaceId = null, workflowId = null } = params

  try {
    const { billingEnabled, usageWarningThresholdPercent } = await getResolvedBillingSettings()

    if (!billingEnabled) {
      return {
        isExceeded: false,
        currentUsage: 0,
        limit: 99999,
      }
    }

    logger.info('Server-side checking usage limits for user', {
      userId,
      workspaceId,
      workflowId,
    })

    const billingContext = workflowId
      ? await resolveWorkflowBillingContext({ workflowId, actorUserId: userId })
      : workspaceId
        ? await resolveWorkspaceBillingContext({ workspaceId, actorUserId: userId })
        : null

    if (billingContext?.scopeType === 'organization' && billingContext.scopeId) {
      const [billingLedger, orgRows] = await Promise.all([
        getOrganizationBillingLedger(billingContext.scopeId),
        db
          .select({ orgUsageLimit: organization.orgUsageLimit })
          .from(organization)
          .where(eq(organization.id, billingContext.scopeId))
          .limit(1),
      ])

      const currentUsage = billingLedger?.currentPeriodCost ?? 0
      const minimumLimit = getSubscriptionUsageAllowanceUsd(
        billingContext.subscription ?? billingContext.tier
      )
      const configuredLimit =
        orgRows.length > 0 && orgRows[0].orgUsageLimit
          ? Number.parseFloat(orgRows[0].orgUsageLimit)
          : null
      const limit =
        configuredLimit !== null ? Math.max(configuredLimit, minimumLimit) : minimumLimit

      if (billingLedger?.billingBlocked) {
        return {
          isExceeded: true,
          currentUsage,
          limit: 0,
          message: 'Billing issue detected. Please update your payment method to continue.',
        }
      }

      const percentUsed = limit > 0 ? Math.min((currentUsage / limit) * 100, 100) : 0
      const isWarning = percentUsed >= usageWarningThresholdPercent && percentUsed < 100
      const isExceeded = currentUsage >= limit

      logger.info('Final organization usage statistics', {
        userId,
        workspaceId,
        workflowId,
        currentUsage,
        limit,
        percentUsed,
        isWarning,
        isExceeded,
      })

      return {
        isExceeded,
        currentUsage,
        limit,
        message: isExceeded
          ? `Usage limit exceeded: ${currentUsage?.toFixed(2) || 0}$ used of ${limit?.toFixed(2) || 0}$ limit. Please upgrade your billing tier to continue.`
          : undefined,
      }
    }

    if (
      billingContext?.scopeType === 'organization_member' &&
      billingContext.billingOwner.type === 'organization'
    ) {
      const organizationId = billingContext.billingOwner.organizationId
      const [billingLedger, memberLedger] = await Promise.all([
        getOrganizationBillingLedger(organizationId),
        getOrganizationMemberBillingLedger(organizationId, billingContext.billingUserId),
      ])

      const currentUsage = memberLedger?.currentPeriodCost ?? 0
      const limit = getTierUsageAllowanceUsd(billingContext.subscription?.tier ?? billingContext.tier)

      if (billingLedger?.billingBlocked) {
        return {
          isExceeded: true,
          currentUsage,
          limit: 0,
          message: 'Billing issue detected. Please update your payment method to continue.',
        }
      }

      return {
        isExceeded: currentUsage >= limit,
        currentUsage,
        limit,
        message:
          currentUsage >= limit
            ? `Usage limit exceeded: ${currentUsage?.toFixed(2) || 0}$ used of ${limit?.toFixed(2) || 0}$ limit. Please upgrade your billing tier to continue.`
            : undefined,
      }
    }

    const usageData = await getUsageMonitorStatus(userId)

    return {
      isExceeded: usageData.isExceeded,
      currentUsage: usageData.currentUsage,
      limit: usageData.limit,
      message: usageData.isExceeded
        ? `Usage limit exceeded: ${usageData.currentUsage?.toFixed(2) || 0}$ used of ${usageData.limit?.toFixed(2) || 0}$ limit. Please upgrade your billing tier to continue.`
        : undefined,
    }
  } catch (error) {
    logger.error('Error in server-side usage limit check', {
      error: error instanceof Error ? { message: error.message, stack: error.stack } : error,
      userId,
    })

    logger.error('Cannot determine usage limits - blocking execution', {
      userId,
      error: error instanceof Error ? error.message : String(error),
    })

    return {
      isExceeded: true, // Block execution when we can't determine limits
      currentUsage: 0,
      limit: 0, // Zero limit forces blocking
      message:
        error instanceof Error && error.message.includes('No user stats record found')
          ? 'User account not properly initialized. Please contact support.'
          : 'Unable to determine usage limits. Execution blocked for security. Please contact support.',
    }
  }
}
