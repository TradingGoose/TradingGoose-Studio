import {
  COPILOT_CONTEXT_PROJECTION_LIMITS,
  MAX_COPILOT_CONTEXT_BYTES_PER_ITEM,
} from '@/lib/copilot/context-limits'
import { stringifyBoundedRedactedJson } from '@/lib/security/redaction'

type ExecutionLogContextMode = 'implicit' | 'explicit'

type ExecutionLogRecord = {
  id?: unknown
  workflowId?: unknown
  executionId?: unknown
  level?: unknown
  trigger?: unknown
  startedAt?: unknown
  endedAt?: unknown
  totalDurationMs?: unknown
  executionData?: unknown
  cost?: unknown
  workflowSummary?: unknown
}

const EXECUTION_TRACE_SUMMARY_LIMIT = 24

const readRecord = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null

const readString = (value: unknown): string | null =>
  typeof value === 'string' && value.length > 0 ? value : null

const readTimestamp = (value: unknown): string | null => {
  if (value === null || value === undefined) return null
  if (value instanceof Date) return value.toISOString()
  return String(value)
}

function readExecutionErrorIdentity(
  executionData: Record<string, unknown>
): Record<string, unknown> | null {
  const record = readRecord(executionData.errorDetails)
  if (!record) return null

  const summary = {
    ...(readString(record.blockId) ? { blockId: record.blockId } : {}),
    ...(readString(record.blockName) ? { blockName: record.blockName } : {}),
    ...(readString(record.blockType) ? { blockType: record.blockType } : {}),
  }
  return Object.keys(summary).length > 0 ? summary : null
}

function buildExecutionTraceSummary(traceSpans: unknown): Record<string, unknown> | null {
  if (!Array.isArray(traceSpans) || traceSpans.length === 0) return null

  const queue = traceSpans.slice(0, EXECUTION_TRACE_SUMMARY_LIMIT)
  const spans: Record<string, unknown>[] = []
  let truncated = traceSpans.length > queue.length

  for (let cursor = 0; cursor < queue.length; cursor += 1) {
    const span = readRecord(queue[cursor])
    if (!span) continue

    const status = readString(span.status)
    spans.push({
      ...(readString(span.id) ? { id: span.id } : {}),
      ...(readString(span.blockId) ? { blockId: span.blockId } : {}),
      ...(readString(span.name) ? { name: span.name } : {}),
      ...(readString(span.type) ? { type: span.type } : {}),
      ...(status ? { status } : {}),
      ...(typeof span.duration === 'number' && Number.isFinite(span.duration)
        ? { durationMs: span.duration }
        : {}),
    })

    const children = Array.isArray(span.children) ? span.children : []
    const remaining = EXECUTION_TRACE_SUMMARY_LIMIT - queue.length
    if (children.length > remaining) truncated = true
    queue.push(...children.slice(0, remaining))
  }

  return {
    includedSpanCount: spans.length,
    errorSpanCount: spans.filter((span) => span.status === 'error').length,
    spans,
    ...(truncated ? { truncated: true } : {}),
  }
}

function buildExecutionLogMetadata(log: ExecutionLogRecord): Record<string, unknown> {
  const workflowSummary = readRecord(log.workflowSummary)
  return {
    id: readString(log.id) ?? '',
    workflowId: readString(log.workflowId) ?? readString(workflowSummary?.id) ?? null,
    executionId: readString(log.executionId) ?? '',
    level: readString(log.level) ?? '',
    trigger: readString(log.trigger) ?? '',
    startedAt: readTimestamp(log.startedAt),
    endedAt: readTimestamp(log.endedAt),
    totalDurationMs:
      typeof log.totalDurationMs === 'number' && Number.isFinite(log.totalDurationMs)
        ? log.totalDurationMs
        : null,
    entityName: readString(workflowSummary?.name) ?? '',
  }
}

function buildExecutionLogPayload(
  log: ExecutionLogRecord,
  mode: ExecutionLogContextMode
): Record<string, unknown> {
  const executionData = readRecord(log.executionData)
  const traceSummary = executionData && buildExecutionTraceSummary(executionData.traceSpans)
  const errorSummary = executionData && readExecutionErrorIdentity(executionData)
  const selectedExecutionData =
    executionData && mode === 'explicit'
      ? {
          ...(executionData.traceSpans !== undefined
            ? { traceSpans: executionData.traceSpans }
            : {}),
          ...(executionData.errorDetails !== undefined
            ? { errorDetails: executionData.errorDetails }
            : {}),
          ...(executionData.errorMessage !== undefined
            ? { errorMessage: executionData.errorMessage }
            : {}),
          ...(executionData.error !== undefined ? { error: executionData.error } : {}),
          ...(executionData.finalOutput !== undefined
            ? { finalOutput: executionData.finalOutput }
            : {}),
        }
      : {
          ...(traceSummary ? { traceSummary } : {}),
          ...(errorSummary ? { errorSummary } : {}),
        }

  return {
    ...buildExecutionLogMetadata(log),
    ...(selectedExecutionData && Object.keys(selectedExecutionData).length > 0
      ? { executionData: selectedExecutionData }
      : {}),
    ...(log.cost !== null && log.cost !== undefined ? { cost: log.cost } : {}),
  }
}

export function projectExecutionLogContext(
  log: ExecutionLogRecord,
  mode: ExecutionLogContextMode
): Record<string, unknown> {
  const primary = stringifyBoundedRedactedJson(
    buildExecutionLogPayload(log, mode),
    COPILOT_CONTEXT_PROJECTION_LIMITS
  )
  if (Buffer.byteLength(primary, 'utf8') <= MAX_COPILOT_CONTEXT_BYTES_PER_ITEM) {
    return JSON.parse(primary) as Record<string, unknown>
  }

  const fallback = stringifyBoundedRedactedJson(
    {
      ...buildExecutionLogMetadata(log),
      executionDetailsOmitted: true,
      contextTruncated: true,
    },
    { ...COPILOT_CONTEXT_PROJECTION_LIMITS, maxStringBytes: 512 }
  )
  const content =
    Buffer.byteLength(fallback, 'utf8') <= MAX_COPILOT_CONTEXT_BYTES_PER_ITEM
      ? fallback
      : '{"contextTruncated":true,"executionDetailsOmitted":true}'
  return JSON.parse(content) as Record<string, unknown>
}
