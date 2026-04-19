import { type NextRequest, NextResponse } from 'next/server'
import { getPersonalEffectiveSubscription } from '@/lib/billing/core/subscription'
import { isBillingEnabledForRuntime } from '@/lib/billing/settings'
import { createLogger } from '@/lib/logs/console/logger'
import { ExecutionLimiter } from '@/services/queue/ExecutionLimiter'
import { authenticateV1Request } from './auth'

const logger = createLogger('V1Middleware')
const rateLimiter = new ExecutionLimiter()

type RateLimitFailureKind = 'auth' | 'dependency'

async function getDefaultApiEndpointRateLimit(): Promise<number> {
  return (await isBillingEnabledForRuntime()) ? 0 : Number.MAX_SAFE_INTEGER
}

export interface RateLimitResult {
  allowed: boolean
  remaining: number
  resetAt: Date
  limit: number
  userId?: string
  error?: string
  failureKind?: RateLimitFailureKind
}

function createAuthFailureResult(error: string, limit: number): RateLimitResult {
  return {
    allowed: false,
    remaining: 0,
    limit,
    resetAt: new Date(),
    error,
    failureKind: 'auth',
  }
}

function createDependencyFailureResult(error: string): RateLimitResult {
  return {
    allowed: false,
    remaining: 0,
    limit: 0,
    resetAt: new Date(Date.now() + 60000),
    error,
    failureKind: 'dependency',
  }
}

export async function checkRateLimit(
  request: NextRequest,
  endpoint: 'logs' | 'logs-detail' = 'logs'
): Promise<RateLimitResult> {
  let auth

  try {
    auth = await authenticateV1Request(request)
  } catch (error) {
    logger.error('Authentication error during rate limit check', { error })
    const limit = await getDefaultApiEndpointRateLimit().catch(() => 0)
    return createAuthFailureResult('Authentication failed', limit)
  }

  if (!auth.authenticated) {
    const limit = await getDefaultApiEndpointRateLimit()
    return createAuthFailureResult(auth.error || 'Unauthorized', limit)
  }

  const userId = auth.userId!

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
      ...createDependencyFailureResult('Rate limit service unavailable'),
      userId,
    }
  }
}

export function createRateLimitResponse(result: RateLimitResult): NextResponse {
  const headers = {
    'X-RateLimit-Limit': result.limit.toString(),
    'X-RateLimit-Remaining': result.remaining.toString(),
    'X-RateLimit-Reset': result.resetAt.toISOString(),
  }

  if (result.failureKind === 'auth') {
    return NextResponse.json({ error: result.error || 'Unauthorized' }, { status: 401, headers })
  }

  if (result.failureKind === 'dependency') {
    return NextResponse.json(
      { error: result.error || 'Rate limit service unavailable' },
      {
        status: 503,
        headers: {
          ...headers,
          'Retry-After': Math.max(
            0,
            Math.ceil((result.resetAt.getTime() - Date.now()) / 1000)
          ).toString(),
        },
      }
    )
  }

  if (!result.allowed) {
    return NextResponse.json(
      {
        error: 'Rate limit exceeded',
        message: `API rate limit exceeded. Please retry after ${result.resetAt.toISOString()}`,
        retryAfter: result.resetAt.getTime(),
      },
      {
        status: 429,
        headers: {
          ...headers,
          'Retry-After': Math.max(
            0,
            Math.ceil((result.resetAt.getTime() - Date.now()) / 1000)
          ).toString(),
        },
      }
    )
  }

  return NextResponse.json({ error: 'Bad request' }, { status: 400, headers })
}
