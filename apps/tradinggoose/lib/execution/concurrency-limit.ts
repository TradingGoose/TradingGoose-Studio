import {
  resolveWorkflowBillingContext,
  resolveWorkspaceBillingContext,
} from '@/lib/billing/workspace-billing'
import { env } from '@/lib/env'
import { getRedisClient } from '@/lib/redis'

const CONCURRENCY_KEY_PREFIX = 'code_execution_concurrency:scope'
const CONCURRENCY_TTL_MS = 10 * 60 * 1000

type ConcurrencyLimitError = Error & {
  code: 'CODE_EXECUTION_CONCURRENCY_LIMIT'
  statusCode: 429
  details: {
    userId: string
    scopeId: string
    tier: string
    activeExecutions: number
    maxConcurrentExecutions: number
  }
}

type ConcurrencyBackendUnavailableError = Error & {
  code: 'CODE_EXECUTION_CONCURRENCY_BACKEND_UNAVAILABLE'
  statusCode: 503
}

const activeExecutionsByScope = new Map<string, number>()
type Lease = {
  activeExecutions: number
  release: () => Promise<void>
}

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

const acquireExecutionLease = async ({
  userId,
  scopeId,
  tier,
  maxConcurrentExecutions,
}: {
  userId: string
  scopeId: string
  tier: string
  maxConcurrentExecutions: number
}): Promise<Lease> => {
  const redisConfigured = Boolean(env.REDIS_URL)
  const redis = getRedisClient()
  if (redisConfigured && !redis) {
    throw buildConcurrencyBackendUnavailableError()
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
      throw buildConcurrencyBackendUnavailableError()
    }

    if (!Array.isArray(rawResult)) {
      throw buildConcurrencyBackendUnavailableError()
    }

    const acquired = Number(rawResult[0] ?? 0)
    const activeExecutions = Number(rawResult[1] ?? maxConcurrentExecutions)
    if (!Number.isFinite(acquired) || !Number.isFinite(activeExecutions)) {
      throw buildConcurrencyBackendUnavailableError()
    }
    if (acquired !== 1) {
      throw buildConcurrencyLimitError({
        userId,
        scopeId,
        tier,
        activeExecutions,
        maxConcurrentExecutions,
      })
    }

    return {
      activeExecutions,
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
    throw buildConcurrencyLimitError({
      userId,
      scopeId,
      tier,
      activeExecutions,
      maxConcurrentExecutions,
    })
  }
  activeExecutionsByScope.set(scopeId, activeExecutions + 1)
  return {
    activeExecutions: activeExecutions + 1,
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

export const isCodeExecutionConcurrencyLimitError = (
  error: unknown
): error is ConcurrencyLimitError =>
  Boolean(
    error &&
      typeof error === 'object' &&
      (error as { code?: string }).code === 'CODE_EXECUTION_CONCURRENCY_LIMIT'
  )

export const getCodeExecutionConcurrencyLimitMessage = (error: ConcurrencyLimitError) =>
  `Too many concurrent code executions for your billing tier. Active: ${error.details.activeExecutions}, limit: ${error.details.maxConcurrentExecutions}.`

export const isCodeExecutionConcurrencyBackendUnavailableError = (
  error: unknown
): error is ConcurrencyBackendUnavailableError =>
  Boolean(
    error &&
      typeof error === 'object' &&
      (error as { code?: string }).code === 'CODE_EXECUTION_CONCURRENCY_BACKEND_UNAVAILABLE'
  )

const buildConcurrencyLimitError = (
  details: ConcurrencyLimitError['details']
): ConcurrencyLimitError =>
  Object.assign(new Error('Code execution concurrency limit reached'), {
    name: 'CodeExecutionConcurrencyLimitError',
    code: 'CODE_EXECUTION_CONCURRENCY_LIMIT' as const,
    statusCode: 429 as const,
    details,
  })

const buildConcurrencyBackendUnavailableError = (): ConcurrencyBackendUnavailableError =>
  Object.assign(new Error('Code execution backend unavailable'), {
    name: 'CodeExecutionConcurrencyBackendUnavailableError',
    code: 'CODE_EXECUTION_CONCURRENCY_BACKEND_UNAVAILABLE' as const,
    statusCode: 503 as const,
  })

export const withCodeExecutionConcurrencyLimit = async <T>({
  userId,
  workspaceId,
  workflowId,
  task,
}: {
  userId?: string
  workspaceId?: string | null
  workflowId?: string | null
  task: () => Promise<T>
}): Promise<T> => {
  if (!userId) {
    return task()
  }

  const billingContext = workflowId
    ? await resolveWorkflowBillingContext({
        workflowId,
        actorUserId: userId,
      })
    : await resolveWorkspaceBillingContext({
        workspaceId,
        actorUserId: userId,
      })
  const tier = billingContext.tier.displayName
  const maxConcurrentExecutions = billingContext.tier.concurrencyLimit

  if (maxConcurrentExecutions === null || maxConcurrentExecutions < 0) {
    throw new Error(`Billing tier ${tier} is missing concurrencyLimit`)
  }

  const leaseResult = await acquireExecutionLease({
    userId,
    scopeId: billingContext.scopeId,
    tier,
    maxConcurrentExecutions,
  })

  try {
    return await task()
  } finally {
    await leaseResult.release()
  }
}
