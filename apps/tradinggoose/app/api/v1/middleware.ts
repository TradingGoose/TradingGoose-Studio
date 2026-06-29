import { type NextRequest, NextResponse } from 'next/server'
import {
  checkApiEndpointRateLimit,
  createApiAuthFailureRateLimitResult,
  type RateLimitResult,
} from '@/lib/api/rate-limit'
import { createLogger } from '@/lib/logs/console/logger'
import { authenticateV1Request } from './auth'

const logger = createLogger('V1Middleware')

export type { RateLimitResult } from '@/lib/api/rate-limit'

export async function checkRateLimit(
  request: NextRequest,
  endpoint: 'logs' | 'logs-detail' = 'logs'
): Promise<RateLimitResult> {
  let auth

  try {
    auth = await authenticateV1Request(request)
  } catch (error) {
    logger.error('Authentication error during rate limit check', { error })
    return createApiAuthFailureRateLimitResult('Authentication failed')
  }

  if (!auth.authenticated) {
    return createApiAuthFailureRateLimitResult(auth.error || 'Unauthorized')
  }

  const userId = auth.userId!

  return checkApiEndpointRateLimit(userId, endpoint)
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
