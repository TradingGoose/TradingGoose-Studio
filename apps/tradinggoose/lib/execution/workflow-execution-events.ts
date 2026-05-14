import { db } from '@tradinggoose/db'
import { pendingExecution } from '@tradinggoose/db/schema'
import { and, eq } from 'drizzle-orm'
import { createLogger } from '@/lib/logs/console/logger'
import { getRedisClient, getRedisStorageMode } from '@/lib/redis'
import type {
  WorkflowExecutionEvent,
  WorkflowExecutionEventEntry,
  WorkflowExecutionEventInput,
} from '@/lib/workflows/execution-events'

const logger = createLogger('WorkflowExecutionEvents')
const BUFFER_KEY_PREFIX = 'workflow:execution:events:'
const BUFFER_TTL_SECONDS = 60 * 60
const BUFFER_EVENT_LIMIT = 1000

type MemoryExecutionEventStream = {
  events: WorkflowExecutionEventEntry[]
  nextEventId: number
  expiresAt: number
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
  return raw.map(parseEventEntry).filter((entry): entry is WorkflowExecutionEventEntry =>
    Boolean(entry)
  )
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
  const [row] = await db
    .select({
      status: pendingExecution.status,
      result: pendingExecution.result,
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

  if (!row) return null

  let events: WorkflowExecutionEventEntry[] = []
  if (params.afterEventId !== undefined) {
    try {
      events = await readBufferedEvents({
        pendingExecutionId: params.pendingExecutionId,
        afterEventId: params.afterEventId,
      })
    } catch (error) {
      logger.error('Failed to read workflow execution event buffer', {
        workflowId: params.workflowId,
        executionId: params.pendingExecutionId,
        error,
      })
    }
  }

  return {
    status: row.status,
    result: row.result,
    errorMessage: row.errorMessage,
    events,
  }
}
