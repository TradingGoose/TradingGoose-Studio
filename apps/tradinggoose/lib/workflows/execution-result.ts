import type { ExecutionResult } from '@/executor/types'

const PUBLIC_EXECUTION_METADATA_KEYS = ['duration', 'startTime', 'endTime'] as const

type ExecutionResultWithTraceSpans = ExecutionResult & {
  traceSpans?: unknown
}

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
  const metadata = result.metadata
    ? Object.fromEntries(
        PUBLIC_EXECUTION_METADATA_KEYS.flatMap((key) =>
          result.metadata?.[key] === undefined ? [] : [[key, result.metadata[key]]]
        )
      )
    : undefined

  return {
    success: result.success,
    output: result.output,
    ...(result.error ? { error: result.error } : {}),
    ...(metadata && Object.keys(metadata).length > 0 ? { metadata } : {}),
  }
}

export function createInternalWorkflowJobResult(result: ExecutionResultWithTraceSpans) {
  return {
    ...createPublicExecutionResult(result),
    ...(Array.isArray(result.traceSpans) ? { traceSpans: result.traceSpans } : {}),
  }
}
