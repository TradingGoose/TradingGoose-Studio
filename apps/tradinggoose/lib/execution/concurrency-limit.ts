import { getHighestPrioritySubscription } from '@/lib/billing/core/subscription'

const CODE_EXECUTION_CONCURRENT_LIMITS = {
  free: 1,
  pro: 2,
  team: 4,
  enterprise: 8,
} as const

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
  const activeExecutions = activeExecutionsByUser.get(userId) ?? 0

  if (activeExecutions >= maxConcurrentExecutions) {
    throw buildConcurrencyLimitError({
      userId,
      tier,
      activeExecutions,
      maxConcurrentExecutions,
    })
  }

  activeExecutionsByUser.set(userId, activeExecutions + 1)
  try {
    return await task()
  } finally {
    const nextActiveExecutions = (activeExecutionsByUser.get(userId) ?? 1) - 1
    if (nextActiveExecutions <= 0) {
      activeExecutionsByUser.delete(userId)
    } else {
      activeExecutionsByUser.set(userId, nextActiveExecutions)
    }
  }
}
