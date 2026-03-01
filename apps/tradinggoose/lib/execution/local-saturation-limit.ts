import { env } from '@/lib/env'

const DEFAULT_LOCAL_VM_MAX_CONCURRENT_EXECUTIONS = 200

const coercePositiveInt = (value: string | undefined): number | undefined => {
  if (!value) return undefined
  const parsed = Number.parseInt(value, 10)
  if (!Number.isFinite(parsed) || parsed <= 0) return undefined
  return parsed
}

const MAX_LOCAL_VM_CONCURRENT_EXECUTIONS =
  coercePositiveInt(env.LOCAL_VM_MAX_CONCURRENT_EXECUTIONS) ??
  DEFAULT_LOCAL_VM_MAX_CONCURRENT_EXECUTIONS
const MAX_LOCAL_VM_ACTIVE_PER_OWNER = coercePositiveInt(env.LOCAL_VM_MAX_ACTIVE_PER_OWNER)

type LocalVmSaturationLimitErrorDetails = {
  ownerKey?: string
  activeExecutions: number
  maxConcurrentExecutions: number
  activeExecutionsForOwner?: number
  maxConcurrentExecutionsPerOwner?: number
}

export type LocalVmSaturationLimitError = Error & {
  code: 'LOCAL_VM_SATURATION_LIMIT'
  statusCode: 503
  details: LocalVmSaturationLimitErrorDetails
}

let activeExecutions = 0
const activeExecutionsByOwner = new Map<string, number>()

const buildLimitError = (
  message: string,
  details: LocalVmSaturationLimitErrorDetails
): LocalVmSaturationLimitError =>
  Object.assign(new Error(message), {
    name: 'LocalVmSaturationLimitError',
    code: 'LOCAL_VM_SATURATION_LIMIT' as const,
    statusCode: 503 as const,
    details,
  })

export const isLocalVmSaturationLimitError = (
  error: unknown
): error is LocalVmSaturationLimitError =>
  Boolean(
    error &&
      typeof error === 'object' &&
      (error as { code?: string }).code === 'LOCAL_VM_SATURATION_LIMIT'
  )

export const getLocalVmSaturationLimitMessage = (error: LocalVmSaturationLimitError) => {
  const ownerFragment =
    typeof error.details.activeExecutionsForOwner === 'number' &&
    typeof error.details.maxConcurrentExecutionsPerOwner === 'number'
      ? ` Owner active: ${error.details.activeExecutionsForOwner}, owner limit: ${error.details.maxConcurrentExecutionsPerOwner}.`
      : ''
  return `Local execution engine is at capacity. Active: ${error.details.activeExecutions}, limit: ${error.details.maxConcurrentExecutions}.${ownerFragment}`
}

const releaseOwnerExecution = (ownerKey: string) => {
  const next = (activeExecutionsByOwner.get(ownerKey) ?? 1) - 1
  if (next <= 0) {
    activeExecutionsByOwner.delete(ownerKey)
    return
  }
  activeExecutionsByOwner.set(ownerKey, next)
}

export const withLocalVmSaturationLimit = async <T>({
  ownerKey,
  task,
}: {
  ownerKey?: string
  task: () => Promise<T>
}): Promise<T> => {
  if (activeExecutions >= MAX_LOCAL_VM_CONCURRENT_EXECUTIONS) {
    throw buildLimitError('Local execution engine is at capacity', {
      ownerKey,
      activeExecutions,
      maxConcurrentExecutions: MAX_LOCAL_VM_CONCURRENT_EXECUTIONS,
      ...(ownerKey
        ? {
            activeExecutionsForOwner: activeExecutionsByOwner.get(ownerKey) ?? 0,
            maxConcurrentExecutionsPerOwner: MAX_LOCAL_VM_ACTIVE_PER_OWNER,
          }
        : null),
    })
  }

  if (ownerKey && MAX_LOCAL_VM_ACTIVE_PER_OWNER) {
    const ownerActiveExecutions = activeExecutionsByOwner.get(ownerKey) ?? 0
    if (ownerActiveExecutions >= MAX_LOCAL_VM_ACTIVE_PER_OWNER) {
      throw buildLimitError('Local execution engine per-owner capacity reached', {
        ownerKey,
        activeExecutions,
        maxConcurrentExecutions: MAX_LOCAL_VM_CONCURRENT_EXECUTIONS,
        activeExecutionsForOwner: ownerActiveExecutions,
        maxConcurrentExecutionsPerOwner: MAX_LOCAL_VM_ACTIVE_PER_OWNER,
      })
    }
  }

  activeExecutions += 1
  if (ownerKey) {
    activeExecutionsByOwner.set(ownerKey, (activeExecutionsByOwner.get(ownerKey) ?? 0) + 1)
  }

  try {
    return await task()
  } finally {
    activeExecutions = Math.max(0, activeExecutions - 1)
    if (ownerKey) {
      releaseOwnerExecution(ownerKey)
    }
  }
}
