import { db } from '@tradinggoose/db'
import * as schema from '@tradinggoose/db/schema'
import { eq } from 'drizzle-orm'
import { syncUsageLimitsFromSubscription } from '@/lib/billing/core/usage'
import type { BillingTierRecord } from '@/lib/billing/tiers'
import { createLogger } from '@/lib/logs/console/logger'

const logger = createLogger('BillingOrganization')

type SubscriptionData = {
  id: string
  referenceType: 'user' | 'organization'
  referenceId: string
  status: string | null
  seats?: number | null
  tier?: BillingTierRecord | null
}

/**
 * Sync usage limits for subscription members
 * Updates usage limits for all users associated with the subscription
 */
export async function syncSubscriptionUsageLimits(subscription: SubscriptionData) {
  try {
    logger.info('Syncing subscription usage limits', {
      subscriptionId: subscription.id,
      referenceType: subscription.referenceType,
      referenceId: subscription.referenceId,
      billingTier: subscription.tier?.displayName,
    })

    if (subscription.referenceType === 'user') {
      await syncUsageLimitsFromSubscription(subscription.referenceId)

      logger.info('Synced usage limits for individual user subscription', {
        userId: subscription.referenceId,
        subscriptionId: subscription.id,
        billingTier: subscription.tier?.displayName,
      })
      return
    }

    const members = await db
      .select({ userId: schema.member.userId })
      .from(schema.member)
      .where(eq(schema.member.organizationId, subscription.referenceId))

    if (members.length > 0) {
      for (const member of members) {
        try {
          await syncUsageLimitsFromSubscription(member.userId)
        } catch (memberError) {
          logger.error('Failed to sync usage limits for organization member', {
            userId: member.userId,
            organizationId: subscription.referenceId,
            subscriptionId: subscription.id,
            error: memberError,
          })
        }
      }

      logger.info('Synced usage limits for organization members', {
        organizationId: subscription.referenceId,
        memberCount: members.length,
        subscriptionId: subscription.id,
        billingTier: subscription.tier?.displayName,
      })
    }
  } catch (error) {
    logger.error('Failed to sync subscription usage limits', {
      subscriptionId: subscription.id,
      referenceType: subscription.referenceType,
      referenceId: subscription.referenceId,
      error,
    })
    throw error
  }
}
