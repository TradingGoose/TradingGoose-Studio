import { db } from '@tradinggoose/db'
import { userRateLimits } from '@tradinggoose/db/schema'
import { eq, sql } from 'drizzle-orm'
import { getEffectiveSubscription } from '@/lib/billing/core/subscription'
import { isBillingEnabledForRuntime } from '@/lib/billing/settings'
import {
  type BillingScope,
  type BillingTierRecord,
  getSubscriptionBillingScope,
  getTierRateLimits,
} from '@/lib/billing/tiers'
import { createLogger } from '@/lib/logs/console/logger'
import {
  MANUAL_EXECUTION_LIMIT,
  RATE_LIMIT_WINDOW_MS,
  type RateLimitCounterType,
  type TriggerType,
} from '@/services/queue/types'

const logger = createLogger('RateLimiter')
const UNLIMITED_RATE_LIMIT = Number.MAX_SAFE_INTEGER
interface SubscriptionInfo {
  referenceType: 'user' | 'organization'
  referenceId: string
  tier?: BillingTierRecord | null
}

export class RateLimiter {
  /**
   * Determine the rate limit key based on subscription
   * Pooled tiers share a single rate-limit key across the subscription scope.
   * Individual tiers always use the user ID as the rate-limit key.
   */
  private getRateLimitKey(
    userId: string,
    subscription: SubscriptionInfo | null,
    billingScope?: BillingScope | null
  ): string {
    return this.getResolvedRateLimitScope(userId, subscription, billingScope).scopeId
  }

  private getResolvedRateLimitScope(
    userId: string,
    subscription: SubscriptionInfo | null,
    billingScope?: BillingScope | null
  ): BillingScope {
    if (billingScope?.scopeId) {
      return billingScope
    }

    const resolvedScope = getSubscriptionBillingScope(userId, subscription)
    return {
      scopeType: resolvedScope.scopeType,
      scopeId: resolvedScope.scopeId,
      organizationId: resolvedScope.organizationId,
      userId: resolvedScope.userId,
    }
  }

  /**
   * Determine which counter type to use based on trigger type and async flag
   */
  private getCounterType(triggerType: TriggerType, isAsync: boolean): RateLimitCounterType {
    if (triggerType === 'api-endpoint') {
      return 'api-endpoint'
    }
    return isAsync ? 'async' : 'sync'
  }

  /**
   * Get the rate limit for a specific counter type
   */
  private getRateLimitForCounter(
    config: {
      syncPerMinute: number
      asyncPerMinute: number
      apiEndpointPerMinute: number
    },
    counterType: RateLimitCounterType
  ): number {
    switch (counterType) {
      case 'api-endpoint':
        return config.apiEndpointPerMinute
      case 'async':
        return config.asyncPerMinute
      case 'sync':
        return config.syncPerMinute
    }
  }

  /**
   * Get the current count from a rate limit record for a specific counter type
   */
  private getCountFromRecord(
    record: {
      syncApiRequests: number
      asyncApiRequests: number
      apiEndpointRequests: number
    },
    counterType: RateLimitCounterType
  ): number {
    switch (counterType) {
      case 'api-endpoint':
        return record.apiEndpointRequests
      case 'async':
        return record.asyncApiRequests
      case 'sync':
        return record.syncApiRequests
    }
  }

  /**
   * Check if user can execute a workflow with organization-aware rate limiting
   * Manual executions bypass rate limiting entirely
   */
  async checkRateLimitWithSubscription(
    userId: string,
    subscription: SubscriptionInfo | null,
    triggerType: TriggerType = 'manual',
    isAsync = false,
    billingScope?: BillingScope | null
  ): Promise<{ allowed: boolean; remaining: number; resetAt: Date }> {
    try {
      if (!(await isBillingEnabledForRuntime())) {
        return {
          allowed: true,
          remaining: UNLIMITED_RATE_LIMIT,
          resetAt: new Date(Date.now() + RATE_LIMIT_WINDOW_MS),
        }
      }

      if (triggerType === 'manual') {
        return {
          allowed: true,
          remaining: MANUAL_EXECUTION_LIMIT,
          resetAt: new Date(Date.now() + RATE_LIMIT_WINDOW_MS),
        }
      }

      if (!subscription?.tier) {
        logger.error(
          'Blocking rate-limited execution because no active subscription tier was found',
          {
            userId,
            triggerType,
          }
        )
        return {
          allowed: false,
          remaining: 0,
          resetAt: new Date(Date.now() + RATE_LIMIT_WINDOW_MS),
        }
      }

      const effectiveTier = subscription.tier
      const rateLimits = getTierRateLimits(effectiveTier)
      const rateLimitKey = this.getRateLimitKey(userId, subscription, billingScope)
      const resolvedScope = this.getResolvedRateLimitScope(userId, subscription, billingScope)

      const counterType = this.getCounterType(triggerType, isAsync)
      const execLimit = this.getRateLimitForCounter(rateLimits, counterType)

      const now = new Date()
      const windowStart = new Date(now.getTime() - RATE_LIMIT_WINDOW_MS)

      // Get or create rate limit record using the rate limit key
      const [rateLimitRecord] = await db
        .select()
        .from(userRateLimits)
        .where(eq(userRateLimits.referenceId, rateLimitKey))
        .limit(1)

      if (!rateLimitRecord || new Date(rateLimitRecord.windowStart) < windowStart) {
        // Window expired - reset window with this request as the first one
        const result = await db
          .insert(userRateLimits)
          .values({
            referenceId: rateLimitKey,
            syncApiRequests: counterType === 'sync' ? 1 : 0,
            asyncApiRequests: counterType === 'async' ? 1 : 0,
            apiEndpointRequests: counterType === 'api-endpoint' ? 1 : 0,
            windowStart: now,
            lastRequestAt: now,
            isRateLimited: false,
          })
          .onConflictDoUpdate({
            target: userRateLimits.referenceId,
            set: {
              // Only reset if window is still expired (avoid race condition)
              syncApiRequests: sql`CASE WHEN ${userRateLimits.windowStart} < ${windowStart.toISOString()} THEN ${counterType === 'sync' ? 1 : 0} ELSE ${userRateLimits.syncApiRequests} + ${counterType === 'sync' ? 1 : 0} END`,
              asyncApiRequests: sql`CASE WHEN ${userRateLimits.windowStart} < ${windowStart.toISOString()} THEN ${counterType === 'async' ? 1 : 0} ELSE ${userRateLimits.asyncApiRequests} + ${counterType === 'async' ? 1 : 0} END`,
              apiEndpointRequests: sql`CASE WHEN ${userRateLimits.windowStart} < ${windowStart.toISOString()} THEN ${counterType === 'api-endpoint' ? 1 : 0} ELSE ${userRateLimits.apiEndpointRequests} + ${counterType === 'api-endpoint' ? 1 : 0} END`,
              windowStart: sql`CASE WHEN ${userRateLimits.windowStart} < ${windowStart.toISOString()} THEN ${now.toISOString()} ELSE ${userRateLimits.windowStart} END`,
              lastRequestAt: now,
              isRateLimited: false,
              rateLimitResetAt: null,
            },
          })
          .returning({
            syncApiRequests: userRateLimits.syncApiRequests,
            asyncApiRequests: userRateLimits.asyncApiRequests,
            apiEndpointRequests: userRateLimits.apiEndpointRequests,
            windowStart: userRateLimits.windowStart,
          })

        const insertedRecord = result[0]
        const actualCount = this.getCountFromRecord(insertedRecord, counterType)

        // Check if we exceeded the limit
        if (actualCount > execLimit) {
          const resetAt = new Date(
            new Date(insertedRecord.windowStart).getTime() + RATE_LIMIT_WINDOW_MS
          )

          await db
            .update(userRateLimits)
            .set({
              isRateLimited: true,
              rateLimitResetAt: resetAt,
            })
            .where(eq(userRateLimits.referenceId, rateLimitKey))

          logger.info(
            `Rate limit exceeded - request ${actualCount} > limit ${execLimit} for ${
              resolvedScope.scopeType === 'organization'
                ? `organization ${resolvedScope.scopeId}`
                : resolvedScope.scopeType === 'organization_member'
                  ? `organization member ${resolvedScope.scopeId}`
                  : `user ${resolvedScope.scopeId}`
            }`,
            {
              execLimit,
              isAsync,
              actualCount,
              rateLimitKey,
              billingTier: effectiveTier.displayName,
            }
          )

          return {
            allowed: false,
            remaining: 0,
            resetAt,
          }
        }

        return {
          allowed: true,
          remaining: execLimit - actualCount,
          resetAt: new Date(new Date(insertedRecord.windowStart).getTime() + RATE_LIMIT_WINDOW_MS),
        }
      }

      // Simple atomic increment - increment first, then check if over limit
      const updateResult = await db
        .update(userRateLimits)
        .set({
          ...(counterType === 'api-endpoint'
            ? {
                apiEndpointRequests: sql`${userRateLimits.apiEndpointRequests} + 1`,
              }
            : counterType === 'async'
              ? {
                  asyncApiRequests: sql`${userRateLimits.asyncApiRequests} + 1`,
                }
              : {
                  syncApiRequests: sql`${userRateLimits.syncApiRequests} + 1`,
                }),
          lastRequestAt: now,
        })
        .where(eq(userRateLimits.referenceId, rateLimitKey))
        .returning({
          asyncApiRequests: userRateLimits.asyncApiRequests,
          syncApiRequests: userRateLimits.syncApiRequests,
          apiEndpointRequests: userRateLimits.apiEndpointRequests,
        })

      const updatedRecord = updateResult[0]
      const actualNewRequests = this.getCountFromRecord(updatedRecord, counterType)

      // Check if we exceeded the limit AFTER the atomic increment
      if (actualNewRequests > execLimit) {
        const resetAt = new Date(
          new Date(rateLimitRecord.windowStart).getTime() + RATE_LIMIT_WINDOW_MS
        )

        logger.info(
          `Rate limit exceeded - request ${actualNewRequests} > limit ${execLimit} for ${
            resolvedScope.scopeType === 'organization'
              ? `organization ${resolvedScope.scopeId}`
              : resolvedScope.scopeType === 'organization_member'
                ? `organization member ${resolvedScope.scopeId}`
                : `user ${resolvedScope.scopeId}`
          }`,
          {
            execLimit,
            isAsync,
            actualNewRequests,
            rateLimitKey,
            billingTier: effectiveTier.displayName,
          }
        )

        // Update rate limited status
        await db
          .update(userRateLimits)
          .set({
            isRateLimited: true,
            rateLimitResetAt: resetAt,
          })
          .where(eq(userRateLimits.referenceId, rateLimitKey))

        return {
          allowed: false,
          remaining: 0,
          resetAt,
        }
      }

      return {
        allowed: true,
        remaining: execLimit - actualNewRequests,
        resetAt: new Date(new Date(rateLimitRecord.windowStart).getTime() + RATE_LIMIT_WINDOW_MS),
      }
    } catch (error) {
      logger.error('Error checking rate limit:', error)
      return {
        allowed: false,
        remaining: 0,
        resetAt: new Date(Date.now() + RATE_LIMIT_WINDOW_MS),
      }
    }
  }

  async checkRateLimit(
    userId: string,
    triggerType: TriggerType = 'manual',
    isAsync = false
  ): Promise<{ allowed: boolean; remaining: number; resetAt: Date }> {
    const subscription = await getEffectiveSubscription(userId)
    return this.checkRateLimitWithSubscription(userId, subscription, triggerType, isAsync)
  }

  /**
   * Get current rate limit status with organization awareness
   * Only applies to API executions
   */
  async getRateLimitStatusWithSubscription(
    userId: string,
    subscription: SubscriptionInfo | null,
    triggerType: TriggerType = 'manual',
    isAsync = false,
    billingScope?: BillingScope | null
  ): Promise<{
    used: number
    limit: number
    remaining: number
    resetAt: Date
  }> {
    try {
      if (!(await isBillingEnabledForRuntime())) {
        return {
          used: 0,
          limit: UNLIMITED_RATE_LIMIT,
          remaining: UNLIMITED_RATE_LIMIT,
          resetAt: new Date(Date.now() + RATE_LIMIT_WINDOW_MS),
        }
      }

      if (triggerType === 'manual') {
        return {
          used: 0,
          limit: MANUAL_EXECUTION_LIMIT,
          remaining: MANUAL_EXECUTION_LIMIT,
          resetAt: new Date(Date.now() + RATE_LIMIT_WINDOW_MS),
        }
      }

      if (!subscription?.tier) {
        logger.error(
          'Returning blocked rate-limit status because no active subscription tier was found',
          {
            userId,
            triggerType,
          }
        )
        return {
          used: 0,
          limit: 0,
          remaining: 0,
          resetAt: new Date(Date.now() + RATE_LIMIT_WINDOW_MS),
        }
      }

      const effectiveTier = subscription.tier
      const rateLimits = getTierRateLimits(effectiveTier)
      const rateLimitKey = this.getRateLimitKey(userId, subscription, billingScope)

      const counterType = this.getCounterType(triggerType, isAsync)
      const execLimit = this.getRateLimitForCounter(rateLimits, counterType)

      const now = new Date()
      const windowStart = new Date(now.getTime() - RATE_LIMIT_WINDOW_MS)

      const [rateLimitRecord] = await db
        .select()
        .from(userRateLimits)
        .where(eq(userRateLimits.referenceId, rateLimitKey))
        .limit(1)

      if (!rateLimitRecord || new Date(rateLimitRecord.windowStart) < windowStart) {
        return {
          used: 0,
          limit: execLimit,
          remaining: execLimit,
          resetAt: new Date(now.getTime() + RATE_LIMIT_WINDOW_MS),
        }
      }

      const used = this.getCountFromRecord(rateLimitRecord, counterType)
      return {
        used,
        limit: execLimit,
        remaining: Math.max(0, execLimit - used),
        resetAt: new Date(new Date(rateLimitRecord.windowStart).getTime() + RATE_LIMIT_WINDOW_MS),
      }
    } catch (error) {
      logger.error('Error getting rate limit status:', error)
      return {
        used: 0,
        limit: 0,
        remaining: 0,
        resetAt: new Date(Date.now() + RATE_LIMIT_WINDOW_MS),
      }
    }
  }

  async getRateLimitStatus(
    userId: string,
    triggerType: TriggerType = 'manual',
    isAsync = false
  ): Promise<{
    used: number
    limit: number
    remaining: number
    resetAt: Date
  }> {
    const subscription = await getEffectiveSubscription(userId)
    return this.getRateLimitStatusWithSubscription(userId, subscription, triggerType, isAsync)
  }

  /**
   * Reset rate limit for a user or organization
   */
  async resetRateLimit(rateLimitKey: string): Promise<void> {
    try {
      await db.delete(userRateLimits).where(eq(userRateLimits.referenceId, rateLimitKey))
      logger.info(`Reset rate limit for ${rateLimitKey}`)
    } catch (error) {
      logger.error('Error resetting rate limit:', error)
      throw error
    }
  }
}
