import { createHash } from 'node:crypto'
import { getPersonalEffectiveSubscription } from '@/lib/billing/core/subscription'
import { isBillingEnabledForRuntime } from '@/lib/billing/settings'
import type { BillingTierRecord } from '@/lib/billing/tiers'
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

export type ApiRateLimitEndpoint =
  | 'api-endpoint'
  | 'copilot-mcp'
  | 'logs'
  | 'logs-detail'
  | 'mcp-auth-start'
  | 'mcp-auth-poll'

const PUBLIC_API_ENDPOINT_LIMITS: Partial<Record<ApiRateLimitEndpoint, number>> = {
  'mcp-auth-start': 20,
  'mcp-auth-poll': 120,
}

function getApiEndpointRateLimitScope(userId: string, endpoint: ApiRateLimitEndpoint) {
  return endpoint === 'api-endpoint'
    ? undefined
    : {
        scopeType: 'user' as const,
        scopeId: `${userId}:${endpoint}`,
        organizationId: null,
        userId,
      }
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
  endpoint: ApiRateLimitEndpoint = 'api-endpoint'
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
    const billingScope = getApiEndpointRateLimitScope(userId, endpoint)

    const result = await rateLimiter.checkRateLimitWithSubscription(
      userId,
      subscription,
      'api-endpoint',
      false,
      billingScope
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
      false,
      billingScope
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

function getRequesterKey(request: Request): string {
  const forwardedFor = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
  const requester =
    request.headers.get('cf-connecting-ip')?.trim() ||
    request.headers.get('x-real-ip')?.trim() ||
    forwardedFor ||
    'unknown'
  const userAgent = request.headers.get('user-agent')?.trim() || 'unknown'
  const host = request.headers.get('host')?.trim() || new URL(request.url).host
  return createHash('sha256').update(`${host}\n${requester}\n${userAgent}`).digest('hex')
}

export async function checkPublicApiEndpointRateLimit(
  request: Request,
  endpoint: Extract<ApiRateLimitEndpoint, 'mcp-auth-start' | 'mcp-auth-poll'>
): Promise<RateLimitResult> {
  const limit = PUBLIC_API_ENDPOINT_LIMITS[endpoint] ?? 0
  const scopeId = `public:${endpoint}:${getRequesterKey(request)}`

  const result = await rateLimiter.checkRateLimitWithSubscription(
    scopeId,
    {
      referenceType: 'user',
      referenceId: scopeId,
      tier: {
        displayName: endpoint,
        syncRateLimitPerMinute: 0,
        asyncRateLimitPerMinute: 0,
        apiEndpointRateLimitPerMinute: limit,
      } as BillingTierRecord,
    },
    'api-endpoint',
    false,
    {
      scopeType: 'user',
      scopeId,
      organizationId: null,
      userId: null,
    },
    { enforceWithoutBilling: true }
  )

  return {
    ...result,
    limit,
    userId: scopeId,
  }
}
