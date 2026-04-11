import { getPersonalBillingSnapshot } from '@/lib/billing/core/subscription'
import type { BillingTierSummary } from '@/lib/billing/types'
import { RateLimiter } from '@/services/queue'

export interface UserLimits {
  workflowExecutionRateLimit: {
    sync: {
      limit: number
      remaining: number
      resetAt: string
    }
    async: {
      limit: number
      remaining: number
      resetAt: string
    }
  }
  usage: {
    currentPeriodCost: number
    limit: number
    tier: BillingTierSummary
    isExceeded: boolean
  }
}

export async function getUserLimits(userId: string): Promise<UserLimits> {
  const [billingSnapshot, rateLimiter] = await Promise.all([
    getPersonalBillingSnapshot(userId),
    Promise.resolve(new RateLimiter()),
  ])

  const [syncStatus, asyncStatus] = await Promise.all([
    rateLimiter.getRateLimitStatusWithSubscription(
      userId,
      billingSnapshot.subscription,
      'api',
      false
    ),
    rateLimiter.getRateLimitStatusWithSubscription(
      userId,
      billingSnapshot.subscription,
      'api',
      true
    ),
  ])

  return {
    workflowExecutionRateLimit: {
      sync: {
        limit: syncStatus.limit,
        remaining: syncStatus.remaining,
        resetAt: syncStatus.resetAt.toISOString(),
      },
      async: {
        limit: asyncStatus.limit,
        remaining: asyncStatus.remaining,
        resetAt: asyncStatus.resetAt.toISOString(),
      },
    },
    usage: {
      currentPeriodCost: billingSnapshot.currentPeriodCost,
      limit: billingSnapshot.limit,
      tier: billingSnapshot.tier,
      isExceeded: billingSnapshot.isExceeded,
    },
  }
}

export function createApiResponse<T>(
  data: T,
  limits: UserLimits,
  apiRateLimit: { limit: number; remaining: number; resetAt: Date }
) {
  return {
    body: {
      ...data,
      limits,
    },
    headers: {
      'X-RateLimit-Limit': apiRateLimit.limit.toString(),
      'X-RateLimit-Remaining': apiRateLimit.remaining.toString(),
      'X-RateLimit-Reset': apiRateLimit.resetAt.toISOString(),
    },
  }
}
