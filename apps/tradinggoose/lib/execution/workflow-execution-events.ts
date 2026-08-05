import { db } from '@tradinggoose/db'
import { pendingExecution, workflowExecutionLogs } from '@tradinggoose/db/schema'
import { and, eq } from 'drizzle-orm'
import { createLogger } from '@/lib/logs/console/logger'
import { getRedisClient, getRedisStorageMode } from '@/lib/redis'
import type {
  WorkflowExecutionEvent,
  WorkflowExecutionEventEntry,
  WorkflowExecutionEventInput,
  WorkflowExecutionTerminalEvent,
} from '@/lib/workflows/execution-events'
import { isTerminalWorkflowExecutionEvent } from '@/lib/workflows/execution-events'
import type { ExecutionResult } from '@/executor/types'

const logger = createLogger('WorkflowExecutionEvents')
const BUFFER_KEY_PREFIX = 'workflow:execution:events:'
const BUFFER_TTL_SECONDS = 60 * 60
const BUFFER_EVENT_LIMIT = 1000

type MemoryExecutionEventStream = {
  events: WorkflowExecutionEventEntry[]
  idempotentEntries: Map<string, WorkflowExecutionEventEntry>
  nextEventId: number
  expiresAt: number
}

type WorkflowExecutionResultState =
  | { status: 'pending' | 'processing'; result: null; failureReason: null }
  | { status: 'completed' | 'failed'; result: ExecutionResult; failureReason: string | null }

type WorkflowExecutionEventState = WorkflowExecutionResultState & {
  events: WorkflowExecutionEventEntry[]
}

type WorkflowExecutionLogStateRow = {
  level: string
  startedAt: Date
  endedAt: Date | null
  totalDurationMs: number | null
  executionData: unknown
}

export type WorkflowExecutionAccessContext = {
  userId: string | null
  workspaceId: string | null
}

const memoryStreams = new Map<string, MemoryExecutionEventStream>()

function eventsKey(pendingExecutionId: string) {
  return `${BUFFER_KEY_PREFIX}${pendingExecutionId}:events`
}

function sequenceKey(pendingExecutionId: string) {
  return `${BUFFER_KEY_PREFIX}${pendingExecutionId}:seq`
}

function idempotencyKey(pendingExecutionId: string) {
  return `${BUFFER_KEY_PREFIX}${pendingExecutionId}:idempotency`
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
      idempotentEntries: new Map(),
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

function readLogFailureReason(row: WorkflowExecutionLogStateRow) {
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

function readExecutionUserId(executionData: unknown) {
  const data = isRecord(executionData) ? executionData : {}
  const environment = isRecord(data.environment) ? data.environment : {}
  return typeof environment.userId === 'string' && environment.userId.length > 0
    ? environment.userId
    : null
}

export async function readWorkflowExecutionAccessContext(params: {
  pendingExecutionId: string
  workflowId: string
}): Promise<WorkflowExecutionAccessContext | null> {
  const [pendingRow] = await db
    .select({
      userId: pendingExecution.userId,
      workspaceId: pendingExecution.workspaceId,
    })
    .from(pendingExecution)
    .where(
      and(
        eq(pendingExecution.id, params.pendingExecutionId),
        eq(pendingExecution.workflowId, params.workflowId),
        eq(pendingExecution.executionType, 'workflow')
      )
    )
    .limit(1)

  if (pendingRow) {
    return {
      userId: pendingRow.userId,
      workspaceId: pendingRow.workspaceId,
    }
  }

  const [logRow] = await db
    .select({
      workspaceId: workflowExecutionLogs.workspaceId,
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

  if (!logRow) return null

  return {
    userId: readExecutionUserId(logRow.executionData),
    workspaceId: logRow.workspaceId,
  }
}

export function createWorkflowExecutionResultFromLog(
  row: WorkflowExecutionLogStateRow
): WorkflowExecutionResultState {
  if (!row.endedAt) {
    return {
      status: 'processing',
      result: null,
      failureReason: null,
    }
  }

  const executionData = isRecord(row.executionData) ? row.executionData : {}
  const canonicalResult = executionData.canonicalResult
  if (
    isRecord(canonicalResult) &&
    typeof canonicalResult.success === 'boolean' &&
    isRecord(canonicalResult.output)
  ) {
    const result = canonicalResult as unknown as ExecutionResult
    return {
      status: result.success ? 'completed' : 'failed',
      result,
      failureReason: result.error ?? null,
    }
  }
  const finalOutput = readFinalOutput(executionData)
  const queuedExecution = readQueuedExecutionMetadata(executionData)
  const traceSpans = Array.isArray(executionData.traceSpans) ? executionData.traceSpans : []
  const hasResponseBlock = executionData.hasResponseBlock === true
  const failed = row.level === 'error'
  const failureReason = failed ? readLogFailureReason(row) : null
  const metadata = {
    duration: row.totalDurationMs ?? 0,
    startTime: row.startedAt.toISOString(),
    endTime: row.endedAt.toISOString(),
    ...(hasResponseBlock ? { hasResponseBlock } : {}),
    ...(queuedExecution ? { queuedExecution } : {}),
  } as ExecutionResult['metadata'] & { queuedExecution?: Record<string, unknown> }
  const result: ExecutionResult & { traceSpans?: unknown[] } = {
    success: !failed,
    output: finalOutput,
    ...(failureReason ? { error: failureReason } : {}),
    ...(traceSpans.length > 0 ? { traceSpans } : {}),
    logs: [],
    metadata,
  }

  return {
    status: failed ? 'failed' : 'completed',
    result,
    failureReason,
  }
}

function createWorkflowExecutionStateFromTerminalEvent(event: WorkflowExecutionTerminalEvent) {
  if (event.type === 'execution:completed') {
    return {
      status: 'completed' as const,
      result: event.data.result,
      failureReason: null,
    }
  }

  const failureReason =
    event.type === 'execution:cancelled' ? 'Workflow execution was cancelled' : event.data.error
  return {
    status: 'failed' as const,
    result: event.data.result,
    failureReason,
  }
}

function findTerminalEvent(entries: WorkflowExecutionEventEntry[]) {
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = entries[index]
    if (entry && isTerminalWorkflowExecutionEvent(entry.event)) {
      return entry.event
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
}) {
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
    input: WorkflowExecutionEventInput,
    options?: { idempotencyKey?: string }
  ): Promise<WorkflowExecutionEventEntry> => {
    const task = writeChain.then(async () => {
      const redis = getRedisClient()
      if (!redis) {
        if (!canUseMemoryBuffer()) {
          throw new Error('Workflow execution event buffer is unavailable')
        }
        const stream = getMemoryStream(params.pendingExecutionId)
        if (options?.idempotencyKey) {
          const existing = stream.idempotentEntries.get(options.idempotencyKey)
          if (existing) return existing
        }
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
        if (options?.idempotencyKey) {
          stream.idempotentEntries.set(options.idempotencyKey, entry)
        }
        touchMemoryStream(stream)
        return entry
      }

      if (options?.idempotencyKey) {
        const template = createEventEntry({
          eventId: 0,
          pendingExecutionId: params.pendingExecutionId,
          workflowId: params.workflowId,
          input,
        })
        const serialized = await redis.eval(
          `local existing = redis.call('HGET', KEYS[3], ARGV[1])
           if existing then return existing end
           local eventId = redis.call('INCR', KEYS[2])
           local entry = cjson.decode(ARGV[2])
           entry.eventId = eventId
           entry.event.eventId = eventId
           local value = cjson.encode(entry)
           redis.call('ZADD', KEYS[1], eventId, value)
           redis.call('HSET', KEYS[3], ARGV[1], value)
           redis.call('EXPIRE', KEYS[1], ARGV[3])
           redis.call('EXPIRE', KEYS[2], ARGV[3])
           redis.call('EXPIRE', KEYS[3], ARGV[3])
           redis.call('ZREMRANGEBYRANK', KEYS[1], 0, -tonumber(ARGV[4]) - 1)
           return value`,
          3,
          eventsKey(params.pendingExecutionId),
          sequenceKey(params.pendingExecutionId),
          idempotencyKey(params.pendingExecutionId),
          options.idempotencyKey,
          JSON.stringify(template),
          BUFFER_TTL_SECONDS,
          BUFFER_EVENT_LIMIT
        )
        const entry = parseEventEntry(String(serialized))
        if (!entry) throw new Error('Workflow execution event buffer returned invalid data')
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
}): Promise<WorkflowExecutionEventState | null> {
  const readEvents = async (afterEventId: number) => {
    try {
      const events = await readBufferedEvents({
        pendingExecutionId: params.pendingExecutionId,
        afterEventId,
      })
      return events.filter((entry) => entry.event.workflowId === params.workflowId)
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
    })
    .from(pendingExecution)
    .where(
      and(
        eq(pendingExecution.id, params.pendingExecutionId),
        eq(pendingExecution.workflowId, params.workflowId),
        eq(pendingExecution.executionType, 'workflow')
      )
    )
    .limit(1)

  if (row) {
    return {
      status: row.status,
      result: null,
      failureReason: null,
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
          failureReason: null,
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
