import { getPersonalEffectiveSubscription } from '@/lib/billing/core/subscription'
import { isBillingEnabledForRuntime } from '@/lib/billing/settings'
import { createLogger } from '@/lib/logs/console/logger'
import { ExecutionLimiter } from '@/services/queue/ExecutionLimiter'

const logger = createLogger('ApiRateLimit')
const rateLimiter = new ExecutionLimiter()

export interface RateLimitResult {
  allowed: boolean
  remaining: number
  resetAt: Date
  limit: number
  userId?: string
  error?: string
  failureKind?: 'auth' | 'dependency'
}

export async function createApiAuthFailureRateLimitResult(error: string): Promise<RateLimitResult> {
  const limit = await isBillingEnabledForRuntime()
    .then((enabled) => (enabled ? 0 : Number.MAX_SAFE_INTEGER))
    .catch(() => 0)
  return {
    allowed: false,
    remaining: 0,
    limit,
    resetAt: new Date(),
    error,
    failureKind: 'auth',
  }
}

export async function checkApiEndpointRateLimit(
  userId: string,
  endpoint = 'api-endpoint'
): Promise<RateLimitResult> {
  try {
    const billingEnabled = await isBillingEnabledForRuntime()
    if (!billingEnabled) {
      return {
        allowed: true,
        remaining: Number.MAX_SAFE_INTEGER,
        limit: Number.MAX_SAFE_INTEGER,
        resetAt: new Date(Date.now() + 60000),
        userId,
      }
    }

    const subscription = await getPersonalEffectiveSubscription(userId)

    const result = await rateLimiter.checkRateLimitWithSubscription(
      userId,
      subscription,
      'api-endpoint',
      false
    )

    if (!result.allowed) {
      logger.warn(`Rate limit exceeded for user ${userId}`, {
        endpoint,
        remaining: result.remaining,
        resetAt: result.resetAt,
      })
    }

    const rateLimitStatus = await rateLimiter.getRateLimitStatusWithSubscription(
      userId,
      subscription,
      'api-endpoint',
      false
    )

    return {
      ...result,
      limit: rateLimitStatus.limit,
      userId,
    }
  } catch (error) {
    logger.error('Rate limit check error; failing closed', { error, endpoint, userId })
    return {
      allowed: false,
      remaining: 0,
      limit: 0,
      resetAt: new Date(Date.now() + 60000),
      error: 'Rate limit service unavailable',
      failureKind: 'dependency',
      userId,
    }
  }
}
