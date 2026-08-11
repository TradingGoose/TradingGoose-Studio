import type { BlockLog, ExecutionResult } from '@/executor/types'
import { WORKFLOW_EXECUTION_TIME_LIMIT_EXCEEDED } from './workflow-execution-time-policy'

export type WorkflowExecutionResultDiagnostics = Pick<
  Required<ExecutionResult>,
  'error' | 'code' | 'deadline'
> & {
  logs: Array<
    Pick<
      BlockLog,
      | 'blockId'
      | 'blockName'
      | 'blockType'
      | 'startedAt'
      | 'endedAt'
      | 'durationMs'
      | 'success'
      | 'error'
      | 'code'
    >
  >
}

export function createWorkflowExecutionResultDiagnostics(
  result: ExecutionResult
): WorkflowExecutionResultDiagnostics | undefined {
  if (
    result.success ||
    result.code !== WORKFLOW_EXECUTION_TIME_LIMIT_EXCEEDED ||
    !result.error ||
    !result.deadline
  ) {
    return undefined
  }

  return {
    error: result.error,
    code: result.code,
    deadline: result.deadline,
    logs: (result.logs ?? []).map((log) => ({
      blockId: log.blockId,
      ...(log.blockName !== undefined ? { blockName: log.blockName } : {}),
      ...(log.blockType !== undefined ? { blockType: log.blockType } : {}),
      startedAt: log.startedAt,
      endedAt: log.endedAt,
      durationMs: log.durationMs,
      success: log.success,
      ...(log.error !== undefined ? { error: log.error } : {}),
      ...(log.code !== undefined ? { code: log.code } : {}),
    })),
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value && typeof value === 'object' && !Array.isArray(value))

const readDeadline = (value: unknown): ExecutionResult['deadline'] | undefined => {
  if (!isRecord(value)) return undefined
  const { appliedTierId, appliedTierName, limitSeconds, processingStartedAt, terminatedAt } = value
  if (
    typeof appliedTierId !== 'string' ||
    typeof appliedTierName !== 'string' ||
    typeof limitSeconds !== 'number' ||
    typeof processingStartedAt !== 'string' ||
    typeof terminatedAt !== 'string'
  ) {
    return undefined
  }
  return { appliedTierId, appliedTierName, limitSeconds, processingStartedAt, terminatedAt }
}

const readDiagnosticLog = (
  value: unknown
): WorkflowExecutionResultDiagnostics['logs'][number] | null => {
  if (!isRecord(value)) return null
  const { blockId, blockName, blockType, startedAt, endedAt, durationMs, success, error, code } =
    value
  if (
    typeof blockId !== 'string' ||
    typeof startedAt !== 'string' ||
    typeof endedAt !== 'string' ||
    typeof durationMs !== 'number' ||
    typeof success !== 'boolean'
  ) {
    return null
  }
  return {
    blockId,
    ...(typeof blockName === 'string' ? { blockName } : {}),
    ...(typeof blockType === 'string' ? { blockType } : {}),
    startedAt,
    endedAt,
    durationMs,
    success,
    ...(typeof error === 'string' ? { error } : {}),
    ...(typeof code === 'string' ? { code } : {}),
  }
}

export function readWorkflowExecutionResultDiagnostics(
  value: unknown
): WorkflowExecutionResultDiagnostics | null {
  if (!isRecord(value) || !Array.isArray(value.logs)) return null
  const deadline = readDeadline(value.deadline)
  if (
    typeof value.error !== 'string' ||
    value.code !== WORKFLOW_EXECUTION_TIME_LIMIT_EXCEEDED ||
    !deadline
  ) {
    return null
  }
  return {
    error: value.error,
    code: WORKFLOW_EXECUTION_TIME_LIMIT_EXCEEDED,
    deadline,
    logs: value.logs.flatMap((entry) => {
      const log = readDiagnosticLog(entry)
      return log ? [log] : []
    }),
  }
}
