/**
 * Storage usage tracking
 * Updates storage_used_bytes for users and organizations
 * Only tracks when billing is enabled
 */

import { db } from '@tradinggoose/db'
import { organization, userStats } from '@tradinggoose/db/schema'
import { eq, sql } from 'drizzle-orm'
import { isBillingEnabledForRuntime } from '@/lib/billing/settings'
import { isOrganizationSubscription } from '@/lib/billing/tiers'
import { resolveWorkspaceBillingContext } from '@/lib/billing/workspace-billing'
import { createLogger } from '@/lib/logs/console/logger'

const logger = createLogger('StorageTracking')

/**
 * Increment storage usage after successful file upload
 * Only tracks if billing is enabled
 */
export async function incrementStorageUsage(
  userId: string,
  bytes: number,
  workspaceId?: string | null
): Promise<void> {
  if (!(await isBillingEnabledForRuntime())) {
    logger.debug('Billing disabled, skipping storage increment')
    return
  }

  try {
    const billingContext = await resolveWorkspaceBillingContext({
      workspaceId,
      actorUserId: userId,
    })

    if (isOrganizationSubscription(billingContext.subscription)) {
      // Update organization storage
      await db
        .update(organization)
        .set({
          storageUsedBytes: sql`${organization.storageUsedBytes} + ${bytes}`,
        })
        .where(eq(organization.id, billingContext.scopeId))

      logger.info(`Incremented org storage: ${bytes} bytes for org ${billingContext.scopeId}`)
    } else {
      // Update user stats storage
      await db
        .update(userStats)
        .set({
          storageUsedBytes: sql`${userStats.storageUsedBytes} + ${bytes}`,
        })
        .where(eq(userStats.userId, billingContext.billingUserId))

      logger.info(
        `Incremented user storage: ${bytes} bytes for user ${billingContext.billingUserId}`
      )
    }
  } catch (error) {
    logger.error('Error incrementing storage usage:', error)
    throw error
  }
}

/**
 * Decrement storage usage after file deletion
 * Only tracks if billing is enabled
 */
export async function decrementStorageUsage(
  userId: string,
  bytes: number,
  workspaceId?: string | null
): Promise<void> {
  if (!(await isBillingEnabledForRuntime())) {
    logger.debug('Billing disabled, skipping storage decrement')
    return
  }

  try {
    const billingContext = await resolveWorkspaceBillingContext({
      workspaceId,
      actorUserId: userId,
    })

    if (isOrganizationSubscription(billingContext.subscription)) {
      // Update organization storage
      await db
        .update(organization)
        .set({
          storageUsedBytes: sql`GREATEST(0, ${organization.storageUsedBytes} - ${bytes})`,
        })
        .where(eq(organization.id, billingContext.scopeId))

      logger.info(`Decremented org storage: ${bytes} bytes for org ${billingContext.scopeId}`)
    } else {
      // Update user stats storage
      await db
        .update(userStats)
        .set({
          storageUsedBytes: sql`GREATEST(0, ${userStats.storageUsedBytes} - ${bytes})`,
        })
        .where(eq(userStats.userId, billingContext.billingUserId))

      logger.info(
        `Decremented user storage: ${bytes} bytes for user ${billingContext.billingUserId}`
      )
    }
  } catch (error) {
    logger.error('Error decrementing storage usage:', error)
    throw error
  }
}
