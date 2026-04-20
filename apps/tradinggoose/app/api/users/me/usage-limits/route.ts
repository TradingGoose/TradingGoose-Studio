import { type NextRequest, NextResponse } from 'next/server'
import { checkHybridAuth } from '@/lib/auth/hybrid'
import { getPersonalBillingSnapshot } from '@/lib/billing/core/subscription'
import { getUserStorageLimit, getUserStorageUsage } from '@/lib/billing/storage'
import { createLogger } from '@/lib/logs/console/logger'
import { createErrorResponse } from '@/app/api/workflows/utils'
import { ExecutionLimiter } from '@/services/queue'

const logger = createLogger('UsageLimitsAPI')

export async function GET(request: NextRequest) {
  try {
    const auth = await checkHybridAuth(request, { requireWorkflowId: false })
    if (!auth.success || !auth.userId) {
      return createErrorResponse('Authentication required', 401)
    }
    const authenticatedUserId = auth.userId

    // Rate limit info (sync + async), mirroring /users/me/rate-limit
    const billingSnapshot = await getPersonalBillingSnapshot(authenticatedUserId)
    const rateLimiter = new ExecutionLimiter()
    const triggerType = auth.authType === 'api_key' ? 'api' : 'manual'
    const [syncStatus, asyncStatus] = await Promise.all([
      rateLimiter.getRateLimitStatusWithSubscription(
        authenticatedUserId,
        billingSnapshot.subscription,
        triggerType,
        false
      ),
      rateLimiter.getRateLimitStatusWithSubscription(
        authenticatedUserId,
        billingSnapshot.subscription,
        triggerType,
        true
      ),
    ])

    // Usage summary (current period cost + limit + plan)
    const [storageUsage, storageLimit] = await Promise.all([
      getUserStorageUsage(authenticatedUserId),
      getUserStorageLimit(authenticatedUserId),
    ])

    return NextResponse.json({
      success: true,
      rateLimit: {
        sync: {
          isLimited: syncStatus.remaining === 0,
          limit: syncStatus.limit,
          remaining: syncStatus.remaining,
          resetAt: syncStatus.resetAt,
        },
        async: {
          isLimited: asyncStatus.remaining === 0,
          limit: asyncStatus.limit,
          remaining: asyncStatus.remaining,
          resetAt: asyncStatus.resetAt,
        },
        authType: triggerType,
      },
      usage: {
        currentPeriodCost: billingSnapshot.currentPeriodCost,
        limit: billingSnapshot.limit,
        tier: billingSnapshot.tier,
      },
      storage: {
        usedBytes: storageUsage,
        limitBytes: storageLimit,
        percentUsed: storageLimit > 0 ? (storageUsage / storageLimit) * 100 : 0,
      },
    })
  } catch (error: any) {
    logger.error('Error checking usage limits:', error)
    return createErrorResponse(error.message || 'Failed to check usage limits', 500)
  }
}
