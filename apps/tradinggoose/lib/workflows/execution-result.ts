import type { ExecutionResult } from '@/executor/types'

export function isExecutionResult(value: unknown): value is ExecutionResult {
  return (
    value !== null &&
    typeof value === 'object' &&
    typeof (value as { success?: unknown }).success === 'boolean' &&
    (value as { output?: unknown }).output !== null &&
    typeof (value as { output?: unknown }).output === 'object'
  )
}

export function createPublicExecutionResult(result: ExecutionResult) {
  return {
    ...result,
    logs: undefined,
    metadata: result.metadata
      ? {
          ...result.metadata,
          workflowConnections: undefined,
        }
      : undefined,
  }
}
