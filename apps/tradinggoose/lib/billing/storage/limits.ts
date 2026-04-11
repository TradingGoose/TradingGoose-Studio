/**
 * Storage limit management
 * Similar to cost limits but for file storage quotas
 */

import { db } from '@tradinggoose/db'
import { organization, userStats } from '@tradinggoose/db/schema'
import { eq } from 'drizzle-orm'
import { isBillingEnabledForRuntime } from '@/lib/billing/settings'
import {
  type BillingTierRecord,
  isOrganizationSubscription,
  requireDefaultBillingTier,
} from '@/lib/billing/tiers'
import { resolveWorkspaceBillingContext } from '@/lib/billing/workspace-billing'
import { createLogger } from '@/lib/logs/console/logger'

const logger = createLogger('StorageLimits')

/**
 * Convert GB to bytes
 */
function gbToBytes(gb: number): number {
  return gb * 1024 * 1024 * 1024
}

function parseStorageLimitGb(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value) && value >= 0) {
    return value
  }

  if (typeof value === 'string' && value.trim().length > 0) {
    const parsed = Number.parseInt(value, 10)
    if (Number.isFinite(parsed) && parsed >= 0) {
      return parsed
    }
  }

  return null
}

function getTierStorageLimitBytes(tier: BillingTierRecord): number {
  const storageLimitGb = parseStorageLimitGb(tier.storageLimitGb)

  if (storageLimitGb === null) {
    throw new Error(`Billing tier ${tier.displayName} is missing storageLimitGb`)
  }

  return gbToBytes(storageLimitGb)
}
export async function getUserStorageLimit(
  userId: string,
  workspaceId?: string | null
): Promise<number> {
  try {
    const billingContext = await resolveWorkspaceBillingContext({
      workspaceId,
      actorUserId: userId,
    })
    return getTierStorageLimitBytes(billingContext.tier)
  } catch (error) {
    logger.error('Error getting user storage limit:', error)
    try {
      const defaultTier = await requireDefaultBillingTier()
      return getTierStorageLimitBytes(defaultTier)
    } catch {
      return 0
    }
  }
}

/**
 * Get current storage usage for a user
 * Returns usage in bytes
 */
export async function getUserStorageUsage(
  userId: string,
  workspaceId?: string | null
): Promise<number> {
  try {
    const billingContext = await resolveWorkspaceBillingContext({
      workspaceId,
      actorUserId: userId,
    })

    if (isOrganizationSubscription(billingContext.subscription)) {
      // Use organization storage
      const orgRecord = await db
        .select({ storageUsedBytes: organization.storageUsedBytes })
        .from(organization)
        .where(eq(organization.id, billingContext.scopeId))
        .limit(1)

      return orgRecord.length > 0 ? orgRecord[0].storageUsedBytes || 0 : 0
    }

    // Individual-scope tiers use user stats
    const stats = await db
      .select({ storageUsedBytes: userStats.storageUsedBytes })
      .from(userStats)
      .where(eq(userStats.userId, billingContext.billingUserId))
      .limit(1)

    return stats.length > 0 ? stats[0].storageUsedBytes || 0 : 0
  } catch (error) {
    logger.error('Error getting user storage usage:', error)
    return 0
  }
}

/**
 * Check if user has storage quota available
 * Always allows uploads when billing is disabled
 */
export async function checkStorageQuota(
  userId: string,
  additionalBytes: number,
  workspaceId?: string | null
): Promise<{ allowed: boolean; currentUsage: number; limit: number; error?: string }> {
  if (!(await isBillingEnabledForRuntime())) {
    return {
      allowed: true,
      currentUsage: 0,
      limit: Number.MAX_SAFE_INTEGER,
    }
  }

  try {
    const [currentUsage, limit] = await Promise.all([
      getUserStorageUsage(userId, workspaceId),
      getUserStorageLimit(userId, workspaceId),
    ])

    const newUsage = currentUsage + additionalBytes
    const allowed = newUsage <= limit

    return {
      allowed,
      currentUsage,
      limit,
      error: allowed
        ? undefined
        : `Storage limit exceeded. Used: ${(newUsage / (1024 * 1024 * 1024)).toFixed(2)}GB, Limit: ${(limit / (1024 * 1024 * 1024)).toFixed(0)}GB`,
    }
  } catch (error) {
    logger.error('Error checking storage quota:', error)
    return {
      allowed: false,
      currentUsage: 0,
      limit: 0,
      error: 'Failed to check storage quota',
    }
  }
}
