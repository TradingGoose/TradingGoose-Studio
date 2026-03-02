import { getHighestPrioritySubscription } from '@/lib/billing/core/subscription'
import { env } from '@/lib/env'
import { getRedisClient } from '@/lib/redis'

const CODE_EXECUTION_CONCURRENT_LIMITS = {
  free: 1,
  pro: 2,
  team: 4,
  enterprise: 8,
} as const
const CONCURRENCY_KEY_PREFIX = 'code_execution_concurrency:user'
const CONCURRENCY_TTL_MS = 10 * 60 * 1000

type CodeExecutionTier = keyof typeof CODE_EXECUTION_CONCURRENT_LIMITS
type ConcurrencyLimitError = Error & {
  code: 'CODE_EXECUTION_CONCURRENCY_LIMIT'
  statusCode: 429
  details: {
    userId: string
    tier: CodeExecutionTier
    activeExecutions: number
    maxConcurrentExecutions: number
  }
}

const activeExecutionsByUser = new Map<string, number>()
type Lease = {
  activeExecutions: number
  release?: () => Promise<void>
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

const redisKey = (userId: string) => `${CONCURRENCY_KEY_PREFIX}:${userId}`

const acquireExecutionLease = async ({
  userId,
  maxConcurrentExecutions,
}: {
  userId: string
  maxConcurrentExecutions: number
}): Promise<Lease> => {
  const redisConfigured = Boolean(env.REDIS_URL)
  const redis = getRedisClient()
  if (redisConfigured && !redis) return { activeExecutions: maxConcurrentExecutions }

  if (redis) {
    try {
      const rawResult = (await redis.eval(
        REDIS_ACQUIRE_SCRIPT,
        1,
        redisKey(userId),
        maxConcurrentExecutions.toString(),
        CONCURRENCY_TTL_MS.toString()
      )) as unknown
      const acquired = Array.isArray(rawResult) ? Number(rawResult[0] ?? 0) : 0
      const activeExecutions = Array.isArray(rawResult)
        ? Number(rawResult[1] ?? maxConcurrentExecutions)
        : maxConcurrentExecutions
      if (acquired !== 1) return { activeExecutions }

      return {
        activeExecutions,
        release: async () => {
          try {
            await redis.eval(
              REDIS_RELEASE_SCRIPT,
              1,
              redisKey(userId),
              CONCURRENCY_TTL_MS.toString()
            )
          } catch {}
        },
      }
    } catch {
      if (redisConfigured) return { activeExecutions: maxConcurrentExecutions }
    }
  }

  const activeExecutions = activeExecutionsByUser.get(userId) ?? 0
  if (activeExecutions >= maxConcurrentExecutions) return { activeExecutions }
  activeExecutionsByUser.set(userId, activeExecutions + 1)
  return {
    activeExecutions: activeExecutions + 1,
    release: async () => {
      const nextActiveExecutions = (activeExecutionsByUser.get(userId) ?? 1) - 1
      if (nextActiveExecutions <= 0) {
        activeExecutionsByUser.delete(userId)
      } else {
        activeExecutionsByUser.set(userId, nextActiveExecutions)
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

export const getCodeExecutionConcurrencyLimitMessage = (
  error: ConcurrencyLimitError
) =>
  `Too many concurrent code executions for your plan. Active: ${error.details.activeExecutions}, limit: ${error.details.maxConcurrentExecutions}.`

const resolveTier = (plan?: string | null): CodeExecutionTier => {
  if (plan === 'enterprise' || plan === 'team' || plan === 'pro' || plan === 'free') return plan
  return 'free'
}

const buildConcurrencyLimitError = (details: ConcurrencyLimitError['details']): ConcurrencyLimitError =>
  Object.assign(new Error('Code execution concurrency limit reached'), {
    name: 'CodeExecutionConcurrencyLimitError',
    code: 'CODE_EXECUTION_CONCURRENCY_LIMIT' as const,
    statusCode: 429 as const,
    details,
  })

export const withCodeExecutionConcurrencyLimit = async <T>({
  userId,
  task,
}: {
  userId?: string
  task: () => Promise<T>
}): Promise<T> => {
  if (!userId) {
    return task()
  }

  const subscription = await getHighestPrioritySubscription(userId)
  const tier = resolveTier(subscription?.plan)
  const maxConcurrentExecutions = CODE_EXECUTION_CONCURRENT_LIMITS[tier]
  const leaseResult = await acquireExecutionLease({
    userId,
    maxConcurrentExecutions,
  })

  if (!leaseResult.release) {
    throw buildConcurrencyLimitError({
      userId,
      tier,
      activeExecutions: leaseResult.activeExecutions,
      maxConcurrentExecutions,
    })
  }

  try {
    return await task()
  } finally {
    await leaseResult.release?.()
  }
}
