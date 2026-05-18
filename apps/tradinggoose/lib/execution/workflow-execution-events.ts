import { db } from '@tradinggoose/db'
import { pendingExecution, workflowExecutionLogs } from '@tradinggoose/db/schema'
import { and, eq } from 'drizzle-orm'
import { createLogger } from '@/lib/logs/console/logger'
import { getRedisClient, getRedisStorageMode } from '@/lib/redis'
import type {
  WorkflowExecutionEvent,
  WorkflowExecutionEventEntry,
  WorkflowExecutionEventInput,
} from '@/lib/workflows/execution-events'
import { isTerminalWorkflowExecutionEvent } from '@/lib/workflows/execution-events'
import { isExecutionResult } from '@/lib/workflows/execution-result'
import type { ExecutionResult } from '@/executor/types'

const logger = createLogger('WorkflowExecutionEvents')
const BUFFER_KEY_PREFIX = 'workflow:execution:events:'
const BUFFER_TTL_SECONDS = 60 * 60
const BUFFER_EVENT_LIMIT = 1000

type MemoryExecutionEventStream = {
  events: WorkflowExecutionEventEntry[]
  nextEventId: number
  expiresAt: number
}

export type WorkflowExecutionEventStateStatus = 'pending' | 'processing' | 'completed' | 'failed'

type WorkflowExecutionLogStateRow = {
  level: string
  startedAt: Date
  endedAt: Date | null
  totalDurationMs: number | null
  executionData: unknown
}

const memoryStreams = new Map<string, MemoryExecutionEventStream>()

function eventsKey(pendingExecutionId: string) {
  return `${BUFFER_KEY_PREFIX}${pendingExecutionId}:events`
}

function sequenceKey(pendingExecutionId: string) {
  return `${BUFFER_KEY_PREFIX}${pendingExecutionId}:seq`
}

function canUseMemoryBuffer() {
  return typeof window === 'undefined' && getRedisStorageMode() === 'local'
}

function pruneExpiredMemoryStreams(now = Date.now()) {
  for (const [key, stream] of memoryStreams) {
    if (stream.expiresAt <= now) {
      memoryStreams.delete(key)
    }
  }
}

function getMemoryStream(pendingExecutionId: string) {
  pruneExpiredMemoryStreams()
  let stream = memoryStreams.get(pendingExecutionId)
  if (!stream) {
    stream = {
      events: [],
      nextEventId: 1,
      expiresAt: Date.now() + BUFFER_TTL_SECONDS * 1000,
    }
    memoryStreams.set(pendingExecutionId, stream)
  }
  return stream
}

function touchMemoryStream(stream: MemoryExecutionEventStream) {
  stream.expiresAt = Date.now() + BUFFER_TTL_SECONDS * 1000
}

function createEventEntry(params: {
  eventId: number
  pendingExecutionId: string
  workflowId: string
  input: WorkflowExecutionEventInput
}): WorkflowExecutionEventEntry {
  const event = {
    ...params.input,
    executionId: params.pendingExecutionId,
    workflowId: params.workflowId,
    timestamp: params.input.timestamp ?? new Date().toISOString(),
    eventId: params.eventId,
  } as WorkflowExecutionEvent

  return { eventId: params.eventId, event }
}

function parseEventEntry(value: string): WorkflowExecutionEventEntry | null {
  try {
    const entry = JSON.parse(value) as WorkflowExecutionEventEntry
    if (
      entry &&
      typeof entry === 'object' &&
      typeof entry.eventId === 'number' &&
      entry.event &&
      typeof entry.event === 'object'
    ) {
      return entry
    }
  } catch {
    return null
  }
  return null
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

function readFinalOutput(executionData: unknown): Record<string, unknown> {
  if (!isRecord(executionData) || !isRecord(executionData.finalOutput)) {
    return {}
  }
  return executionData.finalOutput
}

function readLogErrorMessage(row: WorkflowExecutionLogStateRow) {
  const executionData = isRecord(row.executionData) ? row.executionData : {}
  if (typeof executionData.errorMessage === 'string' && executionData.errorMessage.length > 0) {
    return executionData.errorMessage
  }

  const finalOutput = readFinalOutput(row.executionData)
  return typeof finalOutput.error === 'string' && finalOutput.error.length > 0
    ? finalOutput.error
    : 'Workflow execution failed'
}

function readQueuedExecutionMetadata(executionData: Record<string, unknown>) {
  const trigger = isRecord(executionData.trigger) ? executionData.trigger : {}
  const data = isRecord(trigger.data) ? trigger.data : {}
  return isRecord(data.queuedExecution) ? data.queuedExecution : null
}

export function createWorkflowExecutionResultFromLog(row: WorkflowExecutionLogStateRow): {
  status: WorkflowExecutionEventStateStatus
  result: ExecutionResult | null
  errorMessage: string | null
} {
  if (!row.endedAt) {
    return {
      status: 'processing',
      result: null,
      errorMessage: null,
    }
  }

  const executionData = isRecord(row.executionData) ? row.executionData : {}
  const finalOutput = readFinalOutput(executionData)
  const queuedExecution = readQueuedExecutionMetadata(executionData)
  const traceSpans = Array.isArray(executionData.traceSpans) ? executionData.traceSpans : []
  const failed = row.level === 'error'
  const errorMessage = failed ? readLogErrorMessage(row) : null
  const metadata = {
    duration: row.totalDurationMs ?? 0,
    startTime: row.startedAt.toISOString(),
    endTime: row.endedAt.toISOString(),
    ...(queuedExecution ? { queuedExecution } : {}),
  } as ExecutionResult['metadata'] & { queuedExecution?: Record<string, unknown> }
  const result: ExecutionResult & { traceSpans?: unknown[] } = {
    success: !failed,
    output: finalOutput,
    ...(errorMessage ? { error: errorMessage } : {}),
    ...(traceSpans.length > 0 ? { traceSpans } : {}),
    logs: [],
    metadata,
  }

  return {
    status: failed ? 'failed' : 'completed',
    result,
    errorMessage,
  }
}

function createWorkflowExecutionStateFromTerminalEvent(entry: WorkflowExecutionEventEntry) {
  const event = entry.event
  if (event.type === 'execution:completed') {
    return {
      status: 'completed' as const,
      result: isExecutionResult(event.data.result) ? event.data.result : null,
      errorMessage: null,
    }
  }

  if (event.type === 'execution:cancelled') {
    return {
      status: 'failed' as const,
      result: isExecutionResult(event.data.result) ? event.data.result : null,
      errorMessage: 'Workflow execution was cancelled',
    }
  }

  if (event.type === 'execution:error') {
    return {
      status: 'failed' as const,
      result: isExecutionResult(event.data.result) ? event.data.result : null,
      errorMessage: event.data.error,
    }
  }

  return {
    status: 'failed' as const,
    result: null,
    errorMessage: 'Workflow execution failed',
  }
}

function findTerminalEvent(entries: WorkflowExecutionEventEntry[]) {
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = entries[index]
    if (entry && isTerminalWorkflowExecutionEvent(entry.event)) {
      return entry
    }
  }
  return null
}

async function readBufferedEvents(params: {
  pendingExecutionId: string
  afterEventId: number
}): Promise<WorkflowExecutionEventEntry[]> {
  const redis = getRedisClient()
  if (!redis) {
    if (!canUseMemoryBuffer()) return []
    pruneExpiredMemoryStreams()
    const stream = memoryStreams.get(params.pendingExecutionId)
    if (!stream) return []
    touchMemoryStream(stream)
    return stream.events.filter((entry) => entry.eventId > params.afterEventId)
  }

  const raw = await redis.zrangebyscore(
    eventsKey(params.pendingExecutionId),
    params.afterEventId + 1,
    '+inf'
  )
  return raw
    .map(parseEventEntry)
    .filter((entry): entry is WorkflowExecutionEventEntry => Boolean(entry))
}

export async function createWorkflowExecutionEventWriter(params: {
  pendingExecutionId: string
  workflowId: string
  enabled?: boolean
}) {
  if (params.enabled === false) {
    return {
      write: async (input: WorkflowExecutionEventInput): Promise<WorkflowExecutionEventEntry> =>
        createEventEntry({
          eventId: 0,
          pendingExecutionId: params.pendingExecutionId,
          workflowId: params.workflowId,
          input,
        }),
    }
  }

  const [row] = await db
    .select({ id: pendingExecution.id })
    .from(pendingExecution)
    .where(
      and(
        eq(pendingExecution.id, params.pendingExecutionId),
        eq(pendingExecution.workflowId, params.workflowId)
      )
    )
    .limit(1)

  if (!row) {
    throw new Error(`Pending workflow execution ${params.pendingExecutionId} was not found`)
  }

  let writeChain = Promise.resolve()

  const write = async (
    input: WorkflowExecutionEventInput
  ): Promise<WorkflowExecutionEventEntry> => {
    const task = writeChain.then(async () => {
      const redis = getRedisClient()
      if (!redis) {
        if (!canUseMemoryBuffer()) {
          throw new Error('Workflow execution event buffer is unavailable')
        }
        const stream = getMemoryStream(params.pendingExecutionId)
        const entry = createEventEntry({
          eventId: stream.nextEventId++,
          pendingExecutionId: params.pendingExecutionId,
          workflowId: params.workflowId,
          input,
        })
        stream.events.push(entry)
        if (stream.events.length > BUFFER_EVENT_LIMIT) {
          stream.events = stream.events.slice(-BUFFER_EVENT_LIMIT)
        }
        touchMemoryStream(stream)
        return entry
      }

      const eventId = await redis.incr(sequenceKey(params.pendingExecutionId))
      const entry = createEventEntry({
        eventId,
        pendingExecutionId: params.pendingExecutionId,
        workflowId: params.workflowId,
        input,
      })
      const key = eventsKey(params.pendingExecutionId)
      await redis
        .multi()
        .zadd(key, eventId, JSON.stringify(entry))
        .expire(key, BUFFER_TTL_SECONDS)
        .expire(sequenceKey(params.pendingExecutionId), BUFFER_TTL_SECONDS)
        .zremrangebyrank(key, 0, -BUFFER_EVENT_LIMIT - 1)
        .exec()

      return entry
    })

    writeChain = task.then(
      () => undefined,
      () => undefined
    )
    return task
  }

  return { write }
}

export async function readWorkflowExecutionEventState(params: {
  pendingExecutionId: string
  workflowId: string
  afterEventId?: number
}) {
  const readEvents = async (afterEventId: number) => {
    try {
      return await readBufferedEvents({
        pendingExecutionId: params.pendingExecutionId,
        afterEventId,
      })
    } catch (error) {
      logger.error('Failed to read workflow execution event buffer', {
        workflowId: params.workflowId,
        executionId: params.pendingExecutionId,
        error,
      })
      return []
    }
  }

  const [row] = await db
    .select({
      status: pendingExecution.status,
      errorMessage: pendingExecution.errorMessage,
    })
    .from(pendingExecution)
    .where(
      and(
        eq(pendingExecution.id, params.pendingExecutionId),
        eq(pendingExecution.workflowId, params.workflowId)
      )
    )
    .limit(1)

  if (row) {
    return {
      status: row.status,
      result: null,
      errorMessage: row.errorMessage,
      events: params.afterEventId === undefined ? [] : await readEvents(params.afterEventId),
    }
  }

  const events = await readEvents(params.afterEventId ?? 0)
  const terminalEvent = findTerminalEvent(events)
  if (terminalEvent) {
    return {
      ...createWorkflowExecutionStateFromTerminalEvent(terminalEvent),
      events: params.afterEventId === undefined ? [] : events,
    }
  }

  const [logRow] = await db
    .select({
      level: workflowExecutionLogs.level,
      startedAt: workflowExecutionLogs.startedAt,
      endedAt: workflowExecutionLogs.endedAt,
      totalDurationMs: workflowExecutionLogs.totalDurationMs,
      executionData: workflowExecutionLogs.executionData,
    })
    .from(workflowExecutionLogs)
    .where(
      and(
        eq(workflowExecutionLogs.executionId, params.pendingExecutionId),
        eq(workflowExecutionLogs.workflowId, params.workflowId)
      )
    )
    .limit(1)

  if (!logRow) {
    return events.length > 0
      ? {
          status: 'processing' as const,
          result: null,
          errorMessage: null,
          events: params.afterEventId === undefined ? [] : events,
        }
      : null
  }

  const state = createWorkflowExecutionResultFromLog(logRow)
  return {
    ...state,
    events: params.afterEventId === undefined ? [] : events,
  }
}
