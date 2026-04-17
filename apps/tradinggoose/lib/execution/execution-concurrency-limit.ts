import { AuthType } from '@/lib/auth/hybrid'
import { isBillingEnabledForRuntime } from '@/lib/billing/settings'
import {
  getBillingContextResolutionMessage,
  resolveWorkflowBillingContext,
  resolveWorkspaceBillingContext,
  toRateLimitBillingScope,
} from '@/lib/billing/workspace-billing'
import { env } from '@/lib/env'
import { getRedisClient } from '@/lib/redis'
import type { TriggerType } from '@/services/queue'

const CONCURRENCY_KEY_PREFIX = 'execution_concurrency:scope'
const CONCURRENCY_TTL_MS = 10 * 60 * 1000

type ExecutionLogger = {
  warn: (message: string, meta?: Record<string, unknown>) => void
}

type ExecutionBillingContext = Awaited<ReturnType<typeof resolveWorkspaceBillingContext>>

type ExecutionConcurrencyLimitError = Error & {
  code: 'EXECUTION_CONCURRENCY_LIMIT'
  statusCode: 429
  details: {
    activeExecutions: number
    maxConcurrentExecutions: number
  }
}

type ExecutionConcurrencyBackendUnavailableError = Error & {
  code: 'EXECUTION_CONCURRENCY_BACKEND_UNAVAILABLE'
  statusCode: 503
}

export class ExecutionGateError extends Error {
  statusCode: number

  constructor(message: string, statusCode = 402) {
    super(message)
    this.name = 'ExecutionGateError'
    this.statusCode = statusCode
  }
}

type Lease = { release: () => Promise<void> }

const activeExecutionsByScope = new Map<string, number>()

const REDIS_ACQUIRE_SCRIPT = `
local limit = tonumber(ARGV[1])
local ttlMs = tonumber(ARGV[2])
local current = tonumber(redis.call('GET', KEYS[1]) or '0')
if current >= limit then
  return {0, current}
end
current = redis.call('INCR', KEYS[1])
redis.call('PEXPIRE', KEYS[1], ttlMs)
return {1, current}
`

const REDIS_RELEASE_SCRIPT = `
local ttlMs = tonumber(ARGV[1])
local current = tonumber(redis.call('GET', KEYS[1]) or '0')
if current <= 1 then
  redis.call('DEL', KEYS[1])
  return 0
end
current = redis.call('DECR', KEYS[1])
redis.call('PEXPIRE', KEYS[1], ttlMs)
return current
`

const redisKey = (scopeId: string) => `${CONCURRENCY_KEY_PREFIX}:${scopeId}`

const buildExecutionConcurrencyLimitError = (
  details: ExecutionConcurrencyLimitError['details']
): ExecutionConcurrencyLimitError =>
  Object.assign(new Error('Execution concurrency limit reached'), {
    name: 'ExecutionConcurrencyLimitError',
    code: 'EXECUTION_CONCURRENCY_LIMIT' as const,
    statusCode: 429 as const,
    details,
  })

const buildExecutionConcurrencyBackendUnavailableError =
  (): ExecutionConcurrencyBackendUnavailableError =>
    Object.assign(new Error('Execution limiter backend unavailable. Please retry shortly.'), {
      name: 'ExecutionConcurrencyBackendUnavailableError',
      code: 'EXECUTION_CONCURRENCY_BACKEND_UNAVAILABLE' as const,
      statusCode: 503 as const,
    })

const acquireExecutionLease = async ({
  scopeId,
  maxConcurrentExecutions,
}: {
  scopeId: string
  maxConcurrentExecutions: number
}): Promise<Lease> => {
  const redisConfigured = Boolean(env.REDIS_URL)
  const redis = getRedisClient()

  if (redisConfigured && !redis) {
    throw buildExecutionConcurrencyBackendUnavailableError()
  }

  if (redis) {
    let rawResult: unknown

    try {
      rawResult = (await redis.eval(
        REDIS_ACQUIRE_SCRIPT,
        1,
        redisKey(scopeId),
        maxConcurrentExecutions.toString(),
        CONCURRENCY_TTL_MS.toString()
      )) as unknown
    } catch {
      throw buildExecutionConcurrencyBackendUnavailableError()
    }

    if (!Array.isArray(rawResult)) {
      throw buildExecutionConcurrencyBackendUnavailableError()
    }

    const acquired = Number(rawResult[0] ?? 0)
    const activeExecutions = Number(rawResult[1] ?? maxConcurrentExecutions)

    if (!Number.isFinite(acquired) || !Number.isFinite(activeExecutions)) {
      throw buildExecutionConcurrencyBackendUnavailableError()
    }

    if (acquired !== 1) {
      throw buildExecutionConcurrencyLimitError({
        activeExecutions,
        maxConcurrentExecutions,
      })
    }

    return {
      release: async () => {
        try {
          await redis.eval(
            REDIS_RELEASE_SCRIPT,
            1,
            redisKey(scopeId),
            CONCURRENCY_TTL_MS.toString()
          )
        } catch {}
      },
    }
  }

  const activeExecutions = activeExecutionsByScope.get(scopeId) ?? 0

  if (activeExecutions >= maxConcurrentExecutions) {
    throw buildExecutionConcurrencyLimitError({
      activeExecutions,
      maxConcurrentExecutions,
    })
  }

  activeExecutionsByScope.set(scopeId, activeExecutions + 1)

  return {
    release: async () => {
      const nextActiveExecutions = (activeExecutionsByScope.get(scopeId) ?? 1) - 1
      if (nextActiveExecutions <= 0) {
        activeExecutionsByScope.delete(scopeId)
      } else {
        activeExecutionsByScope.set(scopeId, nextActiveExecutions)
      }
    },
  }
}

export async function resolveServerExecutionBillingContext(params: {
  actorUserId: string
  workflowId?: string | null
  workspaceId?: string | null
  logger?: ExecutionLogger
  requestId?: string
  source?: string
}): Promise<ExecutionBillingContext | null> {
  if (!(await isBillingEnabledForRuntime())) {
    return null
  }

  try {
    return params.workflowId
      ? await resolveWorkflowBillingContext({
          workflowId: params.workflowId,
          actorUserId: params.actorUserId,
        })
      : await resolveWorkspaceBillingContext({
          workspaceId: params.workspaceId,
          actorUserId: params.actorUserId,
        })
  } catch (error) {
    params.logger?.warn(
      `[${params.requestId ?? 'execution'}] Failed to resolve ${params.source ?? 'execution'} billing context`,
      {
        actorUserId: params.actorUserId,
        workflowId: params.workflowId,
        workspaceId: params.workspaceId,
        error,
      }
    )
    throw new ExecutionGateError(getBillingContextResolutionMessage(error))
  }
}

export async function enforceServerExecutionRateLimit(params: {
  actorUserId: string
  authType?: string
  workflowId?: string | null
  workspaceId?: string | null
  isAsync: boolean
  logger: ExecutionLogger
  requestId: string
  source: string
  triggerType?: TriggerType
}) {
  const triggerType =
    params.triggerType ?? (params.authType === AuthType.API_KEY ? 'api' : 'manual')
  if (triggerType === 'manual') {
    return
  }

  const billingContext = await resolveServerExecutionBillingContext(params)
  if (!billingContext) {
    return
  }

  const { ExecutionLimiter, RateLimitError } = await import('@/services/queue')
  const rateLimiter = new ExecutionLimiter()
  const rateLimitCheck = await rateLimiter.checkRateLimitWithSubscription(
    billingContext.billingUserId,
    billingContext.subscription,
    triggerType,
    params.isAsync,
    toRateLimitBillingScope(billingContext, params.actorUserId)
  )

  if (!rateLimitCheck.allowed) {
    throw new RateLimitError(
      `Rate limit exceeded. You have ${rateLimitCheck.remaining} requests remaining. Resets at ${rateLimitCheck.resetAt.toISOString()}`
    )
  }

  return rateLimitCheck
}

export const isExecutionConcurrencyLimitError = (
  error: unknown
): error is ExecutionConcurrencyLimitError =>
  Boolean(
    error &&
      typeof error === 'object' &&
      (error as { code?: string }).code === 'EXECUTION_CONCURRENCY_LIMIT'
  )

export const getExecutionConcurrencyLimitMessage = (
  error: ExecutionConcurrencyLimitError
) =>
  `Too many concurrent executions for your billing tier. Active: ${error.details.activeExecutions}, limit: ${error.details.maxConcurrentExecutions}.`

export const isExecutionConcurrencyBackendUnavailableError = (
  error: unknown
): error is ExecutionConcurrencyBackendUnavailableError =>
  Boolean(
    error &&
      typeof error === 'object' &&
      (error as { code?: string }).code === 'EXECUTION_CONCURRENCY_BACKEND_UNAVAILABLE'
  )

export const withExecutionConcurrencyLimit = async <T>({
  concurrencyLeaseInherited,
  userId,
  workspaceId,
  workflowId,
  task,
}: {
  concurrencyLeaseInherited?: boolean
  userId?: string
  workspaceId?: string | null
  workflowId?: string | null
  task: () => Promise<T>
}): Promise<T> => {
  if (concurrencyLeaseInherited) {
    return task()
  }

  if (!userId) {
    return task()
  }

  const billingContext = await resolveServerExecutionBillingContext({
    actorUserId: userId,
    workflowId,
    workspaceId,
  })

  if (!billingContext) {
    return task()
  }

  const maxConcurrentExecutions = billingContext.tier.concurrencyLimit

  if (maxConcurrentExecutions === null || maxConcurrentExecutions < 0) {
    throw new Error(`Billing tier ${billingContext.tier.displayName} is missing concurrencyLimit`)
  }

  const lease = await acquireExecutionLease({
    scopeId: billingContext.scopeId,
    maxConcurrentExecutions,
  })

  try {
    return await task()
  } finally {
    await lease.release()
  }
}
